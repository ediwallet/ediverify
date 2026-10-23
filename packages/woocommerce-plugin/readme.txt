=== EdiVerify for WooCommerce ===
Contributors: matineus
Tags: age verification, woocommerce, nl wallet, idin, eidas
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 7.4
Requires Plugins: woocommerce
Stable tag: 1.2.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Leeftijds- en ID-verificatie via NL Wallet, Europese EDI-wallets, iDIN en Yivi in je WooCommerce checkout, zonder opslag van persoonsgegevens.

== Description ==

EdiVerify voegt een verplichte verificatiestap toe aan de WooCommerce checkout. De klant bevestigt met NL Wallet, iDIN of Yivi en de winkel ontvangt alleen een ondertekende ja/nee-attestatie (bijv. `age_over_18 = true`).

* 18+ Leeftijdscheck, ID-verificatie of Rijbewijs B
* Toepassen op alle producten of alleen op geselecteerde categorieën/producten
* Bestelling wordt geblokkeerd tot de verificatie geslaagd is
* Bij de order wordt alleen het referentienummer opgeslagen: "18+ Geverifieerd (Geen persoonsgegevens opgeslagen)"

Gemaakt door Matineus (KvK 86555219).

== External services ==

Deze plugin laadt `https://ediverify.nl/widget.js` op de checkoutpagina en roept `https://ediverify.nl/api/v1/verifications` aan om een verificatie te starten en af te ronden, en (optioneel) vanaf de server om de handtekening van het token te controleren. Er worden geen naam-, adres- of documentgegevens verstuurd; alleen het type controle, de winkelnaam en een orderreferentie.

== Installation ==

1. Upload de zip via Plugins → Nieuwe plugin → Plugin uploaden en activeer de plugin.
2. Ga naar WooCommerce → Instellingen → EdiVerify.
3. Vul je API-sleutel in (`test_...` of `live_...`), kies de controle en waarop die van toepassing is.

== Frequently Asked Questions ==

= Worden er persoonsgegevens opgeslagen? =
Nee. Alleen een referentienummer en de uitkomst van de controle.

== Changelog ==

= 1.2.0 =
* Offline Ed25519-controle van het token met sodium_crypto_sign_verify_detached (PHP 7.2+), API alleen als fallback.
* Instelbare publieke sleutel voor zelf-hosters.
* live_-sleutels accepteren geen sandbox-attestaties.

= 1.1.0 =
* Optionele server-side controle van de token-handtekening via wp_remote_post (action=verify_token).
* Instelbaar API-adres voor een zelf-gehoste verifier-bridge.


= 1.0.0 =
* Eerste release.
