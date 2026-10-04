/* SPAN — Forces of Nature, browser side (visuals, HUD, audio) for BG.Forces (js/core/events.js).
 *
 * Entirely additive: it wraps a few existing methods instead of editing them, and does nothing at all on a
 * level without `events`.
 *   BG.Renderer.prototype.render     -> quake camera rumble, then the foreground overlay (wind streaks, rain,
 *                                       storm grade + lightning, quake dust)
 *   BG.Renderer.prototype._drawShips -> (first world-space pass, behind beams and vehicles) swaying trees,
 *                                       windsock, flag, tower pennants, ground cracks
 *   BG.Hud.enterLevel / BG.Hud.update -> forecast chip, warning banner ("Hurricane incoming in 3 s"),
 *                                       event timeline on the sim bar
 *   BG.Game._onSimEvent              -> one-shot sounds on wind_start / quake_start
 *   own WebAudio nodes               -> wind howl + whistle, quake rumble, thunder (on BG.Audio's context)
 *   BG.Hud.CHAPTERS                  -> the hidden bonus chapter "Forces of Nature" (levels 51-53)
 */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const Forces = BG.Forces;
  if (!Forces) return;
  const TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function safe(fn) { try { return fn(); } catch (e) { if (!safe._w) { safe._w = 1; console.warn('[forces-fx]', e && e.message); } return undefined; } }

  // ------------------------------------------------------------------ per-level plan (cached)
  const plans = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function plan(level) {
    if (!level || !Array.isArray(level.events) || !level.events.length) return null;
    let p = plans && plans.get(level);
    if (!p) {
      const tl = Forces.timeline(level);
      p = { tl, winds: tl.filter(e => e.type === 'wind'), quakes: tl.filter(e => e.type === 'quake'), rain: tl.some(e => e.type === 'wind' && e.ev.rain) };
      if (plans) plans.set(level, p);
    }
    return p.tl.length ? p : null;
  }
  function liveForces(state) { return state && state.mode !== 'edit' && state.sim && state.sim.forces ? state.sim.forces : null; }

  // ================================================================== renderer
  const RP = BG.Renderer && BG.Renderer.prototype;
  if (RP && RP.render && !RP._forcesWrapped) {
    RP._forcesWrapped = true;
    const origRender = RP.render, origShips = RP._drawShips;

    RP.render = function (state) {
      const pl = plan(state && state.level);
      if (!pl) { this._fxs = null; return origRender.call(this, state); }
      const st = this._fxs && this._fxs.level === state.level ? this._fxs : (this._fxs = newFxState(state.level));
      st.state = state; st.plan = pl;
      const F = liveForces(state);
      const dt = clamp(typeof state.dt === 'number' ? state.dt : 1 / 60, 0, 0.1);
      st.dt = state.mode === 'sim' ? (state.paused ? 0 : dt * (state.timeScale > 0 ? state.timeScale : 1)) : dt;
      st.t += st.dt;
      // a new run (or edit mode): forget cracks
      if (!F || (st.simRef !== state.sim)) { st.simRef = F ? state.sim : null; st.cracks = null; }
      st.wind = F ? F.wind.v : 0;
      st.quake = F && F.quake.active ? F.quake.intensity : 0;
      if (st.quake > 0 && this.effects) {
        // camera rumble: hold the shake "trauma" at a level that follows the shaking intensity
        const target = 0.28 + 0.5 * st.quake;
        if (this.effects.trauma < target) this.effects.trauma = target;
      }
      const out = origRender.call(this, state);
      safe(() => drawFront(this, st));
      return out;
    };
    if (origShips) {
      RP._drawShips = function (ctx) {
        const out = origShips.apply(this, arguments);
        const st = this._fxs;
        if (st && st.state) safe(() => drawBehind(this, ctx, st));
        return out;
      };
    }
  }

  function newFxState(level) {
    return { level, t: 0, dt: 0, wind: 0, quake: 0, streaks: [], drops: [], leaves: [], cracks: null, dustT: 0, flash: 0, nextFlash: 4 + Math.random() * 5, simRef: null };
  }

  // ---------------------------------------------------------------- behind layer (world space)
  const TREE_STYLE = {
    tropical: ['palm', '#2f9a4a', '#6a4a2a'], autumn: ['round', '#e0782a', '#5a3a22'], meadow: ['round', '#5ca844', '#4a3424'],
    snow: ['pine', '#3f6a5a', '#3a2a20'], night: ['pine', '#1b3329', '#151515'], city: ['round', '#5a8a50', '#4a3a2c'],
    desert: ['round', '#8a9a4a', '#5a4030'], canyon: ['round', '#a8a050', '#5a4030'], volcanic: ['round', '#3a3028', '#241a18'],
  };
  function drawBehind(r, ctx, st) {
    const L = r.level, T = r.terrain;
    if (!L || !T) return;
    const t = st.t, v = st.wind, pl = st.plan;
    const z = r.camera.zoom;
    const lw = 1 / z; // 1 css px in world units
    const hasWind = pl.winds.length > 0;
    if (hasWind) {
      const e = clamp(Math.abs(v) / 30, 0, 1.3), dir = v < 0 ? -1 : 1;
      const style = TREE_STYLE[r.themeId] || TREE_STYLE.meadow;
      // swaying trees on both banks, well back from the road ends
      const spots = [[T.le - 9, T.ly, 5.5], [T.le - 16, T.ly, 7], [T.le - 24, T.ly, 6], [T.re + 10, T.ry, 6.5], [T.re + 18, T.ry, 5.5], [T.re + 27, T.ry, 7]];
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        const lean = dir * (0.32 * e * e) + Math.sin(t * (1.6 + i * 0.23) + i * 1.7) * (0.025 + 0.09 * e);
        drawTree(ctx, s[0], s[1], s[2], lean, style, lw);
      }
      // windsock on the left bank, flag on the right bank, pennants on towers
      drawWindsock(ctx, T.le - 4.5, T.ly, v, t, lw);
      drawFlag(ctx, T.re + 4.5, T.ry, v, t, lw);
      const piers = st.state.sim && st.state.mode !== 'edit' ? st.state.sim.piers : (st.state.design && st.state.design.piers);
      for (const p of piers || []) if (p.topY > Math.max(T.ly, T.ry) + 3) drawPennant(ctx, p.x, p.topY, v, t, lw);
    }
    if (pl.quakes.length) drawCracks(r, ctx, st, lw);
  }
  function drawTree(ctx, x, y, h, lean, style, lw) {
    const kind = style[0], leaf = style[1], trunk = style[2];
    ctx.save();
    ctx.translate(x, y - 0.1);
    ctx.lineCap = 'round';
    // bend: trunk as a quadratic curve leaning downwind, crown follows the tip
    const tipX = Math.sin(lean) * h, tipY = Math.cos(lean) * h;
    ctx.strokeStyle = trunk; ctx.lineWidth = kind === 'palm' ? 0.32 : 0.45;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(tipX * 0.2, h * 0.55, tipX * (kind === 'palm' ? 1 : 0.85), tipY * (kind === 'palm' ? 1 : 0.85)); ctx.stroke();
    ctx.translate(tipX * (kind === 'palm' ? 1 : 0.85), tipY * (kind === 'palm' ? 1 : 0.85));
    ctx.rotate(-lean * 0.6);
    ctx.fillStyle = leaf;
    if (kind === 'palm') {
      ctx.strokeStyle = leaf; ctx.lineWidth = 0.28;
      // fronds arch out and droop; the wind combs them downwind
      const fr = [-1.35, -0.85, -0.4, 0.4, 0.85, 1.35];
      for (let k = 0; k < fr.length; k++) {
        const a = fr[k] + lean * 1.8;
        const fx = Math.sin(a) * 2.7, fy = -0.5 - (1 - Math.cos(a)) * 1.3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(fx * 0.55, 0.9, fx, fy); ctx.stroke();
      }
    } else if (kind === 'pine') {
      for (let k = 0; k < 3; k++) {
        const w = (1.5 - k * 0.35) * h * 0.22, yy = -h * 0.45 + k * h * 0.2;
        ctx.beginPath(); ctx.moveTo(-w + lean * k, yy); ctx.lineTo(w + lean * k, yy); ctx.lineTo(lean * (k + 1) * 0.8, yy + h * 0.32); ctx.closePath(); ctx.fill();
      }
    } else {
      const R = h * 0.26;
      ctx.beginPath();
      ctx.ellipse(lean * R * 0.8, 0, R * 1.15, R * 0.95, 0, 0, TAU);
      ctx.ellipse(lean * R * 1.6 - R * 0.6, -R * 0.35, R * 0.75, R * 0.65, 0, 0, TAU);
      ctx.ellipse(lean * R * 1.6 + R * 0.65, -R * 0.3, R * 0.8, R * 0.7, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(lean * R - R * 0.3, R * 0.35, R * 0.45, R * 0.3, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  function drawWindsock(ctx, x, y, v, t, lw) {
    const H = 5;
    ctx.save();
    ctx.strokeStyle = '#d8dde4'; ctx.lineWidth = 0.16; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + H); ctx.stroke();
    const e = clamp(Math.abs(v) / 14, 0, 1), dir = v < 0 ? -1 : 1;
    const droop = (1 - e) * 1.25; // radians below horizontal
    const segs = 5, segL = 0.5;
    let px = x, py = y + H - 0.1, ang = -droop;
    const pts = [[px, py]];
    for (let i = 0; i < segs; i++) {
      ang += Math.sin(t * (9 + 4 * e) + i * 0.9) * 0.07 * e - (1 - e) * 0.06;
      px += dir * Math.cos(ang) * segL; py += Math.sin(ang) * segL;
      pts.push([px, py]);
    }
    for (let i = 0; i < segs; i++) {
      const r0 = 0.42 * (1 - i / segs * 0.55), r1 = 0.42 * (1 - (i + 1) / segs * 0.55);
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const nx = -(by - ay), ny = (bx - ax) * 1, nl = Math.hypot(nx, ny) || 1;
      ctx.fillStyle = i % 2 ? '#f4f4f0' : '#ff5a2a';
      ctx.beginPath();
      ctx.moveTo(ax + nx / nl * r0, ay + ny / nl * r0); ctx.lineTo(bx + nx / nl * r1, by + ny / nl * r1);
      ctx.lineTo(bx - nx / nl * r1, by - ny / nl * r1); ctx.lineTo(ax - nx / nl * r0, ay - ny / nl * r0); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawFlag(ctx, x, y, v, t, lw) {
    const H = 6.5;
    ctx.save();
    ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = 0.14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + H); ctx.stroke();
    const e = clamp(Math.abs(v) / 12, 0.08, 1), dir = v < 0 ? -1 : 1;
    const len = 2.4, hgt = 1.4, n = 10;
    const top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const wave = Math.sin(t * (6 + 6 * e) - u * 5) * 0.22 * u * (0.4 + e);
      const hang = (1 - e) * u * 1.8; // a limp flag hangs down
      const xx = x + dir * u * len * (0.35 + 0.65 * e);
      top.push([xx, y + H - hang + wave]);
      bot.push([xx + (1 - e) * 0.3 * u * dir, y + H - hgt - hang * 0.6 + wave]);
    }
    ctx.fillStyle = '#3a7bd5';
    ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]);
    for (const p of top) ctx.lineTo(p[0], p[1]);
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(top[3][0] * 0.5 + bot[3][0] * 0.5, top[3][1] * 0.5 + bot[3][1] * 0.5, 0.28, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawPennant(ctx, x, y, v, t, lw) {
    const e = clamp(Math.abs(v) / 12, 0.1, 1), dir = v < 0 ? -1 : 1;
    ctx.save();
    ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 2.2); ctx.stroke();
    ctx.fillStyle = '#ff4d5e';
    const L = 1.6 * (0.4 + 0.6 * e), w = Math.sin(t * (8 + 5 * e)) * 0.15 * e;
    ctx.beginPath(); ctx.moveTo(x, y + 2.2); ctx.lineTo(x + dir * L, y + 1.95 + w - (1 - e) * 0.9); ctx.lineTo(x, y + 1.7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function makeCracks(T) {
    // jagged cracks on both bank tops near the edge and down the cliff faces (visual only)
    const out = [];
    const rnd = Math.random;
    const crack = (x0, y0, dx, dy, n, step) => {
      const pts = [[x0, y0]];
      let x = x0, y = y0;
      for (let i = 0; i < n; i++) { x += dx * step + (rnd() - 0.5) * step * 0.6; y += dy * step + (rnd() - 0.5) * step * 0.45; pts.push([x, y]); }
      return pts;
    };
    for (const side of [-1, 1]) {
      const edge = side < 0 ? T.le : T.re, top = side < 0 ? T.ly : T.ry;
      for (let k = 0; k < 4; k++) out.push({ pts: crack(edge + side * (1.2 + k * 2.6 + rnd() * 1.5), top - 0.05, side * 0.2, -1, 4 + (rnd() * 3 | 0), 0.45), at: k * 0.18 });
      // a fissure opening along the bank top, back from the edge
      out.push({ pts: crack(edge + side * 2, top - 0.45, side, -0.05, 7, 0.6), at: 0.3 });
      out.push({ pts: crack(edge + side * 0.4, top - 0.6, side * 0.1, -1, 7, 0.6), at: 0.1 });
      out.push({ pts: crack(edge + side * 0.5, top - 3, side * 0.1, -1, 6, 0.7), at: 0.4 });
    }
    return out;
  }
  function drawCracks(r, ctx, st, lw) {
    const F = liveForces(st.state);
    if (!F) return;
    // crack growth follows sim time through each quake (so it is right after fast-forward / seeking too)
    let grow = 0;
    for (const q of st.plan.quakes) grow = Math.max(grow, clamp((F.time - q.start) / (0.6 * (q.end - q.start)), 0, 1) * clamp(q.ev.pga / 0.3, 0.4, 1));
    if (grow <= 0) return;
    if (!st.cracks) st.cracks = makeCracks(r.terrain);
    ctx.save();
    // cracks belong in the rock: clip them to the ground so none hangs in the air over the gap
    if (r.terrainPath) ctx.clip(r.terrainPath);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const c of st.cracks) {
      const g = clamp((grow - c.at) / (1 - c.at), 0, 1);
      if (g <= 0) continue;
      const n = Math.max(1, Math.round((c.pts.length - 1) * g));
      for (const pass of [[0.18, 'rgba(255,240,220,0.28)', 0.04], [0.1, 'rgba(25,14,8,0.85)', 0]]) {
        ctx.strokeStyle = pass[1]; ctx.lineWidth = Math.max(pass[0], 1.2 * lw);
        ctx.beginPath(); ctx.moveTo(c.pts[0][0] + pass[2], c.pts[0][1] - pass[2]);
        for (let i = 1; i <= n; i++) ctx.lineTo(c.pts[i][0] + pass[2], c.pts[i][1] - pass[2]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- front layer (screen space)
  function drawFront(r, st) {
    const ctx = r.ctx, W = r.W, H = r.H, d = r.dpr;
    const v = st.wind, dt = st.dt;
    const F = liveForces(st.state);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    // ---- wind streaks
    const sp = Math.abs(v), dir = v < 0 ? -1 : 1;
    const want = Math.round(clamp(sp / 30, 0, 1.4) * 110);
    const S = st.streaks;
    while (S.length < want) S.push({ x: Math.random() * W, y: Math.random() * H, k: Math.random(), life: Math.random() });
    if (S.length > want) S.length = want;
    if (S.length) {
      ctx.lineCap = 'round';
      for (const s of S) {
        const vel = (sp * 16 + 120) * (0.6 + s.k * 0.8);
        s.x += dir * vel * dt; s.life += dt * 0.7;
        s.y += Math.sin(st.t * 2 + s.k * 9) * 12 * dt;
        if (s.x < -200 || s.x > W + 200 || s.life > 1) { s.x = dir > 0 ? -Math.random() * 150 : W + Math.random() * 150; s.y = Math.random() * H; s.life = 0; s.k = Math.random(); }
        const len = (30 + sp * 3.2) * (0.5 + s.k);
        const a = clamp(sp / 30, 0, 1) * 0.6 * Math.sin(Math.PI * clamp(s.life, 0, 1));
        if (a <= 0.01) continue;
        const g = ctx.createLinearGradient(s.x, s.y, s.x - dir * len, s.y);
        g.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1 + s.k * 1.4;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - dir * len, s.y + Math.sin(s.k * 7) * 2); ctx.stroke();
      }
    }
    // ---- flying leaves / grit in strong wind
    const wantL = sp > 15 ? Math.round(clamp((sp - 15) / 25, 0, 1) * 24) : 0;
    const Lv = st.leaves;
    while (Lv.length < wantL) Lv.push({ x: dir > 0 ? -Math.random() * W * 0.3 : W + Math.random() * W * 0.3, y: Math.random() * H, k: Math.random(), rot: Math.random() * TAU });
    if (Lv.length > wantL) Lv.length = wantL;
    for (const l of Lv) {
      l.x += dir * (sp * 14 + 60) * (0.5 + l.k) * dt; l.y += (Math.sin(st.t * 3 + l.k * 20) * 40 + 15) * dt; l.rot += dt * (5 + l.k * 8);
      if (l.x < -60 || l.x > W + 60 || l.y > H + 20) { l.x = dir > 0 ? -20 : W + 20; l.y = Math.random() * H * 0.9; }
      ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot);
      ctx.fillStyle = ['#d8a24a', '#9bbf5a', '#c76a3a', '#e8d6b0'][(l.k * 4) | 0]; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(0, 0, 4 + l.k * 3, 1.8 + l.k, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // ---- rain + storm grade + lightning
    const rainEv = F && F.wind.active && F.wind.event && F.wind.event.rain;
    const rainK = rainEv ? clamp(sp / 25, 0.3, 1) : 0;
    st.rainK = (st.rainK || 0) + (rainK - (st.rainK || 0)) * Math.min(1, (dt || 0.016) * 1.5);
    const rk = st.rainK;
    if (rk > 0.02) {
      ctx.fillStyle = 'rgba(14,22,40,' + (0.22 * rk).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      const D = st.drops, wantD = Math.round(260 * rk);
      while (D.length < wantD) D.push({ x: Math.random() * W, y: Math.random() * H, k: Math.random() });
      if (D.length > wantD) D.length = wantD;
      const vy = 900, vx = v * 16;
      const ux = vx / Math.hypot(vx, vy), uy = vy / Math.hypot(vx, vy);
      ctx.strokeStyle = 'rgba(200,215,240,' + (0.38 * rk).toFixed(3) + ')'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of D) {
        const s = 0.7 + p.k * 0.6;
        p.x += vx * s * dt; p.y += vy * s * dt;
        if (p.y > H + 20) { p.y = -20 - Math.random() * 40; p.x = Math.random() * (W + 400) - 200; }
        if (p.x < -220) p.x += W + 400; else if (p.x > W + 220) p.x -= W + 400;
        const len = 10 + 10 * p.k;
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - ux * len, p.y - uy * len);
      }
      ctx.stroke();
      // lightning
      if (dt > 0) {
        st.nextFlash -= dt;
        if (st.nextFlash <= 0 && rk > 0.5) { st.flash = 1; st.nextFlash = 5 + Math.random() * 7; FxAudio.thunder(0.6 + Math.random() * 0.4); }
      }
    }
    if (st.flash > 0.01) {
      ctx.fillStyle = 'rgba(235,240,255,' + (0.32 * st.flash * (0.6 + 0.4 * Math.sin(st.flash * 40))).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      st.flash = Math.max(0, st.flash - (dt || 0.016) * 3.2);
    }
    // ---- quake: dust and pebbles from the cliff tops
    if (st.quake > 0 && dt > 0 && r.effects && r.terrain) {
      st.dustT -= dt;
      if (st.dustT <= 0) {
        st.dustT = 0.12 / (0.4 + st.quake);
        const T = r.terrain;
        const side = Math.random() < 0.5 ? -1 : 1;
        const prof = side < 0 ? T.left : T.right;
        const p = prof[(Math.random() * Math.min(prof.length, 4)) | 0] || { x: side < 0 ? T.le : T.re, y: side < 0 ? T.ly : T.ry };
        const col = r.theme && r.theme.ground && r.theme.ground.rock ? r.theme.ground.rock : '#8a6a4a';
        safe(() => r.effects.dust(p.x + side * 0.3, p.y, 3, 'rgba(190,160,120,1)', 0.8 + st.quake));
        if (Math.random() < 0.5) safe(() => r.effects.chunks(p.x + side * 0.2, p.y - 0.2, 2, [col, '#5a4636', '#a07a56']));
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ================================================================== audio (own nodes on BG.Audio's context)
  const FxAudio = {
    nodes: null,
    _ctx() { const A = BG.Audio; const c = A && A.context; return c && c.state === 'running' ? c : null; },
    _vol() { const A = BG.Audio; if (!A || A.muted) return 0; const v = A.volume == null ? 0.7 : A.volume; return v * v * 1.2; },
    _noise(ctx, brown) {
      const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
      return b;
    },
    _build(ctx) {
      const out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination);
      const white = this._noise(ctx, false), brown = this._noise(ctx, true);
      // wind: band-passed noise (howl) + a narrow whistle
      const ws = ctx.createBufferSource(); ws.buffer = white; ws.loop = true;
      const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 0.9;
      const wg = ctx.createGain(); wg.gain.value = 0;
      ws.connect(wf); wf.connect(wg); wg.connect(out);
      const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1400; hf.Q.value = 14;
      const hg = ctx.createGain(); hg.gain.value = 0;
      ws.connect(hf); hf.connect(hg); hg.connect(out);
      // quake: low rumble (brown noise, low-passed) + a sub sine
      const rs = ctx.createBufferSource(); rs.buffer = brown; rs.loop = true;
      const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 140;
      const rg = ctx.createGain(); rg.gain.value = 0;
      rs.connect(rf); rf.connect(rg); rg.connect(out);
      const so = ctx.createOscillator(); so.type = 'sine'; so.frequency.value = 38;
      const sg = ctx.createGain(); sg.gain.value = 0;
      so.connect(sg); sg.connect(out);
      ws.start(); rs.start(); so.start();
      this.nodes = { ctx, out, wf, wg, hf, hg, rf, rg, so, sg, brown, all: [ws, rs, so] };
    },
    update(wind, quake, gust, on) {
      const ctx = this._ctx();
      if (!ctx) return;
      if (!this.nodes) { if (!on) return; this._build(ctx); }
      const n = this.nodes, t = ctx.currentTime;
      const vol = on ? this._vol() : 0;
      n.out.gain.setTargetAtTime(vol * 0.9, t, 0.25);
      const e = clamp(Math.abs(wind) / 35, 0, 1.3);
      n.wg.gain.setTargetAtTime(on ? 0.5 * e * e : 0, t, 0.3);
      n.wf.frequency.setTargetAtTime(320 + 520 * e + 180 * gust, t, 0.4);
      n.hg.gain.setTargetAtTime(on ? 0.06 * e * e * (0.4 + 0.6 * gust) : 0, t, 0.3);
      n.hf.frequency.setTargetAtTime(900 + 900 * e + 300 * gust, t, 0.5);
      n.rg.gain.setTargetAtTime(on ? 1.1 * quake : 0, t, 0.15);
      n.sg.gain.setTargetAtTime(on ? 0.35 * quake : 0, t, 0.15);
      n.so.frequency.setTargetAtTime(34 + 10 * quake + 4 * Math.sin(t * 7), t, 0.05);
    },
    burst(dur, freq, gain, delay) {
      const ctx = this._ctx(); if (!ctx || !this._vol()) return;
      if (!this.nodes) this._build(ctx);
      const n = this.nodes, t = ctx.currentTime + (delay || 0);
      const s = ctx.createBufferSource(); s.buffer = n.brown;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * this._vol(), t + 0.04); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      s.connect(f); f.connect(g); g.connect(ctx.destination);
      s.start(t, Math.random()); s.stop(t + dur + 0.1);
    },
    alert() { // two-tone warning chirp
      const ctx = this._ctx(); const vol = this._vol(); if (!ctx || !vol) return;
      for (let i = 0; i < 2; i++) {
        const t = ctx.currentTime + i * 0.16;
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = i ? 660 : 880;
        const g = ctx.createGain(); g.gain.value = 0;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 * vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.16);
      }
    },
    thunder(k) { this.burst(2.4, 300, 1.2 * k, 0.25 + Math.random() * 0.6); this.burst(0.35, 1400, 0.4 * k, 0.2); },
    boom() { this.burst(1.6, 90, 2.0, 0); },
  };

  // ================================================================== HUD
  const ICON = {
    wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8h11a3 3 0 10-3-3"/><path d="M3 12h16a3 3 0 11-3 3"/><path d="M3 16h7"/></svg>',
    quake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2-6 3 12 3-9 2 5 2-2h4"/></svg>',
  };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtT(s) { return (Math.round(s * 10) / 10).toString().replace(/\.0$/, '') + ' s'; }
  const Hx = { level: null, built: false, el: {} };
  function hudBuild() {
    const H = BG.Hud;
    if (Hx.built || !H || !H.el || !H.el.level) return Hx.built;
    const scr = H.el.level;
    const banner = document.createElement('div');
    banner.className = 'fx-banner';
    banner.innerHTML = '<span class="fx-ico"></span><div class="fx-txt"><b></b><small></small></div><div class="fx-meter"><i></i></div>';
    scr.appendChild(banner);
    const fc = document.createElement('div');
    fc.className = 'fx-forecast';
    const topbar = scr.querySelector('.topbar');
    const traffic = topbar && topbar.querySelector('[data-ref=traffic]');
    if (traffic && traffic.parentNode) traffic.parentNode.insertBefore(fc, traffic.nextSibling); else scr.appendChild(fc);
    const tlw = document.createElement('div');
    tlw.className = 'fx-timeline';
    tlw.innerHTML = '<div class="fx-track"></div><i class="fx-now"></i>';
    const simbar = H.el.simbar;
    const stat = simbar && simbar.querySelector('[data-ref=simTime]');
    const statBox = stat && stat.parentElement;
    if (statBox && statBox.parentNode) statBox.parentNode.insertBefore(tlw, statBox.nextSibling); else if (simbar) simbar.appendChild(tlw);
    Hx.el = { banner, fc, tlw, track: tlw.querySelector('.fx-track'), now: tlw.querySelector('.fx-now'), bIco: banner.querySelector('.fx-ico'), bT: banner.querySelector('b'), bS: banner.querySelector('small'), bM: banner.querySelector('.fx-meter i') };
    Hx.built = true;
    return true;
  }
  function hudEnter(level) {
    if (!hudBuild()) return;
    Hx.level = level;
    const pl = plan(level);
    const E = Hx.el;
    document.body.classList.toggle('fx-level', !!pl);
    E.banner.classList.remove('show');
    if (!pl) { E.fc.hidden = true; E.tlw.hidden = true; return; }
    E.fc.hidden = false; E.tlw.hidden = false;
    E.fc.innerHTML = '<span class="fx-k">Forecast</span>' + pl.tl.map(e => '<span class="fx-item fx-' + e.type + '" title="' + esc(e.label) + ' from ' + fmtT(e.start) + ' for ' + fmtT(e.end - e.start) + '">' + ICON[e.type] + '<b>' + esc(e.short) + '</b><em>' + fmtT(e.start) + '</em></span>').join('');
    E.fc.title = pl.tl.map(e => e.label + ' at ' + fmtT(e.start)).join(' · ');
    const tl = level.timeLimit || 60;
    E.track.innerHTML = pl.tl.map(e => '<span class="fx-seg fx-' + e.type + '" style="left:' + (clamp(e.start / tl, 0, 1) * 100).toFixed(2) + '%;width:' + (clamp((e.end - e.start) / tl, 0, 1 - e.start / tl) * 100).toFixed(2) + '%" title="' + esc(e.label) + '"></span>').join('');
  }
  function hudTick() {
    if (!Hx.built || !Hx.level) return;
    const G = BG.Game || {}, H = BG.Hud || {};
    const pl = plan(Hx.level);
    const E = Hx.el;
    const sim = G.sim;
    const inSim = (H.mode === 'sim' || H.mode === 'results') && sim && G.level === Hx.level;
    const F = inSim ? sim.forces : null;
    if (!pl) { FxAudio.update(0, 0, 0, false); return; }
    // timeline cursor
    const tl = Hx.level.timeLimit || 60;
    const t = sim ? +sim.time || 0 : 0;
    E.now.style.left = (clamp(t / tl, 0, 1) * 100).toFixed(2) + '%';
    // banner: warning before, live readout during an event
    let show = false, cls = '', title = '', sub = '', meter = 0;
    if (F && H.mode === 'sim') {
      let cur = null, next = null;
      for (const e of pl.tl) { if (t >= e.start && t < e.end) { if (!cur) cur = e; } else if (t < e.start && t >= e.warnAt && !next) next = e; }
      if (cur) {
        show = true; cls = cur.type + ' live';
        if (cur.type === 'wind') { title = cur.label.replace(/\s\d+ m\/s$/, ''); sub = Math.round(F.wind.speed) + ' m/s ' + (F.wind.v < 0 ? '← headwind' : 'tailwind →') + (cur.ev.period ? ' · pulsing' : ' · gusting'); meter = clamp(F.wind.speed / 50, 0, 1); }
        else { title = cur.label; sub = 'Ground shaking · ' + (F.quake.ax || 0).toFixed(2) + ' g'; meter = clamp(F.quake.intensity, 0, 1); }
      } else if (next) {
        show = true; cls = next.type + ' warn';
        title = next.short + ' incoming in ' + Math.max(1, Math.ceil(next.start - t)) + ' s';
        sub = next.label;
        meter = clamp(1 - (next.start - t) / 3, 0, 1);
      }
    }
    if (show) {
      const key = cls + '|' + title + '|' + sub;
      if (E.banner._k !== key) {
        E.banner._k = key;
        E.banner.className = 'fx-banner show fx-' + cls.split(' ').join(' fx-');
        E.bIco.innerHTML = ICON[cls.split(' ')[0]] || '';
        E.bT.textContent = title; E.bS.textContent = sub;
        if (cls.indexOf('warn') >= 0 && E.banner._warned !== title.split(' in ')[0] + Hx.level.id) { E.banner._warned = title.split(' in ')[0] + Hx.level.id; safe(() => FxAudio.alert()); }
      }
      E.bM.style.width = (meter * 100).toFixed(1) + '%';
    } else if (E.banner.classList.contains('show')) { E.banner.classList.remove('show'); E.banner._k = ''; }
    if (!F || t < 0.05) E.banner._warned = '';
    // audio
    const on = !!(F && G.state === 'sim' && !G.paused);
    FxAudio.update(F ? F.wind.v * Math.sqrt(Math.max(0.25, G.speed || 1)) : 0, F && F.quake.active ? F.quake.intensity : 0, F ? F.wind.gust : 0, on);
  }

  const Hud = BG.Hud;
  if (Hud && !Hud._forcesWrapped) {
    Hud._forcesWrapped = true;
    // the hidden bonus chapter (shown in level select once one of its levels is unlocked; see hud.js)
    if (Array.isArray(Hud.CHAPTERS) && !Hud.CHAPTERS.some(c => c.from === 51)) {
      const ch = { n: 7, key: 'forces', from: 51, to: 53, theme: 'tropical', hidden: true };
      Hud.CHAPTERS.push(BG.i18n ? BG.i18n.lazy(ch, { name: 'hud.chapter.forces.name', desc: 'hud.chapter.forces.desc' }) : ch);
    }
    const oEnter = Hud.enterLevel, oUpdate = Hud.update;
    if (oEnter) Hud.enterLevel = function (level) { const r = oEnter.apply(this, arguments); safe(() => hudEnter(level)); return r; };
    if (oUpdate) Hud.update = function () { const r = oUpdate.apply(this, arguments); safe(hudTick); return r; };
  }
  const Game = BG.Game;
  if (Game && Game._onSimEvent && !Game._forcesWrapped) {
    Game._forcesWrapped = true;
    const oEv = Game._onSimEvent;
    Game._onSimEvent = function (ev, sim, withAudio) {
      const r = oEv.apply(this, arguments);
      if (ev && withAudio) {
        if (ev.type === 'wind_start') safe(() => BG.Audio && BG.Audio.play('whoosh'));
        else if (ev.type === 'quake_start') safe(() => FxAudio.boom());
      }
      return r;
    };
  }

  BG.ForcesFx = { plan, audio: FxAudio, hud: { enter: hudEnter, tick: hudTick } };
})(typeof window !== 'undefined' ? window : globalThis);
