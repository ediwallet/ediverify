<?php
/**
 * Plugin Name:       EdiVerify for WooCommerce
 * Plugin URI:        https://ediverify.nl/
 * Description:       Leeftijds- en ID-verificatie via NL Wallet, Europese EDI-wallets, iDIN en Yivi in de WooCommerce checkout. Slaat geen persoonsgegevens op.
 * Version:           1.2.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Matineus (KvK 86555219)
 * Author URI:        https://ediverify.nl/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       ediverify-woocommerce
 * WC requires at least: 7.0
 * WC tested up to:   9.4
 */

defined( 'ABSPATH' ) || exit;

define( 'EDIVERIFY_WC_VERSION', '1.2.0' );
define( 'EDIVERIFY_WC_BASE', 'https://ediverify.nl' );
// Public Ed25519 key of the hosted service (kid ediverify-ed25519-2026-01), see https://ediverify.nl/.well-known/jwks.json
define( 'EDIVERIFY_WC_DEFAULT_ED25519_X', 'nSR6nXBnQUEoLSUzPSi6C94yrCeZIPQkIJsNOHzQShc' );

add_action( 'before_woocommerce_init', function () {
	if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
	}
} );

final class EdiVerify_WC {

	const CHECKS = array(
		'age_over_18'       => '18+ Leeftijdscheck',
		'id_verification'   => 'ID-verificatie',
		'driving_license_b' => 'Rijbewijs B',
	);

