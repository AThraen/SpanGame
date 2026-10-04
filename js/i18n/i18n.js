// BG.i18n — translations and number formatting (English default + Danish). See docs/I18N.md.
//
//   t(key, params)          'hud.title.play' -> "Play" / "Spil"; {name} placeholders are filled from params;
//                           a plural entry {one, other} picks its form from params.n
//   lang() / setLanguage(l) current language; setLanguage persists it (BG.Storage settings.lang), updates
//                           <html lang>, re-translates every [data-i18n] element and fires 'languagechange'
//   on('languagechange', fn) / off(...)   UI modules re-render their dynamic text in fn({ lang, prev })
//   apply(rootEl)           (re)fills [data-i18n], [data-i18n-html], [data-i18n-title|aria|tip|placeholder|alt]
//   lazy(obj, {prop: key})  turns data-table fields (chapter names, ...) into getters that translate on read
//   levelText(level, field) a level's name / hint / ...: levels.<id>.<field> when the dictionary has it, else the data
//   num / money / meters / percent / time / date   locale formatting through Intl, with a fallback
//
// Dictionaries live in js/i18n/<lang>/<area>.js and call BG.i18n.add(lang, area, {key: text}); every key starts with
// its area ("hud.", "core.", ...). Loaded before everything else (index.html, tools/harness.js), it has no
// dependencies and works in Node (no DOM: language 'en' unless set).
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const prev = BG.i18n || {};

  const LANGS = {
    // locale: numbers / plurals; dateLocale: dates (the game writes "Sat 3 Oct", day before month)
    en: { id: 'en', name: 'English', locale: 'en-US', dateLocale: 'en-GB', group: ',', decimal: '.', pctSpace: false },
    da: { id: 'da', name: 'Dansk', locale: 'da-DK', dateLocale: 'da-DK', group: '.', decimal: ',', pctSpace: true },
  };
  const ORDER = ['en', 'da'];
  const DEFAULT = 'en';

  const dict = prev.dict || {};
  ORDER.forEach(l => { dict[l] = dict[l] || {}; });
  const areas = {};            // areas[lang][area] = [keys]  (tests, docs)
  const listeners = {};        // type -> [fn]
  const warned = {};
  let cur = null;              // resolved language
  let provisional = true;      // resolved before BG.Storage was there: try again once it is

  function hasDoc() { return typeof root.document !== 'undefined' && root.document && root.document.documentElement; }
  function isDev() {
    try {
      const loc = root.location;
      if (!loc || !loc.protocol) return true;                    // Node
      if (loc.protocol === 'file:') return true;
      return /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(loc.hostname || '');
    } catch (e) { return false; }
  }
  function warnOnce(id, msg) {
    if (warned[id] || !I.dev) return;
    warned[id] = true;
    try { console.warn('[i18n] ' + msg); } catch (e) { /* */ }
  }
  function norm(l) {
    const s = String(l == null ? '' : l).toLowerCase();
    if (LANGS[s]) return s;
    const base = s.split(/[-_]/)[0];
    return LANGS[base] ? base : null;
  }
  function urlLang() {
    try { const m = /[?&]lang=([A-Za-z-]+)/.exec((root.location && root.location.search) || ''); return m ? norm(m[1]) : null; } catch (e) { return null; }
  }
  function savedLang() {
    try { const S = BG.Storage; return S && S.getSettings ? norm(S.getSettings().lang) : null; } catch (e) { return null; }
  }
  function browserLang() {
    try {
      const n = root.navigator;
      if (!n || !hasDoc()) return null;   // Node has a navigator too: the tools stay English whatever the OS locale
      const list = (n.languages && n.languages.length ? Array.from(n.languages) : []).concat(n.language ? [n.language] : []);
      // only the first preference decides (a Danish browser with English as a fallback is Danish, not the reverse)
      return list.length && /^da\b/i.test(list[0]) ? 'da' : null;
    } catch (e) { return null; }
  }
  // ?lang=da (this page only) > saved setting > navigator.language 'da*' > English
  function resolve() {
    provisional = !BG.Storage;
    return urlLang() || savedLang() || browserLang() || DEFAULT;
  }
  function lang() {
    if (!cur || (provisional && BG.Storage)) {
      const was = cur;
      cur = resolve();
      if (cur !== was) syncDocument();
    }
    return cur;
  }

  // ---------------------------------------------------------------- lookup
  function lookup(key, l) {
    const d = dict[l];
    return d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
  }
  function pluralForm(n, l) {
    const num = +n;
    try {
      if (typeof Intl !== 'undefined' && Intl.PluralRules && !I._noIntl) return new Intl.PluralRules(LANGS[l].locale).select(num);
    } catch (e) { /* fall through */ }
    return Math.abs(num) === 1 ? 'one' : 'other';
  }
  function fill(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null ? String(params[k]) : m));
  }
  function t(key, params) {
    const l = lang();
    let v = lookup(key, l);
    if (v === undefined && l !== DEFAULT) {
      v = lookup(key, DEFAULT);
      if (v !== undefined) warnOnce(l + ':' + key, 'missing "' + l + '" text for ' + key + ' (using English)');
    }
    if (v === undefined) { warnOnce('*:' + key, 'unknown key ' + key); return key; }
    if (v && typeof v === 'object') {
      const n = params && params.n != null ? params.n : 1;
      const f = pluralForm(n, l);
      v = v[f] != null ? v[f] : (v.other != null ? v.other : v.one);
    }
    return fill(String(v), params);
  }
  function has(key, l) { return lookup(key, norm(l) || lang()) !== undefined; }

  // ---------------------------------------------------------------- registration
  function add(l, area, entries) {
    l = norm(l) || l;
    dict[l] = dict[l] || {};
    areas[l] = areas[l] || {};
    const keys = areas[l][area] = areas[l][area] || [];
    for (const k in entries) {
      if (!Object.prototype.hasOwnProperty.call(entries, k)) continue;
      if (Object.prototype.hasOwnProperty.call(dict[l], k) && keys.indexOf(k) < 0) warnOnce('dup:' + l + ':' + k, 'duplicate key ' + k + ' (' + l + '/' + area + ')');
      dict[l][k] = entries[k];
      if (keys.indexOf(k) < 0) keys.push(k);
    }
  }

  // ---------------------------------------------------------------- events
  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); return () => off(type, fn); }
  function off(type, fn) { const a = listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  function emit(type, ev) {
    (listeners[type] || []).slice().forEach(fn => { try { fn(ev); } catch (e) { try { console.error(e); } catch (e2) { /* */ } } });
  }

  // ---------------------------------------------------------------- DOM
  function syncDocument() {
    if (!hasDoc()) return;
    const doc = root.document;
    try {
      doc.documentElement.lang = cur;
      if (dict[cur] && lookup('core.docTitle', cur) !== undefined) doc.title = t('core.docTitle');
    } catch (e) { /* */ }
  }
  function params(el) {
    const p = el.getAttribute('data-i18n-params');
    if (!p) return null;
    try { return JSON.parse(p); } catch (e) { return null; }
  }
  // the element's own text is replaced; child elements (icons) stay, the text goes after them
  function setOwnText(el, text) {
    if (!el.children || !el.children.length) { el.textContent = text; return; }
    Array.from(el.childNodes).forEach(n => { if (n.nodeType === 3) el.removeChild(n); });
    el.appendChild(el.ownerDocument.createTextNode(text));
  }
  const ATTRS = [['data-i18n-title', 'title'], ['data-i18n-aria', 'aria-label'], ['data-i18n-tip', 'data-tip'],
    ['data-i18n-placeholder', 'placeholder'], ['data-i18n-alt', 'alt']];
  const SEL = '[data-i18n],[data-i18n-html],' + ATTRS.map(a => '[' + a[0] + ']').join(',');
  function apply(rootEl) {
    if (!hasDoc()) return rootEl;
    const r = rootEl || root.document;
    const list = Array.from(r.querySelectorAll ? r.querySelectorAll(SEL) : []);
    if (r.matches && r.matches(SEL)) list.unshift(r);
    list.forEach(el => {
      const p = params(el);
      const k = el.getAttribute('data-i18n');
      if (k) setOwnText(el, t(k, p));
      const kh = el.getAttribute('data-i18n-html');
      if (kh) el.innerHTML = t(kh, p);
      ATTRS.forEach(([a, target]) => { const ka = el.getAttribute(a); if (ka) el.setAttribute(target, t(ka, p)); });
    });
    return rootEl;
  }

  function setLanguage(l, opts) {
    const next = norm(l);
    if (!next) return false;
    const was = lang();
    cur = next;
    provisional = false;
    if (!(opts && opts.persist === false)) {
      try { if (BG.Storage && BG.Storage.setSettings) BG.Storage.setSettings({ lang: next }); } catch (e) { /* */ }
      try { if (BG.Game && BG.Game.settings) BG.Game.settings.lang = next; } catch (e) { /* */ }
    }
    syncDocument();
    if (next !== was || (opts && opts.force)) {
      if (hasDoc()) apply(root.document);
      emit('languagechange', { lang: next, prev: was });
    }
    return true;
  }

  // ---------------------------------------------------------------- data helpers
  // obj.prop becomes a getter returning t(key) (a key may be a function returning the text); setting it overrides
  function lazy(obj, map) {
    if (!obj) return obj;
    Object.keys(map).forEach(prop => {
      const key = map[prop];
      let override;
      Object.defineProperty(obj, prop, {
        configurable: true, enumerable: true,
        get() { return override !== undefined ? override : (typeof key === 'function' ? key() : t(key)); },
        set(v) { override = v; },
      });
    });
    return obj;
  }
  // a level's text: levels.<id>.<field> from the dictionary (falls back to English, then to the level data)
  function levelText(level, field) {
    if (!level) return '';
    const raw = level[field || 'name'];
    if (level.id == null) return raw == null ? '' : raw;
    const key = 'levels.' + level.id + '.' + (field || 'name');
    const l = lang();
    let v = lookup(key, l);
    if (v === undefined) v = lookup(key, DEFAULT);
    return v === undefined ? (raw == null ? '' : raw) : String(v);
  }

  // ---------------------------------------------------------------- formatting
  const nfCache = {};
  function nf(opts) {
    if (I._noIntl || typeof Intl === 'undefined' || !Intl.NumberFormat) return null;
    const l = lang();
    const id = l + JSON.stringify(opts);
    if (!nfCache[id]) { try { nfCache[id] = new Intl.NumberFormat(LANGS[l].locale, opts); } catch (e) { nfCache[id] = null; } }
    return nfCache[id];
  }
  function manual(n, minD, maxD) {
    const L = LANGS[lang()];
    const parts = Math.abs(+n).toFixed(maxD).split('.');
    let i = parts[0], f = parts[1] || '';
    while (f.length > minD && f.charAt(f.length - 1) === '0') f = f.slice(0, -1);
    const neg = +n < 0 && /[1-9]/.test(i + f);
    i = i.replace(/\B(?=(\d{3})+(?!\d))/g, L.group);
    return (neg ? '-' : '') + (f ? i + L.decimal + f : i);
  }
  // num(1234.5) "1,234.5" / "1.234,5"; digits = exact decimals (default: up to 2)
  function num(n, digits) {
    n = +n;
    if (!isFinite(n)) return String(n);
    const minD = digits == null ? 0 : digits, maxD = digits == null ? 2 : digits;
    const f = nf({ minimumFractionDigits: minD, maximumFractionDigits: maxD });
    let s = f ? f.format(n) : manual(n, minD, maxD);
    if (f) s = s.replace(/−/g, '-');
    if (s.charAt(0) === '-' && !/[1-9]/.test(s)) s = s.slice(1);   // no "-0.0"
    return s;
  }
  // the in-game currency is always "$": "$31,975" / "$31.975"
  function money(n) {
    n = Math.round(+n || 0);
    return (n < 0 ? '-$' : '$') + num(Math.abs(n), 0);
  }
  // meters(4.5) "4.5 m" / "4,5 m"; digits = exact decimals (default: up to 1)
  function meters(m, digits) {
    const f = digits == null ? num(Math.round(+m * 10) / 10) : num(m, digits);
    return f + ' m';
  }
  // percent(0.7) "70%" / "70 %" (a ratio, not a number of percent)
  function percent(ratio, digits) {
    const d = digits == null ? 0 : digits;
    const v = num((+ratio || 0) * 100, d);
    return LANGS[lang()].pctSpace ? v + ' %' : v + '%';
  }
  // time(12.34) "12.3 s" / "12,3 s"; a minute or more: "2:05"
  function time(sec, digits) {
    sec = +sec || 0;
    if (Math.abs(sec) >= 60) {
      const s = Math.round(Math.abs(sec)), m = Math.floor(s / 60), r = s % 60;
      return (sec < 0 ? '-' : '') + m + ':' + (r < 10 ? '0' : '') + r;
    }
    return num(sec, digits == null ? 1 : digits) + ' s';
  }
  // date(d, opts) via Intl.DateTimeFormat (default "3 Oct 2026" / "3. okt. 2026"); d: Date, timestamp or a
  // YYYYMMDD day number (the daily seeds)
  function date(d, opts) {
    const dt = d instanceof Date ? d : (typeof d === 'number' && d > 19000000 && d < 30000000)
      ? new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100) : new Date(d);
    if (isNaN(dt)) return '';
    const o = opts || { day: 'numeric', month: 'short', year: 'numeric' };
    try { if (!I._noIntl && typeof Intl !== 'undefined') return new Intl.DateTimeFormat(LANGS[lang()].dateLocale, o).format(dt); } catch (e) { /* */ }
    return dt.getDate() + '/' + (dt.getMonth() + 1) + '/' + dt.getFullYear();
  }

  const I = {
    dict, areas, LANGS, ORDER, DEFAULT,
    dev: isDev(),
    t, has, add, lang, setLanguage, on, off, apply, lazy, levelText,
    // page start (BG.Hud.init): settle the language now that BG.Storage is loaded, set <html lang>, fill static markup
    init() { lang(); syncDocument(); if (hasDoc()) apply(root.document); return cur; },
    num, money, meters, percent, time, date,
    languages() { return ORDER.map(id => ({ id, name: LANGS[id].name })); },
    locale() { return LANGS[lang()].locale; },
    // tests: forget the resolved language (next call resolves again) / the warnings already printed
    _reset() { cur = null; provisional = true; Object.keys(warned).forEach(k => delete warned[k]); },
    _noIntl: false,
  };
  BG.i18n = I;
  BG.t = t;
})(typeof window !== 'undefined' ? window : globalThis);
