'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const LIB = '../packages/verifier-api/api/_lib/';
const core = require(LIB + 'crypto-core');
const oid4vp = require(LIB + 'openid4vp');
const sdjwt = require(LIB + 'sdjwt');
const { resolvePlan, sha256 } = require(LIB + 'plans');
const handler = require('../packages/verifier-api/api/v1/verifications');

const call = (method, body = {}, headers = {}) => new Promise((resolve) => {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); }, end() { resolve({ code: this.code }); } };
  handler({ method, body, query: {}, headers }, res);
});

const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);

test('1. Ed25519 boolean attestation tokens', async (t) => {
  const pair = core.generateKeyPair('test-key');
  const jwk = core.publicJwk(pair);

  await t.test('publishes an OKP JWK', () => {
    assert.equal(jwk.kty, 'OKP'); assert.equal(jwk.crv, 'Ed25519'); assert.equal(jwk.alg, 'EdDSA');
    assert.equal(Buffer.from(jwk.x, 'base64url').length, 32);
    assert.equal(jwk.d, undefined, 'private part must never be exported');
  });
  const { token } = core.signAttestation(pair, { attribute: 'age_over_18', result: true, reference: 'order-4092' });

  await t.test('verifies offline with only the public JWK', () => {
    const r = core.verifyAttestation(token, jwk, { reference: 'order-4092', attribute: 'age_over_18' });
    assert.equal(r.valid, true); assert.equal(r.payload.res, true);
  });
  await t.test('verifies with raw 32-byte key (as PHP sodium_crypto_sign_verify_detached does)', () => {
    const [head, sig] = token.split('.');
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(jwk.x, 'base64url')]);
    const pub = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    assert.equal(crypto.verify(null, Buffer.from(head), pub, Buffer.from(sig, 'base64url')), true);
  });
  await t.test('rejects a single mutated character in payload or signature', () => {
    const [head, sig] = token.split('.');
    assert.equal(core.verifyAttestation(flip(head, 10) + '.' + sig, jwk).reason, 'bad_signature');
    assert.equal(core.verifyAttestation(head + '.' + flip(sig, 5), jwk).reason, 'bad_signature');
  });
  await t.test('rejects a single flipped bit in the signature', () => {
    const [head, sig] = token.split('.');
    const b = Buffer.from(sig, 'base64url'); b[0] ^= 1;
    assert.equal(core.verifyAttestation(head + '.' + b.toString('base64url'), jwk).valid, false);
  });
  await t.test('rejects expired tokens', () => {
    const old = core.signAttestation(pair, { attribute: 'age_over_18', result: true, ttlSec: 60, now: Date.now() - 3600e3 }).token;
    assert.equal(core.verifyAttestation(old, jwk).reason, 'expired');
  });
  await t.test('rejects a token replayed on another order reference', () => {
    assert.equal(core.verifyAttestation(token, jwk, { reference: 'order-9999' }).reason, 'reference_mismatch');
  });
  await t.test('rejects a token signed by another key', () => {
    assert.equal(core.verifyAttestation(token, core.publicJwk(core.generateKeyPair())).reason, 'bad_signature');
  });
  await t.test('result=false is never valid', () => {
    const f = core.signAttestation(pair, { attribute: 'age_over_18', result: false }).token;
    assert.equal(core.verifyAttestation(f, jwk).valid, false);
  });
  await t.test('deterministic key from seed', () => {
    const seed = crypto.randomBytes(32);
    assert.deepEqual(core.publicJwk(core.keyPairFromSeed(seed)), core.publicJwk(core.keyPairFromSeed(seed.toString('hex'))));
  });
});

