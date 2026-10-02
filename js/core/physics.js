/* SPAN — simulation core (BG.Simulation).
 *
 * XPBD with substepping ("small steps", one Gauss–Seidel pass per substep):
 *   - joints are particles (mass = half of every attached beam + a small joint mass),
 *   - beams are distance constraints with compliance L/EA; the Lagrange multiplier of
 *     each substep gives the axial force (tension +) -> stress = force / limit,
 *   - tension-only materials (rope, cable) are skipped when compressed (slack),
 *   - vehicles are rigid bodies (XPBD generalized inverse mass) with compliant tyres.
 *     Wheel-vs-road-segment contacts push the vehicle up and the segment's two end
 *     joints down (barycentric weight x inverse mass), so vehicle weight loads the bridge.
 *     A motor drives toward target speed with friction-limited traction whose reaction
 *     also acts on the deck joints.
 *   - beams snap when the (8 ms low-pass filtered) |stress| exceeds 1; a snapped beam
 *     becomes two dangling fragments so collapses look dramatic but stay stable.
 *   - road decks additionally resist bending at joints between consecutive road
 *     segments (XPBD angle constraints); |moment|/momentLimit adds to the stress ratio.
 * Public API (SPEC 4.6):
 *   const sim = new BG.Simulation(level, design, { seed: 1, substeps: 30 });
 *   sim.step()                 advance exactly 1/60 s (sim.substeps XPBD substeps)
 *   sim.time, sim.status ('running'|'success'|'failed'), sim.failReason ('vehicle_fell'|'timeout'|null)
 *   sim.nodes   [{id, x, y, fixed, debris?}]           live positions (debris = fragment tips)
 *   sim.beams   [{a, b, m, material, restLength, force, stress, peak, broken,
 *                 bend?, invalid?, fragmented?, fragment?, parent?}]
 *                 indices 0..design.beams.length-1 match design.beams; snapped beams get
 *                 broken=true + fragmented=true and two extra entries (fragment=true,
 *                 parent=i) appended for the dangling halves. stress = signed ratio,
 *                 |stress| >= 1 breaks (road: axial ratio + bending ratio 'bend').
 *   sim.piers   [{x, baseY, topY}]
 *   sim.vehicles [{type, def, state, index, x, y, angle, vx, wheels:[{x, y, r, rot}]}]
 *                 (x, y) = body origin = rear bumper on the ground line (SVG origin),
 *                 angle = body tilt (rad, CCW, y up), wheels = world wheel centres,
 *                 rot = accumulated rolling angle (distance / r).
 *   sim.events / sim.drainEvents()  {type:'break', beamIndex, x, y, m} {type:'splash', x, y, size}
 *                 {type:'vehicle_finish', i} {type:'vehicle_fall', i} {type:'creak', beamIndex, stress}
 *   sim.summary() {status, time, peakStress, vehiclesFinished, vehiclesTotal, brokenBeams, failReason}
 *   The sim keeps running after success/failure so collapses can be watched.
 * Fully deterministic: no Math.random (seeded PRNG only), fixed iteration order,
 * vehicle rotations are unit complex numbers (no sin/cos in the state update).
 */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const DT = 1 / 60;
  const G = 9.81;
  const JOINT_MASS = 15;          // kg added to every joint
  const MAX_SPEED = 60;           // m/s particle/vehicle velocity clamp
  const STRESS_TAU = 0.008;       // s, low-pass filter for break detection
  const AXIAL_DAMP = 0.006;       // fraction of relative axial velocity removed per substep
  const BEND_DAMP = 0.01;         // fraction of deck kink angular velocity removed per substep
  const AIR_DAMP = 0.5;           // 1/s global linear damping
  const RAMP_TIME = 1.2;          // s, structural gravity ramp-in at start
  const RAMP_DAMP = 14.0;         // 1/s extra damping during ramp
  const TIRE_FREQ = 2.4;          // Hz, suspension natural frequency
  const TIRE_ZETA = 0.55;         // suspension damping ratio
  const MU = 0.95;                // tyre friction
  const SEP_MAX = 2.0;            // m/s max contact separation speed
  const HARD_PUSH = 4.0;          // m/s max speed of hard (non-compliant) penetration recovery
  const DECEL = 5.0;              // m/s^2 braking (cruise control)
  const SPAWN_GAP = 25;           // vehicles spawn with their front at leftEdge - 25
  const FINISH_GAP = 15;          // finished when rear passes rightEdge + 15

  function mulberry32(a) {
    a = (a >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Deterministic math: only IEEE-754 basic ops + sqrt (bit-identical on every JS engine,
  // unlike Math.atan2 / Math.hypot whose last-ulp results may differ between engines).
  const PI = 3.141592653589793, HALF_PI = 1.5707963267948966;
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function atanDet(z) {
    let sgn = 1, inv = false;
    if (z < 0) { z = -z; sgn = -1; }
    if (z > 1) { z = 1 / z; inv = true; }
    z = z / (1 + Math.sqrt(1 + z * z)); // half-angle reductions: |z| <= tan(pi/16)
    z = z / (1 + Math.sqrt(1 + z * z));
    const z2 = z * z;
    let a = 4 * z * (1 - z2 * (1 / 3 - z2 * (1 / 5 - z2 * (1 / 7 - z2 * (1 / 9 - z2 / 11)))));
    if (inv) a = HALF_PI - a;
    return sgn * a;
  }
  function atan2Det(y, x) {
    if (x > 0) return atanDet(y / x);
    if (x < 0) return y >= 0 ? atanDet(y / x) + PI : atanDet(y / x) - PI;
    return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  }

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  class Simulation {
    constructor(level, design, opts) {
      opts = opts || {};
      this.level = level || {};
      this.design = design || { nodes: [], beams: [], piers: [] };
      this.seed = num(opts.seed, 1);
      this.rng = mulberry32(this.seed * 2654435761);
      this.substeps = Math.max(4, Math.min(100, num(opts.substeps, 30) | 0));
      this.rampTime = num(opts.rampTime, RAMP_TIME);
      this.time = 0;
      this.stepCount = 0;
      this.status = 'running';
      this.failReason = null;
      this.events = [];
      this.timeLimit = num(this.level.timeLimit, 60);

      const t = this.level.terrain || {};
      this.terrain = {
        leftEdge: num(t.leftEdge, 0), leftY: num(t.leftY, 0),
        rightEdge: num(t.rightEdge, 10), rightY: num(t.rightY, 0),
        floorY: num(t.floorY, -10), waterY: (typeof t.waterY === 'number' && isFinite(t.waterY)) ? t.waterY : null,
      };
      if (this.terrain.rightEdge < this.terrain.leftEdge) this.terrain.rightEdge = this.terrain.leftEdge;
      this.deathY = this.terrain.waterY != null ? Math.max(this.terrain.waterY, this.terrain.floorY) : this.terrain.floorY;

      this._buildStructure();
      this._buildGround();
      this._buildVehicles();
      this._splashBudget = 0;
      this._syncOut();
    }

    // ------------------------------------------------------------------ setup
    _buildStructure() {
      const Mats = BG.Materials || {};
      const level = this.level, design = this.design;
      const all = BG.Model ? BG.Model.allNodes(level, design) : [];
      const beamsIn = design.beams || [];
      const nIn = all.length, bIn = beamsIn.length;
      const capN = nIn + 2 * bIn + 4, capB = 3 * bIn + 4;
      this._capN = capN; this._capB = capB;

      this.px = new Float64Array(capN); this.py = new Float64Array(capN);
      this.vx = new Float64Array(capN); this.vy = new Float64Array(capN);
      this.qx = new Float64Array(capN); this.qy = new Float64Array(capN);
      this.mass = new Float64Array(capN); this.w = new Float64Array(capN);
      this.wet = new Uint8Array(capN);
      this.nodes = [];
      const idx = new Map();
      for (let i = 0; i < nIn; i++) {
        const n = all[i];
        if (!idx.has(n.id)) idx.set(n.id, i); // duplicate ids: first one wins
        this.px[i] = this.qx[i] = num(n.x, 0);
        this.py[i] = this.qy[i] = num(n.y, 0);
        this.nodes.push({ id: n.id, x: this.px[i], y: this.py[i], fixed: !!n.fixed });
        this.mass[i] = JOINT_MASS;
      }
      this.nNodes = nIn;
      this.nodeIndex = idx;

      this.ba = new Int32Array(capB); this.bb = new Int32Array(capB);
      this.rest = new Float64Array(capB); this.compl = new Float64Array(capB);
      this.tlim = new Float64Array(capB); this.clim = new Float64Array(capB);
      this.tonly = new Uint8Array(capB); this.road = new Uint8Array(capB);
      this.active = new Uint8Array(capB); this.frag = new Uint8Array(capB);
      this.fRaw = new Float64Array(capB); this.fFilt = new Float64Array(capB);
      this.peakArr = new Float64Array(capB); this.creakT = new Float64Array(capB);
      this.beams = [];
      for (let j = 0; j < bIn; j++) {
        const d = beamsIn[j] || {};
        const mat = Mats[d.m];
        const ia = idx.has(d.a) ? idx.get(d.a) : -1;
        const ib = idx.has(d.b) ? idx.get(d.b) : -1;
        let ok = !!mat && ia >= 0 && ib >= 0 && ia !== ib;
        let L = 0;
        if (ok) {
          L = hyp(this.px[ib] - this.px[ia], this.py[ib] - this.py[ia]);
          if (!(L > 0.02)) ok = false;
        }
        this.ba[j] = ia >= 0 ? ia : 0; this.bb[j] = ib >= 0 ? ib : 0;
        this.rest[j] = L;
        const beam = {
          a: this.ba[j], b: this.bb[j], m: d.m, material: mat || null, restLength: L,
          force: 0, stress: 0, peak: 0, broken: !ok, invalid: !ok,
        };
        if (ok) {
          this.active[j] = 1;
          this.compl[j] = L / Math.max(1, mat.stiffness);
          this.tlim[j] = Math.max(1, mat.tensionLimit);
          this.clim[j] = Math.max(1, mat.compressionLimit);
          this.tonly[j] = mat.tensionOnly ? 1 : 0;
          this.road[j] = mat.isRoad ? 1 : 0;
          const bm = mat.massPerMeter * L;
          this.mass[ia] += bm / 2; this.mass[ib] += bm / 2;
        }
        this.beams.push(beam);
      }
      this.nBeams = bIn;
      this.nDesignBeams = bIn;
      for (let i = 0; i < nIn; i++) this.w[i] = this.nodes[i].fixed ? 0 : 1 / this.mass[i];

      this.piers = (design.piers || []).map(p => ({ x: p.x, baseY: this.terrain.floorY, topY: p.topY }));
      this._buildBendLinks();
    }

    /* Road decks are continuous: consecutive road segments meeting at a joint get an
     * XPBD angle constraint (bending spring). Moment / momentLimit adds to the beams'
     * axial stress ratio (linear interaction), so an unsupported flat deck bends and
     * snaps while the same road works fine as a truss chord. */
    _buildBendLinks() {
      const Mats = BG.Materials || {};
      const adj = new Map();
      for (let j = 0; j < this.nBeams; j++) {
        if (!this.active[j] || !this.road[j]) continue;
        const mat = this.beams[j].material;
        if (!(mat.bendStiffness > 0) || !(mat.momentLimit > 0)) continue;
        for (const e of [this.ba[j], this.bb[j]]) { if (!adj.has(e)) adj.set(e, []); adj.get(e).push(j); }
      }
      const L = [];
      const px = this.px, py = this.py;
      for (const [jn, list] of adj) {
        if (list.length < 2) continue;
        for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
          const b1 = list[p], b2 = list[q];
          const a = this.ba[b1] === jn ? this.bb[b1] : this.ba[b1];
          const b = this.ba[b2] === jn ? this.bb[b2] : this.ba[b2];
          if (a === b) continue;
          const ux = px[jn] - px[a], uy = py[jn] - py[a], wx = px[b] - px[jn], wy = py[b] - py[jn];
          const phi = atan2Det(ux * wy - uy * wx, ux * wx + uy * wy);
          if (Math.abs(phi) > 0.9) continue; // not a continuation of the deck
          const m1 = this.beams[b1].material, m2 = this.beams[b2].material;
          L.push({ a, j: jn, b, b1, b2, rest: phi,
            compl: 1 / Math.min(m1.bendStiffness, m2.bendStiffness),
            cap: Math.min(m1.momentLimit, m2.momentLimit) });
        }
      }
      // deterministic order (Map iteration is insertion ordered, but sort anyway by joint)
      L.sort((x, y) => x.j - y.j || x.b1 - y.b1 || x.b2 - y.b2);
      const n = L.length;
      this.nLinks = n;
      this.la = new Int32Array(n); this.lj = new Int32Array(n); this.lb = new Int32Array(n);
      this.lb1 = new Int32Array(n); this.lb2 = new Int32Array(n);
      this.lrest = new Float64Array(n); this.lcompl = new Float64Array(n); this.lcap = new Float64Array(n);
      this.lact = new Uint8Array(n); this.lM = new Float64Array(n); this.lMf = new Float64Array(n);
      this.beamLinks = [];
      for (let i = 0; i < n; i++) {
        const l = L[i];
        this.la[i] = l.a; this.lj[i] = l.j; this.lb[i] = l.b; this.lb1[i] = l.b1; this.lb2[i] = l.b2;
        this.lrest[i] = l.rest; this.lcompl[i] = l.compl; this.lcap[i] = l.cap; this.lact[i] = 1;
        (this.beamLinks[l.b1] || (this.beamLinks[l.b1] = [])).push(i);
        (this.beamLinks[l.b2] || (this.beamLinks[l.b2] = [])).push(i);
      }
    }

    /** bending ratio of beam j (max over its deck links), using filtered moments */
    _bendRatio(j) {
      const ls = this.beamLinks[j];
      if (!ls) return 0;
      let r = 0;
      for (let k = 0; k < ls.length; k++) {
        const l = ls[k];
        if (!this.lact[l]) continue;
        const v = Math.abs(this.lMf[l]) / this.lcap[l];
        if (v > r) r = v;
      }
      return r;
    }

    /** signed combined stress ratio (axial +/- with bending added to its magnitude) */
    _stress(j) {
      const f = this.fFilt[j];
      const ax = f >= 0 ? f / this.tlim[j] : f / this.clim[j];
      const bend = this.beamLinks[j] ? this._bendRatio(j) : 0;
      return ax >= 0 ? ax + bend : ax - bend;
    }

    _buildGround() {
      const t = this.terrain;
      const segs = [];
      const add = (ax, ay, bx, by) => {
        const ex = bx - ax, ey = by - ay, L = hyp(ex, ey);
        if (L < 1e-6) return;
        segs.push({ ax, ay, bx, by, nx: -ey / L, ny: ex / L });
      };
      add(t.leftEdge - 2000, t.leftY, t.leftEdge, t.leftY);
      add(t.leftEdge, t.leftY, t.leftEdge, t.floorY);
      add(t.leftEdge, t.floorY, t.rightEdge, t.floorY);
      add(t.rightEdge, t.floorY, t.rightEdge, t.rightY);
      add(t.rightEdge, t.rightY, t.rightEdge + 2000, t.rightY);
      this.ground = segs;
    }

    _buildVehicles() {
      const defs = BG.Vehicles || {};
      const t = this.terrain;
      this.vehicles = [];
      let k = 0;
      for (const g of this.level.traffic || []) {
        const def = defs[g.type];
        if (!def) continue;
        const count = Math.max(0, num(g.count, 1) | 0);
        for (let c = 0; c < count; c++) {
          const v = {
            type: def.type, def, state: 'waiting', index: k,
            x: t.leftEdge - SPAWN_GAP - def.length, y: t.leftY, angle: 0, vx: 0,
            wheels: def.wheels.map(w => ({ x: t.leftEdge - SPAWN_GAP - def.length + w.x, y: t.leftY + def.wheelRadius, r: def.wheelRadius, rot: 0 })),
            _interval: Math.max(0.2, num(g.interval, 2.5)),
          };
          let M = 0, xc = 0;
          for (const w of def.wheels) { M += w.mass; xc += w.mass * w.x; }
          M = M || def.mass || 1000; xc = xc / M;
          const r = def.wheelRadius;
          const yc = r + 0.32 * Math.max(0.5, def.height - r);
          v._M = M; v._invM = 1 / M;
          const I = M * (def.length * def.length * 0.7 + def.height * def.height) / 12;
          v._invI = 1 / I;
          v._xc = xc; v._yc = yc;
          // contact points: wheels first, then 4 hull corners (so flipped / scraping bodies collide)
          const om = 2 * Math.PI * TIRE_FREQ;
          const nw = def.wheels.length;
          const hr = Math.min(0.18, r * 0.45);
          const hullY0 = r + 0.12, hullY1 = Math.max(hullY0 + 0.3, def.height - hr);
          const wx0 = def.wheels[0].x, wx1 = def.wheels[nw - 1].x;
          const hull = [[wx0 + 0.3 * (wx1 - wx0), hullY0], [wx0 + 0.7 * (wx1 - wx0), hullY0], [hr * 1.5, hullY1], [def.length - hr * 1.5, hullY1]];
          v._nw = nw;
          v._lx = def.wheels.map(w => w.x - xc).concat(hull.map(p => p[0] - xc));
          v._ly = def.wheels.map(() => r - yc).concat(hull.map(p => p[1] - yc));
          v._rad = def.wheels.map(() => r).concat(hull.map(() => hr));
          const hullK = (M / 4) * (2 * Math.PI * 5) * (2 * Math.PI * 5);
          v._compl = def.wheels.map(w => 1 / (Math.max(50, w.mass) * om * om)).concat(hull.map(() => 1 / hullK));
          v._sink = def.wheels.map(w => w.mass * G / (Math.max(50, w.mass) * om * om));
          v._flipT = 0;
          v._damp = 2 * TIRE_ZETA * om;
          v._px = 0; v._py = 0; v._vx = 0; v._vy = 0; v._qc = 1; v._qs = 0; v._w = 0;
          v._ppx = 0; v._ppy = 0; v._pqc = 1; v._pqs = 0;
          v._cand = [];
          v._contacts = []; v._nc = 0;
          v._sim = false;
          v._fallT = 0;
          this.vehicles.push(v);
          k++;
        }
      }
      this._nextSpawn = 0;
      this._spawnTime = 0;
      this._finished = 0;
    }

    // ------------------------------------------------------------------ public
    drainEvents() { const e = this.events; this.events = []; return e; }

    summary() {
      let peak = 0, broken = 0;
      for (let j = 0; j < this.nDesignBeams; j++) {
        const b = this.beams[j];
        if (b.invalid) continue;
        if (this.peakArr[j] > peak) peak = this.peakArr[j];
        if (b.broken) broken++;
      }
      let fin = 0;
      for (const v of this.vehicles) if (v.state === 'finished') fin++;
      return {
        status: this.status, time: Math.round(this.time * 1000) / 1000,
        peakStress: Math.round(peak * 10000) / 10000,
        vehiclesFinished: fin, vehiclesTotal: this.vehicles.length, brokenBeams: broken,
        failReason: this.failReason,
      };
    }

    step() {
      const ns = this.substeps;
      const h = DT / ns;
      this._spawnVehicles();
      this._vehicleControl();
      this._broadphase();
      const ramp = this.rampTime > 0 ? clamp(this.time / this.rampTime, 0, 1) : 1;
      const gs = ramp * ramp * (3 - 2 * ramp);
      const extraDamp = (1 - ramp) * RAMP_DAMP;
      for (let s = 0; s < ns; s++) this._substep(h, gs, extraDamp, s);
      this.time += DT;
      this.stepCount++;
      this._postStep();
      this._syncOut();
    }

    // ------------------------------------------------------------------ vehicles (step level)
    _placeVehicle(v) {
      const t = this.terrain, def = v.def;
      const rearX = t.leftEdge - SPAWN_GAP - def.length;
      v._px = rearX + v._xc;
      v._py = t.leftY + v._yc - v._sink[0];
      v._qc = 1; v._qs = 0;
      v._vx = def.speed; v._vy = 0; v._w = 0;
      v._ppx = v._px; v._ppy = v._py; v._pqc = 1; v._pqs = 0;
      v._sim = true;
      v.state = 'driving';
      v._target = def.speed;
    }

    _spawnVehicles() {
      const vs = this.vehicles;
      while (this._nextSpawn < vs.length) {
        const v = vs[this._nextSpawn];
        const prev = this._nextSpawn > 0 ? vs[this._nextSpawn - 1] : null;
        const tReady = prev ? this._spawnTime + v._interval : 0;
        if (this.time + 1e-9 < tReady) break;
        if (prev && prev.state === 'driving') {
          const spawnFront = this.terrain.leftEdge - SPAWN_GAP;
          if (this._rearX(prev) < spawnFront + 3) break;
        }
        this._placeVehicle(v);
        this._spawnTime = this.time;
        this._nextSpawn++;
      }
    }

    _rearX(v) { return v._px - v._qc * v._xc + v._qs * v._yc; }
    _frontX(v) { return v._px + v._qc * (v.def.length - v._xc) + v._qs * v._yc; }

    _vehicleControl() {
      const vs = this.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!v._sim || v.state === 'fallen') continue;
        let target = v.def.speed;
        // cruise control: keep a gap to the nearest vehicle ahead
        for (let j = i - 1; j >= 0; j--) {
          const o = vs[j];
          if (!o._sim || o.state === 'fallen') continue;
          const gap = this._rearX(o) - this._frontX(v);
          const want = 3 + 0.5 * v.def.speed;
          const f = clamp((gap - 2.5) / want, 0, 1);
          target = Math.min(target, v.def.speed * f);
          break;
        }
        v._target = target;
      }
    }

    _broadphase() {
      const nb = this.nBeams;
      for (const v of this.vehicles) {
        v._cand.length = 0;
        if (!v._sim || v.state === 'fallen') continue;
        const def = v.def;
        const pad = def.wheelRadius + 1.5 + Math.abs(v._vx) * DT * 2;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let k = 0; k < v._lx.length; k++) {
          const wx = v._px + v._qc * v._lx[k] - v._qs * v._ly[k];
          const wy = v._py + v._qs * v._lx[k] + v._qc * v._ly[k];
          if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
          if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
        }
        x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
        const px = this.px, py = this.py;
        for (let j = 0; j < nb; j++) {
          if (!this.active[j] || !this.road[j]) continue;
          const a = this.ba[j], b = this.bb[j];
          const ax = px[a], bx = px[b], ay = py[a], by = py[b];
          if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1)) continue;
          if ((ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
          v._cand.push(j);
        }
      }
    }

    // ------------------------------------------------------------------ substep
    _substep(h, gs, extraDamp, s) {
      this._h = h;
      const nn = this.nNodes;
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, qx = this.qx, qy = this.qy, w = this.w;
      const waterY = this.terrain.waterY;
      const damp = 1 - (AIR_DAMP + extraDamp) * h;
      const gdt = G * gs * h;

      // 1. integrate joints
      for (let i = 0; i < nn; i++) {
        if (w[i] === 0) continue;
        let ux = vx[i] * damp, uy = vy[i] * damp - gdt;
        if (waterY !== null && py[i] < waterY) {
          const k = 1 - 2.5 * h;
          ux *= k; uy = uy * k + gdt * 0.55;
        }
        vx[i] = ux; vy[i] = uy;
        qx[i] = px[i]; qy[i] = py[i];
        px[i] += ux * h; py[i] += uy * h;
      }

      // 2. integrate vehicles
      const vs = this.vehicles;
      for (let k = 0; k < vs.length; k++) {
        const v = vs[k];
        if (!v._sim) continue;
        let gy = G;
        if (v.state === 'fallen' && waterY !== null && v._py < waterY + 0.5) {
          const d = 1 - 2.0 * h;
          v._vx *= d; v._vy *= d; v._w *= d; gy = G * 0.35;
        }
        v._vy -= gy * h;
        v._ppx = v._px; v._ppy = v._py; v._pqc = v._qc; v._pqs = v._qs;
        v._px += v._vx * h; v._py += v._vy * h;
        this._rotate(v, v._w * h);
        v._nc = 0;
      }

      // 3. beams (alternate sweep direction to avoid directional bias)
      const nb = this.nBeams;
      const invH2 = 1 / (h * h);
      const ba = this.ba, bb = this.bb, rest = this.rest, compl = this.compl, active = this.active, tonly = this.tonly, fRaw = this.fRaw;
      const fwd = (s & 1) === 0;
      for (let q = 0; q < nb; q++) {
        const j = fwd ? q : nb - 1 - q;
        if (!active[j]) { fRaw[j] = 0; continue; }
        const a = ba[j], b = bb[j];
        const wa = w[a], wb = w[b];
        const wsum = wa + wb;
        if (wsum === 0) { fRaw[j] = 0; continue; }
        const dx = px[b] - px[a], dy = py[b] - py[a];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) { fRaw[j] = 0; continue; }
        const C = len - rest[j];
        if (C < 0 && tonly[j]) { fRaw[j] = 0; continue; }
        const at = compl[j] * invH2;
        const dl = -C / (wsum + at);
        const nx = dx / len, ny = dy / len;
        if (wa !== 0) { px[a] -= wa * dl * nx; py[a] -= wa * dl * ny; }
        if (wb !== 0) { px[b] += wb * dl * nx; py[b] += wb * dl * ny; }
        fRaw[j] = -dl * invH2;
      }

      // 3b. deck bending links
      const nl = this.nLinks;
      if (nl) {
        const la = this.la, lj = this.lj, lb = this.lb, lact = this.lact, lM = this.lM, lrest = this.lrest, lcompl = this.lcompl;
        for (let l = 0; l < nl; l++) {
          if (!lact[l]) { lM[l] = 0; continue; }
          const a = la[l], j = lj[l], b = lb[l];
          const ux = px[j] - px[a], uy = py[j] - py[a], wx = px[b] - px[j], wy = py[b] - py[j];
          const u2 = ux * ux + uy * uy, w2 = wx * wx + wy * wy;
          if (u2 < 1e-8 || w2 < 1e-8) { lM[l] = 0; continue; }
          const C = atan2Det(ux * wy - uy * wx, ux * wx + uy * wy) - lrest[l];
          const gax = -uy / u2, gay = ux / u2, gbx = -wy / w2, gby = wx / w2;
          const gjx = -gax - gbx, gjy = -gay - gby;
          const wa = w[a], wb = w[b], wj = w[j];
          const W = wa * (gax * gax + gay * gay) + wb * (gbx * gbx + gby * gby) + wj * (gjx * gjx + gjy * gjy);
          if (W === 0) { lM[l] = 0; continue; }
          const dl = -C / (W + lcompl[l] * invH2);
          if (wa !== 0) { px[a] += wa * gax * dl; py[a] += wa * gay * dl; }
          if (wb !== 0) { px[b] += wb * gbx * dl; py[b] += wb * gby * dl; }
          if (wj !== 0) { px[j] += wj * gjx * dl; py[j] += wj * gjy * dl; }
          lM[l] = dl * invH2;
        }
      }

      // 4. vehicle contacts
      for (let k = 0; k < vs.length; k++) {
        const v = vs[k];
        if (v._sim) this._solveVehicleContacts(v, h);
      }

      // 5. joints vs terrain
      const t = this.terrain;
      for (let i = 0; i < nn; i++) {
        if (w[i] === 0) continue;
        let x = px[i], y = py[i];
        if (y < t.floorY) { y = t.floorY; }
        else if (x < t.leftEdge && y < t.leftY) {
          if (t.leftY - y < t.leftEdge - x) y = t.leftY; else x = t.leftEdge;
        } else if (x > t.rightEdge && y < t.rightY) {
          if (t.rightY - y < x - t.rightEdge) y = t.rightY; else x = t.rightEdge;
        }
        if (x !== px[i] || y !== py[i]) {
          // ground friction: kill most of the tangential motion this substep
          const mx = x - qx[i], my = y - qy[i];
          if (y !== py[i]) x = qx[i] + mx * 0.6; else y = qy[i] + my * 0.6;
          px[i] = x; py[i] = y;
        }
      }

      // 6. velocities
      const invH = 1 / h;
      for (let i = 0; i < nn; i++) {
        if (w[i] === 0) { vx[i] = 0; vy[i] = 0; continue; }
        let ux = (px[i] - qx[i]) * invH, uy = (py[i] - qy[i]) * invH;
        const sp2 = ux * ux + uy * uy;
        if (sp2 > MAX_SPEED * MAX_SPEED) { const f = MAX_SPEED / Math.sqrt(sp2); ux *= f; uy *= f; }
        vx[i] = ux; vy[i] = uy;
      }
      for (let k = 0; k < vs.length; k++) {
        const v = vs[k];
        if (!v._sim) continue;
        let ux = (v._px - v._ppx) * invH, uy = (v._py - v._ppy) * invH;
        const sp2 = ux * ux + uy * uy;
        if (sp2 > MAX_SPEED * MAX_SPEED) { const f = MAX_SPEED / Math.sqrt(sp2); ux *= f; uy *= f; }
        v._vx = ux; v._vy = uy;
        v._w = clamp((v._pqc * v._qs - v._pqs * v._qc) * invH, -8, 8);
      }

      // 7. velocity level: beam axial damping, tyres (damping + traction)
      for (let j = 0; j < nb; j++) {
        if (!active[j]) continue;
        const a = ba[j], b = bb[j];
        const wa = w[a], wb = w[b], wsum = wa + wb;
        if (wsum === 0) continue;
        if (tonly[j] && fRaw[j] <= 0) continue;
        const dx = px[b] - px[a], dy = py[b] - py[a];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) continue;
        const nx = dx / len, ny = dy / len;
        const dv = (vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny;
        const J = -AXIAL_DAMP * dv / wsum;
        vx[a] -= wa * J * nx; vy[a] -= wa * J * ny;
        vx[b] += wb * J * nx; vy[b] += wb * J * ny;
      }
      // bending-link damping (relative angular velocity of the kink)
      if (nl) {
        const la = this.la, lj = this.lj, lb = this.lb, lact = this.lact;
        for (let l = 0; l < nl; l++) {
          if (!lact[l]) continue;
          const a = la[l], j = lj[l], b = lb[l];
          const ux = px[j] - px[a], uy = py[j] - py[a], wx = px[b] - px[j], wy = py[b] - py[j];
          const u2 = ux * ux + uy * uy, w2 = wx * wx + wy * wy;
          if (u2 < 1e-8 || w2 < 1e-8) continue;
          const gax = -uy / u2, gay = ux / u2, gbx = -wy / w2, gby = wx / w2;
          const gjx = -gax - gbx, gjy = -gay - gby;
          const wa = w[a], wb = w[b], wj = w[j];
          const W = wa * (gax * gax + gay * gay) + wb * (gbx * gbx + gby * gby) + wj * (gjx * gjx + gjy * gjy);
          if (W === 0) continue;
          const rate = gax * vx[a] + gay * vy[a] + gbx * vx[b] + gby * vy[b] + gjx * vx[j] + gjy * vy[j];
          const dl = -BEND_DAMP * rate / W;
          vx[a] += wa * gax * dl; vy[a] += wa * gay * dl;
          vx[b] += wb * gbx * dl; vy[b] += wb * gby * dl;
          vx[j] += wj * gjx * dl; vy[j] += wj * gjy * dl;
        }
      }
      for (let k = 0; k < vs.length; k++) {
        const v = vs[k];
        if (v._sim && v._nc) this._tyreVelocity(v, h);
      }

      // 7b. final velocity clamp (impulses above may have added speed)
      const vmax2 = MAX_SPEED * MAX_SPEED;
      for (let i = 0; i < nn; i++) {
        const sp2 = vx[i] * vx[i] + vy[i] * vy[i];
        if (sp2 > vmax2) { const f = MAX_SPEED / Math.sqrt(sp2); vx[i] *= f; vy[i] *= f; }
      }

      // 8. stress filter + breaking
      const kf = Math.min(1, h / STRESS_TAU);
      const fF = this.fFilt, peak = this.peakArr, tl = this.tlim, cl = this.clim, frag = this.frag;
      for (let l = 0; l < nl; l++) if (this.lact[l]) this.lMf[l] += (this.lM[l] - this.lMf[l]) * kf;
      for (let j = 0; j < nb; j++) if (active[j]) fF[j] += (fRaw[j] - fF[j]) * kf;
      for (let j = 0; j < nb; j++) {
        if (!active[j] || frag[j]) continue;
        const f = fF[j];
        let st = f >= 0 ? f / tl[j] : -f / cl[j];
        const ls = this.beamLinks[j];
        if (ls) st += this._bendRatio(j);
        if (st > peak[j]) peak[j] = st;
        if (st > 1) {
          // a deck cracking at a joint: break whichever neighbour is more stressed
          let victim = j;
          if (ls) {
            let best = -1, bl = -1;
            for (const l of ls) if (this.lact[l]) { const r = Math.abs(this.lMf[l]) / this.lcap[l]; if (r > best) { best = r; bl = l; } }
            if (bl >= 0) {
              const other = this.lb1[bl] === j ? this.lb2[bl] : this.lb1[bl];
              if (active[other] && Math.abs(this._stress(other)) > st) victim = other;
            }
          }
          this._breakBeam(victim);
          if (victim !== j) j--; // re-evaluate this beam with the link gone
        }
      }
    }

    _rotate(v, dth) {
      if (dth === 0) return;
      const c = v._qc - v._qs * dth, sn = v._qs + v._qc * dth;
      const inv = 1 / Math.sqrt(c * c + sn * sn);
      v._qc = c * inv; v._qs = sn * inv;
    }

    _solveVehicleContacts(v, h) {
      const px = this.px, py = this.py;
      const fallen = v.state === 'fallen';
      const cand = v._cand, ground = this.ground;
      const invH2 = 1 / (h * h);
      const S = this._cs || (this._cs = []);
      for (let k = 0; k < v._lx.length; k++) {
        const r = v._rad[k];
        const cx = v._px + v._qc * v._lx[k] - v._qs * v._ly[k];
        const cy = v._py + v._qs * v._lx[k] + v._qc * v._ly[k];
        let n = 0;
        const nc = fallen ? 0 : cand.length;
        for (let q = -ground.length; q < nc; q++) {
          let ax, ay, bx, by, ia = -1, ib = -1, snx, sny;
          if (q < 0) {
            const g = ground[q + ground.length];
            ax = g.ax; ay = g.ay; bx = g.bx; by = g.by; snx = g.nx; sny = g.ny;
          } else {
            const j = cand[q];
            if (!this.active[j]) continue;
            ia = this.ba[j]; ib = this.bb[j];
            ax = px[ia]; ay = py[ia]; bx = px[ib]; by = py[ib];
            const ex = bx - ax, ey = by - ay, L = Math.sqrt(ex * ex + ey * ey);
            if (L < 1e-6) continue;
            snx = -ey / L; sny = ex / L;
            if (sny < 0) { snx = -snx; sny = -sny; }
          }
          const ex = bx - ax, ey = by - ay;
          const l2 = ex * ex + ey * ey;
          let tt = l2 > 0 ? ((cx - ax) * ex + (cy - ay) * ey) / l2 : 0;
          const interior = tt > 0 && tt < 1;
          tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          const qxp = ax + ex * tt, qyp = ay + ey * tt;
          const dx = cx - qxp, dy = cy - qyp;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          const side = (cx - ax) * snx + (cy - ay) * sny;
          if (side <= 0) continue; // centre is under/behind this surface
          const d = Math.sqrt(d2);
          let c = S[n];
          if (!c) c = S[n] = {};
          n++;
          if (d > 1e-6) { c.nx = dx / d; c.ny = dy / d; } else { c.nx = snx; c.ny = sny; }
          c.t = tt; c.ia = ia; c.ib = ib; c.d = d; c.gi = q + ground.length; c.interior = interior;
          c.vx = qxp; c.vy = qyp; c.ax = ax; c.ay = ay; c.bx = bx; c.by = by; c.ghost = false;
          if (n >= 12) break;
        }
        if (n === 0) continue;
        // ghost-vertex suppression: a rounded end-cap contact at a vertex shared with a
        // segment that already holds the wheel in its interior is an internal edge - skip it.
        let b1 = null, b2 = null;
        for (let i = 0; i < n; i++) {
          const c = S[i];
          if (!c.interior) {
            for (let m = 0; m < n; m++) {
              const o = S[m];
              if (m === i || !o.interior) continue;
              const e1x = o.ax - c.vx, e1y = o.ay - c.vy, e2x = o.bx - c.vx, e2y = o.by - c.vy;
              if (e1x * e1x + e1y * e1y < 4e-4 || e2x * e2x + e2y * e2y < 4e-4) { c.ghost = true; break; }
            }
          }
          if (c.ghost) continue;
          if (!b1 || c.d < b1.d) { if (b1 && (b1.nx * c.nx + b1.ny * c.ny) < 0.98) b2 = b1; b1 = c; }
          else if ((b1.nx * c.nx + b1.ny * c.ny) < 0.98 && (!b2 || c.d < b2.d)) b2 = c;
        }
        if (b1) this._applyContact(v, k, b1, r, invH2);
        if (b2) {
          // re-measure the second contact after the first correction moved things
          const cx2 = v._px + v._qc * v._lx[k] - v._qs * v._ly[k];
          const cy2 = v._py + v._qs * v._lx[k] + v._qc * v._ly[k];
          let sx, sy;
          if (b2.ia < 0) { const g = ground[b2.gi]; sx = g.ax + (g.bx - g.ax) * b2.t; sy = g.ay + (g.by - g.ay) * b2.t; }
          else { sx = px[b2.ia] + (px[b2.ib] - px[b2.ia]) * b2.t; sy = py[b2.ia] + (py[b2.ib] - py[b2.ia]) * b2.t; }
          b2.d = (cx2 - sx) * b2.nx + (cy2 - sy) * b2.ny;
          if (b2.d < r) this._applyContact(v, k, b2, r, invH2);
        }
      }
    }

    _applyContact(v, k, c, r, invH2) {
      const w = this.w, px = this.px, py = this.py;
      const cx = v._px + v._qc * v._lx[k] - v._qs * v._ly[k];
      const cy = v._py + v._qs * v._lx[k] + v._qc * v._ly[k];
      const nx = c.nx, ny = c.ny;
      const isWheel = k < v._nw;
      const C = c.d - r; // < 0
      const rax = cx - nx * r - v._px, ray = cy - ny * r - v._py;
      const cr = rax * ny - ray * nx;
      const wBody = v._invM + v._invI * cr * cr;
      let wa = 0, wb = 0;
      if (c.ia >= 0) { wa = w[c.ia]; wb = w[c.ib]; }
      const t = c.t;
      const wSeg = (1 - t) * (1 - t) * wa + t * t * wb;
      const wt = wBody + wSeg;
      const at = v._compl[k] * invH2;
      let dl = -C / (wt + at);
      // hard limit: never let a tyre sink deeper than 35 % of its radius
      const Cn = C + wt * dl;
      // (the extra push is rate limited so deep overlaps resolve over a few substeps
      //  instead of launching light debris / the vehicle)
      if (Cn < -0.35 * r) dl += Math.min(-0.35 * r - Cn, HARD_PUSH * this._h) / wt;
      v._px += v._invM * dl * nx; v._py += v._invM * dl * ny;
      this._rotate(v, v._invI * cr * dl);
      if (c.ia >= 0) {
        const fa = (1 - t) * wa * dl, fb = t * wb * dl;
        if (fa !== 0) { px[c.ia] -= fa * nx; py[c.ia] -= fa * ny; }
        if (fb !== 0) { px[c.ib] -= fb * nx; py[c.ib] -= fb * ny; }
      }
      const pool = v._contacts;
      let o = pool[v._nc];
      if (!o) o = pool[v._nc] = {};
      v._nc++;
      o.k = k; o.wheel = isWheel; o.nx = nx; o.ny = ny; o.t = t; o.ia = c.ia; o.ib = c.ib;
      o.wa = wa; o.wb = wb; o.dl = dl; o.rax = rax; o.ray = ray;
    }

    _tyreVelocity(v, h) {
      const vx = this.vx, vy = this.vy;
      const cs = v._contacts, ncs = v._nc;
      let sumL = 0, svt = 0, stx = 0, sty = 0;
      for (let q = 0; q < ncs; q++) {
        const c = cs[q];
        const tx = c.ny, ty = -c.nx;
        // relative velocity at contact point
        const pvx = v._vx - v._w * c.ray, pvy = v._vy + v._w * c.rax;
        let svx = 0, svy = 0;
        if (c.ia >= 0) {
          svx = (1 - c.t) * vx[c.ia] + c.t * vx[c.ib];
          svy = (1 - c.t) * vy[c.ia] + c.t * vy[c.ib];
        }
        const rvx = pvx - svx, rvy = pvy - svy;
        const vn = rvx * c.nx + rvy * c.ny;
        const vt = rvx * tx + rvy * ty;
        // suspension damping (normal)
        const crn = c.rax * c.ny - c.ray * c.nx;
        const wn = v._invM + v._invI * crn * crn + (1 - c.t) * (1 - c.t) * c.wa + c.t * c.t * c.wb;
        let Jn = -Math.min(1, v._damp * h) * vn / wn;
        const push = c.dl / h; // spring impulse this substep
        if (Jn < -push) Jn = -push;
        // never let penetration recovery launch the vehicle: cap separation speed
        if (vn + Jn * wn > SEP_MAX) Jn = (SEP_MAX - vn) / wn;
        this._impulse(v, c, c.nx, c.ny, Jn);
        if (c.wheel && c.ny > 0.7) { sumL += c.dl; svt += vt * c.dl; stx += tx * c.dl; sty += ty * c.dl; }
        else {
          // hull scraping: Coulomb friction, no drive
          const crt = c.rax * ty - c.ray * tx;
          const wtt = v._invM + v._invI * crt * crt + (1 - c.t) * (1 - c.t) * c.wa + c.t * c.t * c.wb;
          const lim = 0.5 * c.dl / h;
          this._impulse(v, c, tx, ty, clamp(-vt / wtt, -lim, lim));
        }
      }
      if (sumL <= 0) return;
      const vt = svt / sumL;
      const tl = Math.sqrt(stx * stx + sty * sty) || 1;
      const ty = sty / tl;
      let dv;
      if (v.state === 'fallen') dv = -vt * 0.05;
      else {
        const up = G * clamp(ty, 0, 0.45), down = G * clamp(-ty, 0, 0.45);
        dv = clamp(v._target - vt, -(DECEL + down) * h, (v.def.accel + up) * h);
      }
      let J = v._M * dv;
      const Jmax = MU * sumL / h;
      J = clamp(J, -Jmax, Jmax);
      for (let q = 0; q < ncs; q++) {
        const c = cs[q];
        if (c.wheel && c.ny > 0.7) this._impulse(v, c, c.ny, -c.nx, J * c.dl / sumL);
      }
    }

    _impulse(v, c, dx, dy, J) {
      if (J === 0) return;
      v._vx += v._invM * J * dx; v._vy += v._invM * J * dy;
      v._w += v._invI * (c.rax * dy - c.ray * dx) * J;
      if (c.ia >= 0) {
        const fa = (1 - c.t) * c.wa * J, fb = c.t * c.wb * J;
        this.vx[c.ia] -= fa * dx; this.vy[c.ia] -= fa * dy;
        this.vx[c.ib] -= fb * dx; this.vy[c.ib] -= fb * dy;
      }
    }

    // ------------------------------------------------------------------ breaking
    _breakBeam(j) {
      if (!this.active[j]) return;
      this.active[j] = 0;
      const ls = this.beamLinks && this.beamLinks[j];
      if (ls) for (const l of ls) { this.lact[l] = 0; this.lMf[l] = 0; }
      const beam = this.beams[j];
      beam.broken = true;
      const a = this.ba[j], b = this.bb[j];
      const px = this.px, py = this.py;
      const mx = (px[a] + px[b]) / 2, my = (py[a] + py[b]) / 2;
      this.events.push({ type: 'break', beamIndex: j, x: mx, y: my, m: beam.m });
      if (this.frag[j]) return;
      if (this.nNodes + 2 > this._capN || this.nBeams + 2 > this._capB) return;
      beam.fragmented = true; // its two halves continue as separate 'fragment' beams
      const mat = beam.material;
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const gap = Math.min(0.15, len * 0.04);
      const bm = mat.massPerMeter * this.rest[j];
      const mvx = (this.vx[a] + this.vx[b]) / 2, mvy = (this.vy[a] + this.vy[b]) / 2;
      const kick = 0.6 + 0.6 * this.rng();
      const ends = [[a, -1], [b, 1]];
      for (const [end, sgn] of ends) {
        const i = this.nNodes++;
        this.px[i] = this.qx[i] = mx + sgn * ux * gap;
        this.py[i] = this.qy[i] = my + sgn * uy * gap;
        // fragments fly apart a little along the beam axis
        this.vx[i] = mvx + sgn * ux * kick;
        this.vy[i] = mvy + sgn * uy * kick;
        this.mass[i] = bm / 4 + JOINT_MASS * 0.3;
        this.w[i] = 1 / this.mass[i];
        this.nodes.push({ id: 'f' + j + (sgn < 0 ? 'a' : 'b'), x: this.px[i], y: this.py[i], fixed: false, debris: true });
        const k = this.nBeams++;
        const e1 = sgn < 0 ? end : i, e2 = sgn < 0 ? i : end;
        this.ba[k] = e1; this.bb[k] = e2;
        const L = hyp(this.px[e2] - this.px[e1], this.py[e2] - this.py[e1]);
        this.rest[k] = L;
        this.compl[k] = L / Math.max(1, mat.stiffness);
        this.tlim[k] = this.tlim[j]; this.clim[k] = this.clim[j];
        this.tonly[k] = this.tonly[j]; this.road[k] = this.road[j];
        this.active[k] = 1; this.frag[k] = 1;
        this.beams.push({ a: e1, b: e2, m: beam.m, material: mat, restLength: L, force: 0, stress: 0, peak: 0, broken: false, fragment: true, parent: j });
      }
    }

    // ------------------------------------------------------------------ step bookkeeping
    _postStep() {
      const t = this.terrain;
      const vs = this.vehicles;
      // NaN guard
      for (let i = 0; i < this.nNodes; i++) {
        if (!(isFinite(this.px[i]) && isFinite(this.py[i]) && isFinite(this.vx[i]) && isFinite(this.vy[i]))) {
          this.px[i] = this.qx[i] = isFinite(this.qx[i]) ? this.qx[i] : this.nodes[i].x;
          this.py[i] = this.qy[i] = isFinite(this.qy[i]) ? this.qy[i] : this.nodes[i].y;
          this.vx[i] = 0; this.vy[i] = 0;
        }
      }
      // splash for debris entering water
      this._splashBudget = Math.min(6, this._splashBudget + DT * 6);
      if (t.waterY !== null) {
        for (let i = 0; i < this.nNodes; i++) {
          if (this.w[i] === 0) continue;
          const under = this.py[i] < t.waterY;
          if (under && !this.wet[i]) {
            this.wet[i] = 1;
            if (this.vy[i] < -2 && this._splashBudget >= 1) {
              this._splashBudget -= 1;
              this.events.push({ type: 'splash', x: this.px[i], y: t.waterY, size: clamp(this.mass[i] / 400, 0.3, 2) });
            }
          } else if (!under && this.py[i] > t.waterY + 0.5) this.wet[i] = 0;
        }
      }
      // creaks
      for (let j = 0; j < this.nDesignBeams; j++) {
        if (!this.active[j]) continue;
        const st = Math.abs(this._stress(j));
        if (st > 0.8 && this.time - this.creakT[j] > 0.7) {
          this.creakT[j] = this.time;
          this.events.push({ type: 'creak', beamIndex: j, stress: st });
        }
      }
      // vehicles
      let allDone = vs.length > 0;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (v._sim && v.state === 'driving') {
          let low = Infinity;
          for (let k = 0; k < v._lx.length; k++) {
            const wy = v._py + v._qs * v._lx[k] + v._qc * v._ly[k] - v._rad[k];
            if (wy < low) low = wy;
          }
          // flipped over (beyond ~105 degrees) for a while -> crashed
          if (v._qc < -0.25) v._flipT += DT; else v._flipT = 0;
          if (v._flipT > 1.0) low = -Infinity;
          const out = !isFinite(v._px) || !isFinite(v._py) || v._px > t.rightEdge + 3000 || v._px < t.leftEdge - 3000;
          if (low < this.deathY + 0.05 || v._py < this.deathY + 0.3 || out) {
            v.state = 'fallen';
            v._fallT = this.time;
            this.events.push({ type: 'vehicle_fall', i });
            if (t.waterY !== null) this.events.push({ type: 'splash', x: v._px, y: t.waterY, size: clamp(v._M / 4000, 1, 6) });
            if (this.status === 'running') { this.status = 'failed'; this.failReason = 'vehicle_fell'; }
          } else if (this._rearX(v) > t.rightEdge + FINISH_GAP && v._qc > 0.5) {
            v.state = 'finished';
            this.events.push({ type: 'vehicle_finish', i });
          }
        }
        if (v._sim && v.state === 'finished' && this._rearX(v) > t.rightEdge + 120) v._sim = false;
        if (v._sim && v.state === 'fallen' && this.time - v._fallT > 12) v._sim = false;
        if (v._sim && !(isFinite(v._px) && isFinite(v._py) && isFinite(v._qc))) {
          v._px = v._ppx; v._py = v._ppy; v._qc = 1; v._qs = 0; v._vx = v._vy = v._w = 0;
          if (!isFinite(v._px)) v._sim = false;
        }
        if (v.state !== 'finished') allDone = false;
      }
      if (this.status === 'running') {
        if (vs.length === 0 && this.time >= 3) this.status = 'success';
        else if (allDone) this.status = 'success';
        else if (this.time >= this.timeLimit - 1e-9) { this.status = 'failed'; this.failReason = 'timeout'; }
      }
    }

    _syncOut() {
      const nodes = this.nodes;
      for (let i = 0; i < this.nNodes; i++) { const n = nodes[i]; n.x = this.px[i]; n.y = this.py[i]; }
      for (let j = 0; j < this.nBeams; j++) {
        const b = this.beams[j];
        if (b.invalid) continue;
        const f = this.active[j] ? this.fFilt[j] : 0;
        b.force = f;
        b.stress = this.active[j] ? this._stress(j) : 0;
        if (this.beamLinks[j]) b.bend = this.active[j] ? this._bendRatio(j) : 0;
        b.peak = this.peakArr[j];
        b.broken = !this.active[j];
      }
      for (const v of this.vehicles) {
        if (v.state === 'waiting') continue;
        const c = v._qc, s = v._qs;
        v.x = v._px - c * v._xc + s * v._yc;
        v.y = v._py - s * v._xc - c * v._yc;
        v.angle = Math.atan2(s, c);
        v.vx = v._vx;
        const fwd = v._vx * c + v._vy * s;
        for (let k = 0; k < v.wheels.length; k++) {
          const wh = v.wheels[k];
          wh.x = v._px + c * v._lx[k] - s * v._ly[k];
          wh.y = v._py + s * v._lx[k] + c * v._ly[k];
          if (v._sim) wh.rot += fwd * DT / wh.r;
        }
      }
    }
  }

  Simulation.DT = DT;
  Simulation.GRAVITY = G;
  Simulation.SPAWN_GAP = SPAWN_GAP;
  Simulation.FINISH_GAP = FINISH_GAP;
  BG.Simulation = Simulation;
})(typeof window !== 'undefined' ? window : globalThis);
