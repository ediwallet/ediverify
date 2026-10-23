/*! EdiVerify Checkout Widget v1.0.0 | MIT | https://ediverify.vercel.app */
(function (w, d) {
  'use strict';
  var script = d.currentScript;
  var BASE = (script && script.src) ? script.src.replace(/\/widget\.js.*$/, '') : 'https://ediverify.vercel.app';
  var API = BASE + '/api/v1/verifications';
  var LABELS = { age_over_18: 'Leeftijd 18+', driving_license_b: 'Rijbewijs B', id_verification: 'Identiteit', kyc_sign: 'Identiteit + ondertekening' };
  var METHODS = [['nl_wallet', 'NL Wallet (Rijksoverheid)', 'Direct verifiëren zonder gegevensopslag'], ['idin', 'iDIN (Via je eigen bank)', 'ING, Rabobank, ABN AMRO, SNS, ASN'], ['yivi', 'Yivi Wallet', 'Privacy-vriendelijke verificatie']];
  var CSS = '.evw-o{position:fixed;inset:0;background:rgba(12,13,14,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:2147483000;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif}' +
    '.evw-m{background:#fff;border-radius:16px;width:100%;max-width:420px;max-height:calc(100vh - 32px);overflow:auto;box-shadow:0 24px 60px -20px rgba(12,13,14,.35);color:#4b5563;font-size:15px;line-height:1.5}' +
    '.evw-h{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid #e5e7eb}.evw-h b{color:#0c0d0e;font-size:16px}.evw-x{border:0;background:none;font-size:22px;cursor:pointer;color:#6b7280;width:40px;height:40px}' +
    '.evw-b{padding:22px}.evw-t{color:#0c0d0e;font-weight:600;margin:0 0 10px}.evw-me{display:flex;gap:12px;align-items:center;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-bottom:10px;cursor:pointer;min-height:64px}' +
    '.evw-me.on{border-color:#0052ff;box-shadow:0 0 0 1px #0052ff}.evw-me b{display:block;color:#0c0d0e}.evw-me small{font-size:13px}.evw-r{margin-left:auto;flex:none;width:18px;height:18px;border-radius:50%;border:1.5px solid #d1d5db}.evw-me.on .evw-r{border:5px solid #0052ff}' +
    '.evw-btn{display:flex;width:100%;justify-content:center;align-items:center;min-height:48px;border-radius:999px;border:0;background:#0c0d0e;color:#fff;font:600 15px inherit;font-family:inherit;cursor:pointer;margin-top:8px}.evw-btn:disabled{opacity:.6}' +
    '.evw-c{text-align:center}.evw-ok{width:56px;height:56px;border-radius:50%;background:#ecfdf5;color:#059669;display:grid;place-items:center;margin:0 auto 12px;font-size:28px}.evw-f{font-size:12px;text-align:center;margin-top:12px;color:#6b7280}.evw-e{color:#b91c1c;font-size:14px;margin-top:8px}';
  function el(h) { var t = d.createElement('div'); t.innerHTML = h; return t.firstChild; }
  function api(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function qr(seed) {
    var s = '', h = 0, i, j; for (i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    for (i = 0; i < 21; i++) for (j = 0; j < 21; j++) {
      var f = (i < 7 && j < 7) || (i < 7 && j > 13) || (i > 13 && j < 7), a = i % 14, b = j % 14;
      var on = f ? (a === 0 || a === 6 || b === 0 || b === 6 || (a > 1 && a < 5 && b > 1 && b < 5)) : (((i * 7 + j * 13 + i * j + h) % 3) === 0);
      if (on) s += '<rect x="' + j + '" y="' + i + '" width="1" height="1"/>';
    }
    return '<svg viewBox="0 0 21 21" width="150" height="150" fill="#0c0d0e" shape-rendering="crispEdges" style="display:block;margin:16px auto">' + s + '</svg>';
  }
  function open(opts) {
    opts = opts || {};
    var check = opts.check || 'age_over_18', sel = 0, ver = null;
    if (!d.getElementById('evw-css')) { var st = d.createElement('style'); st.id = 'evw-css'; st.textContent = CSS; d.head.appendChild(st); }
    var o = el('<div class="evw-o" role="dialog" aria-modal="true" aria-label="Verificatie"><div class="evw-m"><div class="evw-h"><b>' + (opts.merchant || 'Verificatie') + '</b><button class="evw-x" aria-label="Sluiten">&times;</button></div><div class="evw-b"></div></div></div>');
    var body = o.querySelector('.evw-b');
    function close() { o.remove(); if (opts.onClose) opts.onClose(); }
    o.querySelector('.evw-x').onclick = close; o.onclick = function (e) { if (e.target === o) close(); };
    function step1() {
      body.innerHTML = '<p class="evw-t">Bevestig: ' + (LABELS[check] || check) + '</p>' + METHODS.map(function (m, i) { return '<div class="evw-me' + (i === sel ? ' on' : '') + '" data-i="' + i + '" tabindex="0"><div><b>' + m[1] + '</b><small>' + m[2] + '</small></div><span class="evw-r"></span></div>'; }).join('') + '<button class="evw-btn">Verifiëren met ' + METHODS[sel][1].split(' (')[0] + '</button><div class="evw-e"></div><p class="evw-f">Beveiligd door EdiVerify · Geen opslag van persoonsgegevens</p>';
      [].forEach.call(body.querySelectorAll('.evw-me'), function (n) { n.onclick = function () { sel = +n.getAttribute('data-i'); step1(); }; });
      var btn = body.querySelector('.evw-btn');
      btn.onclick = function () {
        btn.disabled = true; btn.textContent = 'Even geduld…';
        api({ check: check, methods: [METHODS[sel][0]], reference: opts.reference, merchant: opts.merchant }).then(function (v) { ver = v; step2(); })
          .catch(function (e) { btn.disabled = false; btn.textContent = 'Opnieuw proberen'; body.querySelector('.evw-e').textContent = 'Verbinding mislukt (' + e.message + ').'; if (opts.onError) opts.onError(e); });
      };
    }
    function step2() {
      body.innerHTML = '<div class="evw-c"><p class="evw-t">Scan met je ' + METHODS[sel][1].split(' (')[0] + '</p><p>Je deelt alleen: ' + (LABELS[check] || check) + '.</p>' + qr(ver.id) + '<button class="evw-btn">Bevestig op telefoon (demo)</button><div class="evw-e"></div></div>';
      var btn = body.querySelector('.evw-btn');
      btn.onclick = function () {
        btn.disabled = true; btn.textContent = 'Bevestigen…';
        api({ action: 'verify', id: ver.id, check: check, method: METHODS[sel][0] }).then(step3)
          .catch(function (e) { btn.disabled = false; btn.textContent = 'Opnieuw proberen'; body.querySelector('.evw-e').textContent = 'Bevestigen mislukt (' + e.message + ').'; });
      };
    }
    function step3(r) {
      body.innerHTML = '<div class="evw-c"><div class="evw-ok">&#10003;</div><p class="evw-t" style="font-size:18px">Verificatie geslaagd</p><p>' + (LABELS[check] || check) + ' bevestigd</p><p style="font-size:13px;margin-top:8px">Referentie ' + r.id + '</p><button class="evw-btn">Doorgaan</button></div>';
      body.querySelector('.evw-btn').onclick = function () { o.remove(); };
      if (opts.onVerified) opts.onVerified(r);
    }
    step1(); d.body.appendChild(o);
    return { close: close };
  }
  w.EdiVerify = { open: open, version: '1.0.0', api: API };
})(window, document);
