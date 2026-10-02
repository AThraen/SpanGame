// BG.Hud — all DOM UI: title, level select, in-level HUD, results, settings, toasts, tooltips.
// Pure view layer: reads state from BG.Game and calls BG.Game methods on interaction.
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  // ------------------------------------------------------------------ helpers
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function money(n) {
    n = Math.round(+n || 0);
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sfx(name, o) { try { BG.Audio && BG.Audio.play(name, o); } catch (e) { /* */ } }
  function game() { return BG.Game || {}; }
  function call(name) {
    const g = game();
    const args = Array.prototype.slice.call(arguments, 1);
    if (g && typeof g[name] === 'function') { try { return g[name].apply(g, args); } catch (e) { console.error(e); } }
    return undefined;
  }

  // ------------------------------------------------------------------ icons
  const P = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    beam: '<circle cx="5" cy="17" r="2.2"/><circle cx="19" cy="7" r="2.2"/><path d="M6.8 15.8l10.4-7.6"/>',
    erase: '<path d="M20 20H9.5L4.3 14.8a2 2 0 010-2.8l8.4-8.4a2 2 0 012.8 0l4.2 4.2a2 2 0 010 2.8L12.4 17.9"/><path d="M8.5 10.5l6 6"/>',
    select: '<path d="M4 4h3M10 4h3M4 4v3M4 10v3" stroke-dasharray="0"/><path d="M16 4h1a3 3 0 013 3v1M4 16v1a3 3 0 003 3h1"/><path d="M11 11l9 3.5-4 1.5-1.5 4z" fill="currentColor"/>',
    pier: '<path d="M8 21V8h8v13"/><path d="M5 8h14"/><path d="M3 21h18"/><path d="M10 12h4M10 16h4"/>',
    mirror: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M8.5 7L3.5 12l5 5z"/><path d="M15.5 7l5 5-5 5z"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
    truss: '<path d="M2 18h20"/><path d="M4 18l4-8 4 8 4-8 4 8"/><path d="M8 10h8"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 10v6M14 10v6"/>',
    play: '<path d="M7 4.5l12.5 7.5L7 19.5z" fill="currentColor"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
    step: '<path d="M5 5l10 7-10 7z" fill="currentColor"/><path d="M18.5 5v14"/>',
    restart: '<path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    pencil: '<path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.2"/><path d="M8 11V7.5a4 4 0 018 0V11"/>',
    star: '<path d="M12 2.6l2.85 5.95 6.55.8-4.83 4.5 1.25 6.5L12 17.15 6.18 20.35l1.25-6.5L2.6 9.35l6.55-.8z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0012 3z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    stress: '<path d="M3 17l5-6 4 4 4-7 5 6"/>',
    grid: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
    volume: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    next: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    trophy: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 5h3a3 3 0 01-3 4M7 5H4a3 3 0 003 4"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.7.8-2.7 2s1.1 1.6 2.7 2 2.7.9 2.7 2.1-1.1 1.9-2.7 1.9c-1.1 0-2.1-.5-2.6-1.3M12 6.5V8M12 16v1.5"/>',
  };
  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
  }
  function starSvg(cls) {
    return '<svg class="star ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P.star.match(/d="([^"]+)"/)[1] + '"/></svg>';
  }

  // vehicle silhouettes (side view, facing right) — 48x20 viewBox
  const VEH = {
    car: '<path d="M4 14v-3.2c0-.8.5-1.4 1.3-1.6L11 8l5-4.2c.5-.4 1.1-.6 1.7-.6h9.8c.7 0 1.3.3 1.7.8L33 8l7.7 1.2c1 .2 1.8 1 1.8 2.1V14z"/><path d="M17.6 5l-3.6 3h8V5zM24 5v3h7.4l-2.8-3z" fill="rgba(255,255,255,.55)"/>',
    van: '<path d="M4 14V5.2C4 4.5 4.6 4 5.3 4h23.5c.6 0 1.2.3 1.5.8L34.5 9l6.6 1.4c.9.2 1.4.9 1.4 1.8V14z"/><path d="M27.5 5.5h2l3 4h-5z" fill="rgba(255,255,255,.55)"/>',
    bus: '<path d="M2.5 14V4.2c0-.9.7-1.6 1.6-1.6h37.8c.9 0 1.7.6 1.9 1.5L45.5 11v3z"/><path d="M5 4.6h5v4H5zM11.5 4.6h5v4h-5zM18 4.6h5v4h-5zM24.5 4.6h5v4h-5zM31 4.6h5v4h-5zM37.5 4.6h4l1.4 4h-5.4z" fill="rgba(255,255,255,.55)"/>',
    truck: '<path d="M2.5 14V3.5h28V14z"/><path d="M31.5 14V6.5h7.2c.6 0 1.2.3 1.5.8l3.6 4.4c.3.4.5.9.5 1.4V14z"/><path d="M34 8h4.4l2.6 3.4H34z" fill="rgba(255,255,255,.55)"/>',
    semi: '<path d="M1 13.5V3.2h31v10.3z"/><path d="M33 14V5.5h6.3c.6 0 1.1.3 1.4.7l3.8 5c.3.4.5.9.5 1.4V14z"/><path d="M35.3 7h3.6l2.8 3.6h-6.4z" fill="rgba(255,255,255,.55)"/>',
    tanker: '<rect x="1" y="3.5" width="31" height="9" rx="4.5"/><path d="M33 14V5.5h6.3c.6 0 1.1.3 1.4.7l3.8 5c.3.4.5.9.5 1.4V14z"/><path d="M35.3 7h3.6l2.8 3.6h-6.4z" fill="rgba(255,255,255,.55)"/>',
    heavy: '<path d="M2 14V9h34v5z"/><path d="M36 14V5h5.4c.6 0 1.1.3 1.4.8l2.2 3.6V14z"/><path d="M6 9l20-7 1.4 1.2L10 9z"/><rect x="6" y="5.5" width="6" height="3.5" rx=".6"/>',
  };
  const WHEELS = {
    car: [11, 35], van: [11, 35], bus: [9, 37], truck: [8, 15, 38], semi: [6, 12, 28, 39], tanker: [6, 12, 28, 39], heavy: [6, 13, 20, 27, 40],
  };
  function vehSvg(type) {
    const body = VEH[type] || VEH.car;
    const wheels = (WHEELS[type] || WHEELS.car).map(x => '<circle cx="' + x + '" cy="15" r="3.4" class="vw"/><circle cx="' + x + '" cy="15" r="1.2" class="vh"/>').join('');
    return '<svg class="veh" viewBox="0 0 48 19" aria-hidden="true"><g class="vb">' + body + '</g>' + wheels + '</svg>';
  }

  // ------------------------------------------------------------------ data helpers
  const FALLBACK_MATERIALS = {
    road: { id: 'road', name: 'Road', color: '#3b3f46', costPerMeter: 100, tensionLimit: 4.5e5, compressionLimit: 4.5e5, maxLength: 6, isRoad: true },
    reinforced_road: { id: 'reinforced_road', name: 'Reinforced Road', color: '#4a4f5a', costPerMeter: 180, tensionLimit: 9e5, compressionLimit: 9e5, maxLength: 6, isRoad: true },
    wood: { id: 'wood', name: 'Wood', color: '#b07a44', costPerMeter: 50, tensionLimit: 2.4e5, compressionLimit: 2e5, maxLength: 6 },
    steel: { id: 'steel', name: 'Steel', color: '#8c97a8', costPerMeter: 120, tensionLimit: 9e5, compressionLimit: 8e5, maxLength: 10 },
    rope: { id: 'rope', name: 'Rope', color: '#c8a46a', costPerMeter: 20, tensionLimit: 1.2e5, compressionLimit: 0, maxLength: 20, tensionOnly: true },
    cable: { id: 'cable', name: 'Steel Cable', color: '#5f6873', costPerMeter: 60, tensionLimit: 1.6e6, compressionLimit: 0, maxLength: 40, tensionOnly: true },
  };
  const MAT_ORDER = ['road', 'reinforced_road', 'wood', 'steel', 'rope', 'cable'];
  function materials() {
    const M = BG.Materials;
    if (M && typeof M === 'object' && Object.keys(M).length) return M;
    return FALLBACK_MATERIALS;
  }
  function material(id) { return materials()[id] || FALLBACK_MATERIALS[id] || { id, name: id, costPerMeter: 0, maxLength: 0 }; }
  function levelMaterials(level) {
    const M = materials();
    let ids = (level && Array.isArray(level.materials) && level.materials.length) ? level.materials.slice() : MAT_ORDER.filter(id => M[id]);
    return ids;
  }
  function strengthOf(m) { return Math.max(+m.tensionLimit || 0, +m.compressionLimit || 0); }
  function strengthRange() {
    const M = materials();
    let lo = Infinity, hi = 0;
    for (const k in M) { const s = strengthOf(M[k]); if (s > 0) { lo = Math.min(lo, s); hi = Math.max(hi, s); } }
    if (!isFinite(lo)) lo = 1;
    return [lo, Math.max(hi, lo * 1.0001)];
  }
  function vehicleName(type) {
    const V = BG.Vehicles && BG.Vehicles[type];
    if (V && V.name) return V.name;
    return { car: 'Car', van: 'Van', bus: 'Bus', truck: 'Truck', semi: 'Semi-trailer', tanker: 'Tanker', heavy: 'Heavy hauler' }[type] || type;
  }
  function vehicleMass(type) {
    const V = BG.Vehicles && BG.Vehicles[type];
    if (V && V.mass) return V.mass;
    return { car: 1200, van: 2500, bus: 12000, truck: 20000, semi: 38000, tanker: 45000, heavy: 60000 }[type] || 1500;
  }

  const THEMES = {
    meadow: { sky: ['#8fd3f4', '#d8f3ff'], ground: '#5aa35a', deep: '#3d7a44', accent: '#7bd389', water: '#3d9bd6' },
    autumn: { sky: ['#f7b267', '#fde4c3'], ground: '#b5652d', deep: '#7a3e1d', accent: '#ffb347', water: '#4b86b4' },
    desert: { sky: ['#f9d29d', '#fff1d6'], ground: '#d8a25e', deep: '#a8693a', accent: '#f4d06f', water: '#3aa6b9' },
    canyon: { sky: ['#f29e6d', '#ffd9b8'], ground: '#b4532a', deep: '#6e2b19', accent: '#ff8a5b', water: '#2d8bb0' },
    snow: { sky: ['#bcd7f2', '#eef6ff'], ground: '#e8f0f8', deep: '#9fb4c9', accent: '#9ad0ff', water: '#4c7fa8' },
    night: { sky: ['#141a3d', '#36407a'], ground: '#2a3550', deep: '#161d30', accent: '#8f9bff', water: '#22406a' },
    city: { sky: ['#9fb3d8', '#e2e9f5'], ground: '#5c6577', deep: '#363c49', accent: '#7aa2ff', water: '#3c6e9e' },
    tropical: { sky: ['#5ed6e0', '#d4fbff'], ground: '#4fb06a', deep: '#2b7a4b', accent: '#4fd1c5', water: '#1fb5c9' },
    volcanic: { sky: ['#5a1d24', '#d1553a'], ground: '#3a2a2a', deep: '#1c1414', accent: '#ff5d73', water: '#c4442a' },
  };
  function theme(name) { return THEMES[name] || THEMES.meadow; }

  const SHORT_MAT = { reinforced_road: 'Reinf. Road', cable: 'Cable' };
  const CHAPTERS = [
    { n: 1, name: 'First Crossings', from: 1, to: 5, desc: '10–20 m gaps · cars & vans · road, wood and triangles', theme: 'meadow' },
    { n: 2, name: 'Timber & Steel', from: 6, to: 10, desc: '20–28 m · cars, vans & buses · trusses, then steel', theme: 'autumn' },
    { n: 3, name: 'Piers & Cables', from: 11, to: 20, desc: '28–45 m · vans & buses · piers, rope & cable, arches, ship channels', theme: 'desert' },
    { n: 4, name: 'Shipping Lanes', from: 21, to: 30, desc: '46–70 m · buses & trucks · reinforced road, towers, clearances', theme: 'tropical' },
    { n: 5, name: 'Heavy Haul', from: 31, to: 40, desc: '70–100 m · trucks & semis · convoys, deep canyons, few piers', theme: 'canyon' },
    { n: 6, name: 'Grand Spans', from: 41, to: 50, desc: '100–150 m · semis, tankers & heavies · the finale', theme: 'volcanic' },
  ];

  function levelsList() { return Array.isArray(BG.Levels) ? BG.Levels : []; }
  function levelForSlot(n) {
    const L = levelsList();
    return L.find(l => l && l.id === n) || (L[n - 1] && L[n - 1].id == null ? L[n - 1] : null);
  }
  function levelId(level) {
    if (!level) return null;
    if (level.id != null) return level.id;
    const i = levelsList().indexOf(level);
    return i >= 0 ? i + 1 : null;
  }
  function stor() { return BG.Storage || null; }
  function starsFor(id) { const S = stor(); try { return S ? S.getStars(id) : 0; } catch (e) { return 0; } }
  function unlocked(id) {
    const S = stor();
    try { return S ? S.isUnlocked(id, levelsList()) : id === 1; } catch (e) { return id === 1; }
  }

  // mini terrain thumbnail for level tiles
  function thumbSvg(level) {
    const th = theme(level && level.theme);
    const t = (level && level.terrain) || { leftEdge: 0, leftY: 0, rightEdge: 20, rightY: 0, floorY: -10, waterY: -7 };
    const gap = Math.max(4, (t.rightEdge - t.leftEdge) || 20);
    const pad = gap * 0.35;
    const x0 = t.leftEdge - pad, x1 = t.rightEdge + pad;
    const top = Math.max(t.leftY || 0, t.rightY || 0) + gap * 0.25;
    const bot = Math.min(t.floorY != null ? t.floorY : -10, t.waterY != null ? t.waterY : 0) - gap * 0.06;
    const W = 100, H = 56;
    const sx = x => ((x - x0) / (x1 - x0)) * W;
    const sy = y => ((top - y) / (top - bot)) * H;
    const fy = sy(t.floorY != null ? t.floorY : bot);
    let s = '<svg class="thumb" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">';
    s += '<defs><linearGradient id="tg' + levelId(level) + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + th.sky[0] + '"/><stop offset="1" stop-color="' + th.sky[1] + '"/></linearGradient></defs>';
    s += '<rect width="100" height="56" fill="url(#tg' + levelId(level) + ')"/>';
    s += '<path d="M0 ' + (H * 0.62) + ' Q25 ' + (H * 0.42) + ' 50 ' + (H * 0.58) + ' T100 ' + (H * 0.5) + ' V56 H0Z" fill="' + th.deep + '" opacity=".25"/>';
    if (t.waterY != null) s += '<rect x="0" y="' + sy(t.waterY) + '" width="100" height="' + (H - sy(t.waterY)) + '" fill="' + th.water + '" opacity=".9"/>';
    // valley floor + banks
    s += '<path d="M0 ' + sy(t.leftY || 0) + ' H' + sx(t.leftEdge) + ' L' + (sx(t.leftEdge) + 3) + ' ' + fy + ' H' + (sx(t.rightEdge) - 3) + ' L' + sx(t.rightEdge) + ' ' + sy(t.rightY || 0) + ' H100 V56 H0Z" fill="' + th.ground + '"/>';
    if (t.waterY != null) s += '<rect x="' + (sx(t.leftEdge) + 1) + '" y="' + sy(t.waterY) + '" width="' + (sx(t.rightEdge) - sx(t.leftEdge) - 2) + '" height="' + Math.max(0, fy - sy(t.waterY)) + '" fill="' + th.water + '" opacity=".85"/>';
    (level && level.pierZones || []).forEach(z => {
      s += '<rect x="' + sx(z.x0) + '" y="' + (fy - 1.2) + '" width="' + Math.max(1, sx(z.x1) - sx(z.x0)) + '" height="1.2" fill="#fff" opacity=".6"/>';
    });
    s += '<path d="M' + sx(t.leftEdge) + ' ' + sy(t.leftY || 0) + ' L' + sx(t.rightEdge) + ' ' + sy(t.rightY || 0) + '" stroke="#fff" stroke-width="1.2" stroke-dasharray="2 2" opacity=".75"/>';
    s += '</svg>';
    return s;
  }

  // ------------------------------------------------------------------ HUD object
  const Hud = {
    el: {},
    screen: null,
    mode: null,
    level: null,
    _shownCost: 0,
    _sig: {},
    _hintTimer: 0,
    _resultTimers: [],

    init(g) {
      const ui = document.getElementById('ui') || document.body.appendChild(h('<div id="ui"></div>'));
      this.root = ui;
      ui.innerHTML = '';
      ui.appendChild(this._buildTitle());
      ui.appendChild(this._buildLevelSelect());
      ui.appendChild(this._buildLevelHud());
      ui.appendChild(this._buildSettings());
      ui.appendChild(h('<div id="toasts" class="toasts" aria-live="polite"></div>'));
      ui.appendChild(h('<div id="tooltip" class="tooltip" role="tooltip"></div>'));
      ui.appendChild(h('<div id="fader" class="fader"></div>'));
      this.el.toasts = $('#toasts'); this.el.tooltip = $('#tooltip'); this.el.fader = $('#fader');

      // never let buttons keep focus (Space must go to the game, not "click" the button)
      ui.addEventListener('click', e => {
        const b = e.target.closest('button, .tile, input[type=checkbox]');
        if (b && b.blur) setTimeout(() => b.blur(), 0);
      });
      ui.addEventListener('pointerenter', e => {
        if (e.target && e.target.matches && e.target.matches('button:not(:disabled), .tile.open')) sfx('hover');
      }, true);
      const loader = document.getElementById('boot');
      if (loader) { loader.classList.add('gone'); setTimeout(() => loader.remove(), 700); }
      this.applySettings();
    },

    // ---------------------------------------------------------------- title
    _buildTitle() {
      const el = h(`
        <section id="screen-title" class="screen">
          <div class="title-vignette"></div>
          <div class="title-wrap">
            <svg class="logo-art" viewBox="0 0 600 140" aria-hidden="true">
              <defs>
                <linearGradient id="cableG" x1="0" x2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#7fe0ff"/></linearGradient>
              </defs>
              <path class="la tower" d="M150 128V18M450 128V18"/>
              <path class="la cable" d="M10 104 Q80 100 150 18 Q300 132 450 18 Q520 100 590 104"/>
              <path class="la hangers" d="M190 50V128M225 74V128M260 92V128M300 99V128M340 92V128M375 74V128M410 50V128M60 101V128M100 82V128M500 82V128M540 101V128"/>
              <path class="la deck" d="M0 128H600"/>
            </svg>
            <h1 class="logo" aria-label="SPAN"><span>S</span><span>P</span><span>A</span><span>N</span></h1>
            <p class="tagline">Bridge the gap. Mind the budget. <em>Don't drop the bus.</em></p>
            <div class="title-buttons">
              <button class="btn btn-primary btn-xl" data-act="play">${icon('play')}<span>Play</span></button>
              <button class="btn btn-glass btn-xl" data-act="continue" hidden>${icon('next')}<span class="lbl">Continue</span></button>
            </div>
            <div class="title-meta">
              <span class="chip" data-ref="titleStars">${starSvg('on')}<b>0</b> / 150</span>
              <button class="btn btn-icon btn-glass" data-act="settings" title="Settings">${icon('gear')}</button>
            </div>
          </div>
          <div class="title-foot">Drag to build · Space to test · Enter to play</div>
        </section>`);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        sfx('click');
        const act = b.dataset.act;
        if (act === 'play') call('goLevelSelect');
        else if (act === 'continue') call('continueGame');
        else if (act === 'settings') this.openSettings();
      });
      this.el.title = el;
      return el;
    },
    refreshTitle() {
      const el = this.el.title;
      if (!el) return;
      const S = stor();
      let total = 0;
      try { total = S ? S.totalStars() : 0; } catch (e) { /* */ }
      $('[data-ref=titleStars] b', el).textContent = total;
      const cont = $('[data-act=continue]', el);
      const target = call('continueTarget');
      const prog = S ? S.getProgress() : null;
      const has = prog && (prog.lastLevel != null || Object.keys(prog.levels || {}).length);
      if (has && target) {
        cont.hidden = false;
        $('.lbl', cont).textContent = 'Continue · Level ' + levelId(target);
      } else cont.hidden = true;
    },

    // ---------------------------------------------------------------- level select
    _buildLevelSelect() {
      const el = h(`
        <section id="screen-levels" class="screen">
          <header class="ls-head glass">
            <button class="btn btn-icon btn-ghost" data-act="back" title="Back (Esc)">${icon('back')}</button>
            <div class="ls-title"><h2>Select a crossing</h2><p>Six regions · fifty bridges</p></div>
            <div class="ls-right">
              <span class="chip chip-lg" data-ref="lsStars">${starSvg('on')}<b>0</b> / 150</span>
              <button class="btn btn-icon btn-ghost" data-act="settings" title="Settings">${icon('gear')}</button>
            </div>
          </header>
          <div class="ls-scroll"><div class="chapters"></div></div>
        </section>`);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (b) {
          sfx('click');
          if (b.dataset.act === 'back') call('goTitle');
          else if (b.dataset.act === 'settings') this.openSettings();
          return;
        }
        const t = e.target.closest('.tile');
        if (!t) return;
        if (t.classList.contains('open')) { sfx('click'); call('openLevel', +t.dataset.id); }
        else {
          sfx('error');
          t.classList.remove('nope'); void t.offsetWidth; t.classList.add('nope');
          this.toast(t.classList.contains('soon') ? 'This crossing is still being surveyed — coming soon.' : 'Complete one of the two levels before this one to unlock it.', 'info');
        }
      });
      this.el.levels = el;
      return el;
    },
    buildLevelSelect() {
      const el = this.el.levels;
      const wrap = $('.chapters', el);
      wrap.innerHTML = '';
      let total = 0;
      const S = stor();
      try { total = S ? S.totalStars() : 0; } catch (e) { /* */ }
      $('[data-ref=lsStars] b', el).textContent = total;
      CHAPTERS.forEach(ch => {
        const th = theme(ch.theme);
        let chStars = 0, chMax = 0, anyOpen = false;
        const tiles = [];
        for (let n = ch.from; n <= ch.to; n++) {
          const lv = levelForSlot(n);
          if (!lv) {
            tiles.push(`<div class="tile soon" data-id="${n}" style="--acc:${th.accent}"><div class="tile-art soon-art"><span>${n}</span></div><div class="tile-body"><div class="tile-name">Coming soon</div><div class="tile-stars dim">${starSvg()}${starSvg()}${starSvg()}</div></div></div>`);
            continue;
          }
          const id = levelId(lv);
          const open = unlocked(id);
          const st = starsFor(id);
          chStars += st; chMax += 3;
          if (open) anyOpen = true;
          const lth = theme(lv.theme || ch.theme);
          const done = S && S.isCompleted && S.isCompleted(id);
          tiles.push(`<button class="tile ${open ? 'open' : 'locked'} ${done ? 'done' : ''}" data-id="${id}" style="--acc:${lth.accent}" ${open ? '' : 'aria-disabled="true"'}>
              <div class="tile-art">${thumbSvg(lv)}<span class="tile-num">${n}</span>${open ? '' : '<span class="tile-lock">' + icon('lock') + '</span>'}</div>
              <div class="tile-body"><div class="tile-name">${esc(lv.name || 'Level ' + n)}</div>
              <div class="tile-stars">${[0, 1, 2].map(i => starSvg(i < st ? 'on' : '')).join('')}</div></div>
            </button>`);
        }
        const sec = h(`<section class="chapter ${anyOpen ? '' : 'ch-locked'}" style="--acc:${th.accent};--sky0:${th.sky[0]};--sky1:${th.sky[1]}">
            <div class="ch-head">
              <div class="ch-num">${ch.n}</div>
              <div class="ch-text"><h3>${esc(ch.name)}</h3><p>Levels ${ch.from}–${ch.to} · ${esc(ch.desc)}</p></div>
              <div class="ch-stars">${chMax ? starSvg('on') + '<b>' + chStars + '</b>/' + chMax : '<span class="soon-tag">Coming soon</span>'}</div>
            </div>
            <div class="tiles">${tiles.join('')}</div>
          </section>`);
        wrap.appendChild(sec);
      });
      // stagger-in animation
      $$('.tile', wrap).forEach((t, i) => { t.style.animationDelay = (Math.min(i, 40) * 14) + 'ms'; });
    },
    scrollToLevel(id) {
      const t = $('.tile[data-id="' + id + '"]', this.el.levels);
      if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: 'center' }); } catch (e) { /* */ } }
    },

    // ---------------------------------------------------------------- in-level HUD
    _buildLevelHud() {
      const el = h(`
        <section id="screen-level" class="screen">
          <header class="topbar glass">
            <button class="btn btn-icon btn-ghost" data-act="back" title="Levels (Esc)">${icon('back')}</button>
            <div class="lvl-badge"><span class="lvl-k">LEVEL</span><span class="lvl-n" data-ref="lvlNum">1</span></div>
            <div class="lvl-title"><div class="lvl-name" data-ref="lvlName">—</div><div class="lvl-sub" data-ref="lvlSub"></div></div>
            <div class="budget" data-ref="budget">
              <div class="budget-row"><span class="budget-k">${icon('coin')}Cost</span><span class="budget-v"><b data-ref="cost">$0</b> <i>/</i> <span data-ref="budgetV">$0</span></span></div>
              <div class="budget-bar"><div class="budget-fill" data-ref="fill"></div>
                <span class="tick t70" title="★★★ at 70% of budget"></span><span class="tick t85" title="★★ at 85% of budget"></span>
                <span class="tick-lbl l70">★★★</span><span class="tick-lbl l85">★★</span>
              </div>
            </div>
            <div class="traffic" data-ref="traffic" title="Traffic"></div>
            <button class="btn btn-icon btn-ghost" data-act="hint" title="Show hint" hidden>${icon('bulb')}</button>
            <button class="btn btn-icon btn-ghost" data-act="settings" title="Settings">${icon('gear')}</button>
          </header>

          <nav class="rail glass" data-ref="rail">
            <button class="tool" data-tool="build" title="Build (B)">${icon('beam')}<span>Build</span></button>
            <button class="tool" data-tool="erase" title="Erase (E) — or right-click">${icon('erase')}<span>Erase</span></button>
            <button class="tool" data-tool="pier" title="Pier (P)">${icon('pier')}<span>Pier</span></button>
            <button class="tool" data-tool="select" title="Select (S) — box-select, then Delete; drag joints to move">${icon('select')}<span>Select</span></button>
            <div class="rail-sep"></div>
            <button class="tool toggle" data-act="mirror" title="Mirror symmetry (M)">${icon('mirror')}<span>Mirror</span></button>
            <div class="tool-wrap" data-ref="tplWrap">
              <button class="tool" data-act="templates" title="Bridge templates">${icon('truss')}<span>Templates</span></button>
            </div>
            <div class="rail-sep"></div>
            <button class="tool" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo')}<span>Undo</span></button>
            <button class="tool" data-act="redo" title="Redo (Ctrl+Y)">${icon('redo')}<span>Redo</span></button>
            <button class="tool danger" data-act="clear" title="Clear all">${icon('trash')}<span>Clear</span></button>
          </nav>

          <div class="tpl-menu glass" data-ref="tplMenu"></div>

          <div class="dock">
            <div class="palette glass" data-ref="palette"></div>
            <div class="simbar glass" data-ref="simbar">
              <button class="btn btn-ghost sb-btn" data-act="edit" title="Back to editing (Space)">${icon('pencil')}<span>Edit</span></button>
              <button class="btn btn-ghost sb-btn" data-act="restart" title="Restart test (R)">${icon('restart')}<span>Restart</span></button>
              <div class="sb-sep"></div>
              <button class="btn btn-icon btn-ghost" data-act="pause" title="Pause / resume (P)">${icon('pause')}</button>
              <button class="btn btn-icon btn-ghost" data-act="step" title="Single step (.)">${icon('step')}</button>
              <div class="seg" data-ref="speed">
                <button data-speed="0.25" title="Slow motion (-)">¼×</button><button data-speed="1">1×</button><button data-speed="2" title="Fast (=)">2×</button><button data-speed="4" title="Faster">4×</button><button data-speed="8" title="Fastest">8×</button>
              </div>
              <div class="sb-sep"></div>
              <div class="sb-stat">${icon('clock')}<b data-ref="simTime">0.0</b><span data-ref="simLimit">/ 40 s</span></div>
              <div class="sb-stat">${icon('flag')}<b data-ref="simVeh">0/0</b><span>across</span></div>
              <div class="sb-sep"></div>
              <button class="btn btn-ghost sb-btn toggle" data-act="stress" title="Stress overlay">${icon('stress')}<span>Stress</span></button>
            </div>
          </div>

          <button class="test-btn" data-act="test" title="Test bridge (Space)">
            <span class="tb-ico tb-play">${icon('play')}</span><span class="tb-ico tb-edit">${icon('pencil')}</span>
            <span class="tb-lbl"><b class="tb-play">Test</b><b class="tb-edit">Build</b><small>Space</small></span>
          </button>

          <div class="hint glass" data-ref="hint">
            <span class="hint-ico">${icon('bulb')}</span><p data-ref="hintText"></p>
            <button class="btn btn-icon btn-ghost sm" data-act="hideHint" title="Dismiss">${icon('close')}</button>
          </div>

          <div class="results" data-ref="results">
            <div class="results-card glass">
              <div class="res-banner" data-ref="resBanner"></div>
              <div class="res-stars" data-ref="resStars">${starSvg()}${starSvg('mid')}${starSvg()}</div>
              <h2 data-ref="resTitle">Bridge passed!</h2>
              <p class="res-reason" data-ref="resReason"></p>
              <div class="res-stats" data-ref="resStats"></div>
              <div class="res-budget" data-ref="resBudget"><div class="rb-bar"><div class="rb-fill"></div><span class="tick t70"></span><span class="tick t85"></span><span class="rb-cap"></span></div></div>
              <div class="res-actions">
                <button class="btn btn-glass" data-act="inspect" title="Inspect peak stress map">${icon('eye')}<span>Inspect</span></button>
                <button class="btn btn-glass" data-act="resEdit">${icon('pencil')}<span>Edit</span></button>
                <button class="btn btn-glass" data-act="retry">${icon('restart')}<span>Retry</span></button>
                <button class="btn btn-primary" data-act="next">${icon('next')}<span>Next level</span></button>
              </div>
            </div>
            <button class="res-pill glass" data-act="uninspect">${icon('eye')}<span>Peak stress map</span><b data-ref="pillText"></b><em>Show results</em></button>
          </div>
        </section>`);

      el.addEventListener('click', e => this._onLevelClick(e));
      el.addEventListener('pointerdown', e => {
        // close templates menu when clicking elsewhere
        if (!e.target.closest('[data-ref=tplWrap], [data-ref=tplMenu]')) this.closeTemplates();
      });
      document.addEventListener('pointerdown', e => {
        if (!e.target.closest || !e.target.closest('[data-ref=tplWrap], [data-ref=tplMenu]')) this.closeTemplates();
      });
      this.el.level = el;
      const r = s => $('[data-ref=' + s + ']', el);
      ['lvlNum', 'lvlName', 'lvlSub', 'budget', 'cost', 'budgetV', 'fill', 'traffic', 'rail', 'tplWrap', 'tplMenu', 'palette', 'simbar', 'speed',
        'simTime', 'simLimit', 'simVeh', 'hint', 'hintText', 'results', 'resBanner', 'resStars', 'resTitle', 'resReason', 'resStats', 'resBudget', 'pillText']
        .forEach(k => { this.el[k] = r(k); });
      this.el.test = $('.test-btn', el);
      return el;
    },

    _onLevelClick(e) {
      const tool = e.target.closest('[data-tool]');
      if (tool) { if (!tool.disabled) { sfx('click'); call('setTool', tool.dataset.tool); } return; }
      const mat = e.target.closest('[data-mat]');
      if (mat) {
        if (mat.classList.contains('disabled')) { sfx('error'); this.toast(material(mat.dataset.mat).name + ' is not available on this level.', 'info'); return; }
        sfx('click'); call('setMaterial', mat.dataset.mat); return;
      }
      const sp = e.target.closest('[data-speed]');
      if (sp) { sfx('click'); call('setSpeed', +sp.dataset.speed); return; }
      const tpl = e.target.closest('[data-tpl]');
      if (tpl && tpl.disabled) return;
      if (tpl) {
        sfx('click');
        this.closeTemplates();
        call('applyTemplate', tpl.dataset.tpl);
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      switch (act) {
        case 'back': sfx('click'); call('goBack'); break;
        case 'settings': sfx('click'); this.openSettings(); break;
        case 'hint': sfx('click'); this.showHint(); break;
        case 'hideHint': sfx('click'); this.hideHint(true); break;
        case 'mirror': call('toggleMirror'); break;
        case 'templates': sfx('click'); if (this.templatesOpen()) this.closeTemplates(); else { this._positionTpl(b); this.el.tplMenu.classList.add('open'); this.el.tplWrap.classList.add('open'); } break;
        case 'undo': call('undo'); break;
        case 'redo': call('redo'); break;
        case 'clear': call('clearDesign'); break;
        case 'test': call('toggleTest'); break;
        case 'edit': call('stopSim'); break;
        case 'restart': sfx('click'); call('restartSim'); break;
        case 'pause': sfx('click'); call('togglePause'); break;
        case 'step': sfx('click'); call('stepOnce'); break;
        case 'stress': { const g = game(); call('setSetting', 'showStress', !(g.settings && g.settings.showStress)); sfx('toggle', { on: game().settings && game().settings.showStress }); break; }
        case 'inspect': sfx('whoosh'); this.el.results.classList.add('inspecting'); break;
        case 'uninspect': sfx('whoosh'); this.el.results.classList.remove('inspecting'); break;
        case 'resEdit': sfx('click'); call('backToEdit'); break;
        case 'retry': sfx('click'); call('retry'); break;
        case 'next': sfx('click'); call('nextLevel'); break;
        default: break;
      }
    },

    _positionTpl(btn) {
      const r = btn.getBoundingClientRect();
      const rail = this.el.rail.getBoundingClientRect();
      const m = this.el.tplMenu;
      m.style.left = Math.round(rail.right + 10) + 'px';
      const maxTop = root.innerHeight - Math.min(m.scrollHeight || 300, root.innerHeight * 0.6) - 12;
      m.style.top = Math.round(Math.max(12, Math.min(r.top - 8, maxTop))) + 'px';
    },

    enterLevel(level) {
      this.level = level;
      if (this.el.toasts) this.el.toasts.innerHTML = '';
      this._sig = {};
      const id = levelId(level);
      this.el.lvlNum.textContent = id != null ? id : '?';
      this.el.lvlName.textContent = level.name || ('Level ' + id);
      const t = level.terrain || {};
      const gap = (t.rightEdge != null && t.leftEdge != null) ? Math.round(t.rightEdge - t.leftEdge) : null;
      const ch = CHAPTERS.find(c => id >= c.from && id <= c.to);
      this.el.lvlSub.textContent = [ch ? ch.name : null, gap ? gap + ' m gap' : null, level.timeLimit ? level.timeLimit + ' s limit' : null].filter(Boolean).join(' · ');
      this.el.level.style.setProperty('--acc', theme(level.theme).accent);
      this.el.budgetV.textContent = money(level.budget);
      this._shownCost = 0;

      // traffic
      const groups = Array.isArray(level.traffic) ? level.traffic : [];
      const total = groups.reduce((a, g) => a + (g.count || 1), 0);
      this.el.traffic.innerHTML = groups.map(g => `<span class="tr-item" title="${(g.count || 1)} × ${esc(vehicleName(g.type))} (${Math.round(vehicleMass(g.type) / 100) / 10} t)">${vehSvg(g.type)}<b>×${g.count || 1}</b></span>`).join('') || '<span class="tr-none">No traffic</span>';
      this.el.traffic.title = total + ' vehicle' + (total === 1 ? '' : 's') + ': ' + groups.map(g => (g.count || 1) + ' ' + vehicleName(g.type)).join(', ');

      // palette
      this._buildPalette(level);

      // tools
      const hasPiers = Array.isArray(level.pierZones) && level.pierZones.length > 0 && (level.maxPiers == null || level.maxPiers > 0);
      $('[data-tool=pier]', this.el.rail).hidden = !hasPiers;
      let list = (BG.Templates && Array.isArray(BG.Templates.list)) ? BG.Templates.list : [];
      if (level.templates && BG.Templates && typeof BG.Templates.available === 'function') {
        try { list = BG.Templates.available(level).filter(t => t.ok !== false); } catch (e) { /* keep the plain list */ }
      }
      const hasTpl = !!level.templates && list.length > 0;
      this.el.tplWrap.hidden = !hasTpl;
      // pier tool shows how many piers this crossing allows
      const pierLbl = $('[data-tool=pier] span', this.el.rail);
      if (pierLbl) pierLbl.textContent = hasPiers && level.maxPiers != null ? 'Pier 0/' + level.maxPiers : 'Pier';
      this._pierSig = null;
      this.el.tplMenu.innerHTML = '<div class="tpl-head">Start from a template</div>' + list.map(t =>
        `<button class="tpl-item" data-tpl="${esc(t.id)}"><span class="tpl-pic">${tplPic(t.id)}</span><span class="tpl-txt"><b>${esc(t.name || t.id)}</b><small>${esc(t.desc || '')}</small></span></button>`).join('');

      // hint
      const hasHint = !!level.hint;
      $('[data-act=hint]', this.el.level).hidden = !hasHint;
      this.hideHint();
      if (hasHint) setTimeout(() => { if (this.level === level && this.mode === 'edit') this.showHint(null, id != null && id <= 3 ? 0 : 24000); }, 650);

      this.hideResults(true);
      this.setMode('edit');
    },

    _buildPalette(level) {
      const M = materials();
      const allowed = levelMaterials(level);
      const [lo, hi] = strengthRange();
      const ids = allowed.filter(id => M[id] || FALLBACK_MATERIALS[id]);
      const html = ids.map((id, i) => {
        const m = material(id);
        const s = strengthOf(m);
        const pct = s > 0 ? clamp(0.12 + 0.88 * (Math.log(s) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1), 0.08, 1) : 0.05;
        const tags = [];
        if (m.isRoad) tags.push('Road');
        if (m.tensionOnly) tags.push('Tension only');
        return `<button class="mat" data-mat="${esc(id)}" title="${esc(m.name)} — ${money(m.costPerMeter)}/m, max ${m.maxLength} m${m.tensionOnly ? ', tension only' : ''}">
            <span class="kbd">${i + 1}</span>
            <span class="mat-ico">${matSwatch(id, m)}</span>
            <span class="mat-info"><b>${esc(SHORT_MAT[id] || m.name || id)}</b>
              <span class="mat-meta"><em>${money(m.costPerMeter)}/m</em><i>≤ ${m.maxLength} m</i></span>
              <span class="mat-str" title="Strength"><span style="width:${Math.round(pct * 100)}%"></span></span>
            </span>
          </button>`;
      }).join('');
      this.el.palette.innerHTML = html;
    },

    setMode(mode) {
      this.mode = mode;
      const el = this.el.level;
      if (!el) return;
      el.classList.toggle('mode-edit', mode === 'edit');
      el.classList.toggle('mode-sim', mode === 'sim');
      el.classList.toggle('mode-results', mode === 'results');
      if (mode !== 'edit') this.closeTemplates();
      if (mode === 'sim') this.hideHint();
      this.hideTooltip();
    },

    // ---------------------------------------------------------------- hint & toasts
    // ms: auto-hide delay (0 = stay until dismissed; the first tutorial levels keep their hint up)
    showHint(text, ms) {
      const lv = this.level;
      const msg = text || (lv && lv.hint);
      if (!msg) return;
      this.el.hintText.textContent = msg;
      this.el.hint.classList.add('show');
      clearTimeout(this._hintTimer);
      if (ms == null) ms = 24000;
      if (ms > 0) this._hintTimer = setTimeout(() => this.hideHint(), ms);
    },
    hideHint() {
      clearTimeout(this._hintTimer);
      if (this.el.hint) this.el.hint.classList.remove('show');
    },
    toast(msg, kind, ms) {
      if (!this.el.toasts) return;
      // de-dupe identical consecutive toasts
      const last = this.el.toasts.lastElementChild;
      if (last && last.dataset.msg === msg && !last.classList.contains('out')) {
        clearTimeout(last._t); last._t = setTimeout(() => this._dropToast(last), ms || 2600);
        last.classList.remove('bump'); void last.offsetWidth; last.classList.add('bump');
        return;
      }
      const t = h(`<div class="toast glass ${kind || ''}"><span class="dot"></span><span></span></div>`);
      t.dataset.msg = msg;
      t.lastElementChild.textContent = msg;
      this.el.toasts.appendChild(t);
      while (this.el.toasts.children.length > 2) this.el.toasts.firstElementChild.remove();
      requestAnimationFrame(() => t.classList.add('in'));
      t._t = setTimeout(() => this._dropToast(t), ms || 2600);
    },
    _dropToast(t) { t.classList.add('out'); setTimeout(() => t.remove(), 400); },

    // ---------------------------------------------------------------- per-frame update
    update(dt) {
      const g = game();
      if (this.screen !== 'level' || !this.level) { this.hideTooltipIfAny(); return; }
      dt = Math.min(0.1, dt || 0.016);
      const lv = this.level;
      const ed = g.editor;

      // budget bar (cost tweening)
      const cost = +(call('getCost') || 0);
      const budget = +lv.budget || 1;
      const k = 1 - Math.exp(-dt * 10);
      this._shownCost += (cost - this._shownCost) * k;
      if (Math.abs(cost - this._shownCost) < 0.5) this._shownCost = cost;
      const ratio = this._shownCost / budget;
      const sigB = Math.round(this._shownCost) + '|' + budget;
      if (this._sig.budget !== sigB) {
        this._sig.budget = sigB;
        this.el.cost.textContent = money(this._shownCost);
        this.el.fill.style.width = (clamp(ratio, 0, 1) * 100).toFixed(2) + '%';
        this.el.fill.style.background = budgetColor(ratio);
        const over = cost > budget;
        if (this._sig.over !== over) {
          this._sig.over = over;
          this.el.budget.classList.toggle('over', over);
          if (over && this.mode === 'edit') { this.el.budget.classList.remove('shake'); void this.el.budget.offsetWidth; this.el.budget.classList.add('shake'); }
        }
      }

      // tools / palette state
      const tool = ed ? ed.tool : null;
      const mat = ed ? ed.material : null;
      const mir = ed ? !!ed.mirror : false;
      const sigT = tool + '|' + mat + '|' + mir;
      if (this._sig.tools !== sigT) {
        this._sig.tools = sigT;
        $$('[data-tool]', this.el.rail).forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        $$('[data-mat]', this.el.palette).forEach(b => b.classList.toggle('active', b.dataset.mat === mat && tool !== 'erase' && tool !== 'pier'));
        $('[data-act=mirror]', this.el.rail).classList.toggle('on', mir);
      }
      if (ed) {
        const cu = typeof ed.canUndo === 'function' ? ed.canUndo() : (ed.canUndo != null ? !!ed.canUndo : (ed.undoStack ? ed.undoStack.length > 0 : true));
        const cr = typeof ed.canRedo === 'function' ? ed.canRedo() : (ed.canRedo != null ? !!ed.canRedo : (ed.redoStack ? ed.redoStack.length > 0 : true));
        const sigU = cu + '|' + cr;
        if (this._sig.undo !== sigU) {
          this._sig.undo = sigU;
          $('[data-act=undo]', this.el.rail).disabled = !cu;
          $('[data-act=redo]', this.el.rail).disabled = !cr;
        }
      }

      // pier count (n / max)
      if (lv.maxPiers != null && ed && ed.design && this.mode === 'edit') {
        const np = (ed.design.piers || []).length;
        const sigP = np + '/' + lv.maxPiers;
        if (this._pierSig !== sigP) {
          this._pierSig = sigP;
          const pl = $('[data-tool=pier] span', this.el.rail);
          if (pl) pl.textContent = 'Pier ' + sigP;
          const pb = $('[data-tool=pier]', this.el.rail);
          if (pb) pb.title = 'Pier (P): ' + np + ' of ' + lv.maxPiers + ' allowed';
        }
      }

      // sim bar
      const sim = g.sim;
      if (this.mode === 'sim' || this.mode === 'results') {
        const tl = lv.timeLimit || 0;
        const t = sim ? (+sim.time || 0) : 0;
        const vt = sim && sim.vehicles ? sim.vehicles.length : 0;
        const vf = sim && sim.vehicles ? sim.vehicles.filter(v => v.state === 'finished').length : 0;
        const sigS = t.toFixed(1) + '|' + vf + '/' + vt + '|' + !!g.paused + '|' + g.speed + '|' + !!(g.settings && g.settings.showStress);
        if (this._sig.sim !== sigS) {
          this._sig.sim = sigS;
          this.el.simTime.textContent = t.toFixed(1);
          this.el.simLimit.textContent = tl ? '/ ' + tl + ' s' : 's';
          this.el.simVeh.textContent = vf + '/' + vt;
          const pb = $('[data-act=pause]', this.el.simbar);
          pb.innerHTML = g.paused ? icon('play') : icon('pause');
          pb.classList.toggle('on', !!g.paused);
          this.el.simbar.classList.toggle('paused', !!g.paused);
          $('[data-act=step]', this.el.simbar).disabled = !g.paused;
          $$('[data-speed]', this.el.speed).forEach(b => b.classList.toggle('active', +b.dataset.speed === +g.speed));
          $('[data-act=stress]', this.el.simbar).classList.toggle('on', !!(g.settings && g.settings.showStress));
          this.el.simTime.parentElement.classList.toggle('warn', tl && t > tl * 0.9);
        }
      }

      // tooltip
      const info = call('getHoverInfo');
      if (info) this.showTooltip(info);
      else this.hideTooltip();
    },

    // ---------------------------------------------------------------- tooltip
    // info: {x, y (client px), title, color, rows:[[k,v,cls]], stress (0..), peak}
    showTooltip(info) {
      const tt = this.el.tooltip;
      const sig = info.title + '|' + info.rows.map(r => r.join(':')).join('|') + '|' + info.stress;
      if (tt._sig !== sig) {
        tt._sig = sig;
        let html = '<div class="tt-head"><span class="tt-sw" style="background:' + esc(info.color || '#888') + '"></span><b>' + esc(info.title) + '</b></div>';
        html += '<div class="tt-rows">' + info.rows.map(r => '<span class="k">' + esc(r[0]) + '</span><span class="v ' + (r[2] || '') + '">' + esc(r[1]) + '</span>').join('') + '</div>';
        if (info.stress != null) {
          const s = clamp(Math.abs(info.stress), 0, 1.2);
          html += '<div class="tt-meter"><span style="width:' + (Math.min(1, s) * 100).toFixed(1) + '%;background:' + stressColor(s) + '"></span>' +
            (info.peak != null ? '<i style="left:' + (Math.min(1, info.peak) * 100).toFixed(1) + '%"></i>' : '') + '</div>';
        }
        tt.innerHTML = html;
      }
      const W = root.innerWidth, H = root.innerHeight;
      const r = tt.getBoundingClientRect();
      let x = info.x + 18, y = info.y + 18;
      if (x + r.width > W - 8) x = info.x - r.width - 14;
      if (y + r.height > H - 8) y = info.y - r.height - 14;
      tt.style.transform = 'translate(' + Math.round(Math.max(8, x)) + 'px,' + Math.round(Math.max(8, y)) + 'px)';
      tt.classList.add('show');
    },
    hideTooltip() { if (this.el.tooltip) this.el.tooltip.classList.remove('show'); },
    hideTooltipIfAny() { this.hideTooltip(); },

    // ---------------------------------------------------------------- results
    // res: {passed, stars, cost, budget, title, reasonText, simOk, time, peakStress, vehiclesFinished, vehiclesTotal, brokenBeams, hasNext, improved, best}
    showResults(res) {
      const el = this.el.results;
      this._resultTimers.forEach(clearTimeout); this._resultTimers = [];
      el.classList.remove('inspecting');
      el.classList.toggle('pass', !!res.passed);
      el.classList.toggle('fail', !res.passed);
      this.el.resBanner.textContent = res.passed ? (res.stars === 3 ? 'Masterpiece' : res.improved ? 'New best' : 'Level complete') : (res.simOk ? 'Over budget' : 'Bridge failed');
      this.el.resTitle.textContent = res.title;
      this.el.resReason.textContent = res.reasonText || '';
      const stars = $$('.star', this.el.resStars);
      stars.forEach(s => s.classList.remove('on', 'pop'));
      const pct = res.budget ? res.cost / res.budget : 0;
      const pk = res.peakStress != null ? Math.round(res.peakStress * 100) : null;
      this.el.resStats.innerHTML = [
        ['Cost', money(res.cost), res.cost > res.budget ? 'bad' : 'good'],
        ['Budget', money(res.budget), ''],
        ['Vehicles', (res.vehiclesFinished || 0) + ' / ' + (res.vehiclesTotal || 0), res.vehiclesFinished >= res.vehiclesTotal && res.vehiclesTotal ? 'good' : 'bad'],
        ['Peak stress', pk != null ? pk + '%' : '—', pk != null && pk >= 100 ? 'bad' : ''],
        ['Time', (res.time || 0).toFixed(1) + ' s', ''],
        ['Broken', String(res.brokenBeams || 0), res.brokenBeams ? 'bad' : 'good'],
      ].map(r => '<div class="rs"><span>' + r[0] + '</span><b class="' + r[2] + '">' + r[1] + '</b></div>').join('');
      const rb = $('.rb-fill', this.el.resBudget);
      rb.style.width = '0%';
      rb.style.background = budgetColor(pct);
      $('.rb-cap', this.el.resBudget).textContent = Math.round(pct * 100) + '% of budget';
      this._resultTimers.push(setTimeout(() => { rb.style.width = (clamp(pct, 0, 1) * 100) + '%'; }, 250));
      const nb = $('[data-act=next]', el);
      nb.hidden = !res.passed;
      $('span', nb).textContent = res.hasNext ? 'Next level' : 'All levels';
      // the sim is deterministic: retrying an unchanged failed bridge replays the same failure,
      // so after a failure the main action is going back to edit
      $('[data-act=retry]', el).classList.remove('btn-primary');
      $('[data-act=retry]', el).classList.add('btn-glass');
      $('[data-act=resEdit]', el).classList.toggle('btn-primary', !res.passed);
      $('[data-act=resEdit]', el).classList.toggle('btn-glass', !!res.passed);
      $('[data-act=retry] span', el).textContent = res.passed ? 'Replay' : 'Retry';
      el.classList.toggle('finale', !!res.finale);
      if (res.finale) {
        let tot = 0, max = 0;
        try { const S = stor(); tot = S ? S.totalStars() : 0; max = levelsList().length * 3; } catch (e) { /* */ }
        this.el.resBanner.textContent = 'All crossings complete';
        this.el.resTitle.textContent = 'You spanned them all!';
        this.el.resReason.textContent = 'Fifty bridges, from a wobbly plank to a 150 m suspension span. ' + (max ? 'You hold ' + tot + ' of ' + max + ' stars' + (tot < max ? '. The three-star lines are still waiting.' : '. A perfect run.') : '');
      }
      this.el.pillText.textContent = res.passed ? ('★'.repeat(res.stars) + ' · ' + money(res.cost)) : (res.simOk ? 'Over budget' : 'Failed');
      el.classList.add('show');
      for (let i = 0; i < 3; i++) {
        if (i < (res.stars | 0)) {
          this._resultTimers.push(setTimeout(() => {
            stars[i].classList.add('on', 'pop');
            sfx('star', { index: i });
          }, 520 + i * 340));
        }
      }
    },
    hideResults(instant) {
      const el = this.el.results;
      if (!el) return;
      this._resultTimers.forEach(clearTimeout); this._resultTimers = [];
      el.classList.remove('show', 'inspecting');
    },

    // ---------------------------------------------------------------- settings
    _buildSettings() {
      const el = h(`
        <div id="settings" class="modal">
          <div class="modal-card glass">
            <div class="modal-head"><h3>${icon('gear')}Settings</h3><button class="btn btn-icon btn-ghost" data-act="close" title="Close">${icon('close')}</button></div>
            <label class="set-row"><span>${icon('volume')}Sound volume</span><input type="range" min="0" max="100" step="1" data-set="volume"><output data-ref="volOut">70%</output></label>
            <label class="set-row"><span>${icon('stress')}Stress overlay</span><input type="checkbox" class="switch" data-set="showStress"></label>
            <label class="set-row"><span>${icon('grid')}Build grid</span><input type="checkbox" class="switch" data-set="showGrid"></label>
            <div class="set-row keys"><span>Shortcuts</span><div class="kb">
              <span><kbd>1</kbd>–<kbd>6</kbd> material</span><span><kbd>B</kbd> build</span><span><kbd>E</kbd> erase</span><span><kbd>P</kbd> pier</span><span><kbd>S</kbd> select</span><span><kbd>M</kbd> mirror</span>
              <span><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd> undo / redo</span><span><kbd>Shift</kbd> fine snap</span><span><kbd>Ctrl</kbd>+drag move joint</span><span><kbd>Del</kbd> delete selection</span><span><kbd>Space</kbd> test / stop</span><span><kbd>R</kbd> restart test</span><span><kbd>P</kbd> pause (test)</span><span><kbd>Wheel</kbd> zoom · <kbd>F</kbd> fit</span><span>Right-drag pan</span><span><kbd>Esc</kbd> back</span></div></div>
            <div class="modal-foot"><button class="btn btn-ghost danger" data-act="reset">Reset progress</button><button class="btn btn-primary" data-act="close">Done</button></div>
          </div>
        </div>`);
      el.addEventListener('click', e => {
        if (e.target === el) { this.closeSettings(); return; }
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'close') { sfx('click'); this.closeSettings(); }
        if (b.dataset.act === 'reset') {
          if (!b.classList.contains('confirm')) { sfx('error'); b.classList.add('confirm'); b.textContent = 'Click again to erase all progress'; setTimeout(() => { b.classList.remove('confirm'); b.textContent = 'Reset progress'; }, 3500); return; }
          sfx('erase'); call('resetProgress'); b.classList.remove('confirm'); b.textContent = 'Reset progress';
          this.toast('Progress reset.', 'info');
        }
      });
      el.addEventListener('input', e => {
        const inp = e.target.closest('[data-set]');
        if (!inp) return;
        const key = inp.dataset.set;
        if (key === 'volume') {
          const v = (+inp.value) / 100;
          $('[data-ref=volOut]', el).textContent = Math.round(v * 100) + '%';
          call('setSetting', 'volume', v);
        }
      });
      el.addEventListener('change', e => {
        const inp = e.target.closest('[data-set]');
        if (!inp) return;
        if (inp.type === 'checkbox') { call('setSetting', inp.dataset.set, inp.checked); sfx('toggle', { on: inp.checked }); }
        if (inp.dataset.set === 'volume') sfx('click');
      });
      this.el.settings = el;
      return el;
    },
    applySettings() {
      const s = (game().settings) || (stor() ? stor().getSettings() : { volume: 0.7, showStress: true, showGrid: true });
      const el = this.el.settings;
      if (!el) return;
      $('[data-set=volume]', el).value = Math.round((s.volume != null ? s.volume : 0.7) * 100);
      $('[data-ref=volOut]', el).textContent = Math.round((s.volume != null ? s.volume : 0.7) * 100) + '%';
      $('[data-set=showStress]', el).checked = !!s.showStress;
      $('[data-set=showGrid]', el).checked = !!s.showGrid;
      this._sig.sim = null;
    },
    openSettings() { this.applySettings(); this.el.settings.classList.add('show'); },
    closeSettings() { this.el.settings.classList.remove('show'); },
    settingsOpen() { return !!(this.el.settings && this.el.settings.classList.contains('show')); },
    templatesOpen() { return !!(this.el.tplMenu && this.el.tplMenu.classList.contains('open')); },
    closeTemplates() { if (this.el.tplMenu) { this.el.tplMenu.classList.remove('open'); this.el.tplWrap.classList.remove('open'); } },
    resultsInspecting() { return !!(this.el.results && this.el.results.classList.contains('inspecting')); },
    setInspecting(on) { if (this.el.results) this.el.results.classList.toggle('inspecting', !!on); },

    // ---------------------------------------------------------------- screens
    showScreen(name) {
      this.screen = name;
      const map = { title: this.el.title, levelSelect: this.el.levels, level: this.el.level };
      Object.keys(map).forEach(k => map[k] && map[k].classList.toggle('active', k === name));
      document.body.dataset.screen = name;
      if (name === 'title') this.refreshTitle();
      if (name === 'levelSelect') this.buildLevelSelect();
      if (name !== 'level') { this.hideTooltip(); this.hideHint(); }
    },
    flash() {
      const f = this.el.fader;
      if (!f) return;
      f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    },

    // exposed helpers
    icon, money, theme, vehSvg, material, materials, levelMaterials, CHAPTERS, THEMES,
  };

  function budgetColor(r) {
    // green (≤70%) → lime (85%) → amber (100%) → red (over)
    if (r <= 0.7) return 'linear-gradient(90deg,#22c58b,#3ee08f)';
    if (r <= 0.85) return 'linear-gradient(90deg,#3ee08f,#c6e14a)';
    if (r <= 1) return 'linear-gradient(90deg,#c6e14a,#ffb429)';
    return 'linear-gradient(90deg,#ff8a3d,#ff4d5e)';
  }
  function stressColor(s) {
    if (s < 0.5) return '#5be38a';
    if (s < 0.75) return '#d8e04a';
    if (s < 0.9) return '#ffad33';
    return '#ff4d5e';
  }

  // tiny pictograms for the template menu (viewBox 64x30, deck at y=20)
  function tplPic(id) {
    const deck = '<path class="tp-deck" d="M4 20H60"/>';
    const P = {
      beam: '<path d="M4 20H60M4 24H60M4 20l6 4 6-4 6 4 6-4 6 4 6-4 6 4 6-4 6 4 6-4"/>',
      warren: '<path d="M4 20L10 10 16 20 22 10 28 20 34 10 40 20 46 10 52 20 58 10 60 20M10 10H58"/>',
      pratt: '<path d="M4 20L12 10H52L60 20M12 10V20M20 10V20M28 10V20M36 10V20M44 10V20M52 10V20M12 10L20 20M20 10L28 20M44 10L36 20M52 10L44 20"/>',
      howe: '<path d="M4 20L12 10H52L60 20M12 10V20M20 10V20M28 10V20M36 10V20M44 10V20M52 10V20M20 10L12 20M28 10L20 20M36 10L44 20M44 10L52 20"/>',
      deck_arch: '<path d="M4 28Q32 8 60 28M14 20V22M22 20V16.5M32 20V15M42 20V16.5M50 20V22"/>',
      through_arch: '<path d="M4 20Q32 -2 60 20M14 20V11M23 20V7M32 20V5.5M41 20V7M50 20V11"/>',
      suspension: '<path d="M16 28V4M48 28V4M2 20Q9 18 16 4Q32 26 48 4Q55 18 62 20M22 20V11M27 20V16M32 20V18M37 20V16M42 20V11"/>',
      cable_stayed: '<path d="M32 28V2M32 3L6 20M32 3L14 20M32 3L22 20M32 3L58 20M32 3L50 20M32 3L42 20"/>',
    };
    return '<svg viewBox="0 0 64 30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">' + (P[id] || '') + '</g><g fill="none" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round">' + deck + '</g></svg>';
  }
  function matSwatch(id, m) {
    const c = m.color || '#999';
    switch (id) {
      case 'road': return '<svg viewBox="0 0 40 24"><rect x="2" y="8" width="36" height="8" rx="1.5" fill="#33373e"/><rect x="2" y="7" width="36" height="2" rx="1" fill="#6b7280"/><path d="M6 12h6M17 12h6M28 12h6" stroke="#ffd166" stroke-width="1.4"/></svg>';
      case 'reinforced_road': return '<svg viewBox="0 0 40 24"><rect x="2" y="8" width="36" height="8" rx="1.5" fill="#3a3f48"/><rect x="2" y="6.5" width="36" height="2.5" rx="1" fill="#9aa6b8"/><rect x="2" y="15" width="36" height="2.5" rx="1" fill="#9aa6b8"/><path d="M6 12h6M17 12h6M28 12h6" stroke="#ffd166" stroke-width="1.4"/></svg>';
      case 'wood': return '<svg viewBox="0 0 40 24"><rect x="2" y="8" width="36" height="8" rx="1.5" fill="' + c + '"/><path d="M4 10.5c8-1 14 1 22 0s10 0 12 0M4 13.5c9 1 15-1 22 0s9 0 12 0" stroke="rgba(60,30,10,.45)" stroke-width=".9" fill="none"/><circle cx="4.5" cy="12" r="1.3" fill="#d9d2c4"/><circle cx="35.5" cy="12" r="1.3" fill="#d9d2c4"/></svg>';
      case 'steel': return '<svg viewBox="0 0 40 24"><rect x="2" y="7" width="36" height="2.2" fill="#b9c3d0"/><rect x="2" y="14.8" width="36" height="2.2" fill="#8792a3"/><rect x="2" y="9" width="36" height="6" fill="' + c + '"/><g fill="#5d6675">' + [7, 14, 21, 28, 35].map(x => '<circle cx="' + x + '" cy="12" r=".9"/>').join('') + '</g></svg>';
      case 'rope': return '<svg viewBox="0 0 40 24"><path d="M2 9 Q20 18 38 9" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M2 9 Q20 18 38 9" stroke="rgba(90,60,20,.6)" stroke-width="2.4" stroke-dasharray="1 2" fill="none"/></svg>';
      case 'cable': return '<svg viewBox="0 0 40 24"><path d="M2 6 L38 18" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M2 6 L38 18" stroke="#c7ced8" stroke-width=".7" stroke-dasharray="2 1.5"/><circle cx="3" cy="6.3" r="2" fill="#c7ced8"/><circle cx="37" cy="17.7" r="2" fill="#c7ced8"/></svg>';
      default: return '<svg viewBox="0 0 40 24"><rect x="2" y="9" width="36" height="6" rx="2" fill="' + c + '"/></svg>';
    }
  }
  Hud.budgetColor = budgetColor;
  Hud.stressColor = stressColor;

  BG.Hud = Hud;
})(typeof window !== 'undefined' ? window : globalThis);