	public static function init() {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', function () {
				echo '<div class="notice notice-error"><p>' . esc_html__( 'EdiVerify vereist WooCommerce.', 'ediverify-woocommerce' ) . '</p></div>';
			} );
			return;
		}
		add_filter( 'woocommerce_settings_tabs_array', array( __CLASS__, 'add_tab' ), 50 );
		add_action( 'woocommerce_settings_tabs_ediverify', array( __CLASS__, 'render_settings' ) );
		add_action( 'woocommerce_update_options_ediverify', array( __CLASS__, 'save_settings' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'woocommerce_review_order_before_submit', array( __CLASS__, 'checkout_field' ) );
		add_action( 'woocommerce_checkout_process', array( __CLASS__, 'validate' ) );
		add_action( 'woocommerce_checkout_create_order', array( __CLASS__, 'save_to_order' ), 10, 2 );
		add_action( 'woocommerce_admin_order_data_after_billing_address', array( __CLASS__, 'admin_order_note' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
			array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=wc-settings&tab=ediverify' ) ) . '">' . esc_html__( 'Instellingen', 'ediverify-woocommerce' ) . '</a>' );
			return $links;
		} );
	}

	public static function add_tab( $tabs ) {
		$tabs['ediverify'] = __( 'EdiVerify', 'ediverify-woocommerce' );
		return $tabs;
	}

	public static function settings() {
		$cats = array();
		foreach ( get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false ) ) as $t ) {
			if ( ! is_wp_error( $t ) ) {
				$cats[ $t->term_id ] = $t->name;
			}
		}
		return array(
			array( 'title' => __( 'EdiVerify', 'ediverify-woocommerce' ), 'type' => 'title', 'desc' => __( 'Verifieer leeftijd of identiteit in de checkout zonder persoonsgegevens op te slaan.', 'ediverify-woocommerce' ), 'id' => 'ediverify_section' ),
			array( 'title' => __( 'API-sleutel', 'ediverify-woocommerce' ), 'id' => 'ediverify_api_key', 'type' => 'password', 'desc' => __( 'Begint met live_ of test_.', 'ediverify-woocommerce' ), 'default' => 'test_' ),
			array( 'title' => __( 'Verplichte controle', 'ediverify-woocommerce' ), 'id' => 'ediverify_check', 'type' => 'select', 'options' => self::CHECKS, 'default' => 'age_over_18' ),
			array( 'title' => __( 'Toepassen op', 'ediverify-woocommerce' ), 'id' => 'ediverify_scope', 'type' => 'select', 'options' => array( 'all' => __( 'Alle producten', 'ediverify-woocommerce' ), 'selected' => __( 'Alleen geselecteerde categorieën of producten', 'ediverify-woocommerce' ) ), 'default' => 'all' ),
			array( 'title' => __( '18+ categorieën', 'ediverify-woocommerce' ), 'id' => 'ediverify_categories', 'type' => 'multiselect', 'class' => 'wc-enhanced-select', 'options' => $cats, 'default' => array() ),
			array( 'title' => __( 'Product-ID\'s', 'ediverify-woocommerce' ), 'id' => 'ediverify_products', 'type' => 'text', 'desc' => __( 'Kommagescheiden, bijv. 12,45,98', 'ediverify-woocommerce' ), 'default' => '' ),
			array( 'title' => __( 'Ed25519 publieke sleutel', 'ediverify-woocommerce' ), 'id' => 'ediverify_ed25519_x', 'type' => 'text', 'desc' => __( 'Waarde "x" uit /.well-known/jwks.json (base64url). Leeg = sleutel van ediverify.nl. Zelf-hosters vullen hier hun eigen sleutel in.', 'ediverify-woocommerce' ), 'default' => '' ),
			array( 'title' => __( 'Server-side controle', 'ediverify-woocommerce' ), 'id' => 'ediverify_remote_verify', 'type' => 'select', 'options' => array( 'fallback' => __( 'Alleen als offline Ed25519-controle niet mogelijk is (aanbevolen)', 'ediverify-woocommerce' ), 'always' => __( 'Altijd, naast de offline controle', 'ediverify-woocommerce' ), 'never' => __( 'Nooit', 'ediverify-woocommerce' ) ), 'default' => 'fallback' ),
			array( 'title' => __( 'API-adres', 'ediverify-woocommerce' ), 'id' => 'ediverify_api_base', 'type' => 'text', 'desc' => __( 'Laat leeg voor de gehoste dienst, of vul het adres van je eigen verifier-bridge in.', 'ediverify-woocommerce' ), 'default' => '' ),
			array( 'type' => 'sectionend', 'id' => 'ediverify_section' ),
		);
	}

	public static function render_settings() {
		woocommerce_admin_fields( self::settings() );
	}

	public static function save_settings() {
		woocommerce_update_options( self::settings() );
	}

	public static function check() {
		$c = get_option( 'ediverify_check', 'age_over_18' );
		return isset( self::CHECKS[ $c ] ) ? $c : 'age_over_18';
	}

	public static function cart_requires_verification() {
		if ( ! WC()->cart || WC()->cart->is_empty() ) {
			return false;
		}
		if ( 'all' === get_option( 'ediverify_scope', 'all' ) ) {
			return true;
		}
		$cats = array_map( 'intval', (array) get_option( 'ediverify_categories', array() ) );
		$ids  = array_filter( array_map( 'intval', explode( ',', (string) get_option( 'ediverify_products', '' ) ) ) );
		foreach ( WC()->cart->get_cart() as $item ) {
			$pid = (int) $item['product_id'];
			if ( in_array( $pid, $ids, true ) || ( $cats && has_term( $cats, 'product_cat', $pid ) ) ) {
				return true;
			}
		}
		return false;
	}

	public static function enqueue() {
		if ( ! function_exists( 'is_checkout' ) || ! is_checkout() || ! self::cart_requires_verification() ) {
			return;
		}
		wp_enqueue_script( 'ediverify-widget', EDIVERIFY_WC_BASE . '/widget.js', array(), EDIVERIFY_WC_VERSION, true );
		$cfg = wp_json_encode( array(
			'check'    => self::check(),
			'merchant' => get_bloginfo( 'name' ),
			'label'    => self::CHECKS[ self::check() ],
		) );
		wp_add_inline_script( 'ediverify-widget', "(function(){var c={$cfg};document.addEventListener('click',function(e){var b=e.target.closest('#ediverify-start');if(!b)return;e.preventDefault();EdiVerify.open({check:c.check,merchant:c.merchant,reference:'wc-'+Date.now(),onVerified:function(r){document.getElementById('ediverify_attestation_token').value=r.token;var s=document.getElementById('ediverify-status');s.textContent=c.label+' bevestigd ('+r.id+')';s.style.color='#059669';b.style.display='none';}});});})();" );
	}

	public static function checkout_field() {
		if ( ! self::cart_requires_verification() ) {
			return;
		}
		echo '<div id="ediverify-box" style="margin:0 0 16px;padding:16px;border:1px solid #e5e7eb;border-radius:12px">';
		echo '<p style="margin:0 0 8px;font-weight:600">' . esc_html( sprintf( __( 'Voor deze bestelling is een %s vereist.', 'ediverify-woocommerce' ), self::CHECKS[ self::check() ] ) ) . '</p>';
		echo '<p id="ediverify-status" style="margin:0 0 8px">' . esc_html__( 'Verifieer met NL Wallet, iDIN of Yivi. Er worden geen persoonsgegevens opgeslagen.', 'ediverify-woocommerce' ) . '</p>';
		echo '<button type="button" class="button alt" id="ediverify-start">' . esc_html__( 'Nu verifiëren', 'ediverify-woocommerce' ) . '</button>';
		echo '<input type="hidden" name="ediverify_attestation_token" id="ediverify_attestation_token" value="" />';
		wp_nonce_field( 'ediverify_checkout', 'ediverify_nonce' );
		echo '</div>';
	}

	public static function b64url_decode( $s ) {
		$s = strtr( (string) $s, '-_', '+/' );
		$pad = strlen( $s ) % 4;
		if ( $pad ) {
			$s .= str_repeat( '=', 4 - $pad );
		}
		return base64_decode( $s, true );
	}

	public static function public_key() {
		$x = trim( (string) get_option( 'ediverify_ed25519_x', '' ) );
		$raw = self::b64url_decode( $x ? $x : EDIVERIFY_WC_DEFAULT_ED25519_X );
		return ( false !== $raw && 32 === strlen( $raw ) ) ? $raw : false;
	}

	/**
	 * Offline Ed25519 verification of a compact token "<payload_b64url>.<signature_b64url>".
	 * Returns the decoded payload array, false if invalid, or null if offline verification is not possible.
	 */
	public static function verify_ed25519( $token ) {
		$parts = explode( '.', (string) $token );
		if ( 2 !== count( $parts ) ) {
			return false;
		}
		$pk = self::public_key();
		if ( ! $pk || ! function_exists( 'sodium_crypto_sign_verify_detached' ) ) {
			return null;
		}
		$sig = self::b64url_decode( $parts[1] );
		if ( false === $sig || 64 !== strlen( $sig ) ) {
			return false;
		}
		try {
			if ( ! sodium_crypto_sign_verify_detached( $sig, $parts[0], $pk ) ) {
				return false;
			}
		} catch ( \SodiumException $e ) {
			return false;
		}
		$data = json_decode( (string) self::b64url_decode( $parts[0] ), true );
		return is_array( $data ) ? $data : false;
	}

	/** Checks the boolean attestation. Returns the verification id or false. */
	public static function validate_token( $token ) {
		static $cache = array();
		if ( isset( $cache[ $token ] ) ) {
			return $cache[ $token ];
		}
		$mode    = get_option( 'ediverify_remote_verify', 'fallback' );
		$payload = self::verify_ed25519( $token );
		if ( false === $payload ) {
			return $cache[ $token ] = false;
		}
		if ( null === $payload ) {
			// Offline not possible (no sodium or no key): fall back to the API.
			if ( 'never' === $mode ) {
				return $cache[ $token ] = false;
			}
			$remote = self::remote_verify( $token );
			if ( ! $remote ) {
				return $cache[ $token ] = false;
			}
			$payload = array( 'typ' => 'ediverify-attestation+v1', 'vid' => $remote['verificationId'], 'att' => $remote['attribute'], 'res' => $remote['result'], 'exp' => time() + 60, 'iat' => time(), 'env' => $remote['environment'] ?? '' );
		} elseif ( 'always' === $mode && ! self::remote_verify( $token ) ) {
			return $cache[ $token ] = false;
		}
		$now = time();
		$ok  = 'ediverify-attestation+v1' === ( $payload['typ'] ?? '' )
			&& true === ( $payload['res'] ?? null )
			&& self::check() === ( $payload['att'] ?? '' )
			&& isset( $payload['exp'], $payload['iat'] ) && $now <= (int) $payload['exp'] + 60 && (int) $payload['iat'] <= $now + 60
			&& preg_match( '/^ver_[0-9a-f]{24}$/', (string) ( $payload['vid'] ?? '' ) );
		// A live_ key must never accept sandbox attestations.
		if ( $ok && 0 === strpos( (string) get_option( 'ediverify_api_key', '' ), 'live_' ) && 'production' !== ( $payload['env'] ?? '' ) ) {
			$ok = false;
		}
		return $cache[ $token ] = ( $ok ? $payload['vid'] : false );
	}

	public static function api_base() {
		$base = trim( (string) get_option( 'ediverify_api_base', '' ) );
		return $base ? untrailingslashit( esc_url_raw( $base ) ) : EDIVERIFY_WC_BASE;
	}

	/** Server-side HMAC check via POST /api/v1/verifications (action=verify_token). */
	public static function remote_verify( $token ) {
		static $cache = array();
		if ( isset( $cache[ $token ] ) ) {
			return $cache[ $token ];
		}
		$resp = wp_remote_post( self::api_base() . '/api/v1/verifications', array(
			'timeout' => 8,
			'headers' => array(
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . get_option( 'ediverify_api_key', '' ),
			),
			'body'    => wp_json_encode( array( 'action' => 'verify_token', 'token' => $token ) ),
		) );
		if ( is_wp_error( $resp ) || 200 !== (int) wp_remote_retrieve_response_code( $resp ) ) {
			return $cache[ $token ] = false;
		}
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		$ok   = is_array( $body ) && true === ( $body['valid'] ?? false ) && self::check() === ( $body['attribute'] ?? '' );
		return $cache[ $token ] = ( $ok ? $body : false );
	}

	public static function validate() {
		if ( ! self::cart_requires_verification() ) {
			return;
		}
		$nonce = isset( $_POST['ediverify_nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['ediverify_nonce'] ) ) : '';
		$token = isset( $_POST['ediverify_attestation_token'] ) ? sanitize_text_field( wp_unslash( $_POST['ediverify_attestation_token'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'ediverify_checkout' ) || ! self::validate_token( $token ) ) {
			wc_add_notice( sprintf( __( 'Rond eerst de %s af met EdiVerify voordat je de bestelling plaatst.', 'ediverify-woocommerce' ), self::CHECKS[ self::check() ] ), 'error' );
		}
	}

	public static function save_to_order( $order, $data ) {
		if ( empty( $_POST['ediverify_attestation_token'] ) ) {
			return;
		}
		$ref = self::validate_token( sanitize_text_field( wp_unslash( $_POST['ediverify_attestation_token'] ) ) );
		if ( $ref ) {
			$label = 'age_over_18' === self::check() ? '18+ Geverifieerd' : self::CHECKS[ self::check() ] . ' geverifieerd';
			$order->update_meta_data( '_ediverify_ref', $ref );
			$order->update_meta_data( '_ediverify_status', $label . ' (Geen persoonsgegevens opgeslagen)' );
		}
	}

	public static function admin_order_note( $order ) {
		$ref = $order->get_meta( '_ediverify_ref' );
		if ( $ref ) {
			echo '<p><strong>EdiVerify:</strong> ' . esc_html( $order->get_meta( '_ediverify_status' ) ) . '<br>' . esc_html__( 'Referentie:', 'ediverify-woocommerce' ) . ' ' . esc_html( $ref ) . '</p>';
		}
	}
}

add_action( 'plugins_loaded', array( 'EdiVerify_WC', 'init' ) );