test('2. OpenID4VP authorization request', async (t) => {
  await t.test('age_over_18: DCQL + presentation_definition for PID', () => {
    const { request, deepLink } = oid4vp.buildAuthorizationRequest({ check: 'age_over_18' });
    assert.equal(request.response_type, 'vp_token');
    assert.equal(request.response_mode, 'direct_post');
    assert.equal(request.client_id_scheme, 'x509_san_dns');
    assert.match(request.client_id, /^x509_san_dns:/);
    assert.ok(request.nonce.length >= 16 && request.state.length >= 16);
    const mdoc = request.dcql_query.credentials.find((c) => c.format === 'mso_mdoc');
    assert.equal(mdoc.meta.doctype_value, 'eu.europa.ec.eudi.pid.1');
    assert.deepEqual(mdoc.claims.map((c) => c.path), [['eu.europa.ec.eudi.pid.1', 'age_over_18']]);
    assert.ok(request.dcql_query.credentials.some((c) => c.format === 'dc+sd-jwt'));
    const pd = request.presentation_definition.input_descriptors[0];
    assert.equal(pd.id, 'eu.europa.ec.eudi.pid.1');
    assert.equal(pd.constraints.limit_disclosure, 'required');
    assert.equal(pd.constraints.fields.length, 1, 'only one claim may be requested');
    assert.ok(deepLink.startsWith('openid4vp://?'));
    assert.equal(JSON.parse(new URL(deepLink).searchParams.get('request')).nonce, request.nonce);
  });
  await t.test('driving_license_b: mDL driving_privileges only', () => {
    const { request } = oid4vp.buildAuthorizationRequest({ check: 'driving_license_b' });
    const [c] = request.dcql_query.credentials;
    assert.equal(c.meta.doctype_value, 'org.iso.18013.5.1.mDL');
    assert.deepEqual(c.claims[0].path, ['org.iso.18013.5.1', 'driving_privileges']);
    assert.equal(c.claims[0].intent_to_retain, false);
    assert.match(request.presentation_definition.input_descriptors[0].constraints.fields[0].path[0], /driving_privileges/);
  });
  await t.test('nonces are unique', () => {
    const a = oid4vp.buildAuthorizationRequest({ check: 'age_over_18' }).nonce;
    assert.notEqual(a, oid4vp.buildAuthorizationRequest({ check: 'age_over_18' }).nonce);
  });
  await t.test('unknown check throws', () => assert.throws(() => oid4vp.buildAuthorizationRequest({ check: 'shoe_size' })));
});

