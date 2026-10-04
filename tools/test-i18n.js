// SPAN — i18n checks (BG.i18n, js/i18n/<lang>/<area>.js). See docs/I18N.md.
// Usage: node tools/test-i18n.js [--node-only | --browser-only] [--report-only] [--verbose] [--lint-only]
//   1  dictionaries: every key in en exists in da and vice versa, with the same {params}, the same plural shape and
//      the same HTML tags; keys start with their area; every area file is loaded by index.html and tools/harness.js;
//      every literal key used in js/ exists in English
//   2  hard-coded string lint: user-visible English literals in js/ui, js/main.js, js/features and js/render that do not
//      go through t() (textContent / innerHTML / template markup, toast(...), title= / aria-label=, fillText(...),
//      UI fields like name: / desc: / title:, and sentence-like strings), counted per file. Exceptions:
//      tools/i18n-allowlist.json. Fails until the extraction is finished: --report-only prints the report and
//      passes. The reference conversion (title screen, level select, settings, BG.Storage texts) must always be clean.
//   3  formatting: num / money / meters / percent / time / date in both languages, with Intl and with the fallback
//   4  headless Chrome: switching the language re-renders the title, level select and the open settings panel
//      without a reload; the choice persists; navigator.language 'da-*' defaults to Danish; ?lang=da
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = f => args.includes(f);
const nodeOnly = has('--node-only') || has('--lint-only');
const browserOnly = has('--browser-only');
const reportOnly = has('--report-only');
const verbose = has('--verbose');
const lintOnly = has('--lint-only');

let failed = 0, passed = 0;
const ok = (name, cond, info) => {
  if (cond) passed++; else failed++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
};
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

const { BG, I18N_AREAS, I18N_FILES } = require('./harness');
const I = BG.i18n;
const LANGS = I.ORDER;

// ====================================================================== 1. dictionaries
function paramsOf(v) {
  const set = new Set();
  const add = s => String(s).replace(/\{(\w+)\}/g, (m, k) => { set.add(k); return m; });
  if (v && typeof v === 'object') Object.keys(v).forEach(f => add(v[f])); else add(v);
  return [...set].sort().join(',');
}
function tagsOf(v) {
  const set = new Set();
  const add = s => String(s).replace(/<\/?([a-z][a-z0-9]*)/gi, (m, k) => { set.add(k.toLowerCase()); return m; });
  if (v && typeof v === 'object') Object.keys(v).forEach(f => add(v[f])); else add(v);
  return [...set].sort().join(',');
}
function checkDictionaries() {
  console.log('\n--- 1. dictionaries');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const missingFiles = [], notInIndex = [];
  LANGS.forEach(l => I18N_AREAS.forEach(a => {
    const f = 'js/i18n/' + l + '/' + a + '.js';
    if (!fs.existsSync(path.join(ROOT, f))) missingFiles.push(f);
    if (index.indexOf('src="' + f + '"') < 0) notInIndex.push(f);
  }));
  ok('every language has a file per area (' + I18N_AREAS.join(', ') + ')', !missingFiles.length, missingFiles);
  ok('index.html loads i18n.js and every dictionary', index.indexOf('src="js/i18n/i18n.js"') >= 0 && !notInIndex.length, notInIndex);
  ok('i18n.js and the dictionaries load before every other script', index.indexOf('js/i18n/') < index.indexOf('js/core/') && index.lastIndexOf('js/i18n/') < index.indexOf('js/core/'));
  ok('tools/harness.js loads the same files', I18N_FILES.length === 1 + LANGS.length * I18N_AREAS.length);
  const onDisk = LANGS.map(l => fs.readdirSync(path.join(ROOT, 'js/i18n', l)).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')));
  ok('no dictionary file outside the area list', onDisk.every(list => list.every(a => I18N_AREAS.includes(a))), onDisk);

  const en = I.dict.en, issues = { missingDa: [], missingEn: [], params: [], plural: [], tags: [], prefix: [], empty: [] };
  const other = l => (l === 'en' ? 'da' : 'en');
  LANGS.forEach(l => {
    Object.keys(I.areas[l] || {}).forEach(area => (I.areas[l][area] || []).forEach(k => { if (k.indexOf(area + '.') !== 0) issues.prefix.push(l + '/' + area + ': ' + k); }));
    Object.keys(I.dict[l]).forEach(k => {
      const v = I.dict[l][k], w = I.dict[other(l)][k];
      if (v === '' || (v && typeof v === 'object' && !Object.keys(v).length)) issues.empty.push(l + ':' + k);
      if (w === undefined) { (l === 'en' ? issues.missingDa : issues.missingEn).push(k); return; }
      if (l !== 'en') return;
      if (paramsOf(v) !== paramsOf(w)) issues.params.push(k + ' en{' + paramsOf(v) + '} da{' + paramsOf(w) + '}');
      if (tagsOf(v) !== tagsOf(w)) issues.tags.push(k);
      const pv = v && typeof v === 'object', pw = w && typeof w === 'object';
      if (pv !== pw || (pv && !(v.one != null && v.other != null && w.one != null && w.other != null))) issues.plural.push(k);
    });
  });
  ok('every English key exists in Danish', !issues.missingDa.length, issues.missingDa);
  ok('every Danish key exists in English', !issues.missingEn.length, issues.missingEn);
  ok('same {params} in both languages', !issues.params.length, issues.params);
  ok('same plural shape (one + other) in both languages', !issues.plural.length, issues.plural);
  ok('same HTML tags in both languages', !issues.tags.length, issues.tags);
  ok('every key starts with its area', !issues.prefix.length, issues.prefix);
  ok('no empty texts', !issues.empty.length, issues.empty);
  ok('the English and Danish dictionaries are not empty', Object.keys(en).length > 50 && Object.keys(I.dict.da).length === Object.keys(en).length);

  // every literal key used in the code exists in English (dynamic keys like 'hud.chapter.' + key are not checked)
  const keyRe = new RegExp('[\'"`]((?:' + I18N_AREAS.join('|') + ')\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)[\'"`]', 'g');
  const unknown = [];
  jsFiles(['js'], f => !/[\\/]i18n[\\/]/.test(f)).forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = keyRe.exec(src))) {
      if (/^\s*\+/.test(src.slice(m.index + m[0].length, m.index + m[0].length + 4))) continue;   // 'hud.settings.g' + i: a prefix
      if (!(m[1] in en) && !/^levels\.\d+\./.test(m[1])) unknown.push(rel(f) + ': ' + m[1]);
    }
  });
  ok('every key used in js/ exists in English', !unknown.length, unknown);
}

