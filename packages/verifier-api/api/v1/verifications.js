'use strict';
const crypto = require('node:crypto');
const core = require('../_lib/crypto-core');
const oid4vp = require('../_lib/openid4vp');
const sdjwt = require('../_lib/sdjwt');
const { resolvePlan } = require('../_lib/plans');

const LEGACY_SECRET = process.env.EDIVERIFY_SIGNING_SECRET || 'ediverify-demo-signing-key';
const CHECKS = ['age_over_18', 'driving_license_b', 'id_verification', 'kyc_sign'];
const METHODS = ['nl_wallet', 'idin', 'yivi'];
const SANDBOX_ISSUER = 'https://sandbox-issuer.ediverify.nl';
const AUD = 'x509_san_dns:ediverify.nl';
const pick = (v, list, d) => (list.includes(v) ? v : d);

let KEY;
const signingKey = () => (KEY = KEY || core.loadSigningKey());
// Sandbox PID issuer (Ed25519, deterministic so issue/verify work across serverless instances). Trusted in sandbox only.
let ISSUER;
const sandboxIssuer = () => (ISSUER = ISSUER || core.keyPairFromSeed(crypto.createHash('sha256').update('ediverify-sandbox-pid-issuer').digest(), 'sandbox-issuer-1'));

function parse(req) {
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const q = req.query || {};
  const g = (k) => (b[k] !== undefined ? b[k] : q[k]);
  let methods = g('methods');
  if (typeof methods === 'string') methods = methods.split(',');
  return {
    action: g('action') || (g('complete') ? 'verify' : (g('id') ? 'status' : 'create')),
    id: g('id'), check: g('check'), methods, reference: g('reference') ?? null,
    merchant: g('merchant'), redirectUrl: g('redirectUrl'), method: g('method'), token: g('token'),
    sdJwt: g('sd_jwt') || g('sdJwt') || g('vp_token'), nonce: g('nonce'), disclose: g('disclose'),
  };
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

  const p = parse(req);
  const now = new Date();
  const key = signingKey();

  // Public endpoints: no plan required.
  if (p.action === 'jwks') {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json(core.jwks(key));
  }
  res.setHeader('Cache-Control', 'no-store');

  if (p.action === 'verify_token' || p.action === 'inspect') {
    const t = String(p.token || '');
    if (t.includes('.')) {
      const r = core.verifyAttestation(t, key.publicKey, { reference: p.reference === null ? undefined : p.reference });
      const pl = r.payload || {};
      return res.status(200).json({ object: 'token_verification', format: 'ed25519', kid: key.kid, valid: r.valid, reason: r.reason, attribute: pl.att, result: pl.res, reference: pl.ref, environment: pl.env, verificationId: pl.vid, expiresAt: pl.exp ? new Date(pl.exp * 1000).toISOString() : null, piiStored: 'none' });
    }
    const r = core.verifyLegacyHmac(t, LEGACY_SECRET);
    if (r.reason === 'malformed') return res.status(400).json({ valid: false, error: 'invalid_token' });
    const fresh = r.payload && Math.abs(now - Date.parse(r.payload.issuedAt)) < 3600e3;
    return res.status(200).json({ object: 'token_verification', format: 'hmac-sha256-legacy', valid: r.valid && !!fresh, signatureValid: r.reason === null, fresh: !!fresh, attribute: r.payload.attribute, result: r.payload.result, verificationId: r.payload.verificationId, piiStored: 'none' });
  }

  const plan = resolvePlan(req);
  if (plan.error) return res.status(plan.error.status).json({ error: plan.error.code, message: plan.error.message, plan: plan.plan, docs: 'https://ediverify.nl/open-source/' });
  const envTag = { environment: plan.environment, plan: plan.plan };

  if (p.action === 'issue_test_sdjwt') {
    if (plan.environment !== 'sandbox') return res.status(403).json({ error: 'sandbox_only' });
    const nonce = p.nonce || crypto.randomBytes(16).toString('base64url');
    const holder = crypto.generateKeyPairSync('ed25519');
    const { jwt, disclosures } = sdjwt.issue({
      issuer: SANDBOX_ISSUER, issuerKey: sandboxIssuer().privateKey, vct: oid4vp.PID_SDJWT_VCT,
      holderPublicJwk: holder.publicKey.export({ format: 'jwk' }),
      claims: { given_name: 'Jan', family_name: 'Jansen', birthdate: '1990-04-12', nationality: 'NL', age_equivalent: { over_18: true, over_21: true } },
    });
    // The holder discloses only age_equivalent + over_18 (wallet-side selective disclosure).
    const keep = p.disclose === 'all' ? disclosures : disclosures.filter((d) => { const n = JSON.parse(Buffer.from(d, 'base64url'))[1]; return n === 'age_equivalent' || n === 'over_18'; });
    const presentation = sdjwt.present({ jwt, disclosures: keep, holderKey: holder.privateKey, nonce, aud: AUD });
    return res.status(200).json({ object: 'test_sd_jwt', ...envTag, nonce, aud: AUD, issuer: SANDBOX_ISSUER, sd_jwt: presentation, note: 'Fictieve sandbox-PID. Alleen age_equivalent.over_18 is onthuld; naam en geboortedatum blijven verborgen.' });
  }

  if (p.action === 'verify_sdjwt') {
    if (!p.sdJwt || !p.nonce) return res.status(400).json({ error: 'missing_parameters', message: 'sd_jwt en nonce zijn verplicht.' });
    const trusted = plan.environment === 'sandbox' ? { [SANDBOX_ISSUER]: sandboxIssuer().publicKey } : {};
    const r = sdjwt.verifyPresentation(p.sdJwt, { trustedIssuers: trusted, nonce: p.nonce, aud: AUD, claimPaths: [['age_equivalent', 'over_18'], ['age_over_18']] });
    p.sdJwt = null;
    if (!r.verified) return res.status(422).json({ object: 'verification', status: 'failed', error: r.error, ...envTag });
    const { token, payload } = core.signAttestation(key, { attribute: 'age_over_18', result: r.result, reference: p.reference, environment: plan.environment, method: 'sd_jwt_vc' });
    return res.status(200).json({ object: 'verification', id: payload.vid, status: r.result ? 'verified' : 'rejected', result: r.result, attribute: 'age_over_18', credentialFormat: 'dc+sd-jwt', issuer: r.issuer, piiStored: 'none', zeroPersistence: true, verifiedAt: now.toISOString(), ...envTag, token, tokenFormat: 'ed25519', kid: key.kid, jwks: 'https://ediverify.nl/.well-known/jwks.json' });
  }

  if (p.action === 'verify') {
    if (!p.id || !/^ver_[0-9a-f]{24}$/.test(p.id)) return res.status(400).json({ error: 'invalid_id', message: 'Geef een geldig id (ver_...) mee.' });
    if (plan.environment !== 'sandbox') return res.status(409).json({ error: 'wallet_response_required', message: 'In productie wordt een verificatie alleen afgerond met een echte wallet-presentatie (verify_sdjwt / OpenID4VP direct_post).' });
    const check = pick(p.check, CHECKS, 'age_over_18');
    const method = pick(p.method, METHODS, 'nl_wallet');
    const { token, payload } = core.signAttestation(key, { attribute: check, result: true, reference: p.reference, verificationId: p.id, environment: 'sandbox', method });
    return res.status(200).json({
      id: p.id, object: 'verification', ...envTag, status: 'verified', result: true, attribute: check, simulated: true,
      piiStored: 'none', zeroPersistence: true, verifiedAt: now.toISOString(),
      attestation: { verificationId: p.id, attribute: check, result: true, method, environment: 'sandbox', issuedAt: now.toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString(), alg: 'EdDSA', kid: key.kid },
      token, tokenFormat: 'ed25519', jwks: 'https://ediverify.nl/.well-known/jwks.json',
    });
  }

  if (p.action === 'status') {
    return res.status(200).json({ id: p.id, object: 'verification', ...envTag, status: 'pending', hint: 'Rond af met POST action:"verify" (sandbox) of action:"verify_sdjwt".' });
  }

  if (p.action !== 'create') return res.status(400).json({ error: 'unknown_action' });
  const id = 'ver_' + crypto.randomBytes(12).toString('hex');
  const check = pick(p.check, CHECKS, 'age_over_18');
  const methods = (Array.isArray(p.methods) ? p.methods : METHODS).filter((m) => METHODS.includes(m));
  const oidCheck = oid4vp.CHECKS[check] ? check : 'age_over_18';
  const ar = oid4vp.buildAuthorizationRequest({ check: oidCheck, clientId: 'ediverify.nl' });
  return res.status(req.method === 'POST' ? 201 : 200).json({
    id, object: 'verification', ...envTag, status: 'pending', check,
    methods: methods.length ? methods : METHODS,
    reference: p.reference, merchant: p.merchant || null, redirectUrl: p.redirectUrl || null,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(),
    zeroPersistence: true, checkoutUrl: 'https://ediverify.nl/?verify=' + id,
    openid4vpRequest: ar.request, openid4vpDeepLink: ar.deepLink,
    _links: { verify: { method: 'POST', href: '/api/v1/verifications', body: { action: 'verify', id, check } }, jwks: '/.well-known/jwks.json' },
  });
};