test('3. SD-JWT VC selective disclosure', async (t) => {
  const issuer = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const holder = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ISS = 'https://pid-issuer.example';
  const claims = { given_name: 'Jan', family_name: 'Jansen', birthdate: '1990-04-12', bsn: '999999990', age_equivalent: { over_18: true, over_21: true } };
  const { jwt, disclosures } = sdjwt.issue({ issuer: ISS, issuerKey: issuer.privateKey, vct: 'urn:eudi:pid:1', claims, holderPublicJwk: holder.publicKey.export({ format: 'jwk' }) });
  const name = (d) => JSON.parse(Buffer.from(d, 'base64url'))[1];
  const minimal = disclosures.filter((d) => ['age_equivalent', 'over_18'].includes(name(d)));
  const opts = { trustedIssuers: { [ISS]: issuer.publicKey }, nonce: 'n-123', aud: 'x509_san_dns:ediverify.nl', claimPaths: [['age_equivalent', 'over_18']] };
  const pres = (ds, o = {}) => sdjwt.present({ jwt, disclosures: ds, holderKey: holder.privateKey, nonce: o.nonce || opts.nonce, aud: o.aud || opts.aud });

  await t.test('issuer JWT is ES256 and contains only digests', () => {
    const [h, p] = jwt.split('.').slice(0, 2).map((x) => JSON.parse(Buffer.from(x, 'base64url')));
    assert.equal(h.alg, 'ES256'); assert.equal(h.typ, 'dc+sd-jwt');
    assert.equal(p._sd.length, 5);
    for (const v of ['Jan', 'Jansen', '1990-04-12', '999999990']) assert.ok(!JSON.stringify(p).includes(v));
  });
  await t.test('each disclosure digest is in _sd (SHA-256 over the base64url disclosure)', () => {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
    const top = disclosures.filter((d) => p._sd.includes(sdjwt.digest(d)));
    assert.equal(top.length, 5);
    const manual = crypto.createHash('sha256').update(disclosures[0]).digest('base64url');
    assert.equal(sdjwt.digest(disclosures[0]), manual);
  });
  await t.test('verifies a minimal presentation and returns true', () => {
    const r = sdjwt.verifyPresentation(pres(minimal), opts);
    assert.equal(r.verified, true, r.error); assert.equal(r.result, true);
  });
  await t.test('EdDSA issuer works too', () => {
    const ed = crypto.generateKeyPairSync('ed25519');
    const x = sdjwt.issue({ issuer: ISS, issuerKey: ed.privateKey, vct: 'urn:eudi:pid:1', claims: { age_over_18: true }, holderPublicJwk: holder.publicKey.export({ format: 'jwk' }) });
    const p = sdjwt.present({ ...x, holderKey: holder.privateKey, nonce: 'n', aud: 'a' });
    assert.equal(sdjwt.verifyPresentation(p, { trustedIssuers: { [ISS]: ed.publicKey }, nonce: 'n', aud: 'a', claimPaths: [['age_over_18']] }).result, true);
  });
  await t.test('rejects a forged disclosure (over_18 = true injected)', () => {
    const forged = Buffer.from(JSON.stringify(['salt', 'over_18', true])).toString('base64url');
    const ds = minimal.filter((d) => name(d) !== 'over_18').concat(forged);
    assert.equal(sdjwt.verifyPresentation(pres(ds), opts).error, 'disclosure_not_in_sd');
  });
  await t.test('missing claim gives result=false', () => {
    const r = sdjwt.verifyPresentation(pres(minimal.filter((d) => name(d) !== 'over_18')), opts);
    assert.equal(r.verified, true); assert.equal(r.result, false);
  });
  await t.test('rejects wrong nonce, wrong audience, untrusted issuer, tampered issuer JWT', () => {
    assert.equal(sdjwt.verifyPresentation(pres(minimal, { nonce: 'other' }), opts).error, 'nonce_mismatch');
    assert.equal(sdjwt.verifyPresentation(pres(minimal, { aud: 'evil.example' }), opts).error, 'aud_mismatch');
    assert.equal(sdjwt.verifyPresentation(pres(minimal), { ...opts, trustedIssuers: {} }).error, 'untrusted_issuer');
    const [h, p, s] = jwt.split('.');
    const body = JSON.parse(Buffer.from(p, 'base64url')); body.exp += 1000;
    const bad = [h, Buffer.from(JSON.stringify(body)).toString('base64url'), s].join('.');
    const kb = sdjwt.present({ jwt: bad, disclosures: minimal, holderKey: holder.privateKey, nonce: opts.nonce, aud: opts.aud });
    assert.equal(sdjwt.verifyPresentation(kb, opts).error, 'bad_signature');
  });
  await t.test('rejects key binding by another holder and a stripped disclosure after signing', () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const p = sdjwt.present({ jwt, disclosures: minimal, holderKey: other.privateKey, nonce: opts.nonce, aud: opts.aud });
    assert.equal(sdjwt.verifyPresentation(p, opts).error, 'bad_signature');
    const parts = pres(minimal).split('~'); parts.splice(1, 1);
    assert.equal(sdjwt.verifyPresentation(parts.join('~'), opts).error, 'sd_hash_mismatch');
  });
});