function jsFiles(dirs, filter) {
  const out = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js') && (!filter || filter(p))) out.push(p);
  });
  dirs.forEach(d => { const p = path.join(ROOT, d); if (fs.existsSync(p)) { if (fs.statSync(p).isDirectory()) walk(p); else out.push(p); } });
  return out.sort();
}

// ====================================================================== 2. hard-coded string lint
// A small JS tokenizer: strings, template literals (with ${} nesting), comments, regex literals, identifiers, punctuation.
function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  const isIdStart = c => /[A-Za-z_$]/.test(c), isId = c => /[A-Za-z0-9_$]/.test(c);
  const regexOk = () => {
    for (let k = toks.length - 1; k >= 0; k--) {
      const tk = toks[k];
      if (tk.type === 'tpl' && tk.open) continue;
      if (tk.type === 'punc') return !/^[)\]}]$/.test(tk.value);
      if (tk.type === 'id') return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(tk.value);
      return false;
    }
    return true;
  };
  function readString(q) {
    const start = line;
    let s = '';
    i++;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { const c = src[i + 1]; s += c === 'n' ? '\n' : c === 't' ? '\t' : c; if (c === '\n') line++; i += 2; continue; }
      if (src[i] === '\n') line++;
      s += src[i++];
    }
    i++;
    toks.push({ type: 'str', value: s, line: start });
  }
  function readTemplate() {
    const tok = { type: 'tpl', value: '', line, open: true };
    toks.push(tok);
    i++;
    let s = '';
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { s += src[i + 1]; if (src[i + 1] === '\n') line++; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        s += '\u0000';
        i += 2;
        code(true);
        continue;
      }
      if (src[i] === '\n') line++;
      s += src[i++];
    }
    i++;
    tok.value = s;
    tok.open = false;
  }
  // reads code until the matching } (inTpl) or the end
  function code(inTpl) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
      if (c === '\'' || c === '"') { readString(c); continue; }
      if (c === '`') { readTemplate(); continue; }
      if (c === '/' && regexOk()) {
        i++;
        let cls = false;
        while (i < n && (cls || src[i] !== '/')) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '\n') break; i++; }
        i++;
        while (i < n && /[a-z]/.test(src[i])) i++;
        toks.push({ type: 'regex', value: '', line });
        continue;
      }
      if (isIdStart(c)) { let s = ''; while (i < n && isId(src[i])) s += src[i++]; toks.push({ type: 'id', value: s, line }); continue; }
      if (/[0-9]/.test(c)) { while (i < n && /[0-9a-fA-FxX._eE]/.test(src[i])) i++; toks.push({ type: 'num', value: '', line }); continue; }
      if (inTpl && c === '{') depth++;
      if (inTpl && c === '}') { if (depth === 0) { i++; return; } depth--; }
      // multi-char operators that matter for context
      const three = src.substr(i, 3), two = src.substr(i, 2);
      if (three === '===' || three === '!==' || three === '...') { toks.push({ type: 'punc', value: three, line }); i += 3; continue; }
      if (['=>', '==', '!=', '+=', '&&', '||', '??', '<=', '>=', '?.'].includes(two)) { toks.push({ type: 'punc', value: two, line }); i += 2; continue; }
      toks.push({ type: 'punc', value: c, line });
      i++;
    }
  }
  code(false);
  return toks;
}

