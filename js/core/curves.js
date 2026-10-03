// SPAN — BG.Curves: pure curve geometry for the Arch & Curve tool (SPEC §18). Browser + Node, no DOM.
//
//   const c = BG.Curves.make('parabolic' | 'circular' | 'catenary', x0, y0, x1, y1, rise)
//     rise > 0 bulges above the chord (an arch), rise < 0 sags below it (a hanging cable / sagging chord).
//     Parabolic and catenary curves are offset vertically from the chord (rise = vertical offset at mid-span,
//     the shapes gravity loads produce); the circular arc is offset across the chord (rise = sagitta, at most
//     half the chord: a semicircle, the Roman arch).
//     c.at(t) -> {x, y} for t in [0, 1] from (x0, y0) to (x1, y1); c.length (arc length); c.samples (dense polyline)
//   BG.Curves.divide(c, n)            -> n + 1 points with (near) equal chord lengths, exact endpoints
//   BG.Curves.segment(c, opts)        -> {n, nMin, points, lengths, maxSeg, ok}: the fewest segments (or opts.n)
//                                        with every segment <= maxLen * (1 - margin) after the interior joints are
//                                        snapped to the grid. opts: {maxLen, margin = 0.02, grid = 0.25, n, maxN}
//   BG.Curves.alignedSegment(c, xs, opts) -> the same, but with joints at the given x stations (deck joints) plus
//                                        subdivisions where a chord would be too long; null if c is not y(x)
//   BG.Curves.yAt(c, x)               -> the curve's height at x (null outside / where it overhangs)
//   BG.Curves.fitParabola(pts)      -> {x0, y0, x1, y1, rise}: parabola through the two extreme points (by x),
//                                        least-squares fit of the rise to the points between
//   BG.Curves.snap(v, g), BG.Curves.catenaryK(ratio)
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const SHAPES = ['parabolic', 'circular', 'catenary'];
  const SAMPLES = 720;      // dense polyline used for arc length and equal-chord division
  const MIN_SEG = 0.5;      // m: shortest segment a snapped division may contain

  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function snap(v, g) { return g > 0 ? Math.round(Math.round(v / g) * g * 10000) / 10000 : v; }
  function cosh(x) { return (Math.exp(x) + Math.exp(-x)) / 2; }

  /** catenary shape parameter k = halfSpan / c for a sag-to-half-span ratio r: (cosh k - 1) / k = r */
  function catenaryK(r) {
    r = Math.abs(r);
    if (!(r > 1e-6)) return 0;
    let lo = 0, hi = 1;
    while ((cosh(hi) - 1) / hi < r && hi < 60) hi *= 2;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if ((cosh(m) - 1) / m < r) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /** profile f(t), f(0) = f(1) = 0, f(0.5) = 1 (vertical-offset shapes) */
  function profile(shape, t, k) {
    if (shape === 'catenary' && k > 1e-6) return (cosh(k) - cosh(k * (2 * t - 1))) / (cosh(k) - 1);
    return 4 * t * (1 - t);
  }

  function make(shape, x0, y0, x1, y1, rise) {
    if (SHAPES.indexOf(shape) < 0) shape = 'parabolic';
    rise = +rise || 0;
    const dx = x1 - x0, dy = y1 - y0, chord = hyp(dx, dy);
    const c = { shape, x0, y0, x1, y1, rise, chord, span: Math.abs(dx) };
    if (shape === 'circular') {
      // circular arc in the chord frame: u along the chord, d = the side it bulges to
      const s = Math.min(Math.abs(rise), chord / 2);
      c.rise = rise < 0 ? -s : s;
      if (s < 1e-6 || chord < 1e-9) {
        c.at = (t) => ({ x: x0 + dx * t, y: y0 + dy * t });
      } else {
        const ux = dx / chord, uy = dy / chord;
        let nx = -uy, ny = ux;               // left normal (up for a chord running left to right)
        if (ny < -1e-9 || (Math.abs(ny) <= 1e-9 && nx > 0)) { nx = -nx; ny = -ny; } // always the upper side
        const sg = rise < 0 ? -1 : 1;
        const ddx = nx * sg, ddy = ny * sg;
        const R = (chord * chord / 4 + s * s) / (2 * s);
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const cx = mx - ddx * (R - s), cy = my - ddy * (R - s);
        const alpha = Math.asin(Math.min(1, chord / 2 / R));
        const half = s > R ? Math.PI - alpha : alpha; // never: s <= chord / 2 <= R
        c.radius = R;
        c.at = (t) => {
          const p = -half + 2 * half * t;
          const cp = Math.cos(p), sp = Math.sin(p);
          return { x: cx + R * (ddx * cp + ux * sp), y: cy + R * (ddy * cp + uy * sp) };
        };
      }
    } else {
      const k = shape === 'catenary' ? catenaryK(Math.abs(rise) / Math.max(1e-9, Math.abs(dx) / 2)) : 0;
      c.k = k;
      c.at = (t) => ({ x: x0 + dx * t, y: y0 + dy * t + rise * profile(shape, t, k) });
    }
    // dense samples + cumulative arc length
    const pts = [], cum = [0];
    for (let i = 0; i <= SAMPLES; i++) {
      const p = c.at(i / SAMPLES);
      pts.push(p);
      if (i) cum.push(cum[i - 1] + hyp(p.x - pts[i - 1].x, p.y - pts[i - 1].y));
    }
    c.samples = pts;
    c.cum = cum;
    c.length = cum[SAMPLES];
    /** height of the curve at x (vertical-offset shapes; circular: nearest sample) */
    c.peak = c.at(0.5);
    return c;
  }

  // walk n chords of length d along the polyline from the start; returns the points and the arc position reached
  function walk(c, n, d) {
    const P = c.samples, cum = c.cum, N = P.length - 1;
    const out = [P[0]];
    let q = P[0], k = 0; // q lies on segment k..k+1 (or at its start)
    for (let step = 0; step < n; step++) {
      let found = null;
      for (let j = k; j < N; j++) {
        const b = P[j + 1];
        if (hyp(b.x - q.x, b.y - q.y) < d) continue;
        // the circle |p - q| = d crosses segment j (from inside to outside): solve on the segment
        const a = hyp(P[j].x - q.x, P[j].y - q.y) < d ? P[j] : q;
        const sx = b.x - a.x, sy = b.y - a.y, fx = a.x - q.x, fy = a.y - q.y;
        const A = sx * sx + sy * sy, B = 2 * (fx * sx + fy * sy), C = fx * fx + fy * fy - d * d;
        const disc = Math.max(0, B * B - 4 * A * C);
        const t = A > 0 ? Math.min(1, Math.max(0, (-B + Math.sqrt(disc)) / (2 * A))) : 0;
        found = { x: a.x + sx * t, y: a.y + sy * t, j, s: cum[j] + hyp(a.x + sx * t - P[j].x, a.y + sy * t - P[j].y) };
        break;
      }
      if (!found) return { pts: out, s: c.length + d * (n - step), short: true };
      out.push({ x: found.x, y: found.y });
      q = found; k = found.j;
      if (step === n - 1) return { pts: out, s: found.s };
    }
    return { pts: out, s: 0 };
  }

  /** n + 1 points along the curve with equal chord lengths (bisection on the chord length) */
  function divide(c, n) {
    n = Math.max(1, Math.round(n));
    const A = c.samples[0], B = c.samples[c.samples.length - 1];
    if (n === 1 || c.length < 1e-9) return [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
    let lo = hyp(B.x - A.x, B.y - A.y) / n * 0.999, hi = c.length / n * 1.001;
    let best = null;
    for (let i = 0; i < 64; i++) {
      const d = (lo + hi) / 2;
      const w = walk(c, n, d);
      if (w.short || w.s > c.length) hi = d; else { lo = d; best = w; }
    }
    if (!best) best = walk(c, n, lo);
    const pts = best.pts.slice(0, n);
    while (pts.length < n) pts.push(c.at(pts.length / n)); // degenerate fallback
    pts[0] = { x: A.x, y: A.y };
    pts.push({ x: B.x, y: B.y });
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }

  function lengthsOf(pts) {
    const L = [];
    for (let i = 1; i < pts.length; i++) L.push(hyp(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return L;
  }

  /** the way the curve turns (cross product sign walking from start to end): -1 an arch, +1 a sag, 0 straight */
  function turnOf(c) {
    const a = c.at(0), m = c.at(0.5), b = c.at(1);
    const cr = (m.x - a.x) * (b.y - m.y) - (m.y - a.y) * (b.x - m.x);
    return Math.abs(cr) < 1e-6 * Math.max(1, c.chord * c.chord) ? 0 : cr < 0 ? -1 : 1;
  }

  /** Snap ideal joints to the grid without making the polyline lumpy. Rounding each joint on its own can leave a
   *  joint a grid step off the trend of its neighbours (a kink against the curve's bend). This picks, per interior
   *  joint, one of the nearby grid points (x and y each rounded down / up, or kept when p.fixX / p.fixY) so that the
   *  chain still turns one way only (convex, like the curve) and every chord stays within [minSeg, limit], with the
   *  smallest total distance from the ideal points (dynamic programming over consecutive pairs). Ends never move.
   *  Returns null when no such choice exists. */
  function fairSnap(c, ideal, grid, o) {
    o = o || {};
    const limit = o.limit > 0 ? o.limit : Infinity;
    const minSeg = o.minSeg > 0 ? o.minSeg : 0;
    const turn = turnOf(c);
    const N = ideal.length;
    if (N < 3) return ideal.map((p) => ({ x: p.x, y: p.y }));
    // grid values around v: rounded down / up (wide: one more step either way, for a joint whose x is pinned)
    const opts = (v, fix, wide) => {
      if (fix || !(grid > 0)) return [v];
      const lo = snap(Math.floor(v / grid + 1e-9) * grid, grid), hi = snap(Math.ceil(v / grid - 1e-9) * grid, grid);
      const out = lo === hi ? [lo] : [lo, hi];
      if (wide) { out.unshift(snap(lo - grid, grid)); out.push(snap(hi + grid, grid)); }
      return out;
    };
    // a mirror-symmetric curve gets mirror-symmetric ideal points (and ties broken toward the middle), so a
    // symmetric arch stays symmetric after snapping
    const midX = (c.x0 + c.x1) / 2;
    const sym = Math.abs(c.y1 - c.y0) < 1e-9;
    const pts = ideal.map((p) => Object.assign({}, p));
    if (sym) for (let i = 1; i < N - 1; i++) {
      const q = ideal[N - 1 - i];
      if (!!q.fixX !== !!ideal[i].fixX || ideal[i].fixY || q.fixY) continue;
      if (q.fixX && Math.abs(q.x + ideal[i].x - 2 * midX) > 1e-6) continue;
      pts[i].x = (ideal[i].x + 2 * midX - q.x) / 2;
      pts[i].y = (ideal[i].y + q.y) / 2;
    }
    const cands = pts.map((p, i) => {
      if (i === 0 || i === N - 1) return [{ x: p.x, y: p.y, cost: 0 }];
      const out = [];
      for (const x of opts(p.x, p.fixX)) for (const y of opts(p.y, p.fixY, p.fixX)) {
        let cost = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
        if (c.shape !== 'circular') { const yc = yAt(c, x); if (yc != null) cost += (y - yc) * (y - yc); }
        cost += 1e-7 * Math.abs(x - midX); // ties: toward the middle (both halves alike)
        out.push({ x, y, cost });
      }
      return out;
    });
    const lenOk = (a, b) => { const l = hyp(b.x - a.x, b.y - a.y); return l <= limit + 1e-9 && l >= minSeg - 1e-9; };
    const convex = (a, b, d) => {
      if (!turn) return true;
      const cr = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
      return cr * turn >= -1e-9;
    };
    // state: (index of candidate at i-1, index at i) -> {cost, back}
    let prev = new Map();
    for (let k = 0; k < cands[1].length; k++) {
      if (lenOk(cands[0][0], cands[1][k])) prev.set('0|' + k, { cost: cands[1][k].cost, back: null, j: 0, k });
    }
    const layers = [prev];
    for (let i = 2; i < N; i++) {
      const next = new Map();
      for (const st of prev.values()) {
        const A = cands[i - 2][st.j], B = cands[i - 1][st.k];
        for (let l = 0; l < cands[i].length; l++) {
          const D = cands[i][l];
          if (!lenOk(B, D) || !convex(A, B, D)) continue;
          const cost = st.cost + D.cost, key = st.k + '|' + l;
          const cur = next.get(key);
          if (!cur || cost < cur.cost - 1e-12) next.set(key, { cost, back: st, j: st.k, k: l });
        }
      }
      if (!next.size) return null;
      layers.push(next);
      prev = next;
    }
    let best = null;
    for (const st of prev.values()) if (!best || st.cost < best.cost) best = st;
    const idx = [];
    for (let s = best; s; s = s.back) idx.unshift(s.k);
    idx.unshift(0);
    return idx.map((k, i) => ({ x: cands[i][k].x, y: cands[i][k].y }));
  }

  /** divide into n chords and snap the interior joints to the grid (fairly: see fairSnap; plain rounding when that
   *  finds nothing). opts: {limit, minSeg} for the chord lengths */
  function snapped(c, n, grid, opts) {
    const pts = divide(c, n);
    const fair = fairSnap(c, pts, grid, opts);
    if (fair) return fair;
    for (let i = 1; i < pts.length - 1; i++) pts[i] = { x: snap(pts[i].x, grid), y: snap(pts[i].y, grid) };
    return pts;
  }

  function segment(c, opts) {
    opts = opts || {};
    const maxLen = opts.maxLen > 0 ? opts.maxLen : 6;
    const margin = opts.margin != null ? opts.margin : 0.02;
    const grid = opts.grid != null ? opts.grid : 0.25;
    const limit = maxLen * (1 - margin);
    const maxN = opts.maxN || 80;
    const good = (pts) => {
      const L = lengthsOf(pts);
      return L.every((l) => l <= limit + 1e-9 && l >= Math.min(MIN_SEG, c.length / 2)) ? L : null;
    };
    let nMin = Math.max(1, Math.ceil(c.length / limit - 1e-9));
    let pts = null;
    const so = { limit, minSeg: Math.min(MIN_SEG, c.length / 2) };
    for (; nMin <= maxN; nMin++) { pts = snapped(c, nMin, grid, so); if (good(pts)) break; }
    if (nMin > maxN) nMin = maxN;
    let n = nMin;
    if (opts.n > 0) { n = Math.min(maxN, Math.max(1, Math.round(opts.n))); pts = snapped(c, n, grid, so); }
    else pts = snapped(c, n, grid, so);
    const lengths = lengthsOf(pts);
    const maxSeg = lengths.reduce((a, b) => Math.max(a, b), 0);
    return { n, nMin, points: pts, lengths, maxSeg, limit, ok: !!good(pts) && maxSeg <= maxLen + 1e-9 };
  }

  /** height of the curve at x, or null when x is outside it / the curve overhangs (is not a function of x) */
  function yAt(c, x) {
    const dx = c.x1 - c.x0;
    if (Math.abs(dx) < 1e-9) return null;
    if (c.shape !== 'circular' || !c.radius) {
      const t = (x - c.x0) / dx;
      return t < -1e-9 || t > 1 + 1e-9 ? null : c.at(Math.min(1, Math.max(0, t))).y;
    }
    const S = c.samples, sg = dx > 0 ? 1 : -1;
    for (let i = 1; i < S.length; i++) if ((S[i].x - S[i - 1].x) * sg <= 0) return null;
    for (let i = 1; i < S.length; i++) {
      const a = S[i - 1], b = S[i];
      if ((x - a.x) * sg >= -1e-9 && (b.x - x) * sg >= -1e-9) return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    }
    return null;
  }

  /** joints at the given x stations (the deck joints the curve connects to) plus subdivisions where a chord would
   *  be too long: {n, nMin, points (station points carry .station), lengths, maxSeg, ok, aligned} or null when the
   *  curve is not a function of x. A station is an x, or {x, y} to pin that joint's height (where the curve crosses
   *  the deck: the joint sits on the deck line). opts as segment(); opts.n > nMin splits the longest chords. */
  function alignedSegment(c, stations, opts) {
    opts = opts || {};
    const maxLen = opts.maxLen > 0 ? opts.maxLen : 6;
    const margin = opts.margin != null ? opts.margin : 0.02;
    const grid = opts.grid != null ? opts.grid : 0.25;
    const limit = maxLen * (1 - margin);
    const sg = c.x1 >= c.x0 ? 1 : -1;
    const xs = [];
    const list = stations.map((q) => (typeof q === 'number' ? { x: q } : q)).sort((a, b) => (a.x - b.x) * sg);
    for (const q of list) {
      if ((q.x - c.x0) * sg < MIN_SEG || (c.x1 - q.x) * sg < MIN_SEG) continue;
      const last = xs[xs.length - 1];
      if (last && Math.abs(q.x - last.x) < MIN_SEG) { if (q.y != null && last.y == null) xs[xs.length - 1] = q; continue; }
      xs.push(q);
    }
    const base = [{ x: c.x0, y: c.y0, end: true }];
    for (const q of xs) {
      const y = yAt(c, q.x);
      if (y == null) return null;
      base.push(q.y != null ? { x: q.x, y: q.y, station: true, pinY: true } : { x: q.x, y: snap(y, grid), station: true });
    }
    base.push({ x: c.x1, y: c.y1, end: true });
    const ok = (a, b) => { const l = hyp(b.x - a.x, b.y - a.y); return l <= limit + 1e-9 && l >= MIN_SEG - 1e-9; };
    const sub = (a, b, k) => {
      const out = [];
      for (let j = 1; j < k; j++) {
        const x = a.x + (b.x - a.x) * j / k, y = yAt(c, x);
        if (y == null) return null;
        out.push({ x: snap(x, grid), y: snap(y, grid) });
      }
      return out;
    };
    let pts = [base[0]];
    for (let i = 1; i < base.length; i++) {
      const a = base[i - 1], b = base[i];
      let mid = null;
      for (let k = 1; k <= 40; k++) {
        const m = sub(a, b, k);
        if (!m) return null;
        const chain = [a].concat(m, [b]);
        let good = true;
        for (let j = 1; j < chain.length; j++) if (!ok(chain[j - 1], chain[j])) { good = false; break; }
        if (good) { mid = m; break; }
      }
      if (!mid) return null;
      pts = pts.concat(mid, [b]);
    }
    const nMin = pts.length - 1;
    const want = opts.n > nMin ? Math.min(opts.maxN || 80, Math.round(opts.n)) : nMin;
    while (pts.length - 1 < want) {
      let bi = 1, bl = -1;
      for (let i = 1; i < pts.length; i++) { const l = hyp(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (l > bl) { bl = l; bi = i; } }
      const a = pts[bi - 1], b = pts[bi];
      const x = snap((a.x + b.x) / 2, grid), y = yAt(c, (a.x + b.x) / 2);
      if (y == null || bl < 2 * MIN_SEG) break;
      pts.splice(bi, 0, { x, y: snap(y, grid) });
    }
    pts[0] = { x: c.x0, y: c.y0 };
    pts[pts.length - 1] = { x: c.x1, y: c.y1 };
    // the same fair snapping as segment(): x stays (stations, grid), y picks the grid row that keeps the chain convex
    const ideal = pts.map((p, i) => { const y = i && i < pts.length - 1 && !p.pinY ? yAt(c, p.x) : p.y; return { x: p.x, y: y == null ? p.y : y, fixX: true, fixY: !!p.pinY, station: p.station, pinY: p.pinY }; });
    const fair = fairSnap(c, ideal, grid, { limit, minSeg: MIN_SEG });
    if (fair) fair.forEach((p, i) => { const q = { x: p.x, y: p.y }; if (pts[i].station) q.station = true; if (pts[i].pinY) q.pinY = true; pts[i] = q; });
    const lengths = lengthsOf(pts);
    const maxSeg = lengths.reduce((a, b) => Math.max(a, b), 0);
    return { n: pts.length - 1, nMin, points: pts, lengths, maxSeg, limit, ok: lengths.every((l) => l <= limit + 1e-9 && l >= MIN_SEG - 1e-9), aligned: true };
  }

  /** parabola through the extreme points (by x) of pts, rise fitted by least squares to the others */
  function fitParabola(pts) {
    const s = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const A = s[0], B = s[s.length - 1];
    const dx = B.x - A.x;
    let num = 0, den = 0;
    for (let i = 1; i < s.length - 1; i++) {
      const t = dx > 1e-9 ? (s[i].x - A.x) / dx : i / (s.length - 1);
      const f = 4 * t * (1 - t);
      const r = s[i].y - (A.y + (B.y - A.y) * t);
      num += f * r; den += f * f;
    }
    return { x0: A.x, y0: A.y, x1: B.x, y1: B.y, rise: den > 1e-12 ? num / den : 0, order: s };
  }

  BG.Curves = { SHAPES, make, divide, segment, snapped, fairSnap, turnOf, alignedSegment, yAt, fitParabola, snap, catenaryK, lengthsOf, MIN_SEG };
})(typeof window !== 'undefined' ? window : globalThis);
