# Roadmap

## Done in v0.2.0 (own funds)
- Ed25519 boolean tokens + JWKS, PHP offline verification in the WooCommerce plugin.
- OpenID4VP request builder (DCQL + presentation_definition).
- SD-JWT VC verifier with key binding, test suite.

## Planned with NLnet

Planned work for the NLnet Restack proposal. Budget: EUR 35,000 = 437.5 hours at EUR 80/hour.

| # | Milestone | Hours | EUR |
|---|---|---:|---:|
| M1 | OpenID4VP verifier core | 100 | 8,000 |
| M2 | ISO/IEC 18013-5 mdoc verification | 100 | 8,000 |
| M3 | SD-JWT VC hardening + token spec | 80 | 6,400 |
| M4 | Shop plugins: WooCommerce, OpenCart, PrestaShop + widget 1.0 | 97.5 | 7,800 |
| M5 | Test suite against the Dutch reference wallet, security audit fixes, docs | 60 | 4,800 |
| | **Total** | **437.5** | **35,000** |

## M1 OpenID4VP verifier core (100 h)
- Presentation request creation (DCQL / presentation definition), `request_uri` with signed request object (JAR), `direct_post` response mode.
- Same-device and cross-device (QR) flows.
- Relying-party access certificate handling (WRPAC) and registration data (WRPRC) as required for relying parties under eIDAS 2.0.
- Deliverable: bridge completes a real OpenID4VP flow against a test wallet.

## M2 ISO/IEC 18013-5 mdoc (100 h)
- CBOR/COSE parsing of DeviceResponse, MSO validation, issuer certificate chain against a trust list, device authentication, value digest checks.
- Selective disclosure of `age_over_18` and driving licence privileges (mDL).
- Deliverable: verified mdoc presentations, test vectors published.

## M3 SD-JWT VC hardening + token spec (80 h)
- Extend the v0.2 verifier: status list revocation, issuer metadata and x5c chains, type metadata, conformance against the official test vectors.
- Formal token specification, key rotation, reference verifiers in JavaScript and PHP.
- Deliverable: token spec + reference verifiers in JavaScript and PHP.

## M4 Plugins + widget 1.0 (97.5 h)
- WooCommerce plugin 2.0 (Ed25519 verification, block checkout support), new OpenCart and PrestaShop modules.
- Widget accessibility (WCAG 2.2 AA) and translations (NL, EN, DE, FR).
- Deliverable: plugins published in the official plugin directories.

## M5 Test suite, audit, docs (60 h)
- Interop test suite against the Dutch reference wallet implementation and the EU reference wallet.
- Process findings of the NLnet-arranged security audit.
- Self-hosting guide, Docker image, reproducible release.
