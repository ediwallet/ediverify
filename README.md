# EdiVerify Open RP Bridge

Zero-PII Relying Party connector for the EU Digital Identity (EUDI) Wallet and the Dutch NL Wallet, with ready-made plugins for web shops.

Status: **v0.1.0, prototype**. The HTTP API, the browser widget and the WooCommerce plugin work end-to-end. The wallet step itself is **simulated**: no OpenID4VP or mdoc presentation is verified yet. That is the work described in [ROADMAP.md](ROADMAP.md).

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

1. **verifier-bridge** (`packages/verifier-api`): a small stateless HTTP service. It creates a presentation request, verifies the wallet response, and returns a signed boolean attestation token. It stores no personal data. Today the token is HMAC-SHA256 signed; Ed25519 is planned so shops can verify offline with a public key.
2. **widget** (`packages/widget-sdk/widget.js`): one script tag, opens a checkout modal, returns the token through `onVerified`.
3. **ediverify-for-woocommerce** (`packages/woocommerce-plugin`): blocks checkout for configured products until a valid token is present, optionally verifies it server-side with `wp_remote_post`, and stores only a reference number on the order.

### API (v0.1.0)

| Call | Result |
|---|---|
| `POST /api/v1/verifications` `{check, methods, reference, merchant, redirectUrl}` | new verification, `status: pending` |
| `POST /api/v1/verifications` `{action: "verify", id, check}` | `status: verified`, signed attestation + `token` (demo: wallet step simulated) |
| `POST /api/v1/verifications` `{action: "verify_token", token}` (or `inspect`) | `{valid, signatureValid, fresh, attribute, result}` |

Checks: `age_over_18`, `driving_license_b`, `id_verification`, `kyc_sign`. Set `EDIVERIFY_SIGNING_SECRET` in production.

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

EdiVerify Open RP Bridge is een open-source koppeling tussen webwinkels en de NL Wallet / Europese EDI-wallets. De winkel vraagt alleen wat nodig is (bijvoorbeeld "ouder dan 18") en krijgt een ondertekend ja/nee terug, zonder paspoortkopieën of andere persoonsgegevens op te slaan. Versie 0.1.0 is een werkend prototype van de API, widget en WooCommerce-plugin; de echte wallet-verificatie (OpenID4VP, mdoc, SD-JWT VC) wordt gebouwd volgens [ROADMAP.md](ROADMAP.md). Alle code is vrij te gebruiken en zelf te hosten; Matineus biedt daarnaast optioneel een beheerde dienst op ediverify.nl.

## Licence
Apache-2.0 for the bridge and widget, GPL-2.0-or-later for the WordPress plugin. See [LICENSE](LICENSE). Copyright 2026 Matineus (KvK 86555219).
