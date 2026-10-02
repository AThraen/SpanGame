/* SPAN — railway rolling stock (BG.RailCars) and train presets (BG.Trains). SPEC §9.3.
 *
 * Car-local frame (same rules as road vehicles, SPEC §7): origin at the REAR of the car on the
 * rail-top line, x forward, y up. bogies[].x = bogie centre from the rear (m); bogies[].axles =
 * axle offsets from that centre (m); bogies[].mass = mass carried by that bogie (kg), shared
 * equally by its axles; bogies[].r (optional) overrides the car's wheelRadius for that bogie
 * (steam drivers). Sum of bogie masses == car mass. couplerHeight = coupler above rail top (m).
 * power: true marks a locomotive (traction + braking); every car brakes.
 * Computed on load: def.mass, def.wheels [{x, mass, r, bogie}] (axles from the rear, like
 * BG.Vehicles wheels), def.axleLoad (heaviest axle, kg).
 *
 * Presets: BG.Trains[id] = {id, name, cars:[car types, FRONT first], speed (m/s), accel (m/s^2)}.
 * Computed: mass (kg), length (m, incl. coupler gaps), carCount, type: 'train'.
 *
 * ======================================================================================
 * ENGINE FACTS FOR LEVEL DESIGNERS (measured with the headless sim - tools/test-physics.js
 * 'rail:' tests and probe designs; numbers are for the current tuning in materials.js)
 * --------------------------------------------------------------------------------------
 * Traffic entry:   { type: 'train', train: '<preset id>', count, interval }  (road vehicles may be
 *                  mixed in on double-deck levels; they need a road deck, trains a rail deck)
 * Level fields:    campaign: 'rail', ids 101-120; rail: { maxGrade: 0.06, maxKinkDeg: 4 } = defaults
 * Presets          cars    mass  length speed  load     heaviest axle
 *   handcar          1 cars     1 t    3 m   3 m/s  0.4 t/m  max axle 0.5 t
 *   tram             1 cars    20 t   14 m   7 m/s  1.4 t/m  max axle 5.0 t
 *   steam_local      4 cars   142 t   56 m  10 m/s  2.5 t/m  max axle 15.0 t
 *   steam_express    7 cars   220 t  110 m  14 m/s  2.0 t/m  max axle 15.0 t
 *   commuter         5 cars   168 t   90 m  16 m/s  1.9 t/m  max axle 10.7 t
 *   freight_short    6 cars   200 t   89 m  10 m/s  2.2 t/m  max axle 10.7 t
 *   freight_long    14 cars   464 t  204 m  10 m/s  2.3 t/m  max axle 10.7 t
 *   ore             24 cars  1954 t  276 m   8 m/s  7.1 t/m  max axle 20.8 t
 *   highspeed        8 cars   376 t  166 m  42 m/s  2.3 t/m  max axle 17.0 t
 *   highspeed_long  14 cars   616 t  290 m  42 m/s  2.1 t/m  max axle 17.0 t
 * Spawn / finish:  trains spawn at cruise speed with the whole consist on the left bank, the lead
 *                  car's front at leftEdge - max(25, 2 s x speed) (fast trains start further back so
 *                  they meet a settled bridge). Finished when the LAST car's rear passes
 *                  rightEdge + 15. Time to clear ~ (max(25, 2 v) + gap + 15 + length) / v; a second
 *                  train waits until the first one's rear is past the spawn point, then keeps a
 *                  braking gap (count 2 at interval 4 adds ~ length / v + 4 s).
 * Rail deck:       trains ride ONLY on `rail` beams (and the bank tops); the rail must run from the
 *                  left road anchor to the right one (BG.Model.railConnected; for a rail level
 *                  BG.Model.roadConnected checks the rail). Road vehicles never touch rail, trains
 *                  never touch road. Rail beams must be laid nearly level: steeper than 25 % is a
 *                  validation error (rail_too_steep), so track is never a cheap web member.
 * Derailment ('derailed' fail reason, {type:'derail', i, car, x, y, reason} event) when, for a car:
 *   - grade:   a wheel's rail segment is steeper than maxGrade for > 0.3 s (as built AND live sag
 *              both count - a soft bridge steepens its end panels under load);
 *   - kink:    the angle between the rail segments under a bogie's first and last axle (cars
 *              whose bogies have one axle each, i.e. the handcar: under its two wheels) exceeds the
 *              kink limit for > 0.05 s. The limit is maxKinkDeg up to 15 m/s and shrinks as 15/v
 *              above that (42 m/s high-speed -> 1.4 deg), so dips and humps matter for fast
 *              trains: a 0.1 m dip in a 5 m-panel deck (~2.3 deg) is fine for freight but derails
 *              the high-speed set. The joint where a bridge meets the bank counts too: a 5 %
 *              ramp straight off the flat bank is a 2.9 deg kink;
 *   - missing: no rail under a wheel (gap, broken rail, road instead of rail) for > 2 steps;
 *   - lift:    a bogie would have to be held down with more than its static load for > 0.12 s
 *              (thrown off a crest, or levered up by a falling neighbour).
 *   A derailed car tumbles as a free rigid body (hull + wheels collide with rail, road and
 *   ground), stays coupled, and the rest of the train emergency-brakes.
 * Validation warnings (non-blocking, BG.Model.validate(...).warnings): rail_grade (a rail beam
 *   steeper than maxGrade as built), rail_kink (consecutive rail beams kinked > maxKinkDeg).
 *
 * Materials: rail $160/m, 240 kg/m, max 6 m, +-1.2 MN, bends at joints like road but stiffer;
 *   unsupported rail sags into a kink before it breaks. A handcar crosses up to 14 m of plain
 *   rail (2-3 segments); a tram already derails on 10 m of plain rail.
 *   masonry $35/m, 700 kg/m, max 5 m, 3 MN compression but only 50 kN TENSION: arch ribs,
 *   spandrel posts, pier caps - anything that stays squeezed. Pin-jointed arches with posts
 *   only are mechanisms (the loco kinks the deck); brace the spandrels with tension-capable
 *   diagonals (steel, or wood running AWAY from the crown) - masonry diagonals crack.
 *   girder $480/m, 260 kg/m, max 12 m, +4.0 / -3.4 MN: the ore-train material (same strength
 *   per weight as steel, so deep girder trusses are as self-weight-limited as steel ones).
 *   On heavy spans the TRACK must not be the main chord (1.2 MN): carry it on short posts
 *   (~1 m) above a separate girder chord, or keep spans short with piers.
 *
 * Measured capacities (peak stress when it passes; X = fails). Deck trusses are Pratt with
 * X-braced 5 m panels, rail = top chord, bottom chord between the lower anchors ("h" = depth);
 * viaducts: masonry arch (rise 3 m, 4 segments per 10 m span) on piers every 10 m, masonry
 * posts, steel spandrel diagonals; "p1" / "p2" = one / two piers (top at the bottom chord).
 *   plain rail 10 m      $1.6k   handcar 0.33 | tram and heavier: X (kink)
 *   plain rail 14 m      $2.2k   handcar 0.42
 *   wood truss 20 m h3   $7.0k   handcar 0.30 | tram X (wood 110 kN in compression)
 *   steel truss 20 m h4  $13k    tram 0.21  steam_local 0.69  steam_express 0.73  freight_long 0.55
 *                                highspeed 0.63 | ore X
 *   steel truss 30 m h6  $23k    steam_local 0.83  commuter 0.60  freight_long 0.68  highspeed 0.69
 *   steel truss 40 m h8  $36k    steam_local 0.90  freight_long 0.82  highspeed 0.96 | ore X
 *   masonry viaduct 30 m $20k    steam_local 0.39  freight_long 0.27  ORE 0.43 | highspeed X (1.03:
 *   masonry viaduct 40 m $28k    the same; dynamic impact cracks the masonry in tension)
 *   steel 70 m h10 p1    $78k    steam 0.89  freight_long 0.84  highspeed 0.92 | ore X
 *   steel 80 m h10 p1    $88k    freight_long 0.96  steam_express 0.99 | steam_local, highspeed X
 *   girder 60 m h10      $220k   freight_long 0.90  highspeed 0.88 | ore X (rail chord breaks)
 *   girder 90 m h12 p2   $390k   ore 0.37 (piers at 30/60), everything else < 0.26
 *   2-tier girder truss 80 m (2 x 9 m, track on 1 m posts), no piers: ore 0.94 at $576k;
 *   the same with steel webs fails in end shear - use girder near the supports, steel mid-span.
 *   2-tier truss 80 m (2 x 6 m, girder chords, steel webs): freight_long 0.94 at $183k.
 *   Sample levels: 101 Pump Trolley (handcar, 10 m: ref $1.9k / best $1.6k of $2.3k),
 *   108 Stone Steps (2 x steam_local, 40 m, 3 piers: steel-braced viaduct $28.6k, wood-braced
 *   $23.4k of $33.5k - piers cost $4k each and dominate).
 * ======================================================================================
 */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  function car(o) {
    let m = 0, ax = 0;
    const wheels = [];
    for (let b = 0; b < o.bogies.length; b++) {
      const bg = o.bogies[b];
      m += bg.mass;
      const per = bg.mass / bg.axles.length;
      for (const dx of bg.axles) wheels.push({ x: bg.x + dx, mass: per, r: bg.r || o.wheelRadius, bogie: b });
      ax = Math.max(ax, per);
    }
    wheels.sort((a, b) => a.x - b.x);
    o.mass = m;
    o.wheels = wheels;
    o.axleLoad = ax;
    return o;
  }

  BG.RailCars = {
    handcar: car({
      type: 'handcar', name: 'Handcar', length: 2.6, height: 1.6, wheelRadius: 0.3, couplerHeight: 0.45,
      bogies: [{ x: 0.5, axles: [0], mass: 500 }, { x: 2.1, axles: [0], mass: 500 }],
      power: true, color: '#c8743a',
    }),
    tram: car({
      type: 'tram', name: 'Tram', length: 14, height: 3.3, wheelRadius: 0.34, couplerHeight: 0.6,
      bogies: [{ x: 3.0, axles: [-0.9, 0.9], mass: 10000 }, { x: 11.0, axles: [-0.9, 0.9], mass: 10000 }],
      power: true, color: '#e8b22e',
    }),
    loco_steam: car({
      type: 'loco_steam', name: 'Steam Locomotive', length: 12.5, height: 4.3, wheelRadius: 0.45, couplerHeight: 1.0,
      bogies: [{ x: 4.0, axles: [-1.6, 0, 1.6], mass: 45000, r: 0.75 }, { x: 10.6, axles: [-0.55, 0.55], mass: 15000 }],
      power: true, color: '#23262b',
    }),
    tender: car({
      type: 'tender', name: 'Tender', length: 7.5, height: 3.4, wheelRadius: 0.45, couplerHeight: 1.0,
      bogies: [{ x: 1.9, axles: [-0.6, 0.6], mass: 15000 }, { x: 5.6, axles: [-0.6, 0.6], mass: 15000 }],
      color: '#2c3036',
    }),
    coach: car({
      type: 'coach', name: 'Coach', length: 17, height: 3.7, wheelRadius: 0.45, couplerHeight: 1.0,
      bogies: [{ x: 2.6, axles: [-1.1, 1.1], mass: 13000 }, { x: 14.4, axles: [-1.1, 1.1], mass: 13000 }],
      color: '#7a2630',
    }),
    loco_diesel: car({
      type: 'loco_diesel', name: 'Diesel Locomotive', length: 19, height: 4.3, wheelRadius: 0.5, couplerHeight: 1.0,
      bogies: [{ x: 3.6, axles: [-1.8, 0, 1.8], mass: 32000 }, { x: 15.4, axles: [-1.8, 0, 1.8], mass: 32000 }],
      power: true, color: '#e2a21c',
    }),
    boxcar: car({
      type: 'boxcar', name: 'Boxcar', length: 14, height: 4.0, wheelRadius: 0.45, couplerHeight: 1.0,
      bogies: [{ x: 2.2, axles: [-0.9, 0.9], mass: 12000 }, { x: 11.8, axles: [-0.9, 0.9], mass: 12000 }],
      color: '#8c3b26',
    }),
    tank_wagon: car({
      type: 'tank_wagon', name: 'Tank Wagon', length: 12, height: 3.7, wheelRadius: 0.45, couplerHeight: 1.0,
      bogies: [{ x: 2.0, axles: [-0.9, 0.9], mass: 16000 }, { x: 10.0, axles: [-0.9, 0.9], mass: 16000 }],
      color: '#2d2f33',
    }),
    ore_wagon: car({
      type: 'ore_wagon', name: 'Ore Wagon', length: 10, height: 3.0, wheelRadius: 0.45, couplerHeight: 1.0,
      bogies: [{ x: 1.9, axles: [-0.9, 0.9], mass: 41500 }, { x: 8.1, axles: [-0.9, 0.9], mass: 41500 }],
      color: '#6b4a32',
    }),
    hs_power: car({
      type: 'hs_power', name: 'High-Speed Power Car', length: 20, height: 3.9, wheelRadius: 0.46, couplerHeight: 1.0,
      bogies: [{ x: 3.2, axles: [-1.4, 1.4], mass: 34000 }, { x: 15.8, axles: [-1.4, 1.4], mass: 34000 }],
      power: true, color: '#f2f4f7',
    }),
    hs_coach: car({
      type: 'hs_coach', name: 'High-Speed Coach', length: 20, height: 3.8, wheelRadius: 0.46, couplerHeight: 1.0,
      bogies: [{ x: 3.0, axles: [-1.3, 1.3], mass: 20000 }, { x: 17.0, axles: [-1.3, 1.3], mass: 20000 }],
      color: '#e9edf2',
    }),
  };
  BG.RailCarOrder = ['handcar', 'tram', 'loco_steam', 'tender', 'coach', 'loco_diesel', 'boxcar', 'tank_wagon', 'ore_wagon', 'hs_power', 'hs_coach'];

  /** gap between two coupled car bodies (m); the couplers have +/- COUPLER_SLACK of free play */
  const COUPLER_GAP = 0.8;
  const COUPLER_SLACK = 0.12;

  function rep(t, n) { const a = []; for (let i = 0; i < n; i++) a.push(t); return a; }
  function train(o) {
    let m = 0, len = 0;
    for (const t of o.cars) {
      const c = BG.RailCars[t];
      if (!c) throw new Error('unknown rail car ' + t);
      m += c.mass; len += c.length;
    }
    o.mass = m;
    o.length = len + COUPLER_GAP * Math.max(0, o.cars.length - 1);
    o.carCount = o.cars.length;
    o.type = 'train';
    return o;
  }

  BG.Trains = {
    handcar: train({ id: 'handcar', name: 'Handcar', cars: ['handcar'], speed: 3, accel: 0.6 }),
    tram: train({ id: 'tram', name: 'Tram', cars: ['tram'], speed: 7, accel: 1.0 }),
    steam_local: train({ id: 'steam_local', name: 'Local Steam', cars: ['loco_steam', 'tender', 'coach', 'coach'], speed: 10, accel: 0.5 }),
    steam_express: train({ id: 'steam_express', name: 'Steam Express', cars: ['loco_steam', 'tender'].concat(rep('coach', 5)), speed: 14, accel: 0.4 }),
    commuter: train({ id: 'commuter', name: 'Commuter', cars: ['loco_diesel'].concat(rep('coach', 4)), speed: 16, accel: 0.7 }),
    freight_short: train({ id: 'freight_short', name: 'Short Freight', cars: ['loco_diesel', 'boxcar', 'boxcar', 'boxcar', 'tank_wagon', 'tank_wagon'], speed: 10, accel: 0.4 }),
    freight_long: train({ id: 'freight_long', name: 'Long Freight', cars: ['loco_diesel', 'loco_diesel'].concat(rep('boxcar', 6), rep('tank_wagon', 6)), speed: 10, accel: 0.3 }),
    ore: train({ id: 'ore', name: 'Ore', cars: ['loco_diesel', 'loco_diesel'].concat(rep('ore_wagon', 22)), speed: 8, accel: 0.2 }),
    highspeed: train({ id: 'highspeed', name: 'High-Speed', cars: ['hs_power'].concat(rep('hs_coach', 6), ['hs_power']), speed: 42, accel: 0.8 }),
    highspeed_long: train({ id: 'highspeed_long', name: 'High-Speed (long)', cars: ['hs_power'].concat(rep('hs_coach', 12), ['hs_power']), speed: 42, accel: 0.6 }),
  };
  BG.TrainOrder = ['handcar', 'tram', 'steam_local', 'steam_express', 'commuter', 'freight_short', 'freight_long', 'ore', 'highspeed', 'highspeed_long'];

  /** Derailment defaults (a level's `rail: {maxGrade, maxKinkDeg}` overrides them). */
  BG.RailRules = {
    maxGrade: 0.06, maxKinkDeg: 4, gradeTime: 0.3, kinkTime: 0.05, kinkRefSpeed: 15,
    liftTime: 0.12, couplerGap: COUPLER_GAP, couplerSlack: COUPLER_SLACK,
  };
})(typeof window !== 'undefined' ? window : globalThis);
