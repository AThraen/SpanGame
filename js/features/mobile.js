// SPAN — mobile / touch layer (BG.Mobile) + performance mode (BG.Perf).
// Classic script, loaded after js/main.js. Everything hooks into existing modules by wrapping their
// methods (no rewrites); on a desktop with a mouse the layer only registers BG.Perf (off) and the
// canvas-resize fix, so the desktop game is unchanged.
//
//  - environment classes on <html>: m-touch, m-phone, m-tablet, m-portrait, m-landscape, m-lowperf
//    (?touchui=1 / ?touchui=0 forces the touch layout on / off, handy on a desktop browser)
//  - responsive HUD (css/mobile.css): compact top bar, tool rail as floating buttons, material
//    palette as a bottom sheet behind a "current material" chip, big touch targets, safe areas
//  - soft "rotate for the best experience" prompt in portrait on phones (portrait stays playable)
//  - precise touch building: magnifier loupe while dragging, optional offset cursor, larger joint
//    snap/pick radius on touch, long-press-and-lift = context menu (delete / stop / undo / fit)
//  - camera gestures in the test (sim) view: one-finger pan, two-finger pinch zoom
//  - haptics (navigator.vibrate) on snap / place / break, browser-gesture guards, fullscreen
//  - BG.Perf: performance mode (fewer particles, cheaper background layers, DPR cap)
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const doc = root.document;
  if (!doc) return;
  const html = doc.documentElement;

  function safe(fn, d) { try { return fn(); } catch (e) { if (root.console) console.warn('[mobile]', e); return d; } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function now() { return root.performance ? performance.now() : Date.now(); }
  function mq(q) { return safe(() => !!(root.matchMedia && root.matchMedia(q).matches), false); }
  function game() { return BG.Game || null; }
  function state() { const g = game(); return g ? g.state : null; }
  function editor() { const g = game(); return g && g.editor; }
  function renderer() { const g = game(); return g && g.renderer; }
  function canvasEl() { const g = game(); return (g && g.canvas) || doc.getElementById('game-canvas'); }
  function $(s, el) { return (el || doc).querySelector(s); }
  function icon(n) { return BG.Hud && BG.Hud.icon ? BG.Hud.icon(n) : ''; }
  function h(markup) { const t = doc.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstElementChild; }
  function wrap(obj, name, fn) {
    if (!obj || typeof obj[name] !== 'function' || obj[name].__mobile) return false;
    const orig = obj[name];
    const w = fn(orig);
    w.__mobile = true; w.__orig = orig;
    obj[name] = w;
    return true;
  }

  // tuning
  const LONG_PRESS_MS = 520;     // hold this long, then lift without moving -> context menu
  const MOVE_PX = 10;            // a touch that moved more than this is a drag
  const OFFSET_PX = 64;          // offset cursor: aim point sits this far above the finger
  const TOUCH_MAG_PX = 30;       // joint magnet radius on touch (px, capped below)
  const TOUCH_MAG_MAX = 0.9;     // m
  const TOUCH_PICK_PX = 34;      // radius for picking the joint a drag starts from (px)
  const LOUPE = 132, LOUPE_ZOOM = 2;

  // ------------------------------------------------------------------ settings
  const DEFAULTS = { loupe: true, offsetCursor: false, haptics: true, perfMode: 'auto' };
  function getSetting(k) {
    const g = game();
    let s = g && g.settings;
    if (!s && BG.Storage) s = safe(() => BG.Storage.getSettings(), null);
    return s && s[k] !== undefined ? s[k] : DEFAULTS[k];
  }
  function setSetting(k, v) {
    const g = game();
    if (g && typeof g.setSetting === 'function') g.setSetting(k, v);
    else if (BG.Storage) safe(() => BG.Storage.setSettings({ [k]: v }));
  }
  function urlParam(k) { return safe(() => new URLSearchParams(root.location.search).get(k), null); }

  // ------------------------------------------------------------------ environment
  const Env = { touch: false, phone: false, tablet: false, portrait: false, forced: null };
  function detect() {
    const f = urlParam('touchui');
    Env.forced = f === '1' ? true : f === '0' ? false : null;
    const coarse = mq('(pointer: coarse)') || (mq('(any-pointer: coarse)') && !mq('(any-pointer: fine)'));
    const W = root.innerWidth || 1024, H = root.innerHeight || 768;
    Env.touch = Env.forced != null ? Env.forced : coarse;
    Env.phone = Env.touch && Math.min(W, H) <= 520;
    Env.tablet = Env.touch && !Env.phone;
    Env.portrait = H > W;
    const cl = html.classList;
    cl.toggle('m-touch', Env.touch);
    cl.toggle('m-phone', Env.phone);
    cl.toggle('m-tablet', Env.tablet);
    cl.toggle('m-portrait', Env.touch && Env.portrait);
    cl.toggle('m-landscape', Env.touch && !Env.portrait);
    return Env;
  }

  // ------------------------------------------------------------------ BG.Perf
  const Perf = BG.Perf = Object.assign(BG.Perf || {}, {
    mode: 'auto',          // 'auto' | 'on' | 'off'
    auto: false,           // what auto-detection chose
    slow: false,           // the frame-time watchdog saw a slow device
    low: false,            // effective: performance mode active
    dprCap: 2,             // renderer caps devicePixelRatio to this (renderer.resize hook)
    particleScale: 1,      // share of effect particles that are spawned
    maxParticles: 1800,
    cheapBackground: false, // fewer parallax layers, no ambient particles / vignette
    reason: '',
    isLow() { return this.low; },
    setMode(m) {
      this.mode = m === 'on' || m === 'off' ? m : 'auto';
      this.apply();
      return this.low;
    },
    detect() {
      const nav = root.navigator || {};
      const cores = nav.hardwareConcurrency || 8, mem = nav.deviceMemory || 8;
      this.auto = !!(Env.touch && (Env.phone || cores <= 4 || mem <= 4)) || this.slow;
      this.reason = this.slow ? 'slow frames' : !this.auto ? '' : Env.phone ? 'phone' : 'low-end device';
      return this.auto;
    },
    apply() {
      const low = this.mode === 'on' || (this.mode === 'auto' && this.auto);
      const changed = low !== this.low;
      this.low = low;
      const veryLow = low && (this.slow || ((root.navigator && root.navigator.hardwareConcurrency) || 8) <= 4);
      this.dprCap = veryLow ? 1.5 : 2;
      this.particleScale = low ? (veryLow ? 0.35 : 0.5) : 1;
      this.maxParticles = low ? (veryLow ? 450 : 700) : 1800;
      this.cheapBackground = low;
      html.classList.toggle('m-lowperf', low);
      const r = renderer();
      if (r) safe(() => { if (r.invalidate) r.invalidate(); r._vigKey = ''; if (r.resize) r.resize(); });
      return changed;
    },
    // frame-time watchdog (touch devices, auto mode): sustained < ~32 fps switches performance mode on
    _acc: 0, _n: 0, _win: 0,
    sample(dt) {
      if (this.slow || this.mode !== 'auto' || !Env.touch || !(dt > 0) || dt > 0.25) return;
      const st = state();
      if (st !== 'edit' && st !== 'sim') { this._acc = this._n = this._win = 0; return; }
      if (doc.hidden) return;
      this._acc += dt; this._n++; this._win += dt;
      if (this._win >= 3) {
        const mean = this._acc / this._n;
        this._acc = this._n = this._win = 0;
        if (mean > 1 / 32) {
          this.slow = true;
          this.detect();
          const was = this.low;
          this.apply();
          if (!was && this.low && BG.Hud && BG.Hud.toast) BG.Hud.toast('Performance mode on for smoother play (Settings)', 'info', 2600);
        }
      }
    },
  });

  // renderer / effects hooks (prototype wraps; the renderer reads BG.Perf.dprCap in resize())
  function installPerfHooks() {
    const RP = BG.Renderer && BG.Renderer.prototype;
    wrap(RP, '_drawParallax', (orig) => function () {
      const th = this.theme;
      if (!Perf.cheapBackground || !th || !Array.isArray(th.layers) || th.layers.length <= 2) return orig.apply(this, arguments);
      const L = th.layers;
      th.layers = L.slice(-2); // keep the two nearest silhouettes
      try { return orig.apply(this, arguments); } finally { th.layers = L; }
    });
    wrap(RP, '_drawAmbient', (orig) => function () { if (Perf.cheapBackground) return undefined; return orig.apply(this, arguments); });
    wrap(RP, '_drawVignette', (orig) => function () { if (Perf.cheapBackground) return undefined; return orig.apply(this, arguments); });
    const EP = BG.Effects && BG.Effects.prototype;
    const scratch = {};
    wrap(EP, '_spawn', (orig) => function (o) {
      if (Perf.low) {
        if (Perf.particleScale < 1 && Math.random() > Perf.particleScale) return scratch; // dropped (visual only)
        while (this.particles && this.particles.length >= Perf.maxParticles) this.pool.push(this.particles.shift());
      }
      return orig.call(this, o);
    });
  }

  // ------------------------------------------------------------------ haptics
  const HAPTIC = { snap: 7, place: 14, pier: 18, erase: 10, break: [26, 30, 46], error: [10, 45, 10], lp: 12, ctx: 8,
    success: [18, 50, 24], fail: [40, 40, 60], splash: 16, derail: [30, 30, 50] };
  const lastBuzz = {};
  let lastPointer = 'mouse';
  function haptic(kind) {
    const nav = root.navigator;
    if (!nav || typeof nav.vibrate !== 'function') return false;
    if (lastPointer !== 'touch' || getSetting('haptics') === false) return false;
    const p = HAPTIC[kind];
    if (p == null) return false;
    const t = now();
    if (t - (lastBuzz[kind] || 0) < 60) return false;
    lastBuzz[kind] = t;
    M.buzzes++;
    return safe(() => nav.vibrate(p), false);
  }
  function installHaptics() {
    wrap(BG.Audio, 'play', (orig) => function (name) {
      if (typeof name === 'string') safe(() => haptic(name));
      return orig.apply(this, arguments);
    });
  }

  // ------------------------------------------------------------------ touch wording
  const TOUCH_TEXT = [
    [/\s*\(key \d\)/gi, ''],
    [/\(right-click or Esc stops building\)/gi, '(tap the last joint again to stop building)'],
    [/right-click or Esc/gi, 'tap the last joint again'],
    [/press Test \(Space\)/gi, 'tap Test'],
    [/\bpress (Test|Inspect|Build it|Copy result)\b/gi, 'tap $1'],
    [/\s*\(Space\)/g, ''],
    [/Ctrl\+Z to undo/g, 'tap Undo to restore it'],
    [/\bhover a beam\b/gi, 'touch a beam'],
    [/\bClick\b/g, 'Tap'],
    [/\bclick(ed|ing|s)?\b/g, (m, s) => 'tap' + (s === 'ed' ? 'ped' : s === 'ing' ? 'ping' : s || '')],
  ];
  function touchText(s) {
    if (!Env.touch || typeof s !== 'string') return s;
    for (const [re, rep] of TOUCH_TEXT) s = s.replace(re, rep);
    return s;
  }

  // ------------------------------------------------------------------ fullscreen
  const FS = {
    supported() {
      return !!((html.requestFullscreen || html.webkitRequestFullscreen) && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled));
    },
    active() { return !!(doc.fullscreenElement || doc.webkitFullscreenElement); },
    enter(lockLandscape) {
      const p = safe(() => (html.requestFullscreen ? html.requestFullscreen({ navigationUI: 'hide' }) : html.webkitRequestFullscreen()), null);
      const lock = () => { if (lockLandscape && root.screen && screen.orientation && screen.orientation.lock) safe(() => screen.orientation.lock('landscape').catch(() => {})); };
      if (p && p.then) p.then(lock, () => {}); else lock();
    },
    exit() { safe(() => { const r = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen && doc.webkitExitFullscreen(); if (r && r.catch) r.catch(() => {}); }); },
    toggle() { if (FS.active()) FS.exit(); else FS.enter(false); },
  };
  const FS_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="fs-in" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path class="fs-out" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" style="display:none"/></svg>';
  const VIB_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4 8v8M20 8v8M1.5 10.5v3M22.5 10.5v3"/></svg>';
  function syncFsButtons() {
    const on = FS.active(), ok = FS.supported();
    doc.querySelectorAll('.m-fs-btn').forEach((b) => {
      b.classList.toggle('m-fs-ok', ok);
      b.classList.toggle('on', on);
      b.title = on ? 'Exit fullscreen' : 'Fullscreen';
      const i = b.querySelector('.fs-in'), o = b.querySelector('.fs-out');
      if (i) i.style.display = on ? 'none' : '';
      if (o) o.style.display = on ? '' : 'none';
    });
    doc.querySelectorAll('.m-fs-toggle').forEach((b) => { b.textContent = on ? 'Exit' : 'Enter'; });
    doc.querySelectorAll('.m-fs-row').forEach((r) => { r.hidden = !ok; });
  }

  // ------------------------------------------------------------------ DOM pieces
  const UI = {};
  function buildUi() {
    if (UI.built) return;
    const ui = doc.getElementById('ui');
    const lvl = doc.getElementById('screen-level');
    if (!ui || !lvl) return;
    UI.built = true;
    UI.level = lvl;

    // loupe + offset reticle + context menu + rotate prompt
    UI.loupe = h('<canvas class="m-loupe" width="2" height="2" aria-hidden="true"></canvas>');
    UI.reticle = h('<div class="m-reticle" aria-hidden="true"></div>');
    UI.ctx = h('<div class="m-ctx glass" role="menu"></div>');
    UI.rotate = h(`<div class="m-rotate glass" role="status">
        <span class="m-rot-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/></svg></span>
        <p><b>Rotate for the best view</b>Landscape gives the bridge more room. Portrait still works fine.</p>
        <span class="m-rot-btns"><button class="btn btn-primary" data-mact="rotateOk">Got it</button><button class="btn btn-glass m-fs-land" data-mact="fsLand" hidden>Fullscreen</button></span>
      </div>`);
    ui.appendChild(UI.loupe); ui.appendChild(UI.reticle); ui.appendChild(UI.ctx); ui.appendChild(UI.rotate);

    // current-material chip + bottom-sheet scrim (phones)
    const dock = $('.dock', lvl);
    UI.chip = h(`<button class="m-mat-chip glass" data-mact="sheet" aria-haspopup="true" title="Materials"><span class="m-chip-sw"></span><span class="m-chip-txt"><b>Road</b><small></small></span>${icon('chevDown')}</button>`);
    UI.scrim = h('<div class="m-sheet-scrim" data-mact="sheetClose"></div>');
    if (dock) { dock.appendChild(UI.scrim); dock.appendChild(UI.chip); }

    // fullscreen buttons: title screen + in-level top bar
    const tm = $('#screen-title .title-meta');
    if (tm) tm.insertBefore(h('<button class="btn btn-icon btn-glass m-fs-btn" data-mact="fullscreen" title="Fullscreen">' + FS_ICON + '</button>'), tm.lastElementChild);
    const tb = $('.topbar', lvl), tbSet = tb && $('[data-act=settings]', tb);
    if (tb && tbSet) tb.insertBefore(h('<button class="btn btn-icon btn-ghost m-fs-btn" data-mact="fullscreen" title="Fullscreen">' + FS_ICON + '</button>'), tbSet);

    // title foot text for touch
    const foot = $('#screen-title .title-foot');
    if (foot) { UI.footDesk = foot.textContent; }

    // settings rows
    const card = $('#settings .modal-card'), foot2 = card && $('.modal-foot', card), keys = card && $('.set-row.keys', card);
    if (card && foot2) {
      const vib = root.navigator && typeof root.navigator.vibrate === 'function';
      const rows = [
        `<label class="set-row m-set-row m-touch-only"><span>${icon('eye')}Magnifier while dragging</span><input type="checkbox" class="switch" data-mset="loupe"></label>`,
        `<label class="set-row m-set-row m-touch-only"><span>${icon('select')}Offset cursor (aim above finger)</span><input type="checkbox" class="switch" data-mset="offsetCursor"></label>`,
        vib ? `<label class="set-row m-set-row m-touch-only"><span>${VIB_ICON}Vibration</span><input type="checkbox" class="switch" data-mset="haptics"></label>` : '',
        `<div class="set-row m-set-row m-touch-only"><span>${icon('stress')}Performance mode</span><select data-mset="perfMode" aria-label="Performance mode"><option value="auto">Auto</option><option value="on">On · smoother</option><option value="off">Off · prettier</option></select></div>`,
        `<div class="set-row m-set-row m-touch-only m-fs-row"><span>${FS_ICON}Fullscreen</span><button class="btn btn-glass m-fs-toggle" data-mact="fullscreen">Enter</button></div>`,
      ].join('');
      const frag = doc.createElement('div');
      frag.innerHTML = rows;
      const anchor = keys || foot2;
      while (frag.firstElementChild) card.insertBefore(frag.firstElementChild, anchor);
      const gest = h(`<div class="set-row m-gestures"><span>Touch</span><div class="m-gest-list">
          <b>Drag from a joint</b><span>build a beam (it keeps building from its end)</span>
          <b>Tap a joint</b><span>start / stop building from it</span>
          <b>Hold, then drag</b><span>move a joint</span>
          <b>Hold and lift</b><span>delete, stop, undo… menu</span>
          <b>Arch tool</b><span>drag start to end, drag for the rise, tap to place; two-finger tap cancels</span>
          <b>Drag empty space</b><span>pan the view</span>
          <b>Pinch / two fingers</b><span>zoom and pan</span></div></div>`);
      card.insertBefore(gest, keys ? keys.nextSibling : foot2);
      card.addEventListener('change', (e) => {
        const inp = e.target.closest && e.target.closest('[data-mset]');
        if (!inp) return;
        const k = inp.dataset.mset;
        const v = inp.type === 'checkbox' ? inp.checked : inp.value;
        setSetting(k, v);
        if (k === 'perfMode') Perf.setMode(v);
        if (k === 'haptics' && v) { lastPointer = 'touch'; haptic('place'); }
      });
    }

    // clicks on our controls
    doc.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-mact]');
      if (!b) return;
      const a = b.dataset.mact;
      if (a === 'sheet') { sfx('click'); toggleSheet(); }
      else if (a === 'sheetClose') toggleSheet(false);
      else if (a === 'fullscreen') { sfx('click'); FS.toggle(); }
      else if (a === 'rotateOk') { hideRotate(true); }
      else if (a === 'fsLand') { hideRotate(true); FS.enter(true); }
    });
    // picking a material in the sheet closes it
    const pal = $('[data-ref=palette]', lvl);
    if (pal) pal.addEventListener('click', (e) => { const m = e.target.closest('[data-mat]'); if (m && !m.classList.contains('disabled')) setTimeout(() => toggleSheet(false), 140); });
    // tapping elsewhere closes the context menu
    doc.addEventListener('pointerdown', (e) => { if (UI.ctx.classList.contains('show') && !(e.target.closest && e.target.closest('.m-ctx'))) hideCtx(); }, true);
    doc.addEventListener('fullscreenchange', onFsChange);
    doc.addEventListener('webkitfullscreenchange', onFsChange);
    syncFsButtons();
    applyTouchText();
    syncSettingsUi();
  }
  function sfx(n) { safe(() => { if (BG.Audio && BG.Audio.play) BG.Audio.play(n); }); }
  function onFsChange() { syncFsButtons(); setTimeout(onResize, 60); }
  function applyTouchText() {
    const foot = $('#screen-title .title-foot');
    if (foot && UI.footDesk != null) foot.textContent = Env.touch ? 'Drag to build · Pinch to zoom · Tap Test to run' : UI.footDesk;
  }
  function syncSettingsUi() {
    const card = $('#settings .modal-card');
    if (!card) return;
    card.querySelectorAll('[data-mset]').forEach((inp) => {
      const v = getSetting(inp.dataset.mset);
      if (inp.type === 'checkbox') inp.checked = v !== false;
      else inp.value = v;
    });
    syncFsButtons();
  }

  // ------------------------------------------------------------------ bottom sheet + chip
  function sheetOpen() { return !!(UI.level && UI.level.classList.contains('m-sheet-open')); }
  function toggleSheet(on) {
    if (!UI.level) return;
    if (on == null) on = !sheetOpen();
    if (on && state() !== 'edit') on = false;
    UI.level.classList.toggle('m-sheet-open', !!on);
    if (UI.chip) UI.chip.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) hideCtx();
  }
  let chipSig = '';
  function updateChip() {
    if (!UI.chip || !Env.phone) return;
    const ed = editor();
    const mat = ed ? ed.material : null, tool = ed ? ed.tool : 'build';
    const pal = $('[data-ref=palette]', UI.level);
    const sig = mat + '|' + tool + '|' + (pal ? pal.childElementCount : 0) + '|' + (BG.Hud && BG.Hud.level && BG.Hud.level.id);
    if (sig === chipSig) return;
    chipSig = sig;
    const btn = pal && mat ? pal.querySelector('[data-mat="' + mat + '"]') : null;
    const sw = $('.m-chip-sw', UI.chip), nm = $('.m-chip-txt b', UI.chip), sm = $('.m-chip-txt small', UI.chip);
    if (btn) {
      sw.innerHTML = ($('.mat-ico', btn) || {}).innerHTML || '';
      nm.textContent = ($('.mat-info b', btn) || {}).textContent || mat;
      const cost = ($('.mat-meta em', btn) || {}).textContent || '', len = ($('.mat-meta i', btn) || {}).textContent || '';
      sm.textContent = tool === 'erase' ? 'Erase tool' : tool === 'pier' ? 'Pier tool' : tool === 'select' ? 'Select tool' : tool === 'arch' ? 'Arch tool · ' + len : cost + ' · ' + len; // arch-tool
    }
    UI.chip.classList.toggle('m-tool-mode', tool !== 'build');
  }
  function updatePierCount() {
    const lv = BG.Hud && BG.Hud.level, ed = editor();
    const pb = UI.level && $('[data-tool=pier]', UI.level);
    if (!pb) return;
    const txt = lv && lv.maxPiers != null && ed && ed.design ? (ed.design.piers || []).length + '/' + lv.maxPiers : '';
    if (pb.getAttribute('data-m-count') !== txt) pb.setAttribute('data-m-count', txt);
  }

  // ------------------------------------------------------------------ rotate prompt
  let rotateSeen = false, rotateTimer = 0;
  function sessionGet(k) { return safe(() => root.sessionStorage.getItem(k), null); }
  function sessionSet(k, v) { safe(() => root.sessionStorage.setItem(k, v)); }
  function maybeRotate() {
    if (!UI.rotate) return;
    const st = state();
    const want = Env.phone && Env.portrait && (st === 'edit' || st === 'sim') && !rotateSeen && sessionGet('span.m.rotateSeen') !== '1';
    if (!want) { if (!(Env.phone && Env.portrait)) hideRotate(false); return; }
    const fsl = $('.m-fs-land', UI.rotate);
    if (fsl) fsl.hidden = !(FS.supported() && root.screen && screen.orientation && screen.orientation.lock);
    UI.rotate.classList.add('show');
    rotateSeen = true;
    clearTimeout(rotateTimer);
    rotateTimer = setTimeout(() => hideRotate(true), 9000);
  }
  function hideRotate(remember) {
    if (!UI.rotate) return;
    clearTimeout(rotateTimer);
    UI.rotate.classList.remove('show');
    if (remember) sessionSet('span.m.rotateSeen', '1');
  }

  // ------------------------------------------------------------------ camera framing for the touch HUD
  function fitLevel() {
    const g = game(), r = renderer();
    if (!Env.touch || !g || !r || !g.level || g.state !== 'edit' || !UI.level) return false;
    const H = root.innerHeight;
    // where the panel rests in edit mode: its CSS transform is still sliding it in after a test (Next, Build),
    // so take the translation off the measured box (else the rail reads as ~0 px wide and the level fits under it)
    const rc = (sel) => {
      const el = $(sel, UI.level); if (!el) return null;
      const b = el.getBoundingClientRect(); if (!(b.width && b.height)) return null;
      let tx = 0, ty = 0;
      safe(() => { const tf = root.getComputedStyle(el).transform; if (tf && tf !== 'none') { const m = new root.DOMMatrixReadOnly(tf); tx = m.m41; ty = m.m42; } });
      return { top: b.top - ty, bottom: b.bottom - ty, left: b.left - tx, right: b.right - tx, width: b.width, height: b.height };
    };
    const top = rc('.topbar'), rail = rc('.rail'), test = rc('.test-btn');
    const low = Env.phone ? rc('.m-mat-chip') : rc('.palette');
    let bottomEdge = H;
    if (test) bottomEdge = Math.min(bottomEdge, test.top);
    if (low) bottomEdge = Math.min(bottomEdge, low.top);
    const ins = {
      top: Math.round((top ? top.bottom : 60) + 6),
      left: Math.round((rail ? rail.right : 12) + 6),
      right: 10,
      bottom: Math.round(H - bottomEdge + 6),
    };
    if (typeof r.setInsets === 'function') r.setInsets(ins);
    if (typeof r.fitToLevel === 'function') safe(() => r.fitToLevel());
    M.lastInsets = ins;
    return true;
  }
  function scheduleFit() {
    const raf = root.requestAnimationFrame || ((f) => setTimeout(f, 16));
    raf(() => raf(() => { fitLevel(); }));
  }
  let rzTimer = 0;
  function onResize() {
    const was = Env.touch + '|' + Env.phone + '|' + Env.portrait;
    detect();
    const changed = was !== Env.touch + '|' + Env.phone + '|' + Env.portrait;
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      // the renderer pins the canvas CSS size in px on first sizing; let CSS size it again
      const c = canvasEl();
      if (c && c.style && (c.style.width || c.style.height)) {
        const w = parseFloat(c.style.width), hh = parseFloat(c.style.height);
        if (Math.round(w) !== root.innerWidth || Math.round(hh) !== root.innerHeight) { c.style.width = ''; c.style.height = ''; }
      }
      const g = game();
      if (g && typeof g._resize === 'function') safe(() => g._resize());
      if (Env.touch && state() === 'edit') fitLevel();
      if (changed) { Perf.detect(); Perf.apply(); applyTouchText(); chipSig = ''; }
      if (!(Env.phone && Env.portrait)) hideRotate(false);
      else maybeRotate();
    }, 120);
  }

  // ------------------------------------------------------------------ gestures (window capture phase)
  const SYN = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  const G = { touches: new Map(), main: null, lpTimer: 0, sim: null };
  function isSyn(e) { return !!(SYN && SYN.has(e)); }
  function offsetOn() { return Env.touch && getSetting('offsetCursor') === true; }
  function aimPoint(m) { return { x: m.x, y: m.y - OFFSET_PX * (m.offK || 0) }; }
  function redispatch(e, pt) {
    const c = canvasEl();
    if (!c || typeof root.PointerEvent !== 'function') return false;
    e.stopImmediatePropagation();
    const ev = new PointerEvent(e.type, {
      bubbles: true, cancelable: true, composed: true, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
      clientX: pt.x, clientY: pt.y, screenX: e.screenX, screenY: e.screenY, button: e.button, buttons: e.buttons,
      width: e.width, height: e.height, pressure: e.pressure, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
    });
    if (SYN) SYN.add(ev);
    c.dispatchEvent(ev);
    return true;
  }
  function editorAttached() { const ed = editor(); return !!(ed && ed._dom); }

  function onDown(e) {
    if (isSyn(e)) return;
    lastPointer = e.pointerType || 'mouse';
    if (e.pointerType !== 'touch') return;
    const c = canvasEl();
    if (e.target !== c) return;
    if (sheetOpen()) toggleSheet(false);
    if (Env.phone && BG.GoalsUI && BG.GoalsUI.isOpen && BG.GoalsUI.isOpen()) safe(() => BG.GoalsUI.setOpen(false, true)); // goals sheet closes like the material sheet
    G.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (G.touches.size === 1) {
      G.main = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t0: now(), moved: false, multi: false, lp: false, offK: 0 };
      clearTimeout(G.lpTimer);
      if (state() === 'edit') {
        G.lpTimer = setTimeout(() => { const m = G.main; if (m && !m.moved && !m.multi) { m.lp = true; haptic('lp'); } }, LONG_PRESS_MS);
      }
    } else {
      if (G.main) G.main.multi = true;
      clearTimeout(G.lpTimer);
      hideLoupe();
    }
    const st = state();
    if ((st === 'sim' || st === 'results') && !editorAttached()) simGesture();
  }
  function onMove(e) {
    if (isSyn(e) || e.pointerType !== 'touch') return;
    const p = G.touches.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const m = G.main;
    if (m && m.id === e.pointerId) {
      m.x = e.clientX; m.y = e.clientY;
      const d = hyp(m.x - m.sx, m.y - m.sy);
      if (!m.moved && d > MOVE_PX) { m.moved = true; clearTimeout(G.lpTimer); }
      if (m.moved && !m.multi && G.touches.size === 1 && state() === 'edit' && offsetOn() && editorBuilding()) {
        m.offK = Math.max(m.offK, clamp((d - MOVE_PX) / 48, 0, 1)); // ease the offset in, never back
        redispatch(e, aimPoint(m));
      }
    }
    const st = state();
    if ((st === 'sim' || st === 'results') && !editorAttached()) simGesture();
  }
  function onUp(e, cancelled) {
    if (isSyn(e) || e.pointerType !== 'touch') return;
    if (!G.touches.has(e.pointerId)) return;
    G.touches.delete(e.pointerId);
    const m = G.main;
    if (m && m.id === e.pointerId) {
      clearTimeout(G.lpTimer);
      m.x = e.clientX; m.y = e.clientY;
      G.main = null;
      hideLoupe();
      const st = state();
      if (!cancelled && st === 'edit' && m.lp && !m.moved && !m.multi) {
        // long press + lift: the editor must not treat this as a tap
        const ed = editor();
        if (ed) safe(() => {
          ed.pointerCancel();
          const dom = ed._dom;
          if (dom) { if (dom.pan) dom.pan.moved = true; if (dom.timer) { clearTimeout(dom.timer); dom.timer = null; } dom.right = null; }
        });
        const x = e.clientX, y = e.clientY;
        setTimeout(() => openCtx(x, y), 0);
      } else if (!cancelled && st === 'edit' && m.offK > 0 && !m.multi) {
        redispatch(e, aimPoint(m));
      }
    }
    if (!G.touches.size) { G.main = null; G.sim = null; }
    else if (G.sim) G.sim = null; // re-seed the camera gesture with the remaining finger(s)
  }
  function editorBuilding() {
    const ed = editor();
    const a = ed && ed._act;
    if (ed && ed._tool === 'arch' && ed._arch && ed._arch.phase === 'drag' && !(ed._dom && ed._dom.pan)) return true; // arch-tool: loupe while dragging a curve
    if (!a || (ed._dom && ed._dom.pan)) return false;
    return a.type === 'drag' || a.type === 'move' || a.type === 'pier' || a.type === 'chainpress' || a.type === 'press';
  }

  // sim / results view: the editor is detached, so pan + pinch the camera here
  function simGesture() {
    const r = renderer(), c = canvasEl();
    if (!r || !c) return;
    const rect = c.getBoundingClientRect();
    const pts = Array.from(G.touches.values());
    if (!pts.length) { G.sim = null; return; }
    if (pts.length >= 2) {
      const a = pts[0], b = pts[1];
      const d = Math.max(1, hyp(a.x - b.x, a.y - b.y)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (!G.sim || G.sim.mode !== 'pinch') { G.sim = { mode: 'pinch', d, mx, my }; return; }
      const f = d / G.sim.d;
      if (typeof r.zoomAt === 'function' && Math.abs(f - 1) > 1e-4) r.zoomAt(mx - rect.left, my - rect.top, f);
      if (typeof r.pan === 'function') r.pan(mx - G.sim.mx, my - G.sim.my);
      G.sim.d = d; G.sim.mx = mx; G.sim.my = my;
      M.simGestures++;
      return;
    }
    const p = pts[0];
    if (!G.sim || G.sim.mode !== 'pan') { G.sim = { mode: 'pan', x: p.x, y: p.y }; return; }
    if (typeof r.pan === 'function') r.pan(p.x - G.sim.x, p.y - G.sim.y);
    G.sim.x = p.x; G.sim.y = p.y;
    M.simGestures++;
  }

  // ------------------------------------------------------------------ loupe + reticle (drawn after each frame)
  function hideLoupe() {
    if (UI.loupe) UI.loupe.classList.remove('show');
    if (UI.reticle) UI.reticle.classList.remove('show');
    M.loupeVisible = false;
  }
  function drawOverlay() {
    const m = G.main;
    if (!UI.loupe || !m || m.multi || G.touches.size !== 1 || state() !== 'edit' || !editorBuilding()) { if (M.loupeVisible || (UI.reticle && UI.reticle.classList.contains('show'))) hideLoupe(); return; }
    const ed = editor();
    const a = ed._act;
    const pt = aimPoint(m);
    // offset reticle
    if (UI.reticle) {
      const showR = m.offK > 0.05;
      UI.reticle.classList.toggle('show', showR);
      if (showR) UI.reticle.style.transform = 'translate(' + Math.round(pt.x) + 'px,' + Math.round(pt.y) + 'px)';
    }
    const wantLoupe = getSetting('loupe') !== false && (m.moved || (a && a.type === 'chainpress') || (ed.state && ed.state.moveArmed));
    if (!wantLoupe) { UI.loupe.classList.remove('show'); M.loupeVisible = false; return; }
    const c = canvasEl();
    const rect = c.getBoundingClientRect();
    if (!rect.width) return;
    const L = UI.loupe;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const S = Math.round(LOUPE * dpr);
    if (L.width !== S) { L.width = S; L.height = S; }
    const g = L.getContext('2d');
    const k = c.width / rect.width;
    const src = (LOUPE / LOUPE_ZOOM) * k;
    const cx = (pt.x - rect.left) * k, cy = (pt.y - rect.top) * k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1b2233';
    g.fillRect(0, 0, S, S);
    safe(() => g.drawImage(c, cx - src / 2, cy - src / 2, src, src, 0, 0, S, S));
    // crosshair
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5 * dpr;
    g.beginPath();
    g.moveTo(S / 2 - 12 * dpr, S / 2); g.lineTo(S / 2 - 4 * dpr, S / 2); g.moveTo(S / 2 + 4 * dpr, S / 2); g.lineTo(S / 2 + 12 * dpr, S / 2);
    g.moveTo(S / 2, S / 2 - 12 * dpr); g.lineTo(S / 2, S / 2 - 4 * dpr); g.moveTo(S / 2, S / 2 + 4 * dpr); g.lineTo(S / 2, S / 2 + 12 * dpr);
    g.stroke();
    // snap feedback: a ring when the beam end is magnetised to a joint
    const gh = ed.state && ed.state.ghost;
    if ((gh && gh.snapNode) || (ed.state && ed.state.mergeTarget)) {
      g.strokeStyle = '#ffd166'; g.lineWidth = 2.5 * dpr;
      g.beginPath(); g.arc(S / 2, S / 2, 9 * dpr, 0, Math.PI * 2); g.stroke();
    }
    // place it above the aim point (or beside it near the top edge), always on screen
    const W = root.innerWidth, H = root.innerHeight;
    let lx = pt.x - LOUPE / 2, ly = pt.y - LOUPE - (m.offK > 0 ? 34 : 70);
    if (ly < 8) { ly = clamp(pt.y - LOUPE / 2, 8, H - LOUPE - 8); lx = pt.x + 60 + LOUPE <= W - 8 ? pt.x + 60 : pt.x - 60 - LOUPE; }
    lx = clamp(lx, 8, W - LOUPE - 8);
    L.style.transform = 'translate(' + Math.round(lx) + 'px,' + Math.round(ly) + 'px)';
    L.classList.add('show');
    M.loupeVisible = true;
    M.loupeFrames++;
  }

  // ------------------------------------------------------------------ long-press context menu
  function hideCtx() { if (UI.ctx) UI.ctx.classList.remove('show'); M.ctxOpen = false; }
  function openCtx(cx, cy) {
    const g = game(), ed = editor(), c = canvasEl();
    if (!g || !ed || !c || !UI.ctx || g.state !== 'edit') return false;
    const rect = c.getBoundingClientRect();
    const w = ed._s2w(cx - rect.left, cy - rect.top);
    const o = { pointerType: 'touch', button: 0 };
    let what = null, title = 'Here';
    const node = safe(() => ed._pickNode(w.x, w.y, ed._pickR(o), (q) => q.kind === 'node'), null);
    if (node) { what = 'joint'; title = 'Joint'; }
    else {
      const bi = safe(() => ed._pickBeam(w.x, w.y, Math.max(0.3, ed._px(16))), null);
      if (bi != null) {
        const b = ed.design.beams[bi];
        const md = (BG.Materials && b && BG.Materials[b.m]) || {};
        what = 'beam'; title = (md.name || (b && b.m) || 'Beam');
      } else {
        const pi = safe(() => ed._pickPier(w.x, w.y), null);
        if (pi != null) { what = 'pier'; title = 'Pier'; }
      }
    }
    const items = [];
    if (what) items.push({ label: 'Delete ' + (what === 'beam' ? 'beam' : what), cls: 'danger', ico: 'trash', fn: () => { ed.chainFrom = null; safe(() => ed.rightClick(w.x, w.y, o)); } });
    if (ed.chainFrom) items.push({ label: 'Stop building', ico: 'close', fn: () => { ed.chainFrom = null; safe(() => ed._refresh()); sfx('click'); } });
    items.push({ label: 'Undo', ico: 'undo', disabled: !(ed.canUndo && ed.canUndo()), fn: () => g.undo() });
    items.push({ label: ed.tool === 'erase' ? 'Build tool' : 'Erase tool', ico: ed.tool === 'erase' ? 'beam' : 'erase', fn: () => { g.setTool(ed.tool === 'erase' ? 'build' : 'erase'); sfx('click'); } });
    items.push({ label: 'Fit view', ico: 'eye', fn: () => { fitLevel(); sfx('click'); } });
    UI.ctx.innerHTML = '<div class="m-ctx-title">' + title + '</div>' +
      items.map((it, i) => '<button class="' + (it.cls || '') + '" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' + icon(it.ico) + '<span>' + it.label + '</span></button>').join('') +
      (what === 'joint' ? '<div class="m-ctx-note">Tip: hold a joint, then drag to move it.</div>' : '');
    UI.ctx.onclick = (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b || b.disabled) return;
      const it = items[+b.dataset.i];
      hideCtx();
      if (it && it.fn) safe(it.fn);
    };
    // position near the finger, on screen
    const W = root.innerWidth, H = root.innerHeight;
    UI.ctx.style.left = '0px'; UI.ctx.style.top = '0px';
    UI.ctx.classList.add('show');
    const r = { width: UI.ctx.offsetWidth, height: UI.ctx.offsetHeight }; // layout size (the open animation scales it)
    const x = clamp(cx + 12, 8, W - r.width - 8), y = clamp(cy - r.height - 16 < 8 ? cy + 16 : cy - r.height - 16, 8, Math.max(8, H - r.height - 8));
    UI.ctx.style.left = Math.round(x) + 'px'; UI.ctx.style.top = Math.round(y) + 'px';
    M.ctxOpen = true; M.ctxTarget = what;
    haptic('ctx');
    return true;
  }

  // ------------------------------------------------------------------ browser gesture guards
  // Containers a finger may scroll; every other touchmove is prevented (no page bounce / pull-to-refresh).
  // Feature screens that scroll must use one of these (SPEC §16.1): level select, templates sheet, modals
  // (settings, daily panel, history), results card, material sheet, tool rail, sim bar, context menu,
  // goals panel, famous history card, the daily 14-day strip and the campaign tabs row.
  const SCROLLERS = '.ls-scroll, .tpl-menu, .modal-card, .results-card, .palette, .rail, .simbar, .m-ctx, ' +
    '.goals-panel, .fb-card, .fb-body, .dly-hist, .camp-tabs, .hist-body, .arch-bar'; // arch-tool: the arch bar scrolls sideways on phones
  function installGuards() {
    const opt = { passive: false };
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => doc.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, opt));
    doc.addEventListener('dblclick', (e) => { if (Env.touch && e.cancelable) e.preventDefault(); }, opt);
    const editable = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable]'));
    doc.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
    doc.addEventListener('contextmenu', (e) => { if (Env.touch && !editable(e.target)) e.preventDefault(); });
    const scroller = (t) => !!(t && t.closest && t.closest(SCROLLERS));
    doc.addEventListener('touchmove', (e) => {
      const t = e.target, c = canvasEl();
      if (!e.cancelable) return;
      if (t === c || (e.touches && e.touches.length > 1 && !editable(t)) || (!scroller(t) && !editable(t))) e.preventDefault();
    }, opt);
    const c = canvasEl();
    if (c) c.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, opt);
  }

  // ------------------------------------------------------------------ hooks into Hud / Game / Editor
  function installHooks() {
    const H = BG.Hud, Gm = BG.Game, EdP = BG.Editor && BG.Editor.prototype;
    // larger joint magnet / pick radius for fingers (editor core stays untouched)
    wrap(EdP, '_magR', (orig) => function (o) {
      const r = orig.apply(this, arguments);
      if (!o || o.pointerType !== 'touch') return r;
      return Math.max(r, Math.min(this._px(TOUCH_MAG_PX), TOUCH_MAG_MAX));
    });
    wrap(EdP, '_pickR', (orig) => function (o) {
      const r = orig.apply(this, arguments);
      if (!o || o.pointerType !== 'touch') return r;
      return Math.max(r, this._px(TOUCH_PICK_PX));
    });
    if (H) {
      wrap(H, 'init', (orig) => function () { const r = orig.apply(this, arguments); safe(buildUi); return r; });
      wrap(H, 'update', (orig) => function () {
        const r = orig.apply(this, arguments);
        if (Env.touch && this.screen === 'level') safe(() => { updateChip(); updatePierCount(); });
        return r;
      });
      wrap(H, 'setMode', (orig) => function (mode) {
        const r = orig.apply(this, arguments);
        if (mode !== 'edit') { toggleSheet(false); hideCtx(); hideLoupe(); }
        return r;
      });
      wrap(H, 'showScreen', (orig) => function (name) {
        const r = orig.apply(this, arguments);
        if (name !== 'level') {
          toggleSheet(false); hideCtx(); hideLoupe(); hideRotate(false);
          if (Env.phone && BG.GoalsUI && BG.GoalsUI.isOpen && BG.GoalsUI.isOpen()) safe(() => BG.GoalsUI.setOpen(false, true));
        }
        return r;
      });
      wrap(H, 'showHint', (orig) => function (text, ms) {
        if (Env.touch) { const lv = this.level; text = touchText(text || (lv && lv.hint) || ''); }
        return orig.call(this, text || null, ms);
      });
      wrap(H, 'toast', (orig) => function (msg, kind, ms) { return orig.call(this, touchText(msg), kind, ms); });
      wrap(H, 'applySettings', (orig) => function () { const r = orig.apply(this, arguments); safe(syncSettingsUi); return r; });
      // Iron Road derail callout: touch wording (docked under the top bar on phones by css/mobile.css)
      wrap(H, 'showDerail', (orig) => function (info) {
        if (Env.touch && info) info = Object.assign({}, info, { cause: touchText(info.cause), advice: touchText(info.advice) });
        return orig.call(this, info);
      });
      // tablets: the derail callout follows the wheel; keep its card clear of the top bar / track strip / sim bar
      wrap(H, '_updateRail', (orig) => function () {
        const r = orig.apply(this, arguments);
        if (Env.tablet) safe(clampDerail);
        return r;
      });
      // results card: a "More below" cue on the sticky action footer while the card has more content under it
      // (badges, bests, a ride card that does not fit); features add blocks after showResults, so re-check a few times
      wrap(H, 'showResults', (orig) => function () {
        const r = orig.apply(this, arguments);
        if (Env.touch) bindResultsMore();
        if (Env.touch) [0, 120, 700, 1600, 2600].forEach((ms) => setTimeout(() => safe(updateResultsMore), ms));
        return r;
      });
      // phones: the goals panel starts closed in every level (goals-ui also checks this on enterLevel)
      wrap(H, 'enterLevel', (orig) => function () {
        const r = orig.apply(this, arguments);
        if (Env.phone && BG.GoalsUI && BG.GoalsUI.isOpen && BG.GoalsUI.isOpen()) safe(() => BG.GoalsUI.setOpen(false, true));
        return r;
      });
    }
    // daily panel: on touch the 14-day strip scrolls sideways; keep the selected day in view
    if (BG.Daily) {
      wrap(BG.Daily, '_renderPanel', (orig) => function () {
        const r = orig.apply(this, arguments);
        if (Env.touch) safe(centerDailyDay);
        return r;
      });
    }
    if (Gm) {
      wrap(Gm, 'openLevel', (orig) => function () {
        const r = orig.apply(this, arguments);
        if (r && Env.touch) { chipSig = ''; toggleSheet(false); scheduleFit(); setTimeout(maybeRotate, 900); }
        return r;
      });
      wrap(Gm, '_render', (orig) => function (dt) {
        const r = orig.apply(this, arguments);
        if (Env.touch || G.main) safe(drawOverlay);
        Perf.sample(dt);
        return r;
      });
      wrap(Gm, 'startSim', (orig) => function () { hideLoupe(); hideCtx(); return orig.apply(this, arguments); });
    }
  }

  function updateResultsMore() {
    const card = doc.querySelector('#screen-level .results-card');
    if (!card) return;
    card.classList.toggle('m-more', card.scrollHeight - card.scrollTop - card.clientHeight > 6);
  }
  let moreBound = false;
  function bindResultsMore() {
    if (moreBound) return;
    moreBound = true;
    doc.addEventListener('scroll', (e) => { if (e.target && e.target.classList && e.target.classList.contains('results-card')) safe(updateResultsMore); }, true);
    root.addEventListener('resize', () => safe(updateResultsMore));
  }

  function clampDerail() {
    const dc = UI.level && $('.derail-callout', UI.level);
    if (!dc || !dc.classList.contains('show')) return;
    const card = dc.firstElementChild, box = card.getBoundingClientRect();
    const vis = (sel) => { const el = $(sel, UI.level); if (!el) return null; const b = el.getBoundingClientRect(); return b.height && getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > 0.05 ? b : null; };
    const top = vis('.topbar'), strip = vis('.track-strip.show'), bar = vis('.simbar');
    let minY = (top ? top.bottom : 0) + 8;
    if (strip && strip.top < root.innerHeight / 2) minY = Math.max(minY, strip.bottom + 8);
    let maxY = (bar ? bar.top : root.innerHeight) - 8;
    if (strip && strip.top >= root.innerHeight / 2) maxY = Math.min(maxY, strip.top - 8);
    let dy = 0;
    if (box.top < minY) dy = minY - box.top;
    else if (box.bottom > maxY) dy = Math.max(minY - box.top, maxY - box.bottom);
    dc.classList.toggle('m-clamped', Math.abs(dy) > 0.5);
    if (Math.abs(dy) > 0.5) {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(dc.style.transform || '');
      if (m) dc.style.transform = 'translate(' + m[1] + 'px,' + Math.round(+m[2] + dy) + 'px)';
    }
  }
  function centerDailyDay() {
    const strip = $('#daily-panel .dly-hist');
    const sel = strip && (strip.querySelector('.dly-day.sel') || strip.lastElementChild);
    if (!strip || !sel || strip.scrollWidth <= strip.clientWidth + 1) return;
    const sr = strip.getBoundingClientRect(), br = sel.getBoundingClientRect();
    strip.scrollLeft += (br.left + br.width / 2) - (sr.left + sr.width / 2);
  }

  // ------------------------------------------------------------------ public API (also used by tools/test-mobile.js)
  const M = BG.Mobile = {
    env: Env, perf: Perf, fullscreen: FS,
    buzzes: 0, loupeFrames: 0, loupeVisible: false, simGestures: 0, ctxOpen: false, ctxTarget: null, lastInsets: null,
    detect, fitLevel, toggleSheet, sheetOpen, openCtx, hideCtx, touchText, haptic,
    settings: { get: getSetting, set: setSetting },
    showRotatePrompt() { rotateSeen = false; sessionSet('span.m.rotateSeen', ''); maybeRotate(); },
    rotatePromptVisible() { return !!(UI.rotate && UI.rotate.classList.contains('show')); },
    scrollers: SCROLLERS,
    constants: { LONG_PRESS_MS, MOVE_PX, OFFSET_PX, TOUCH_MAG_PX, TOUCH_MAG_MAX, TOUCH_PICK_PX },
  };

  // ------------------------------------------------------------------ boot
  detect();
  installPerfHooks();
  installHaptics();
  installHooks();
  Perf.mode = String(getSetting('perfMode') || 'auto');
  Perf.detect();
  Perf.apply();
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointermove', onMove, true);
  root.addEventListener('pointerup', (e) => onUp(e, false), true);
  root.addEventListener('pointercancel', (e) => onUp(e, true), true);
  root.addEventListener('resize', onResize);
  root.addEventListener('orientationchange', onResize);
  function late() {
    installGuards();
    if (BG.Hud && BG.Hud.root) safe(buildUi); // Hud already initialised (script loaded late)
    Perf.mode = String(getSetting('perfMode') || 'auto');
    Perf.detect(); Perf.apply();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(late, 0));
  else late();
})(typeof window !== 'undefined' ? window : globalThis);