const SKIP_CALLEES = new Set(['log', 'warn', 'error', 'info', 'debug', 'Error', 'TypeError', 'RangeError', 'querySelector', 'querySelectorAll',
  '$', '$$', 'closest', 'matches', 'getElementById', 'getElementsByClassName', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'createElement', 'createElementNS', 'getItem', 'setItem', 'removeItem', 'require', 't', 'tr', 'has', 'contains', 'toggle', 'test', 'match',
  'replace', 'split', 'indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith', 'RegExp', 'sfx', 'icon', 'play', 'call', 'hudCall',
  'getAttribute', 'hasAttribute', 'removeAttribute', 'getPropertyValue', 'setProperty', 'postMessage', 'levelText', 'lazy', 'lazyText',
  'Function', 'importScripts', 'open', 'fetch', 'matchMedia', 'CustomEvent', 'Event', 'emit', 'on', 'off', 'wrap', 'remove', 'add', 'get', 'set']);
const UI_CALLEES = new Set(['toast', 'hudToast', 'showHint', 'fillText', 'strokeText', 'alert', 'confirm', 'prompt', 'setAttribute', 'banner', 'showBanner', 'label', 'tip']);
const UI_PROPS = new Set(['textContent', 'innerText', 'innerHTML', 'outerHTML', 'title', 'placeholder', 'ariaLabel', 'alt']);
const UI_KEYS = new Set(['title', 'name', 'label', 'text', 'desc', 'sub', 'banner', 'hint', 'tip', 'caption', 'message', 'msg', 'advice',
  'cause', 'allLabel', 'heading', 'subtitle', 'tooltip', 'placeholder', 'html', 'reason', 'why', 'short', 'long', 'detail', 'info', 'lbl',
  'body', 'note', 'help', 'what', 'summary', 'headline', 'question']);
const ATTR_RE = /(?:^|\s)(title|aria-label|alt|placeholder|data-tip)\s*=\s*"([^"]*)"/g;
const KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[A-Za-z0-9_]+)+$/;    // an i18n key ('hud.title.play')

