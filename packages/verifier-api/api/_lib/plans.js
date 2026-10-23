'use strict';
// Separation between the free self-hosted / sandbox mode and the paid managed service.
// The open source code has no artificial limits: self-hosters set EDIVERIFY_HOSTED unset (default) and run
// in "self_hosted" mode with their own keys and certificates. Only the hosted ediverify.nl instance sets
// EDIVERIFY_HOSTED=1, where live_ keys must belong to an active managed subscription.
const crypto = require('node:crypto');

function bearer(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Returns { environment, plan, error? }.
 * environment: "sandbox" | "production"; plan: "sandbox" | "self_hosted" | "managed".
 */
function resolvePlan(req, env = process.env) {
  const key = bearer(req) || null;
  const hosted = env.EDIVERIFY_HOSTED === '1';
  if (!key || key.startsWith('test_')) return { environment: 'sandbox', plan: 'sandbox' };
  if (!key.startsWith('live_')) return { environment: 'sandbox', plan: 'sandbox', error: { status: 401, code: 'invalid_api_key', message: 'API-sleutel moet beginnen met live_ of test_.' } };
  if (!hosted) return { environment: 'production', plan: 'self_hosted' };
  const allowed = String(env.EDIVERIFY_LIVE_KEY_HASHES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(sha256(key))) return { environment: 'production', plan: 'managed' };
  return {
    environment: 'production', plan: 'managed',
    error: { status: 402, code: 'managed_subscription_required', message: 'Active Managed Subscription Required. Productie-checks op ediverify.nl vereisen een actief EdiVerify Managed Cloud-abonnement. Gebruik een test_-sleutel voor de sandbox, of host de open-source verifier zelf.' },
  };
}

module.exports = { resolvePlan, bearer, sha256 };
