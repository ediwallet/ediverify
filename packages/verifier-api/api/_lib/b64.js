'use strict';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');
const jsonB64u = (o) => b64u(JSON.stringify(o));
const parseB64uJson = (s) => JSON.parse(fromB64u(s).toString('utf8'));
module.exports = { b64u, fromB64u, jsonB64u, parseB64uJson };
