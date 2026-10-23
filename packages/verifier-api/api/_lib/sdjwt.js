'use strict';
// SD-JWT VC (IETF draft-ietf-oauth-sd-jwt-vc / RFC 9901 SD-JWT) issue + verify with key binding, node:crypto only.
const crypto = require('node:crypto');
const { b64u, fromB64u, jsonB64u, parseB64uJson } = require('./b64');

const ALG = { ES256: { curve: 'P-256', hash: 'sha256' }, EdDSA: { curve: 'Ed25519', hash: null } };

function algFor(key) {
  const t = key.asymmetricKeyType;
  if (t === 'ed25519') return 'EdDSA';
  if (t === 'ec' && key.asymmetricKeyDetails && key.asymmetricKeyDetails.namedCurve === 'prime256v1') return 'ES256';
  throw new Error('unsupported key type ' + t);
}

function signJwt(header, payload, privateKey) {
  const alg = algFor(privateKey);
  const input = jsonB64u({ ...header, alg }) + '.' + jsonB64u(payload);
  const sig = alg === 'EdDSA'
    ? crypto.sign(null, Buffer.from(input), privateKey)
    : crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return input + '.' + b64u(sig);
}

function verifyJwt(jwt, publicKey, expectedTyp) {
  const parts = String(jwt).split('.');
  if (parts.length !== 3) throw new Error('malformed_jwt');
  const header = parseB64uJson(parts[0]);
  const payload = parseB64uJson(parts[1]);
  const alg = algFor(publicKey);
  if (header.alg !== alg) throw new Error('alg_mismatch');
  if (expectedTyp && header.typ !== expectedTyp) throw new Error('typ_mismatch');
  const input = Buffer.from(parts[0] + '.' + parts[1]);
  const sig = fromB64u(parts[2]);
  const ok = alg === 'EdDSA' ? crypto.verify(null, input, publicKey, sig) : crypto.verify('sha256', input, { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig);
  if (!ok) throw new Error('bad_signature');
  return { header, payload };
}

const digest = (disclosure) => b64u(crypto.createHash('sha256').update(disclosure, 'ascii').digest());

function makeDisclosure(name, value) {
  return b64u(Buffer.from(JSON.stringify([b64u(crypto.randomBytes(16)), name, value])));
}

/**
 * Issue an SD-JWT VC. claims: flat object; every top-level claim becomes selectively disclosable.
 * Nested objects (e.g. age_equivalent) get their own _sd array.
 */
function issue({ issuer, issuerKey, vct, claims, holderPublicJwk, ttlSec = 86400 * 365, now = Date.now() }) {
  const disclosures = [];
  const sdFor = (obj) => {
    const sd = [];
    for (const [k, v] of Object.entries(obj)) {
      const val = v && typeof v === 'object' && !Array.isArray(v) ? sdFor(v) : v;
      const d = makeDisclosure(k, val);
      disclosures.push(d);
      sd.push(digest(d));
    }
    return { _sd: sd.sort() };
  };
  const iat = Math.floor(now / 1000);
  const payload = { iss: issuer, vct, iat, exp: iat + ttlSec, _sd_alg: 'sha-256', ...sdFor(claims), cnf: { jwk: holderPublicJwk } };
  const jwt = signJwt({ typ: 'dc+sd-jwt' }, payload, issuerKey);
  return { jwt, disclosures };
}

/** Holder presents a subset of disclosures with a key binding JWT. */
function present({ jwt, disclosures, holderKey, nonce, aud, now = Date.now() }) {
  const base = [jwt, ...disclosures].join('~') + '~';
  const sdHash = b64u(crypto.createHash('sha256').update(base, 'ascii').digest());
  const kb = signJwt({ typ: 'kb+jwt' }, { iat: Math.floor(now / 1000), nonce, aud, sd_hash: sdHash }, holderKey);
  return base + kb;
}

/**
 * Verify an SD-JWT VC presentation and return ONLY one boolean.
 * trustedIssuers: { [iss]: KeyObject|JWK }. claimPath: e.g. ['age_equivalent','over_18'] or ['age_over_18'].
 */
function verifyPresentation(sdJwt, { trustedIssuers, nonce, aud, claimPaths, vct, now = Date.now(), maxKbAgeSec = 300 }) {
  let parts = String(sdJwt).split('~');
  try {
    if (parts.length < 2) throw new Error('malformed_sd_jwt');
    const kbJwt = parts.pop();
    const issuerJwt = parts[0];
    const disclosures = parts.slice(1).filter(Boolean);
    const unverified = parseB64uJson(issuerJwt.split('.')[1] || '');
    const keyIn = trustedIssuers && trustedIssuers[unverified.iss];
    if (!keyIn) throw new Error('untrusted_issuer');
    const issuerPub = keyIn.kty ? crypto.createPublicKey({ key: keyIn, format: 'jwk' }) : keyIn;
    const { payload } = verifyJwt(issuerJwt, issuerPub, 'dc+sd-jwt');
    const t = Math.floor(now / 1000);
    if (payload.exp && t > payload.exp) throw new Error('credential_expired');
    if (vct && payload.vct !== vct) throw new Error('vct_mismatch');
    if (payload._sd_alg && payload._sd_alg !== 'sha-256') throw new Error('unsupported_sd_alg');

    // Key binding
    if (!kbJwt) throw new Error('missing_key_binding');
    const holderPub = crypto.createPublicKey({ key: payload.cnf.jwk, format: 'jwk' });
    const kb = verifyJwt(kbJwt, holderPub, 'kb+jwt').payload;
    if (kb.nonce !== nonce) throw new Error('nonce_mismatch');
    if (kb.aud !== aud) throw new Error('aud_mismatch');
    if (Math.abs(t - kb.iat) > maxKbAgeSec) throw new Error('kb_stale');
    const expectedSdHash = b64u(crypto.createHash('sha256').update([issuerJwt, ...disclosures].join('~') + '~', 'ascii').digest());
    if (kb.sd_hash !== expectedSdHash) throw new Error('sd_hash_mismatch');

    // Disclosures: every one must be referenced by a digest in the signed payload (or nested _sd).
    const byDigest = new Map();
    for (const d of disclosures) {
      const arr = parseB64uJson(d);
      if (!Array.isArray(arr) || arr.length !== 3) throw new Error('malformed_disclosure');
      const h = digest(d);
      if (byDigest.has(h)) throw new Error('duplicate_disclosure');
      byDigest.set(h, arr);
    }
    const used = new Set();
    const resolve = (obj, path) => {
      if (!path.length) return obj;
      const [head, ...rest] = path;
      if (obj && Object.prototype.hasOwnProperty.call(obj, head) && head !== '_sd') return resolve(obj[head], rest);
      for (const h of (obj && obj._sd) || []) {
        const arr = byDigest.get(h);
        if (arr && arr[1] === head) { used.add(h); return resolve(arr[2], rest); }
      }
      return undefined;
    };
    // Reject disclosures not anchored anywhere in the signed structure (forged / injected).
    const anchored = new Set();
    const walk = (o) => { if (o && typeof o === 'object') { for (const h of o._sd || []) if (byDigest.has(h)) { anchored.add(h); walk(byDigest.get(h)[2]); } for (const [k, v] of Object.entries(o)) if (k !== '_sd' && k !== 'cnf') walk(v); } };
    walk(payload);
    for (const h of byDigest.keys()) if (!anchored.has(h)) throw new Error('disclosure_not_in_sd');

    let value;
    for (const p of claimPaths) { value = resolve(payload, p); if (value !== undefined) break; }
    const result = value === true;
    return { verified: true, result, issuer: payload.iss, vct: payload.vct, disclosedCount: byDigest.size };
  } catch (e) {
    return { verified: false, result: false, error: e.message };
  } finally {
    // zero-PII: drop references to the presentation and all disclosed values
    parts.length = 0; parts = null; sdJwt = null;
  }
}

module.exports = { issue, present, verifyPresentation, signJwt, verifyJwt, digest, makeDisclosure };
