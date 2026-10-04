/* SPAN — ceiling: a level's build ceiling drawn as scenery.
 * Some levels cap building a few metres above the road (buildArea.y1) and their hints name the cause ("a rock
 * ledge caps you 4 m above the road", "an overhanging glacier"). This module draws that cause in the terrain
 * style: an overhanging rock ledge, a glacier tongue, a cave roof or the girder of a bridge above, spanning the
 * gap at the ceiling height, with a shaded underside and a soft shadow on what passes beneath. In edit mode a
 * subtle hatch marks the underside (and any unbuildable band below it) and a small label names it.
 *
 * Cosmetic only: the model, the physics, the build area and the solutions are untouched.
 *   level.terrain.ceiling = { kind: 'rock' | 'ice' | 'cave' | 'girder', y?: m, from?: 'left' | 'right' }  (optional)
 *     kind  what to draw (default: by theme, see THEME_KIND); y  raise the drawn underside (never below
 *     buildArea.y1); from  the bank a rock ledge or glacier grows from (default: the higher bank, else by id).
 *   level.terrain.ceiling = false  never draw one.
 * Without the field a ceiling is drawn when buildArea.y1 is within MAX_HEADROOM m of the deck (Famous Bridges
 * excepted: their caps stand for the historical form, not for scenery) — so generated "low roof" crossings get
 * one too. The underside is never drawn lower than the tallest traffic of the level (drawn sprite height +
 * MARGIN, and the overhead wire of a tram or high-speed line), so it can sit above y1: forLevel().raised.
 *
 * Wraps BG.Renderer.prototype.levelBounds (the camera fit keeps VIEW_ABOVE m of the mass in frame), _drawTerrain (the scenery, in the static mid-layer cache; also hides street-lamp
 * and signal glows that would shine through it), _drawEditUnder (hatch + label) and _drawLights (the soft
 * shadow, drawn every frame over vehicles and beams). forLevel() and profile() are pure and also run in Node.
 * Classic script. */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const KINDS = ['rock', 'ice', 'cave', 'girder'];
  const THEME_KIND = { snow: 'ice', city: 'girder', night: 'girder', volcanic: 'cave' }; // the rest: rock
  const MAX_HEADROOM = 5;  // m above the deck: a cap this low leaves no room for a truss over the traffic
  const MARGIN = 0.6;      // m of air between the tallest roof and the underside
  const WIRE_AIR = 0.45;   // m between an overhead contact wire and the underside
  const FALLBACK_EXTRA = 0.25;
  const VIEW_ABOVE = 3.5;  // m of the mass kept in frame above the underside by the camera fit // added to a vehicle's model height when the renderer (sprite sizes) is not loaded

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function snapUp(v) { return Math.ceil(v * 4 - 1e-9) / 4; }
  function strHash(s) {
    s = String(s);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function vehHeight(type) {
    const R = BG.Renderer;
    const h = R && R.drawnHeight ? R.drawnHeight(type) : null;
    if (h) return h;
    const d = (BG.RailCars && BG.RailCars[type]) || (BG.Vehicles && BG.Vehicles[type]);
    return d && d.height ? d.height + FALLBACK_EXTRA : 4.3 + FALLBACK_EXTRA;
  }

  /** The tallest thing that has to pass under the ceiling: { h (m above the deck), type }. */
  function tallest(level) {
    let best = { h: 0, type: null };
    const consider = (type) => { const h = vehHeight(type); if (h > best.h) best = { h, type }; };
    const traffic = (level && level.traffic) || [];
    const trains = [];
    for (const g of traffic) {
      if (!g) continue;
      if (g.type === 'train') {
        const T = BG.Trains && BG.Trains[g.train];
        trains.push(String(g.train || ''));
        if (T && T.cars) for (const c of T.cars) consider(c);
      } else consider(g.type);
    }
    // overhead line (same rule as the renderer's rail decor, SPEC §9.4)
    const rail = level && (level.campaign === 'rail' || trains.length > 0);
    if (rail) {
      const decor = level.decor || {};
      const hs = trains.some(p => p.indexOf('highspeed') === 0), tram = trains.some(p => p === 'tram');
      const cat = decor.catenary !== undefined ? !!decor.catenary : (hs || tram);
      if (cat) {
        const wire = hs || !tram ? 4.65 : 3.95;
        if (wire + WIRE_AIR - MARGIN > best.h) best = { h: wire + WIRE_AIR - MARGIN, type: 'catenary' };
      }
    }
    return best;
  }

  /** The ceiling to draw for a level, or null: { kind, y, limit, raised, need, tallest, le, re, from, seed }. */
  function forLevel(level) {
    if (!level || !level.terrain || !level.buildArea) return null;
    const t = level.terrain, ba = level.buildArea;
    const spec = t.ceiling;
    if (spec === false || (spec && spec.kind === 'none')) return null;
    const explicit = !!spec && typeof spec === 'object';
    const ly = num(t.leftY, 0), ry = num(t.rightY, 0);
    const top = Math.max(ly, ry), mid = (ly + ry) / 2;
    if (!explicit) {
      if (level.campaign === 'famous') return null;
      if (!(ba.y1 - mid <= MAX_HEADROOM + 1e-9)) return null;
    }
    const kind = explicit && KINDS.indexOf(spec.kind) >= 0 ? spec.kind : (THEME_KIND[level.theme] || 'rock');
    const tall = tallest(level);
    const need = snapUp(top + tall.h + MARGIN);
    const y = Math.max(ba.y1, need, explicit ? num(spec.y, -1e9) : -1e9);
    const seed = strHash(level.id != null ? level.id : level.name || 'x');
    let from = explicit && (spec.from === 'left' || spec.from === 'right') ? spec.from : null;
    if (!from) from = ly > ry + 0.01 ? 'left' : ry > ly + 0.01 ? 'right' : (seed & 1 ? 'right' : 'left');
    const le = num(t.leftEdge, ba.x0), re = num(t.rightEdge, ba.x1);
    return {
      kind, y, limit: ba.y1, raised: y > ba.y1 + 1e-6, need, tallest: tall.type, tallestH: tall.h,
      le: Math.min(le, ba.x0), re: Math.max(re, ba.x1), from, seed,
    };
  }

  // ------------------------------------------------------------------ shape
  // value noise (same flavour as the renderer's, but self-contained so profile() runs in Node)
  function h1(i, s) {
    let n = (Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263)) ^ 0x27d4eb2d;
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b); n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35); n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  function vnoise(x, s) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h1(i, s) + (h1(i + 1, s) - h1(i, s)) * u; }
  function fbm(x, s) { return (vnoise(x, s) * 0.55 + vnoise(x * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, s + 13) * 0.15); }
  function sm(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

  /**
   * The drawn outline in world metres: { pts: [{x, u, t}] sorted by x (u underside, t top), tip, x0, x1 }.
   * u >= C.y everywhere (icicles and stalactites hang into the air between u and C.y, never below C.y).
   */
  function profile(C) {
    const { le, re, y, kind } = C;
    const s = (C.seed % 9973) + 11;
    const G = Math.max(1, re - le);
    const pts = [];
    const xsFor = (a, b) => { // fine near the gap, coarse far out on the banks
      const xs = [];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let x = lo; x <= hi + 1e-9;) { xs.push(x); const d = Math.max(le - x, x - re, 0); x += d > 40 ? 2.5 : d > 15 ? 0.8 : 0.4; }
      if (xs[xs.length - 1] < hi) xs.push(hi);
      return xs;
    };
    const FAR = 420;
    if (kind === 'rock' || kind === 'ice') {
      const sd = C.from === 'right' ? 1 : -1;            // the side the ledge / glacier grows from
      const Es = sd < 0 ? le : re, Ef = sd < 0 ? re : le;
      const lip = (kind === 'ice' ? 3.2 : 3.6) + Math.min(6, G * 0.07);
      const tip = Ef - sd * lip;
      const ub = kind === 'ice' ? 0.6 : 0, ua = kind === 'ice' ? 0.2 : 0.32;
      const base = kind === 'ice' ? 4.6 : 2.7;
      for (const x of xsFor(tip, Es + sd * FAR)) {
        const d = sd * (x - Es);                         // > 0: over the bank it grows from
        const q = sd * (x - tip);                        // distance from the tip toward that bank (>= 0)
        let u = y + ub + fbm(x * 0.38, s) * ua;
        if (d > 0) u += Math.min(4, 0.06 * Math.pow(d, 1.3));
        if (kind === 'rock' && q < 2.4) u += (2.4 - q) * (2.4 - q) * 0.3; // the lip curls up
        let th = base + (fbm(x * 0.11, s + 3) - 0.5) * 1.6;
        if (d > 0) th += 0.5 * Math.pow(d, 1.28);
        th *= kind === 'ice' ? 0.6 + 0.4 * sm(q / 4) : 0.12 + 0.88 * sm(q / 4.5);
        pts.push({ x, u, t: u + Math.max(0.25, th) });
      }
      // close the tip: a rock lip comes to a point, a glacier ends in a steep ice face (serac front)
      const p0 = pts[0];
      if (kind === 'rock') p0.t = p0.u + 0.05;
      return { pts, tip, x0: pts[0].x, x1: pts[pts.length - 1].x, from: sd < 0 ? 'left' : 'right' };
    }
    if (kind === 'cave') {
      for (const x of xsFor(le - FAR, re + FAR)) {
        const d = Math.max(le - x, x - re);
        let u = y + 0.45 + fbm(x * 0.33, s) * 0.4;
        if (d > 0) u += Math.min(3.2, 0.05 * Math.pow(d, 1.3));
        pts.push({ x, u, t: y + 400 });
      }
      return { pts, tip: null, x0: pts[0].x, x1: pts[pts.length - 1].x };
    }
    // girder: a straight beam of a bridge above
    pts.push({ x: le - FAR, u: y, t: y + GIRDER.top }, { x: re + FAR, u: y, t: y + GIRDER.top });
    return { pts, tip: null, x0: le - FAR, x1: re + FAR };
  }
  const GIRDER = { flange: 0.22, web: 1.5, top: 3.25, slab: 0.5 };

  /** Underside height at x (world), or null where nothing hangs. */
  function underAt(P, x) {
    const pts = P.pts;
    if (x < pts[0].x || x > pts[pts.length - 1].x) return null;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].x <= x) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi], f = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
    return a.u + (b.u - a.u) * f;
  }

  // ------------------------------------------------------------------ drawing
  const STEEL = {
    city: ['#5a6573', '#3d4550', '#8693a1'], night: ['#3b4558', '#283041', '#5a6782'],
    snow: ['#55708a', '#3b5068', '#7d97ae'], volcanic: ['#3c3634', '#262120', '#5d5350'],
  };
  const STEEL_DEFAULT = ['#8a4a35', '#64321f', '#ae6a50']; // red-oxide plate girder

  function U() { return BG.Renderer && BG.Renderer.util; }

  // state kept on the renderer instance, rebuilt when the level changes
  function stateOf(r) {
    const L = r.level;
    if (r._ceilLevel !== L) {
      r._ceilLevel = L;
      const C = forLevel(L);
      r._ceil = C ? { C, P: profile(C), path: null } : null;
    }
    return r._ceil;
  }

  function outlinePath(P) {
    const p = new Path2D(), pts = P.pts;
    p.moveTo(pts[0].x, pts[0].u);
    for (const q of pts) p.lineTo(q.x, q.t);
    for (let i = pts.length - 1; i >= 0; i--) p.lineTo(pts[i].x, pts[i].u);
    p.closePath();
    return p;
  }
  function polyline(g, pts, key, x0, x1, dy) {
    g.beginPath();
    let started = false;
    for (const q of pts) {
      if (q.x < x0 || q.x > x1) continue;
      const yy = q[key] + (dy || 0);
      if (!started) { g.moveTo(q.x, yy); started = true; } else g.lineTo(q.x, yy);
    }
    return started;
  }

  function drawMass(r, g) {
    const S = stateOf(r); if (!S) return;
    const { C, P } = S, u = U(); if (!u) return;
    const z = r.camera.zoom, px = 1 / z;
    const v = r._visibleWorld(60);
    const x0 = Math.max(P.x0, v.x0 - 4), x1 = Math.min(P.x1, v.x1 + 4);
    if (x1 <= x0) return;
    if (C.kind === 'girder') { drawGirder(r, g, C, P, x0, x1, px); return; }
    if (!S.path) S.path = outlinePath(P);
    const th = r.theme, G = th.ground;
    const y = C.y;
    const night = th.night >= 1;
    g.save();
    // ---- body
    if (C.kind === 'ice') {
      const gr = g.createLinearGradient(0, y + 7, 0, y);
      gr.addColorStop(0, night ? '#9fb2cc' : '#eef8ff'); gr.addColorStop(0.5, night ? '#7792b4' : '#b4dcf1'); gr.addColorStop(0.85, night ? '#5a7aa6' : '#7fbde0'); gr.addColorStop(1, night ? '#46679a' : '#5aa2cf');
      g.fillStyle = gr;
    } else {
      const dark = C.kind === 'cave' ? 0.35 : 0;
      const gr = g.createLinearGradient(0, y + 9, 0, y);
      gr.addColorStop(0, u.mix(G.soil[0], '#000000', dark)); gr.addColorStop(1, u.mix(G.soil[1], '#000000', dark * 0.6));
      g.fillStyle = gr;
    }
    g.fill(S.path);
    g.clip(S.path);
    const yTop = Math.min(v.y1 + 4, y + 60);
    if (C.kind === 'ice') drawIceBody(g, C, P, x0, x1, px, u, yTop);
    else drawRockBody(r, g, C, P, x0, x1, px, u, G, yTop);
    // ---- shaded underside (ambient occlusion along the bottom edge, inside the mass)
    const ao = C.kind === 'ice' ? 'rgba(20,70,120,' : 'rgba(0,0,0,';
    for (const [w, a] of [[1.6, 0.16], [0.8, 0.2], [0.3, 0.28]]) {
      g.strokeStyle = ao + a + ')'; g.lineWidth = w; g.lineJoin = 'round';
      if (polyline(g, P.pts, 'u', x0, x1)) g.stroke();
    }
    if (C.kind === 'cave') { // light from below catches the lip of the roof (lava glow in a volcanic gorge)
      const rim = r.theme.lava ? 'rgba(255,118,40,' : 'rgba(255,238,214,', k = r.theme.lava ? 1 : 0.35;
      for (const [w, a] of [[1.3, 0.22], [0.5, 0.34], [0.14, 0.7]]) {
        g.strokeStyle = rim + a * k + ')'; g.lineWidth = w;
        if (polyline(g, P.pts, 'u', x0, x1)) g.stroke();
      }
    }
    if (C.kind === 'ice') { // light caught by the translucent lower edge
      g.strokeStyle = 'rgba(225,247,255,0.75)'; g.lineWidth = Math.max(0.06, 1.4 * px);
      if (polyline(g, P.pts, 'u', x0, x1, 0.07)) g.stroke();
    }
    // ---- top surface: grass / sand / snow / rock lip, as on the banks
    if (C.kind !== 'cave') drawTopSurface(g, C, P, x0, x1, px, u, G, th);
    g.restore();
    // ---- things hanging into the air under the mass (never below C.y)
    if (C.kind === 'ice') drawIcicles(g, C, P, x0, x1, px, night);
    if (C.kind === 'cave') drawStalactites(g, C, P, x0, x1, px, u, G, !!th.lava);
    // ---- outline
    g.strokeStyle = C.kind === 'ice' ? 'rgba(40,90,140,0.45)' : 'rgba(0,0,0,0.32)';
    g.lineWidth = Math.max(0.04, 1.3 * px); g.lineJoin = 'round';
    g.stroke(S.path);
  }

  function drawRockBody(r, g, C, P, x0, x1, px, u, G, yTop) {
    const s = C.seed % 997;
    const step = Math.max(0.4, 7 * px);
    const tilt = (u.hash(s) - 0.5) * 0.05;
    const cave = C.kind === 'cave';
    // strata: bands roughly parallel to the ground, wobbling like the terrain's
    let yb = C.y - 1.5, k = 0;
    const rnd = u.mulberry(s * 13 + 5);
    const bands = [];
    while (yb < yTop && k < 200) { const h = 0.9 + rnd() * 2.4; bands.push({ y: yb, h, k }); yb += h; k++; }
    const bandY = (b, x) => b.y + (u.fbm(x * 0.045 + b.k * 3.7, s + 11, 3) - 0.5) * 1.6 + tilt * (x - C.le);
    for (let i = 0; i < bands.length - 1; i++) {
      const b = bands[i], nb = bands[i + 1];
      const col = G.strata[(b.k + s) % G.strata.length];
      g.fillStyle = u.mix(col, G.soil[1], cave ? 0.55 : 0.12 + 0.18 * (i % 2));
      g.globalAlpha = 0.66;
      g.beginPath();
      for (let x = x0; x <= x1 + step; x += step) { const yy = bandY(b, x); x === x0 ? g.moveTo(x, yy) : g.lineTo(x, yy); }
      for (let x = x1 + step; x >= x0; x -= step) g.lineTo(x, bandY(nb, x));
      g.closePath(); g.fill();
      g.globalAlpha = 0.16;
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.1 * px;
      g.beginPath();
      for (let x = x0; x <= x1 + step; x += step) { const yy = bandY(nb, x) - 0.05; x === x0 ? g.moveTo(x, yy) : g.lineTo(x, yy); }
      g.stroke();
    }
    g.globalAlpha = 1;
    // embedded rocks (only where they show)
    if (r.camera.zoom > 3) {
      const cs = 2.2;
      const i0 = Math.floor(x0 / cs), i1 = Math.ceil(x1 / cs), j0 = Math.floor(C.y / cs), j1 = Math.ceil(yTop / cs);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const q = u.hash2(i, j, s + 5);
        if (q > 0.16) continue;
        const q2 = u.hash2(i, j, s + 6), q3 = u.hash2(i, j, s + 7);
        const x = (i + q2) * cs, yy = (j + q3) * cs, rr = 0.16 + q * 2.6;
        g.fillStyle = u.mix(G.rock, G.soil[1], cave ? 0.6 : 0.3);
        g.beginPath(); g.ellipse(x, yy, rr, rr * (0.55 + q3 * 0.3), (q2 - 0.5) * 0.6, 0, u.TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,' + (cave ? 0.06 : 0.13) + ')';
        g.beginPath(); g.ellipse(x - rr * 0.2, yy + rr * 0.22, rr * 0.6, rr * 0.25, (q2 - 0.5) * 0.6, 0, u.TAU); g.fill();
      }
    }
    if (cave) { // the vault fades into darkness above
      const dg = g.createLinearGradient(0, C.y + 1, 0, C.y + 9);
      dg.addColorStop(0, 'rgba(8,4,4,0)'); dg.addColorStop(1, 'rgba(8,4,4,0.55)');
      g.fillStyle = dg; g.fillRect(x0, C.y, x1 - x0, yTop - C.y + 400);
    }
  }

  function drawIceBody(g, C, P, x0, x1, px, u, yTop) {
    const s = C.seed % 991;
    // annual layers: thin lines following the underside
    g.lineWidth = Math.max(0.03, 1 * px);
    for (let k = 1; k < 14; k++) {
      const off = k * 0.55 + (u.hash(s + k) - 0.5) * 0.2;
      g.strokeStyle = k % 3 ? 'rgba(255,255,255,0.32)' : 'rgba(70,130,180,0.2)';
      g.beginPath();
      let st = false;
      for (const q of P.pts) {
        if (q.x < x0 || q.x > x1) continue;
        const yy = q.u + off + (u.fbm(q.x * 0.08 + k, s, 2) - 0.5) * 0.5;
        if (yy > q.t - 0.15) { st = false; continue; }
        if (!st) { g.moveTo(q.x, yy); st = true; } else g.lineTo(q.x, yy);
      }
      g.stroke();
    }
    // crevasses: blue wedges opening from the top
    for (let i = 0; i < 40; i++) {
      const x = C.le - 10 + i * 2.7 + u.hash(s + i * 3) * 1.8;
      if (x < x0 || x > x1 || u.hash(s + i * 5) < 0.45) continue;
      const tAt = topAt(P, x); if (tAt == null) continue;
      const depth = 1.0 + u.hash(s + i * 7) * 2.2, w = 0.07 + u.hash(s + i * 11) * 0.1, lean = (u.hash(s + i * 13) - 0.5) * 0.5;
      g.fillStyle = 'rgba(48,110,170,0.55)';
      g.beginPath(); g.moveTo(x - w, tAt + 0.1); g.lineTo(x + lean, tAt - depth); g.lineTo(x + w, tAt + 0.1); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = Math.max(0.03, 1 * px);
      g.beginPath(); g.moveTo(x + w, tAt); g.lineTo(x + lean, tAt - depth); g.stroke();
    }
    // streaks on the serac front
    if (P.tip != null) {
      const sd = P.from === 'right' ? 1 : -1;
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = Math.max(0.03, 1.2 * px);
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const x = P.tip + sd * (0.25 + k * 0.32);
        const uu = underAt(P, x), tt = topAt(P, x); if (uu == null) continue;
        g.moveTo(x, uu + 0.2); g.lineTo(x + sd * 0.1, tt - 0.3);
      }
      g.stroke();
    }
  }
  function topAt(P, x) {
    const pts = P.pts;
    if (x < pts[0].x || x > pts[pts.length - 1].x) return null;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].x <= x) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi], f = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
    return a.t + (b.t - a.t) * f;
  }

  function topOr(P, x) { const t = topAt(P, x); return t == null ? Infinity : t; }

  function drawTopSurface(g, C, P, x0, x1, px, u, G, th) {
    const top = C.kind === 'ice' ? 'snow' : G.top;
    const band = top === 'snow' ? 0.45 : top === 'grass' ? 0.32 : 0.22;
    const c1 = top === 'snow' ? '#ffffff' : G.a, c2 = top === 'snow' ? '#d3e5f3' : G.b;
    // a band of surface material just under the top line
    g.beginPath();
    let st = false;
    const seg = [];
    for (const q of P.pts) if (q.x >= x0 - 1 && q.x <= x1 + 1) seg.push(q);
    if (seg.length < 2) return;
    for (const q of seg) { if (!st) { g.moveTo(q.x, q.t); st = true; } else g.lineTo(q.x, q.t); }
    for (let i = seg.length - 1; i >= 0; i--) { const q = seg[i]; g.lineTo(q.x, Math.max(q.u, q.t - band - (u.fbm(q.x * 0.7, 5, 2) - 0.5) * band * 0.6)); }
    g.closePath();
    g.fillStyle = c2; g.fill();
    g.strokeStyle = c1; g.lineWidth = band * 0.55; g.lineJoin = 'round';
    if (polyline(g, P.pts, 't', x0 - 1, x1 + 1, -band * 0.2)) g.stroke();
    if (top === 'grass' && 1 / px > 6) { // tufts along the top edge
      g.strokeStyle = G.a; g.lineWidth = Math.max(0.03, 1.1 * px);
      g.beginPath();
      for (const q of seg) {
        if (u.hash(Math.round(q.x * 10)) > 0.55) continue;
        g.moveTo(q.x, q.t - 0.02); g.lineTo(q.x + 0.08, q.t + 0.22 + u.hash(Math.round(q.x * 7)) * 0.2);
      }
      g.stroke();
    }
  }

  function drawIcicles(g, C, P, x0, x1, px, night) {
    const s = C.seed % 983;
    const gr = g.createLinearGradient(0, C.y + 0.5, 0, C.y);
    gr.addColorStop(0, night ? 'rgba(170,200,230,0.95)' : 'rgba(205,236,252,0.95)'); gr.addColorStop(1, night ? 'rgba(220,235,255,0.9)' : 'rgba(255,255,255,0.95)');
    g.fillStyle = gr;
    g.beginPath();
    const a = Math.floor(x0 / 0.3), b = Math.ceil(x1 / 0.3);
    for (let i = a; i <= b; i++) {
      const q = h1(i, s);
      if (q > 0.7) continue;
      const x = i * 0.3 + h1(i, s + 1) * 0.2;
      const uu = underAt(P, x); if (uu == null) continue;
      const room = uu - C.y;
      if (room < 0.08) continue;
      const len = Math.min(room, 0.15 + q * 0.8) * (h1(i, s + 2) > 0.3 ? 1 : 0.4);
      const w = 0.05 + h1(i, s + 3) * 0.09;
      g.moveTo(x - w, uu + 0.04); g.lineTo(x + w, uu + 0.04); g.lineTo(x + w * 0.15, uu - len); g.closePath();
    }
    g.fill();
  }

  function drawStalactites(g, C, P, x0, x1, px, u, G, lava) {
    const s = C.seed % 977;
    const a = Math.floor(x0 / 0.55), b = Math.ceil(x1 / 0.55);
    const base = u.mix(G.rock, G.soil[1], 0.55), hi = lava ? 'rgba(255,128,48,0.85)' : u.mix(G.rock, '#ffffff', 0.12);
    for (let i = a; i <= b; i++) {
      const q = h1(i, s);
      if (q > 0.5) continue;
      const x = i * 0.55 + h1(i, s + 1) * 0.3;
      const uu = underAt(P, x); if (uu == null) continue;
      const room = uu - C.y;
      if (room < 0.1) continue;
      const len = Math.min(room, 0.15 + q * 1.1), w = 0.08 + h1(i, s + 3) * 0.16;
      g.fillStyle = base;
      g.beginPath(); g.moveTo(x - w, uu + 0.06); g.quadraticCurveTo(x - w * 0.3, uu - len * 0.5, x, uu - len); g.quadraticCurveTo(x + w * 0.3, uu - len * 0.5, x + w, uu + 0.06); g.closePath(); g.fill();
      g.strokeStyle = hi; g.lineWidth = Math.max(0.02, 0.8 * px);
      g.beginPath(); g.moveTo(x - w * 0.5, uu); g.lineTo(x - w * 0.1, uu - len * 0.7); g.stroke();
    }
  }

  function drawGirder(r, g, C, P, x0, x1, px) {
    const col = STEEL[r.themeId] || STEEL_DEFAULT;
    const night = r.theme.night >= 1;
    const y = C.y, F = GIRDER.flange, Wb = GIRDER.web;
    const yWeb = y + F, yTopF = yWeb + Wb, ySlab = yTopF + F, yPar = ySlab + GIRDER.slab;
    // web
    const wg = g.createLinearGradient(0, yTopF, 0, yWeb);
    wg.addColorStop(0, col[2]); wg.addColorStop(0.35, col[0]); wg.addColorStop(1, col[1]);
    g.fillStyle = wg; g.fillRect(x0, yWeb, x1 - x0, Wb);
    // stiffeners (with a shadow on one side) and rivet rows
    const sp = 2.4, k0 = Math.ceil((x0 - C.le) / sp), k1 = Math.floor((x1 - C.le) / sp);
    for (let k = k0; k <= k1; k++) {
      const x = C.le + k * sp;
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x + 0.09, yWeb, 0.09, Wb);
      g.fillStyle = col[2]; g.fillRect(x - 0.09, yWeb, 0.18, Wb);
    }
    // flanges
    g.fillStyle = col[1]; g.fillRect(x0, y, x1 - x0, F);
    g.fillStyle = col[0]; g.fillRect(x0, yTopF, x1 - x0, F);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x0, yTopF + F - 0.05, x1 - x0, 0.05); g.fillRect(x0, y + F - 0.05, x1 - x0, 0.04);
    if (1 / px > 7) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      const rs = 0.45, j0 = Math.ceil(x0 / rs), j1 = Math.floor(x1 / rs);
      for (let j = j0; j <= j1; j++) {
        const x = j * rs;
        g.fillRect(x - 0.035, yWeb + 0.12, 0.07, 0.07);
        g.fillRect(x - 0.035, yTopF - 0.19, 0.07, 0.07);
      }
    }
    // concrete deck slab with a drip edge, then the parapet railing of the road above
    const sg = g.createLinearGradient(0, yPar, 0, ySlab);
    sg.addColorStop(0, night ? '#5d6274' : '#b9b5ac'); sg.addColorStop(1, night ? '#41465a' : '#8d8980');
    g.fillStyle = sg; g.fillRect(x0, ySlab, x1 - x0, GIRDER.slab);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, ySlab, x1 - x0, 0.06);
    g.fillStyle = night ? '#2f3442' : '#6f6b63';
    const ps = 1.6, m0 = Math.ceil(x0 / ps), m1 = Math.floor(x1 / ps);
    for (let m = m0; m <= m1; m++) g.fillRect(m * ps - 0.04, yPar, 0.08, 0.9);
    g.fillRect(x0, yPar + 0.85, x1 - x0, 0.1);
    g.fillRect(x0, yPar + 0.42, x1 - x0, 0.05);
    // outline of the girder
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(0.03, 1.2 * px);
    g.strokeRect(x0 - 1, y, x1 - x0 + 2, ySlab - y);
  }

  /** Soft shadow under the mass, over whatever passes beneath (world transform set). */
  function drawShadow(r, ctx) {
    const S = stateOf(r); if (!S) return;
    const { C, P } = S;
    const v = r._visibleWorld(20);
    const x0 = Math.max(P.x0, v.x0 - 2), x1 = Math.min(P.x1, v.x1 + 2);
    if (x1 <= x0) return;
    const SH = { rock: [0.26, 3.2, '20,14,10'], ice: [0.17, 3, '20,60,100'], cave: [0.36, 6, '10,6,6'], girder: [0.24, 2.6, '14,16,22'] }[C.kind];
    const a = SH[0], D = SH[1], rgb = SH[2];
    const gr = ctx.createLinearGradient(0, C.y, 0, C.y - D);
    gr.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    gr.addColorStop(0.35, 'rgba(' + rgb + ',' + (a * 0.45) + ')');
    gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    let first = true;
    const pts = P.pts.filter(q => q.x >= x0 - 3 && q.x <= x1 + 3);
    if (pts.length < 2) return;
    const fade = (x) => { // the penumbra narrows toward the lip of a ledge or glacier
      if (P.tip == null) return 1;
      return sm(Math.abs(x - P.tip) / 3.5);
    };
    for (const q of pts) { if (first) { ctx.moveTo(q.x, q.u); first = false; } else ctx.lineTo(q.x, q.u); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; ctx.lineTo(q.x, Math.min(q.u, C.y - D * fade(q.x))); }
    ctx.closePath();
    ctx.fill();
  }

  /** Edit mode: hatch the underside and anything unbuildable below it; label it (screen-space overlay). */
  function drawEditHatch(r, ctx, state) {
    const S = stateOf(r); if (!S) return;
    const { C, P } = S, L = r.level, ba = L.buildArea;
    const bx0 = Math.max(ba.x0, P.x0), bx1 = Math.min(ba.x1, P.x1);
    if (!(bx1 > bx0)) return;
    const yLow = Math.min(C.limit, C.y);
    const pts = [];
    pts.push(r.worldToScreen(bx0, yLow));
    for (const q of P.pts) if (q.x > bx0 && q.x < bx1) pts.push(r.worldToScreen(q.x, Math.min(q.t, q.u + 0.4)));
    pts.splice(1, 0, r.worldToScreen(bx0, Math.min(topOr(P, bx0), underAt(P, bx0) + 0.4)));
    pts.push(r.worldToScreen(bx1, Math.min(topOr(P, bx1), underAt(P, bx1) + 0.4)), r.worldToScreen(bx1, yLow));
    r._screenXf(ctx);
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.clip();
    let minY = 1e9, maxY = -1e9;
    for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const sx0 = pts[0].x, sx1 = pts[pts.length - 1].x, h = maxY - minY;
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(sx0, minY, sx1 - sx0, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = sx0 - h - 9; x < sx1 + 9; x += 9) { ctx.moveTo(x, maxY); ctx.lineTo(x + h, minY); }
    ctx.stroke();
    ctx.restore();
    // the kind, written on the mass above the middle of the gap (where it is on screen and clear of the top bar)
    const I = BG.i18n, text = I ? I.t('editor.label.ceiling.' + C.kind) : C.kind;
    const xm = (C.le + C.re) / 2;
    const uu = underAt(P, xm);
    if (uu == null || typeof r._label !== 'function') return;
    const yl = r.worldToScreen(xm, Math.min(topOr(P, xm), uu + (C.kind === 'girder' ? GIRDER.flange + GIRDER.web / 2 : 0.9)));
    const minTop = ((r.insets && r.insets.top) || 0) + 12;
    const under = r.worldToScreen(xm, uu).y;
    if (yl.y < minTop || under - minTop < 18) return;
    r._label(ctx, yl.x, Math.max(yl.y, minTop + 2), text, 'rgba(24,20,16,0.62)', '#f4ead8', 10);
  }

  // hide lamp / signal glows that the mass now covers (they are collected while the mid layer is drawn)
  function prune(r) {
    const S = stateOf(r); if (!S) return;
    const covered = (x, y) => { const uu = underAt(S.P, x); return uu != null && y > uu - 0.05; }; // the lamp or its post is behind the mass
    if (r._lamps && r._lamps.length) r._lamps = r._lamps.filter(l => !covered(l.x, l.y));
    if (r._signals && r._signals.length) r._signals = r._signals.filter(sg => !covered(sg.x, sg.y));
  }

  // ------------------------------------------------------------------ hooks
  function install() {
    const R = BG.Renderer && BG.Renderer.prototype;
    if (!R || R._ceilingInstalled) return;
    R._ceilingInstalled = true;
    const drawTerrain = R._drawTerrain;
    R._drawTerrain = function (g) {
      const out = drawTerrain.apply(this, arguments);
      try { drawMass(this, g); prune(this); } catch (e) { if (root.console) console.warn('[ceiling]', e); }
      return out;
    };
    const editUnder = R._drawEditUnder;
    R._drawEditUnder = function (ctx, state) {
      const out = editUnder.apply(this, arguments);
      try { drawEditHatch(this, ctx, state); } catch (e) { if (root.console) console.warn('[ceiling]', e); }
      return out;
    };
    // keep a few metres of the mass in frame when the camera fits the level (on a phone the top bar would hide it)
    const levelBounds = R.levelBounds;
    R.levelBounds = function () {
      const b = levelBounds.apply(this, arguments);
      try { const S = this.level && stateOf(this); if (S && b) b.y1 = Math.max(b.y1, S.C.y + VIEW_ABOVE); } catch (e) { /* bounds stay as they were */ }
      return b;
    };
    const lights = R._drawLights;
    R._drawLights = function (ctx) {
      try { drawShadow(this, ctx); } catch (e) { if (root.console) console.warn('[ceiling]', e); }
      return lights.apply(this, arguments);
    };
  }
  install();

  BG.Ceiling = { forLevel, profile, underAt, tallest, KINDS, THEME_KIND, MAX_HEADROOM, MARGIN, install };
})(typeof window !== 'undefined' ? window : globalThis);
