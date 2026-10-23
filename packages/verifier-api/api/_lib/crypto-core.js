'use strict';
// Ed25519 boolean attestation tokens + JWKS, using only node:crypto.
// Token format (compact): base64url(JSON payload) "." base64url(Ed25519 signature over the first part)
const crypto = require('node:crypto');
const { b64u, fromB64u, jsonB64u, parseB64uJson } = require('./b64');

const TOKEN_TYP = 'ediverify-attestation+v1';
const DEFAULT_KID = 'ediverify-ed25519-2026-01';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Build an Ed25519 key pair from a 32-byte seed (Buffer, hex or base64url string). */
function keyPairFromSeed(seed, kid = DEFAULT_KID) {
  let raw = Buffer.isBuffer(seed) ? seed : (/^[0-9a-f]{64}$/i.test(seed) ? Buffer.from(seed, 'hex') : fromB64u(seed));
  if (raw.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, raw]), format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey, kid };
}

function generateKeyPair(kid = DEFAULT_KID) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicKey, kid };
}

/** Public key as OKP JWK (RFC 8037). */
function publicJwk(pair) {
  const { kty, crv, x } = pair.publicKey.export({ format: 'jwk' });
  return { kty, crv, x, kid: pair.kid, use: 'sig', alg: 'EdDSA' };
}

const jwks = (...pairs) => ({ keys: pairs.map(publicJwk) });

/**
 * Load the signing key. Production: EDIVERIFY_ED25519_SEED (32-byte hex/base64url).
 * Without it a deterministic development key is derived, clearly marked with kid suffix "-dev".
 */
function loadSigningKey(env = process.env) {
  if (env.EDIVERIFY_ED25519_SEED) return keyPairFromSeed(env.EDIVERIFY_ED25519_SEED, env.EDIVERIFY_ED25519_KID || DEFAULT_KID);
  const seed = crypto.createHash('sha256').update('ediverify-development-key-not-for-production').digest();
  return keyPairFromSeed(seed, DEFAULT_KID + '-dev');
}

/**
 * Sign a boolean attestation. Only the attribute name and its boolean result go in; never source claims.
 */
function signAttestation(pair, { attribute, result, reference = null, verificationId, environment = 'sandbox', method = null, ttlSec = 900, now = Date.now() }) {
  if (typeof attribute !== 'string' || typeof result !== 'boolean') throw new TypeError('attribute (string) and result (boolean) are required');
  const iat = Math.floor(now / 1000);
  const payload = {
    typ: TOKEN_TYP, iss: 'https://ediverify.nl', kid: pair.kid,
    vid: verificationId || 'ver_' + crypto.randomBytes(12).toString('hex'),
    att: attribute, res: result, ref: reference, env: environment, mth: method,
    iat, exp: iat + ttlSec, jti: b64u(crypto.randomBytes(12)),
  };
  const head = jsonB64u(payload);
  const sig = crypto.sign(null, Buffer.from(head), pair.privateKey);
  return { token: head + '.' + b64u(sig), payload };
}

/** Verify offline with a public key (KeyObject or OKP JWK). Optionally pin attribute / reference. */
function verifyAttestation(token, publicKeyOrJwk, { reference, attribute, now = Date.now(), leewaySec = 60 } = {}) {
  const fail = (reason) => ({ valid: false, reason });
  if (typeof token !== 'string') return fail('malformed');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return fail('malformed');
  let key;
  try { key = publicKeyOrJwk && publicKeyOrJwk.kty ? crypto.createPublicKey({ key: publicKeyOrJwk, format: 'jwk' }) : publicKeyOrJwk; } catch { return fail('bad_key'); }
  let sigOk = false;
  try { sigOk = crypto.verify(null, Buffer.from(parts[0]), key, fromB64u(parts[1])); } catch { sigOk = false; }
  if (!sigOk) return fail('bad_signature');
  let p;
  try { p = parseB64uJson(parts[0]); } catch { return fail('malformed'); }
  if (p.typ !== TOKEN_TYP) return fail('wrong_type');
  const t = Math.floor(now / 1000);
  if (typeof p.exp !== 'number' || t > p.exp + leewaySec) return fail('expired');
  if (typeof p.iat !== 'number' || p.iat > t + leewaySec) return fail('not_yet_valid');
  if (reference !== undefined && p.ref !== reference) return fail('reference_mismatch');
  if (attribute !== undefined && p.att !== attribute) return fail('attribute_mismatch');
  return { valid: p.res === true, reason: p.res === true ? null : 'result_false', payload: p };
}

/** Legacy v0.1 HMAC tokens (base64url JSON with "signature"). */
function verifyLegacyHmac(token, secret) {
  let data;
  try { data = parseB64uJson(token); } catch { return { valid: false, reason: 'malformed' }; }
  if (!data || typeof data.signature !== 'string') return { valid: false, reason: 'malformed' };
  const { signature, ...att } = data;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(att)).digest('hex');
  const ok = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return { valid: ok && att.result === true, reason: ok ? null : 'bad_signature', payload: att, legacy: true };
}

module.exports = { TOKEN_TYP, DEFAULT_KID, keyPairFromSeed, generateKeyPair, publicJwk, jwks, loadSigningKey, signAttestation, verifyAttestation, verifyLegacyHmac };
