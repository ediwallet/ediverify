'use strict';
// OpenID4VP authorization request builder (DCQL + DIF Presentation Exchange v2 presentation_definition).
const crypto = require('node:crypto');
const { b64u } = require('./b64');

const PID_DOCTYPE = 'eu.europa.ec.eudi.pid.1';
const MDL_DOCTYPE = 'org.iso.18013.5.1.mDL';
const PID_SDJWT_VCT = 'urn:eudi:pid:1';

/** Which single claim each check needs. Nothing else is ever requested. */
const CHECKS = {
  age_over_18: { mdoc: { doctype: PID_DOCTYPE, namespace: PID_DOCTYPE, claim: 'age_over_18' }, sdjwt: { vct: PID_SDJWT_VCT, path: ['age_equivalent', 'over_18'], alt: ['age_over_18'] }, purpose: 'Leeftijdscontrole 18+' },
  driving_license_b: { mdoc: { doctype: MDL_DOCTYPE, namespace: 'org.iso.18013.5.1', claim: 'driving_privileges' }, sdjwt: null, purpose: 'Controle rijbewijs categorie B' },
  id_verification: { mdoc: { doctype: PID_DOCTYPE, namespace: PID_DOCTYPE, claim: 'age_over_18' }, sdjwt: { vct: PID_SDJWT_VCT, path: ['age_equivalent', 'over_18'], alt: ['age_over_18'] }, purpose: 'Identiteitscontrole via geldige PID' },
};

function dcqlQuery(check) {
  const c = CHECKS[check];
  if (!c) throw new Error('unknown check ' + check);
  const credentials = [{
    id: 'mdoc_' + check, format: 'mso_mdoc',
    meta: { doctype_value: c.mdoc.doctype },
    claims: [{ id: 'c1', path: [c.mdoc.namespace, c.mdoc.claim], intent_to_retain: false }],
  }];
  if (c.sdjwt) credentials.push({
    id: 'sdjwt_' + check, format: 'dc+sd-jwt',
    meta: { vct_values: [c.sdjwt.vct] },
    claims: [{ id: 'c1', path: c.sdjwt.path }],
  });
  return { credentials, credential_sets: [{ options: credentials.map((x) => [x.id]), required: true, purpose: c.purpose }] };
}

function presentationDefinition(check) {
  const c = CHECKS[check];
  if (!c) throw new Error('unknown check ' + check);
  const ns = c.mdoc.namespace;
  return {
    id: 'ediverify-' + check,
    purpose: c.purpose,
    input_descriptors: [{
      id: c.mdoc.doctype,
      format: { mso_mdoc: { alg: ['ES256', 'ES384', 'EdDSA'] } },
      constraints: {
        limit_disclosure: 'required',
        fields: [{ path: [`$['${ns}']['${c.mdoc.claim}']`], intent_to_retain: false }],
      },
    }],
  };
}

/**
 * Build an OpenID4VP authorization request object plus deep link.
 * clientId is the DNS name in the relying party access certificate (x509_san_dns).
 */
function buildAuthorizationRequest({ check, clientId = 'ediverify.nl', responseUri, requestUri, nonce, state } = {}) {
  nonce = nonce || b64u(crypto.randomBytes(16));
  state = state || b64u(crypto.randomBytes(16));
  const request = {
    response_type: 'vp_token',
    response_mode: 'direct_post',
    client_id: 'x509_san_dns:' + clientId,
    client_id_scheme: 'x509_san_dns',
    response_uri: responseUri || `https://${clientId}/api/v1/verifications?action=response`,
    nonce, state,
    dcql_query: dcqlQuery(check),
    presentation_definition: presentationDefinition(check),
    client_metadata: { vp_formats: { mso_mdoc: { alg: ['ES256', 'ES384', 'EdDSA'] }, 'dc+sd-jwt': { 'sd-jwt_alg_values': ['ES256', 'EdDSA'], 'kb-jwt_alg_values': ['ES256', 'EdDSA'] } } },
  };
  const q = new URLSearchParams({ client_id: request.client_id });
  if (requestUri) q.set('request_uri', requestUri);
  else q.set('request', JSON.stringify(request));
  return { request, deepLink: 'openid4vp://?' + q.toString(), nonce, state };
}

module.exports = { CHECKS, PID_DOCTYPE, MDL_DOCTYPE, PID_SDJWT_VCT, dcqlQuery, presentationDefinition, buildAuthorizationRequest };