test('4. Zero-PII guarantee', async (t) => {
  const PII = ['Jan', 'Jansen', '1990-04-12', 'birthdate', 'given_name', 'family_name', 'bsn', '999999990'];
  await t.test('API end-to-end: wallet over-discloses, token and response contain only the boolean', async () => {
    // Simulate a wallet that sends ALL disclosures (name, birthdate, ...), not just the requested one.
    const issued = await call('POST', { action: 'issue_test_sdjwt', nonce: 'nonce-zero-pii', disclose: 'all' });
    assert.equal(issued.code, 200);
    assert.ok(issued.body.sd_jwt.split('~').length > 5, 'presentation must contain the extra disclosures');
    const r = await call('POST', { action: 'verify_sdjwt', sd_jwt: issued.body.sd_jwt, nonce: 'nonce-zero-pii', reference: 'order-1' });
    assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.result, true);
    const payload = Buffer.from(r.body.token.split('.')[0], 'base64url').toString();
    for (const s of PII) {
      assert.ok(!JSON.stringify(r.body).includes(s), 'response leaks ' + s);
      assert.ok(!payload.includes(s), 'token leaks ' + s);
    }
    assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ['att', 'env', 'exp', 'iat', 'iss', 'jti', 'kid', 'mth', 'ref', 'res', 'typ', 'vid'].sort());
  });
  await t.test('library: over-disclosed presentation yields only verified/result/issuer metadata', () => {
    const issuer = crypto.generateKeyPairSync('ed25519'), holder = crypto.generateKeyPairSync('ed25519');
    const x = sdjwt.issue({ issuer: 'i', issuerKey: issuer.privateKey, vct: 'v', claims: { given_name: 'Jan', birthdate: '1990-04-12', bsn: '999999990', age_over_18: true }, holderPublicJwk: holder.publicKey.export({ format: 'jwk' }) });
    const r = sdjwt.verifyPresentation(sdjwt.present({ ...x, holderKey: holder.privateKey, nonce: 'n', aud: 'a' }), { trustedIssuers: { i: issuer.publicKey }, nonce: 'n', aud: 'a', claimPaths: [['age_over_18']] });
    assert.equal(r.result, true);
    assert.deepEqual(Object.keys(r).sort(), ['disclosedCount', 'issuer', 'result', 'vct', 'verified']);
    for (const s of PII) assert.ok(!JSON.stringify(r).includes(s));
  });
  await t.test('signAttestation refuses non-boolean results (no claim values can be smuggled in)', () => {
    assert.throws(() => core.signAttestation(core.generateKeyPair(), { attribute: 'birthdate', result: '1990-04-12' }));
  });
});

test('5. Plans: sandbox vs self-hosted vs managed', async (t) => {
  const req = (k) => ({ headers: k ? { authorization: 'Bearer ' + k } : {} });
  await t.test('no key or test_ key is sandbox', () => {
    assert.equal(resolvePlan(req(null), {}).environment, 'sandbox');
    assert.equal(resolvePlan(req('test_abc'), { EDIVERIFY_HOSTED: '1' }).plan, 'sandbox');
  });
  await t.test('self-hosted live_ keys are never limited', () => assert.equal(resolvePlan(req('live_x'), {}).plan, 'self_hosted'));
  await t.test('hosted: unknown live_ key gets 402', () => assert.equal(resolvePlan(req('live_x'), { EDIVERIFY_HOSTED: '1' }).error.status, 402));
  await t.test('hosted: subscribed live_ key is managed', () => {
    const r = resolvePlan(req('live_ok'), { EDIVERIFY_HOSTED: '1', EDIVERIFY_LIVE_KEY_HASHES: sha256('live_ok') });
    assert.equal(r.plan, 'managed'); assert.equal(r.error, undefined);
  });
  await t.test('sandbox tokens are marked environment=sandbox', async () => {
    const c = await call('POST', { check: 'age_over_18' });
    const v = await call('POST', { action: 'verify', id: c.body.id });
    assert.equal(JSON.parse(Buffer.from(v.body.token.split('.')[0], 'base64url')).env, 'sandbox');
  });
});