function clean(s) { return String(s).replace(/\u0000/g, ' ').replace(/&(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ').replace(/\s+/g, ' ').trim(); }
const CODEY = /\dpx\b|sans-serif|monospace|system-ui|=>|\$\{|\bfunction\b|[{};]|^[.#\[]|\b(px|rgba?|var|url|translate[XY]?|scale|rotate)\(|^M[\d.-]|^[a-z-]+\s*:\s*[^ ]+$|^\w+\.\w+\(/;
// a text a player would read (UI context): letters, not an identifier / class / key
function uiText(s) {
  const c = clean(s);
  if (!/[A-Za-z]{2,}/.test(c) || CODEY.test(c) || KEY_RE.test(c)) return null;
  if (/^[a-z0-9_\-.:\/#?=&]+$/.test(c)) return null;               // id, key, class, path
  if (/^[a-z][\w-]*( [a-z][\w-]*)+$/.test(c) && /-|_/.test(c)) return null; // class list
  return c;
}
// a sentence anywhere (no UI context needed): two or more words, sentence-like
function prose(raw) {
  const c = clean(raw);
  if (!/[A-Za-z]{2,}/.test(c) || CODEY.test(c) || KEY_RE.test(c)) return null;
  const words = c.split(' ').filter(w => /[A-Za-z]{2,}/.test(w));
  if (words.length < 2) return null;
  const lowerTokens = c.split(' ').every(w => /^[a-z0-9_\-:.#\[\]=()'"]+$/.test(w));
  if (lowerTokens && !/[,.!?…—–·’]/.test(c)) return null;           // class lists, event names
  if (/^[a-z]+(-[a-z0-9]+)+( |$)/.test(c) || /\b\w+-\w+-\w+\b/.test(c) && lowerTokens) return null;
  return c;
}
// texts inside HTML markup: text nodes and title / aria-label / alt / placeholder / data-tip values
function htmlTexts(s) {
  const out = [];                                                  // { text, at }: at = offset in s (for the line)
  const blank = x => x.replace(/[^\n]/g, ' ');                     // keeps offsets and newlines
  const src = String(s).replace(/<!--[\s\S]*?-->/g, blank).replace(/<kbd>[^<]*<\/kbd>/g, blank).replace(/<(script|style)[\s\S]*?<\/\1>/g, blank);
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(src))) { const v = uiText(m[2]); if (v) out.push({ text: v, at: m.index }); }
  const TAG = /<[^<>]*>/g, segs = [];
  let last = 0;
  while ((m = TAG.exec(src))) { segs.push([last, src.slice(last, m.index)]); last = m.index + m[0].length; }
  segs.push([last, src.slice(last)]);
  segs.forEach(([at, seg], k) => {
    if (k === 0 && seg.indexOf('>') >= 0) { at += seg.lastIndexOf('>') + 1; seg = seg.slice(seg.lastIndexOf('>') + 1); } // starts inside a tag
    if (k === segs.length - 1 && seg.indexOf('<') >= 0) seg = seg.slice(0, seg.indexOf('<'));
    if (/[a-z-]+\s*=\s*"/.test(seg)) return;                                             // attributes of an open tag
    const v = clean(seg);
    if (/[A-Za-z]{2,}/.test(v) && !CODEY.test(v) && !/^[a-z0-9_\-.:\/#]+$/.test(v)) out.push({ text: v, at: at + Math.max(0, seg.search(/\S/)) });
  });
  return out;
}
// markup, or a fragment of it ('<button class="tab ' + cls + '">')
const isMarkup = s => /<\/?[a-z]/i.test(s) || /^\s*[a-z-]+="/.test(s) || /"\s*\/?>/.test(s);

function lintFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const toks = tokenize(src);
  const hits = [];
  const stack = [];
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.type === 'punc') {
      if (tk.value === '(') {
        const p = toks[k - 1], pp = toks[k - 2];
        let callee = p && p.type === 'id' && !/^(if|for|while|switch|catch|function|return|typeof|await|of|in)$/.test(p.value) ? p.value : null;
        if (callee && pp && pp.value === '.' && toks[k - 3] && toks[k - 3].value === 'console') callee = 'log';
        stack.push({ c: '(', callee });
      } else if (tk.value === '[' || tk.value === '{') stack.push({ c: tk.value, callee: null });
      else if (tk.value === ')' || tk.value === ']' || tk.value === '}') stack.pop();
      continue;
    }
    if (tk.type !== 'str' && tk.type !== 'tpl') continue;
    const frame = stack[stack.length - 1] || {};
    const callee = frame.c === '(' ? frame.callee : null;
    if (callee && SKIP_CALLEES.has(callee)) continue;
    const prev = toks[k - 1] || {}, prev2 = toks[k - 2] || {}, next = toks[k + 1] || {};
    if (next.value === ':' && frame.c === '{' && tk.type === 'str') continue;              // object key
    let texts = [];
    if (isMarkup(tk.value)) texts = htmlTexts(tk.value).map(x => ({ text: x.text, line: tk.line + (tk.value.slice(0, x.at).match(/\n/g) || []).length }));
    else {
      const uiCtx = (callee && UI_CALLEES.has(callee)) ||
        ((prev.value === '=' || prev.value === '+=') && prev2.type === 'id' && UI_PROPS.has(prev2.value)) ||
        (prev.value === ':' && frame.c === '{' && (prev2.type === 'id' || prev2.type === 'str') && UI_KEYS.has(prev2.value));
      const v = uiCtx ? uiText(tk.value) : prose(tk.value);
      if (v) texts = [{ text: v, line: tk.line }];
    }
    texts.forEach(x => hits.push(x));
  }
  return hits;
}

function loadAllow() {
  const f = path.join(__dirname, 'i18n-allowlist.json');
  const a = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const rx = list => (list || []).map(p => (p.charAt(0) === '/' && p.lastIndexOf('/') > 0 ? new RegExp(p.slice(1, p.lastIndexOf('/')), p.slice(p.lastIndexOf('/') + 1)) : p));
  const global = rx(a.global), files = {};
  Object.keys(a.files || {}).forEach(k => { files[k] = rx(a.files[k]); });
  const match = (list, text) => list.some(p => (typeof p === 'string' ? p === text : p.test(text)));
  return (file, text) => match(global, text) || match(files[file] || [], text);
}

// the reference conversion: these must stay clean even with --report-only
const STRICT = [
  { file: 'js/ui/storage.js' },
  { file: 'js/ui/hud.js', from: /^\s{4}_buildTitle\(\) \{/, to: /^\s{4}\/\/ -+ in-level HUD/ },
  { file: 'js/ui/hud.js', from: /^\s{4}\/\/ -+ settings/, to: /^\s{4}\/\/ -+ screens/ },
  { file: 'js/ui/hud.js', from: /^\s{2}const CHAPTERS = \[/, to: /^\s{2}\]\.map\(chapterText\);/ },
  { file: 'js/ui/hud.js', from: /^\s{2}const RAIL_CHAPTERS = \[/, to: /^\s{2}\]\.map\(chapterText\);/ },
];
function strictRanges(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  return STRICT.filter(s => s.file === file).map(s => {
    if (!s.from) return [1, Infinity];
    const a = lines.findIndex(l => s.from.test(l));
    const b = a < 0 ? -1 : lines.findIndex((l, i) => i > a && s.to.test(l));
    return a < 0 || b < 0 ? null : [a + 1, b + 1];
  });
}

function lint() {
  console.log('\n--- 2. hard-coded string lint' + (reportOnly ? ' (report only)' : ''));
  const allowed = loadAllow();
  const files = jsFiles(['js/ui', 'js/main.js', 'js/features', 'js/render']);
  const report = [];
  let total = 0;
  const strictHits = [], strictBad = [];
  files.forEach(f => {
    const r = rel(f);
    const hits = lintFile(f).filter(h => !allowed(r, h.text));
    total += hits.length;
    report.push({ file: r, n: hits.length, hits });
    const ranges = strictRanges(r);
    if (ranges.some(x => x === null)) strictBad.push(r);
    hits.forEach(h => { if (ranges.some(x => x && h.line >= x[0] && h.line <= x[1])) strictHits.push(r + ':' + h.line + ' ' + JSON.stringify(h.text)); });
  });
  report.sort((a, b) => b.n - a.n || (a.file < b.file ? -1 : 1));
  report.forEach(x => {
    console.log('  ' + String(x.n).padStart(4) + '  ' + x.file);
    if (verbose) x.hits.forEach(h => console.log('          ' + x.file + ':' + h.line + '  ' + JSON.stringify(h.text)));
  });
  console.log('  ' + String(total).padStart(4) + '  total in ' + report.filter(x => x.n).length + ' of ' + files.length + ' files' + (verbose ? '' : '  (--verbose lists them)'));
  ok('the lint finds the files it scans', files.length >= 20);
  ok('reference conversion is clean (title screen, level select, settings, BG.Storage texts)', !strictHits.length && !strictBad.length, strictHits.concat(strictBad.map(f => 'range markers not found in ' + f)));
  // the tokenizer itself
  const probe = lintFile(path.join(__dirname, 'i18n-lint-probe.js'));
  const want = ['Hard-coded toast', 'Hello there', 'A sentence that nobody translated.', 'Tool tip', 'Visible text', 'Chapter name', 'Canvas label'];
  ok('the lint catches every kind of probe string', want.every(w => probe.some(h => h.text === w)), { want, got: probe.map(h => h.text) });
  ok('the lint ignores keys, classes, console and regexes in the probe', probe.length === want.length, probe.map(h => h.text));
  if (reportOnly) console.log('PASS hard-coded strings: ' + total + ' left (report only)');
  else ok('no hard-coded user-visible strings', total === 0, total + ' left; run with --verbose to list them');
}

// ====================================================================== 3. formatting
function formatting() {
  console.log('\n--- 3. formatting');
  const sp = s => String(s).replace(/[  ]/g, ' ');
  const cases = {
    en: { money: '$31,975', neg: '-$1,234,567', m: '4.5 m', m2: '12 m', num: '1,234.5', num2: '3.14', pct: '70%', time: '12.3 s', min: '2:05', zero: '$0' },
    da: { money: '$31.975', neg: '-$1.234.567', m: '4,5 m', m2: '12 m', num: '1.234,5', num2: '3,14', pct: '70 %', time: '12,3 s', min: '2:05', zero: '$0' },
  };
  const before = I.lang();
  [false, true].forEach(noIntl => {
    I._noIntl = noIntl;
    LANGS.forEach(l => {
      I.setLanguage(l, { persist: false });
      const c = cases[l], tag = l + (noIntl ? ' (fallback)' : ' (Intl)');
      const got = { money: I.money(31975), neg: I.money(-1234567), m: sp(I.meters(4.5)), m2: sp(I.meters(12)), num: I.num(1234.5), num2: I.num(3.14159, 2),
        pct: sp(I.percent(0.7)), time: sp(I.time(12.34)), min: I.time(125), zero: I.money(0) };
      ok('formatting ' + tag, JSON.stringify(got) === JSON.stringify(c), { got, want: c });
      ok('num(n, digits) keeps the digits ' + tag, I.num(2.5, 2) === (l === 'en' ? '2.50' : '2,50') && I.num(-0.001, 1) === (l === 'en' ? '0.0' : '0,0'), [I.num(2.5, 2), I.num(-0.001, 1)]);
      ok('date ' + tag, /2026/.test(I.date(new Date(2026, 9, 3))), I.date(new Date(2026, 9, 3)));
    });
  });
  I._noIntl = false;
  // t(): params, plurals, fallback
  I.setLanguage('en', { persist: false });
  ok('t() fills {params}', I.t('core.level', { n: 7 }) === 'Level 7' && I.t('hud.title.continueLevel', { level: 'Level 7' }) === 'Continue · Level 7');
  ok('plural en: one / other', I.t('core.runs', { n: 1 }) === '1 run' && I.t('core.runs', { n: 2 }) === '2 runs' && I.t('core.runs', { n: 0 }) === '0 runs');
  I.setLanguage('da', { persist: false });
  ok('plural da: one / other', I.t('core.stars', { n: 1 }) === '1 stjerne' && I.t('core.stars', { n: 3 }) === '3 stjerner', [I.t('core.stars', { n: 1 }), I.t('core.stars', { n: 3 })]);
  ok('Danish text', I.t('hud.title.play') === 'Spil');
  const warn = console.warn; let warned = []; console.warn = m => warned.push(m);
  I.dict.en['core.__probe'] = 'English only';
  const fb = I.t('core.__probe'); I.t('core.__probe');
  ok('a key missing in Danish falls back to English and warns once', fb === 'English only' && warned.length === 1 && /core\.__probe/.test(warned[0]), warned);
  delete I.dict.en['core.__probe'];
  warned = [];
  ok('an unknown key returns the key', I.t('core.__nope') === 'core.__nope' && warned.length === 1);
  console.warn = warn;
  // lazy fields and level text
  const ch = I.lazy({ n: 1 }, { name: 'hud.chapter.road1.name' });
  const daName = ch.name;
  I.setLanguage('en', { persist: false });
  ok('lazy fields follow the language', daName === 'De første overgange' && ch.name === 'First Crossings', [daName, ch.name]);
  I.dict.da['levels.1.name'] = 'Probe'; I.dict.en['levels.1.name'] = 'Probe EN';
  const lv = { id: 1, name: 'Data name' };
  const a = I.levelText(lv), b = I.levelText({ id: 999, name: 'Only data' });
  I.setLanguage('da', { persist: false });
  const c = I.levelText(lv);
  delete I.dict.da['levels.1.name']; delete I.dict.en['levels.1.name'];
  ok('levelText: dictionary first, then the level data', a === 'Probe EN' && b === 'Only data' && c === 'Probe' && I.levelText(lv) === 'Data name', [a, b, c]);
  // languagechange event
  let ev = null;
  const offFn = I.on('languagechange', e => { ev = e; });
  I.setLanguage('en', { persist: false });
  offFn();
  ok('setLanguage fires languagechange {lang, prev}', ev && ev.lang === 'en' && ev.prev === 'da', ev);
  ok('setLanguage rejects unknown languages', I.setLanguage('xx') === false && I.lang() === 'en');
  I.setLanguage(before, { persist: false });
}

// ====================================================================== 4. headless Chrome
async function browser() {
  console.log('\n--- 4. headless Chrome');
  const { chromium } = require('playwright');
  const b = await chromium.launch({ headless: true, channel: 'chrome' });
  const href = url.pathToFileURL(path.join(ROOT, 'index.html')).href;
  const warnings = [];
  const watch = (page, tag) => page.on('console', m => {
    if (m.type() === 'error' || /\[i18n\]/.test(m.text())) warnings.push(tag + ': ' + m.text());
  });
  try {
    // --- English browser: English by default, then switch to Danish with the settings panel open
    const ctx = await b.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, 'en');
    page.on('pageerror', e => warnings.push('pageerror: ' + e.message));
    await page.goto(href + '?noresume');
    await page.waitForSelector('#screen-title.active');
    const txt = sel => page.$eval(sel, e => e.textContent.trim()).catch(() => null);
    const attr = (sel, a) => page.$eval(sel, (e, a2) => e.getAttribute(a2), a).catch(() => null);
    ok('en-US browser starts in English', (await attr('html', 'lang')) === 'en' && (await txt('[data-act=play] span')) === 'Play', [await attr('html', 'lang'), await txt('[data-act=play] span')]);
    ok('title tagline and foot in English', /Mind the budget/.test(await txt('.tagline')) && /Space to test/.test(await txt('.title-foot')));
    await page.click('#screen-title [data-act=settings]');
    await page.waitForSelector('#settings.show');
    ok('settings has an English / Dansk picker, English active', (await txt('[data-lang=en]')) === 'English' && (await txt('[data-lang=da]')) === 'Dansk' &&
      (await attr('[data-lang=en]', 'aria-checked')) === 'true');
    await page.waitForTimeout(600);   // the modal card scales in
    const box = await page.$eval('[data-lang=da]', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    ok('language buttons are touch-sized (>= 44 px)', box.h >= 44 && box.w >= 44, box);
    await page.click('[data-lang=da]');
    await page.waitForFunction(() => document.documentElement.lang === 'da');
    ok('Dansk: <html lang="da"> and document title', (await page.title()) === 'SPAN — Brobygger');
    ok('Dansk: the open settings panel re-renders without a reload', (await page.$('#settings.show')) !== null && /Indstillinger/.test(await txt('#settings .modal-head h3')) &&
      (await txt('#settings [data-act=reset]')) === 'Nulstil fremskridt' && (await txt('#settings [data-i18n="hud.settings.volume"]')) === 'Lydstyrke' &&
      (await attr('[data-lang=da]', 'aria-checked')) === 'true', [await txt('#settings .modal-head h3'), await txt('#settings [data-act=reset]')]);
    ok('Dansk: settings rows added by feature modules follow', /Gemte data/.test(await txt('.hist-save') || '') && (await txt('[data-hsave=export]')) === 'Eksporter');
    ok('Dansk: volume shown as "70 %"', /^70\s%$/.test((await txt('[data-ref=volOut]') || '').replace(/ /g, ' ')), await txt('[data-ref=volOut]'));
    ok('Dansk: the title screen behind it is re-rendered', (await txt('[data-act=play] span')) === 'Spil' && /Hold budgettet/.test(await txt('.tagline')) &&
      /Mellemrum/.test(await txt('.title-foot')) && (await txt('.dly-title-btn b')) === 'Dagens udfordring', [await txt('[data-act=play] span'), await txt('.title-foot')]);
    await page.click('#settings [data-act=close].btn-primary');
    // level select in Danish
    await page.click('[data-act=play]');
    await page.waitForSelector('#screen-levels.active');
    ok('Dansk: level select heading, tab and chapter', (await txt('.ls-title h2')) === 'Vælg en overgang' && /Veje/.test(await txt('.camp-tab[data-camp=road]')) &&
      (await txt('.chapter .ch-text h3')) === 'De første overgange' && /^Bane 1–5 · /.test(await txt('.chapter .ch-text p')),
      [await txt('.ls-title h2'), await txt('.chapter .ch-text h3'), await txt('.chapter .ch-text p')]);
    ok('Dansk: unlock info in Danish', /^Sådan låses baner op: En bane åbner/.test(await attr('.ch-info', 'aria-label') || ''), await attr('.ch-info', 'aria-label'));
    // switch back to English while on the level select
    await page.click('#screen-levels [data-act=settings]');
    await page.waitForSelector('#settings.show');
    await page.click('[data-lang=en]');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    ok('English again: the level select behind the panel is rebuilt', (await txt('.ls-title h2')) === 'Select a crossing' && (await txt('.chapter .ch-text h3')) === 'First Crossings' &&
      /^Levels 1–5 · /.test(await txt('.chapter .ch-text p')), [await txt('.ls-title h2'), await txt('.chapter .ch-text h3')]);
    // persistence: choose Danish, reload
    await page.click('[data-lang=da]');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('span.v1.settings') || '{}').lang);
    ok('the choice is saved in the settings (lang: "da")', saved === 'da', saved);
    await page.goto(href + '?noresume');
    await page.waitForSelector('#screen-title.active');
    ok('the saved language survives a reload', (await attr('html', 'lang')) === 'da' && (await txt('[data-act=play] span')) === 'Spil');
    await page.goto(href + '?noresume&lang=en');
    await page.waitForSelector('#screen-title.active');
    ok('?lang=en overrides it for this page', (await txt('[data-act=play] span')) === 'Play');
    await ctx.close();

    // --- Danish browser, nothing saved: Danish by default
    const ctxDa = await b.newContext({ locale: 'da-DK', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p2 = await ctxDa.newPage();
    watch(p2, 'da');
    await p2.goto(href + '?noresume');
    await p2.waitForSelector('#screen-title.active');
    ok('da-DK browser starts in Danish', (await p2.$eval('html', e => e.lang)) === 'da' && (await p2.$eval('[data-act=play] span', e => e.textContent)) === 'Spil');
    ok('touch layout: the title foot uses the touch text in Danish', /Knib for at zoome/.test(await p2.$eval('.title-foot', e => e.textContent)), await p2.$eval('.title-foot', e => e.textContent));
    await p2.tap('#screen-title [data-act=settings]');
    await p2.waitForSelector('#settings.show');
    await p2.waitForTimeout(600);
    const pb = await p2.$eval('[data-lang=en]', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    ok('phone: language buttons >= 44 px', pb.h >= 44 && pb.w >= 44, pb);
    await p2.tap('[data-lang=en]');
    await p2.waitForFunction(() => document.documentElement.lang === 'en');
    ok('phone: touch rows and title foot switch to English', /Magnifier while dragging/.test(await p2.$eval('#settings', e => e.textContent)) &&
      /Pinch to zoom/.test(await p2.$eval('.title-foot', e => e.textContent)));
    await ctxDa.close();
    ok('no console errors and no i18n warnings (missing keys) in the browser', !warnings.length, warnings);
  } finally {
    await b.close();
  }
}

(async () => {
  if (!browserOnly) { if (!lintOnly) checkDictionaries(); lint(); if (!lintOnly) formatting(); }
  if (!nodeOnly) {
    try { await browser(); } catch (e) { ok('browser part ran', false, e.stack || String(e)); }
  }
  console.log('\n' + (failed ? 'FAILED: ' + failed + ' failed, ' : 'OK: ') + passed + ' passed');
  process.exit(failed ? 1 : 0);
})();
