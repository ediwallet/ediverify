# EdiVerify Open RP Bridge

Zero-PII Relying Party connector for the EU Digital Identity (EUDI) Wallet and the Dutch NL Wallet, with ready-made plugins for web shops.

Status: **v0.2.0**. Working today, with tests (`npm test`, Node.js 18+, zero dependencies):

- **Ed25519 boolean attestation tokens** (`node:crypto`), public key as OKP JWK at `https://ediverify.nl/.well-known/jwks.json`, offline verifiable in PHP with `sodium_crypto_sign_verify_detached`.
- **OpenID4VP authorization request builder** with `dcql_query` and DIF Presentation Exchange `presentation_definition` for PID `age_over_18` and mDL `driving_privileges`, `direct_post`, `x509_san_dns`.
- **SD-JWT VC verifier**: issuer signature (ES256 / EdDSA), disclosure digests against `_sd`, key binding JWT (nonce, aud, sd_hash), returns only a boolean.

Not done yet (see [ROADMAP.md](ROADMAP.md)): ISO/IEC 18013-5 mdoc (CBOR/COSE), certificate chain and trust list validation, WRPAC/WRPRC handling, interop tests against real wallets. The hosted demo issues sandbox credentials from a test issuer; no real wallet is connected yet.

Live demo: https://ediverify.nl · Source overview: https://ediverify.nl/open-source/

## English

### What problem does this solve?
Shops that sell alcohol, tobacco or vapes, and rental companies that need a valid driving licence, today either do no real check or upload passport scans to a commercial ID scanner. Both are bad: the first is not compliant, the second spreads copies of identity documents across many servers.

The EUDI Wallet (eIDAS 2.0) and the NL Wallet make it possible to ask for one attribute, such as `age_over_18`, and get a cryptographic answer. In practice a small shop on WooCommerce cannot implement OpenID4VP, ISO/IEC 18013-5 mdoc and SD-JWT VC verification and relying-party certificate handling by itself.

### Architecture

```
 Shop checkout ──► widget.js ──► Verifier bridge ──OpenID4VP──► EUDI / NL Wallet
       ▲                              │  verifies mdoc (CBOR/COSE) or SD-JWT VC
       │                              │  checks issuer trust + RP certificate
       └──── boolean attestation ◄────┘  discards all attributes except the answer
             { attribute: "age_over_18", result: true, signature }
```

1. **verifier-bridge** (`packages/verifier-api`): a small stateless HTTP service. It creates an OpenID4VP request, verifies the wallet response (SD-JWT VC today, mdoc planned) and returns an Ed25519-signed boolean attestation token. It stores no personal data. Modules in `api/_lib/`: `crypto-core.js` (Ed25519, JWKS), `openid4vp.js`, `sdjwt.js`, `plans.js`.
2. **widget** (`packages/widget-sdk/widget.js`): one script tag, opens a checkout modal, returns the token through `onVerified`.
3. **ediverify-for-woocommerce** (`packages/woocommerce-plugin`): blocks checkout for configured products until a valid token is present, optionally verifies it server-side with `wp_remote_post`, and stores only a reference number on the order.

### API (v0.2.0)

`POST /api/v1/verifications` with JSON body (or GET with query parameters):

| `action` | Result |
|---|---|
| *(none)* `{check, methods, reference, merchant}` | new verification + `openid4vpRequest` + `openid4vpDeepLink` |
| `verify` `{id, check, reference}` | sandbox only: simulated wallet step, Ed25519 `token` |
| `issue_test_sdjwt` `{nonce, disclose?: "all"}` | sandbox only: SD-JWT VC presentation from a fictitious test PID |
| `verify_sdjwt` `{sd_jwt, nonce, reference}` | verifies the SD-JWT VC, returns `result` + Ed25519 `token` |
| `verify_token` `{token, reference?}` | `{valid, reason, attribute, result, environment}` (also accepts v0.1 HMAC tokens) |
| `jwks` | public keys, also at `/.well-known/jwks.json` |

Token: `base64url(payload).base64url(ed25519_signature)`, payload `{typ:"ediverify-attestation+v1", iss, kid, vid, att, res, ref, env, mth, iat, exp, jti}`. No claim values ever.

Environment variables: `EDIVERIFY_ED25519_SEED` (32 bytes hex), `EDIVERIFY_ED25519_KID`, `EDIVERIFY_HOSTED`, `EDIVERIFY_LIVE_KEY_HASHES`.

### Sandbox, self-hosted and managed
- No key or `test_` key: **sandbox**, free, tokens carry `env: "sandbox"`.
- `live_` key on your own deployment: **self-hosted production**. No limits in the code; you bring your own relying party certificate and keys.
- `live_` key on the hosted ediverify.nl service (`EDIVERIFY_HOSTED=1`): must belong to an active managed subscription, otherwise `402 managed_subscription_required`.

### Open core
Everything in this repository is free software and can be self-hosted: the verifier bridge, the widget and the shop plugins. Matineus also runs an optional managed service on ediverify.nl for shops that do not want to run a server or handle the relying-party registration and certificates themselves. The managed service uses the same code; there is no closed "enterprise" fork.

### Quick start
```html
<script src="https://ediverify.nl/widget.js"></script>
<script>
EdiVerify.open({ check: 'age_over_18', merchant: 'My Shop', reference: 'ORDER-123',
  onVerified: (r) => { /* send r.token to your server and verify it */ } });
</script>
```
Self-host the API: deploy `packages/verifier-api` to any Node.js serverless platform (the handler is a plain `(req, res)` function).

## Nederlands

EdiVerify Open RP Bridge is een open-source koppeling tussen webwinkels en de NL Wallet / Europese EDI-wallets. De winkel vraagt alleen wat nodig is (bijvoorbeeld "ouder dan 18") en krijgt een ondertekend ja/nee terug, zonder paspoortkopieën of andere persoonsgegevens op te slaan. Versie 0.2.0 bevat werkende Ed25519-tokens, een OpenID4VP-verzoekbouwer en een SD-JWT VC-verifier met tests. mdoc, certificaatketens en interoperabiliteitstests met echte wallets volgen volgens [ROADMAP.md](ROADMAP.md). Alle code is vrij te gebruiken en zelf te hosten; Matineus biedt daarnaast optioneel een beheerde dienst op ediverify.nl.

## Tests

```
npm test
```
35 tests: Ed25519 tokens (mutation, expiry, replay), OpenID4VP requests, SD-JWT VC (forged and stripped disclosures, nonce/aud/key binding), zero-PII, plans.

## Licence
Apache-2.0 for the bridge and widget, GPL-2.0-or-later for the WordPress plugin. See [LICENSING.md](LICENSING.md). Copyright 2026 Matineus (KvK 86555219).
