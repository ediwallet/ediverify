# Changelog

## 0.2.0 (2026-10-23)
- Ed25519 boolean attestation tokens (compact `payload.signature`), JWKS endpoint `/.well-known/jwks.json`.
- OpenID4VP authorization request builder: `dcql_query` + `presentation_definition`, `direct_post`, `x509_san_dns`.
- SD-JWT VC verifier: ES256/EdDSA issuer signature, `_sd` digest matching, key binding JWT, zero-PII output.
- API actions `verify_sdjwt`, `issue_test_sdjwt` (sandbox), `jwks`; v0.1 HMAC tokens still accepted by `verify_token`.
- Sandbox / self-hosted / managed plans; hosted service returns 402 for unsubscribed `live_` keys.
- WooCommerce plugin 1.2.0: offline Ed25519 verification with libsodium, API fallback.
- `npm test`: 35 tests with `node --test`.

## 0.1.0 (2026-10-23)
- First prototype: API, widget.js, WooCommerce plugin.
