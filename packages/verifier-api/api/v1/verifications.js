const crypto = require('crypto');
const SECRET = process.env.EDIVERIFY_SIGNING_SECRET || 'ediverify-demo-signing-key';
const CHECKS = ['age_over_18', 'driving_license_b', 'id_verification', 'kyc_sign'];
const METHODS = ['nl_wallet', 'idin', 'yivi'];
const sign = (o) => crypto.createHmac('sha256', SECRET).update(JSON.stringify(o)).digest('hex');
const pick = (v, list, d) => (list.includes(v) ? v : d);

function parse(req) {
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const q = req.query || {};
  const g = (k) => (b[k] !== undefined ? b[k] : q[k]);
  let methods = g('methods');
  if (typeof methods === 'string') methods = methods.split(',');
  return {
    action: g('action') || (g('complete') ? 'verify' : (g('id') ? 'status' : 'create')),
    id: g('id'), check: g('check'), methods, reference: g('reference'),
    merchant: g('merchant'), redirectUrl: g('redirectUrl'), method: g('method'), token: g('token'),
  };
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

  const p = parse(req);
  const now = new Date();
  const mode = String(req.headers.authorization || '').includes('live_') ? 'live' : 'test';

  if (p.action === 'verify_token' || p.action === 'inspect') {
    let data;
    try { data = JSON.parse(Buffer.from(String(p.token || ''), 'base64url').toString('utf8')); } catch { data = null; }
    if (!data || typeof data !== 'object' || !data.signature) return res.status(400).json({ valid: false, error: 'invalid_token' });
    const { signature, ...att } = data;
    const expected = sign(att);
    const sigOk = typeof signature === 'string' && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    const ageSec = (now.getTime() - Date.parse(att.issuedAt)) / 1000;
    const fresh = Number.isFinite(ageSec) && ageSec >= -60 && ageSec <= 3600;
    const valid = sigOk && fresh && att.result === true;
    return res.status(200).json({ object: 'token_verification', valid, signatureValid: sigOk, fresh, attribute: att.attribute, result: att.result, verificationId: att.verificationId, issuedAt: att.issuedAt, piiStored: 'none' });
  }

  if (p.action === 'verify') {
    if (!p.id || !/^ver_[0-9a-f]{24}$/.test(p.id)) return res.status(400).json({ error: 'invalid_id', message: 'Geef een geldig id (ver_...) mee.' });
    const check = pick(p.check, CHECKS, 'age_over_18');
    const attestation = { verificationId: p.id, attribute: check, result: true, method: pick(p.method, METHODS, 'nl_wallet'), issuedAt: now.toISOString() };
    const signature = sign(attestation);
    return res.status(200).json({
      id: p.id, object: 'verification', mode, status: 'verified', result: true, attribute: check,
      piiStored: 'none', zeroPersistence: true, verifiedAt: now.toISOString(),
      attestation: { ...attestation, alg: 'HS256', signature },
      token: Buffer.from(JSON.stringify({ ...attestation, signature })).toString('base64url'),
    });
  }

  if (p.action === 'status') {
    return res.status(200).json({ id: p.id, object: 'verification', mode, status: 'pending', hint: 'Voeg complete=1 toe of POST action:"verify" om af te ronden.' });
  }

  const id = 'ver_' + crypto.randomBytes(12).toString('hex');
  const check = pick(p.check, CHECKS, 'age_over_18');
  const methods = (Array.isArray(p.methods) ? p.methods : METHODS).filter((m) => METHODS.includes(m));
  const preview = { verificationId: id, attribute: check, result: null, createdAt: now.toISOString() };
  return res.status(req.method === 'POST' ? 201 : 200).json({
    id, object: 'verification', mode, status: 'pending', check,
    methods: methods.length ? methods : METHODS,
    reference: p.reference || null, merchant: p.merchant || null, redirectUrl: p.redirectUrl || null,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(),
    zeroPersistence: true, checkoutUrl: 'https://ediverify.nl/?verify=' + id,
    attestationPreview: { ...preview, alg: 'HS256', digest: crypto.createHash('sha256').update(JSON.stringify(preview)).digest('hex'), signature: sign(preview) },
    _links: { verify: { method: 'POST', href: '/api/v1/verifications', body: { action: 'verify', id, check } } },
  });
};
