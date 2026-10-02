/* SPAN — Forces of Nature: wind and earthquake events (BG.Forces).
 *
 * Optional level field  events: [
 *   { type: 'wind',  start, duration, speed (m/s), gust (0..1), dir: +1|-1, period? (s), lift?, rain? },
 *   { type: 'quake', start, duration, magnitude (~5..9), freq (Hz), vertical?, waveSpeed? (m/s), pga? (g) },
 * ]
 * Plugs into BG.Simulation through the BG.SimHooks registry (see physics.js): a level without
 * `events` gets no extension at all, so its simulation is bit-identical to the engine without this file.
 *
 * Physics (deterministic: seeded PRNG, own sine, fixed iteration order):
 *  - WIND is a crosswind with an in-plane component `dir` (+1 blows toward +x).
 *      drag on every member, per axis, from the projected length normal to that axis:
 *        Fx = ½ρ·Cd·D·|Ly|·rx|rx|      rx = Vw − vx (relative air speed, so drag also damps sway)
 *        Fy = ½ρ·Cd·Dv·|Lx|·ry|ry|     ry = −vy
 *      D = exposed depth (deck girders and cables catch more than their drawn width), Dv = deck chord B for
 *      decks. Decks (road / rail) also get aerodynamic LIFT from the crosswind over their chord:
 *        Fy += ½ρ·V²·B·|Lx|·CL·g(t)
 *      g(t) is the gust signal: sin(2πt/period) when `period` is given ([from, to] sweeps the rhythm; vortex shedding locked to a
 *      frequency — a slender, unstiffened deck whose natural frequency is near 1/period resonates and tears
 *      itself apart, Tacoma Narrows style), else smooth seeded turbulence. Gusts also modulate the speed:
 *      Vw = dir·speed·env(t)·(1 + gust·g(t)). Vehicles get frontal-area drag along x (head / tail wind).
 *  - QUAKE moves the ground: every fixed joint (anchors, pier tops) follows a seeded displacement time
 *    series d(t − x/c) (a few incommensurate sines near `freq`, smooth envelope, peak ground acceleration
 *    from `magnitude`), so the far bank lags the near one by span / waveSpeed. The terrain collider (banks,
 *    walls, valley floor) moves with it, so joints and vehicles resting on the ground feel the shaking.
 *    The bridge feels it through inertia, exactly like a real structure.
 *
 * Public API:
 *   BG.Forces.normalize(events)        -> defaulted copies, sorted by start
 *   BG.Forces.timeline(level|events)   -> [{type, start, end, label, short, warnAt, ev}] for HUD / audio
 *   BG.Forces.attach(sim, events)      -> controller (adds events to a sim built without them, e.g. a
 *                                          famous-bridges scenario); returns null for an empty list
 *   BG.Forces.presets.gale(o) / storm(o) / tacoma(o) / quake(o)   -> event objects
 *   BG.Forces.windSpeed(ev, t, seed)   -> signed wind speed (m/s) of one wind event at time t
 *   BG.Forces.groundOffset(ev, x, t, seed) -> {dx, dy} ground displacement of one quake event
 *   BG.Forces.label(ev)                -> 'Gale 19 m/s' / 'Earthquake M7.0'
 *   BG.Forces.AERO                     -> per-material aerodynamic coefficients (tunable)
 * Live state on a sim with events: sim.forces = {time, wind:{v, speed, active, gust, event}, quake:{dx, dy,
 *   intensity, active, event}, list} and sim events {type:'wind_start'|'wind_end'|'quake_start'|'quake_end', ...}.
 */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const RHO = 1.225;        // kg/m^3 air density
  const G = 9.81;
  const TWO_PI = 6.283185307179586, PI = 3.141592653589793, HALF_PI = 1.5707963267948966;
  const WIND_RAMP = 1.5;    // s ramp in / out of a wind event
  const VEH_CD = 0.9;       // vehicle drag coefficient (in-plane: frontal area)
  const VEH_WIDTH = 2.5;    // m: frontal area = height x width (the side faces the out-of-plane crosswind)

  /** aerodynamic coefficients per material: cd (drag coefficient), depth (exposed depth, m; default =
   *  material width), deck: chord B (m) for lift + vertical drag, cl: lift scale. Unknown deck materials
   *  (isRoad / isRail) fall back to DECK. */
  const AERO = {
    road: { cd: 1.5, depth: 1.4, chord: 9, cl: 1 },
    reinforced_road: { cd: 1.5, depth: 1.6, chord: 9, cl: 1 },
    rail: { cd: 1.5, depth: 1.8, chord: 6, cl: 1 },
    wood: { cd: 1.2, depth: 0.45 },
    steel: { cd: 1.6, depth: 0.5 },
    rope: { cd: 1.2, depth: 0.35 },
    cable: { cd: 1.2, depth: 0.6 },
    masonry: { cd: 1.3, depth: 1.0 },
  };
  const DECK = { cd: 1.5, depth: 1.4, chord: 9, cl: 1 };
  const OTHER = { cd: 1.3, depth: 0 };

  // ------------------------------------------------------------------ deterministic helpers
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function mulberry32(a) {
    a = (a >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** sine from basic IEEE ops only (bit-identical on every JS engine, unlike Math.sin) */
  function sinDet(x) {
    x = x - Math.round(x / TWO_PI) * TWO_PI;          // [-pi, pi]
    if (x > HALF_PI) x = PI - x; else if (x < -HALF_PI) x = -PI - x; // [-pi/2, pi/2]
    const x2 = x * x;
    return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156 * (1 - x2 / 210 * (1 - x2 / 272))))))));
  }

  // ------------------------------------------------------------------ event normalisation
  function normalizeOne(e, i) {
    if (!e || typeof e !== 'object') return null;
    const type = e.type === 'earthquake' ? 'quake' : e.type;
    const base = { type, index: i, start: Math.max(0, num(e.start, 0)), duration: Math.max(0.1, num(e.duration, 8)) };
    if (type === 'wind') {
      // period: seconds per gust cycle, or [from, to] for a gust rhythm that drifts over the event (a
      // band of frequencies, so a deck resonates whatever its exact natural period inside the band)
      let period = null;
      if (Array.isArray(e.period) && num(e.period[0], 0) > 0 && num(e.period[1], 0) > 0) period = [e.period[0], e.period[1]];
      else if (num(e.period, 0) > 0) period = e.period;
      return Object.assign(base, {
        speed: Math.max(0, num(e.speed, 20)), gust: clamp(num(e.gust, 0), 0, 1.5),
        dir: num(e.dir, 1) < 0 ? -1 : 1, period,
        lift: Math.max(0, num(e.lift, period ? 0.3 : 0.5)),
        rain: !!e.rain, label: typeof e.label === 'string' ? e.label : null,
      });
    }
    if (type === 'quake') {
      const mag = num(e.magnitude, 6.5);
      // peak ground acceleration (g): explicit `pga`, else ~doubles per magnitude step (M6 = 0.1 g, M7 = 0.2 g, M8 = 0.4 g)
      const pga = num(e.pga, 0) > 0 ? e.pga : clamp(0.1 * Math.pow(2, mag - 6), 0.01, 1.2);
      return Object.assign(base, {
        magnitude: mag, pga, freq: clamp(num(e.freq, 1.5), 0.2, 8),
        vertical: clamp(num(e.vertical, 0.5), 0, 1.5), waveSpeed: Math.max(20, num(e.waveSpeed, 300)),
        label: typeof e.label === 'string' ? e.label : null,
      });
    }
    return null;
  }
  function normalize(events) {
    if (!Array.isArray(events)) return [];
    const out = [];
    for (let i = 0; i < events.length; i++) { const n = normalizeOne(events[i], i); if (n) out.push(n); }
    out.sort((a, b) => a.start - b.start || a.index - b.index);
    return out;
  }

  const BEAUFORT = [[10.8, 'Breeze'], [13.9, 'Strong breeze'], [17.2, 'Near gale'], [20.8, 'Gale'], [24.5, 'Strong gale'],
    [28.5, 'Storm'], [32.7, 'Violent storm'], [Infinity, 'Hurricane']];
  function windName(speed) { for (const [lim, n] of BEAUFORT) if (speed < lim) return n; return 'Hurricane'; }
  function label(ev) {
    if (!ev) return '';
    if (ev.label) return ev.label;
    if (ev.type === 'wind') return (ev.period ? 'Resonant ' + windName(ev.speed).toLowerCase() : windName(ev.speed)) + ' ' + Math.round(ev.speed) + ' m/s';
    if (ev.type === 'quake') return 'Earthquake M' + ev.magnitude.toFixed(1);
    return ev.type;
  }
  function shortLabel(ev) {
    if (ev.type === 'wind') return (ev.period ? 'Resonant ' : '') + windName(ev.speed).replace('Violent storm', 'Storm');
    if (ev.type === 'quake') return 'Earthquake';
    return ev.type;
  }
  /** schedule for HUD / audio: [{type, start, end, label, short, warnAt, ev}] */
  function timeline(levelOrEvents) {
    const evs = normalize(Array.isArray(levelOrEvents) ? levelOrEvents : levelOrEvents && levelOrEvents.events);
    return evs.map(ev => ({ type: ev.type, start: ev.start, end: ev.start + ev.duration, label: label(ev), short: shortLabel(ev), warnAt: Math.max(0, ev.start - 3), ev }));
  }

  // ------------------------------------------------------------------ signals
  /** per-event signal parameters (seeded, so the same level + seed always shakes the same way) */
  function prepare(ev, seed) {
    const rng = mulberry32((seed | 0) * 2654435761 + (ev.index + 1) * 40503 + (ev.type === 'quake' ? 977 : 131));
    if (ev.type === 'wind') {
      // turbulence: three incommensurate slow sines (0.08..0.6 Hz), normalised to [-1, 1]
      const comps = [];
      for (let k = 0; k < 3; k++) comps.push({ w: TWO_PI * (0.08 + 0.18 * k + 0.12 * rng()), p: TWO_PI * rng(), a: 1 / (1 + k * 0.6) });
      let s = 0; for (const c of comps) s += c.a;
      for (const c of comps) c.a /= s;
      const p0 = Array.isArray(ev.period) ? ev.period[0] : ev.period, p1 = Array.isArray(ev.period) ? ev.period[1] : ev.period;
      // phase(u) = w0·u + ½·(w1 − w0)/duration·u²  (linear frequency sweep from 1/p0 to 1/p1)
      ev._sig = { comps, w: p0 ? TWO_PI / p0 : 0, dw: p0 ? (TWO_PI / p1 - TWO_PI / p0) / ev.duration : 0, uc: Math.max(4, ev.speed) };
    } else if (ev.type === 'quake') {
      const mk = (f0, scale) => {
        const comps = [];
        const ratios = [0.62, 1.0, 1.47, 2.1];
        for (let k = 0; k < ratios.length; k++) {
          const f = f0 * ratios[k] * (0.93 + 0.14 * rng());
          comps.push({ w: TWO_PI * f, p: TWO_PI * rng(), a: [0.7, 1.0, 0.65, 0.35][k] });
        }
        // acceleration amplitude of each sine so the summed peak ~ PGA (incoherent sum: ~0.6 of the plain sum)
        let s = 0; for (const c of comps) s += c.a;
        const accPeak = ev.pga * G * scale;
        for (const c of comps) { c.acc = accPeak * c.a / (s * 0.6); c.d = c.acc / (c.w * c.w); }
        return comps;
      };
      ev._sig = { h: mk(ev.freq, 1), v: mk(ev.freq * 1.6, ev.vertical) };
    }
    return ev;
  }
  function windEnv(ev, t) {
    const u = t - ev.start;
    if (u <= 0 || u >= ev.duration) return 0;
    const r = Math.min(WIND_RAMP, ev.duration / 3);
    return smooth(u / r) * smooth((ev.duration - u) / r);
  }
  /** gust signal in [-1, 1] at time t and position x: gusts are carried downwind (frozen turbulence),
   *  so a periodic gust rolls along the deck as a travelling wave and excites both its symmetric and its
   *  antisymmetric (S-shaped) modes. x0 = where the phase is referenced (the left bank). */
  function windGust(ev, t, x, x0) {
    const sg = ev._sig;
    const tau = t - ev.dir * ((x || 0) - (x0 || 0)) / sg.uc;
    if (sg.w) { const u = tau - ev.start; return sinDet(u * (sg.w + 0.5 * sg.dw * u)); }
    let g = 0; for (const c of sg.comps) g += c.a * sinDet(c.w * tau + c.p);
    return g;
  }
  function quakeEnv(ev, u) {
    if (u <= 0 || u >= ev.duration) return 0;
    const rise = Math.min(1.5, ev.duration * 0.2), fall = ev.duration * 0.45;
    return smooth(u / rise) * smooth((ev.duration - u) / fall);
  }
  function sumSines(comps, u) { let d = 0; for (const c of comps) d += c.d * sinDet(c.w * u + c.p); return d; }

  /** signed wind speed (m/s) of one (normalized) wind event at time t (at position x, phase referenced at x0) */
  function windSpeed(ev, t, seed, x, x0) {
    if (!ev._sig) prepare(ev, seed == null ? 1 : seed);
    const e = windEnv(ev, t);
    if (e === 0) return 0;
    return ev.dir * ev.speed * e * Math.max(0, 1 + ev.gust * windGust(ev, t, x, x0));
  }
  /** ground displacement {dx, dy} of one (normalized) quake event at position x, time t */
  function groundOffset(ev, x, t, seed, x0) {
    if (!ev._sig) prepare(ev, seed == null ? 1 : seed);
    const u = t - ev.start - (x - (x0 || 0)) / ev.waveSpeed;
    const e = quakeEnv(ev, u);
    if (e === 0) return { dx: 0, dy: 0 };
    return { dx: e * sumSines(ev._sig.h, u), dy: e * sumSines(ev._sig.v, u) };
  }

  // ------------------------------------------------------------------ simulation controller
  function Controller(sim, events) {
    this.sim = sim;
    const seed = num(sim.seed, 1);
    this.list = normalize(events).map(ev => prepare(ev, seed));
    this.winds = this.list.filter(e => e.type === 'wind');
    this.quakes = this.list.filter(e => e.type === 'quake');
    this.seed = seed;
    // fixed joints (anchors + pier tops) and their rest positions
    const fixed = [];
    for (let i = 0; i < sim.nNodes; i++) if (sim.w[i] === 0) fixed.push(i);
    this.fixed = Int32Array.from(fixed);
    this.fx0 = Float64Array.from(fixed.map(i => sim.px[i]));
    this.fy0 = Float64Array.from(fixed.map(i => sim.py[i]));
    const t = sim.terrain;
    this.t0 = { leftEdge: t.leftEdge, leftY: t.leftY, rightEdge: t.rightEdge, rightY: t.rightY, floorY: t.floorY };
    this.x0 = t.leftEdge; // the wave arrives at the left bank first
    this.g0 = (sim.ground || []).map(g => ({ ax: g.ax, ay: g.ay, bx: g.bx, by: g.by }));
    this.piers0 = (sim.piers || []).map(p => ({ x: p.x, baseY: p.baseY, topY: p.topY }));
    // per-beam aero coefficients (filled lazily, fragments inherit their parent's material)
    this._aero = [];
    this._t = 0;
    this.wind = 0; this.windGustNow = 0;
    this.quake = { dx: 0, dy: 0 };
    this._state = this.list.map(() => 0); // 0 pending, 1 active, 2 over
    this._qPeak = 0;
    sim.forces = { time: 0, list: this.list, wind: { v: 0, speed: 0, gust: 0, active: false, event: null }, quake: { dx: 0, dy: 0, intensity: 0, active: false, event: null, ax: 0 } };
  }
  const C = Controller.prototype;

  C._aeroOf = function (j) {
    let a = this._aero[j];
    if (a) return a;
    const sim = this.sim, b = sim.beams[j];
    const mat = (b && b.material) || {};
    const isDeck = !!(mat.isRoad || mat.isRail);
    const k = AERO[mat.id] || (isDeck ? DECK : OTHER);
    const D = k.depth > 0 ? k.depth : Math.max(0.1, num(mat.width, 0.3));
    const chord = isDeck ? num(k.chord, DECK.chord) : 0;
    a = this._aero[j] = { kx: 0.5 * RHO * k.cd * D, ky: 0.5 * RHO * k.cd * (isDeck ? chord : D), lift: isDeck ? 0.5 * RHO * chord * num(k.cl, 1) : 0 };
    return a;
  };

  C.beginStep = function (sim) {
    const t = sim.time;
    for (let i = 0; i < this.list.length; i++) {
      const ev = this.list[i];
      const st = this._state[i];
      const end = ev.start + ev.duration + (ev.type === 'quake' ? (sim.terrain.rightEdge - sim.terrain.leftEdge) / ev.waveSpeed : 0);
      if (st === 0 && t >= ev.start) {
        this._state[i] = 1;
        sim.events.push(ev.type === 'wind'
          ? { type: 'wind_start', index: ev.index, speed: ev.speed, dir: ev.dir, label: label(ev) }
          : { type: 'quake_start', index: ev.index, magnitude: ev.magnitude, label: label(ev) });
      } else if (st === 1 && t >= end) {
        this._state[i] = 2;
        sim.events.push({ type: ev.type + '_end', index: ev.index });
      }
    }
    // a deck bucking in an earthquake can toss traffic briefly into the air: that is not a ramp jump,
    // so the 'vehicle_jumped' airborne timer is held at zero while the ground shakes (and 1 s after)
    let shaking = false;
    for (const ev of this.quakes) if (t >= ev.start && t < ev.start + ev.duration + (sim.terrain.rightEdge - sim.terrain.leftEdge) / ev.waveSpeed + 1) shaking = true;
    if (shaking) for (const v of sim.vehicles) v._airT = 0;
  };

  C.substep = function (sim, h, s) {
    const t = sim.time + s * h;
    if (this.quakes.length) this._ground(sim, t);
    if (this.winds.length) this._wind(sim, t, h, s);
  };

  /** active winds at time t -> this._act [{ev, sp}] (sp = enveloped mean speed); returns the count */
  C._activeWinds = function (t) {
    const act = this._act || (this._act = []);
    act.length = 0;
    for (const ev of this.winds) {
      const e = windEnv(ev, t);
      if (e > 0) act.push({ ev, sp: ev.speed * e });
    }
    return act.length;
  };
  /** wind at (t, x): sets this.wind (signed speed), this.windLift (sp^2 * lift * gust, per unit
   *  0.5·rho·chord) and this.windGustNow (|gust|) */
  C._windAt = function (t, x) {
    let v = 0, lift = 0, gmax = 0;
    const act = this._act, x0 = this.x0;
    for (let i = 0; i < act.length; i++) {
      const ev = act[i].ev, sp = act[i].sp;
      const g = windGust(ev, t, x, x0);
      v += ev.dir * sp * Math.max(0, 1 + ev.gust * g);
      // lift ~ mean dynamic pressure x lift coefficient x gust signal (sign: alternating up / down)
      lift += sp * sp * ev.lift * g;
      if (Math.abs(g) > gmax) gmax = Math.abs(g);
    }
    this.wind = v; this.windLift = lift; this.windGustNow = gmax;
    return v;
  };

  /** the gust field changes slowly (periods >= ~1 s): sample wind speed + lift at every member's midpoint
   *  once per 1/60 s step (at mid-step time); drag from the relative velocity is still applied every substep */
  C._sampleField = function (sim, t) {
    const n = sim.nBeams;
    if (!this._fv || this._fv.length < sim._capB) { this._fv = new Float64Array(sim._capB); this._fl = new Float64Array(sim._capB); }
    const px = sim.px, ba = sim.ba, bb = sim.bb, active = sim.active, fv = this._fv, fl = this._fl;
    for (let j = 0; j < n; j++) {
      if (!active[j]) continue;
      fv[j] = this._windAt(t, 0.5 * (px[ba[j]] + px[bb[j]]));
      fl[j] = this.windLift;
    }
    this._fn = n;
  };

  C._wind = function (sim, t, h, s) {
    if (!s) { if (!this._activeWinds(sim.time + 0.5 / 60)) { this._fn = -1; return; } this._sampleField(sim, sim.time + 0.5 / 60); }
    if (this._fn < 0) return;
    const px = sim.px, py = sim.py, vx = sim.vx, vy = sim.vy, w = sim.w;
    const ba = sim.ba, bb = sim.bb, active = sim.active;
    const nb = sim.nBeams, fv = this._fv, fl = this._fl, fn = this._fn;
    for (let j = 0; j < nb; j++) {
      if (!active[j]) continue;
      const a = ba[j], b = bb[j];
      const wa = w[a], wb = w[b];
      if (wa === 0 && wb === 0) continue;
      const jj = j < fn ? j : sim.beams[j].parent; // a fragment born this step uses its parent's sample
      const k = this._aeroOf(sim.beams[j].fragment ? sim.beams[j].parent : j);
      const Vw = fv[jj], lift = fl[jj];
      const lx = Math.abs(px[b] - px[a]), ly = Math.abs(py[b] - py[a]);
      const rx = Vw - 0.5 * (vx[a] + vx[b]);
      const ry = -0.5 * (vy[a] + vy[b]);
      const fx = k.kx * ly * rx * Math.abs(rx);
      let fy = k.ky * lx * ry * Math.abs(ry);
      if (k.lift !== 0) fy += k.lift * lx * lift;
      // half the force on each end (a fixed end passes its half into the ground)
      const ix = 0.5 * fx * h, iy = 0.5 * fy * h;
      if (wa !== 0) { vx[a] += wa * ix; vy[a] += wa * iy; }
      if (wb !== 0) { vx[b] += wb * ix; vy[b] += wb * iy; }
    }
    // vehicles: frontal-area drag along x (head / tail wind)
    for (const v of sim.vehicles) {
      if (!v._sim || !v.def || !(v._invM > 0)) continue; // (road vehicles; other kinds, e.g. trains, opt in by the same fields)
      const rx = this._windAt(sim.time + 0.5 / 60, v._px) - v._vx;
      const A = VEH_WIDTH * v.def.height;
      v._vx += 0.5 * RHO * VEH_CD * A * rx * Math.abs(rx) * v._invM * h;
    }
  };

  C._ground = function (sim, t) {
    let dxL = 0, dyL = 0, dxR = 0, dyR = 0, dxF = 0, dyF = 0;
    const t0 = this.t0, x0 = this.x0, seed = this.seed;
    const fx = this.fixed, px = sim.px, py = sim.py;
    const xm = 0.5 * (t0.leftEdge + t0.rightEdge);
    for (let k = 0; k < fx.length; k++) { px[fx[k]] = this.fx0[k]; py[fx[k]] = this.fy0[k]; }
    let any = false;
    for (const ev of this.quakes) {
      if (t <= ev.start || t >= ev.start + ev.duration + (t0.rightEdge - x0) / ev.waveSpeed) continue;
      any = true;
      for (let k = 0; k < fx.length; k++) {
        const o = groundOffset(ev, this.fx0[k], t, seed, x0);
        px[fx[k]] += o.dx; py[fx[k]] += o.dy;
      }
      let o = groundOffset(ev, t0.leftEdge, t, seed, x0); dxL += o.dx; dyL += o.dy;
      o = groundOffset(ev, t0.rightEdge, t, seed, x0); dxR += o.dx; dyR += o.dy;
      o = groundOffset(ev, xm, t, seed, x0); dxF += o.dx; dyF += o.dy;
    }
    const T = sim.terrain;
    T.leftEdge = t0.leftEdge + dxL; T.leftY = t0.leftY + dyL;
    T.rightEdge = t0.rightEdge + dxR; T.rightY = t0.rightY + dyR;
    T.floorY = t0.floorY + dyF;
    const g = sim.ground, g0 = this.g0;
    if (g && g.length === 5 && g0.length === 5) {
      // [left top, left wall, floor, right wall, right top] (see Simulation._buildGround)
      const sh = (i, ax, ay, bx, by) => { g[i].ax = g0[i].ax + ax; g[i].ay = g0[i].ay + ay; g[i].bx = g0[i].bx + bx; g[i].by = g0[i].by + by; };
      sh(0, dxL, dyL, dxL, dyL);
      sh(1, dxL, dyL, dxL, dyF);
      sh(2, dxL, dyF, dxR, dyF);
      sh(3, dxR, dyF, dxR, dyR);
      sh(4, dxR, dyR, dxR, dyR);
    }
    this.quake = { dx: dxL, dy: dyL, any };
  };

  C.endStep = function (sim) {
    const F = sim.forces;
    F.time = sim.time;
    // wind (sampled at the end of the step for display)
    if (this.winds.length) {
      this._activeWinds(sim.time);
      const v = this._windAt(sim.time, 0.5 * (this.t0.leftEdge + this.t0.rightEdge));
      let ev = null;
      for (const e of this.winds) if (windEnv(e, sim.time) > 0) { ev = e; break; }
      F.wind.v = v; F.wind.speed = Math.abs(v); F.wind.gust = this.windGustNow; F.wind.active = !!ev; F.wind.event = ev;
    }
    if (this.quakes.length) {
      // ground motion at the left bank + a 0..1 intensity for camera rumble / audio
      let ev = null, inten = 0, ax = 0;
      for (const e of this.quakes) {
        const u = sim.time - e.start;
        const en = quakeEnv(e, u) || quakeEnv(e, u - (this.t0.rightEdge - this.t0.leftEdge) / e.waveSpeed);
        if (en > 0) { ev = ev || e; inten = Math.max(inten, en * clamp(e.pga / 0.4, 0.15, 1)); ax = Math.max(ax, en * e.pga); }
      }
      F.quake.dx = this.quake.dx; F.quake.dy = this.quake.dy;
      F.quake.intensity = inten; F.quake.active = !!ev; F.quake.event = ev; F.quake.ax = ax;
      // piers ride on the ground
      const ps = sim.piers || [];
      for (let i = 0; i < ps.length && i < this.piers0.length; i++) {
        const p0 = this.piers0[i];
        let dx = 0, dy = 0;
        for (const e of this.quakes) { const o = groundOffset(e, p0.x, sim.time, this.seed, this.x0); dx += o.dx; dy += o.dy; }
        ps[i].x = p0.x + dx; ps[i].baseY = p0.baseY + dy; ps[i].topY = p0.topY + dy;
      }
    }
  };

  /** add events to an existing simulation (call right after construction, before the first step) */
  function attach(sim, events) {
    const list = normalize(events);
    if (!sim || !list.length) return null;
    const c = new Controller(sim, events);
    (sim._ext || (sim._ext = [])).push(c);
    return c;
  }

  // registry consumed by BG.Simulation's constructor: (sim) => extension | null
  (BG.SimHooks = BG.SimHooks || []).push(function (sim) {
    const evs = sim.level && sim.level.events;
    if (!Array.isArray(evs) || !evs.length || !normalize(evs).length) return null;
    return new Controller(sim, evs);
  });

  const presets = {
    /** steady gale with turbulence */
    gale(o) { return Object.assign({ type: 'wind', start: 6, duration: 14, speed: 20, gust: 0.35, dir: 1 }, o || {}); },
    storm(o) { return Object.assign({ type: 'wind', start: 5, duration: 18, speed: 30, gust: 0.4, dir: 1, rain: true }, o || {}); },
    /** Tacoma Narrows (1940): a moderate ~19 m/s wind whose vortex shedding locks onto the deck's natural
     *  frequency. `period` should match the deck's first vertical mode (seconds per cycle). */
    tacoma(o) { return Object.assign({ type: 'wind', start: 4, duration: 30, speed: 19, gust: 0.15, dir: 1, period: 2.0, lift: 0.35, label: 'Tacoma wind 19 m/s' }, o || {}); },
    quake(o) { return Object.assign({ type: 'quake', start: 8, duration: 10, magnitude: 7, freq: 1.5 }, o || {}); },
  };

  BG.Forces = {
    AIR_DENSITY: RHO, AERO, DECK,
    normalize, timeline, label, shortLabel, windName, attach, presets, windSpeed, groundOffset, sinDet,
    Controller,
  };
})(typeof window !== 'undefined' ? window : globalThis);
