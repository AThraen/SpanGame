/* SPAN — BG.Renderer and BG.Sprites
 * Rich 2D canvas renderer: themed parallax backgrounds, textured terrain, animated water with
 * reflections, per-material beam styling with stress overlay, SVG vehicle sprites, edit overlays.
 *
 * Camera: {x, y, zoom}. (x, y) is the world point (metres, y up) shown at the centre of the
 * canvas; zoom = CSS pixels per metre. screenToWorld / worldToScreen use CSS pixels (same space
 * as mouse offsetX/offsetY). DevicePixelRatio is handled internally.
 *
 * Static layers (sky + background image, parallax hills, props, terrain) are cached in offscreen
 * canvases and only re-rendered when the camera, canvas size or theme assets change.
 */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  // =====================================================================================
  // utilities
  // =====================================================================================
  const TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  const rgbCache = {};
  function hexRgb(h) {
    let c = rgbCache[h];
    if (c) return c;
    let s = String(h).trim();
    if (s[0] === '#') {
      s = s.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      const n = parseInt(s.slice(0, 6), 16);
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else {
      const m = s.match(/[\d.]+/g);
      c = m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
    }
    rgbCache[h] = c;
    return c;
  }
  function mix(a, b, t) {
    const A = hexRgb(a), B = hexRgb(b);
    return 'rgb(' + Math.round(lerp(A[0], B[0], t)) + ',' + Math.round(lerp(A[1], B[1], t)) + ',' + Math.round(lerp(A[2], B[2], t)) + ')';
  }
  function rgba(h, a) { const c = hexRgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function hash(n) {
    n = (n | 0) ^ 0x27d4eb2d;
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  function hash2(i, j, s) { return hash(Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1274126177)); }
  function noise(x, seed) {
    const i = Math.floor(x), f = x - i;
    const a = hash2(i, seed, 7), b = hash2(i + 1, seed, 7);
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }
  function fbm(x, seed, oct) {
    let s = 0, a = 0.5, f = 1, n = 0;
    oct = oct || 4;
    for (let i = 0; i < oct; i++) { s += a * noise(x * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function humanize(r) {
    if (!r) return null;
    r = String(r).replace(/_/g, ' ');
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  // =====================================================================================
  // stress colour ramp: white -> green -> yellow -> orange -> red
  // =====================================================================================
  const STRESS_STOPS = [
    [0.00, [240, 246, 250]],
    [0.30, [96, 214, 112]],
    [0.55, [246, 226, 72]],
    [0.78, [255, 152, 44]],
    [1.00, [255, 54, 44]]
  ];
  const STRESS_BINS = 48;
  const stressBinColors = [];
  function stressRGB(s) {
    s = clamp(Math.abs(s), 0, 1);
    for (let i = 1; i < STRESS_STOPS.length; i++) {
      const a = STRESS_STOPS[i - 1], b = STRESS_STOPS[i];
      if (s <= b[0]) {
        const t = (s - a[0]) / (b[0] - a[0]);
        return [Math.round(lerp(a[1][0], b[1][0], t)), Math.round(lerp(a[1][1], b[1][1], t)), Math.round(lerp(a[1][2], b[1][2], t))];
      }
    }
    return STRESS_STOPS[STRESS_STOPS.length - 1][1];
  }
  for (let i = 0; i <= STRESS_BINS; i++) { const c = stressRGB(i / STRESS_BINS); stressBinColors.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'); }
  function stressColor(s, a) {
    const c = stressRGB(s);
    return a === undefined ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  // =====================================================================================
  // themes
  // =====================================================================================
  const THEMES = {
    meadow: {
      sky: ['#4c9be0', '#8fcdf1', '#e4f4fa'], fog: '#d4ecf5', sun: 'sun',
      layers: [
        { kind: 'mountains', color: '#93bccb', p: 0.06, amp: 0.30, feat: 520, lift: 0.12 },
        { kind: 'hills', color: '#78ad84', p: 0.16, amp: 0.15, feat: 300, lift: 0.04 },
        { kind: 'trees', color: '#4a845a', p: 0.30, amp: 0.07, feat: 200, lift: -0.01, tree: 'mix' }
      ],
      nearTint: '#3f7a4e',
      ground: { top: 'grass', a: '#79c443', b: '#3f8a2c', soil: ['#8b6542', '#4a3322'], strata: ['#9d7452', '#7b5739', '#ab845e', '#6b4b31'], rock: '#9a9384', bed: '#b8a57a' },
      water: ['#68c6e3', '#2d8bb8', '#0f4a6e'], props: 'meadow',
      clouds: { n: 7, color: '#ffffff', shade: '#c4d7e6', alpha: 0.92 }, lights: 0, ambient: 'birds', night: 0
    },
    autumn: {
      sky: ['#6a9fd0', '#e9c79e', '#f8e0bd'], fog: '#efd5b4', sun: 'sun',
      layers: [
        { kind: 'mountains', color: '#b49a8e', p: 0.06, amp: 0.28, feat: 500, lift: 0.12 },
        { kind: 'hills', color: '#c08452', p: 0.16, amp: 0.15, feat: 280, lift: 0.04 },
        { kind: 'trees', color: '#93502f', p: 0.30, amp: 0.07, feat: 190, lift: -0.01, tree: 'round' }
      ],
      nearTint: '#7c4529',
      ground: { top: 'grass', a: '#b3a83f', b: '#6f6b26', soil: ['#86603d', '#46301f'], strata: ['#9a6c47', '#7a5233', '#a87b52', '#634328'], rock: '#9a8d7c', bed: '#ae9a70', leaves: true },
      water: ['#77b9c4', '#3d7f8f', '#1b4651'], props: 'autumn',
      clouds: { n: 6, color: '#fff3e2', shade: '#d8b9a0', alpha: 0.9 }, lights: 0, ambient: 'leaves', night: 0
    },
    desert: {
      sky: ['#3f8fd4', '#94cdeb', '#f5e2b8'], fog: '#f1dcb0', sun: 'sun',
      layers: [
        { kind: 'mesa', color: '#d9b68c', p: 0.06, amp: 0.22, feat: 540, lift: 0.10 },
        { kind: 'dunes', color: '#e3b77b', p: 0.16, amp: 0.12, feat: 340, lift: 0.04 },
        { kind: 'dunes', color: '#cf9a5c', p: 0.30, amp: 0.07, feat: 220, lift: -0.01, tree: 'cactus' }
      ],
      nearTint: '#b9824a',
      ground: { top: 'sand', a: '#ecc580', b: '#c99a55', soil: ['#d39f5e', '#8f5f31'], strata: ['#dcae6f', '#c58f52', '#e5bd82', '#b47c43'], rock: '#b8946a', bed: '#d8be8a' },
      water: ['#5fd0d2', '#2aa0b0', '#136a7c'], props: 'desert',
      clouds: { n: 3, color: '#fffaf0', shade: '#e5d3b8', alpha: 0.75 }, lights: 0, ambient: 'dust', night: 0
    },
    canyon: {
      sky: ['#3a77b8', '#eaa877', '#f8d8a4'], fog: '#efc496', sun: 'sun',
      layers: [
        { kind: 'mesa', color: '#c98a6a', p: 0.06, amp: 0.30, feat: 480, lift: 0.12 },
        { kind: 'mesa', color: '#ac5f3e', p: 0.16, amp: 0.20, feat: 300, lift: 0.05 },
        { kind: 'hills', color: '#8c4a30', p: 0.30, amp: 0.07, feat: 200, lift: -0.01, tree: 'shrub' }
      ],
      nearTint: '#7a3f28',
      ground: { top: 'rock', a: '#c4693c', b: '#8e4426', soil: ['#b45f38', '#5a2a18'], strata: ['#c66f42', '#a24f2c', '#d88a5a', '#8a3f22', '#e3a070'], rock: '#9a5a3c', bed: '#c49a6c', tufts: '#a39a4a' },
      water: ['#57b1c2', '#2b7e92', '#14485a'], props: 'canyon',
      clouds: { n: 4, color: '#fff1e0', shade: '#e2b49a', alpha: 0.85 }, lights: 0, ambient: 'dust', night: 0
    },
    snow: {
      sky: ['#7aa4cf', '#c3dbee', '#f0f6fb'], fog: '#e6eff7', sun: 'sun',
      layers: [
        { kind: 'mountains', color: '#c7d6e6', p: 0.06, amp: 0.34, feat: 460, lift: 0.12, caps: true },
        { kind: 'hills', color: '#d9e5f0', p: 0.16, amp: 0.14, feat: 300, lift: 0.04 },
        { kind: 'trees', color: '#6f8aa3', p: 0.30, amp: 0.06, feat: 190, lift: -0.01, tree: 'snowpine' }
      ],
      nearTint: '#5d7790',
      ground: { top: 'snow', a: '#fbfdff', b: '#c9dbeb', soil: ['#7c8794', '#3d4550'], strata: ['#8a95a2', '#6d7884', '#99a4b0', '#5f6873'], rock: '#8e98a3', bed: '#9fb3bf' },
      water: ['#8fd0e6', '#4c97b8', '#1d5672'], props: 'snow',
      clouds: { n: 6, color: '#ffffff', shade: '#ccd9e6', alpha: 0.9 }, lights: 0, ambient: 'snow', night: 0
    },
    night: {
      sky: ['#050a1c', '#11204a', '#2d3f75'], fog: '#2a3a68', sun: 'moon',
      layers: [
        { kind: 'mountains', color: '#1f2c52', p: 0.06, amp: 0.28, feat: 500, lift: 0.12 },
        { kind: 'hills', color: '#18233f', p: 0.16, amp: 0.14, feat: 300, lift: 0.04 },
        { kind: 'trees', color: '#101a2f', p: 0.30, amp: 0.07, feat: 190, lift: -0.01, tree: 'pine' }
      ],
      nearTint: '#0f182b',
      ground: { top: 'grass', a: '#3a6a4c', b: '#1c3a2a', soil: ['#3c3448', '#17131d'], strata: ['#463d52', '#352e40', '#51475e', '#2c2636'], rock: '#565266', bed: '#3e4a5e' },
      water: ['#29507f', '#173562', '#0a1a38'], props: 'night',
      clouds: { n: 4, color: '#4a5a86', shade: '#232e52', alpha: 0.55 }, lights: 1, ambient: 'fireflies', night: 1, stars: true
    },
    city: {
      sky: ['#26386e', '#d77f6e', '#f6c08c'], fog: '#e7a787', sun: 'sunset',
      layers: [
        { kind: 'city', color: '#7d6f8c', p: 0.06, amp: 0.30, feat: 60, lift: 0.10 },
        { kind: 'city', color: '#544b67', p: 0.16, amp: 0.20, feat: 46, lift: 0.04, windows: true },
        { kind: 'hills', color: '#3a344a', p: 0.30, amp: 0.04, feat: 200, lift: -0.01, tree: 'round' }
      ],
      nearTint: '#2e2a3c',
      ground: { top: 'concrete', a: '#b9b6b0', b: '#85827d', soil: ['#77706a', '#38332f'], strata: ['#837b73', '#6e665f', '#8f877e', '#5f5852'], rock: '#8a837b', bed: '#6f6c66' },
      water: ['#4d8aa6', '#255f7c', '#0e344a'], props: 'city',
      clouds: { n: 5, color: '#ffd9c2', shade: '#b4788a', alpha: 0.8 }, lights: 0.75, ambient: 'none', night: 0.25
    },
    tropical: {
      sky: ['#1f9ce6', '#79d3f3', '#dcf7f4'], fog: '#c9eff0', sun: 'sun',
      layers: [
        { kind: 'mountains', color: '#7cc0b0', p: 0.06, amp: 0.28, feat: 440, lift: 0.12 },
        { kind: 'hills', color: '#4aa881', p: 0.16, amp: 0.15, feat: 260, lift: 0.04 },
        { kind: 'trees', color: '#227c58', p: 0.30, amp: 0.06, feat: 180, lift: -0.01, tree: 'palm' }
      ],
      nearTint: '#1d6b4b',
      ground: { top: 'grass', a: '#5fcc45', b: '#2b8f3a', soil: ['#9b6c43', '#4f3420'], strata: ['#b07c4e', '#8e6038', '#c08d5b', '#7a5231'], rock: '#9c9284', bed: '#e8d39a' },
      water: ['#3fe0d8', '#14a9b8', '#07617c'], props: 'tropical',
      clouds: { n: 6, color: '#ffffff', shade: '#bfe0ea', alpha: 0.92 }, lights: 0, ambient: 'birds', night: 0
    },
    volcanic: {
      sky: ['#140b10', '#3e1a17', '#9b3a1c'], fog: '#6a2a1c', sun: 'none',
      layers: [
        { kind: 'volcano', color: '#3a2524', p: 0.06, amp: 0.36, feat: 480, lift: 0.12 },
        { kind: 'mountains', color: '#2a1b1c', p: 0.16, amp: 0.16, feat: 280, lift: 0.04 },
        { kind: 'hills', color: '#1c1213', p: 0.30, amp: 0.06, feat: 200, lift: -0.01, tree: 'dead' }
      ],
      nearTint: '#1a1011',
      ground: { top: 'basalt', a: '#3b3433', b: '#1f1a1a', soil: ['#3a302e', '#140f0f'], strata: ['#463a37', '#2e2624', '#54443f', '#241c1b'], rock: '#4c4241', bed: '#2a1a14', cracks: true },
      water: ['#ffb43c', '#ff5a14', '#8a1a06'], lava: true, props: 'volcanic',
      clouds: { n: 5, color: '#5a3a36', shade: '#2a1818', alpha: 0.75 }, lights: 0.6, ambient: 'embers', night: 0.3
    }
  };
  function themeOf(id) { return THEMES[id] || THEMES.meadow; }

  // =====================================================================================
  // sprites
  // =====================================================================================
  const SPRITE_META = {
    // vehicle sprites: viewBox in cm, origin bottom-left at rear bumper on the ground line
    car: { w: 420, h: 150 }, van: { w: 530, h: 230 }, bus: { w: 1200, h: 340 }, truck: { w: 950, h: 370 },
    semi: { w: 1650, h: 400 }, tanker: { w: 1700, h: 395 }, heavy: { w: 1400, h: 370 },
    wheel: { w: 100, h: 100 }, wheel_heavy: { w: 100, h: 100 }, anchor: { w: 128, h: 128 }, joint: { w: 64, h: 64 }
  };
  // light / exhaust anchor points in sprite cm (x from rear, y up from ground)
  const VEHICLE_FX = {
    car: { head: [414, 72], tail: [12, 74], exhaust: [6, 24] },
    van: { head: [520, 106], tail: [10, 128], exhaust: [6, 27] },
    bus: { head: [1190, 88], tail: [12, 100], exhaust: [28, 30] },
    truck: { head: [940, 100], tail: [12, 146], exhaust: [655, 366] },
    semi: { head: [1640, 114], tail: [16, 162], exhaust: [1411, 392] },
    tanker: { head: [1690, 114], tail: [28, 174], exhaust: [1459, 388] },
    heavy: { head: [1390, 126], tail: [18, 194], exhaust: [1120, 290] }
  };

  const HEAVY_WHEEL_TYPES = { bus: 1, truck: 1, semi: 1, tanker: 1, heavy: 1 };

  // ---- railway rolling stock (assets/sprites/rail/*.svg), SPEC §9.4 ----
  // Same coordinate rules as road sprites: viewBox in cm, origin bottom-left = rear of the car on the
  // rail-top line, facing right; the renderer scales by def.length / (w / 100). Wheels and bogie frames
  // are separate sprites. All anchor points below are sprite cm (x from rear, y up from the rail top).
  //   wheel / driver: wheel sprite names; head / tail: lamp points; chimney / exhaust / panto: emitters;
  //   skirt: body hides the wheel tops; bellows: [y0, y1] gangway between coupled cars of this kind;
  //   nose: directional car (a trailing one is drawn mirrored); underframe: [x0, x1, y0, y1] dark frame
  //   plate drawn behind the wheels (steam); steam: crosshead guide height / slide-bar end (cm);
  //   lever: handcar pump pivot; noFrame: bogie indices drawn without a bogie side frame.
  const RAIL_META = {
    handcar: { w: 260, h: 160, wheel: 'rail_wheel_spoked', head: [254, 109], tail: [4, 46], lever: [130, 148], noFrame: { 0: 1, 1: 1 } },
    tram: { w: 1400, h: 400, wheel: 'rail_wheel', head: [1386, 139], tail: [14, 139], skirt: true, panto: [690, 392], bidir: true },
    loco_steam: { w: 1250, h: 430, wheel: 'rail_wheel_spoked', driver: 'rail_driver', head: [1218, 187], tail: [6, 100], chimney: [1136, 428],
      cocks: [835, 40], underframe: [176, 1196, 36, 156], steam: { guideY: 88, slideEnd: 768 }, noFrame: { 0: 1 } },
    tender: { w: 750, h: 340, wheel: 'rail_wheel_spoked', tail: [6, 140] },
    coach: { w: 1700, h: 370, wheel: 'rail_wheel_spoked', bellows: [136, 326], tail: [8, 150] },
    loco_diesel: { w: 1900, h: 430, wheel: 'rail_wheel', head: [1872, 251], tail: [28, 251], exhaust: [1012, 426], bidir: true },
    boxcar: { w: 1400, h: 400, wheel: 'rail_wheel', tail: [8, 150] },
    tank_wagon: { w: 1200, h: 370, wheel: 'rail_wheel', tail: [8, 150] },
    ore_wagon: { w: 1000, h: 300, wheel: 'rail_wheel', tail: [8, 150] },
    hs_power: { w: 2000, h: 470, wheel: 'rail_wheel', head: [1952, 150], tail: [1952, 150], skirt: true, nose: true, bellows: [80, 330], panto: [471, 464] },
    hs_coach: { w: 2000, h: 390, wheel: 'rail_wheel', skirt: true, bellows: [80, 330], tail: [10, 150] }
  };
  const RAIL_SPRITES = ['handcar', 'tram', 'loco_steam', 'tender', 'coach', 'loco_diesel', 'boxcar', 'tank_wagon', 'ore_wagon', 'hs_power', 'hs_coach',
    'rail_wheel', 'rail_wheel_spoked', 'rail_driver', 'bogie', 'bogie3', 'handcar_lever'];
  (function () {
    for (const t in RAIL_META) SPRITE_META['rail/' + t] = { w: RAIL_META[t].w, h: RAIL_META[t].h };
    SPRITE_META['rail/rail_wheel'] = SPRITE_META['rail/rail_wheel_spoked'] = SPRITE_META['rail/rail_driver'] = { w: 108, h: 108 };
    SPRITE_META['rail/bogie'] = { w: 300, h: 80 };
    SPRITE_META['rail/bogie3'] = { w: 460, h: 80 };
    SPRITE_META['rail/handcar_lever'] = { w: 250, h: 40 };
  })();
  // nominal geometry of the bogie sprites: axle spacing (cm), origin offset inside the image, wheel radius
  const BOGIE_ART = {
    bogie: { span: 200, w: 300, h: 80, ox: 150, oy: 50, r: 42 },
    bogie3: { span: 340, w: 460, h: 80, ox: 230, oy: 50, r: 50 }
  };
  const WHEEL_ART_SCALE = 1.08; // rail wheel sprites include the flange: image = 1.08 x tread diameter
  const DRIVER_CRANK = 0.54;    // crank pin radius / tread radius on rail_driver.svg

  const Sprites = {
    base: null,
    names: ['car', 'van', 'bus', 'truck', 'semi', 'tanker', 'heavy', 'wheel', 'wheel_heavy', 'anchor', 'joint'].concat(RAIL_SPRITES.map(function (n) { return 'rail/' + n; })),
    images: {}, ok: {}, failed: {}, meta: SPRITE_META, fx: VEHICLE_FX,
    _raster: {}, _rasterCount: 0, version: 0,
    path: function () { return (this.base !== null ? this.base : ((BG.assetBase || '') + 'assets/sprites/')); },
    load: function (name) {
      if (this.images[name] || typeof Image === 'undefined') return;
      const img = new Image();
      const self = this;
      img.onload = function () { self.ok[name] = true; self.version++; };
      img.onerror = function () { self.failed[name] = true; };
      img.src = this.path() + name + '.svg';
      this.images[name] = img;
    },
    preload: function () { for (const n of this.names) this.load(n); },
    get: function (name) { this.load(name); return this.ok[name] ? this.images[name] : null; },
    // rasterised copy at a bucketed pixel width (keeps aspect). Returns canvas or null.
    raster: function (name, pxW) {
      const img = this.get(name);
      if (!img) return null;
      const meta = SPRITE_META[name] || { w: img.naturalWidth || 100, h: img.naturalHeight || 100 };
      let bw = Math.max(16, Math.ceil(pxW / 16) * 16);
      if (bw > 160) bw = Math.ceil(160 * Math.pow(1.12, Math.ceil(Math.log(pxW / 160) / Math.log(1.12))) / 16) * 16;
      if (bw > 4096) bw = 4096;
      const key = name + '|' + bw;
      let c = this._raster[key];
      if (c) return c;
      if (this._rasterCount > 260) { this._raster = {}; this._rasterCount = 0; }
      const bh = Math.max(1, Math.round(bw * meta.h / meta.w));
      c = mkCanvas(bw, bh);
      try { c.getContext('2d').drawImage(img, 0, 0, bw, bh); } catch (e) { return null; }
      this._raster[key] = c;
      this._rasterCount++;
      return c;
    }
  };
  BG.Sprites = BG.Sprites || Sprites;
  try { Sprites.preload(); } catch (e) { /* no DOM */ }

  // background images (assets/bg/<theme>.jpg, fallback .png)
  const bgImages = {};
  function loadBg(theme, onload) {
    let rec = bgImages[theme];
    if (rec) { if (rec.ok) onload(); else rec.cbs.push(onload); return rec; }
    rec = bgImages[theme] = { img: null, ok: false, failed: false, cbs: [onload] };
    if (typeof Image === 'undefined') { rec.failed = true; return rec; }
    const base = (BG.assetBase || '') + 'assets/bg/' + theme;
    const exts = ['.jpg', '.png', '.webp'];
    let i = 0;
    const tryNext = function () {
      if (i >= exts.length) { rec.failed = true; return; }
      const img = new Image();
      img.onload = function () { rec.img = img; rec.ok = true; const cbs = rec.cbs; rec.cbs = []; cbs.forEach(function (f) { f(); }); };
      img.onerror = function () { i++; tryNext(); };
      img.src = base + exts[i];
    };
    tryNext();
    return rec;
  }

  // =====================================================================================
  // material styles
  // =====================================================================================
  const MSTYLE = {
    road: { kind: 'road', w: 0.45, deck: '#3d4148', deckLo: '#2a2d33', kerb: '#d6d9de', mark: '#f3f1e4', under: '#24272c' },
    reinforced_road: { kind: 'road', w: 0.55, deck: '#3a3f48', deckLo: '#262a31', kerb: '#eef1f4', mark: '#ffcc3a', under: '#4b6178', girder: true },
    wood: { kind: 'wood', w: 0.26, base: '#c38c50', dark: '#5f3b1e', light: '#ecc186', grain: '#8f5d31' },
    steel: { kind: 'steel', w: 0.3, base: '#8899ad', dark: '#36414f', light: '#d6e0ea', rivet: '#4e5a68' },
    rope: { kind: 'rope', w: 0.08, base: '#d2ac70', dark: '#6f5430', light: '#f1dcab' },
    cable: { kind: 'cable', w: 0.1, base: '#3a3f47', dark: '#15181c', light: '#c2cad4' },
    // railway (SPEC §9.2): ballasted track deck hanging below the rail-top line, stone voussoirs, box girder
    rail: { kind: 'rail', w: 0.72, rail: '#c3ccd6', railDark: '#56616e', sleeper: '#5e4330', sleeperLo: '#3a2819',
      ballast: '#8d877b', ballastLo: '#5f594f', deck: '#7f8486', deckLo: '#55595b', under: '#3b3f42' },
    masonry: { kind: 'masonry', w: 0.95, mortar: '#cfc6b1', dark: '#4c4237', stones: ['#b9a588', '#a8957a', '#c4b296', '#9c8a70', '#b19c7e'], light: '#efe3c8' },
    girder: { kind: 'girder', w: 0.62, base: '#4f6178', dark: '#1e2733', light: '#a9b9cc', rivet: '#2b3644' }
  };
  const KIND_ORDER = ['cable', 'rope', 'steel', 'girder', 'masonry', 'wood', 'road', 'rail'];
  function isDeck(st) { return st.kind === 'road' || st.kind === 'rail'; }
  function matStyle(m) {
    let st = MSTYLE[m];
    const def = BG.Materials && BG.Materials[m];
    if (!st) {
      const base = (def && def.color) || '#8899ad';
      st = MSTYLE[m] = def && def.isRail
        ? Object.assign({}, MSTYLE.rail)
        : def && def.isRoad
        ? { kind: 'road', w: 0.45, deck: base, deckLo: mix(base, '#000000', 0.3), kerb: '#e0e0e0', mark: '#f3f1e4', under: '#24272c' }
        : def && def.tensionOnly
          ? { kind: 'cable', w: 0.1, base: base, dark: mix(base, '#000000', 0.5), light: mix(base, '#ffffff', 0.5) }
          : { kind: 'steel', w: 0.3, base: base, dark: mix(base, '#000000', 0.55), light: mix(base, '#ffffff', 0.55), rivet: mix(base, '#000000', 0.4) };
    }
    if (!st._wSet) {
      st._wSet = true;
      if (def && def.width > 0) st.w = def.width;
    }
    return st;
  }

  // =====================================================================================
  // props (y-up local units: base at (0,0), height 1)
  // =====================================================================================
  function pPine(ctx, c1, c2, snow) {
    ctx.fillStyle = '#4a3423'; ctx.fillRect(-0.035, 0, 0.07, 0.2);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const y0 = 0.14 + i * 0.2, w = 0.3 - i * 0.06, top = y0 + 0.34;
      ctx.fillStyle = i % 2 ? c1 : c2;
      ctx.beginPath(); ctx.moveTo(-w, y0); ctx.lineTo(0, top); ctx.lineTo(w, y0); ctx.closePath(); ctx.fill();
      if (snow) {
        ctx.fillStyle = '#f4f9ff';
        ctx.beginPath(); ctx.moveTo(-w * 0.55, top - (top - y0) * 0.45); ctx.lineTo(0, top); ctx.lineTo(w * 0.55, top - (top - y0) * 0.45);
        ctx.quadraticCurveTo(0, top - (top - y0) * 0.3, -w * 0.55, top - (top - y0) * 0.45); ctx.fill();
      }
    }
  }
  function pRound(ctx, c1, c2, trunk) {
    ctx.fillStyle = trunk || '#5a3d27';
    ctx.beginPath(); ctx.moveTo(-0.04, 0); ctx.lineTo(-0.025, 0.5); ctx.lineTo(0.025, 0.5); ctx.lineTo(0.04, 0); ctx.fill();
    ctx.fillStyle = c2;
    blob(ctx, 0, 0.62, 0.3, 0.3);
    ctx.fillStyle = c1;
    blob(ctx, -0.06, 0.7, 0.22, 0.24);
  }
  function blob(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.ellipse(x - rx * 0.6, y - ry * 0.25, rx * 0.65, ry * 0.65, 0, 0, TAU);
    ctx.ellipse(x + rx * 0.6, y - ry * 0.2, rx * 0.6, ry * 0.62, 0, 0, TAU);
    ctx.fill();
  }
  function pPalm(ctx, c1, c2) {
    ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0.12, 0.5, 0.06, 0.9); ctx.stroke();
    ctx.fillStyle = c1;
    for (let i = 0; i < 6; i++) {
      const a = -0.3 + i * 0.75 + (i > 2 ? 0.6 : 0);
      const dx = Math.cos(a) * 0.4, dy = Math.sin(a) * 0.18;
      ctx.beginPath(); ctx.moveTo(0.06, 0.9);
      ctx.quadraticCurveTo(0.06 + dx * 0.6, 0.98 + Math.abs(dy) + 0.05, 0.06 + dx, 0.86 + dy - 0.12);
      ctx.quadraticCurveTo(0.06 + dx * 0.5, 0.92 + dy * 0.3, 0.06, 0.88); ctx.fill();
    }
    ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(0.06, 0.88, 0.035, 0, TAU); ctx.fill();
  }
  function pCactus(ctx, c1, c2) {
    ctx.fillStyle = c2;
    roundRect(ctx, -0.06, 0, 0.12, 0.85, 0.06); ctx.fill();
    roundRect(ctx, -0.25, 0.3, 0.09, 0.32, 0.045); ctx.fill();
    roundRect(ctx, -0.25, 0.3, 0.22, 0.08, 0.04); ctx.fill();
    roundRect(ctx, 0.15, 0.4, 0.09, 0.3, 0.045); ctx.fill();
    roundRect(ctx, 0.03, 0.4, 0.2, 0.08, 0.04); ctx.fill();
    ctx.fillStyle = c1; ctx.fillRect(-0.02, 0.05, 0.03, 0.75);
  }
  function pShrub(ctx, c1, c2) {
    ctx.fillStyle = c2; blob(ctx, 0, 0.12, 0.3, 0.14);
    ctx.fillStyle = c1; blob(ctx, -0.05, 0.16, 0.18, 0.09);
  }
  function pDead(ctx, c1) {
    ctx.strokeStyle = c1; ctx.lineCap = 'round';
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.02, 0.6); ctx.lineTo(-0.18, 0.9); ctx.moveTo(0.02, 0.6); ctx.lineTo(0.2, 0.85);
    ctx.moveTo(0.01, 0.35); ctx.lineTo(0.16, 0.5); ctx.moveTo(-0.1, 0.75); ctx.lineTo(-0.2, 0.72); ctx.stroke();
  }
  function pLamp(ctx, pole, head) {
    ctx.fillStyle = pole;
    ctx.fillRect(-0.02, 0, 0.04, 0.95);
    ctx.fillRect(-0.02, 0.93, 0.22, 0.03);
    ctx.fillStyle = head;
    ctx.beginPath(); ctx.moveTo(0.12, 0.93); ctx.lineTo(0.26, 0.93); ctx.lineTo(0.23, 0.9); ctx.lineTo(0.15, 0.9); ctx.fill();
  }
  function pRock(ctx, c1, c2) {
    ctx.fillStyle = c2;
    ctx.beginPath(); ctx.moveTo(-0.5, 0); ctx.lineTo(-0.38, 0.32); ctx.lineTo(-0.05, 0.5); ctx.lineTo(0.3, 0.38); ctx.lineTo(0.5, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c1;
    ctx.beginPath(); ctx.moveTo(-0.38, 0.32); ctx.lineTo(-0.05, 0.5); ctx.lineTo(0.3, 0.38); ctx.lineTo(0.0, 0.3); ctx.closePath(); ctx.fill();
  }
  function pBuilding(ctx, w, h, col, win, lit, seed) {
    // base at 0, width w, height h (world units already)
    ctx.fillStyle = col;
    ctx.fillRect(-w / 2, 0, w, h);
    ctx.fillStyle = mix(col, '#000000', 0.25);
    ctx.fillRect(w / 2 - w * 0.12, 0, w * 0.12, h);
    const cols = Math.max(2, Math.floor(w / 1.4)), rows = Math.max(2, Math.floor(h / 1.6));
    const cw = w / cols;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows - 1; j++) {
      const on = hash2(i + seed * 13, j, 99) < lit;
      ctx.fillStyle = on ? win : 'rgba(20,24,40,0.55)';
      ctx.fillRect(-w / 2 + i * cw + cw * 0.25, 0.8 + j * 1.6, cw * 0.5, 0.8);
    }
  }

  // =====================================================================================
  // Renderer
  // =====================================================================================
  const M = 32; // cache margin in CSS px (lets shake move layers without revealing edges)

  function Renderer(canvas, opts) {
    if (!(this instanceof Renderer)) return new Renderer(canvas, opts);
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { x: 0, y: 0, zoom: 20 };
    this.insets = opts.insets || { top: 76, bottom: 136, left: 28, right: 28 };
    this.dpr = 1; this.W = 0; this.H = 0;
    this.level = null; this.themeId = 'meadow'; this.theme = THEMES.meadow;
    this.time = 0; this._lastNow = 0;
    this.effects = BG.Effects ? new BG.Effects() : null;
    this._back = mkCanvas(2, 2); this._mid = mkCanvas(2, 2); this._par = mkCanvas(2, 2); this._refl = mkCanvas(2, 2);
    this._backKey = ''; this._midKey = ''; this._parKey = ''; this._midAnchor = null; this._midPad = { X: 0, Y: 0 }; this._visPadX = 0; this._visPadY = 0; this._bgRec = null; this._bgVersion = 0;
    this._vstate = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    this._val = { sig: '', res: null };
    this._lamps = [];
    this._clouds = null;
    this._ambient = [];
    this._vignette = null; this._vigKey = '';
    this.quality = opts.quality || 'high';
    this.stats = { frameMs: 0, beams: 0 };
    this.resize();
  }
  const R = Renderer.prototype;

  // ------------------------------------------------------------------- sizing / camera
  R.resize = function () {
    const c = this.canvas;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    let W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) { W = Math.round(c.width / dpr) || 960; H = Math.round(c.height / dpr) || 540; }
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw; c.height = bh;
      if (!c.style.width) { c.style.width = W + 'px'; c.style.height = H + 'px'; }
    }
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      this._backKey = this._midKey = '';
    }
  };
  R.worldToScreen = function (x, y) {
    const c = this.camera;
    if (typeof x === 'object') { y = x.y; x = x.x; }
    return { x: this.W / 2 + (x - c.x) * c.zoom, y: this.H / 2 - (y - c.y) * c.zoom };
  };
  R.screenToWorld = function (px, py) {
    const c = this.camera;
    if (typeof px === 'object') { py = px.y; px = px.x; }
    return { x: c.x + (px - this.W / 2) / c.zoom, y: c.y - (py - this.H / 2) / c.zoom };
  };
  R.zoomAt = function (px, py, factor) {
    if (this._followActive && this._follow) { // while following, the wheel scales the follow zoom
      this._follow.zoomMul = clamp(this._follow.zoomMul * factor, 0.3, 4);
      return;
    }
    const before = this.screenToWorld(px, py);
    this.camera.zoom = clamp(this.camera.zoom * factor, 2, 160);
    const after = this.screenToWorld(px, py);
    this.camera.x += before.x - after.x; this.camera.y += before.y - after.y;
  };
  R.pan = function (dxPx, dyPx) {
    if (this._followActive && this._follow) { // a drag while following peeks around; it eases back
      this._follow.offX -= dxPx / this.camera.zoom; this._follow.offY += dyPx / this.camera.zoom;
    }
    this.camera.x -= dxPx / this.camera.zoom; this.camera.y += dyPx / this.camera.zoom;
  };

  // ------------------------------------------------------------------- camera follow (SPEC §9.4)
  // r.follow(target) - target: true / 'lead' (default: the lead vehicle or train of the running sim),
  // a sim vehicle / train object, any {x, y} object, or a function(state) -> {x, y, len?}.
  // r.follow(null | false) stops. Only active in sim / results renders (edit keeps a free camera).
  // While following, zoomAt() scales the comfortable follow zoom and pan() offsets the view.
  R.follow = function (target, opts) {
    if (target === undefined) target = true;
    if (!target) { this._follow = null; this._followActive = false; this.following = false; return this; }
    const prev = this._follow;
    this._follow = { target, opts: opts || {}, zoomMul: prev ? prev.zoomMul : 1, offX: 0, offY: 0, vx: 0, vy: 0, last: null };
    this.following = true;
    return this;
  };
  R.setFollow = function (on) { return this.follow(on ? true : null); };
  R.isFollowing = function () { return !!this._follow; };

  // focus of one vehicle: {x, y (rail / road level), front, len, wreck}
  R._vehicleFocus = function (v) {
    if (!v) return null;
    if (isTrainVehicle(v)) {
      const cars = v.cars || [];
      let lead = null, last = null, wreck = null;
      for (let i = 0; i < cars.length; i++) {
        const P = this._railPose(cars[i], railDef(cars[i]), i, cars.length);
        if (!P) continue;
        if (!lead) lead = P;
        last = P;
        if (!wreck && (cars[i].state === 'derailed' || cars[i].derailed)) wreck = P;
      }
      if (!lead) return null;
      if (wreck || v.state === 'derailed') {
        const P = wreck || lead;
        return { x: P.ox + P.c * P.Lm / 2, y: P.oy, front: P.ox + P.c * P.Lm, rear: last.ox, len: P.Lm, wreck: true };
      }
      return { x: lead.ox + lead.c * lead.Lm / 2, y: lead.oy, front: lead.ox + lead.c * lead.Lm, rear: Math.min(last.ox, last.ox + last.c * last.Lm), len: lead.Lm };
    }
    if (v.wheels || v.def) {
      const def = this._vehDef(v), P = this._vehPose(v, def);
      if (!isFinite(P.ox)) return null;
      return { x: P.ox + Math.cos(P.ang) * P.Lm / 2, y: P.oy, front: P.ox + Math.cos(P.ang) * P.Lm, rear: P.ox, len: P.Lm, wreck: v.state === 'fallen' };
    }
    if (Number.isFinite(v.x) && Number.isFinite(v.y)) return { x: v.x, y: v.y, front: v.x, len: v.len || 6 };
    return null;
  };
  R._followFocus = function (state) {
    const F = this._follow, t = F.target, sim = state.sim;
    if (typeof t === 'function') { try { const f = t(state); return f ? Object.assign({ front: f.x, len: 6 }, f) : null; } catch (e) { return null; } }
    if (t && typeof t === 'object') return this._vehicleFocus(t);
    if (!sim || !sim.vehicles) return null;
    // the first vehicle still (partly) before the far bank leads - a train before road traffic (on the
    // double-deck levels the train is the load that matters); a wreck always wins
    let best = null, bestTrain = null, any = null;
    const re = this.level.terrain.rightEdge;
    for (const v of sim.vehicles) {
      if (!v || v.state === 'waiting' || v.state === 'finished') continue;
      const f = this._vehicleFocus(v);
      if (!f) continue;
      if (f.wreck) return f;
      if (!any) any = f;
      if (!(f.rear > re + 1)) {
        if (!best) best = f;
        if (!bestTrain && isTrainVehicle(v)) bestTrain = f;
      }
    }
    return bestTrain || best || any;
  };
  R._updateFollow = function (state, dt) {
    const F = this._follow, cam = this.camera, L = this.level;
    this._followActive = true;
    let f = this._followFocus(state);
    if (!f) { if (!F.last) return; f = F.last; }
    if (F.last && dt > 0) {
      const k = clamp(dt * 4, 0, 1);
      const fvx = f === F.last ? 0 : (f.front - F.last.front) / dt;
      F.vx = isFinite(fvx) && Math.abs(fvx) < 400 ? lerp(F.vx, fvx, k) : F.vx;
      if (Math.abs(f.front - F.last.front) > 30) F.vx = 0; // switched to another vehicle
    }
    F.last = f;
    const W = this.W || 1280, H = this.H || 720, ins = this.insets;
    const aw = Math.max(100, W - ins.left - ins.right), ah = Math.max(100, H - ins.top - ins.bottom);
    const b = this.levelBounds();
    const fitZ = clamp(Math.min(aw / (b.x1 - b.x0), ah / (b.y1 - b.y0)), 2, 120);
    const speed = Math.abs(F.vx);
    const vw = clamp(34 + 1.6 * Math.min(f.len || 6, 25) + speed * 1.2, 40, 110);
    let zt = clamp(clamp(aw / vw, fitZ, 60) * F.zoomMul, Math.min(fitZ, 2), 160);
    // dead band: hold the target zoom until the wanted one drifts > 6 % away, so speed jitter does not
    // re-zoom (and re-render the cached scenery) every frame
    if (!F.zq || Math.abs(Math.log(zt / F.zq)) > 0.06) F.zq = zt;
    zt = F.zq;
    const kz = 1 - Math.exp(-dt * 2.2);
    cam.zoom += (zt - cam.zoom) * kz;
    if (Math.abs(zt - cam.zoom) < zt * 0.003) cam.zoom = zt;
    const z = cam.zoom, vwz = aw / z, vhz = ah / z;
    // keep the lead vehicle at ~70 % of the view; stop at the far bank so the crossing stays in frame
    let ax = f.wreck ? f.x : f.front - vwz * 0.2;
    let clamped = false;
    const t = L.terrain;
    if (!f.wreck && ax > t.rightEdge + vwz * 0.22) { ax = t.rightEdge + vwz * 0.22; clamped = true; }
    const ay = f.y - vhz * 0.06;
    F.offX *= Math.exp(-dt * 0.5); F.offY *= Math.exp(-dt * 0.5);
    const sxm = ins.left + aw / 2, sym = ins.top + ah / 2;
    const tx = ax - (sxm - W / 2) / z + F.offX, ty = ay - (H / 2 - sym) / z + F.offY;
    const kp = 1 - Math.exp(-dt * 3.2);
    if (!clamped && !f.wreck) cam.x += F.vx * dt;
    cam.x += (tx - cam.x) * kp;
    cam.y += (ty - cam.y) * kp;
  };
  R.levelBounds = function () {
    const L = this.level;
    if (!L) return { x0: -10, x1: 10, y0: -10, y1: 10 };
    const t = L.terrain;
    const top = Math.max(t.leftY, t.rightY);
    const ba = L.buildArea || { x0: t.leftEdge - 2, x1: t.rightEdge + 2, y0: t.floorY, y1: top + 10 };
    const x0 = Math.min(ba.x0, t.leftEdge - 7), x1 = Math.max(ba.x1, t.rightEdge + 7);
    const lowRef = (t.waterY !== null && t.waterY !== undefined) ? t.waterY - 2.5 : t.floorY - 1;
    // the floor may be cropped: show at most a few metres below the build area (and the water line)
    const y0 = Math.min(ba.y0, Math.max(lowRef, top - 0.9 * (x1 - x0), ba.y0 - 4));
    const y1 = Math.max(ba.y1, top + 7); // room for the tallest vehicles + a margin under the top bar
    return { x0, x1, y0, y1 };
  };
  R.fitToLevel = function (opts) {
    this.resize();
    const b = this.levelBounds();
    const ins = Object.assign({}, this.insets, opts || {});
    const W = this.W || 1280, H = this.H || 720;
    const aw = Math.max(100, W - ins.left - ins.right), ah = Math.max(100, H - ins.top - ins.bottom);
    const z = clamp(Math.min(aw / (b.x1 - b.x0), ah / (b.y1 - b.y0)), 2, 120);
    const sxm = ins.left + aw / 2, sym = ins.top + ah / 2;
    this.camera.zoom = z;
    this.camera.x = (b.x0 + b.x1) / 2 - (sxm - W / 2) / z;
    this.camera.y = (b.y0 + b.y1) / 2 - (H / 2 - sym) / z;
    this._backKey = this._midKey = '';
    return this.camera;
  };

  // ------------------------------------------------------------------- level
  R.setLevel = function (level, opts) {
    this.level = level;
    if (!level) return;
    this.themeId = THEMES[level.theme] ? level.theme : 'meadow';
    this.theme = themeOf(this.themeId);
    const self = this;
    this._bgRec = loadBg(this.themeId, function () { self._bgVersion++; self._backKey = self._midKey = ''; });
    this._buildTerrain();
    this._initRail(level);
    this._clouds = null;
    this._initAmbient();
    if (this.effects && this.effects.setLevel) {
      this.effects.setLevel(level, function (x) { return self.groundY(x); });
    }
    this._backKey = this._midKey = '';
    this._val = { sig: '', res: null };
    if (!opts || opts.fit !== false) this.fitToLevel();
  };

  R._buildTerrain = function () {
    const L = this.level, t = L.terrain;
    const le = t.leftEdge, re = t.rightEdge, ly = t.leftY, ry = t.rightY;
    let fy = t.floorY;
    if (!(fy < Math.min(ly, ry) - 0.5)) fy = Math.min(ly, ry) - 0.5;
    const seed = (typeof L.id === 'number' ? L.id : String(L.id || L.name || 'x').length * 7) * 31 + 5;
    const ABUT = 2.6;
    const cliff = function (edge, topY, side) { // side -1 left bank (cliff goes toward +x), +1 right bank
      const pts = [{ x: edge, y: topY }, { x: edge, y: topY - ABUT }];
      const depth = topY - fy;
      const n = Math.max(2, Math.ceil((depth - ABUT) / 0.9));
      for (let i = 1; i <= n; i++) {
        const y = topY - ABUT - (depth - ABUT) * (i / n);
        const d = topY - y;
        const nn = (fbm(d * 0.35, seed + (side < 0 ? 3 : 9), 3) - 0.5) * 1.1;
        let off = 0.12 + (d - ABUT) * 0.07 + nn;
        if (i === n) off = Math.max(off, 0.6 + (d - ABUT) * 0.07); // a little scree at the toe
        off = Math.max(0.05, off);
        pts.push({ x: edge - side * off, y });
      }
      return pts;
    };
    const left = cliff(le, ly, -1), right = cliff(re, ry, 1);
    const fl = left[left.length - 1].x, fr = right[right.length - 1].x;
    const floor = [];
    const zones = L.pierZones || [];
    const span = Math.max(0.5, fr - fl);
    const nF = Math.max(2, Math.ceil(span / 1.5));
    for (let i = 0; i <= nF; i++) {
      const x = fl + span * i / nF;
      let amp = 0.25;
      for (const z of zones) if (x > z.x0 - 2 && x < z.x1 + 2) amp = 0.02;
      floor.push({ x, y: fy + (fbm(x * 0.12, seed + 21, 3) - 0.5) * 2 * amp });
    }
    floor[0].y = fy; floor[floor.length - 1].y = fy;
    this.terrain = { le, re, ly, ry, fy, left, right, floor, seed, ABUT };
    // world-space Path2D
    const p = new Path2D();
    const far = 2000, bottom = fy - 600;
    p.moveTo(le - far, bottom); p.lineTo(le - far, ly);
    for (const q of left) p.lineTo(q.x, q.y);
    for (const q of floor) p.lineTo(q.x, q.y);
    for (let i = right.length - 1; i >= 0; i--) p.lineTo(right[i].x, right[i].y);
    p.lineTo(re + far, ry); p.lineTo(re + far, bottom); p.closePath();
    this.terrainPath = p;
  };
  // railway look for this level: track on the banks, scenery, catenary (SPEC §9.4)
  R._initRail = function (level) {
    const traffic = level.traffic || [];
    const trains = traffic.filter(function (t) { return t && t.type === 'train'; });
    const roads = traffic.filter(function (t) { return t && t.type !== 'train'; });
    const rail = level.campaign === 'rail' || trains.length > 0;
    this._railBank = rail ? (roads.length ? 'street' : 'track') : null;
    this._signals = [];
    this._trainPv = null;
    if (!rail) { this._railDecor = null; return; }
    const presets = trains.map(function (t) { return String(t.train || ''); });
    const decor = level.decor || {};
    const hs = presets.some(function (p) { return p.indexOf('highspeed') === 0; });
    const tram = presets.some(function (p) { return p === 'tram'; });
    let cat = decor.catenary !== undefined ? !!decor.catenary : (hs || tram);
    this._railDecor = {
      heritage: decor.heritage !== undefined ? !!decor.heritage : presets.some(function (p) { return /^(handcar|steam)/.test(p); }) || (!hs && !presets.length),
      catenary: cat, wire: hs || !tram ? 4.65 : 3.95,
      station: String(decor.station || level.name || 'SPAN').toUpperCase()
    };
  };

  function profileX(pts, y) { // x of a cliff profile at height y
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if ((y <= a.y && y >= b.y) || (y >= a.y && y <= b.y)) {
        const t = (a.y === b.y) ? 0 : (y - a.y) / (b.y - a.y);
        return a.x + (b.x - a.x) * t;
      }
    }
    return pts[pts.length - 1].x;
  }
  // top surface height of terrain at x (for debris / particles)
  R.groundY = function (x) {
    const T = this.terrain;
    if (!T) return -1e9;
    if (x <= T.le) return T.ly;
    if (x >= T.re) return T.ry;
    // in the gap: cliff faces are nearly vertical, so the floor is the ground
    const fl = T.floor;
    if (x < fl[0].x) { // over the left cliff toe
      for (let i = 1; i < T.left.length; i++) if (T.left[i].x >= x) return T.left[i].y;
      return T.fy;
    }
    if (x > fl[fl.length - 1].x) {
      for (let i = 1; i < T.right.length; i++) if (T.right[i].x <= x) return T.right[i].y;
      return T.fy;
    }
    for (let i = 1; i < fl.length; i++) if (fl[i].x >= x) {
      const a = fl[i - 1], b = fl[i];
      return a.y + (b.y - a.y) * ((x - a.x) / ((b.x - a.x) || 1));
    }
    return T.fy;
  };

  // ------------------------------------------------------------------- transforms
  R._worldXf = function (ctx, ox, oy) { // ox, oy in CSS px
    const c = this.camera, d = this.dpr, z = c.zoom * d;
    ctx.setTransform(z, 0, 0, -z, (this.W / 2 - c.x * c.zoom + (ox || 0)) * d, (this.H / 2 + c.y * c.zoom + (oy || 0)) * d);
  };
  R._screenXf = function (ctx, ox, oy) { const d = this.dpr; ctx.setTransform(d, 0, 0, d, (ox || 0) * d, (oy || 0) * d); };
  R._visibleWorld = function (margin) {
    margin = margin || 0;
    const mx = margin + (this._visPadX || 0), my = margin + (this._visPadY || 0);
    const a = this.screenToWorld(-mx, -my), b = this.screenToWorld(this.W + mx, this.H + my);
    return { x0: a.x, x1: b.x, y0: b.y, y1: a.y };
  };

  // =====================================================================================
  // BACK LAYER: sky gradient, background painting, sun / moon
  // =====================================================================================
  R._ensureBack = function () {
    const c = this.camera, d = this.dpr;
    const key = this.W + 'x' + this.H + '@' + d + '|' + this.themeId + '|' + this._bgVersion + '|' +
      Math.round(c.x * c.zoom * 0.04) + ',' + Math.round(c.y * c.zoom * 0.05) + ',' + c.zoom.toFixed(2);
    if (key === this._backKey) return;
    this._backKey = key;
    const cw = Math.round((this.W + 2 * M) * d), ch = Math.round((this.H + 2 * M) * d);
    if (this._back.width !== cw || this._back.height !== ch) { this._back.width = cw; this._back.height = ch; }
    const g = this._back.getContext('2d');
    g.setTransform(d, 0, 0, d, M * d, M * d);
    const W = this.W, H = this.H, th = this.theme;
    // sky
    const sg = g.createLinearGradient(0, -M, 0, H + M);
    sg.addColorStop(0, th.sky[0]); sg.addColorStop(0.55, th.sky[1]); sg.addColorStop(1, th.sky[2]);
    g.fillStyle = sg; g.fillRect(-M, -M, W + 2 * M, H + 2 * M);
    const rec = this._bgRec;
    const hasImg = rec && rec.ok && rec.img;
    if (!hasImg) this._drawSunMoon(g, true);
    if (hasImg) {
      const img = rec.img;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const top = Math.max(this.terrain ? this.terrain.ly : 0, this.terrain ? this.terrain.ry : 0);
      const groundSy = this.worldToScreen(0, top).y;
      const s = Math.max((W + 2 * M) * 1.06 / iw, (H + 2 * M) * 1.04 / ih);
      const dw = iw * s, dh = ih * s;
      // place the painting's ground line (~86% down) slightly below the bank tops, parallax-softened
      // put the painting's main silhouettes (~78% down the image) just above the bank tops
      const targetY = lerp(H * 0.62, groundSy + H * 0.02, 0.75);
      let y = Math.min(-M, targetY - dh * 0.78);
      let x = (W - dw) / 2 - clamp(c.x * c.zoom * 0.04, -1e5, 1e5) % 1e9;
      x = clamp(x, W + M - dw, -M);
      g.drawImage(img, x, y, dw, dh);
      // atmospheric tint so the painting sits behind the scene
      g.fillStyle = rgba(th.fog, th.night ? 0.06 : 0.1);
      g.fillRect(-M, -M, W + 2 * M, H + 2 * M);
      this._drawSunMoon(g, false);
    }
    this._hasBgImg = !!hasImg;
  };
  R._drawSunMoon = function (g, full) {
    const th = this.theme, W = this.W, H = this.H;
    const c = this.camera;
    const sx = W * 0.8 - c.x * c.zoom * 0.01 % W, sy = H * 0.17;
    if (th.sun === 'sun' || th.sun === 'sunset') {
      const sunset = th.sun === 'sunset';
      const r = Math.min(W, H) * (sunset ? 0.07 : 0.045);
      const y = sunset ? H * 0.42 : sy;
      const glow = g.createRadialGradient(sx, y, 0, sx, y, r * (full ? 9 : 6));
      glow.addColorStop(0, sunset ? 'rgba(255,214,150,0.75)' : 'rgba(255,250,225,0.8)');
      glow.addColorStop(0.25, sunset ? 'rgba(255,170,110,0.28)' : 'rgba(255,245,210,0.25)');
      glow.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = glow; g.fillRect(sx - r * 10, y - r * 10, r * 20, r * 20);
      if (full) {
        const disc = g.createRadialGradient(sx - r * 0.3, y - r * 0.3, 0, sx, y, r);
        disc.addColorStop(0, '#fffef6'); disc.addColorStop(1, sunset ? '#ffc27a' : '#fff1c2');
        g.fillStyle = disc; g.beginPath(); g.arc(sx, y, r, 0, TAU); g.fill();
      }
    } else if (th.sun === 'moon') {
      const r = Math.min(W, H) * 0.04;
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, r * 7);
      glow.addColorStop(0, 'rgba(200,220,255,0.35)'); glow.addColorStop(1, 'rgba(160,190,255,0)');
      g.fillStyle = glow; g.fillRect(sx - r * 8, sy - r * 8, r * 16, r * 16);
      if (full) {
        const disc = g.createRadialGradient(sx - r * 0.35, sy - r * 0.35, 0, sx, sy, r);
        disc.addColorStop(0, '#fbfcff'); disc.addColorStop(1, '#c9d4ea');
        g.fillStyle = disc; g.beginPath(); g.arc(sx, sy, r, 0, TAU); g.fill();
        g.fillStyle = 'rgba(140,155,190,0.35)';
        [[0.3, -0.2, 0.22], [-0.25, 0.3, 0.16], [-0.1, -0.4, 0.1], [0.35, 0.4, 0.12]].forEach(function (k) {
          g.beginPath(); g.arc(sx + k[0] * r, sy + k[1] * r, k[2] * r, 0, TAU); g.fill();
        });
      }
    }
  };

  // =====================================================================================
  // MID LAYER: parallax hills, bank props, terrain
  // =====================================================================================
  // The mid layer is split in two caches:
  //  - _par: the parallax hills (screen sized; they move at their own parallax rate),
  //  - _mid: world-space scenery (valley, props, rail decor, terrain), drawn around an anchor camera.
  //    While the camera follows the traffic, _mid is rendered with a margin (X, Y px) and blitted with
  //    a translation, so it is only rebuilt when the camera has moved past the margin or zoomed -
  //    not every frame (the follow zoom is held in a dead band for the same reason).
  R._ensureMid = function () {
    const c = this.camera, d = this.dpr;
    if (!this._midKey) this._parKey = '';
    this._ensurePar();
    const fol = !!this._followActive;
    const X = fol ? Math.round(this.W * 0.25) : 0, Y = fol ? Math.round(this.H * 0.12) : 0;
    const key = this.W + 'x' + this.H + '@' + d + '|' + this.themeId + '|' + this._bgVersion + '|' + (X ? 'follow' : c.zoom.toFixed(4)) + '|' + (this.level && this.level.id) + '|' + X + ',' + Y;
    const A = this._midAnchor, tNow = now();
    const settled = this._prevZoom === c.zoom;
    this._prevZoom = c.zoom;
    if (key === this._midKey && A) {
      // following: reuse the cache while the view stays inside its margin; during a follow zoom
      // transition it is drawn scaled (re-rendered every 0.25 s and once the zoom has settled)
      const s = c.zoom / A.z, ls = Math.abs(Math.log(s));
      const ox = (c.x - A.x) * c.zoom, oy = (c.y - A.y) * c.zoom;
      const inside = Math.abs(ox) <= X * 0.8 - (s < 1 ? (1 / s - 1) * this.W : 0) && Math.abs(oy) <= Y * 0.8 - (s < 1 ? (1 / s - 1) * this.H : 0);
      if (inside && (s === 1 || (X > 0 && ls < 0.1 && !settled && tNow - A.t < 250))) return;
    }
    this._midKey = key;
    this._midAnchor = { x: c.x, y: c.y, z: c.zoom, t: tNow };
    this._midPad = { X, Y };
    const t0 = now();
    const cw = Math.round((this.W + 2 * M + 2 * X) * d), ch = Math.round((this.H + 2 * M + 2 * Y) * d);
    if (this._mid.width !== cw || this._mid.height !== ch) { this._mid.width = cw; this._mid.height = ch; }
    const g = this._mid.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    this._lamps = [];
    // world-space content (the culling in these helpers widens by the margin via _visibleWorld)
    const z = c.zoom * d;
    g.setTransform(z, 0, 0, -z, (this.W / 2 + M + X - c.x * c.zoom) * d, (this.H / 2 + M + Y + c.y * c.zoom) * d);
    this._visPadX = X; this._visPadY = Y;
    try {
      this._drawValleyBack(g);
      this._drawProps(g);
      if (this._railDecor) this._drawRailDecor(g);
      this._drawTerrain(g);
    } finally { this._visPadX = 0; this._visPadY = 0; }
    this.stats.midMs = now() - t0;
  };
  R._ensurePar = function () {
    const c = this.camera, d = this.dpr;
    const top = this.terrain ? Math.max(this.terrain.ly, this.terrain.ry) : 0;
    const key = this.W + 'x' + this.H + '@' + d + '|' + this.themeId + '|' + this._bgVersion + '|' + (this._hasBgImg ? 1 : 0) + '|' + (this.level && this.level.id) + '|' +
      Math.round(c.x * c.zoom * 4) + ',' + Math.round(this.worldToScreen(0, top).y * 4) + ',' + c.zoom.toFixed(4);
    if (key === this._parKey) return;
    this._parKey = key;
    const cw = Math.round((this.W + 2 * M) * d), ch = Math.round((this.H + 2 * M) * d);
    if (this._par.width !== cw || this._par.height !== ch) { this._par.width = cw; this._par.height = ch; }
    const g = this._par.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    this._drawParallax(g);
  };

  R._layerHeight = function (Lr, u, seed) {
    switch (Lr.kind) {
      case 'mountains': {
        const r = 1 - Math.abs(fbm(u, seed, 4) * 2 - 1);
        return Math.pow(r, 1.6) * 0.85 + fbm(u * 2.3, seed + 5, 3) * 0.15;
      }
      case 'volcano': {
        const base = Math.pow(1 - Math.abs(fbm(u, seed, 4) * 2 - 1), 1.8) * 0.45;
        const k = ((u % 6) + 6) % 6 - 3; // a big cone every 6 units
        const cone = Math.max(0, 1 - Math.abs(k) / 1.6);
        const crater = Math.abs(k) < 0.22 ? (0.22 - Math.abs(k)) * 0.6 : 0;
        return Math.max(base, cone * 0.98 - crater);
      }
      case 'mesa': {
        const n = fbm(u, seed, 3);
        const q = smooth((n - 0.42) * 6);
        return q * 0.8 + fbm(u * 3, seed + 3, 2) * 0.12 + 0.05;
      }
      case 'dunes': {
        const a = Math.sin(u * 2.1 + Math.sin(u * 0.7) * 1.4);
        return 0.35 + 0.35 * a * Math.abs(a) * 0.5 + fbm(u, seed, 3) * 0.4;
      }
      default:
        return fbm(u, seed, 4);
    }
  };

  R._drawParallax = function (g) {
    const th = this.theme, W = this.W, H = this.H, d = this.dpr, c = this.camera;
    g.setTransform(d, 0, 0, d, M * d, M * d);
    const top = this.terrain ? Math.max(this.terrain.ly, this.terrain.ry) : 0;
    const groundSy = this.worldToScreen(0, top).y;
    let layers = th.layers;
    if (this._hasBgImg) layers = [Object.assign({}, th.layers[th.layers.length - 1], { color: th.nearTint, p: 0.4, amp: 0.05, lift: -0.02, alpha: 1 })];
    const seedBase = (this.terrain ? this.terrain.seed : 1);
    for (let li = 0; li < layers.length; li++) {
      const Lr = layers[li];
      const p = Lr.p;
      const baseY = lerp(H * 0.62, groundSy, clamp(p * 2.4, 0, 1)) - Lr.lift * H;
      const amp = Lr.amp * H;
      const off = c.x * c.zoom * p;
      const seed = seedBase + li * 101;
      const fogT = this._hasBgImg ? 0 : (1 - li / Math.max(1, layers.length - 1)) * 0.25;
      const col = mix(Lr.color, th.fog, fogT);
      if (Lr.kind === 'city') { this._drawCityLayer(g, Lr, baseY, amp, off, seed, col); continue; }
      const step = 6;
      g.beginPath();
      const img = this._hasBgImg;
      const bot = img ? baseY + H * 0.06 : H + M;
      g.moveTo(-M, bot);
      const pts = [];
      for (let sx = -M; sx <= W + M + step; sx += step) {
        const u = (sx + off) / Lr.feat;
        const h = this._layerHeight(Lr, u, seed);
        const y = baseY - h * amp;
        pts.push(sx, y);
        g.lineTo(sx, y);
      }
      g.lineTo(W + M, bot);
      g.closePath();
      const gr = g.createLinearGradient(0, baseY - amp, 0, img ? bot : baseY + H * 0.25);
      gr.addColorStop(0, mix(col, '#ffffff', th.night ? 0.04 : 0.12));
      gr.addColorStop(img ? 0.55 : 0.5, col);
      gr.addColorStop(1, img ? rgba(col, 0) : mix(col, th.fog, 0.35));
      g.fillStyle = gr;
      g.fill();
      if (Lr.caps) { // snow caps
        g.save(); g.clip();
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.beginPath();
        for (let i = 0; i < pts.length; i += 2) { const y = pts[i + 1]; i === 0 ? g.moveTo(pts[i], y) : g.lineTo(pts[i], y); }
        for (let i = pts.length - 2; i >= 0; i -= 2) g.lineTo(pts[i], Math.min(pts[i + 1] + amp * 0.18 * (0.6 + 0.4 * noise(pts[i] * 0.05, 3)), baseY - amp * 0.55));
        g.closePath(); g.fill();
        g.restore();
      }
      if (Lr.kind === 'volcano') { // glowing craters
        for (let i = 2; i < pts.length - 2; i += 2) {
          const u = (pts[i] + off) / Lr.feat; const k = ((u % 6) + 6) % 6 - 3;
          if (Math.abs(k) < 0.05) {
            const gl = g.createRadialGradient(pts[i], pts[i + 1], 0, pts[i], pts[i + 1], amp * 0.6);
            gl.addColorStop(0, 'rgba(255,140,50,0.7)'); gl.addColorStop(1, 'rgba(255,80,20,0)');
            g.fillStyle = gl; g.fillRect(pts[i] - amp, pts[i + 1] - amp, amp * 2, amp * 2);
            g.fillStyle = 'rgba(40,20,20,0.35)';
            for (let s = 0; s < 4; s++) { g.beginPath(); g.ellipse(pts[i] + s * 18, pts[i + 1] - 30 - s * 34, 26 + s * 14, 16 + s * 6, 0, 0, TAU); g.fill(); }
            break;
          }
        }
      }
      if (Lr.tree) this._drawLayerTrees(g, Lr, pts, off, seed, col, amp);
      if (Lr.alpha === undefined) {
        // soft haze at the base of each layer
        const hz = g.createLinearGradient(0, baseY - amp * 0.2, 0, baseY + 30);
        hz.addColorStop(0, rgba(th.fog, 0));
        hz.addColorStop(1, rgba(th.fog, th.night ? 0.12 : 0.28));
        g.fillStyle = hz; g.fillRect(-M, baseY - amp * 0.2, W + 2 * M, H);
      }
    }
  };
  R._drawLayerTrees = function (g, Lr, pts, off, seed, col, amp) {
    const kind = Lr.tree;
    const spacing = kind === 'cactus' ? 70 : kind === 'shrub' || kind === 'dead' ? 46 : 16;
    const c1 = mix(col, '#ffffff', 0.06), c2 = col;
    const i0 = Math.floor((-M + off) / spacing) - 1, i1 = Math.ceil((this.W + M + off) / spacing) + 1;
    for (let i = i0; i <= i1; i++) {
      const r = hash2(i, seed, 5);
      if (kind !== 'mix' && kind !== 'pine' && kind !== 'snowpine' && r < 0.35) continue;
      if ((kind === 'mix' || kind === 'pine' || kind === 'snowpine' || kind === 'round' || kind === 'palm') && noise(i * 0.09, seed) < 0.38) continue;
      const sx = i * spacing - off + (r - 0.5) * spacing * 0.8;
      const idx = clamp(Math.round((sx + M) / 6), 0, pts.length / 2 - 1) * 2;
      const y = pts[idx + 1] + 2;
      const h = (kind === 'palm' ? 46 : kind === 'cactus' ? 26 : kind === 'shrub' ? 14 : kind === 'dead' ? 30 : 26) * (0.6 + r * 0.8) * (this.H / 900);
      g.save();
      g.translate(sx, y);
      g.scale(h, -h);
      switch (kind) {
        case 'pine': case 'snowpine': pPine(g, c1, c2, false); break;
        case 'mix': (r < 0.55 ? pPine : pRound)(g, c1, c2, c2); break;
        case 'round': pRound(g, c1, c2, c2); break;
        case 'palm': pPalm(g, c2, c2); break;
        case 'cactus': pCactus(g, c2, c2); break;
        case 'shrub': pShrub(g, c2, c2); break;
        case 'dead': pDead(g, c2); break;
      }
      g.restore();
    }
  };
  R._drawCityLayer = function (g, Lr, baseY, amp, off, seed, col) {
    const W = this.W, H = this.H, th = this.theme;
    const bw = Lr.feat;
    const i0 = Math.floor((-M + off) / bw) - 1, i1 = Math.ceil((W + M + off) / bw) + 1;
    g.fillStyle = col;
    g.fillRect(-M, baseY - 2, W + 2 * M, H);
    for (let i = i0; i <= i1; i++) {
      const r = hash2(i, seed, 1), r2 = hash2(i, seed, 2);
      const x = i * bw - off;
      const w = bw * (0.7 + r2 * 0.5);
      const h = amp * (0.25 + Math.pow(r, 1.5) * 0.85);
      g.fillStyle = col;
      g.fillRect(x, baseY - h, w, h + 2);
      if (r > 0.75) { g.fillRect(x + w * 0.45, baseY - h - amp * 0.12, w * 0.08, amp * 0.12); }
      if (r2 > 0.6) { g.fillRect(x + w * 0.2, baseY - h - 8, w * 0.6, 8); }
      if (Lr.windows) {
        const rows = Math.floor(h / 9), cols = Math.max(1, Math.floor(w / 8));
        for (let a = 0; a < cols; a++) for (let b = 1; b < rows; b++) {
          const k = hash2(i * 31 + a, b, seed);
          if (k < 0.62) continue;
          g.fillStyle = k > 0.93 ? 'rgba(255,236,170,0.95)' : 'rgba(255,214,140,0.6)';
          g.fillRect(x + a * 8 + 3, baseY - h + b * 9, 3, 4);
        }
      }
    }
    const hz = g.createLinearGradient(0, baseY - amp, 0, baseY + 20);
    hz.addColorStop(0, rgba(th.fog, 0)); hz.addColorStop(1, rgba(th.fog, 0.32));
    g.fillStyle = hz; g.fillRect(-M, baseY - amp, W + 2 * M, amp + H);
  };

  // receding valley walls seen through the gap (depth backdrop behind the cliffs)
  R._drawValleyBack = function (g) {
    const T = this.terrain; if (!T) return;
    const th = this.theme, G = th.ground;
    const span = T.re - T.le;
    const top = Math.min(T.ly, T.ry) - 0.2;
    const depth = Math.max(1, top - T.fy);
    const hz = g.createLinearGradient(0, top, 0, T.fy - 2);
    const nearC = th.nearTint || th.layers[th.layers.length - 1].color;
    if (this._hasBgImg) { hz.addColorStop(0, rgba(mix(nearC, th.fog, 0.55), 0)); hz.addColorStop(0.3, rgba(mix(nearC, th.fog, 0.55), 0.75)); }
    else hz.addColorStop(0, mix(nearC, th.fog, 0.55));
    hz.addColorStop(1, mix(mix(G.soil[1], nearC, 0.4), th.fog, 0.45));
    g.fillStyle = hz;
    g.fillRect(T.le - 1, T.fy - 60, span + 2, top - T.fy + 60.5);
    const wy = this.level.terrain.waterY;
    if (wy !== null && wy !== undefined && wy > T.fy) {
      const wc = th.water;
      const wg = g.createLinearGradient(0, wy, 0, T.fy);
      wg.addColorStop(0, mix(wc[0], th.fog, 0.45)); wg.addColorStop(1, mix(wc[1], th.fog, 0.3));
      g.fillStyle = wg;
      g.fillRect(T.le - 1, T.fy - 60, span + 2, wy - T.fy + 60);
      g.fillStyle = rgba('#ffffff', 0.35);
      g.fillRect(T.le - 1, wy - 0.08, span + 2, 0.08);
    }
    const layers = [
      { k: 0.5, fog: 0.55, dark: 0.1, seed: 31 },
      { k: 0.3, fog: 0.3, dark: 0.25, seed: 37 }
    ];
    for (const Ly of layers) {
      const pts = [];
      const n = Math.max(6, Math.ceil(depth / 0.8));
      const reach = Math.min(span * Ly.k, depth * 1.6);
      for (let i = 0; i <= n; i++) {
        const t = i / n, y = top - depth * t - 0.5;
        const nn = (fbm(t * 6 + Ly.seed, T.seed + Ly.seed, 3) - 0.5) * Math.min(4, span * 0.06);
        pts.push({ x: T.le + reach * Math.pow(t, 0.8) + nn + 0.4, y });
      }
      const rp = [];
      for (let i = n; i >= 0; i--) {
        const t = i / n, y = top - depth * t - 0.5;
        const nn = (fbm(t * 6 + Ly.seed + 50, T.seed + Ly.seed, 3) - 0.5) * Math.min(4, span * 0.06);
        rp.push({ x: T.re - reach * Math.pow(t, 0.8) - nn - 0.4, y });
      }
      g.beginPath();
      g.moveTo(T.le, T.ly - 0.3);
      for (const q of pts) g.lineTo(q.x, q.y);
      g.lineTo(pts[pts.length - 1].x, T.fy - 50);
      g.lineTo(rp[0].x, T.fy - 50);
      for (const q of rp) g.lineTo(q.x, q.y);
      g.lineTo(T.re, T.ry - 0.3);
      g.lineTo(T.re, T.fy - 50); g.lineTo(T.le, T.fy - 50);
      g.closePath();
      const gr = g.createLinearGradient(0, top, 0, T.fy);
      gr.addColorStop(0, mix(mix(G.soil[0], G.strata[1], 0.5), th.fog, Ly.fog));
      gr.addColorStop(1, mix(mix(G.soil[1], '#000000', Ly.dark), th.fog, Ly.fog * 0.7));
      g.fillStyle = gr;
      g.fill();
      // lit rim along the wall profiles
      g.strokeStyle = rgba(mix(G.strata[2], '#ffffff', 0.3), 0.18); g.lineWidth = 0.3;
      g.beginPath(); pts.forEach(function (q, i) { i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke();
      g.beginPath(); rp.forEach(function (q, i) { i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke();
      // faint receding strata
      g.save(); g.clip();
      g.strokeStyle = rgba(th.fog, 0.18); g.lineWidth = 0.25;
      for (let y = top - 1.5; y > T.fy; y -= 1.8 + hash(Math.round(y * 10)) * 1.5) {
        g.beginPath(); g.moveTo(T.le, y); g.lineTo(T.re, y + (hash(Math.round(y)) - 0.5) * 0.8); g.stroke();
      }
      g.restore();
    }
  };

  // props standing on the bank tops (behind the road)
  R._drawProps = function (g) {
    const T = this.terrain; if (!T) return;
    const th = this.theme, v = this._visibleWorld(M + 40);
    const kind = th.props;
    const seed = T.seed;
    const G = th.ground;
    const self = this;
    const cell = 5.5;
    const z = this.camera.zoom;
    const each = function (x0, x1, y, side) {
      const i0 = Math.floor(Math.max(x0, v.x0 - 10) / cell), i1 = Math.ceil(Math.min(x1, v.x1 + 10) / cell);
      for (let i = i0; i <= i1; i++) {
        const r = hash2(i, seed, 41 + side);
        const x = i * cell + r * cell * 0.7;
        if (x > x1 || x < x0) continue;
        self._prop(g, kind, x, y, r, hash2(i, seed, 77), G, th);
      }
    };
    each(-1e5, T.le - 4.5, T.ly, 0);
    each(T.re + 4.5, 1e5, T.ry, 1);
    // lamps along the road (city / night)
    if (kind === 'city' || kind === 'night') {
      const sp = 16;
      const lamp = function (x0, x1, y, dir) {
        const i0 = Math.floor(Math.max(x0, v.x0 - 5) / sp), i1 = Math.ceil(Math.min(x1, v.x1 + 5) / sp);
        for (let i = i0; i <= i1; i++) {
          const x = i * sp + 3;
          if (x > x1 || x < x0) continue;
          g.save(); g.translate(x, y); g.scale(7 * dir, 7);
          pLamp(g, '#2c3038', '#3a3f48');
          g.restore();
          self._lamps.push({ x: x + 0.2 * 7 * dir * 0.95, y: y + 7 * 0.9 });
        }
      };
      lamp(-1e5, T.le - 2, T.ly, 1);
      lamp(T.re + 2, 1e5, T.ry, -1);
    }
    // valley floor props (dry floors only)
    const t = this.level.terrain;
    const wet = t.waterY !== null && t.waterY !== undefined;
    if (!wet && T.floor.length > 2 && z > 3) {
      const zones = this.level.pierZones || [];
      for (let i = 1; i < T.floor.length - 1; i++) {
        const q = T.floor[i];
        const r = hash2(i, seed, 63);
        if (r > 0.45) continue;
        let inZone = false;
        for (const zz of zones) if (q.x > zz.x0 - 1.5 && q.x < zz.x1 + 1.5) inZone = true;
        if (inZone) continue;
        const k = (kind === 'desert' || kind === 'canyon' || kind === 'volcanic') ? 'rocksmall' : 'bush';
        g.save(); g.translate(q.x, q.y - 0.05);
        if (k === 'bush') { g.scale(1.6 + r * 2, 1.6 + r * 2); pShrub(g, mix(G.a, '#ffffff', 0.1), G.b); }
        else { g.scale(1 + r * 2.2, 0.8 + r * 1.4); pRock(g, mix(G.rock, '#ffffff', 0.15), G.rock); }
        g.restore();
      }
    }
  };
  R._prop = function (g, kind, x, y, r, r2, G, th) {
    const h = 4 + r2 * 6;
    g.save();
    g.translate(x, y - 0.3);
    const night = th.night >= 1;
    const dk = function (c) { return night ? mix(c, '#0a1022', 0.55) : c; };
    switch (kind) {
      case 'meadow':
        g.scale(h, h);
        if (r < 0.45) pPine(g, dk('#3f8a4f'), dk('#2f6e3d'), false);
        else if (r < 0.8) pRound(g, dk('#6cb24c'), dk('#4a8f39'));
        else { g.scale(0.5, 0.35); pShrub(g, dk('#79c454'), dk('#4b8f36')); }
        break;
      case 'autumn':
        g.scale(h, h);
        if (r < 0.35) pRound(g, '#e8862e', '#c3561f');
        else if (r < 0.65) pRound(g, '#f0b13a', '#d0811f');
        else if (r < 0.85) pRound(g, '#c9442a', '#93301f');
        else pPine(g, '#56743c', '#3f5a2c', false);
        break;
      case 'desert':
        if (r < 0.5) { g.scale(h * 0.7, h * 0.7); pCactus(g, '#7aa04a', '#5a8a3a'); }
        else if (r < 0.75) { g.scale(1.5 + r2 * 2, 1.2 + r2); pRock(g, '#d2a874', '#ad7f4f'); }
        break;
      case 'canyon':
        if (r < 0.4) { g.scale(2 + r2 * 2, 1.4 + r2); pRock(g, '#c7764a', '#94502f'); }
        else if (r < 0.75) { g.scale(2.2, 2.2); pShrub(g, '#a8a050', '#7d7a36'); }
        else { g.scale(h * 0.6, h * 0.6); pDead(g, '#6e4a33'); }
        break;
      case 'snow':
        g.scale(h, h);
        if (r < 0.75) pPine(g, '#3f6a5a', '#2f5547', true);
        else { g.scale(0.4, 0.25); blob(g, 0, 0.4, 0.5, 0.5); g.fillStyle = '#f4f8fc'; blob(g, 0, 0.4, 0.5, 0.5); }
        break;
      case 'night':
        g.scale(h, h);
        if (r < 0.6) pPine(g, '#1b3329', '#132620', false);
        else if (r < 0.9) pRound(g, '#1f3a2c', '#152a20', '#151515');
        break;
      case 'city':
        if (r < 0.5) { g.scale(h * 0.75, h * 0.75); pRound(g, '#5a8a50', '#3f6a3a', '#4a3a2c'); }
        else if (r < 0.7) { g.scale(1.8, 1.4); pShrub(g, '#5f9156', '#3f6a3a'); }
        break;
      case 'tropical':
        g.scale(h * 1.1, h * 1.1);
        if (r < 0.6) pPalm(g, '#2f9a4a', '#6a4a2a');
        else if (r < 0.85) { g.scale(0.5, 0.4); pShrub(g, '#4fc054', '#2e8b3e'); }
        break;
      case 'volcanic':
        if (r < 0.45) { g.scale(h * 0.7, h * 0.7); pDead(g, '#241a18'); }
        else if (r < 0.75) { g.scale(2 + r2 * 2, 1.5 + r2); pRock(g, '#4a3c3a', '#2a2222'); }
        break;
    }
    g.restore();
  };

  // ---------------------------------------------------------------- terrain
  R._drawTerrain = function (g) {
    const T = this.terrain; if (!T) return;
    const th = this.theme, G = th.ground, z = this.camera.zoom;
    const v = this._visibleWorld(M + 20);
    const px = 1 / z;
    const t = this.level.terrain;
    const wet = t.waterY !== null && t.waterY !== undefined;
    const lava = !!th.lava;
    // base fill
    const top = Math.max(T.ly, T.ry);
    const gr = g.createLinearGradient(0, top, 0, Math.min(T.fy, top - 8) - 25);
    gr.addColorStop(0, G.soil[0]); gr.addColorStop(1, G.soil[1]);
    g.fillStyle = gr;
    g.fill(this.terrainPath);
    g.save();
    g.clip(this.terrainPath);
    // strata bands
    const xs0 = Math.max(v.x0, T.le - 2000), xs1 = Math.min(v.x1, T.re + 2000);
    const step = Math.max(0.4, 7 / z);
    let y = top - 0.8;
    const yEnd = Math.max(v.y0 - 5, T.fy - 600);
    const rnd = mulberry(T.seed * 7 + 3);
    let k = 0;
    const bands = [];
    while (y > yEnd && k < 400) { const h = 0.9 + rnd() * 2.6; bands.push({ y, h, k }); y -= h; k++; }
    const tilt = (hash(T.seed) - 0.5) * 0.04;
    const bandY = (b, x) => b.y + (fbm(x * 0.045 + b.k * 3.7, T.seed + 11, 3) - 0.5) * 1.6 + tilt * (x - T.le);
    for (let i = 0; i < bands.length - 1; i++) {
      const b = bands[i], nb = bands[i + 1];
      if (b.y < v.y0 - 4 || nb.y > v.y1 + 4) continue;
      const col = G.strata[(b.k + (T.seed % 3)) % G.strata.length];
      const deep = clamp((top - b.y) / 50, 0, 1);
      g.fillStyle = mix(col, G.soil[1], deep * 0.7);
      g.globalAlpha = 0.7;
      g.beginPath();
      for (let x = xs0; x <= xs1 + step; x += step) { const yy = bandY(b, x); x === xs0 ? g.moveTo(x, yy) : g.lineTo(x, yy); }
      for (let x = xs1 + step; x >= xs0; x -= step) g.lineTo(x, bandY(nb, x));
      g.closePath(); g.fill();
      // thin highlight line at top of band
      g.globalAlpha = 0.18;
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.2 * px;
      g.beginPath();
      for (let x = xs0; x <= xs1 + step; x += step) { const yy = bandY(b, x) - 0.06; x === xs0 ? g.moveTo(x, yy) : g.lineTo(x, yy); }
      g.stroke();
    }
    g.globalAlpha = 1;
    // embedded rocks / pebbles
    if (z > 3) {
      const cs = 2.4;
      const i0 = Math.floor(v.x0 / cs), i1 = Math.ceil(v.x1 / cs), j0 = Math.floor(v.y0 / cs), j1 = Math.ceil(Math.min(v.y1, top) / cs);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const r = hash2(i, j, T.seed + 5);
        if (r > 0.2) continue;
        const r2 = hash2(i, j, T.seed + 6), r3 = hash2(i, j, T.seed + 7);
        const x = (i + r2) * cs, yy = (j + r3) * cs;
        if (yy > top - 1.1) continue;
        const s = 0.18 + r * 2.4;
        const deep = clamp((top - yy) / 50, 0, 1);
        g.fillStyle = mix(G.rock, G.soil[1], 0.25 + deep * 0.5);
        g.beginPath(); g.ellipse(x, yy, s, s * (0.55 + r3 * 0.3), (r2 - 0.5) * 0.6, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,' + (0.16 - deep * 0.08) + ')';
        g.beginPath(); g.ellipse(x - s * 0.2, yy + s * 0.22, s * 0.6, s * 0.25, (r2 - 0.5) * 0.6, 0, TAU); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.beginPath(); g.ellipse(x + s * 0.1, yy - s * 0.35, s * 0.8, s * 0.18, (r2 - 0.5) * 0.6, 0, TAU); g.fill();
      }
    }
    // ambient occlusion along cliff faces + floor
    const strokeProfile = function (pts, w, col) {
      g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round';
      g.beginPath(); pts.forEach(function (q, i) { i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke();
    };
    strokeProfile(T.left, 1.6, 'rgba(0,0,0,0.22)');
    strokeProfile(T.right, 1.6, 'rgba(0,0,0,0.22)');
    strokeProfile(T.left, 0.5, 'rgba(0,0,0,0.25)');
    strokeProfile(T.right, 0.5, 'rgba(0,0,0,0.25)');
    if (lava) { // hot glow on the lower cliffs
      const lg = g.createLinearGradient(0, t.waterY + 7, 0, t.waterY - 3);
      lg.addColorStop(0, 'rgba(255,90,20,0)'); lg.addColorStop(0.7, 'rgba(255,110,30,0.45)'); lg.addColorStop(1, 'rgba(255,110,30,0)');
      g.fillStyle = lg; g.fillRect(T.le - 30, t.waterY - 3, T.re - T.le + 60, 10);
    }
    // valley floor surface
    this._drawSurfaceStrip(g, T.floor, wet ? 'bed' : G.top, G, z, true);
    g.restore();
    // bank tops: road + abutments + verge
    this._drawBankTop(g, -1, T.le - 2000, T.le, T.ly, G, z);
    this._drawBankTop(g, 1, T.re, T.re + 2000, T.ry, G, z);
  };

  R._drawSurfaceStrip = function (g, pts, type, G, z, isFloor) {
    const px = 1 / z;
    const th = 0.5;
    let col1, col2;
    switch (type) {
      case 'bed': col1 = G.bed; col2 = mix(G.bed, '#000000', 0.35); break;
      case 'grass': col1 = G.a; col2 = G.b; break;
      case 'snow': col1 = G.a; col2 = G.b; break;
      default: col1 = G.a; col2 = G.b;
    }
    g.beginPath();
    pts.forEach(function (q, i) { i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); });
    for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i].x, pts[i].y - th - (hash2(i, 3, 3) * 0.2));
    g.closePath();
    const y0 = pts[0].y;
    const gr = g.createLinearGradient(0, y0, 0, y0 - th);
    gr.addColorStop(0, col1); gr.addColorStop(1, col2);
    g.fillStyle = gr; g.fill();
    if (type === 'grass' && z > 5) {
      g.fillStyle = col1;
      const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
      const sp = Math.max(0.18, 3 / z);
      g.beginPath();
      let pi = 0;
      for (let x = x0; x < x1; x += sp) {
        while (pi < pts.length - 2 && pts[pi + 1].x < x) pi++;
        const a = pts[pi], b = pts[pi + 1];
        const yy = a.y + (b.y - a.y) * ((x - a.x) / ((b.x - a.x) || 1));
        const hh = 0.12 + hash(Math.round(x * 50)) * 0.22;
        g.moveTo(x - 0.06, yy - 0.05); g.lineTo(x + (hash(Math.round(x * 30)) - 0.5) * 0.12, yy + hh); g.lineTo(x + 0.06, yy - 0.05);
      }
      g.fill();
    }
    if (type === 'bed' && z > 4) {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        for (let s = 0; s < 3; s++) {
          const r = hash2(i, s, 9);
          g.beginPath(); g.ellipse(q.x + r * 1.5, q.y - 0.1 - r * 0.2, 0.08 + r * 0.12, 0.05 + r * 0.06, 0, 0, TAU); g.fill();
        }
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.2 * px;
    g.beginPath(); pts.forEach(function (q, i) { i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke();
  };

  R._drawBankTop = function (g, side, x0, x1, y, G, z) {
    const px = 1 / z;
    const ROAD = 0.42;
    const edge = side < 0 ? x1 : x0;
    const v = this._visibleWorld(M + 20);
    const vx0 = Math.max(x0, v.x0 - 2), vx1 = Math.min(x1, v.x1 + 2);
    if (vx1 <= vx0) return;
    const T = this.terrain;
    const ab0 = side < 0 ? edge - 1.7 : edge, ab1 = side < 0 ? edge : edge + 1.7;
    const abBot = y - T.ABUT;
    // verge / top layer below road
    const VT = 0.7;
    const top = G.top;
    let c1 = G.a, c2 = G.b;
    g.beginPath();
    g.moveTo(vx0, y - ROAD);
    g.lineTo(vx1, y - ROAD);
    const st = Math.max(0.3, 6 / z);
    for (let x = vx1; x >= vx0 - st; x -= st) g.lineTo(x, y - ROAD - VT - (fbm(x * 0.6, 4, 2) - 0.5) * 0.35);
    g.closePath();
    const vg = g.createLinearGradient(0, y - ROAD, 0, y - ROAD - VT);
    vg.addColorStop(0, c1); vg.addColorStop(1, c2);
    g.fillStyle = vg; g.fill();
    // concrete abutment at bank edge
    const cg = g.createLinearGradient(ab0, 0, ab1, 0);
    cg.addColorStop(0, side < 0 ? '#a6a8a8' : '#c9cbca'); cg.addColorStop(1, side < 0 ? '#c9cbca' : '#9a9c9c');
    g.fillStyle = cg;
    g.fillRect(ab0, abBot, ab1 - ab0, T.ABUT - ROAD + 0.02);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let k = 1; k < 4; k++) g.fillRect(ab0, abBot + k * (T.ABUT - ROAD) / 4, ab1 - ab0, 1.2 * px);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(side < 0 ? ab1 - 0.12 : ab0, abBot, 0.12, T.ABUT - ROAD);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(ab0 - 0.15, abBot - 0.25, ab1 - ab0 + 0.3, 0.3); // footing
    const railMode = this._railBank; // 'track' (ballasted line) | 'street' (rails set in the road) | null
    if (railMode === 'track') {
      this._drawBankTrack(g, vx0, vx1, y, ROAD, z, side, edge);
    } else {
    // road layer
    const rg = g.createLinearGradient(0, y, 0, y - ROAD);
    rg.addColorStop(0, '#4a4e56'); rg.addColorStop(0.2, '#3d4148'); rg.addColorStop(1, '#2a2d33');
    g.fillStyle = rg;
    g.fillRect(vx0, y - ROAD, vx1 - vx0, ROAD);
    g.fillStyle = '#d6d9de';
    g.fillRect(vx0, y - 0.07, vx1 - vx0, 0.07);
    if (railMode === 'street') { // grooved tram rails flush with the asphalt
      g.fillStyle = '#9aa4ae'; g.fillRect(vx0, y - 0.06, vx1 - vx0, 0.05);
      g.fillStyle = '#1e2228'; g.fillRect(vx0, y - 0.035, vx1 - vx0, 0.012);
    }
    }
    // lane dashes
    if (z > 4 && railMode !== 'track') {
      g.fillStyle = 'rgba(243,241,228,0.85)';
      const dl = 1.6, gap = 1.4;
      const s0 = Math.floor(vx0 / (dl + gap)) * (dl + gap);
      for (let x = s0; x < vx1; x += dl + gap) {
        const a = Math.max(x, vx0), b = Math.min(x + dl, vx1);
        if (b > a) g.fillRect(a, y - ROAD * 0.5, b - a, 0.06);
      }
    }
    // kerb at edge (a ballast retaining wall on railway banks)
    g.fillStyle = railMode === 'track' ? '#b9b3a6' : '#e7e9ec';
    g.fillRect(side < 0 ? edge - 0.25 : edge, y - ROAD - 0.05, 0.25, ROAD - (railMode === 'track' ? 0.08 : -0.05));
    // verge decoration (blades / snow lumps / sand) poking up in front of the road bottom
    const lo = y - ROAD;
    if (top === 'grass' && z > 5) {
      g.fillStyle = c1;
      const sp = Math.max(0.15, 2.5 / z);
      g.beginPath();
      for (let x = vx0; x < vx1; x += sp) {
        if (x > ab0 - 0.1 && x < ab1 + 0.1) continue;
        const r = hash(Math.round(x * 40));
        const hh = 0.03 + r * 0.1;
        g.moveTo(x - 0.04, lo - 0.05); g.lineTo(x + (r - 0.5) * 0.1, lo + hh); g.lineTo(x + 0.04, lo - 0.05);
      }
      g.fill();
      if (G.leaves) {
        const cols = ['#e8862e', '#c9442a', '#f0b13a'];
        for (let x = vx0; x < vx1; x += 0.7) {
          const r = hash(Math.round(x * 13) + 7);
          if (r > 0.5) continue;
          g.fillStyle = cols[(r * 6) | 0 % 3] || cols[0];
          g.beginPath(); g.ellipse(x, lo - 0.08 - r * 0.3, 0.09, 0.05, r * 3, 0, TAU); g.fill();
        }
      }
    } else if (top === 'snow') {
      g.fillStyle = '#f7fbff';
      g.fillRect(vx0, lo - 0.05, vx1 - vx0, 0.12);
      for (let x = Math.floor(vx0); x < vx1; x += 1.3) {
        const r = hash(Math.round(x * 7));
        g.beginPath(); g.ellipse(x, lo + 0.02, 0.6 + r * 0.6, 0.12 + r * 0.12, 0, 0, Math.PI); g.fill();
      }
      g.fillRect(ab0 - 0.1, y - 0.02, ab1 - ab0 + 0.2, 0.14);
      // icicles under the abutment cap
      g.fillStyle = 'rgba(220,240,255,0.9)';
      for (let k = 0; k < 6; k++) {
        const ix = ab0 + 0.15 + k * (ab1 - ab0 - 0.3) / 5, il = 0.2 + hash(k + Math.round(edge)) * 0.4;
        g.beginPath(); g.moveTo(ix - 0.05, lo); g.lineTo(ix, lo - il); g.lineTo(ix + 0.05, lo); g.fill();
      }
    } else if (top === 'sand' && z > 4) {
      g.strokeStyle = 'rgba(160,110,50,0.35)'; g.lineWidth = 1.2 * px;
      g.beginPath();
      for (let x = vx0; x < vx1; x += 0.9) { const yy = lo - 0.3 - hash(Math.round(x)) * 0.25; g.moveTo(x, yy); g.quadraticCurveTo(x + 0.3, yy + 0.07, x + 0.6, yy); }
      g.stroke();
    } else if (top === 'rock' && G.tufts && z > 5) {
      g.fillStyle = G.tufts;
      for (let x = vx0; x < vx1; x += 1.1) {
        const r = hash(Math.round(x * 9));
        if (r > 0.35) continue;
        g.beginPath(); g.moveTo(x - 0.25, lo - 0.05); g.lineTo(x - 0.1, lo + 0.3); g.lineTo(x, lo + 0.05); g.lineTo(x + 0.12, lo + 0.35); g.lineTo(x + 0.28, lo - 0.05); g.fill();
      }
    } else if (top === 'basalt' && G.cracks && z > 3) {
      g.strokeStyle = 'rgba(255,110,30,0.75)'; g.lineWidth = 1.5 * px;
      g.beginPath();
      for (let x = vx0; x < vx1; x += 2.2) {
        const r = hash(Math.round(x * 5));
        if (r > 0.5) continue;
        g.moveTo(x, lo - 0.05); g.lineTo(x + 0.2, lo - 0.3); g.lineTo(x + 0.05, lo - 0.55); g.lineTo(x + 0.3, lo - 0.75);
      }
      g.stroke();
    } else if (top === 'concrete') {
      g.fillStyle = 'rgba(0,0,0,0.15)';
      for (let x = Math.floor(vx0 / 2) * 2; x < vx1; x += 2) g.fillRect(x, lo - VT, 1.2 * px, VT);
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1 * px;
    g.beginPath(); g.moveTo(vx0, y - ROAD); g.lineTo(vx1, y - ROAD); g.stroke();
  };

  // ballasted railway line on a bank top: rail top at y, ballast down to y - depth
  R._drawBankTrack = function (g, vx0, vx1, y, depth, z, side, edge) {
    const st = MSTYLE.rail, px = 1 / z;
    const bg = g.createLinearGradient(0, y - 0.08, 0, y - depth);
    bg.addColorStop(0, mix(st.ballast, '#ffffff', 0.12)); bg.addColorStop(0.6, st.ballast); bg.addColorStop(1, st.ballastLo);
    g.fillStyle = bg;
    g.fillRect(vx0, y - depth, vx1 - vx0, depth - 0.09);
    if (z > 7) { // gravel speckle
      const sp = 0.16;
      for (let x = Math.floor(vx0 / sp) * sp; x < vx1; x += sp) {
        const r = hash(Math.round(x * 97) + 5), r2 = hash(Math.round(x * 53) + 11);
        g.fillStyle = r < 0.5 ? 'rgba(255,250,236,0.35)' : 'rgba(40,36,30,0.3)';
        g.fillRect(x + r2 * 0.1, y - 0.14 - r * (depth - 0.2), Math.max(0.04, 1.5 * px), Math.max(0.03, 1.2 * px));
      }
    }
    // sleepers
    if (z > 3) {
      const pitch = 0.65;
      g.fillStyle = st.sleeper;
      for (let x = Math.floor(vx0 / pitch) * pitch; x < vx1; x += pitch) g.fillRect(x, y - 0.24, 0.26, 0.14);
      g.fillStyle = rgba(mix(st.sleeper, '#ffffff', 0.35), 0.9);
      for (let x = Math.floor(vx0 / pitch) * pitch; x < vx1; x += pitch) g.fillRect(x, y - 0.13, 0.26, 0.03);
      if (z > 9) {
        g.fillStyle = '#2a2f36';
        for (let x = Math.floor(vx0 / pitch) * pitch; x < vx1; x += pitch) g.fillRect(x + 0.09, y - 0.135, 0.08, 0.03);
      }
    }
    // far rail (darker, a hair higher) + near rail head / web
    g.fillStyle = st.railDark; g.fillRect(vx0, y, vx1 - vx0, 0.035);
    g.fillRect(vx0, y - 0.12, vx1 - vx0, 0.065);
    g.fillStyle = st.rail; g.fillRect(vx0, y - 0.055, vx1 - vx0, 0.055);
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(vx0, y - Math.max(0.012, 0.7 * px), vx1 - vx0, Math.max(0.012, 0.7 * px));
    // rail joints every 18 m (fishplates)
    if (z > 6) {
      g.fillStyle = '#3a414b';
      for (let x = Math.floor(vx0 / 18) * 18 + (side < 0 ? 6 : 3); x < vx1; x += 18) g.fillRect(x - 0.25, y - 0.11, 0.5, 0.06);
    }
  };

  // railway scenery standing on the banks (cached with the mid layer): telegraph poles, signals,
  // a signal box, a station on the far bank, catenary masts + wires on high-speed lines
  R._drawRailDecor = function (g) {
    const D = this._railDecor, T = this.terrain;
    if (!D || !T) return;
    const v = this._visibleWorld(M + 60);
    const z = this.camera.zoom, px = 1 / z;
    const night = this.theme.night >= 1;
    const dk = function (c, k) { return night ? mix(c, '#0a1022', 0.55) : (k ? mix(c, '#000000', k) : c); };
    const le = T.le, re = T.re, ly = T.ly, ry = T.ry;
    this._signals = [];
    const inView = function (x0, x1) { return x1 > v.x0 && x0 < v.x1; };
    // ---- telegraph poles + wires (heritage lines)
    if (D.heritage) {
      const pole = function (x, y) {
        g.fillStyle = dk('#5a4030'); g.fillRect(x - 0.09, y - 0.2, 0.18, 6.6);
        g.fillStyle = dk('#3a2a1e'); g.fillRect(x - 0.7, y + 5.9, 1.4, 0.14); g.fillRect(x - 0.5, y + 5.3, 1.0, 0.12);
        g.fillStyle = dk('#d8e4ea');
        for (const q of [[-0.6, 6.04], [-0.2, 6.04], [0.2, 6.04], [0.6, 6.04], [-0.4, 5.42], [0.4, 5.42]]) g.fillRect(x + q[0] - 0.04, y + q[1], 0.08, 0.14);
      };
      const run = function (x0, x1, y, dir) {
        const pts = [];
        for (let x = x0; dir > 0 ? x < x1 : x > x1; x += dir * 32) pts.push(x);
        for (const x of pts) if (inView(x - 2, x + 2)) pole(x, y);
        g.strokeStyle = night ? 'rgba(20,24,40,0.6)' : 'rgba(40,40,46,0.55)'; g.lineWidth = Math.max(0.025, 0.9 * px);
        g.beginPath();
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          if (!inView(Math.min(a, b), Math.max(a, b))) continue;
          for (const h of [6.18, 5.56]) { g.moveTo(a, y + h); g.quadraticCurveTo((a + b) / 2, y + h - 0.7, b, y + h); }
        }
        g.stroke();
      };
      run(le - 10, le - 420, ly, -1);
      run(re + 12, re + 420, ry, 1);
    }
    // ---- signal box (left bank, behind the line)
    {
      const x = le - 26, y = ly;
      if (inView(x - 4, x + 4)) {
        if (D.heritage) {
          g.fillStyle = dk('#8a4a32'); g.fillRect(x - 2.6, y, 5.2, 2.8);                     // brick base
          g.fillStyle = dk('#6e3a26');
          for (let k = 0; k < 6; k++) g.fillRect(x - 2.6, y + 0.45 * k + 0.2, 5.2, 0.05);
          g.fillStyle = dk('#e9e1cf'); g.fillRect(x - 2.8, y + 2.8, 5.6, 2.2);               // timber cabin
          g.fillStyle = night ? 'rgba(255,214,140,0.9)' : dk('#6ea3cc');
          for (let k = 0; k < 4; k++) g.fillRect(x - 2.5 + k * 1.3, y + 3.15, 1.05, 1.4);
          g.fillStyle = dk('#3a3f48');
          g.beginPath(); g.moveTo(x - 3.2, y + 5); g.lineTo(x, y + 6.4); g.lineTo(x + 3.2, y + 5); g.closePath(); g.fill();
          g.fillStyle = dk('#2a2f36'); g.fillRect(x - 2.2, y + 1.0, 0.9, 1.2);
        } else {
          g.fillStyle = dk('#b9bfc6'); g.fillRect(x - 1.8, y, 3.6, 2.6);
          g.fillStyle = dk('#8d97a3'); g.fillRect(x - 1.9, y + 2.6, 3.8, 0.2);
          g.fillStyle = dk('#f2b51d'); g.fillRect(x - 1.8, y + 1.9, 3.6, 0.12);
          g.fillStyle = dk('#4a515b'); g.fillRect(x - 1.2, y + 0.2, 0.9, 1.5); g.fillRect(x + 0.4, y + 0.9, 0.9, 0.6);
        }
      }
    }
    // ---- signals guarding the bridge on both approaches
    const signal = (x, y, dir) => {
      if (!inView(x - 2, x + 2)) return;
      if (D.heritage) { // semaphore: lattice post, arm, spectacle, lamp
        g.fillStyle = dk('#e9ecef'); g.fillRect(x - 0.1, y, 0.2, 6.2);
        g.fillStyle = dk('#2a2f36'); g.fillRect(x - 0.18, y + 6.1, 0.36, 0.3); g.fillRect(x - 0.35, y, 0.7, 0.3);
        g.save(); g.translate(x, y + 5.6); g.rotate(dir * 0.75);
        g.fillStyle = dk('#d8342b'); g.fillRect(0, -0.16, dir * 1.5, 0.32);
        g.fillStyle = dk('#ffffff'); g.fillRect(dir * 1.05, -0.16, dir * 0.16, 0.32);
        g.restore();
        g.fillStyle = dk('#1c2230'); g.beginPath(); g.arc(x - dir * 0.05, y + 5.6, 0.18, 0, TAU); g.fill();
        g.fillStyle = dk('#3a3f48'); g.fillRect(x - 0.2, y + 4.8, 0.4, 0.4);
        g.strokeStyle = dk('#3a3f48'); g.lineWidth = Math.max(0.03, px);
        g.beginPath(); g.moveTo(x - 0.3, y + 0.6); g.lineTo(x - 0.3, y + 4.4); g.moveTo(x - 0.6, y + 1.0); g.lineTo(x - 0.3, y + 1.0); g.stroke();
        this._signals.push({ x: x, y: y + 5.0, kind: 'semaphore' });
      } else { // colour light: post, black head with hood and three lamps
        g.fillStyle = dk('#5a616b'); g.fillRect(x - 0.08, y, 0.16, 4.2);
        g.fillStyle = dk('#3a3f48'); g.fillRect(x - 0.3, y, 0.6, 0.25);
        g.fillStyle = dk('#15181c'); roundRect(g, x - 0.26, y + 3.6, 0.52, 1.5, 0.12); g.fill();
        g.fillStyle = dk('#f4f7fa'); g.fillRect(x - 0.36, y + 3.5, 0.72, 0.06); g.fillRect(x - 0.36, y + 5.14, 0.72, 0.06);
        g.fillStyle = '#20252c';
        for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x, y + 4.75 - k * 0.42, 0.13, 0, TAU); g.fill(); }
        this._signals.push({ x: x, y: y + 4.75, kind: 'light', dy: 0.42 });
      }
    };
    signal(le - 16, ly, 1);
    signal(re + 14, ry, -1);
    // ---- station on the far bank: platform, building, canopy, name board
    {
      const x0 = re + 24, x1 = re + 74, y = ry;
      if (inView(x0 - 2, x1 + 2)) {
        // platform (behind the track; the train covers its lower edge)
        g.fillStyle = dk('#a7a299'); g.fillRect(x0, y, x1 - x0, 0.95);
        g.fillStyle = dk('#e8e2d2'); g.fillRect(x0, y + 0.95, x1 - x0, 0.14);
        g.fillStyle = dk('#f2c21d'); g.fillRect(x0, y + 0.88, x1 - x0, 0.05);
        g.fillStyle = 'rgba(0,0,0,0.15)';
        for (let x = x0; x < x1; x += 1.2) g.fillRect(x, y, 0.04, 0.95);
        const bx = x0 + 14, bw = 22;
        if (D.heritage) {
          g.fillStyle = dk('#a85a3a'); g.fillRect(bx, y + 1.09, bw, 5.2);
          g.fillStyle = dk('#8a4a30');
          for (let k = 0; k < 11; k++) g.fillRect(bx, y + 1.3 + k * 0.45, bw, 0.05);
          g.fillStyle = dk('#e9e1cf'); g.fillRect(bx - 0.3, y + 6.2, bw + 0.6, 0.35);
          g.fillStyle = dk('#3a3f48');
          g.beginPath(); g.moveTo(bx - 0.8, y + 6.55); g.lineTo(bx + bw / 2, y + 8.6); g.lineTo(bx + bw + 0.8, y + 6.55); g.closePath(); g.fill();
          g.fillStyle = dk('#5a3020'); g.fillRect(bx + 4, y + 7.2, 0.8, 1.6); g.fillRect(bx + bw - 5, y + 7.2, 0.8, 1.6);
          g.fillStyle = night ? 'rgba(255,214,140,0.9)' : dk('#5f8fb8');
          for (let k = 0; k < 6; k++) { roundRect(g, bx + 1.4 + k * 3.4, y + 2.6, 1.6, 2.4, 0.6); g.fill(); }
          g.fillStyle = dk('#2e4a34'); g.fillRect(bx + bw / 2 - 0.9, y + 1.09, 1.8, 2.8);
        } else {
          g.fillStyle = dk('#c9cfd6'); g.fillRect(bx, y + 1.09, bw, 4.6);
          g.fillStyle = night ? 'rgba(255,226,160,0.85)' : dk('#7fb2d6');
          g.fillRect(bx + 0.6, y + 1.6, bw - 1.2, 3.2);
          g.fillStyle = dk('#8d97a3');
          for (let k = 1; k < 8; k++) g.fillRect(bx + k * bw / 8, y + 1.6, 0.12, 3.2);
          g.fillStyle = dk('#4a515b'); g.fillRect(bx - 0.4, y + 5.7, bw + 0.8, 0.4);
        }
        // canopy on columns
        g.fillStyle = dk('#2e3a44');
        for (let x = x0 + 2; x < x1 - 1; x += 6) g.fillRect(x - 0.08, y + 1.09, 0.16, 3.4);
        g.fillStyle = dk(D.heritage ? '#5e6e5a' : '#9aa4ae');
        g.beginPath(); g.moveTo(x0 + 0.5, y + 4.4); g.lineTo(x1 - 0.5, y + 4.4); g.lineTo(x1 - 1.5, y + 4.9); g.lineTo(x0 + 1.5, y + 4.9); g.closePath(); g.fill();
        if (D.heritage) { g.fillStyle = dk('#e9e1cf'); for (let x = x0 + 0.8; x < x1 - 0.8; x += 0.5) { g.beginPath(); g.moveTo(x, y + 4.4); g.lineTo(x + 0.25, y + 4.15); g.lineTo(x + 0.5, y + 4.4); g.fill(); } }
        // name board on the facade (above the trains) + clock in the gable
        const nbY = y + (D.heritage ? 5.62 : 5.05), nbX = bx + bw / 2;
        g.fillStyle = dk('#1e2a48'); roundRect(g, nbX - 4.2, nbY - 0.45, 8.4, 0.9, 0.15); g.fill();
        g.strokeStyle = dk('#f4ead0'); g.lineWidth = 0.06; roundRect(g, nbX - 4.1, nbY - 0.36, 8.2, 0.72, 0.1); g.stroke();
        g.fillStyle = dk('#f4ead0');
        g.save(); g.translate(nbX, nbY); g.scale(0.025, -0.025);
        g.font = 'bold 22px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(D.station, 0, 1, 310);
        g.restore();
        if (D.heritage) {
          const cx = nbX, cy = y + 7.35;
          g.fillStyle = dk('#f4f7fa'); g.beginPath(); g.arc(cx, cy, 0.42, 0, TAU); g.fill();
          g.strokeStyle = dk('#1c2230'); g.lineWidth = 0.07;
          g.beginPath(); g.arc(cx, cy, 0.42, 0, TAU); g.moveTo(cx, cy); g.lineTo(cx, cy + 0.3); g.moveTo(cx, cy); g.lineTo(cx + 0.2, cy - 0.05); g.stroke();
        }
        // benches + passengers silhouettes
        g.fillStyle = dk('#3a3f48', 0.1);
        for (const bxx of [x0 + 3, x0 + 40, x0 + 46]) { g.fillRect(bxx, y + 1.09, 1.6, 0.12); g.fillRect(bxx, y + 1.5, 1.6, 0.1); g.fillRect(bxx + 0.1, y + 1.09, 0.08, 0.5); g.fillRect(bxx + 1.4, y + 1.09, 0.08, 0.5); }
        g.fillStyle = night ? 'rgba(10,14,28,0.8)' : 'rgba(40,46,60,0.55)';
        for (const p of [[x0 + 10, 1.75], [x0 + 11.2, 1.6], [x0 + 38, 1.7], [x0 + 49, 1.8]]) {
          g.beginPath(); g.arc(p[0], y + 1.09 + p[1], 0.17, 0, TAU); g.fill();
          roundRect(g, p[0] - 0.22, y + 1.09, 0.44, p[1] - 0.2, 0.15); g.fill();
        }
      }
    }
    // ---- overhead line equipment (high-speed lines)
    if (D.catenary) {
      const CW = D.wire || 4.65, MW = CW + 1.3, HT = CW + 2.35, SP = 45;
      const masts = [];
      for (let x = le - 4; x > le - 600; x -= SP) masts.push({ x, y: ly });
      masts.reverse();
      const nL = masts.length;
      for (let x = re + 4; x < re + 600; x += SP) masts.push({ x, y: ry });
      const mast = function (m) {
        if (!inView(m.x - 2, m.x + 2)) return;
        g.fillStyle = dk('#6d7680'); g.fillRect(m.x - 0.13, m.y - 0.2, 0.26, HT);
        g.fillStyle = dk('#9aa4ae'); g.fillRect(m.x - 0.13, m.y - 0.2, 0.07, HT);
        g.fillStyle = dk('#4a515b'); g.fillRect(m.x - 0.3, m.y - 0.25, 0.6, 0.3);
        // cantilever + registration arm seen end-on
        g.strokeStyle = dk('#8d97a3'); g.lineWidth = 0.08;
        g.beginPath(); g.moveTo(m.x, m.y + MW + 0.2); g.lineTo(m.x + 0.9, m.y + MW + 0.15); g.moveTo(m.x, m.y + CW + 0.5); g.lineTo(m.x + 0.9, m.y + MW + 0.15); g.stroke();
        g.fillStyle = dk('#c9d1da'); g.fillRect(m.x + 0.82, m.y + CW, 0.06, MW - CW + 0.15);
        g.fillStyle = dk('#3a3f48'); g.fillRect(m.x - 0.05, m.y + MW + 0.1, 0.24, 0.26); g.fillRect(m.x - 0.05, m.y + CW + 0.4, 0.24, 0.26);
      };
      const span = function (a, b) {
        if (!inView(Math.min(a.x, b.x), Math.max(a.x, b.x))) return;
        const ax = a.x + 0.85, bx = b.x + 0.85;
        g.strokeStyle = night ? 'rgba(20,24,40,0.85)' : 'rgba(34,38,46,0.85)';
        g.lineWidth = Math.max(0.03, 1.1 * px);
        g.beginPath(); g.moveTo(ax, a.y + CW); g.lineTo(bx, b.y + CW); g.stroke();
        g.lineWidth = Math.max(0.025, 0.9 * px);
        const sag = Math.min(0.9, Math.abs(bx - ax) * 0.02);
        g.beginPath(); g.moveTo(ax, a.y + MW); g.quadraticCurveTo((ax + bx) / 2, (a.y + b.y) / 2 + MW - sag * 2, bx, b.y + MW); g.stroke();
        g.lineWidth = Math.max(0.018, 0.6 * px);
        g.beginPath();
        const n = Math.max(1, Math.round(Math.abs(bx - ax) / 9));
        for (let k = 1; k < n; k++) {
          const t = k / n, x = lerp(ax, bx, t);
          const yc = lerp(a.y, b.y, t) + CW, ym = lerp(a.y, b.y, t) + MW - sag * 4 * t * (1 - t);
          g.moveTo(x, yc); g.lineTo(x, ym);
        }
        g.stroke();
      };
      for (let i = 0; i + 1 < masts.length; i++) {
        if (i === nL - 1) {
          if (re - le <= 75) span(masts[i], masts[i + 1]);
          else for (const m of [masts[i], masts[i + 1]]) { // terminate the wire runs: anchor + balance weights
            const dir = m.x < (le + re) / 2 ? 1 : -1;
            g.strokeStyle = night ? 'rgba(20,24,40,0.85)' : 'rgba(34,38,46,0.85)'; g.lineWidth = Math.max(0.03, px);
            g.beginPath(); g.moveTo(m.x + 0.85 - dir * 6, m.y + CW); g.lineTo(m.x, m.y + MW - 0.4); g.stroke();
            g.fillStyle = dk('#4a515b'); g.fillRect(m.x - 0.55, m.y + 2.2, 0.36, 1.6);
          }
          continue;
        }
        span(masts[i], masts[i + 1]);
      }
      for (const m of masts) mast(m);
    }
  };

  // =====================================================================================
  // per-frame layers
  // =====================================================================================
  R._makeClouds = function () {
    const th = this.theme, cl = th.clouds;
    const list = [];
    const rnd = mulberry(1234 + (this.terrain ? this.terrain.seed : 0));
    const n = this._hasBgImg ? Math.min(3, cl.n) : cl.n;
    for (let i = 0; i < n; i++) {
      const w = 240 + rnd() * 240, h = w * 0.5;
      const c = mkCanvas(w, h);
      const g = c.getContext('2d');
      const base = h * 0.78;
      const puffs = 5 + Math.floor(rnd() * 4);
      const rr = mulberry(i * 99 + 7 + (this.terrain ? this.terrain.seed : 0));
      const P = [];
      for (let k = 0; k < puffs; k++) {
        const t = (k + 0.5) / puffs;
        const pr = Math.min(h * 0.42, w * (0.09 + Math.sin(t * Math.PI) * 0.1 + rr() * 0.04));
        P.push({ x: w * (0.1 + 0.8 * t + (rr() - 0.5) * 0.05), y: base - pr * (0.35 + rr() * 0.3), r: pr });
      }
      // shadow body
      g.fillStyle = cl.shade;
      for (const p of P) { g.beginPath(); g.arc(p.x, p.y + p.r * 0.12, p.r, 0, TAU); g.fill(); }
      g.beginPath(); g.ellipse(w / 2, base - h * 0.05, w * 0.42, h * 0.12, 0, 0, TAU); g.fill();
      // lit tops
      for (const p of P) {
        const gr = g.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.45, p.r * 0.1, p.x, p.y, p.r);
        gr.addColorStop(0, cl.color); gr.addColorStop(0.75, cl.color); gr.addColorStop(1, mix(cl.color, cl.shade, 0.6));
        g.fillStyle = gr;
        g.beginPath(); g.arc(p.x, p.y - p.r * 0.06, p.r * 0.9, 0, TAU); g.fill();
      }
      // soft-fade the flat underside
      g.globalCompositeOperation = 'destination-out';
      const fg = g.createLinearGradient(0, base - h * 0.12, 0, base + h * 0.06);
      fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = fg; g.fillRect(0, base - h * 0.12, w, h);
      g.globalCompositeOperation = 'source-over';
      let cc = c;
      try {
        const c2 = mkCanvas(w, h), g2 = c2.getContext('2d');
        if ('filter' in g2) { g2.filter = 'blur(' + (this._hasBgImg ? 2.5 : 1.2) + 'px)'; g2.drawImage(c, 0, 0); cc = c2; }
      } catch (e) { /* keep sharp */ }
      list.push({ c: cc, w, h, u: rnd(), y: 0.04 + rnd() * 0.26, s: (0.55 + rnd() * 0.5) * (this._hasBgImg ? 0.8 : 1), sp: 4 + rnd() * 8, p: 0.02 + rnd() * 0.05 });
    }
    this._clouds = list;
  };
  R._drawClouds = function (ctx, sh) {
    if (!this._clouds) this._makeClouds();
    const W = this.W, H = this.H, c = this.camera, th = this.theme;
    this._screenXf(ctx, sh.x * 0.3, sh.y * 0.3);
    ctx.globalAlpha = th.clouds.alpha * (this._hasBgImg ? 0.6 : 1);
    const span = W + 700;
    for (const cl of this._clouds) {
      const x = ((cl.u * span + this.time * cl.sp - c.x * c.zoom * cl.p) % span + span) % span - 350;
      const s = cl.s * (H / 900);
      ctx.drawImage(cl.c, x, cl.y * H, cl.w * s, cl.h * s);
    }
    ctx.globalAlpha = 1;
  };
  R._drawStars = function (ctx, sh) {
    if (!this.theme.stars) return;
    this._screenXf(ctx, sh.x * 0.2, sh.y * 0.2);
    const W = this.W, H = this.H;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 170; i++) {
      const x = hash2(i, 1, 2) * W, y = Math.pow(hash2(i, 3, 4), 1.6) * H * 0.55;
      const tw = 0.5 + 0.5 * Math.sin(this.time * (1 + hash2(i, 5, 6) * 3) + i);
      const s = 0.6 + hash2(i, 7, 8) * 1.4;
      ctx.globalAlpha = (0.25 + 0.6 * tw) * (this._hasBgImg ? 0.6 : 1);
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
  };

  R._initAmbient = function () {
    const kind = this.theme.ambient;
    const n = { snow: 140, embers: 60, leaves: 16, fireflies: 26, dust: 26, birds: 7 }[kind] || 0;
    const rnd = mulberry(77);
    this._ambient = [];
    for (let i = 0; i < n; i++) this._ambient.push({ x: rnd(), y: rnd(), s: rnd(), p: rnd() * TAU, v: rnd() });
  };
  R._drawAmbient = function (ctx, dt) {
    const kind = this.theme.ambient; if (!this._ambient.length) return;
    const W = this.W, H = this.H, t = this.time;
    this._screenXf(ctx);
    const c = this.camera;
    const px = -c.x * c.zoom * 0.6;
    for (const a of this._ambient) {
      switch (kind) {
        case 'snow': {
          a.y += dt * (0.03 + a.s * 0.05); if (a.y > 1.05) a.y -= 1.1;
          const x = ((a.x * W + px * (0.3 + a.s) + Math.sin(t * 0.7 + a.p) * 20) % W + W) % W;
          ctx.globalAlpha = 0.5 + a.s * 0.45;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(x, a.y * H, 1 + a.s * 2.2, 0, TAU); ctx.fill();
          break;
        }
        case 'embers': {
          a.y -= dt * (0.02 + a.s * 0.05); if (a.y < -0.05) a.y += 1.1;
          const x = ((a.x * W + px * 0.4 + Math.sin(t * 1.3 + a.p) * 25) % W + W) % W;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (0.4 + 0.6 * Math.abs(Math.sin(t * 3 + a.p))) * (0.4 + a.s * 0.6);
          ctx.fillStyle = a.s > 0.6 ? '#ffd27a' : '#ff7a2a';
          ctx.fillRect(x, a.y * H, 1.5 + a.s * 2, 1.5 + a.s * 2);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'leaves': {
          a.y += dt * (0.03 + a.s * 0.03); a.x += dt * (0.02 + a.v * 0.02);
          if (a.y > 1.05) { a.y -= 1.1; a.x = Math.random(); }
          const x = ((a.x * W + px * 0.5 + Math.sin(t * 1.1 + a.p) * 30) % W + W) % W;
          ctx.save(); ctx.translate(x, a.y * H); ctx.rotate(t * (1 + a.v * 2) + a.p);
          ctx.globalAlpha = 0.9; ctx.fillStyle = ['#e8862e', '#c9442a', '#f0b13a'][(a.v * 3) | 0];
          ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.6, 0, 0, TAU); ctx.fill();
          ctx.restore();
          break;
        }
        case 'fireflies': {
          const x = ((a.x * W + px * 0.8 + Math.sin(t * 0.5 + a.p) * 40) % W + W) % W;
          const y = H * (0.45 + a.y * 0.4) + Math.sin(t * 0.8 + a.p * 2) * 18;
          const k = Math.max(0, Math.sin(t * (1 + a.v) + a.p));
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = k * 0.8;
          const gr = ctx.createRadialGradient(x, y, 0, x, y, 8);
          gr.addColorStop(0, 'rgba(230,255,140,1)'); gr.addColorStop(1, 'rgba(180,255,90,0)');
          ctx.fillStyle = gr; ctx.fillRect(x - 8, y - 8, 16, 16);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'dust': {
          a.x += dt * (0.01 + a.v * 0.02); if (a.x > 1.05) a.x -= 1.1;
          const x = ((a.x * W + px * 0.6) % W + W) % W;
          ctx.globalAlpha = 0.18 + 0.15 * a.s;
          ctx.fillStyle = '#fff3d6';
          ctx.beginPath(); ctx.arc(x, H * (0.3 + a.y * 0.6) + Math.sin(t + a.p) * 10, 1 + a.s * 1.5, 0, TAU); ctx.fill();
          break;
        }
        case 'birds': {
          const sp = 0.012 + a.v * 0.01;
          const x = ((a.x + t * sp) % 1.3) * W * 1.0 - W * 0.15 + (a.s - 0.5) * 60;
          const y = H * (0.12 + a.y * 0.16) + Math.sin(t * 0.6 + a.p) * 8;
          const flap = Math.sin(t * (7 + a.v * 3) + a.p) * 3.2;
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = '#2b3442'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x - 6, y - flap); ctx.quadraticCurveTo(x - 3, y - 2, x, y); ctx.quadraticCurveTo(x + 3, y - 2, x + 6, y - flap); ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  R._drawVignette = function (ctx) {
    const key = this.W + 'x' + this.H + this.themeId;
    if (key !== this._vigKey) {
      this._vigKey = key;
      const w = Math.max(2, Math.round(this.W / 4)), h = Math.max(2, Math.round(this.H / 4));
      const c = mkCanvas(w, h), g = c.getContext('2d');
      const gr = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, this.theme.night ? 'rgba(0,0,12,0.45)' : 'rgba(10,20,40,0.28)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      this._vignette = c;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this._vignette, 0, 0, this.canvas.width, this.canvas.height);
  };

  // =====================================================================================
  // scene data (edit design vs. live sim)
  // =====================================================================================
  R._designNodes = function (L, design) {
    let nodes = null;
    if (BG.Model && BG.Model.allNodes) { try { nodes = BG.Model.allNodes(L, design); } catch (e) { nodes = null; } }
    if (!nodes) {
      nodes = [];
      (L.anchors || []).forEach(function (a, i) { nodes.push({ id: 'a' + i, x: a.x, y: a.y, fixed: true }); });
      ((design && design.piers) || []).forEach(function (p, i) { nodes.push({ id: 'p' + i, x: p.x, y: p.topY, fixed: true }); });
      ((design && design.nodes) || []).forEach(function (n) { nodes.push({ id: n.id, x: n.x, y: n.y, fixed: false }); });
    }
    return nodes;
  };

  // build the list of drawable beam items
  R._collectBeams = function (state) {
    const items = [];
    const mode = state.mode || 'edit';
    const sim = state.sim;
    const useSim = sim && sim.nodes && sim.beams && mode !== 'edit';
    if (useSim && this._blueprint && state.design && state.design.beams) {
      // every design beam at its built position, coloured by the peak stress it saw; broken ones in red
      const map = this._nodeMap;
      const design = state.design;
      for (let i = 0; i < design.beams.length; i++) {
        const b = design.beams[i];
        const A = map[b.a], B = map[b.b];
        if (!A || !B) continue;
        const m = b.m || 'steel';
        const sb = sim.beams[i];
        const cracked = !!(sb && sb.broken && !sb.invalid);
        const s = sb ? (cracked ? Math.max(1, sb.peak || 1) : (sb.peak || 0)) : 0;
        const it = { ax: A.x, ay: A.y, bx: B.x, by: B.y, m, st: matStyle(m), s, i, broken: false, cracked, sag: 0 };
        if (sb && sb.peakTension != null) it.tens = cracked ? Math.max(1, sb.peakTension) : sb.peakTension;
        items.push(it);
      }
      return items;
    }
    if (useSim) {
      const peak = state.peakView || (mode === 'results' && state.peakView !== false);
      const show = peak || state.showStress !== false;
      const ns = sim.nodes;
      for (let i = 0; i < sim.beams.length; i++) {
        const b = sim.beams[i];
        const A = ns[b.a], B = ns[b.b];
        if (!A || !B) continue;
        const m = b.m || (b.material && b.material.id) || 'steel';
        const st = matStyle(m);
        if (b.broken && b.fragmented) continue; // its halves live on as separate 'fragment' beams
        if (b.fragment) {
          // dangling half of a snapped beam: draw as a broken stub, jagged at the debris tip
          const par = sim.beams[b.parent];
          const fs = peak ? ((par && par.peak) || 1) : null;
          const tipA = !!A.debris;
          const fx = tipA ? A.x : B.x, fy = tipA ? A.y : B.y;
          // orient so (ax,ay) is the joint end and the free end is (bx,by)
          if (tipA) items.push({ ax: B.x, ay: B.y, bx: A.x, by: A.y, m, st, s: fs, i, broken: true, sag: 0, _freeX: fx, _freeY: fy });
          else items.push({ ax: A.x, ay: A.y, bx: B.x, by: B.y, m, st, s: fs, i, broken: true, sag: 0, _freeX: fx, _freeY: fy });
          continue;
        }
        if (b.broken) {
          const dx = B.x - A.x, dy = B.y - A.y;
          items.push({ ax: A.x, ay: A.y, bx: A.x + dx * 0.3, by: A.y + dy * 0.3, m, st, s: peak ? (b.peak || 1) : null, i, broken: true, sag: 0 });
          items.push({ ax: B.x - dx * 0.3, ay: B.y - dy * 0.3, bx: B.x, by: B.y, m, st, s: peak ? (b.peak || 1) : null, i, broken: true, sag: 0, _freeX: B.x - dx * 0.3, _freeY: B.y - dy * 0.3 });
          continue;
        }
        let sag = 0;
        if (st.kind === 'rope' || st.kind === 'cable') {
          const len = Math.hypot(B.x - A.x, B.y - A.y);
          const rest = b.restLength || len;
          if (len < rest * 0.999) sag = Math.min(rest * 0.4, Math.sqrt(Math.max(0, 3 * len * (rest - len) / 8)) * 1.6);
        }
        const s = show ? (peak ? (b.peak || 0) : Math.abs(b.stress || 0)) : null;
        const it = { ax: A.x, ay: A.y, bx: B.x, by: B.y, m, st, s, i, broken: false, sag, signed: b.stress || 0 };
        // masonry thrust readout: live tension (sim) or the peak tension it saw (results)
        if (b.peakTension != null) {
          const tl = (b.material && b.material.tensionLimit) || (BG.Materials && BG.Materials[m] && BG.Materials[m].tensionLimit) || 1;
          it.tens = peak ? b.peakTension : Math.max(0, (b.force || 0) / tl);
        }
        items.push(it);
      }
    } else {
      const design = state.design;
      if (!design || !design.beams) return items;
      const map = this._nodeMap;
      for (let i = 0; i < design.beams.length; i++) {
        const b = design.beams[i];
        const A = map[b.a], B = map[b.b];
        if (!A || !B) continue;
        const m = b.m || 'steel';
        items.push({ ax: A.x, ay: A.y, bx: B.x, by: B.y, m, st: matStyle(m), s: null, i, broken: false, sag: 0 });
      }
    }
    return items;
  };

  // =====================================================================================
  // beams
  // =====================================================================================
  function upNormal(it) {
    const dx = it.bx - it.ax, dy = it.by - it.ay;
    const L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L;
    if (ny < -1e-6 || (Math.abs(ny) <= 1e-6 && nx > 0)) { nx = -nx; ny = -ny; }
    it._nx = nx; it._ny = ny; it._len = L;
  }
  function pathLines(ctx, list, off, roadDown) {
    ctx.beginPath();
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      const o = off * it.st.w * (roadDown ? -1 : 1);
      const ox = it._nx * o, oy = it._ny * o;
      if (it.sag > 0) {
        const mx = (it.ax + it.bx) / 2, my = (it.ay + it.by) / 2 - it.sag * 2;
        ctx.moveTo(it.ax + ox, it.ay + oy);
        ctx.quadraticCurveTo(mx + ox, my + oy, it.bx + ox, it.by + oy);
      } else {
        ctx.moveTo(it.ax + ox, it.ay + oy);
        ctx.lineTo(it.bx + ox, it.by + oy);
      }
    }
  }
  function strokeSet(ctx, list, off, width, color, roadDown, dash, cap) {
    if (!list.length) return;
    pathLines(ctx, list, off, roadDown);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = cap || 'butt';
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  // draws a set of beam items; opts: {alpha, tint (css colour override), details}
  R._drawBeamItems = function (ctx, items, opts) {
    opts = opts || {};
    const z = this.camera.zoom, px = 1 / z;
    const detail = opts.details !== false;
    const groups = {};
    for (const it of items) {
      upNormal(it);
      const key = it.m;
      (groups[key] || (groups[key] = [])).push(it);
    }
    const kinds = Object.keys(groups).sort(function (a, b) { return KIND_ORDER.indexOf(matStyle(a).kind) - KIND_ORDER.indexOf(matStyle(b).kind); });
    for (const m of kinds) {
      const list = groups[m];
      const st = matStyle(m);
      const w = st.w;
      const ow = Math.max(w, 2 * px) + 2.2 * px; // outline width (px-constant rim)
      const bw = Math.max(w, 1.6 * px);
      const tinted = list.filter(function (it) { return it.s !== null && it.s !== undefined && !it.broken; });
      const broken = list.filter(function (it) { return it.broken; });
      switch (st.kind) {
        case 'road': {
          strokeSet(ctx, list, 0.5, ow, 'rgba(12,14,18,0.85)', true);
          if (st.girder) {
            strokeSet(ctx, list, 0.5, bw, st.deck, true);
            strokeSet(ctx, list, 0.82, w * 0.36, st.under, true);
          } else {
            strokeSet(ctx, list, 0.5, bw, st.deck, true);
            strokeSet(ctx, list, 0.86, w * 0.28, st.deckLo, true);
          }
          this._tint(ctx, tinted, 0.76, bw * 0.48, true, 0.9);
          if (broken.length) strokeSet(ctx, broken, 0.5, bw, 'rgba(30,30,30,0.35)', true);
          if (detail && w * z > 3) {
            strokeSet(ctx, list, 0.08, w * 0.16, st.kerb, true);
            if (w * z > 6) strokeSet(ctx, list, 0.48, Math.max(w * 0.1, 1 * px), st.mark, true, [0.9, 0.7]);
            if (st.girder && w * z > 6) strokeSet(ctx, list, 0.82, w * 0.11, 'rgba(210,225,240,0.75)', true, [0.001, 0.5], 'round');
          }
          break;
        }
        case 'wood': {
          strokeSet(ctx, list, 0, ow, st.dark);
          strokeSet(ctx, list, 0, bw, st.base);
          this._tint(ctx, tinted, 0, bw, false, 0.8);
          if (broken.length) strokeSet(ctx, broken, 0, bw, 'rgba(40,25,10,0.35)');
          if (detail && w * z > 3) {
            strokeSet(ctx, list, 0.3, w * 0.18, 'rgba(255,235,200,0.45)');
            if (w * z > 5) {
              strokeSet(ctx, list, -0.05, Math.max(w * 0.06, 0.7 * px), rgba(st.grain, 0.75), false, [0.7, 0.25, 0.3, 0.2]);
              strokeSet(ctx, list, -0.3, Math.max(w * 0.05, 0.7 * px), rgba(st.grain, 0.55), false, [0.35, 0.3, 0.9, 0.15]);
            }
          }
          break;
        }
        case 'steel': {
          strokeSet(ctx, list, 0, ow, st.dark);
          strokeSet(ctx, list, 0, bw, st.base);
          this._tint(ctx, tinted, 0, bw, false, 0.8);
          if (broken.length) strokeSet(ctx, broken, 0, bw, 'rgba(20,20,20,0.35)');
          if (detail && w * z > 3) {
            strokeSet(ctx, list, 0.36, w * 0.2, 'rgba(255,255,255,0.55)');
            strokeSet(ctx, list, -0.36, w * 0.2, 'rgba(0,0,0,0.3)');
            if (w * z > 7) strokeSet(ctx, list, 0, w * 0.2, rgba(st.rivet, 0.85), false, [0.001, 0.55], 'round');
          }
          break;
        }
        case 'rope': {
          strokeSet(ctx, list, 0, ow, st.dark, false, null, 'round');
          strokeSet(ctx, list, 0, bw, st.base, false, null, 'round');
          this._tint(ctx, tinted, 0, bw, false, 0.85);
          if (detail && bw * z > 2.5) strokeSet(ctx, list, 0, bw * 0.9, rgba(st.dark, 0.5), false, [0.07, 0.09]);
          break;
        }
        case 'rail': this._drawRailBeams(ctx, list, st, tinted, broken, detail, z, ow, bw); break;
        case 'masonry': this._drawMasonryBeams(ctx, list, st, tinted, broken, detail, z, ow, bw); break;
        case 'girder': {
          strokeSet(ctx, list, 0, ow, st.dark);
          strokeSet(ctx, list, 0, bw, st.base);
          this._tint(ctx, tinted, 0, bw * 0.72, false, 0.8);
          if (broken.length) strokeSet(ctx, broken, 0, bw, 'rgba(20,20,20,0.35)');
          if (detail && w * z > 3) {
            strokeSet(ctx, list, 0.39, w * 0.16, rgba(st.light, 0.85));   // top flange
            strokeSet(ctx, list, -0.4, w * 0.15, 'rgba(0,0,0,0.38)');     // bottom flange
            if (w * z > 6) {
              strokeSet(ctx, list, 0, w * 0.6, 'rgba(14,20,30,0.42)', false, [0.07, 0.93]);   // web stiffeners
              strokeSet(ctx, list, 0.035, w * 0.6, 'rgba(255,255,255,0.12)', false, [0.03, 0.97]);
            }
            if (w * z > 9) {
              strokeSet(ctx, list, 0.39, w * 0.08, rgba(st.rivet, 0.9), false, [0.001, 0.32], 'round');
              strokeSet(ctx, list, -0.39, w * 0.08, rgba(st.rivet, 0.9), false, [0.001, 0.32], 'round');
            }
          }
          break;
        }
        default: { // cable
          strokeSet(ctx, list, 0, ow, st.dark, false, null, 'round');
          strokeSet(ctx, list, 0, bw, st.base, false, null, 'round');
          this._tint(ctx, tinted, 0, bw, false, 0.85);
          if (detail) strokeSet(ctx, list, 0.25, Math.max(bw * 0.3, 0.8 * px), rgba(st.light, 0.8), false, null, 'round');
        }
      }
      // jagged snapped ends on broken stubs
      if (broken.length) {
        ctx.fillStyle = st.kind === 'wood' ? '#f0cf9a' : (st.kind === 'road' || st.kind === 'rail') ? '#8a8d92' : st.kind === 'masonry' ? '#d8ccb4' : '#e8eef4';
        for (const it of broken) {
          // the far end of each stub (the one not on a joint) is the snapped one; mark the free end
          const ex = it._freeX !== undefined ? it._freeX : it.bx, ey = it._freeY !== undefined ? it._freeY : it.by;
          const r = Math.max(st.w * 0.6, 1.5 * px);
          ctx.beginPath();
          ctx.moveTo(ex - it._nx * r, ey - it._ny * r);
          ctx.lineTo(ex + (it.bx - it.ax) / it._len * r * 0.6, ey + (it.by - it.ay) / it._len * r * 0.6);
          ctx.lineTo(ex + it._nx * r, ey + it._ny * r);
          ctx.fill();
        }
      }
    }
  };
  // rail track deck: the beam line is the rail top; rails, sleepers, ballast and the deck slab hang below it
  R._drawRailBeams = function (ctx, list, st, tinted, broken, detail, z, ow, bw) {
    const w = st.w, px = 1 / z;
    // band from a to b metres below the rail top
    const band = function (items, a, b, color, dash, cap) { strokeSet(ctx, items, (a + b) / 2 / w, Math.max(b - a, 0.6 * px), color, true, dash, cap); };
    const W = Math.max(w, 1.6 * px);
    strokeSet(ctx, list, 0.5, ow, 'rgba(12,14,18,0.85)', true);
    const showDetail = detail && w * z > 3;
    if (!showDetail) {
      strokeSet(ctx, list, 0.5, W, st.ballastLo, true);
      band(list, w * 0.62, w, st.deck);
      this._tint(ctx, tinted, 0.8, bw * 0.42, true, 0.9);
      band(list, 0, Math.max(0.1, 1.4 * px), st.rail);
      if (broken.length) strokeSet(ctx, broken, 0.5, W, 'rgba(30,30,30,0.35)', true);
      return;
    }
    const sTop = 0.11, slab = w * 0.6; // ballast from sTop to slab, deck slab from slab to w
    // deck slab (concrete trough) with a lit top edge and a shadowed soffit
    band(list, slab, w, st.deck);
    band(list, w - Math.min(0.06, w * 0.12), w, st.under);
    this._tint(ctx, tinted, (slab + w) / 2 / w, (w - slab) * 0.9, true, 0.92);
    band(list, slab, slab + Math.max(0.025, 0.8 * px), 'rgba(255,255,255,0.28)');
    // ballast bed
    band(list, sTop, slab, st.ballast);
    band(list, slab - (slab - sTop) * 0.35, slab, st.ballastLo);
    if (w * z > 9) {
      // gravel speckle: hashed stones, two tones, batched
      const lite = [], dark = [];
      const sz = Math.max(0.03, 1.3 * px), dep = slab - sTop - sz;
      for (const it of list) {
        const L = it._len || 1, ux = (it.bx - it.ax) / L, uy = (it.by - it.ay) / L, nx = -it._nx, ny = -it._ny;
        for (let s = 0.04, j = 0; s < L; s += 0.075, j++) {
          const h = hash2(it.i + 3, j, 17), d0 = sTop + 0.01 + hash2(it.i + 3, j, 23) * dep;
          (h < 0.5 ? lite : dark).push(it.ax + ux * s + nx * d0, it.ay + uy * s + ny * d0);
        }
      }
      ctx.fillStyle = 'rgba(255,250,236,0.34)';
      ctx.beginPath(); for (let i = 0; i < lite.length; i += 2) ctx.rect(lite[i], lite[i + 1], sz, sz * 0.8); ctx.fill();
      ctx.fillStyle = 'rgba(40,36,30,0.3)';
      ctx.beginPath(); for (let i = 0; i < dark.length; i += 2) ctx.rect(dark[i], dark[i + 1], sz, sz * 0.8); ctx.fill();
    }
    // sleepers poking out of the ballast
    if (w * z > 5) {
      band(list, 0.1, 0.24, st.sleeper, [0.26, 0.39]);
      band(list, 0.1, 0.13, rgba(mix(st.sleeper, '#ffffff', 0.35), 0.9), [0.26, 0.39]);
      band(list, 0.21, 0.24, st.sleeperLo, [0.26, 0.39]);
    } else band(list, 0.1, 0.2, st.sleeper);
    // far rail (just above the line, darker) + near rail head / web / foot
    band(list, -0.035, 0.0, st.railDark);
    band(list, 0.055, 0.12, st.railDark);
    band(list, 0.0, 0.055, st.rail);
    band(list, 0.0, Math.max(0.012, 0.7 * px), 'rgba(255,255,255,0.75)');
    if (w * z > 9) band(list, 0.1, 0.135, '#2a2f36', [0.08, 0.57], 'butt'); // rail clips at each sleeper
    if (broken.length) strokeSet(ctx, broken, 0.5, W, 'rgba(30,30,30,0.35)', true);
  };

  // masonry: stone voussoir blocks with mortar joints, one hashed tone per block
  R._drawMasonryBeams = function (ctx, list, st, tinted, broken, detail, z, ow, bw) {
    const w = st.w, px = 1 / z;
    strokeSet(ctx, list, 0, ow, st.dark);
    if (!(detail && w * z > 3.5)) {
      strokeSet(ctx, list, 0, bw, st.stones[0]);
      this._tint(ctx, tinted, 0, bw, false, 0.6);
      if (broken.length) strokeSet(ctx, broken, 0, bw, 'rgba(40,30,20,0.35)');
      this._drawThrust(ctx, list, st, z, false);
      return;
    }
    strokeSet(ctx, list, 0, bw, st.mortar);
    const tones = st.stones, nT = tones.length;
    const paths = [];
    for (let k = 0; k < nT; k++) paths.push([]);
    const gap = Math.max(0.045, 1.2 * px);
    const hw = Math.max(w / 2 - gap * 0.6, w * 0.3);
    for (const it of list) {
      const L = it._len || 1, ux = (it.bx - it.ax) / L, uy = (it.by - it.ay) / L, nx = it._nx, ny = it._ny;
      const n = Math.max(1, Math.round(L / 0.72)), bl = L / n;
      for (let j = 0; j < n; j++) {
        const s0 = j * bl + gap / 2, s1 = (j + 1) * bl - gap / 2;
        if (s1 <= s0) continue;
        const k = Math.floor(hash2(it.i + 7, j, 31) * nT) % nT;
        paths[k].push(it.ax + ux * s0, it.ay + uy * s0, it.ax + ux * s1, it.ay + uy * s1, nx, ny, hw);
      }
    }
    for (let k = 0; k < nT; k++) {
      const P = paths[k];
      if (!P.length) continue;
      ctx.beginPath();
      for (let i = 0; i < P.length; i += 7) {
        const x0 = P[i], y0 = P[i + 1], x1 = P[i + 2], y1 = P[i + 3], nx = P[i + 4] * P[i + 6], ny = P[i + 5] * P[i + 6];
        ctx.moveTo(x0 + nx, y0 + ny); ctx.lineTo(x1 + nx, y1 + ny); ctx.lineTo(x1 - nx, y1 - ny); ctx.lineTo(x0 - nx, y0 - ny); ctx.closePath();
      }
      ctx.fillStyle = tones[k];
      ctx.fill();
    }
    this._tint(ctx, tinted, 0, bw * 0.9, false, 0.38);
    // dressed-stone shading: lit top face, shadowed bottom, a chisel line through each block
    strokeSet(ctx, list, 0.36, w * 0.1, rgba(st.light, 0.38));
    strokeSet(ctx, list, -0.37, w * 0.12, 'rgba(30,22,14,0.28)');
    // re-cut the mortar joints so blocks still read through the stress tint
    ctx.beginPath();
    for (const it of list) {
      const L = it._len || 1, ux = (it.bx - it.ax) / L, uy = (it.by - it.ay) / L;
      const n = Math.max(1, Math.round(L / 0.72)), bl = L / n;
      const nx = it._nx * w * 0.5, ny = it._ny * w * 0.5;
      for (let j = 1; j < n; j++) {
        const x = it.ax + ux * j * bl, y = it.ay + uy * j * bl;
        ctx.moveTo(x + nx, y + ny); ctx.lineTo(x - nx, y - ny);
      }
    }
    ctx.strokeStyle = rgba(st.mortar, 0.9); ctx.lineWidth = gap; ctx.lineCap = 'butt'; ctx.stroke();
    if (broken.length) strokeSet(ctx, broken, 0, bw, 'rgba(40,30,20,0.35)');
    this._drawThrust(ctx, list, st, z, true);
  };

  /* Masonry in tension (readout only): stone can't be pulled, so a tensioned block glows red and
   * shows hairline cracks across it; more cracks and a stronger glow the closer it is to cracking.
   * it.tens = tension / tension limit (live in the sim, peak in the results view). */
  const THRUST_MIN = 0.12;
  R._drawThrust = function (ctx, list, st, z, detail) {
    const hot = [];
    for (const it of list) if (!it.broken && it.tens > THRUST_MIN) hot.push(it);
    if (!hot.length) return;
    const w = st.w, px = 1 / z;
    const t = now() / 1000;
    ctx.save();
    ctx.lineCap = 'round';
    for (const it of hot) {
      const k = Math.min(1, (it.tens - THRUST_MIN) / (1 - THRUST_MIN));
      const pulse = k > 0.6 ? 0.75 + 0.25 * Math.sin(t * 9 + it.i) : 1;
      // red glow
      ctx.strokeStyle = 'rgba(255,48,28,' + ((0.16 + 0.34 * k) * pulse).toFixed(3) + ')';
      ctx.lineWidth = Math.max(w * 1.9, 7 * px);
      ctx.beginPath(); ctx.moveTo(it.ax, it.ay); ctx.lineTo(it.bx, it.by); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,92,60,' + ((0.28 + 0.5 * k) * pulse).toFixed(3) + ')';
      ctx.lineWidth = Math.max(w * 0.62, 2.4 * px);
      ctx.beginPath(); ctx.moveTo(it.ax, it.ay); ctx.lineTo(it.bx, it.by); ctx.stroke();
      // hairline cracks across the block
      if (k < 0.18 || w * z < 2.5) continue;
      const L = it._len || Math.hypot(it.bx - it.ax, it.by - it.ay) || 1;
      const ux = (it.bx - it.ax) / L, uy = (it.by - it.ay) / L, nx = it._nx != null ? it._nx : -uy, ny = it._ny != null ? it._ny : ux;
      const n = 1 + Math.floor(k * 3.2);
      const hw = w * 0.5;
      ctx.beginPath();
      for (let c = 0; c < n; c++) {
        const f = (c + 0.5 + (hash2(it.i, c, 77) - 0.5) * 0.5) / n;
        const cx = it.ax + ux * L * f, cy = it.ay + uy * L * f;
        const segs = 4, jag = w * 0.16;
        for (let q = 0; q <= segs; q++) {
          const v = -hw * 0.95 + (2 * hw * 0.95) * q / segs;
          const off = (q % 2 ? 1 : -1) * jag * (0.5 + hash2(it.i, c * 7 + q, 91));
          const x = cx + nx * v + ux * off, y = cy + ny * v + uy * off;
          if (q === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = 'rgba(38,8,4,' + (0.55 + 0.4 * k).toFixed(3) + ')';
      ctx.lineWidth = Math.max(w * 0.07, 1.2 * px);
      ctx.stroke();
      if (detail) { ctx.strokeStyle = 'rgba(255,190,150,' + (0.25 * k).toFixed(3) + ')'; ctx.lineWidth = Math.max(w * 0.03, 0.6 * px); ctx.stroke(); }
    }
    ctx.restore();
  };

  /* Derailment highlight: the offending rail segment (and, for a kink, the one before it) glows,
   * the offending wheel gets a pulsing ring with ripples; a short red flash marks the freeze-frame. */
  R._drawDerailMarker = function (ctx, state, sh) {
    const m = state.derail, sim = state.sim;
    if (!m || !sim || !sim.nodes || !isFinite(m.x) || !isFinite(m.y)) return;
    const z = this.camera.zoom, px = 1 / z;
    const t = now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 7);
    const seg = (j, core, glow, dash) => {
      const b = j != null && j >= 0 && sim.beams && sim.beams[j];
      if (!b) return;
      const A = sim.nodes[b.a], B = sim.nodes[b.b];
      if (!A || !B) return;
      ctx.lineCap = 'round';
      ctx.strokeStyle = glow; ctx.lineWidth = Math.max(0.9, 16 * px);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.strokeStyle = core; ctx.lineWidth = Math.max(0.16, 3 * px);
      if (dash) ctx.setLineDash([Math.max(0.3, 6 * px), Math.max(0.25, 5 * px)]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.setLineDash([]);
    };
    ctx.save();
    const broken = m.seg != null && m.seg >= 0 && sim.beams[m.seg] && sim.beams[m.seg].broken;
    if (m.reason === 'kink') seg(m.segPrev, 'rgba(255,181,71,0.95)', 'rgba(255,181,71,' + (0.18 + 0.2 * pulse).toFixed(3) + ')');
    seg(m.seg, '#ff4d5e', 'rgba(255,60,75,' + (0.22 + 0.28 * pulse).toFixed(3) + ')', broken);
    // wheel ring + ripples
    const r0 = Math.max((m.r || 0.45) + 0.2, 9 * px);
    for (let k = 0; k < 2; k++) {
      const ph = (t * 1.1 + k * 0.5) % 1;
      ctx.strokeStyle = 'rgba(255,77,94,' + (0.7 * (1 - ph)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.06, 2 * px);
      ctx.beginPath(); ctx.arc(m.x, m.y, r0 + ph * Math.max(1.6, 34 * px), 0, Math.PI * 2); ctx.stroke();
    }
    const rr = r0 * (1 + 0.12 * pulse);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(0.08, 2.4 * px);
    ctx.beginPath(); ctx.arc(m.x, m.y, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = Math.max(0.12, 3.6 * px);
    ctx.beginPath(); ctx.arc(m.x, m.y, rr + Math.max(0.1, 3 * px), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // freeze-frame flash (screen space)
    if (m.age != null && m.age < 0.9) {
      const a = 0.22 * (1 - m.age / 0.9);
      const W = this.canvas.width, H = this.canvas.height;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(255,40,60,0)'); g.addColorStop(1, 'rgba(255,40,60,' + a.toFixed(3) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  R._tint = function (ctx, list, off, width, roadDown, alpha) {
    if (!list.length) return;
    const bins = {};
    for (const it of list) {
      const b = Math.round(clamp(it.s, 0, 1) * STRESS_BINS);
      (bins[b] || (bins[b] = [])).push(it);
    }
    for (const k in bins) {
      ctx.globalAlpha = alpha * (0.4 + 0.6 * smooth((k / STRESS_BINS) / 0.3));
      strokeSet(ctx, bins[k], off, width, stressBinColors[k], roadDown);
    }
    ctx.globalAlpha = 1;
  };
  R._drawStressGlow = function (ctx, items) {
    const hot = items.filter(function (it) { return it.s > 0.85 && !it.broken; });
    if (!hot.length) return;
    const z = this.camera.zoom, px = 1 / z;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    for (const it of hot) {
      const k = clamp((it.s - 0.85) / 0.15, 0, 1);
      const roadDown = isDeck(it.st);
      const w = it.st.w + (8 + 10 * k * pulse) * px;
      ctx.globalAlpha = (0.18 + 0.32 * k) * (0.55 + 0.45 * pulse);
      strokeSet(ctx, [it], 0.5 * (roadDown ? 1 : 0), w, k > 0.6 ? '#ff3a20' : '#ff9030', roadDown, null, 'round');
      ctx.globalAlpha *= 0.6;
      strokeSet(ctx, [it], 0.5 * (roadDown ? 1 : 0), w * 2, '#ff5020', roadDown, null, 'round');
    }
    ctx.restore();
  };

  // =====================================================================================
  // joints, anchors, piers
  // =====================================================================================
  R._drawAnchors = function (ctx, L, edit, used) {
    const z = this.camera.zoom, d = this.dpr;
    const size = Math.max(1.15, 13 / z); // never smaller than ~13 px: anchors are key puzzle information
    if (z < 14) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.6 / z;
      ctx.fillStyle = 'rgba(255,214,90,0.16)';
      for (const a of L.anchors || []) { ctx.beginPath(); ctx.arc(a.x, a.y, size * 0.62, 0, TAU); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
    const img = Sprites.raster('anchor', size * z * d);
    (L.anchors || []).forEach((a, i) => {
      ctx.save();
      ctx.translate(a.x, a.y);
      if (edit && used && !used['a' + i]) {
        const p = 0.5 + 0.5 * Math.sin(this.time * 3 + i);
        ctx.fillStyle = 'rgba(255,214,90,' + (0.18 + 0.22 * p) + ')';
        ctx.beginPath(); ctx.arc(0, 0, 0.55 + 0.25 * p, 0, TAU); ctx.fill();
      }
      if (img) {
        ctx.scale(1, -1);
        ctx.drawImage(img, -size / 2, -size * (28 / 128), size, size);
      } else {
        ctx.fillStyle = '#9da1a3'; ctx.fillRect(-size / 2, -size * 0.75, size, size);
        ctx.fillStyle = '#5b6066'; ctx.beginPath(); ctx.arc(0, 0, 0.16, 0, TAU); ctx.fill();
      }
      ctx.restore();
    });
  };
  R._drawJoints = function (ctx, pts) {
    const z = this.camera.zoom, d = this.dpr;
    const r = Math.max(0.2, 3.2 / z);
    const img = r * z > 3.5 ? Sprites.raster('joint', 2 * r * z * d) : null;
    if (img) {
      for (const p of pts) ctx.drawImage(img, p.x - r, p.y - r, 2 * r, 2 * r);
    } else {
      ctx.fillStyle = '#2a2f36';
      ctx.beginPath();
      for (const p of pts) { ctx.moveTo(p.x + r * 1.15, p.y); ctx.arc(p.x, p.y, r * 1.15, 0, TAU); }
      ctx.fill();
      ctx.fillStyle = '#c9d1da';
      ctx.beginPath();
      for (const p of pts) { ctx.moveTo(p.x + r * 0.7, p.y); ctx.arc(p.x, p.y, r * 0.7, 0, TAU); }
      ctx.fill();
    }
  };
  R._drawPier = function (ctx, x, baseY, topY, ghost, invalid) {
    if (topY <= baseY + 0.1) return;
    const z = this.camera.zoom, px = 1 / z;
    const w = 1.5, cw = 2.1, fw = 2.9;
    const t = this.level.terrain;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.55;
    // footing
    ctx.fillStyle = invalid ? '#c8483a' : '#8f9294';
    ctx.fillRect(x - fw / 2, baseY - 0.2, fw, 0.9);
    // column
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    if (invalid) { g.addColorStop(0, '#ff8a7a'); g.addColorStop(1, '#b8382a'); }
    else { g.addColorStop(0, '#d9dbd9'); g.addColorStop(0.35, '#c4c6c4'); g.addColorStop(1, '#8c8f90'); }
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, baseY + 0.6, w, topY - baseY - 0.9);
    // form-work lines
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let y = baseY + 2; y < topY - 0.6; y += 1.8) ctx.fillRect(x - w / 2, y, w, 1.2 * px);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x - w / 2 + 0.12, baseY + 0.6, 0.1, topY - baseY - 0.9);
    // water stain band
    if (t.waterY !== null && t.waterY !== undefined && !this.theme.lava && t.waterY > baseY && t.waterY < topY) {
      ctx.fillStyle = 'rgba(40,60,50,0.28)';
      ctx.fillRect(x - w / 2, baseY + 0.6, w, t.waterY - baseY + 0.3);
    }
    // cap
    const cg = ctx.createLinearGradient(0, topY - 0.55, 0, topY);
    cg.addColorStop(0, '#9fa2a3'); cg.addColorStop(1, '#e4e6e5');
    ctx.fillStyle = invalid ? '#e0604f' : cg;
    ctx.beginPath();
    ctx.moveTo(x - cw / 2, topY - 0.15); ctx.lineTo(x + cw / 2, topY - 0.15); ctx.lineTo(x + w / 2, topY - 0.6); ctx.lineTo(x - w / 2, topY - 0.6); ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - cw / 2, topY - 0.15, cw, 0.15);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1 * px;
    ctx.strokeRect(x - w / 2, baseY + 0.6, w, topY - baseY - 0.9);
    ctx.restore();
  };
  R._pierList = function (state) {
    const L = this.level, fy = L.terrain.floorY;
    const sim = state.sim;
    if (sim && sim.piers && state.mode !== 'edit') return sim.piers.map(function (p) { return { x: p.x, baseY: p.baseY !== undefined ? p.baseY : fy, topY: p.topY }; });
    return ((state.design && state.design.piers) || []).map(function (p) { return { x: p.x, baseY: p.baseY !== undefined ? p.baseY : fy, topY: p.topY }; });
  };

  // =====================================================================================
  // vehicles
  // =====================================================================================
  R._vehDef = function (v) {
    return v.def || (BG.Vehicles && BG.Vehicles[v.type]) || null;
  };
  // returns {ox, oy, ang, k (sprite cm -> m scale), Lm, Hm}
  R._vehPose = function (v, def) {
    const type = v.type || (def && def.type) || 'car';
    const meta = SPRITE_META[type] || SPRITE_META.car;
    const Lm = (def && def.length) || meta.w / 100;
    const k = Lm / (meta.w / 100);
    const Hm = meta.h / 100 * k;
    const ws = v.wheels, dw = def && def.wheels;
    let ang, ox, oy;
    if (ws && ws.length >= 2) {
      let i0 = 0, i1 = ws.length - 1;
      let lx0, lx1;
      if (dw && dw.length === ws.length) {
        for (let i = 0; i < dw.length; i++) { if (dw[i].x < dw[i0].x) i0 = i; if (dw[i].x > dw[i1].x) i1 = i; }
        lx0 = dw[i0].x; lx1 = dw[i1].x;
      } else {
        for (let i = 0; i < ws.length; i++) { if (ws[i].x < ws[i0].x) i0 = i; if (ws[i].x > ws[i1].x) i1 = i; }
        lx0 = Lm * 0.18; lx1 = Lm * 0.82;
      }
      const w0 = ws[i0], w1 = ws[i1];
      ang = Math.atan2(w1.y - w0.y, w1.x - w0.x);
      // compensate if the measured wheel separation differs from the definition
      const r0 = w0.r || (def && def.wheelRadius) || 0.35;
      const c = Math.cos(ang), s = Math.sin(ang);
      ox = w0.x - (c * lx0 - s * r0);
      oy = w0.y - (s * lx0 + c * r0);
    } else {
      ang = v.angle || 0;
      const c = Math.cos(ang), s = Math.sin(ang);
      const hx = Lm / 2, hy = Hm * 0.35;
      ox = (v.x || 0) - (c * hx - s * hy);
      oy = (v.y || 0) - (s * hx + c * hy);
    }
    return { ox, oy, ang, k, Lm, Hm, type, meta };
  };
  R._drawVehicles = function (ctx, state, dt) {
    const sim = state.sim;
    let list = [];
    if (sim && sim.vehicles && state.mode !== 'edit') {
      for (let i = 0; i < sim.vehicles.length; i++) {
        const v = sim.vehicles[i];
        if (!v || v.state === 'waiting') continue;
        list.push(v);
      }
    } else if (state.mode === 'edit' && !state.demo && this.previewVehicle !== false) {
      const L = this.level;
      const tr = L.traffic && L.traffic[0];
      const def = tr && tr.type !== 'train' && BG.Vehicles && BG.Vehicles[tr.type];
      if (tr && tr.type === 'train') {
        const pv = this._trainPreview(tr);
        if (pv) list.push(pv);
      } else if (def && def.wheels) {
        const t = L.terrain;
        // park it on the left bank, nudged right so it is not hidden behind the tool rail
        let x0 = t.leftEdge - 3.5 - def.length;
        const visL = this.screenToWorld(((this.insets && this.insets.left) || 0) + 14, 0).x;
        x0 = Math.min(t.leftEdge - 1.2 - def.length, Math.max(x0, visL));
        const r = def.wheelRadius || 0.35;
        list.push({ type: tr.type, def, preview: true, wheels: def.wheels.map(function (w) { return { x: x0 + w.x, y: t.leftY + r, r, rot: 0 }; }), state: 'parked', vx: 0 });
      }
    }
    this._lights = [];
    for (const v of list) {
      if (isTrainVehicle(v)) this._drawTrain(ctx, v, dt, state);
      else this._drawVehicle(ctx, v, dt, state);
    }
  };
  R._drawVehicle = function (ctx, v, dt, state) {
    const def = this._vehDef(v);
    const P = this._vehPose(v, def);
    const z = this.camera.zoom, d = this.dpr;
    const fx = VEHICLE_FX[P.type] || VEHICLE_FX.car;
    // suspension bob state
    let vs = this._vstate && this._vstate.get(v);
    if (!vs) { vs = { o: 0, ov: 0, py: P.oy, pvy: 0, ex: Math.random() * 0.3, rot: [], px: [] }; if (this._vstate) this._vstate.set(v, vs); }
    if (dt > 0) {
      const vy = (P.oy - vs.py) / dt;
      const ay = clamp((vy - vs.pvy) / dt, -60, 60);
      vs.py = P.oy; vs.pvy = vy;
      const kS = 140, cS = 10;
      vs.ov += (-kS * vs.o - cS * vs.ov - ay * 0.25) * dt;
      vs.o += vs.ov * dt;
      vs.o = clamp(vs.o, -0.08, 0.08);
    }
    const speed = Math.abs(v.vx || 0);
    const idle = (v.state === 'driving' ? 0.006 * Math.sin(this.time * 38 + vs.ex * 20) * clamp(speed / 8, 0.3, 1) : 0);
    const bob = vs.o * P.Hm * 0.5 + idle;
    const c = Math.cos(P.ang), s = Math.sin(P.ang);
    // ground shadow
    ctx.save();
    ctx.translate(P.ox, P.oy); ctx.rotate(P.ang);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(P.Lm / 2, 0.02, P.Lm * 0.5, Math.max(0.12, P.Lm * 0.025), 0, 0, TAU); ctx.fill();
    // body
    ctx.translate(-s * 0 , bob);
    const img = Sprites.raster(P.type, P.Lm * z * d);
    if (img) {
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, -P.Hm, P.Lm, P.Hm);
      ctx.scale(1, -1);
    } else {
      this._fallbackBody(ctx, P, def);
    }
    ctx.restore();
    // wheels
    const ws = v.wheels || [];
    const wname = HEAVY_WHEEL_TYPES[P.type] ? 'wheel_heavy' : 'wheel';
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const r = w.r || (def && def.wheelRadius) || 0.35;
      // sim rot = rolled distance / r (positive forward); y-up canvas rotation is CCW-positive, so a
      // wheel rolling to the right turns by -rot
      let rot = typeof w.rot === 'number' ? -w.rot : NaN;
      if (!isFinite(rot)) {
        const pxv = vs.px[i]; vs.px[i] = w.x;
        vs.rot[i] = (vs.rot[i] || 0) - (pxv !== undefined ? (w.x - pxv) / r : 0);
        rot = vs.rot[i];
      }
      const wi = Sprites.raster(wname, 2 * r * z * d);
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(rot);
      if (wi) {
        ctx.scale(1, -1);
        ctx.drawImage(wi, -r, -r, 2 * r, 2 * r);
      } else {
        ctx.fillStyle = '#1d1f23'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#b8c0c8'; ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1d1f23'; ctx.fillRect(-r * 0.08, 0, r * 0.16, r * 0.5);
      }
      ctx.restore();
    }
    // lights & exhaust anchor points
    const loc = function (cx, cy) { const lx = cx / 100 * P.k, ly = cy / 100 * P.k + bob; return { x: P.ox + c * lx - s * ly, y: P.oy + s * lx + c * ly }; };
    const head = loc(fx.head[0], fx.head[1]), tail = loc(fx.tail[0], fx.tail[1]);
    this._lights.push({ head, tail, ang: P.ang, L: P.Lm, fallen: v.state === 'fallen' });
    if (this.effects && v.state === 'driving' && dt > 0 && !v.preview) {
      vs.ex -= dt;
      if (vs.ex <= 0) {
        vs.ex = 0.12 + Math.random() * 0.1 + (speed > 6 ? 0.08 : 0);
        const e = loc(fx.exhaust[0], fx.exhaust[1]);
        const big = P.Lm > 7 ? 1.6 : 1;
        this.effects.exhaust(e.x, e.y, v.vx || 0, big);
      }
    }
  };
  R._fallbackBody = function (ctx, P, def) {
    const L = P.Lm, H = P.Hm;
    const col = (def && def.color) || '#d94a3a';
    ctx.fillStyle = '#1a1d22';
    roundRect(ctx, -0.03, H * 0.15 - 0.03, L + 0.06, H * 0.55 + 0.06, 0.2); ctx.fill();
    ctx.fillStyle = col;
    roundRect(ctx, 0, H * 0.15, L, H * 0.55, 0.18); ctx.fill();
    ctx.fillRect(L * 0.15, H * 0.6, L * 0.6, H * 0.38);
    ctx.fillStyle = '#9fd0ef';
    ctx.fillRect(L * 0.2, H * 0.65, L * 0.5, H * 0.26);
  };

  // =====================================================================================
  // trains (SPEC §9.3 / §9.4): sim.vehicles entries {kind:'train', cars:[{type, def, x, y, angle,
  // wheels:[{x,y,r,rot}], state}], state}. cars[0] is the FRONT car. Each car is posed from its wheels
  // (def.wheels from BG.RailCars, same order as car.wheels), falling back to x/y/angle (= car origin:
  // rear end on the rail line, like road vehicles).
  // =====================================================================================
  function isTrainVehicle(v) { return !!v && (v.kind === 'train' || v.type === 'train' || Array.isArray(v.cars)); }
  function railDef(car) { return car.def || (BG.RailCars && BG.RailCars[car.type]) || null; }

  R._railPose = function (car, def, idx, n) {
    const type = car.type || (def && def.type);
    const meta = RAIL_META[type] || { w: ((def && def.length) || 10) * 100, h: ((def && def.height) || 3.5) * 100, wheel: 'rail_wheel', unknown: true };
    const Lm = (def && def.length) || meta.w / 100;
    const k = Lm / (meta.w / 100);
    const Hm = meta.h / 100 * k;
    const ws = car.wheels, dw = def && def.wheels;
    const wr = (def && def.wheelRadius) || 0.45;
    let ang, ox, oy;
    if (ws && dw && ws.length === dw.length && ws.length >= 2 && Number.isFinite(ws[0].x)) {
      let i0 = 0, i1 = 0;
      for (let i = 1; i < dw.length; i++) { if (dw[i].x < dw[i0].x) i0 = i; if (dw[i].x > dw[i1].x) i1 = i; }
      const a = ws[i0], b = ws[i1];
      const r0 = dw[i0].r || wr, r1 = dw[i1].r || wr;
      ang = Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(r1 - r0, (dw[i1].x - dw[i0].x) || 1);
      const c = Math.cos(ang), s = Math.sin(ang);
      ox = a.x - (c * dw[i0].x - s * r0);
      oy = a.y - (s * dw[i0].x + c * r0);
    } else if (Number.isFinite(car.x) && Number.isFinite(car.y)) {
      ang = car.angle || 0; ox = car.x; oy = car.y;
    } else return null;
    const flip = !!meta.nose && n > 1 && idx === n - 1;
    return { ox, oy, ang, c: Math.cos(ang), s: Math.sin(ang), k, Lm, Hm, type, meta, flip, def, car, wr };
  };
  // car-local metres -> world
  function rloc(P, lx, ly) { return { x: P.ox + P.c * lx - P.s * ly, y: P.oy + P.s * lx + P.c * ly }; }
  // sprite cm -> world (honours the mirrored trailing power car)
  function rart(P, sx, sy) { const lx = sx / 100 * P.k; return rloc(P, P.flip ? P.Lm - lx : lx, sy / 100 * P.k); }

  // a parked consist on the left bank for the edit-mode traffic preview
  R._trainPreview = function (tr) {
    const T = BG.Trains && BG.Trains[tr.train];
    const L = this.level, t = L.terrain;
    if (!T || !BG.RailCars) return null;
    const key = L.id + '|' + tr.train + '|' + t.leftEdge + '|' + t.leftY;
    if (this._trainPv && this._trainPv.key === key) return this._trainPv.v;
    const gap = (BG.RailRules && BG.RailRules.couplerGap) || 0.8;
    let front = t.leftEdge - 1.2;
    const cars = [];
    for (const type of T.cars) {
      const def = BG.RailCars[type];
      if (!def) continue;
      const ox = front - def.length;
      cars.push({ type, def, x: ox, y: t.leftY, angle: 0, state: 'parked',
        wheels: def.wheels.map(function (w) { const r = w.r || def.wheelRadius; return { x: ox + w.x, y: t.leftY + r, r, rot: 0 }; }) });
      front = ox - gap;
      if (front < t.leftEdge - 400) break;
    }
    const v = { kind: 'train', type: 'train', preset: tr.train, cars, state: 'parked', preview: true };
    this._trainPv = { key, v };
    return v;
  };

  R._drawTrain = function (ctx, v, dt, state) {
    const cars = v.cars || [];
    if (!cars.length) return;
    let ts = this._vstate && this._vstate.get(v);
    if (!ts) { ts = { cars: [], t: null }; if (this._vstate) this._vstate.set(v, ts); }
    const sim = state.sim;
    const simT = sim && typeof sim.time === 'number' && !v.preview ? sim.time : null;
    let dts = simT !== null && ts.t !== null ? simT - ts.t : 0;
    if (!(dts > 0) || dts > 0.5) dts = 0;
    ts.t = simT;
    const vis = this._visibleWorld(60), near = this._visibleWorld(700);
    const poses = [];
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const def = railDef(car);
      const P = this._railPose(car, def, i, cars.length);
      if (!P) { poses.push(null); continue; }
      let cs = ts.cars[i];
      if (!cs) cs = ts.cars[i] = { px: P.ox, py: P.oy, v: 0, a: 0, dist: 0, chuff: 0, emit: Math.random() * 0.3, spark: 0, arc: Math.random() };
      if (dts > 0) {
        let vx = typeof car.vx === 'number' ? car.vx : ((P.ox - cs.px) * P.c + (P.oy - cs.py) * P.s) / dts;
        if (!isFinite(vx)) vx = 0;
        cs.a = lerp(cs.a, (vx - cs.v) / dts, clamp(dts * 6, 0, 1));
        cs.v = vx;
        cs.dist += vx * dts;
      }
      cs.px = P.ox; cs.py = P.oy;
      P.cs = cs;
      P.derailed = car.state === 'derailed' || car.state === 'fallen' || !!car.derailed;
      // cull cars well outside the view
      const mx = P.ox + P.c * P.Lm * 0.5, my = P.oy + P.s * P.Lm * 0.5, rr = P.Lm * 0.6 + P.Hm;
      P.visible = mx + rr > vis.x0 && mx - rr < vis.x1 && my + rr > vis.y0 && my - rr < vis.y1;
      P.near = mx + rr > near.x0 && mx - rr < near.x1 && my + rr > near.y0 && my - rr < near.y1;
      poses.push(P);
    }
    for (let i = 0; i + 1 < poses.length; i++) if (poses[i] && poses[i + 1] && (poses[i].visible || poses[i + 1].visible)) this._drawCoupler(ctx, poses[i], poses[i + 1]);
    for (const P of poses) if (P) { if (P.visible) this._drawRailCar(ctx, P, dt, dts, v); else this._warmRailCar(P); }
    for (const P of poses) if (P && P.near) this._railEffects(P, dt, dts, v);
    // lamps: head lamp on the lead car, tail lamps on the last one
    const lead = poses[0], last = poses[poses.length - 1];
    if (lead) {
      const hm = lead.meta.head, tm = last && last.meta.tail;
      this._lights.push({
        head: hm && !lead.derailed ? rart(lead, hm[0], hm[1]) : null,
        tail: tm && !last.derailed ? rart(last, tm[0], tm[1]) : null,
        ang: lead.ang, L: lead.Lm, fallen: v.state === 'fallen', train: true
      });
    }
  };

  R._drawCoupler = function (ctx, A, B) {
    const chA = (A.def && A.def.couplerHeight) || 1, chB = (B.def && B.def.couplerHeight) || 1;
    let a = rloc(A, 0, chA), b = rloc(B, B.Lm, chB);
    const a2 = rloc(A, A.Lm, chA), b2 = rloc(B, 0, chB);
    let rev = false;
    if (Math.hypot(a2.x - b2.x, a2.y - b2.y) < Math.hypot(a.x - b.x, a.y - b.y)) { a = a2; b = b2; rev = true; }
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist > 3.5) return; // uncoupled / torn apart
    const px = 1 / this.camera.zoom;
    // gangway bellows between passenger cars
    const ga = A.meta.bellows, gb = B.meta.bellows;
    if (ga && gb && dist < 2) {
      const ax = rev ? A.Lm : 0, bx = rev ? 0 : B.Lm;
      const p = [rloc(A, ax, ga[0] / 100 * A.k), rloc(A, ax, ga[1] / 100 * A.k), rloc(B, bx, gb[1] / 100 * B.k), rloc(B, bx, gb[0] / 100 * B.k)];
      ctx.fillStyle = '#24282e';
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,128,138,0.55)'; ctx.lineWidth = Math.max(0.03, 0.8 * px);
      ctx.beginPath();
      for (let k = 1; k < 4; k++) {
        const t = k / 4;
        ctx.moveTo(lerp(p[0].x, p[3].x, t), lerp(p[0].y, p[3].y, t)); ctx.lineTo(lerp(p[1].x, p[2].x, t), lerp(p[1].y, p[2].y, t));
      }
      ctx.stroke();
    }
    // draw bar / screw coupling with hooks
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#15181c'; ctx.lineWidth = Math.max(0.13, 2.4 * px);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = '#6d7680'; ctx.lineWidth = Math.max(0.05, 1 * px);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.fillStyle = '#2a2f36';
    const hr = Math.max(0.07, 1.6 * px);
    ctx.beginPath(); ctx.arc(a.x, a.y, hr, 0, TAU); ctx.moveTo(b.x + hr, b.y); ctx.arc(b.x, b.y, hr, 0, TAU); ctx.fill();
  };

  R._drawRailCar = function (ctx, P, dt, dts, v) {
    const z = this.camera.zoom, d = this.dpr, px = 1 / z;
    const meta = P.meta, def = P.def, car = P.car;
    const ws = car.wheels || [], dw = (def && def.wheels) || [];
    // soft contact shadow on the deck
    ctx.save();
    ctx.translate(P.ox, P.oy); ctx.rotate(P.ang);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(P.Lm / 2, 0.02, P.Lm * 0.5, Math.max(0.1, P.Lm * 0.02), 0, 0, TAU); ctx.fill();
    // steam loco: dark frame plates behind the drivers
    if (meta.underframe) {
      const u = meta.underframe, k = P.k / 100;
      ctx.fillStyle = '#1b1e23';
      ctx.fillRect(u[0] * k, u[2] * k, (u[1] - u[0]) * k, (u[3] - u[2]) * k);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(u[0] * k, u[3] * k - 0.08, (u[1] - u[0]) * k, 0.04);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let x = u[0] + 70; x < u[1] - 20; x += 90) { ctx.beginPath(); ctx.arc(x * k, (u[2] + u[3]) * 0.55 * k, 0.07, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    // wheels
    let maxR = 0, minR = 1e9;
    for (let i = 0; i < ws.length; i++) { const r = ws[i].r || (dw[i] && dw[i].r) || P.wr; if (r > maxR) maxR = r; if (r < minR) minR = r; }
    const drivers = [];
    const angles = [];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const r = w.r || (dw[i] && dw[i].r) || P.wr;
      let a = typeof w.rot === 'number' && isFinite(w.rot) ? -w.rot : -P.cs.dist / r;
      const isDriver = !!meta.driver && maxR > minR * 1.3 && r > maxR * 0.9;
      angles.push(a);
      const name = 'rail/' + (isDriver ? meta.driver : (meta.wheel || 'rail_wheel'));
      const R2 = r * WHEEL_ART_SCALE;
      const img = Sprites.raster(name, 2 * R2 * z * d);
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(a);
      if (img) { ctx.scale(1, -1); ctx.drawImage(img, -R2, -R2, 2 * R2, 2 * R2); }
      else {
        ctx.fillStyle = '#1e2228'; ctx.beginPath(); ctx.arc(0, 0, R2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6d7680'; ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a2f36'; ctx.fillRect(-r * 0.06, 0, r * 0.12, r * 0.85);
      }
      ctx.restore();
      if (isDriver) drivers.push({ i, x: w.x, y: w.y, r, a, lx: dw[i] ? dw[i].x : 0 });
    }
    // bogie side frames over the wheels
    const bogies = (def && def.bogies) || [];
    for (let bi = 0; bi < bogies.length; bi++) {
      if (meta.noFrame && meta.noFrame[bi]) continue;
      const bg = bogies[bi];
      if (!bg.axles || bg.axles.length < 2) continue;
      let f = -1, l = -1;
      for (let i = 0; i < dw.length && i < ws.length; i++) if (dw[i].bogie === bi) { if (f < 0 || dw[i].x < dw[f].x) f = i; if (l < 0 || dw[i].x > dw[l].x) l = i; }
      if (f < 0 || l === f) continue;
      const art = bg.axles.length >= 3 ? BOGIE_ART.bogie3 : BOGIE_ART.bogie;
      const img = Sprites.raster(bg.axles.length >= 3 ? 'rail/bogie3' : 'rail/bogie', art.w / 100 * z * d * Math.abs(dw[l].x - dw[f].x) / (art.span / 100));
      const A = ws[f], B = ws[l];
      const span = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const r = A.r || dw[f].r || P.wr;
      const sx = span / (art.span / 100), sy = clamp(r / (art.r / 100), 0.6, 1.6);
      ctx.save();
      ctx.translate((A.x + B.x) / 2, (A.y + B.y) / 2);
      ctx.rotate(Math.atan2(B.y - A.y, B.x - A.x));
      ctx.scale(sx, -sy);
      if (img) ctx.drawImage(img, -art.ox / 100, -art.oy / 100, art.w / 100, art.h / 100);
      else { ctx.fillStyle = '#2a2f36'; ctx.fillRect(-art.span / 200 - 0.2, -0.3, art.span / 100 + 0.4, 0.4); }
      ctx.restore();
    }
    // body
    const body = meta.unknown ? null : Sprites.raster('rail/' + P.type, P.Lm * z * d);
    ctx.save();
    ctx.translate(P.ox, P.oy); ctx.rotate(P.ang);
    if (P.flip) { ctx.translate(P.Lm, 0); ctx.scale(-1, 1); }
    if (body) { ctx.scale(1, -1); ctx.drawImage(body, 0, -P.Hm, P.Lm, P.Hm); }
    else {
      const col = (def && def.color) || '#7a2630', H = ((def && def.height) || P.Hm);
      ctx.fillStyle = '#1a1d22'; roundRect(ctx, -0.03, 0.85, P.Lm + 0.06, H - 0.82, 0.2); ctx.fill();
      ctx.fillStyle = col; roundRect(ctx, 0.02, 0.9, P.Lm - 0.04, H - 0.92, 0.16); ctx.fill();
      ctx.fillStyle = 'rgba(160,210,240,0.85)'; ctx.fillRect(P.Lm * 0.08, H * 0.6, P.Lm * 0.84, H * 0.2);
    }
    ctx.restore();
    // steam locomotive valve gear: coupling rod, connecting rod, crosshead, eccentric + radius rods
    if (meta.steam && drivers.length >= 2) this._drawSteamMotion(ctx, P, drivers, px);
    // handcar pump lever + pitman rod to a crank on the front axle
    if (meta.lever && ws.length) {
      let fi = 0;
      for (let i = 1; i < ws.length; i++) if ((dw[i] ? dw[i].x : i) > (dw[fi] ? dw[fi].x : fi)) fi = i;
      const a = angles[fi];
      const th = 0.32 * Math.sin(-a);
      const pv = rart(P, meta.lever[0], meta.lever[1]);
      const fw = ws[fi], cr = 0.11 * P.k;
      const pin = { x: fw.x + cr * Math.cos(a), y: fw.y + cr * Math.sin(a) };
      const la = P.ang + th;
      const tip = { x: pv.x + Math.cos(la) * 0.55 * P.k, y: pv.y + Math.sin(la) * 0.55 * P.k };
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1c2230'; ctx.lineWidth = Math.max(0.07, 1.5 * px);
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(pin.x, pin.y); ctx.stroke();
      ctx.strokeStyle = '#8d97a3'; ctx.lineWidth = Math.max(0.035, 0.8 * px);
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(pin.x, pin.y); ctx.stroke();
      const img = Sprites.raster('rail/handcar_lever', 2.5 * P.k * z * d);
      ctx.save();
      ctx.translate(pv.x, pv.y); ctx.rotate(la); ctx.scale(1, -1);
      if (img) ctx.drawImage(img, -1.25 * P.k, -0.2 * P.k, 2.5 * P.k, 0.4 * P.k);
      else { ctx.fillStyle = '#b98149'; ctx.fillRect(-1.1 * P.k, -0.05, 2.2 * P.k, 0.1); }
      ctx.restore();
    }
  };

  // rasterise an off-screen car's sprites ahead of time (SVG rasterisation is the expensive part), so a
  // long consist rolling into view does not hitch
  R._warmRailCar = function (P) {
    const z = this.camera.zoom, d = this.dpr, meta = P.meta, def = P.def;
    if (meta.unknown || !def) return;
    Sprites.raster('rail/' + P.type, P.Lm * z * d);
    const seen = {};
    for (const w of def.wheels || []) {
      const r = w.r || P.wr, key = Math.round(r * 100);
      if (seen[key]) continue;
      seen[key] = 1;
      const isDriver = !!meta.driver && r > 0.6;
      Sprites.raster('rail/' + (isDriver ? meta.driver : (meta.wheel || 'rail_wheel')), 2 * r * WHEEL_ART_SCALE * z * d);
    }
    for (const bg of def.bogies || []) {
      if (!bg.axles || bg.axles.length < 2) continue;
      const art = bg.axles.length >= 3 ? BOGIE_ART.bogie3 : BOGIE_ART.bogie;
      const span = Math.abs(bg.axles[bg.axles.length - 1] - bg.axles[0]);
      Sprites.raster(bg.axles.length >= 3 ? 'rail/bogie3' : 'rail/bogie', art.w / 100 * z * d * span / (art.span / 100));
    }
  };

  R._drawSteamMotion = function (ctx, P, drivers, px) {
    drivers.sort(function (a, b) { return a.lx - b.lx; });
    const main = drivers[Math.floor((drivers.length - 1) / 2)];
    const st = P.meta.steam, k = P.k / 100;
    const a = main.a; // all drivers are coupled: one crank phase
    const cR = DRIVER_CRANK * main.r;
    const pins = drivers.map(function (dv) { return { x: dv.x + DRIVER_CRANK * dv.r * Math.cos(a), y: dv.y + DRIVER_CRANK * dv.r * Math.sin(a) }; });
    // crosshead in car-local coordinates
    const inv = function (q) { const dx = q.x - P.ox, dy = q.y - P.oy; return { x: P.c * dx + P.s * dy, y: -P.s * dx + P.c * dy }; };
    const mp = inv(pins[drivers.indexOf(main)]);
    const guideY = st.guideY * k, slideEnd = st.slideEnd * k;
    const mainLx = inv(main).x;
    const Lr = Math.max(0.5, slideEnd - mainLx - cR - 0.08);
    const dy = guideY - mp.y;
    const chx = mp.x + Math.sqrt(Math.max(0.01, Lr * Lr - dy * dy));
    const ch = rloc(P, chx, guideY);
    const rod = function (pts, w, dark, light) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = dark; ctx.lineWidth = Math.max(w, 2 * px);
      ctx.beginPath(); pts.forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke();
      ctx.strokeStyle = light; ctx.lineWidth = Math.max(w * 0.42, 0.9 * px);
      ctx.beginPath(); pts.forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke();
    };
    // piston rod into the cylinder
    rod([ch, rloc(P, slideEnd + 0.12, guideY)], 0.06 * P.k, '#2a2f36', '#e6ebf0');
    // eccentric (return crank, 90 deg ahead) -> expansion link -> radius rod to the valve spindle
    const ec = { x: main.x + cR * 0.62 * Math.cos(a + Math.PI / 2), y: main.y + cR * 0.62 * Math.sin(a + Math.PI / 2) };
    const link = rloc(P, mainLx + 1.45 * P.k, guideY + 0.5 * P.k);
    const lift = Math.sin(a) * 0.1 * P.k;
    const linkPt = rloc(P, mainLx + 1.45 * P.k, guideY + 0.5 * P.k + lift);
    rod([ec, linkPt], 0.05 * P.k, '#1c2230', '#9aa4ae');
    rod([linkPt, rloc(P, slideEnd + 0.05, 1.42 * P.k)], 0.045 * P.k, '#1c2230', '#9aa4ae');
    ctx.fillStyle = '#2a2f36';
    roundRect(ctx, link.x - 0.05 * P.k, link.y - 0.2 * P.k, 0.1 * P.k, 0.4 * P.k, 0.04 * P.k); ctx.fill();
    // coupling rod linking every driver's crank pin
    rod(pins, 0.1 * P.k, '#2a2f36', '#d9dfe5');
    // connecting (main) rod: crank pin -> crosshead
    rod([pins[drivers.indexOf(main)], ch], 0.12 * P.k, '#1c2230', '#f1f4f7');
    // crosshead block between the slide bars
    ctx.save();
    ctx.translate(ch.x, ch.y); ctx.rotate(P.ang);
    ctx.fillStyle = '#1c2230'; roundRect(ctx, -0.17 * P.k, -0.12 * P.k, 0.34 * P.k, 0.24 * P.k, 0.04 * P.k); ctx.fill();
    ctx.fillStyle = '#8d97a3'; roundRect(ctx, -0.13 * P.k, -0.08 * P.k, 0.26 * P.k, 0.16 * P.k, 0.03 * P.k); ctx.fill();
    ctx.restore();
    // crank pin bosses
    ctx.fillStyle = '#c9d1da';
    ctx.beginPath();
    for (const q of pins) { ctx.moveTo(q.x + 0.06 * P.k, q.y); ctx.arc(q.x, q.y, 0.06 * P.k, 0, TAU); }
    ctx.fill();
    ctx.fillStyle = '#2a2f36';
    ctx.beginPath();
    for (const q of pins) { ctx.moveTo(q.x + 0.025 * P.k, q.y); ctx.arc(q.x, q.y, 0.025 * P.k, 0, TAU); }
    ctx.fill();
  };

  // smoke, steam, exhaust, pantograph arcs, brake + derail sparks (visual only)
  R._railEffects = function (P, dt, dts, v) {
    const fx = this.effects;
    if (!fx) return;
    const meta = P.meta, cs = P.cs, car = P.car;
    const speed = Math.abs(cs.v);
    const vxw = cs.v * P.c;
    const step = dts > 0 ? dts : (v.preview ? dt : 0);
    if (!(step > 0)) return;
    const accel = cs.a * (cs.v >= 0 ? 1 : -1);
    const dead = P.derailed || v.state === 'fallen';
    // steam locomotive: chuffs synced to the drivers (4 beats per revolution), lazy wisps at rest
    if (meta.chimney && !dead && fx.steamPuff) {
      const ch = rart(P, meta.chimney[0], meta.chimney[1]);
      let rD = 0;
      for (const w of (P.def && P.def.wheels) || []) rD = Math.max(rD, w.r || 0);
      rD = rD || 0.75;
      const throttle = clamp(0.55 + accel * 1.6 + (speed < 4 ? 0.35 : 0), 0.2, 1.6);
      cs.chuff += speed * step / rD;
      const beat = Math.PI / 2;
      let n = 0;
      while (cs.chuff >= beat && n < 3) { cs.chuff -= beat; n++; }
      if (cs.chuff >= beat) cs.chuff %= beat;
      for (let i = 0; i < n; i++) fx.steamPuff(ch.x, ch.y, vxw, throttle, speed);
      // a continuous lighter trail between the beats (and lazy wisps at rest)
      cs.emit -= step;
      if (cs.emit <= 0) { cs.emit = speed < 0.5 ? 0.35 + Math.random() * 0.25 : 0.11 + Math.random() * 0.05; fx.steamPuff(ch.x, ch.y, vxw, speed < 0.5 ? 0.25 : 0.3, speed); }
      // cylinder drain cocks hiss while starting
      if (meta.cocks && speed > 0.2 && speed < 3.5 && n > 0) {
        const cc = rart(P, meta.cocks[0], meta.cocks[1]);
        fx.cylinderSteam(cc.x, cc.y, P.c);
      }
    }
    // a wrecked steam engine keeps hissing (until it is under water)
    if (meta.chimney && dead && fx.steamHiss) {
      const ch = rart(P, meta.chimney[0], meta.chimney[1]);
      const wy = this.level.terrain.waterY;
      cs.emit -= step;
      if (cs.emit <= 0 && !(wy !== null && wy !== undefined && ch.y < wy + 0.3)) { cs.emit = 0.12 + Math.random() * 0.1; fx.steamHiss(ch.x, ch.y); }
    }
    // diesel exhaust
    if (meta.exhaust && !dead && fx.dieselExhaust) {
      cs.emit -= step;
      if (cs.emit <= 0) {
        const throttle = clamp(0.45 + accel * 2.2 + (speed > 1 ? 0.2 : 0), 0.15, 1.5);
        cs.emit = 0.035 + 0.06 / (0.6 + throttle);
        const e = rart(P, meta.exhaust[0], meta.exhaust[1]);
        fx.dieselExhaust(e.x, e.y, vxw, throttle);
      }
    }
    // pantograph arcing at speed
    if (meta.panto && !dead && speed > 8 && fx.arc) {
      cs.arc -= step * (0.25 + speed / 60);
      if (cs.arc <= 0) { cs.arc = 0.6 + Math.random() * 2.2; const p = rart(P, meta.panto[0], meta.panto[1]); fx.arc(p.x, p.y + 0.02); }
    }
    // brake sparks under the wheels / derailment sparks + dust
    const ws = car.wheels || [];
    if (!ws.length || !fx.wheelSparks) return;
    const decel = -accel;
    if (!dead && speed > 1.2 && decel > 0.8 && P.visible) {
      cs.spark += step * clamp((decel - 0.8) * 5, 0, 10) * ws.length;
      while (cs.spark >= 1) {
        cs.spark -= 1;
        const w = ws[(Math.random() * ws.length) | 0];
        const r = w.r || P.wr;
        fx.wheelSparks(w.x - P.s * -r, w.y - P.c * r, vxw, clamp(decel / 3, 0.4, 1.4));
      }
    } else if (dead && speed > 0.8 && P.visible) {
      // the car is grinding along: sparks + dust at its lowest corner
      cs.spark += step * clamp(speed * 5, 0, 40);
      const c0 = rloc(P, 0, 0), c1 = rloc(P, P.Lm, 0), c2 = rloc(P, 0, P.Hm), c3 = rloc(P, P.Lm, P.Hm);
      let lo = c0;
      for (const q of [c1, c2, c3]) if (q.y < lo.y) lo = q;
      while (cs.spark >= 1) {
        cs.spark -= 1;
        fx.wheelSparks(lo.x + (Math.random() - 0.5) * 0.6, lo.y + 0.05, vxw, 1.2);
        if (Math.random() < 0.35) fx.derailDust(lo.x, lo.y + 0.1, 1, 0.8);
      }
    }
  };
  // signal lamps: red while editing / after a failed run, green while a test runs
  R._drawSignals = function (ctx, mode, state) {
    const sim = state.sim;
    const failed = sim && sim.status === 'failed';
    const go = mode !== 'edit' && !failed;
    const amt = Math.max(0.35, this.theme.lights || 0);
    const t = this.time;
    ctx.save();
    for (const s of this._signals) {
      const y = s.kind === 'light' ? s.y - (go ? 0 : 2 * s.dy) : s.y;
      const col = go ? [90, 255, 140] : [255, 70, 50];
      const fl = 0.92 + 0.08 * Math.sin(t * 9 + s.x);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgb(' + col.join(',') + ')';
      ctx.beginPath(); ctx.arc(s.x, y, 0.11, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(s.x, y, 0, s.x, y, 0.9);
      g.addColorStop(0, 'rgba(' + col.join(',') + ',' + 0.55 * amt * fl + ')'); g.addColorStop(1, 'rgba(' + col.join(',') + ',0)');
      ctx.fillStyle = g; ctx.fillRect(s.x - 0.9, y - 0.9, 1.8, 1.8);
    }
    ctx.restore();
  };

  // train lamps (either end may be missing): a long head-lamp beam along the track, red tail glow
  R._drawLamp = function (ctx, l, amt) {
    if (l.head) {
      const len = l.train ? 16 : 5.5 + l.L * 0.15;
      const c = Math.cos(l.ang - 0.02), s = Math.sin(l.ang - 0.02);
      const g = ctx.createLinearGradient(l.head.x, l.head.y, l.head.x + c * len, l.head.y + s * len);
      g.addColorStop(0, 'rgba(255,244,205,' + 0.34 * amt + ')');
      g.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = g;
      const c1 = Math.cos(l.ang + 0.06), s1 = Math.sin(l.ang + 0.06), c2 = Math.cos(l.ang - 0.09), s2 = Math.sin(l.ang - 0.09);
      ctx.beginPath();
      ctx.moveTo(l.head.x, l.head.y + 0.06);
      ctx.lineTo(l.head.x + c1 * len, l.head.y + s1 * len);
      ctx.lineTo(l.head.x + c2 * len, l.head.y + s2 * len);
      ctx.lineTo(l.head.x, l.head.y - 0.08);
      ctx.fill();
      const hg = ctx.createRadialGradient(l.head.x, l.head.y, 0, l.head.x, l.head.y, 0.9);
      hg.addColorStop(0, 'rgba(255,252,230,' + 0.95 * amt + ')'); hg.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = hg; ctx.fillRect(l.head.x - 0.9, l.head.y - 0.9, 1.8, 1.8);
    }
    if (l.tail) {
      const tg = ctx.createRadialGradient(l.tail.x, l.tail.y, 0, l.tail.x, l.tail.y, 0.7);
      tg.addColorStop(0, 'rgba(255,60,40,' + 0.85 * amt + ')'); tg.addColorStop(1, 'rgba(255,40,30,0)');
      ctx.fillStyle = tg; ctx.fillRect(l.tail.x - 0.7, l.tail.y - 0.7, 1.4, 1.4);
    }
  };
  R._drawLights = function (ctx) {
    const amt = this.theme.lights;
    if (!amt || !this._lights || !this._lights.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this._lights) {
      if (l.fallen) continue;
      if (l.train || !l.head || !l.tail) { this._drawLamp(ctx, l, amt); continue; }
      const len = 5.5 + l.L * 0.15;
      const c = Math.cos(l.ang - 0.04), s = Math.sin(l.ang - 0.04);
      const g = ctx.createLinearGradient(l.head.x, l.head.y, l.head.x + c * len, l.head.y + s * len);
      g.addColorStop(0, 'rgba(255,240,190,' + 0.3 * amt + ')');
      g.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(l.head.x, l.head.y + 0.05);
      const c1 = Math.cos(l.ang + 0.07), s1 = Math.sin(l.ang + 0.07);
      const c2 = Math.cos(l.ang - 0.11), s2 = Math.sin(l.ang - 0.11);
      ctx.lineTo(l.head.x + c1 * len, l.head.y + s1 * len);
      ctx.lineTo(l.head.x + c2 * len, l.head.y + s2 * len);
      ctx.lineTo(l.head.x, l.head.y - 0.08);
      ctx.fill();
      const hg = ctx.createRadialGradient(l.head.x, l.head.y, 0, l.head.x, l.head.y, 0.7);
      hg.addColorStop(0, 'rgba(255,250,220,' + 0.9 * amt + ')'); hg.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = hg; ctx.fillRect(l.head.x - 0.7, l.head.y - 0.7, 1.4, 1.4);
      const tg = ctx.createRadialGradient(l.tail.x, l.tail.y, 0, l.tail.x, l.tail.y, 0.6);
      tg.addColorStop(0, 'rgba(255,60,40,' + 0.8 * amt + ')'); tg.addColorStop(1, 'rgba(255,40,30,0)');
      ctx.fillStyle = tg; ctx.fillRect(l.tail.x - 0.6, l.tail.y - 0.6, 1.2, 1.2);
    }
    // street lamps
    for (const lp of this._lamps) {
      const r = 3.2;
      const flick = 0.92 + 0.08 * Math.sin(this.time * 13 + lp.x);
      const g = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, r);
      g.addColorStop(0, 'rgba(255,220,150,' + 0.55 * amt * flick + ')'); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.fillRect(lp.x - r, lp.y - r, r * 2, r * 2);
      const cg = ctx.createLinearGradient(lp.x, lp.y, lp.x, lp.y - 6.5);
      cg.addColorStop(0, 'rgba(255,220,150,' + 0.22 * amt + ')'); cg.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.moveTo(lp.x - 0.15, lp.y); ctx.lineTo(lp.x + 0.15, lp.y); ctx.lineTo(lp.x + 1.8, lp.y - 6.5); ctx.lineTo(lp.x - 1.8, lp.y - 6.5); ctx.fill();
    }
    ctx.restore();
  };

  // =====================================================================================
  // water / lava
  // =====================================================================================
  R._waveY = function (x, t) {
    return 0.06 * Math.sin(0.9 * x + 1.7 * t) + 0.035 * Math.sin(2.3 * x - 2.6 * t) + 0.018 * Math.sin(4.7 * x + 3.9 * t);
  };
  R._drawWater = function (ctx, state, sh) {
    const L = this.level, t = L.terrain, T = this.terrain;
    if (t.waterY === null || t.waterY === undefined) return;
    const wy = t.waterY;
    if (wy <= T.fy) return;
    const th = this.theme;
    const xl = profileX(T.left, wy), xr = profileX(T.right, wy);
    const W = this.W, H = this.H, d = this.dpr, z = this.camera.zoom;
    const sl = Math.max(-2, this.worldToScreen(xl, 0).x + sh.x), sr = Math.min(W + 2, this.worldToScreen(xr, 0).x + sh.x);
    if (sr <= sl) return;
    const sy = this.worldToScreen(0, wy).y + sh.y;
    const sb = Math.min(H + 2, this.worldToScreen(0, T.fy - 1).y + sh.y);
    if (sy > H + 10) return;
    const time = this.time;
    const camx = this.camera.x;
    // surface points
    const step = 5;
    const pts = [];
    for (let s = sl; s <= sr + step - 0.01; s += step) {
      const sx = Math.min(s, sr);
      const wx = camx + (sx - sh.x - W / 2) / z;
      pts.push(sx, sy - this._waveY(wx, time) * z);
    }
    const surfPath = function () {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    };
    const cy = this.camera.y;
    const toS = function (q) { return [W / 2 + (q.x - camx) * z + sh.x, H / 2 - (q.y - cy) * z + sh.y]; };
    const rightDown = T.right.filter(function (q) { return q.y < wy; }).map(toS);
    const leftUp = T.left.filter(function (q) { return q.y < wy; }).map(toS).reverse();
    const floorBack = T.floor.map(toS).reverse();
    const bodyPath = function () {
      surfPath();
      for (const q of rightDown) ctx.lineTo(q[0], q[1]);
      for (const q of floorBack) ctx.lineTo(q[0], q[1] + 2);
      for (const q of leftUp) ctx.lineTo(q[0], q[1]);
      ctx.closePath();
    };
    const valleyPath = function () {
      const P = T.left.map(toS).concat(T.floor.map(toS), T.right.map(toS).reverse());
      ctx.beginPath();
      if (!P.length) return;
      ctx.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
      ctx.closePath();
    };
    if (th.lava) { this._drawLava(ctx, pts, sl, sr, sy, sb, surfPath, bodyPath, valleyPath); return; }
    // reflection capture: region above the waterline
    const reflH = Math.max(0, Math.min(sb - sy, 340, sy));
    const rw = Math.round((sr - sl) * d), rh = Math.round(reflH * d);
    let canRefl = rw > 2 && rh > 2;
    if (canRefl) {
      if (this._refl.width < rw || this._refl.height < rh) { this._refl.width = Math.max(rw, this._refl.width); this._refl.height = Math.max(rh, this._refl.height); }
      const rg = this._refl.getContext('2d');
      rg.setTransform(1, 0, 0, 1, 0, 0);
      rg.clearRect(0, 0, rw, rh);
      try { rg.drawImage(this.canvas, Math.round(sl * d), Math.round((sy - reflH) * d), rw, rh, 0, 0, rw, rh); } catch (e) { canRefl = false; }
    }
    this._screenXf(ctx);
    // body
    bodyPath();
    const wc = th.water;
    const g = ctx.createLinearGradient(0, sy, 0, sb);
    g.addColorStop(0, rgba(wc[0], 0.8));
    g.addColorStop(Math.min(0.5, 120 / Math.max(1, sb - sy)), rgba(wc[1], 0.86));
    g.addColorStop(1, rgba(wc[2], 0.95));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // reflection strips (mirrored, rippled)
    if (canRefl) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sh2 = 3 * d;
      const top = Math.round(sy * d);
      for (let j = 0; j < rh; j += sh2) {
        const k = j / rh;
        const off = Math.sin(j * 0.045 / d + time * 2.2) * (1.5 + k * 7) * d + Math.sin(j * 0.13 / d - time * 3.1) * d;
        ctx.globalAlpha = 0.3 * (1 - k) * (1 - k);
        ctx.drawImage(this._refl, 0, rh - j - sh2, rw, sh2, Math.round(sl * d + off), top + j, rw, sh2);
      }
      ctx.globalAlpha = 1;
      this._screenXf(ctx);
    }
    // light caustic shimmer streaks (world anchored)
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    const wx0 = camx + (sl - W / 2) / z, wx1 = camx + (sr - W / 2) / z;
    const cell = 2.2;
    for (let i = Math.floor(wx0 / cell); i <= Math.ceil(wx1 / cell); i++) {
      for (let j = 0; j < 5; j++) {
        const r = hash2(i, j, 31);
        const depth = (j + r) * 0.35 + 0.15;
        if (depth * z > sb - sy) continue;
        const a = Math.max(0, Math.sin(time * (0.8 + r) + r * 20));
        if (a < 0.2) continue;
        const x = (i + r) * cell + Math.sin(time * 0.5 + r * 9) * 0.4;
        const sx = W / 2 + (x - camx) * z;
        const len = (0.4 + r * 0.9) * z * (1 - j * 0.12);
        ctx.globalAlpha = a * 0.35 * (1 - j / 5);
        ctx.fillRect(sx - len / 2, sy + depth * z, len, Math.max(1, 0.05 * z));
      }
    }
    ctx.globalAlpha = 1;
    // depth fog at the bottom
    ctx.restore();
    // surface highlight line + soft band
    surfPath();
    ctx.lineWidth = Math.max(1.2, 0.06 * z);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
    const bg2 = ctx.createLinearGradient(0, sy, 0, sy + Math.max(6, 0.4 * z));
    bg2.addColorStop(0, 'rgba(255,255,255,0.22)'); bg2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bg2;
    ctx.fillRect(sl, sy, sr - sl, Math.max(6, 0.4 * z));
    // foam at banks, piers, and submerged beams
    const foamAt = (wx, size) => {
      const sx = W / 2 + (wx - camx) * z + sh.x;
      const wv = sy - this._waveY(wx, time) * z;
      for (let k = 0; k < 4; k++) {
        const ph = time * 2.4 + k * 1.7 + wx;
        const ox = Math.sin(ph) * size * 0.6 + (k - 1.5) * size * 0.45;
        const rr = size * (0.35 + 0.25 * (0.5 + 0.5 * Math.sin(ph * 1.3)));
        ctx.globalAlpha = 0.55 + 0.3 * Math.sin(ph * 0.7);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(sx + ox, wv, rr, rr * 0.38, 0, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const fs = Math.max(3, 0.45 * z);
    foamAt(xl + 0.3, fs); foamAt(xr - 0.3, fs);
    for (const p of this._pierList(state)) if (p.baseY < wy && p.topY > wy) { foamAt(p.x - 0.85, fs * 0.8); foamAt(p.x + 0.85, fs * 0.8); }
    if (this._beamItems) for (const it of this._beamItems) {
      if ((it.ay - wy) * (it.by - wy) < 0) {
        const k = (wy - it.ay) / (it.by - it.ay);
        foamAt(it.ax + (it.bx - it.ax) * k, fs * 0.6);
      }
    }
  };
  R._drawLava = function (ctx, pts, sl, sr, sy, sb, surfPath, bodyPath, valleyPath) {
    const W = this.W, z = this.camera.zoom, time = this.time, camx = this.camera.x;
    this._screenXf(ctx);
    // heat glow above (kept inside the valley so it never paints over the cliffs)
    ctx.save();
    if (valleyPath) { valleyPath(); ctx.clip(); }
    ctx.globalCompositeOperation = 'lighter';
    const gh = Math.max(30, 5 * z);
    const glow = ctx.createLinearGradient(0, sy - gh, 0, sy);
    glow.addColorStop(0, 'rgba(255,90,20,0)'); glow.addColorStop(1, 'rgba(255,110,30,' + (0.35 + 0.05 * Math.sin(time * 2)) + ')');
    ctx.fillStyle = glow; ctx.fillRect(sl, sy - gh, sr - sl, gh);
    ctx.restore();
    bodyPath();
    const g = ctx.createLinearGradient(0, sy, 0, sb);
    g.addColorStop(0, '#ffd25a'); g.addColorStop(Math.min(0.4, 50 / Math.max(1, sb - sy)), '#ff6a14'); g.addColorStop(1, '#6a1404');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    // drifting crust plates
    const cell = 3.5;
    const wx0 = camx + (sl - W / 2) / z - cell * 2, wx1 = camx + (sr - W / 2) / z + cell;
    const drift = time * 0.25;
    for (let i = Math.floor((wx0 - drift) / cell); i <= Math.ceil((wx1 - drift) / cell); i++) {
      const r = hash2(i, 1, 51);
      if (r > 0.65) continue;
      const x = (i + r * 0.5) * cell + drift;
      const sx = W / 2 + (x - camx) * z;
      const w = (0.8 + r * 1.8) * z, h = Math.max(2, (0.12 + r * 0.12) * z);
      ctx.fillStyle = 'rgba(60,18,8,' + (0.55 + r * 0.3) + ')';
      ctx.beginPath(); ctx.ellipse(sx, sy + h * 0.6, w / 2, h, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,80,0.5)'; ctx.lineWidth = 1;
      ctx.stroke();
    }
    // bubbles
    for (let i = 0; i < 6; i++) {
      const ph = (time * 0.6 + i * 0.37) % 1;
      const x = sl + (hash2(i, Math.floor(time * 0.6 + i * 0.37), 3)) * (sr - sl);
      const r = (0.1 + ph * 0.25) * z;
      ctx.globalAlpha = 1 - ph;
      ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = Math.max(1, 0.04 * z);
      ctx.beginPath(); ctx.arc(x, sy + 2, r, Math.PI, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    surfPath();
    ctx.strokeStyle = '#fff0a8'; ctx.lineWidth = Math.max(1.5, 0.07 * z); ctx.stroke();
  };

  // little ship sailing through channel zones (drawn before the water so its hull is submerged)
  R._drawShips = function (ctx) {
    const L = this.level, t = L.terrain;
    if (t.waterY === null || t.waterY === undefined || this.theme.lava) return;
    const zones = L.noBuild || [];
    for (let i = 0; i < zones.length; i++) {
      const nb = zones[i];
      if (nb.y0 > t.waterY + 1.5 || nb.y1 < t.waterY + 2) continue;
      const zw = nb.x1 - nb.x0;
      const hmax = nb.y1 - t.waterY;
      const len = clamp(Math.min(zw * 0.7, hmax * 1.8), 3, 22);
      const x = (nb.x0 + nb.x1) / 2 + Math.sin(this.time * 0.08 + i) * zw * 0.12 - len / 2;
      const y = t.waterY - len * 0.06 + Math.sin(this.time * 1.4 + i) * 0.04 * len;
      const tilt = Math.sin(this.time * 1.1 + i) * 0.02;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(len, len);
      // hull (lighter, rim-lit at night so it reads against dark water)
      const nightShip = !!this.theme.night;
      ctx.fillStyle = nightShip ? '#4f74a0' : '#1f3550';
      ctx.beginPath(); ctx.moveTo(0, 0.16); ctx.lineTo(1.0, 0.18); ctx.lineTo(0.9, -0.06); ctx.lineTo(0.08, -0.06); ctx.closePath(); ctx.fill();
      if (nightShip) { ctx.strokeStyle = 'rgba(225,238,255,0.7)'; ctx.lineWidth = 0.012; ctx.stroke(); }
      ctx.fillStyle = '#c63b2f';
      ctx.beginPath(); ctx.moveTo(0.06, -0.01); ctx.lineTo(0.93, -0.01); ctx.lineTo(0.9, -0.06); ctx.lineTo(0.08, -0.06); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0.02, 0.15, 0.97, 0.025);
      // cabin
      ctx.fillStyle = '#f4f6f8'; ctx.fillRect(0.12, 0.18, 0.3, 0.12); ctx.fillRect(0.16, 0.3, 0.2, 0.08);
      ctx.fillStyle = nightShip ? '#ffd27a' : '#2a4a6a';
      for (let k = 0; k < 4; k++) ctx.fillRect(0.14 + k * 0.07, 0.23, 0.045, 0.035);
      ctx.fillRect(0.18, 0.33, 0.16, 0.03);
      // foam at the waterline
      ctx.fillStyle = nightShip ? 'rgba(230,240,255,0.55)' : 'rgba(255,255,255,0.45)';
      ctx.fillRect(-0.03, 0.052, 1.06, 0.014);
      if (nightShip) { ctx.fillStyle = '#ff5a4a'; ctx.fillRect(0.005, 0.17, 0.02, 0.02); ctx.fillStyle = '#5aff8a'; ctx.fillRect(0.975, 0.19, 0.02, 0.02); }
      // funnel
      ctx.fillStyle = '#e8a33a'; ctx.fillRect(0.24, 0.38, 0.06, 0.1);
      ctx.fillStyle = '#222'; ctx.fillRect(0.24, 0.46, 0.06, 0.02);
      // containers
      const cc = ['#2f8bd0', '#e0533c', '#46a35a', '#e8b33a'];
      for (let k = 0; k < 5; k++) { ctx.fillStyle = cc[(k + i) % 4]; ctx.fillRect(0.47 + k * 0.085, 0.18, 0.078, 0.07 + (k % 2) * 0.06); }
      // mast
      ctx.fillStyle = '#d8dde2'; ctx.fillRect(0.3, 0.38, 0.012, Math.min(0.3, (hmax - len * 0.5) / len));
      ctx.restore();
      // smoke
      if (this.effects && Math.random() < 0.06) this.effects.exhaust(x + len * 0.27, y + len * 0.48, 0.5, 2);
    }
  };

  // =====================================================================================
  // edit overlays
  // =====================================================================================
  R._drawEditUnder = function (ctx, state) {
    const L = this.level, es = state.editorState || {};
    this._pierLabels = [];
    const ba = L.buildArea;
    const W = this.W, H = this.H, z = this.camera.zoom;
    this._screenXf(ctx);
    if (ba) {
      const p0 = this.worldToScreen(ba.x0, ba.y1), p1 = this.worldToScreen(ba.x1, ba.y0);
      // dim outside the build area
      ctx.fillStyle = 'rgba(8,16,32,0.1)';
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.fill('evenodd');
      // grid
      ctx.save();
      ctx.beginPath(); ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      const v = this._visibleWorld();
      const gx0 = Math.max(Math.ceil(ba.x0), Math.floor(v.x0)), gx1 = Math.min(Math.floor(ba.x1), Math.ceil(v.x1));
      const gy0 = Math.max(Math.ceil(ba.y0), Math.floor(v.y0)), gy1 = Math.min(Math.floor(ba.y1), Math.ceil(v.y1));
      const minor = z >= 9;
      const gridOn = state.showGrid !== false && this.showGrid !== false;
      const lineSet = function (major) {
        ctx.beginPath();
        for (let x = gx0; x <= gx1; x++) {
          const isMaj = x % 5 === 0;
          if (isMaj !== major || (!major && !minor)) continue;
          const sx = Math.round(W / 2 + (x - this.camera.x) * z) + 0.5;
          ctx.moveTo(sx, p0.y); ctx.lineTo(sx, p1.y);
        }
        for (let y = gy0; y <= gy1; y++) {
          const isMaj = y % 5 === 0;
          if (isMaj !== major || (!major && !minor)) continue;
          const sy = Math.round(H / 2 - (y - this.camera.y) * z) + 0.5;
          ctx.moveTo(p0.x, sy); ctx.lineTo(p1.x, sy);
        }
      }.bind(this);
      ctx.lineWidth = 1;
      if (gridOn) {
      lineSet(false); ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.stroke();
      lineSet(true); ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.stroke();
      }
      ctx.restore();
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -this.time * 12;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.round(p0.x) + 0.5, Math.round(p0.y) + 0.5, Math.round(p1.x - p0.x), Math.round(p1.y - p0.y));
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    // pier zones
    if ((L.maxPiers || 0) > 0 && L.pierZones && L.pierZones.length) {
      const active = es.tool === 'pier';
      const fy = L.terrain.floorY;
      for (const pz of L.pierZones) {
        const a = this.worldToScreen(pz.x0, fy), b = this.worldToScreen(pz.x1, fy);
        const topS = this.worldToScreen(0, Math.max(L.terrain.leftY, L.terrain.rightY) + 2).y;
        const col = ctx.createLinearGradient(0, a.y, 0, topS);
        col.addColorStop(0, 'rgba(255,214,90,' + (active ? 0.3 : 0.14) + ')'); col.addColorStop(1, 'rgba(255,214,90,0)');
        ctx.fillStyle = col; ctx.fillRect(a.x, topS, b.x - a.x, a.y - topS);
        // hazard stripe band on the floor
        const bh = Math.max(5, 0.35 * z);
        ctx.save();
        ctx.beginPath(); ctx.rect(a.x, a.y - bh, b.x - a.x, bh); ctx.clip();
        ctx.fillStyle = '#f5c542'; ctx.fillRect(a.x, a.y - bh, b.x - a.x, bh);
        ctx.fillStyle = '#2a2a2a';
        for (let x = a.x - bh * 2; x < b.x + bh; x += bh * 1.6) { ctx.beginPath(); ctx.moveTo(x, a.y); ctx.lineTo(x + bh * 0.8, a.y); ctx.lineTo(x + bh * 1.6, a.y - bh); ctx.lineTo(x + bh * 0.8, a.y - bh); ctx.fill(); }
        ctx.restore();
        const wy = L.terrain.waterY;
        const ly = (wy !== null && wy !== undefined && wy > fy) ? this.worldToScreen(0, wy).y - 14 : a.y - bh - 12;
        const taken = ((state.design && state.design.piers) || []).some(function (p) { return p.x >= pz.x0 - 0.01 && p.x <= pz.x1 + 0.01; });
        if (!taken) (this._pierLabels || (this._pierLabels = [])).push([(a.x + b.x) / 2, ly, b.x - a.x]);
      }
    }
    // mirror axis
    if (es.mirror || state.mirror) {
      const t = L.terrain;
      const mx = typeof es.mirrorAxis === 'number' ? es.mirrorAxis : typeof es.mirrorX === 'number' ? es.mirrorX : (t.leftEdge + t.rightEdge) / 2;
      const sx = Math.round(this.worldToScreen(mx, 0).x) + 0.5;
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(120,220,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      ctx.setLineDash([]);
    }
  };
  R._drawNoBuild = function (ctx, state) {
    const L = this.level;
    const zones = L.noBuild || [];
    if (!zones.length) return;
    this._screenXf(ctx);
    const edit = (state.mode || 'edit') === 'edit';
    for (const nb of zones) {
      const p0 = this.worldToScreen(nb.x0, nb.y1), p1 = this.worldToScreen(nb.x1, nb.y0);
      const w = p1.x - p0.x, h = p1.y - p0.y;
      if (!edit) {
        ctx.strokeStyle = 'rgba(255,90,70,0.25)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
        ctx.strokeRect(p0.x + 0.5, p0.y + 0.5, w, h); ctx.setLineDash([]);
        continue;
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(p0.x, p0.y, w, h); ctx.clip();
      ctx.fillStyle = 'rgba(255,70,50,0.10)'; ctx.fillRect(p0.x, p0.y, w, h);
      ctx.strokeStyle = 'rgba(255,90,70,0.38)'; ctx.lineWidth = 2;
      ctx.beginPath();
      const sp = 14, off = (this.time * 10) % sp;
      for (let x = p0.x - h + off - sp; x < p1.x + sp; x += sp) { ctx.moveTo(x, p1.y); ctx.lineTo(x + h, p0.y); }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,100,80,0.85)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.strokeRect(Math.round(p0.x) + 0.5, Math.round(p0.y) + 0.5, Math.round(w), Math.round(h));
      ctx.setLineDash([]);
      if (w > 60 && h > 30) this._label(ctx, p0.x + w / 2, p0.y + 14, 'NO BUILD', 'rgba(90,20,14,0.75)', '#ffb4a8', 10);
    }
  };

  R._label = function (ctx, x, y, text, bg, fg, size) {
    size = size || 12;
    ctx.font = '700 ' + size + 'px ' + FONT;
    const tw = ctx.measureText(text).width;
    const pw = tw + size * 1.3, ph = size * 1.9;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(ctx, x - pw / 2, y - ph / 2 + 1.5, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = bg;
    roundRect(ctx, x - pw / 2, y - ph / 2, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  };

  R._resolveNode = function (ref) {
    if (ref === null || ref === undefined) return null;
    if (typeof ref === 'string') return this._nodeMap[ref] || null;
    if (typeof ref === 'number') return this._nodeList[ref] || null;
    if (typeof ref === 'object') {
      if (ref.id && this._nodeMap[ref.id]) return this._nodeMap[ref.id];
      if (typeof ref.x === 'number') return ref;
    }
    return null;
  };
  R._resolveBeam = function (ref, items) {
    if (ref === null || ref === undefined) return null;
    let idx = ref;
    if (typeof ref === 'object') idx = ref.index !== undefined ? ref.index : ref.beamIndex !== undefined ? ref.beamIndex : ref.i;
    if (typeof idx !== 'number') return null;
    return items.filter(function (it) { return it.i === idx; });
  };
  R._halo = function (ctx, its, color, extraPx) {
    if (!its || !its.length) return;
    const px = 1 / this.camera.zoom;
    for (const it of its) {
      if (it._nx === undefined) upNormal(it);
      const road = isDeck(it.st);
      strokeSet(ctx, [it], road ? 0.5 : 0, it.st.w + extraPx * px, color, road, null, 'round');
    }
  };

  R._validation = function (L, design) {
    if (!BG.Model || !BG.Model.validate || !design) return null;
    let sig = (design.nodes ? design.nodes.length : 0) + '|' + (design.beams ? design.beams.length : 0) + '|' + (design.piers ? design.piers.length : 0);
    let h = 0;
    for (const n of design.nodes || []) h = (h * 31 + Math.round(n.x * 100) * 7 + Math.round(n.y * 100)) | 0;
    for (const b of design.beams || []) h = (h * 31 + String(b.a).length * 3 + String(b.b).charCodeAt(1) + (b.m || '').length) | 0;
    for (const p of design.piers || []) h = (h * 31 + Math.round(p.x * 100) + Math.round(p.topY * 10)) | 0;
    sig += '|' + h;
    if (sig === this._val.sig) return this._val.res;
    let res = null;
    try { res = BG.Model.validate(L, design); } catch (e) { res = null; }
    this._val = { sig, res };
    return res;
  };

  R._drawEditOver = function (ctx, state, items, sh) {
    const L = this.level, es = state.editorState || {};
    const z = this.camera.zoom, px = 1 / z;
    this._worldXf(ctx, sh.x, sh.y);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    // invalid beams / nodes from validation
    const val = this._validation(L, state.design);
    if (val && val.errors && val.errors.length) {
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.35 * pulse;
      const bad = [];
      const badNodes = [];
      for (const e of val.errors) {
        if (typeof e.beamIndex === 'number') bad.push.apply(bad, items.filter(function (it) { return it.i === e.beamIndex; }));
        if (e.nodeId) { const n = this._nodeMap[e.nodeId]; if (n) badNodes.push(n); }
      }
      this._halo(ctx, bad, '#ff3b30', 7);
      ctx.fillStyle = '#ff3b30';
      for (const n of badNodes) { ctx.beginPath(); ctx.arc(n.x, n.y, 0.45 + 8 * px, 0, TAU); ctx.fill(); }
      ctx.restore();
      if (bad.length) this._drawBeamItems(ctx, bad, {});
    }
    // hover / selection beams
    const erase = es.tool === 'erase';
    const hb = this._resolveBeam(es.hoverBeam, items);
    if (hb && hb.length) {
      ctx.globalAlpha = erase ? 0.8 : 0.45;
      this._halo(ctx, hb, erase ? '#ff5a4a' : '#ffffff', 5);
      ctx.globalAlpha = 1;
      this._drawBeamItems(ctx, hb, {});
    }
    const sel = es.selection;
    if (sel) {
      const beams = Array.isArray(sel.beams) ? sel.beams : [];
      const nodes = Array.isArray(sel.nodes) ? sel.nodes : Array.isArray(sel) ? sel : (sel.id || typeof sel === 'string' ? [sel] : []);
      ctx.globalAlpha = 0.85;
      for (const bi of beams) this._halo(ctx, this._resolveBeam(bi, items), '#5ad1ff', 5);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 2 * px;
      for (const nr of nodes) { const n = this._resolveNode(nr); if (n) { ctx.beginPath(); ctx.arc(n.x, n.y, 0.5, 0, TAU); ctx.stroke(); } }
    }
    // ghost beam
    const gh = es.ghost;
    let label = null;
    const extra = Array.isArray(es.ghosts) ? es.ghosts.filter(function (g) { return g && g !== gh && typeof g.x1 === 'number'; }) : [];
    for (const g2 of extra) {
      const m2 = g2.m || es.material || 'road';
      const it2 = { ax: g2.x1, ay: g2.y1, bx: g2.x2, by: g2.y2, m: m2, st: matStyle(m2), s: null, i: -1, broken: false, sag: 0 };
      upNormal(it2);
      ctx.globalAlpha = 0.45;
      this._halo(ctx, [it2], g2.valid === false ? '#ff3b30' : '#7fe0ff', 5);
      ctx.globalAlpha = 0.6;
      this._drawBeamItems(ctx, [it2], {});
      ctx.globalAlpha = 1;
    }
    if (gh && typeof gh.x1 === 'number' && !(gh.pier || gh.kind === 'pier')) {
      const m = gh.m || gh.material || es.material || state.material || 'road';
      const st = matStyle(m);
      const it = { ax: gh.x1, ay: gh.y1, bx: gh.x2, by: gh.y2, m, st, s: null, i: -1, broken: false, sag: 0 };
      // reach circle
      const def = BG.Materials && BG.Materials[m];
      if (def && def.maxLength) {
        ctx.save();
        ctx.setLineDash([5 * px, 7 * px]);
        ctx.strokeStyle = gh.valid === false ? 'rgba(255,90,70,0.45)' : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath(); ctx.arc(gh.x1, gh.y1, def.maxLength, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      if (gh.valid === false) {
        ctx.globalAlpha = 0.85;
        upNormal(it);
        this._halo(ctx, [it], '#ff3b30', 6);
        ctx.globalAlpha = 0.5;
        this._drawBeamItems(ctx, [it], {});
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 0.4 + 0.25 * pulse;
        upNormal(it);
        this._halo(ctx, [it], '#ffffff', 5);
        ctx.globalAlpha = 0.85;
        this._drawBeamItems(ctx, [it], {});
        ctx.globalAlpha = 1;
      }
      // end point marker
      ctx.fillStyle = gh.valid === false ? '#ff3b30' : '#ffffff';
      ctx.beginPath(); ctx.arc(gh.x2, gh.y2, Math.max(0.16, 4 * px), 0, TAU); ctx.fill();
      const len = typeof gh.len === 'number' ? gh.len : Math.hypot(gh.x2 - gh.x1, gh.y2 - gh.y1);
      let cost = gh.cost;
      if (typeof cost !== 'number' && def && def.costPerMeter) cost = Math.round(len * def.costPerMeter);
      label = { x: (gh.x1 + gh.x2) / 2, y: (gh.y1 + gh.y2) / 2, text: len.toFixed(1) + ' m' + (typeof cost === 'number' ? '  ·  $' + Math.round(cost).toLocaleString('en-US') : ''), bad: gh.valid === false, reason: humanize(gh.reason || gh.error) };
    }
    // ghost pier
    const gp = es.pierGhost || es.ghostPier || (gh && (gh.pier || gh.kind === 'pier') ? { x: gh.x2 !== undefined ? gh.x2 : gh.x, topY: gh.y2 !== undefined ? gh.y2 : gh.topY, valid: gh.valid } : null);
    if (gp && typeof gp.x === 'number') {
      this._drawPier(ctx, gp.x, L.terrain.floorY, gp.topY, true, gp.valid === false);
      let cost = gp.cost;
      if (typeof cost !== 'number' && BG.Costs) cost = Math.round((BG.Costs.pierBase || 0) + (BG.Costs.pierPerMeter || 0) * (gp.topY - L.terrain.floorY));
      label = { x: gp.x, y: gp.topY + 1.2, text: (gp.topY - L.terrain.floorY).toFixed(1) + ' m pier' + (typeof cost === 'number' ? '  ·  $' + cost.toLocaleString('en-US') : ''), bad: gp.valid === false };
    }
    // hovered pier
    if (typeof es.hoverPier === 'number' && state.design && state.design.piers && state.design.piers[es.hoverPier]) {
      const p = state.design.piers[es.hoverPier];
      const fy = L.terrain.floorY;
      ctx.strokeStyle = erase ? '#ff5a4a' : '#ffffff'; ctx.lineWidth = 2.5 * px;
      ctx.globalAlpha = 0.6 + 0.4 * pulse;
      ctx.strokeRect(p.x - 1.05, fy - 0.2, 2.1, p.topY - fy + 0.2);
      ctx.globalAlpha = 1;
    }
    // box selection
    const sb = es.selectBox;
    if (sb && typeof sb.x0 === 'number') {
      ctx.fillStyle = 'rgba(90,209,255,0.12)';
      ctx.fillRect(sb.x0, sb.y0, sb.x1 - sb.x0, sb.y1 - sb.y0);
      ctx.strokeStyle = 'rgba(90,209,255,0.9)'; ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeRect(sb.x0, sb.y0, sb.x1 - sb.x0, sb.y1 - sb.y0);
      ctx.setLineDash([]);
    }
    // node highlights
    const hn = this._resolveNode(es.hoverNode);
    const df = this._resolveNode(es.dragFrom);
    if (df) {
      ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 2.5 * px;
      ctx.beginPath(); ctx.arc(df.x, df.y, 0.42 + 0.06 * pulse, 0, TAU); ctx.stroke();
    }
    if (hn) {
      ctx.fillStyle = erase ? 'rgba(255,90,74,0.35)' : 'rgba(255,255,255,0.28)';
      ctx.beginPath(); ctx.arc(hn.x, hn.y, 0.55 + 0.08 * pulse, 0, TAU); ctx.fill();
      ctx.strokeStyle = erase ? '#ff5a4a' : '#ffffff'; ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(hn.x, hn.y, 0.55 + 0.08 * pulse, 0, TAU); ctx.stroke();
    }
    // screen-space label
    if (label) {
      this._screenXf(ctx, sh.x, sh.y);
      const p = this.worldToScreen(label.x, label.y);
      this._label(ctx, p.x, p.y - 26, label.text, label.bad ? 'rgba(200,40,30,0.92)' : 'rgba(18,24,36,0.85)', '#ffffff', 12);
      if (label.bad && label.reason) this._label(ctx, p.x, p.y - 50, String(label.reason), 'rgba(90,10,6,0.85)', '#ffd0c8', 10);
    }
  };

  R._drawPeakLabels = function (ctx, items, sh) {
    const rank = function (it) { return it.cracked || it.broken ? 2 + (it.s || 0) : it.s; };
    const hot = items.filter(function (it) { return it.cracked || (it.broken && it.s != null) || it.s >= 0.7; }).sort(function (a, b) { return rank(b) - rank(a); });
    const seen = {};
    const boxes = [];
    let n = 0;
    this._screenXf(ctx, sh.x, sh.y);
    for (const it of hot) {
      if (seen[it.i] || n >= 10) continue;
      seen[it.i] = 1;
      const p = this.worldToScreen((it.ax + it.bx) / 2, (it.ay + it.by) / 2);
      const broke = it.cracked || it.broken;
      const txt = broke ? 'BROKE' : Math.round(it.s * 100) + '%';
      const w = txt.length * 6.6 + 12, hgt = 18, x = p.x - w / 2, y = p.y - 14 - hgt / 2;
      // skip labels that would collide with one already drawn
      if (boxes.some(function (b) { return x < b[2] && x + w > b[0] && y < b[3] && y + hgt > b[1]; })) continue;
      boxes.push([x, y, x + w, y + hgt]);
      n++;
      this._label(ctx, p.x, p.y - 14, txt, broke || it.s >= 1 ? 'rgba(200,30,24,0.92)' : 'rgba(20,24,34,0.82)', broke ? '#ffd0c8' : stressColor(Math.min(it.s, 1)), 10);
    }
  };

  // =====================================================================================
  // main entry
  // =====================================================================================
  R.render = function (state) {
    state = state || {};
    const t0 = now();
    let dt = state.dt;
    if (typeof dt !== 'number' || !isFinite(dt)) dt = this._lastNow ? (t0 - this._lastNow) / 1000 : 1 / 60;
    this._lastNow = t0;
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    if (state.level && state.level !== this.level) this.setLevel(state.level);
    this.resize();
    const ctx = this.ctx;
    const L = this.level;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (!L) {
      const g = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
      g.addColorStop(0, '#4c9be0'); g.addColorStop(1, '#e4f4fa');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    const mode = state.mode || 'edit';
    const fx = this.effects;
    if (this._follow && mode !== 'edit' && !state.demo) this._updateFollow(state, dt);
    else this._followActive = false;
    // particles follow sim time: frozen while paused, slowed in slow-motion
    const fxDt = mode === 'sim' ? (state.paused ? 0 : dt * (state.timeScale > 0 ? state.timeScale : 1)) : dt;
    if (fx) fx.update(fxDt, { waterY: L.terrain.waterY === undefined ? null : L.terrain.waterY, realDt: dt });
    const sh = fx ? fx.getShake() : { x: 0, y: 0 };
    const d = this.dpr;

    // static layers
    this._ensureBack();
    ctx.drawImage(this._back, Math.round((sh.x * 0.3 - M) * d), Math.round((sh.y * 0.3 - M) * d));
    this._drawStars(ctx, sh);
    this._drawClouds(ctx, sh);
    this._ensureMid();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this._par, Math.round((sh.x - M) * d), Math.round((sh.y - M) * d));
    {
      const A = this._midAnchor || { x: this.camera.x, y: this.camera.y, z: this.camera.zoom }, P = this._midPad, cz = this.camera.zoom;
      const ox = (this.camera.x - A.x) * cz, oy = (this.camera.y - A.y) * cz;
      const sc = cz / (A.z || cz);
      if (sc === 1) ctx.drawImage(this._mid, Math.round((sh.x - M - P.X - ox) * d), Math.round((sh.y - M - P.Y + oy) * d));
      else { // scaled during a follow zoom transition (see _ensureMid)
        const W2 = this.W / 2, H2 = this.H / 2;
        ctx.drawImage(this._mid, (sh.x + W2 - (W2 + M + P.X) * sc - ox) * d, (sh.y + H2 - (H2 + M + P.Y) * sc + oy) * d, this._mid.width * sc, this._mid.height * sc);
      }
    }

    // node lookup (results + undeformed: the inspect view shows peaks on the design as built)
    const blueprint = mode === 'results' && !!state.undeformed && !!state.sim && !!state.design;
    this._blueprint = blueprint;
    let nodes;
    if (mode === 'edit' || !state.sim || blueprint) nodes = this._designNodes(L, state.design || { nodes: [], beams: [], piers: [] });
    else nodes = state.sim.nodes || [];
    this._nodeList = nodes;
    const map = {};
    for (const n of nodes) if (n && n.id !== undefined) map[n.id] = n;
    this._nodeMap = map;

    const editUI = mode === 'edit' && !state.demo;
    if (editUI) this._drawEditUnder(ctx, state);

    this._worldXf(ctx, sh.x, sh.y);
    this._drawShips(ctx);
    const piers = this._pierList(state);
    for (const p of piers) this._drawPier(ctx, p.x, p.baseY, p.topY);

    // beams
    const items = this._collectBeams(state);
    this._beamItems = items;
    this.stats.beams = items.length;
    this._drawBeamItems(ctx, items, {});
    if (mode !== 'edit') this._drawStressGlow(ctx, items);
    if (mode !== 'edit') {
      const es = state.editorState || {};
      const hb = this._resolveBeam(state.hoverBeam !== undefined ? state.hoverBeam : es.hoverBeam, items);
      if (hb && hb.length) { ctx.globalAlpha = 0.7; this._halo(ctx, hb, '#ffffff', 5); ctx.globalAlpha = 1; this._drawBeamItems(ctx, hb, {}); }
    }

    // joints & anchors
    const used = {};
    const jointPts = [];
    if (mode === 'edit' || !state.sim || blueprint) {
      for (const b of (state.design && state.design.beams) || []) { used[b.a] = 1; used[b.b] = 1; }
      for (const n of nodes) if (n && !String(n.id).startsWith('a') && (used[n.id] || !n.fixed)) jointPts.push(n);
    } else {
      for (const b of state.sim.beams || []) { if (!b.fragmented) { used[b.a] = 1; used[b.b] = 1; } }
      for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; if (n && used[i] && !n.debris && !(n.id && String(n.id)[0] === 'a')) jointPts.push(n); }
    }
    this._drawAnchors(ctx, L, editUI, editUI ? used : null);
    this._drawJoints(ctx, jointPts);
    // anchor bolts that carry beams get a joint cap too
    const anchorJ = [];
    (L.anchors || []).forEach(function (a, i) { if (mode === 'edit' ? used['a' + i] : true) anchorJ.push(a); });
    this._drawJoints(ctx, anchorJ);

    // vehicles
    if (!blueprint) this._drawVehicles(ctx, state, dt);
    if (blueprint) {
      // a cross on every member that snapped
      const z0 = this.camera.zoom, r = Math.max(0.35, 6 / z0);
      ctx.strokeStyle = '#ff3a2a'; ctx.lineWidth = Math.max(0.08, 2.2 / z0);
      ctx.beginPath();
      for (const it of items) if (it.cracked) {
        const mx = (it.ax + it.bx) / 2, my = (it.ay + it.by) / 2;
        ctx.moveTo(mx - r, my - r); ctx.lineTo(mx + r, my + r); ctx.moveTo(mx - r, my + r); ctx.lineTo(mx + r, my - r);
      }
      ctx.stroke();
    }

    // effects under water, water, effects above
    const z = this.camera.zoom;
    this._worldXf(ctx, sh.x, sh.y);
    if (fx) fx.draw(ctx, { pxPerM: z, layer: 'under' });
    this._drawWater(ctx, state, sh);
    this._worldXf(ctx, sh.x, sh.y);
    if (fx) { if (fx.drawSurface) fx.drawSurface(ctx, { pxPerM: z }); fx.draw(ctx, { pxPerM: z, layer: 'over' }); }

    // night grade + lights
    const night = this.theme.night;
    if (night) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(10,16,48,' + (0.2 * night) + ')';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this._worldXf(ctx, sh.x, sh.y);
    this._drawLights(ctx);
    if (this._signals && this._signals.length) this._drawSignals(ctx, mode, state);

    // overlays
    if (editUI) {
      this._drawNoBuild(ctx, state);
      this._drawEditOver(ctx, state, items, sh);
      if (this._pierLabels && this._pierLabels.length) {
        this._screenXf(ctx);
        for (const pl of this._pierLabels) this._label(ctx, pl[0], pl[1], pl[2] > 70 ? 'PIER ZONE' : 'PIER', 'rgba(40,32,10,0.8)', '#ffd860', 10);
      }
    } else {
      this._drawNoBuild(ctx, state);
      if (state.derail && !blueprint && !state.demo) { this._worldXf(ctx, sh.x, sh.y); this._drawDerailMarker(ctx, state, sh); }
      if (state.peakView || mode === 'results') this._drawPeakLabels(ctx, items, sh);
    }
    this._drawAmbient(ctx, dt);
    this._drawVignette(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    this.stats.frameMs = now() - t0;
  };

  R.shake = function (amount) { if (this.effects && this.effects.shake) this.effects.shake(amount); };
  R.onCameraChanged = function () { /* caches are keyed on the camera; nothing to do */ };
  R.invalidate = function () { this._backKey = this._midKey = ''; this._clouds = null; };
  R.setInsets = function (ins) { Object.assign(this.insets, ins || {}); };

  Renderer.THEMES = THEMES;
  Renderer.stressColor = stressColor;
  Renderer.materialStyle = matStyle;
  Renderer.Sprites = Sprites;
  BG.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
