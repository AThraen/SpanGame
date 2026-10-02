/* SPAN — BG.Effects
 * Visual-only effects: particles (sparks, splinters, dust, droplets, smoke, embers),
 * water ripple rings, tumbling broken-beam debris, and camera shake.
 * Uses Math.random freely: nothing here feeds back into the deterministic simulation.
 *
 * There is ONE shared effects system: `new BG.Effects()` always returns the same instance
 * (pass {fresh:true} to get an independent one), and every method is also callable statically
 * (BG.Effects.handleEvents(events, sim) etc.) so main.js and the renderer always agree.
 *
 * World units: metres, y up. draw() expects ctx to already carry the world transform
 * (scale(z, -z)); the renderer does this.
 */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const MAX_PARTICLES = 1800;
  const MAX_DEBRIS = 140;
  const G = 9.81;

  const DEBRIS_STYLE = {
    road:            { fill: '#41454d', edge: '#24272c', top: '#c9ccd2', w: 0.42 },
    reinforced_road: { fill: '#3c4350', edge: '#1f242c', top: '#e0b13a', w: 0.48 },
    wood:            { fill: '#b98149', edge: '#6a4122', top: '#e2b37c', w: 0.26 },
    steel:           { fill: '#7f90a3', edge: '#3f4b59', top: '#c3cfdb', w: 0.26 },
    rope:            { fill: '#c9a46a', edge: '#7d6038', top: '#e8cf9c', w: 0.08 },
    cable:           { fill: '#3a3f47', edge: '#1d2026', top: '#a9b1bb', w: 0.09 },
    rail:            { fill: '#6e6860', edge: '#2a2f36', top: '#c3ccd6', w: 0.5 },
    masonry:         { fill: '#b19c7e', edge: '#5a4c3c', top: '#dccbaa', w: 0.7 },
    girder:          { fill: '#4f6178', edge: '#1e2733', top: '#a9b9cc', w: 0.44 }
  };
  const BALLAST = ['#8d877b', '#6f695f', '#a59f92', '#5f594f'];
  const STONE = ['#b9a588', '#a8957a', '#c4b296', '#8f7d64'];

  // ---- soft round sprite cache (tinted radial gradients) ----
  const softCache = {};
  function softSprite(color) {
    let c = softCache[color];
    if (c) return c;
    if (typeof document === 'undefined') return null;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, color);
    gr.addColorStop(0.45, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    // build a transparent version of the colour for the outer stop
    g.fillStyle = gr;
    g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
    // fade the edge properly: redraw with alpha mask
    const m = document.createElement('canvas');
    m.width = m.height = 64;
    const mg = m.getContext('2d');
    const ag = mg.createRadialGradient(32, 32, 0, 32, 32, 32);
    ag.addColorStop(0, 'rgba(0,0,0,1)');
    ag.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    ag.addColorStop(1, 'rgba(0,0,0,0)');
    mg.fillStyle = ag; mg.fillRect(0, 0, 64, 64);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(m, 0, 0);
    softCache[color] = c;
    return c;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  let shared = null;

  function Effects(opts) {
    opts = opts || {};
    if (!(this instanceof Effects)) return new Effects(opts);
    if (shared && !opts.fresh) return shared;
    this.particles = [];
    this.pool = [];
    this.debris = [];
    this.rings = [];
    this.trauma = 0;
    this.shakeTime = 0;
    this.time = 0;
    this.env = { groundY: null, waterY: null, lava: false };
    this._lastUpdateStamp = -1;
    this._creakCooldown = {};
    this.enabled = true;
    if (!opts.fresh) shared = this;
  }

  const P = Effects.prototype;

  // ------------------------------------------------------------ setup
  P.setLevel = function (level, groundFn) {
    const t = (level && level.terrain) || {};
    this.env.waterY = (t.waterY === null || t.waterY === undefined) ? null : t.waterY;
    this.env.lava = !!(level && level.theme === 'volcanic');
    this.env.floorY = t.floorY;
    if (groundFn) this.env.groundY = groundFn;
    else {
      const le = t.leftEdge || 0, re = t.rightEdge || 0;
      this.env.groundY = function (x) { return x <= le ? (t.leftY || 0) : x >= re ? (t.rightY || 0) : (t.floorY !== undefined ? t.floorY : -50); };
    }
    this.clear();
  };
  // the run is over: stop the plume hanging in the air behind the results - every smoke / steam
  // puff fades out over `sec` seconds (real time; particles keep updating in the results view)
  P.fadeSmoke = function (sec) {
    sec = sec > 0 ? sec : 0.6;
    for (const p of this.particles) if (p.kind === 'soft' && (!p.fade || p.fadeLeft > sec)) { p.fade = sec; p.fadeLeft = sec; }
  };
  P.setEnv = function (env) { if (env) Object.assign(this.env, env); };
  P.clear = P.reset = function () {
    for (const p of this.particles) this.pool.push(p);
    this.particles.length = 0;
    this.debris.length = 0;
    this.rings.length = 0;
    this.trauma = 0;
  };

  // ------------------------------------------------------------ particles
  P._spawn = function (o) {
    if (this.particles.length >= MAX_PARTICLES) {
      // recycle the oldest
      const old = this.particles.shift();
      this.pool.push(old);
    }
    const p = this.pool.pop() || {};
    p.kind = o.kind; p.x = o.x; p.y = o.y; p.vx = o.vx || 0; p.vy = o.vy || 0;
    p.life = 0; p.max = o.max || 1; p.size = o.size || 0.1; p.grow = o.grow || 0;
    p.color = o.color || '#ffffff'; p.rot = o.rot || 0; p.vr = o.vr || 0;
    p.drag = o.drag === undefined ? 0.5 : o.drag; p.g = o.g === undefined ? 1 : o.g;
    p.alpha = o.alpha === undefined ? 1 : o.alpha; p.len = o.len || 0; p.wet = !!o.wet;
    p.bounce = o.bounce || 0; p.add = !!o.add;
    p.smoke = !!o.smoke; p.fade = 0; p.fadeLeft = 0;
    this.particles.push(p);
    return p;
  };

  P.sparks = function (x, y, n, power) {
    n = n || 24; power = power || 1;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(3, 13) * power;
      this._spawn({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2,
        max: rand(0.25, 0.8), size: rand(0.03, 0.06), drag: 1.2, g: 0.9, bounce: 0.35, add: true,
        color: Math.random() < 0.5 ? '#ffd36b' : '#ffae3d' });
    }
    // flash
    this._spawn({ kind: 'flash', x, y, max: 0.18, size: 1.4 * power, g: 0, drag: 0, add: true, color: '#fff2c4' });
  };

  P.splinters = function (x, y, n, dir) {
    n = n || 16;
    const cols = ['#c58d52', '#a8703c', '#e0b27a', '#8a5a30'];
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(1.5, 7);
      this._spawn({ kind: 'splinter', x: x + rand(-0.2, 0.2), y: y + rand(-0.1, 0.1),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2.5, max: rand(1.4, 2.6), size: rand(0.04, 0.08),
        len: rand(0.12, 0.42), rot: rand(0, 6.28), vr: rand(-14, 14), drag: 0.6, g: 1, bounce: 0.3,
        color: cols[(Math.random() * cols.length) | 0] });
    }
  };

  P.chunks = function (x, y, n, cols) {
    n = n || 10;
    cols = cols || ['#55595f', '#3f4247', '#6c7077'];
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(1, 6);
      this._spawn({ kind: 'chunk', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2, max: rand(1.5, 2.8),
        size: rand(0.06, 0.16), rot: rand(0, 6.28), vr: rand(-10, 10), drag: 0.3, g: 1, bounce: 0.25,
        color: cols[(Math.random() * cols.length) | 0] });
    }
  };

  P.dust = function (x, y, n, color, spread) {
    n = n || 10; spread = spread || 1;
    color = color || 'rgba(196,178,150,1)';
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.3, 2.2) * spread;
      this._spawn({ kind: 'soft', x: x + rand(-0.3, 0.3), y: y + rand(-0.2, 0.2), vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.6 + 0.4, max: rand(0.9, 2.0), size: rand(0.3, 0.7) * spread, grow: rand(0.6, 1.4),
        drag: 1.6, g: -0.02, alpha: rand(0.35, 0.6), color });
    }
  };

  P.exhaust = function (x, y, vx, intensity) {
    intensity = intensity === undefined ? 1 : intensity;
    this._spawn({ kind: 'soft', x, y, vx: (vx || 0) * 0.2 - rand(0.3, 0.9), vy: rand(0.3, 0.9),
      max: rand(0.9, 1.6), size: rand(0.12, 0.2), grow: rand(0.5, 0.9), drag: 1.2, g: -0.04,
      alpha: 0.28 * intensity, color: 'rgba(150,152,158,1)' });
  };

  // ---- railway (SPEC §9.4) ----
  // one exhaust beat from a steam chimney: a soft billow of white steam with a light-grey smoke
  // core. Each beat is a small cluster of puffs that start tight at the stack, swell quickly as
  // they rise and thin out to nothing, so the plume reads as rolling clouds rather than a dark
  // streak. The puffs leave with part of the train's speed and are braked by the air, so the
  // plume trails back over the train.
  const STEAM_COLORS = ['rgba(252,252,250,1)', 'rgba(240,240,238,1)', 'rgba(226,226,226,1)'];
  const SMOKE_COLORS = ['rgba(196,196,198,1)', 'rgba(176,176,180,1)'];
  P.steamPuff = function (x, y, vx, power, speed) {
    power = clamp(power === undefined ? 1 : power, 0.1, 2);
    const fast = clamp((speed || 0) / 20, 0, 1);
    const big = power > 0.4;
    const n = big ? 3 : 1;
    const lift = Math.sqrt(power);
    for (let k = 0; k < n; k++) {
      const grey = big && k === 0;
      const pal = grey ? SMOKE_COLORS : STEAM_COLORS;
      this._spawn({ kind: 'soft', smoke: true,
        x: x + rand(-0.15, 0.15), y: y + 0.12 + rand(0, 0.2),
        vx: (vx || 0) * rand(0.45, 0.65) + rand(-0.45, 0.45),
        vy: (rand(2.4, 3.8) * lift + 0.4) * (1 - fast * 0.3),
        max: rand(2.2, 3.2) * (big ? 1 : 0.8), size: rand(0.32, 0.46) * (big ? 1 : 0.8),
        grow: rand(1.1, 1.7) * (0.7 + power * 0.35), drag: 1.1 + fast * 0.7, g: -0.03,
        alpha: (grey ? 0.55 : 0.68) * (big ? Math.min(1, 0.6 + power * 0.4) : 0.6),
        color: pal[(Math.random() * pal.length) | 0] });
    }
  };
  // escaping steam from a wrecked engine
  P.steamHiss = function (x, y) {
    this._spawn({ kind: 'soft', x: x + rand(-0.2, 0.2), y, vx: rand(-0.6, 0.6), vy: rand(1.5, 3), max: rand(1.2, 2), size: rand(0.3, 0.45), grow: rand(1.2, 1.8),
      drag: 1.4, g: -0.04, alpha: 0.45, color: 'rgba(240,242,245,1)' });
  };
  // cylinder drain cocks blowing while a steam engine gets going
  P.cylinderSteam = function (x, y, dir) {
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      this._spawn({ kind: 'soft', x, y, vx: s * rand(1.6, 3.2) * (dir || 1), vy: rand(-0.4, 0.4), max: rand(0.5, 0.9), size: rand(0.1, 0.16), grow: rand(1.2, 1.8),
        drag: 3.2, g: -0.05, alpha: 0.6, color: 'rgba(245,247,250,1)' });
    }
  };
  P.dieselExhaust = function (x, y, vx, power) {
    power = clamp(power === undefined ? 1 : power, 0.1, 2);
    const dark = power > 1.1 && Math.random() < 0.5;
    this._spawn({ kind: 'soft', x: x + rand(-0.06, 0.06), y: y + 0.08, vx: (vx || 0) * 0.5 + rand(-0.25, 0.25), vy: rand(1.4, 2.4) * (0.6 + power * 0.4),
      max: rand(1.2, 1.9), size: rand(0.28, 0.36), grow: rand(0.9, 1.3) * (0.7 + power * 0.4), drag: 1.3, g: -0.035,
      alpha: (dark ? 0.34 : 0.2) * Math.min(1.2, 0.5 + power * 0.5), color: dark ? 'rgba(46,48,54,1)' : 'rgba(96,100,110,1)' });
  };
  // blue-white flash where a pantograph touches the contact wire
  P.arc = function (x, y) {
    this._spawn({ kind: 'flash', x, y, max: 0.12, size: 0.7, g: 0, drag: 0, add: true, color: 'rgba(170,205,255,1)' });
    for (let i = 0; i < 4; i++) {
      const a = rand(0, Math.PI * 2), s = rand(1, 4);
      this._spawn({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: rand(0.12, 0.3), size: 0.025, drag: 1.5, g: 0.5, add: true,
        color: Math.random() < 0.5 ? '#cfe4ff' : '#ffffff' });
    }
  };
  // a few sparks thrown back from a braking (or dragging) wheel at rail level
  P.wheelSparks = function (x, y, vx, power) {
    power = power || 1;
    const dir = (vx || 0) >= 0 ? 1 : -1;
    const n = 2 + ((Math.random() * 3 * power) | 0);
    if (Math.random() < 0.3) this._spawn({ kind: 'flash', x, y: y + 0.05, max: 0.1, size: 0.3 * power, g: 0, drag: 0, add: true, color: '#ffd9a0' });
    for (let i = 0; i < n; i++) {
      this._spawn({ kind: 'spark', x: x + rand(-0.05, 0.05), y: y + rand(0, 0.05), vx: (vx || 0) * 0.35 - dir * rand(1.5, 6) * power, vy: rand(0.2, 2.6) * power,
        max: rand(0.25, 0.6), size: rand(0.04, 0.07), drag: 1.3, g: 0.9, bounce: 0.3, add: Math.random() < 0.5,
        color: Math.random() < 0.55 ? '#ffd36b' : '#ff9a3a' });
    }
  };
  // ballast / earth kicked up by a derailed car
  P.derailDust = function (x, y, n, size) {
    n = n || 4; size = size || 1;
    this.dust(x, y, n, 'rgba(150,138,118,1)', size);
    for (let i = 0; i < Math.ceil(n / 2); i++) {
      const a = rand(0.3, Math.PI - 0.3), s = rand(1, 4.5) * size;
      this._spawn({ kind: 'chunk', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: rand(1.0, 2.0), size: rand(0.04, 0.09),
        rot: rand(0, 6.28), vr: rand(-12, 12), drag: 0.4, g: 1, bounce: 0.3, color: BALLAST[(Math.random() * BALLAST.length) | 0] });
    }
  };

  P.ring = function (x, y, size) {
    this.rings.push({ x, y, r: 0.1, max: (0.9 + Math.random() * 0.5) * size * 2.2, life: 0, dur: 1.1 + size * 0.4 });
  };

  P.splash = function (x, y, size) {
    let s = size === undefined ? 1 : +size;
    if (!(s > 0)) s = 1;
    if (s > 20) s = Math.log10(s) / 1.6;        // treat large numbers as mass in kg
    s = clamp(s, 0.25, 3.5);
    const lava = this.env.lava;
    const wy = this.env.waterY !== null && this.env.waterY !== undefined ? this.env.waterY : y;
    const n = Math.round(18 + 26 * s);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 0.18, Math.PI * 0.82), sp = rand(2, 8) * Math.sqrt(s);
      this._spawn({ kind: 'drop', x: x + rand(-0.4, 0.4) * s, y: wy + 0.05, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        max: rand(0.8, 1.6), size: rand(0.05, 0.12) * (0.8 + s * 0.3), drag: 0.25, g: 1, wet: true,
        color: lava ? (Math.random() < 0.5 ? '#ffb347' : '#ff6a1f') : (Math.random() < 0.6 ? '#e8f7ff' : '#9fd8f2'),
        add: lava });
    }
    // column of spray
    for (let i = 0; i < 8 + 6 * s; i++) {
      this._spawn({ kind: 'soft', x: x + rand(-0.6, 0.6) * s, y: wy + rand(0, 0.6), vx: rand(-0.6, 0.6), vy: rand(1.5, 4) * s,
        max: rand(0.6, 1.1), size: rand(0.25, 0.5) * s, grow: 0.8, drag: 2.2, g: 0.35,
        alpha: lava ? 0.5 : 0.55, color: lava ? 'rgba(255,120,40,1)' : 'rgba(235,248,255,1)', add: lava });
    }
    this.ring(x, wy, s);
    const self = this;
    setTimeoutSafe(function () { self.ring(x + rand(-0.3, 0.3), wy, s * 0.7); }, 160);
    setTimeoutSafe(function () { self.ring(x + rand(-0.3, 0.3), wy, s * 0.45); }, 360);
    this.shake(0.12 * s);
  };

  function setTimeoutSafe(fn, ms) { try { setTimeout(fn, ms); } catch (e) { fn(); } }

  // ------------------------------------------------------------ debris
  P.addDebris = function (x1, y1, x2, y2, m, vx, vy) {
    if (this.debris.length >= MAX_DEBRIS) this.debris.shift();
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) return;
    const st = DEBRIS_STYLE[m] || DEBRIS_STYLE.steel;
    this.debris.push({
      x: (x1 + x2) / 2, y: (y1 + y2) / 2, a: Math.atan2(dy, dx), len,
      vx: (vx || 0) + rand(-1.5, 1.5), vy: (vy || 0) + rand(0.5, 2.5), va: rand(-3, 3) / Math.max(0.6, len * 0.5),
      m, st, w: st.w, life: 0, max: 7 + Math.random() * 3, inWater: false, rest: false
    });
  };

  // ------------------------------------------------------------ shake
  P.shake = function (amount) {
    this.trauma = Math.min(1, this.trauma + (amount === undefined ? 0.3 : amount));
  };
  // returns CSS-pixel offsets
  P.getShake = P.shakeOffset = function () {
    const t = this.trauma * this.trauma;
    if (t < 0.0005) return { x: 0, y: 0, angle: 0 };
    const k = this.shakeTime;
    return {
      x: 16 * t * (Math.sin(k * 47.3) * 0.6 + Math.sin(k * 91.7 + 1.3) * 0.4),
      y: 12 * t * (Math.sin(k * 53.1 + 2.1) * 0.6 + Math.sin(k * 83.9 + 0.4) * 0.4),
      angle: 0.012 * t * Math.sin(k * 37.7 + 0.7)
    };
  };

  // ------------------------------------------------------------ sim events
  P.handleEvent = P.onEvent = function (ev, sim) {
    if (!ev || !this.enabled) return;
    switch (ev.type) {
      case 'break': this._onBreak(ev, sim); break;
      case 'splash': this.splash(ev.x, ev.y, ev.size); break;
      case 'vehicle_fall': {
        this.shake(0.35);
        const p = eventPos(ev, sim);
        if (p && this.env.waterY === null) this.dust(p.x, p.y, 18, null, 1.6);
        break;
      }
      case 'derail': {
        const p = eventPos(ev, sim);
        this.shake(0.5);
        if (!p) break;
        this.sparks(p.x, p.y + 0.1, 30, 1.1);
        this.derailDust(p.x, p.y + 0.1, 22, 1.7);
        this.chunks(p.x, p.y + 0.2, 10, BALLAST);
        break;
      }
      case 'creak': {
        const key = ev.beamIndex;
        const now = this.time;
        if (this._creakCooldown[key] && now - this._creakCooldown[key] < 0.4) break;
        this._creakCooldown[key] = now;
        const b = sim && sim.beams && sim.beams[ev.beamIndex];
        if (b && sim.nodes) {
          const A = sim.nodes[b.a], B = sim.nodes[b.b];
          if (A && B) {
            const t = Math.random();
            const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
            if (b.m === 'wood') this.dust(x, y, 2, 'rgba(210,170,110,1)', 0.35);
            else this._spawn({ kind: 'spark', x, y, vx: rand(-2, 2), vy: rand(0, 2), max: 0.25, size: 0.03, drag: 1, g: 1, add: true, color: '#ffd36b' });
          }
        }
        break;
      }
      default: break;
    }
  };
  // world position of a vehicle event: the event's own x/y, else the (derailed) car or the vehicle
  function eventPos(ev, sim) {
    if (Number.isFinite(ev.x) && Number.isFinite(ev.y)) return { x: ev.x, y: ev.y };
    const v = sim && sim.vehicles && sim.vehicles[ev.i];
    if (!v) return null;
    let o = v;
    if (Array.isArray(v.cars) && v.cars.length) o = v.cars[typeof ev.car === 'number' && v.cars[ev.car] ? ev.car : 0];
    if (Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x + ((o.def && o.def.length) || 0) / 2, y: o.y };
    const w = o.wheels && o.wheels[0];
    return w && Number.isFinite(w.x) ? { x: w.x, y: w.y } : null;
  }

  P.handleEvents = P.processEvents = P.onEvents = function (events, sim) {
    if (!events) return;
    for (let i = 0; i < events.length; i++) this.handleEvent(events[i], sim);
  };

  P._onBreak = function (ev, sim) {
    const m = ev.m || 'steel';
    let x = ev.x, y = ev.y;
    let A = null, B = null;
    const b = sim && sim.beams && sim.beams[ev.beamIndex];
    if (b && sim.nodes) { A = sim.nodes[b.a]; B = sim.nodes[b.b]; }
    if (A && B) {
      if (x === undefined) { x = (A.x + B.x) / 2; y = (A.y + B.y) / 2; }
      // the middle 40% of the beam flies off as 2 tumbling pieces; the renderer draws the
      // remaining 30% stubs on each joint.
      const p = (t) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
      const p1 = p(0.3), pm = p(0.5), p2 = p(0.7);
      const tens = (b.force || 0) > 0 ? 1 : -1;
      const nx = -(B.y - A.y), ny = B.x - A.x, nl = Math.hypot(nx, ny) || 1;
      const kick = (m === 'rope' || m === 'cable') ? 0.5 : 1.5;
      this.addDebris(p1.x, p1.y, pm.x, pm.y, m, (nx / nl) * kick * tens - 1, (ny / nl) * kick + 0.5);
      this.addDebris(pm.x, pm.y, p2.x, p2.y, m, -(nx / nl) * kick * tens + 1, -(ny / nl) * kick + 0.8);
    } else if (x !== undefined) {
      this.addDebris(x - 0.8, y, x + 0.8, y, m, 0, 1);
    }
    if (x === undefined) return;
    switch (m) {
      case 'wood':
        this.splinters(x, y, 22); this.dust(x, y, 8, 'rgba(205,170,120,1)', 0.9); this.shake(0.14); break;
      case 'rope':
        this.splinters(x, y, 8); this.shake(0.05); break;
      case 'cable':
        this.sparks(x, y, 26, 0.9); this.shake(0.15); break;
      case 'road':
        this.chunks(x, y, 14); this.dust(x, y, 10, 'rgba(160,160,160,1)', 1); this.sparks(x, y, 8, 0.6); this.shake(0.19); break;
      case 'reinforced_road':
        this.chunks(x, y, 12); this.sparks(x, y, 24, 1); this.dust(x, y, 8, 'rgba(160,160,160,1)', 1); this.shake(0.21); break;
      case 'rail':
        this.chunks(x, y, 16, BALLAST); this.sparks(x, y, 22, 1); this.dust(x, y, 10, 'rgba(150,138,118,1)', 1.1); this.shake(0.22); break;
      case 'masonry':
        this.chunks(x, y, 20, STONE); this.dust(x, y, 16, 'rgba(206,192,166,1)', 1.4); this.shake(0.2); break;
      case 'girder':
        this.sparks(x, y, 44, 1.25); this.chunks(x, y, 6, ['#5d6f86', '#3a4658']); this.shake(0.26); break;
      default:
        this.sparks(x, y, 34, 1.1); this.chunks(x, y, 5, ['#8b9aab', '#5d6a78']); this.shake(0.17); break;
    }
  };

  // ------------------------------------------------------------ update
  P.update = function (dt, env) {
    if (env) this.setEnv(env);
    // de-dupe: renderer and main may both call update() for the same frame
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this._lastUpdateStamp < 3) return;
    this._lastUpdateStamp = now;
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    // camera shake decays in real time even when particle time is frozen (pause) or slowed
    const rdt = env && env.realDt != null ? Math.min(Math.max(env.realDt, 0), 0.05) : dt;
    this.time += dt;
    this.shakeTime += rdt;
    this.trauma = Math.max(0, this.trauma - rdt * 1.25);
    if (dt <= 0) return;
    const wy = this.env.waterY;
    const gfn = this.env.groundY;
    const ps = this.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) { this.pool.push(p); continue; }
      if (p.fade) { p.fadeLeft -= dt; if (p.fadeLeft <= 0) { this.pool.push(p); continue; } }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d - G * p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.grow) p.size += p.grow * dt;
      if (wy !== null && wy !== undefined && p.y < wy && p.g > 0) {
        if (p.wet) { if (Math.random() < 0.3) this.rings.push({ x: p.x, y: wy, r: 0.05, max: 0.5, life: 0, dur: 0.6 }); this.pool.push(p); continue; }
        if (p.kind === 'spark') { this.pool.push(p); continue; }
        p.vx *= 0.9; p.vy *= 0.85; p.g = 0.12; // sink slowly
      }
      if (gfn && p.bounce && p.g > 0) {
        const gy = gfn(p.x);
        if (gy !== null && p.y < gy) {
          p.y = gy; p.vy = -p.vy * p.bounce; p.vx *= 0.6; p.vr *= 0.5;
          if (Math.abs(p.vy) < 0.4) { p.vy = 0; p.g = 0; p.drag = 6; }
        }
      }
      ps[w++] = p;
    }
    ps.length = w;

    // debris
    const ds = this.debris;
    w = 0;
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      d.life += dt;
      if (d.life > d.max) continue;
      if (!d.rest) {
        const drag = d.inWater ? Math.exp(-3 * dt) : Math.exp(-0.08 * dt);
        d.vx *= drag; d.vy = d.vy * drag - G * (d.inWater ? 0.15 : 1) * dt;
        d.va *= d.inWater ? Math.exp(-2 * dt) : 1;
        d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.va * dt;
        if (wy !== null && wy !== undefined && !d.inWater && d.y < wy) {
          d.inWater = true;
          this.splash(d.x, wy, Math.min(1.6, 0.3 + d.len * 0.25));
        }
        if (gfn) {
          const c = Math.cos(d.a) * d.len / 2, s = Math.sin(d.a) * d.len / 2;
          const lowY = d.y - Math.abs(s);
          const gy = Math.max(gfn(d.x - c), gfn(d.x + c), gfn(d.x));
          if (gy !== null && lowY < gy) {
            d.y += gy - lowY;
            if (Math.abs(d.vy) > 2 && !d.inWater) this.dust(d.x, gy, 4, 'rgba(180,160,130,1)', 0.6);
            d.vy = Math.abs(d.vy) * 0.25; d.vx *= 0.55; d.va = d.va * -0.4 + (Math.random() - 0.5);
            // settle flat-ish
            if (Math.abs(d.vy) < 0.6) {
              d.vy = 0; d.va *= 0.3;
              const target = Math.round(d.a / Math.PI) * Math.PI;
              d.a += (target - d.a) * Math.min(1, dt * 6);
              if (Math.abs(d.vx) < 0.2) d.rest = true;
            }
          }
        }
      }
      ds[w++] = d;
    }
    ds.length = w;

    // rings
    const rs = this.rings;
    w = 0;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      r.life += dt;
      if (r.life > r.dur) continue;
      const k = r.life / r.dur;
      r.r = r.max * (1 - Math.pow(1 - k, 2.2));
      rs[w++] = r;
    }
    rs.length = w;
  };

  // ------------------------------------------------------------ draw
  // opts: { pxPerM, layer: 'under'|'over'|undefined, waterY }
  P.draw = function (ctx, opts) {
    opts = opts || {};
    const px = opts.pxPerM || 20; // to keep particle minimum visible size
    const minS = 1.2 / px;
    const wy = this.env.waterY;
    const layer = opts.layer;
    const below = (y) => wy !== null && wy !== undefined && y < wy;
    const pick = (y) => !layer || (layer === 'under' ? below(y) : !below(y));

    // debris first (behind particles)
    for (const d of this.debris) {
      if (!pick(d.y)) continue;
      const fade = d.life > d.max - 1.2 ? Math.max(0, (d.max - d.life) / 1.2) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(d.x, d.y);
      ctx.rotate(d.a);
      const hl = d.len / 2, hw = Math.max(d.w / 2, minS);
      ctx.fillStyle = d.st.edge;
      jaggedRect(ctx, hl + 0.03, hw + 0.03);
      ctx.fill();
      ctx.fillStyle = d.st.fill;
      jaggedRect(ctx, hl, hw);
      ctx.fill();
      ctx.fillStyle = d.st.top;
      ctx.fillRect(-hl * 0.9, hw * 0.35, hl * 1.8, hw * 0.4);
      ctx.restore();
    }

    // particles: normal then additive
    for (let pass = 0; pass < 2; pass++) {
      const add = pass === 1;
      if (add) ctx.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        if (p.add !== add) continue;
        if (!pick(p.y)) continue;
        const k = p.life / p.max;
        let a = p.alpha;
        switch (p.kind) {
          case 'spark': {
            a *= 1 - k;
            const sp = Math.hypot(p.vx, p.vy);
            const l = Math.max(minS * 2, Math.min(0.5, sp * 0.03));
            ctx.globalAlpha = a;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = Math.max(p.size, minS);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - (p.vx / (sp || 1)) * l, p.y - (p.vy / (sp || 1)) * l);
            ctx.stroke();
            break;
          }
          case 'flash': {
            ctx.globalAlpha = (1 - k) * 0.9;
            const s = softSprite(p.color);
            const r = p.size * (0.6 + k);
            if (s) ctx.drawImage(s, p.x - r, p.y - r, r * 2, r * 2);
            break;
          }
          case 'splinter': case 'chunk': {
            a *= k > 0.75 ? (1 - k) / 0.25 : 1;
            ctx.globalAlpha = a;
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            const l = p.kind === 'splinter' ? p.len : p.size;
            const s = Math.max(p.size * (p.kind === 'splinter' ? 0.5 : 1), minS);
            ctx.fillRect(-l / 2, -s / 2, Math.max(l, minS), s);
            ctx.restore();
            break;
          }
          case 'drop': {
            a *= 1 - k * 0.5;
            ctx.globalAlpha = a;
            ctx.fillStyle = p.color;
            const r = Math.max(p.size, minS);
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, r, r * 1.25, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          default: { // soft
            // smoke: quick fade-in, then thins out as it swells (ease-out so big puffs vanish softly)
            if (p.smoke) a *= (k < 0.08 ? k / 0.08 : 1) * Math.pow(1 - k, 1.5);
            else a *= (k < 0.15 ? k / 0.15 : 1) * (1 - k);
            if (p.fade) a *= clamp(p.fadeLeft / p.fade, 0, 1);
            ctx.globalAlpha = a;
            const s = softSprite(p.color);
            const r = p.size;
            if (s) ctx.drawImage(s, p.x - r, p.y - r, r * 2, r * 2);
          }
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  };

  // water-surface rings (draw after the water)
  P.drawSurface = P.drawRings = function (ctx, opts) {
    if (!this.rings.length) return;
    const px = (opts && opts.pxPerM) || 20;
    ctx.save();
    ctx.lineWidth = 1.6 / px;
    for (const r of this.rings) {
      const k = r.life / r.dur;
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.strokeStyle = this.env.lava ? '#ffcf7a' : '#f2fbff';
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, Math.max(r.r, 0.01), Math.max(r.r * 0.22, 0.01), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  P.count = function () { return this.particles.length + this.debris.length + this.rings.length; };

  function jaggedRect(ctx, hl, hw) {
    ctx.beginPath();
    ctx.moveTo(-hl, -hw);
    ctx.lineTo(hl * 0.92, -hw);
    ctx.lineTo(hl, -hw * 0.3);
    ctx.lineTo(hl * 0.94, hw * 0.2);
    ctx.lineTo(hl, hw);
    ctx.lineTo(-hl * 0.95, hw);
    ctx.lineTo(-hl, hw * 0.25);
    ctx.lineTo(-hl * 0.93, -hw * 0.3);
    ctx.closePath();
  }

  // ---- static facade: BG.Effects.method(...) acts on the shared instance ----
  Effects.shared = function () { return shared || new Effects(); };
  ['setLevel', 'setEnv', 'clear', 'reset', 'sparks', 'splinters', 'chunks', 'dust', 'exhaust', 'ring', 'splash',
    'steamPuff', 'fadeSmoke', 'steamHiss', 'cylinderSteam', 'dieselExhaust', 'arc', 'wheelSparks', 'derailDust',
    'addDebris', 'shake', 'getShake', 'shakeOffset', 'handleEvent', 'onEvent', 'handleEvents', 'processEvents',
    'onEvents', 'update', 'draw', 'drawSurface', 'drawRings', 'count'].forEach(function (k) {
    Effects[k] = function () { const s = Effects.shared(); return s[k].apply(s, arguments); };
  });
  Effects.DEBRIS_STYLE = DEBRIS_STYLE;

  BG.Effects = Effects;
})(typeof window !== 'undefined' ? window : globalThis);
