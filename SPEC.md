# SPAN — Bridge Construction Game: Spec & Plan

A browser bridge-building puzzle game. Plain HTML + JavaScript, no build step, no dependencies.
Opens directly from `index.html` (file://) — so **classic `<script>` tags, no ES modules**.

## 1. Player experience

1. Pick a level (50 in 6 chapters, 0–3 stars each). A level unlocks when either of the two levels before it is complete,
   but a chapter finale (the last level of a chapter) can't be skipped: nothing after it opens until it is complete (§15).
2. See the gap: two banks, anchors (fixed bolts), maybe a valley floor with pier zones, water, a ship
   clearance zone. Budget bar at top, traffic preview ("3 cars, 1 bus").
3. Build with drag-and-drop: pick a material from the bottom palette, drag from any joint/anchor to
   anywhere → beam (clamped to the material's max length, snapped to 1 m grid and to existing joints).
   Drag joints to move them. Right-click / eraser deletes. Pier tool places pillars on allowed floor zones;
   drag to set their height (can rise above the deck → towers for suspension / cable-stayed bridges).
   Mirror-symmetry toggle. Undo/redo. Optional templates (Warren / Pratt / Howe truss, deck arch,
   through arch, suspension, cable-stayed) auto-generated over the selected span — ordinary editable beams.
4. Press **Test** (Space). The physics sim runs: the deck sags, traffic drives across.
   Beams are coloured by live stress (cool → yellow → red); hover a beam for exact force/%.
   Overstressed beams snap with debris, sparks, splash, camera shake, sound.
   Controls: pause, speed ¼× / 1× / 2× / 4× / 8×, restart, back to edit (design preserved).
5. After the run: a stress heat-map of the **peak** stress each beam saw, so the player can optimise.
6. Pass = all vehicles drive to the far side within the time limit **and** cost ≤ budget. The road must
   connect both banks; a vehicle launched across (airborne > 0.35 s over the gap) fails the run, and the run
   ends early when all traffic has been stuck for 5 s.
   (Over-budget designs may be tested; they just can't complete the level.)
   Stars: ★ pass, ★★ cost ≤ 85 % budget, ★★★ cost ≤ 70 % budget.
7. Progress + last design per level saved in localStorage (wrapped in try/catch; game works without it).

## 2. Units & conventions

- World units = metres, **y up**, gravity 9.81 m/s². Masses in kg, forces in N, money in $.
- Fixed simulation timestep: 1/60 s per `step()`, with internal substeps. Fully **deterministic**
  (no `Math.random` inside the sim; use a seeded PRNG if needed) so headless verification in Node
  equals what the browser shows.

## 3. File layout

```
index.html               loads scripts in the order below
css/style.css            (+ feature stylesheets: css/goals.css, css/forces.css, css/daily.css, css/famous.css,
                         then css/pwa.css, css/history.css and css/mobile.css - mobile.css is always the last stylesheet)
js/core/materials.js     BG.Materials
js/core/vehicles.js      BG.Vehicles (definitions)
js/core/model.js         BG.Model (design helpers, cost, validation, serialization)
js/core/physics.js       BG.Simulation (+ BG.SimHooks extension points, §12.2)
js/core/events.js        BG.Forces (wind / quake level events, §12)
js/core/levels.js        BG.Levels (generated: roads 1-58, Iron Road 101-120, Famous Bridges 201-212)
js/core/templates.js     BG.Templates (bridge-type generators)
js/core/generator.js     BG.Generator (procedural, proven-solvable road levels for daily / endless, §13.1)
js/render/effects.js     BG.Effects (particles, debris, shake)
js/render/renderer.js    BG.Renderer
js/ui/audio.js           BG.Audio (WebAudio, synthesized — no asset files)
js/ui/storage.js         BG.Storage
js/ui/editor.js          BG.Editor
js/ui/hud.js             BG.Hud (menus, level select, palette, results, tooltips)
js/main.js               BG.Game (state machine + main loop)
js/features/*.js         optional feature modules, loaded last (core → render → ui → main → features);
                         e.g. terrain-fix.js = BG.TerrainFix (§10), goals*.js = BG.Goals (§11),
                         forces-fx.js = Forces of Nature visuals / HUD / audio (§12),
                         daily.js = BG.Daily (Daily Challenge + Endless, §13.2),
                         requirements.js = BG.Requirements + famous.js = BG.Famous (Famous Bridges, §14),
                         then history.js, pwa.js, mobile.js = BG.History / BG.PWA / BG.Mobile (§16) -
                         always after main.js and every other feature script
tools/harness.js         Node loader for js/core/* + runHeadless()
tools/test-physics.js    physics unit/behaviour tests
tools/verify-levels.js   runs every level against its reference + best designs
tools/build-levels.js    tools/levels/level-NN.json -> js/core/levels.js (generated; never edit levels.js by hand)
tools/test-anchors.js    inland anchors, land pylons, roadway envelope (§17)
tools/solutions/level-NN.json, level-NN-best.json   reference / best designs (not loaded by the game)
```

Every `js/core/*` file must run in both browser and Node:

```js
(function (root) {
  const BG = (root.BG = root.BG || {});
  // ...
})(typeof window !== 'undefined' ? window : globalThis);
```

Core files must not touch DOM/canvas. Render/UI files may assume a browser.

## 4. Data contracts (all modules code against these)

### 4.1 Materials — `BG.Materials`
Object keyed by id. Each:
```js
{ id, name, color, costPerMeter, massPerMeter, stiffness /* EA, N */,
  tensionLimit, compressionLimit /* N, positive numbers */, maxLength /* m */,
  isRoad /* vehicles drive on it */, tensionOnly /* ropes/cables go slack in compression */,
  width /* render thickness, m */,
  // road materials only: deck bending at joints between consecutive road segments
  bendStiffness /* N·m/rad */, momentLimit /* N·m */,
  bendRefLength /* m: joints between segments shorter than this get a proportionally stiffer
                   spring, so a finely cut deck is not floppier/cheaper than a supported one */ }
```
Required ids: `road`, `reinforced_road`, `wood`, `steel`, `rope`, `cable`.
Starting tuning (engine owner may re-tune; level designers build on final values):
road $100/m max 6 m; reinforced_road $180/m max 6 m; wood $50/m max 6 m; steel $120/m max 10 m;
rope $20/m max 20 m, tension only, weak; cable $60/m max 40 m, tension only, strong.
`BG.Costs = { joint: 0 , pierBase: 1000, pierPerMeter: 250 }` (engine owner tunes).

### 4.2 Vehicles — `BG.Vehicles`
Keyed by type: `car` (~1.2 t), `van` (~2.5 t), `bus` (~12 t), `truck` (~20 t), `semi` (~38 t, tractor + trailer),
`tanker` (~45 t), `heavy` (~60 t crane carrier). Each:
```js
{ type, name, mass, length, height, wheelRadius, wheels: [{x /* m from rear */, mass}],
  speed /* target m/s */, color, accel }
```

### 4.3 Level — entries of `BG.Levels`
```js
{
  id: 1, name: 'First Crossing', hint: 'Drag from an anchor to build a road...', theme: 'meadow',
  // themes: meadow | autumn | desert | canyon | snow | night | city | tropical | volcanic
  terrain: {
    leftEdge: 0, leftY: 0,        // left bank top surface ends at x=leftEdge, height leftY
    rightEdge: 12, rightY: 0,     // right bank starts at x=rightEdge
    floorY: -10,                  // valley floor
    waterY: -7 /* or null */,
  },
  anchors: [ {x:0,y:0}, {x:12,y:0}, {x:0,y:-3}, ... ], // must include both road endpoints
                                     // ({x, y, inland: true} = inland anchor on a bank top / in a hillside, §17)
  pierZones: [ {x0: 20, x1: 30} ],   // where piers may stand on the floor ([] = none)
                                     // ({x0, x1, ground: 'left'|'right'} = land pier zone on that bank, §17)
  // roadClearance: true | <m> | false  optional: force / size / disable the roadway envelope (§17)
  maxPiers: 0,
  noBuild: [ {x0, x1, y0, y1} ],     // e.g. ship clearance; no joint or beam may enter
  buildArea: { x0, x1, y0, y1 },     // joints must be inside
  materials: ['road', 'wood'],       // allowed
  budget: 2500,
  traffic: [ {type: 'car', count: 2, interval: 2.5 /* s between spawns */} ], // groups in order
  timeLimit: 40,                      // seconds of sim time
  templates: true,                    // whether template tool is offered
  events: [ ... ]                     // optional wind / quake events (§12.1); absent = no weather
  // campaign: 'rail' (Iron Road, §9) | 'famous' (Famous Bridges, §14); absent = Roads.
  // Famous levels also carry history, requires, stub (§14.1); templates may then be an array of template ids.
}
```
Vehicles spawn on the left bank at `leftEdge - 25`, drive right, finish when the rear passes `rightEdge + 15`.

### 4.4 Design (what the player builds; what is saved)
```js
{
  nodes: [ {id: 'n1', x: 4, y: 0}, ... ],          // user joints
  beams: [ {a: 'a0', b: 'n1', m: 'road'}, ... ],   // endpoint ids
  piers: [ {x: 25, topY: 2} ]                       // a pier's top is a fixed joint with id 'p<index>'
}
```
Node ids: level anchors are `'a<index>'` (index into `level.anchors`), pier tops `'p<index>'`,
user joints `'n<int>'`.

### 4.5 `BG.Model`
```js
BG.Model.emptyDesign()
BG.Model.allNodes(level, design)   // -> [{id,x,y,fixed}] anchors + pier tops + user nodes
BG.Model.cost(level, design)       // -> { total, beams, piers }  (integer $)
BG.Model.validate(level, design)   // -> { ok, errors:[{type, msg, beamIndex?, nodeId?}] }
                                   //    too long, outside build area, in noBuild, disallowed material,
                                   //    duplicate beam, pier out of zone / too many, zero-length,
                                   //    in_terrain (joint in rock, or beam passing through rock),
                                   //    near_terrain (user joint < TERRAIN_CLEARANCE = 0.5 m from the ground:
                                   //    only anchors and piers may bear on rock),
                                   //    underwater (user joint below terrain.waterY; see §10),
                                   //    roadway (joint / member / land pylon top in the roadway envelope, §17)
BG.Model.roadConnected(level, design)   // road/reinforced road path from the left road anchor to the right one
BG.Model.segmentInTerrain(level, x1, y1, x2, y2, tol), BG.Model.terrainDistance(level, x, y)
BG.Model.clone(design), BG.Model.serialize(design), BG.Model.deserialize(str)
BG.Model.beamLength(level, design, beam)
```

### 4.6 `BG.Simulation`
```js
const sim = new BG.Simulation(level, design, { seed: 1 });
sim.step();            // advance exactly 1/60 s (internal substeps)
sim.time               // seconds
sim.status             // 'running' | 'success' | 'failed'
sim.failReason         // 'vehicle_fell' | 'vehicle_jumped' (launched across / road not connected)
                       // | 'stalled' (all driving vehicles stopped for 5 s) | 'timeout' | null
sim.roadConnected      // BG.Model.roadConnected at construction (success requires it)
sim.firstBreak         // null | {beamIndex, m, mode:'tension'|'compression'|'bending', force, axial, bend, time, x, y}
sim.nodes              // [{id, x, y, fixed}]   positions live
sim.beams              // [{a, b /* indices into sim.nodes */, m, material, restLength,
                       //   force /* N, + tension */, stress /* signed ratio: force/limit, |1| = break */,
                       //   peak /* max |stress| seen */, broken }]
sim.piers              // [{x, baseY, topY}]
sim.vehicles           // [{type, def, state: 'waiting'|'driving'|'finished'|'fallen',
                       //   x, y, angle /* body pose */, wheels: [{x, y, r, rot}], vx}]
sim.events             // array pushed during step(); consumer drains with sim.drainEvents()
                       //   {type:'break', beamIndex, x, y, m, mode} {type:'splash', x, y, size}
                       //   {type:'vehicle_finish', i} {type:'vehicle_fall', i} {type:'vehicle_jump', i, x, y}
                       //   {type:'creak', beamIndex, stress}
sim.summary()          // { status, time, peakStress, vehiclesFinished, vehiclesTotal, brokenBeams, failReason, firstBreak }
```
**Physics approach (required):** XPBD (extended position-based dynamics) with substepping.
Joints are particles (mass = half of each attached beam’s mass + small joint mass). Beams are
distance constraints with compliance = 1/stiffness·L; force read from the constraint lagrange
multiplier → stress. Tension-only materials have no compressive constraint (slack).
A beam breaks when |stress| > 1 (optionally a few-ms persistence filter to avoid single-substep spikes).
Vehicles: chassis + wheel particles held together by stiff constraints; wheels are circles colliding
with road beam segments and bank surfaces; contact corrections are distributed to the segment’s
two end joints by inverse mass and barycentric weight, so vehicle weight loads the bridge naturally.
Motor drives wheels toward target speed with friction-limited traction. Vehicles below `floorY`/`waterY`
→ fallen (emit splash) → level fails. Light damping. Must be stable for 150 m spans, 300+ beams,
60 t vehicles, and run ≥ 60 fps in the browser for the largest levels.

### 4.7 Headless — `tools/harness.js`
```js
const { BG, runHeadless } = require('./harness');
runHeadless(level, design, { maxTime }) // -> sim.summary() plus { cost, budgetOk, valid }
```

### 4.8 `BG.Templates`
`BG.Templates.list` → `[{id, name, desc}]`; `BG.Templates.generate(id, level, opts)` → design fragment
`{nodes, beams, piers}` spanning the main road anchors using allowed materials.
Ids: `beam`, `warren`, `pratt`, `howe`, `deck_arch`, `through_arch`, `suspension`, `cable_stayed`.
Templates are a starting point; they need not be cost-optimal or pass every level.
`BG.Templates.available(level)` → list entries plus `{ok, reason}`; `ok:false` when the template needs rope/cable
the level lacks or its best variant still breaks the level's rules. The HUD only offers `ok` templates.

### 4.9 Renderer — `BG.Renderer`
```js
const r = new BG.Renderer(canvas);
r.setLevel(level)
r.camera  // {x, y, zoom /* px per m */}; r.fitToLevel(); r.screenToWorld(px,py); r.worldToScreen(x,y)
r.render({ mode: 'edit'|'sim'|'results', level, design, sim, editorState, dt, showStress, peakView })
```
Look: rich, polished 2D canvas, devicePixelRatio aware. Themed gradient skies, procedural parallax
mountains/hills/city silhouettes, drifting clouds, sun/moon, stars at night, animated water with
reflections & foam, textured terrain (strata, grass/snow/sand tops, rocks), piers in concrete.
Beams styled per material (wood grain planks, steel I-beam with rivets, rope/cable thin with sag
hint when slack, road deck asphalt with lane markings and kerb), bolted joints, anchors as concrete
blocks. Vehicles detailed vector art (windows, lights, rotating wheels, headlights at night).
Stress overlay: smooth gradient white→green→yellow→orange→red, pulsing glow above 85 %.
Edit-mode grid, ghost beam preview with length + cost, invalid in red, build area and noBuild zones
(hatched, with a little ship for channels).

### 4.10 Editor — `BG.Editor`
```js
const ed = new BG.Editor(game);  ed.attach(canvas); ed.detach();
ed.design, ed.tool /* 'build'|'erase'|'pier'|'select' */, ed.material, ed.mirror
ed.undo(), ed.redo(), ed.clear(), ed.applyTemplate(id)
ed.state  // for renderer: {hoverNode, hoverBeam, dragFrom, ghost:{x1,y1,x2,y2,valid,len,cost}, selection}
```
Mouse + touch. Wheel zoom, middle/right-drag or Space-drag pan. Snap 1 m grid (Shift = 0.25 m),
magnet to joints within 0.6 m. Auto-chain: after placing a beam, continue from its end until Esc
/ right-click, or until the chain reaches an anchor. Clicking an out-of-reach joint while chaining places the
previewed (clamped) beam toward it. A new joint that lands on an existing beam (within 0.15 m) splits that beam,
so it is connected. The chain is cleared when a test starts or ends.
Keyboard: 1–6 materials, E erase, P pier, M mirror, Ctrl+Z/Y, Space test, Esc.

### 4.11 HUD / shell
Title screen with animated bridge scene; level select grid (50 tiles, stars, lock, themed thumbnails
colours); in-level top bar (level name, budget bar with cost/budget, traffic icons), bottom material
palette with cost/m & strength bars, tool buttons, Test button; sim controls; hint toast for early
levels; results modal (pass/fail reason, cost, stars, Next / Retry / Edit). Clean modern look:
glassy panels, rounded, Google-Font-free (system font stack), smooth CSS transitions.

### 4.12 `BG.Game` (main.js)
States: `title → levelSelect → edit ⇄ sim → results`. Owns current level, design (per-level saved),
`requestAnimationFrame` loop with fixed-step accumulator (sim speed multiplier), drains sim events
into Effects + Audio, records results into Storage.

## 5. Difficulty curve (50 levels, 6 chapters — the level select uses the same bands)

| Chapter | Levels | Gap | Traffic | New idea |
|---|---|---|---|---|
| First Crossings | 1–5 | 10–20 m | cars, vans | road + wood, triangles, trusses above/below the deck; tutorial hints |
| Timber & Steel | 6–10 | 20–28 m | cars, vans, buses | uneven banks, long wood trusses, steel (8) |
| Piers & Cables | 11–20 | 28–45 m | vans, buses | piers (11), rope (14), arches (15), cable (16), ship channels (18) |
| Shipping Lanes | 21–30 | 46–70 m | buses, trucks | reinforced road, clearance zones, towers, cable-stayed & suspension |
| Heavy Haul | 31–40 | 70–100 m | trucks, semis | heavy convoys, few/no piers, deep canyons |
| Grand Spans | 41–50 | 100–150 m | semis, tankers, heavy | long arches, cantilevers, multi-span cable bridges — finale |

**Every level is verified solvable** (`node tools/verify-levels.js`), with two designs per level:
- `tools/solutions/level-NN.json` (reference): passes, peak stress ≤ 0.92, cost ≤ budget;
- `tools/solutions/level-NN-best.json`: passes, peak stress ≤ 0.99, cost ≤ 70 % of budget (★★★ reachable).
Both must be valid, editor-buildable (joints on the 0.25 m grid, ≥ 0.6 m apart) and free of floppy parts
(no joint drifting > 1 m while nothing breaks). Budgets: reference ≤ ≈ 88 % of budget, best ≤ 70 %
(≤ 68 % on 41–50). No template may reach ★★★.

## 6. Implementation plan (workflow waves)

**Wave 1 — Build** (parallel, coded against this spec):
- Engine (materials, vehicles, model, physics, harness, tests, 3 sample levels + solutions) — strongest model
- Renderer + effects — visual quality focus
- Editor + templates
- Shell: index.html, css, hud, audio, storage, main
Then **Integrate**: one agent wires everything in a real browser (Playwright), fixes contract mismatches.

**Wave 2 — Content & polish:**
- 5 level-design agents × 10 levels, each iterating designs against the headless sim until verified.
- Review: gameplay/UX + visuals via screenshots; physics robustness. Then fix pass.
- Final: `node tools/verify-levels.js` all green + browser smoke test.

## 7. Assets

- **Sprites are hand-written SVG** in `assets/sprites/` (one file per vehicle type, e.g. `car.svg`,
  facing right, wheels drawn **separately** as `wheel.svg` / `wheel_heavy.svg` so they can rotate;
  plus `anchor.svg`, `joint.svg`, UI icons in `assets/icons/`). Vehicle SVG viewBox in units where
  1 unit = 1 cm, origin bottom-left at the rear bumper on the ground line, so the renderer can scale exactly
  by `def.length`. `BG.Sprites` (in renderer) preloads them as `Image`s; if one fails to load the renderer
  falls back to vector drawing.
- **Backgrounds** are generated with ComfyUI (comfy-studio MCP `generate_image`, aspect 21:9, ~2 MP),
  one painterly far-background per theme: `assets/bg/<theme>.jpg` (convert to JPEG ≈ quality 0.85,
  ≤ 600 KB). Drawn as the farthest parallax layer behind procedural mid-layers, water and terrain.
  Missing image → procedural gradient sky fallback.
- Loaded via `<img>`/`Image` (works on file://; never read pixels back from the canvas).

## 8. Tooling rules

- **Never open a visible window.** Browser checks only via `node tools/shot.js out.png [eval.js] [waitMs]`
  (headless Chrome via local Playwright). Do not use the Playwright MCP browser tools, `start`, or
  `explorer`. Write screenshots to the scratch/temp dir, not the project. The one exception is the documentation
  set in `docs/screenshots/`, which only `node tools/screenshots.js` writes (deterministic scenes; GIF via `tools/gif.js`).
- Node 24 available; no Python.

## 9. Iron Road — railway campaign (extension)

A separate 20-level campaign of railway bridges with ever larger trains. Road campaign (levels 1–50) must
keep working unchanged: **`node tools/verify-levels.js` must stay 100% green for road levels** after any
engine change (re-verify; if a shared change breaks a road design, fix the engine change, not the level).

### 9.1 Levels & campaign
- Rail levels use ids **101–120**, files `tools/levels/level-101.json` … with `campaign: 'rail'`
  (road levels: `campaign` absent or `'road'`). Solutions `tools/solutions/level-101.json` / `-best.json`.
- Unlock: level 101 unlocks when road level 10 is completed (or `?unlockall`). Inside the campaign the
  usual rule (previous one or two completed; each line's last level 105 / 110 / 115 / 120 is a gate, §15) applies, on ids 101–120.
- Chapters (5 levels each): 101–105 "Branch Lines" (handcar, tram, light steam; short spans, learn derail
  limits), 106–110 "Stone & Steam" (steam + coaches, masonry viaducts over valleys), 111–115 "Freight Corridor"
  (commuter, long freight, ore trains; whole span loaded; deep steel trusses, cantilevers),
  116–120 "High Speed" (high-speed trains, speed impact, double-deck road + rail finale).
- Level select gets campaign tabs: **Roads** / **Iron Road** (locked tab shows "Complete level 10"); since the
  integration all campaigns share one tab system (§15).
- New traffic entry form: `{ type: 'train', train: '<preset id>', count, interval }`. Road vehicle entries may
  be mixed in on double-deck levels (they drive on `road` beams; trains only on `rail` beams).
- Optional level field `rail: { maxGrade: 0.04, maxKinkDeg: 3 }` overrides derail thresholds.
- Stars as in §1, except ★★★ on a rail level also needs the "Structure held" verdict (no broken member).
- Verification (`verify-levels.js`) adds a ride margin on rail levels: `sim.ride.kinkRatio` ≤ 0.95 (reference) / ≤ 1.0
  (best), `sim.ride.gradeRatio` ≤ 1, and the best design passes with no broken member. Bests on 116–120 sit at ≈ 67 % of
  budget. `test-templates.js` checks that no offered template earns ★★★ on 101–120.

### 9.2 Materials (new)
- `rail` — track deck: `isRail: true`, `isRoad: false`; ballasted deck with sleepers, heavier and stiffer
  in bending than road. Trains ride only on rail; road vehicles only on road / reinforced_road.
- `masonry` — stone: cheap, very heavy, enormous `compressionLimit`, near-zero `tensionLimit`, short
  `maxLength` (≈ 5 m). Makes classic arch viaducts the efficient answer.
- Engine owner may add one more if needed for the 2000 t ore trains (e.g. `girder` — heavy steel box
  girder, expensive, strong, max 12 m). Allowed per level via `materials`.

### 9.3 Trains (new) — `js/core/trains.js`
- `BG.RailCars` keyed by car type: `handcar`, `tram`, `loco_steam`, `tender`, `coach`, `loco_diesel`,
  `boxcar`, `tank_wagon`, `ore_wagon`, `hs_power`, `hs_coach`. Each `{type, name, length, height,
  bogies:[{x, axles:[dx...], mass}], couplerHeight, color}` (bogie x from rear of car, m; sum of bogie
  masses = car mass).
- `BG.Trains` presets: `{id, name, cars:['loco_steam','tender','coach','coach'], speed, accel}` —
  ids: `handcar`, `tram`, `steam_local`, `steam_express`, `commuter`, `freight_short`, `freight_long`,
  `ore`, `highspeed`, `highspeed_long`. Masses from ~1 t (handcar) to ~2000 t (ore) — engine owner tunes
  so the campaign is solvable at sane costs.
- Physics: each car is a rigid body (like road vehicles) with flanged wheels (cannot leave the rail
  laterally; in 2D: wheels are held to the rail surface — they cannot bounce off it), cars linked by
  couplers (XPBD distance + slack). Locomotive(s) provide traction/braking toward target speed; all axle
  loads go into the rail beams' end joints exactly like road wheel contacts.
- **Derailment** (new fail reason `derailed`, event `{type:'derail', i, x, y}`): a car derails if, under any
  of its wheels, the rail grade exceeds `maxGrade` for > 0.3 s, or the kink under a bogie is over its limit, or the
  rail is missing / broken under a wheel. Kink = angle between the rail segments under a bogie's first and last axle
  (single-axle bogies: the car's first and last wheel), judged once per passage over a joint on the **mean** of
  kink / limit over that passage (a long straddle closes every 1.5 axle spacings of travel or `RailRules.kinkWindow`
  = 1 s); limit = `maxKinkDeg` up to `kinkRefSpeed` (15 m/s), × 15 / v above it. The verdict does not depend on how
  many 1/60 s steps a bogie spends over a joint, and on rigid track a slower train never fares worse. A derailed
  car tumbles physically (drags its coupled neighbours) — dramatic but stable.
- `sim.vehicles` entries for trains: `{kind:'train', type:'train', preset, cars:[{type, def, x, y, angle,
  wheels:[{x,y,r,rot}], state}], state, ...}`; road vehicles get `kind:'road'`. Finish = last car's rear
  passes `rightEdge + 15`. Trains spawn so the whole consist starts on the left bank.
  Mixed traffic (double-deck levels) shares the bank approaches: a train waits to spawn until it can no longer catch
  any road vehicle ahead of it before that vehicle leaves the world (rear past `rightEdge + 120`, both at cruise
  speed, + 10 m), and a road vehicle waits the same way behind a slower train. Levels list the fast train first.

### 9.4 Rendering, audio, UI
- SVG sprites in `assets/sprites/rail/` per car type (wheels/bogies separate so they rotate; steam loco
  connecting rods animated), same coordinate rules as §7. Steam loco smoke plume, diesel exhaust, sparks at
  derailment, sleepers + rails + ballast drawn on rail beams, masonry beams drawn as stone voussoir blocks,
  catenary masts decoration on high-speed levels, distant railway scenery details in themes.
- Audio: horn (steam whistle / diesel horn / high-speed chime), clickety-clack per rail seam scaled by
  speed, steam chuff, brake squeal, derail crash.
- **Camera follow** (both campaigns): sim-controls toggle "Follow" (key F) that smoothly tracks the lead
  vehicle/train with comfortable zoom; default ON for gaps > 60 m. Fixes tiny vehicles on big spans. A live train is preferred over road traffic as
  the target. The renderer keeps its world scenery cache while following (rendered with a margin, blitted with a
  translation, scaled during zoom transitions) and holds the follow zoom in a ±6 % dead band, so the cache is not
  rebuilt every frame.
- Templates: add `viaduct` (masonry arches on piers) and make existing templates use `rail` deck on rail levels.
- HUD traffic chips show train icons with car count ("Ore ×24").
- Derailment explainer (display only, `js/ui/railinfo.js` = `BG.RailInfo`): the sim exposes read-only readouts that never
  feed back into the state (`sim.ride` worst grade / kink-vs-limit / sag while running; `.detail = {reason, wheel, wx, wy, seg,
  segPrev, value, limit, speed}` on derail events and `sim.firstDerail`; `sim.beams[j].peakTension` for masonry). `sim.ride.kinkRatio` is the same
  passage-mean kink / limit the derail rule judges (with `kink`, `kinkLim`, `kinkSpeed` of that passage). The UI shows a
  track-recording strip (key T, default on for rail levels), a slow-motion freeze-frame with the offending wheel + segment
  highlighted and a cause callout, two verdicts + a ride-quality card (A–F) in the results, and masonry tension glow + cracks.

## 10. Terrain fix — what you see is what you can build (feature/terrain-fix)

Players could build joints in what looked like rock under the water. Cause: the renderer's decorative
"receding valley walls" (`R._drawValleyBack`) were drawn as sloped, lit, stratified rock reaching far
into the gap and showing through the water, while `BG.Model`'s terrain is vertical cliffs at
`leftEdge`/`rightEdge` down to `floorY`.

- **Rule (BG.Model).** A user joint may not lie below `terrain.waterY` (lava counts as water):
  `validate` reports `{type:'underwater', msg: BG.Model.UNDERWATER_MSG, nodeId}`. The waterline itself is
  legal. Anchors and pier tops may be under water, and so may beams between them (a beam's lowest point is
  an endpoint, so no separate beam check is needed). Helpers: `BG.Model.belowWater(level, x, y, tol)`,
  `BG.Model.UNDERWATER_MSG` ("Can't build under water — use a pier"). All 100 solution designs already
  kept every joint at or above the waterline. Levels whose build area reaches under water: 11, 13, 14, 18, 30.
- **Editor.** `_pointProblem` returns `'underwater'` (so ghosts go red, joint drags clamp at the waterline,
  mirror partners are not created there); a rejected placement for that reason toasts `UNDERWATER_MSG`.
  The renderer's ghost label shows the same text.
- **Rendering.** Valley walls are distant scenery: narrow (reach ≤ 22 % / 12 % of the span), washed into the
  theme fog, soft (canvas blur), no rim lights/strata, clipped above the waterline and extra faint above the
  lowest buildable height. The drawn cliff faces bulge at most 0.4 m into the gap above
  `max(waterY, buildArea.y0)` (inside the 0.5 m joint clearance) and flare into scree only below it.
- **Overlay (`js/features/terrain-fix.js`, `BG.TerrainFix`).** `limitBand(level)` → `{x0,x1,y0,y1}` or null;
  `drawWaterLimit(renderer, ctx, state)` draws a dashed waterline + hatched "piers only" band (edit mode,
  only where the build area reaches below the water). Called from one hook line in `R.render`.
- Tests: `tools/test-terrain-fix.js`. Iron Road levels (§9) inherit the rule automatically (re-verified at the
  merge: all 40 rail reference/best designs keep every joint at or above the waterline; rail levels whose build
  area reaches under water: 107, 108, 109, 116). Rail levels that want joints below the water would need a level
  flag (not added). Dry volcanic levels (rail 110: lava theme, no `waterY`) draw no lava glow.

## 11. Challenge badges (goals beyond stars)

Optional per-level challenges shown in the results modal, the level tile and an in-level **Goals** panel.
They never affect stars or unlocking; they are pure bragging rights stored in `BG.Storage`.

### 11.1 Files
```
js/features/goals.js       BG.Goals  — pure evaluation, browser + Node (no DOM)
js/features/goals-data.js  BG.GoalsData = { [levelId]: [ {type, ...params} ] }   GENERATED by tools/gen-goals.js
js/features/goals-ui.js    UI + persistence; wraps BG.Hud (enterLevel, update, showResults, hideResults,
                           buildLevelSelect, refreshTitle) and extends BG.Storage — no edits to shared JS
css/goals.css              assets/icons/badges/<icon>.svg (hand-made medallions)
tools/gen-goals.js         proves + picks goals;  tools/test-goals.js re-verifies them
tools/solutions/goals/level-NN-<goal>.json   a design that passes the level AND earns that badge
```

### 11.2 Evaluation
`BG.Goals.evaluate(level, design, simSummary)` -> `{ passed, metrics, goals:[{id,type,name,icon,desc,met,candidate,text,frac}], earned:[ids] }`.
`passed` = sim success AND cost <= budget; **no badge without a pass** (`candidate` = condition currently satisfied).
`BG.Goals.register(levelId, specs)` adds/overrides specs at runtime (overrides `BG.GoalsData`); `BG.Goals.TYPES` holds
the goal catalogue. A goal id is its type, unique per level.

| type | params | met when |
|---|---|---|
| `minimalist` | `max` | member count <= max |
| `penny` | `ratio` | cost <= ratio x budget |
| `featherweight` | `maxMass` (kg) | sum(beam length x massPerMeter) <= maxMass |
| `cool_head` | `max` | sim peak stress <= max (needs a finished run) |
| `symmetric` | - | every member and pier has a mirror twin about x = (leftEdge+rightEdge)/2 (0.02 m tolerance) |
| `no_steel` | - | no steel beams |
| `timber_only` | - | only road and wood |
| `no_piers` | - | no piers |
| `smooth_ride` | `max` | railway run: worst kink / limit (`sim.ride.kinkRatio`) <= max (needs a finished run) |

### 11.3 Generation + proof
`node tools/gen-goals.js` (parallel, a few minutes) builds a candidate pool per level from the reference/best solutions,
templates, material substitutions, mirror rebuilds and greedy member pruning; every candidate must pass the level
(valid, in budget, editor-buildable, no floppy parts, peak <= 0.99). A goal is only offered if a candidate meets it;
thresholds come from the best candidate plus slack (members +8 %, mass +6 %). 2 goals on levels 1-5, 2-3 later.
Iron Road levels 101-120 are covered the same way (generated at the merge with `--only 101,...,120`; 58 goals): the
rail sim decides the pass (derailments fail it), `timber_only` is never offered there (the deck needs `rail`).
Bonus levels 51-53 (§12.4) were added the same way at their merge (`--only 51,52,53`; 8 goals, proven with
the level's wind / quake events on, seed 1 as in the game).
The 10 playable Famous Bridges levels (§14) were added at their merge (`--only 201,...,212` without the stubs 205/209;
28 goals). At the cross-feature integration the goal type `smooth_ride` (railway levels: `sim.ride.kinkRatio` <= `max`,
the worst kink as a share of its limit; `BG.Goals.metrics` reads `.ride` from a summary or `.sim.ride` from a run, goals-ui
passes `sim.ride` along) was added and goals were regenerated for 101-120, 205 (Forth) and 209 (Tacoma; with its wind on):
Iron Road 59 goals (15 Smooth Ride), Famous Bridges 34. An "All Stone" (masonry-only) goal was tried and dropped: every
all-masonry variant of the stone-viaduct designs (106-110) derails or cracks, so no design proves it.
The Anchorages bonus levels 54-58 (§17.7) were added at their merge (`--only 54,55,56,57,58`; 14 goals).
The level select shows tile counts on every campaign tab (famous tiles too); the total chip counts all 90
levels (248 goals; hidden bonus levels count once revealed).

### 11.4 Storage
`BG.Storage.getBadges(id)`, `recordBadges(id, ids)` -> newly earned, `totalBadges()`, `maxBadges()`; key `span.v1.badges` =
`{ [levelId]: [goalId] }`. Keyed by level id, so campaign levels work unchanged. `resetProgress()` clears badges too.

## 12. Forces of Nature — wind & earthquake events (extension)

Optional per-level weather. **A level without `events` must simulate bit-identically to the engine without
this feature** (`node tools/test-events.js` compares against a pristine engine copy; `--full` checks every
road and rail design; at the merge with the Iron Road all 140 road + rail designs were also compared against
the pre-merge engine: bit-identical).

### 12.1 Level field
```js
events: [
  { type: 'wind', start, duration, speed /* m/s */, gust /* 0..1.5, default 0 */, dir /* +1 → +x, -1 */,
    period? /* s per gust cycle, or [from, to] = linearly swept rhythm */, lift? /* CL amplitude, default
    0.5 turbulent / 0.3 periodic */, rain? /* visual */, label? },
  { type: 'quake' /* alias 'earthquake' */, start, duration, magnitude /* default 6.5 */, freq /* Hz, default 1.5 */,
    vertical? /* vertical / horizontal ratio, 0.5 */, waveSpeed? /* m/s, 300 */, pga? /* g, overrides magnitude */, label? },
]
```
`{ preset: 'tacoma' | 'gale' | 'storm' | 'quake', ...overrides }` expands a `BG.Forces.presets` entry (level JSON can't call
functions; level 209 uses it). Unknown types are ignored. Events may overlap. Peak ground acceleration from magnitude: `0.1 g · 2^(M − 6)`
(M6 0.1 g, M7 0.2 g, M8 0.4 g).

### 12.2 Physics — `js/core/events.js` (`BG.Forces`)
- Plugs in through **`BG.SimHooks`**: an array of factories `(sim) => extension | null` that `BG.Simulation`'s
  constructor calls; extensions may implement `beginStep(sim)`, `substep(sim, h, s)` (start of each XPBD
  substep, before integration) and `endStep(sim)` (after `_postStep`, before `_syncOut`). With no extension,
  `sim._ext === null` and no hook code runs. Other features may register their own hooks the same way.
- Deterministic: seeded by `sim.seed`, own sine (`BG.Forces.sinDet`, basic IEEE ops only), fixed order.
- **Wind** is a crosswind with an in-plane component `dir`. Per member and axis, drag from the projected
  length normal to that axis and the *relative* air speed (so drag also damps sway):
  `Fx = ½ρ·Cd·D·|Δy|·rx|rx|`, `Fy = ½ρ·Cd·Dv·|Δx|·ry|ry|`; decks (`isRoad`/`isRail`) also get lift
  `Fy += ½ρ·V²·B·|Δx|·CL·g(x, t)` over their chord B. `D` = exposed depth (decks and cables catch more than their
  drawn width), coefficients in `BG.Forces.AERO` (per material id, `DECK` fallback). `g` is the gust signal,
  convected downwind at the wind speed (frozen turbulence: a travelling wave along the deck that excites
  symmetric and antisymmetric modes): smooth seeded turbulence, or `sin` of the (swept) `period`. Gusts also
  modulate speed: `V = dir·speed·env(t)·max(0, 1 + gust·g)`; 1.5 s ramps in and out. The field is sampled at
  member midpoints once per 1/60 s step; drag is applied every substep. Vehicles get frontal-area drag along
  x (head wind slows them; cruise control caps tail wind).
- **Quake**: every fixed joint (anchors, pier tops) follows a seeded displacement series
  `d(t − (x − leftEdge)/waveSpeed)`: four incommensurate sines near `freq` (vertical at 1.6 × freq), smooth
  envelope (rise ≤ 1.5 s, decay over the last 45 %), scaled so the peak ground acceleration ≈ PGA. The terrain
  collider (`sim.terrain` edges/heights and `sim.ground` segments) and `sim.piers` move with the ground; the
  bridge feels the shaking through inertia. While the ground shakes (+1 s) the `vehicle_jumped` airborne
  timer is held at zero (a bucking deck tossing traffic is not a ramp jump).
- Live state `sim.forces = {time, list, wind:{v, speed, gust, active, event}, quake:{dx, dy, ax, intensity,
  active, event}}`; sim events `wind_start {index, speed, dir, label}`, `wind_end`, `quake_start {index,
  magnitude, label}`, `quake_end`.
- API: `normalize(events)`, `timeline(level|events)` → `[{type, start, end, label, short, warnAt, ev}]`,
  `label(ev)`, `attach(sim, events)` (add events to a sim built without them — e.g. a famous-bridges
  scenario), `windSpeed(ev, t, seed, x?)`, `groundOffset(ev, x, t, seed)`, `presets.gale/storm/tacoma/quake(o)`.
  **Tacoma Narrows:** `BG.Forces.presets.tacoma({ period })` — set `period` to the deck's first antisymmetric
  vertical mode (a plain suspension deck with ~10 m sag: ≈ 2.2 s; use `[from, to]` to cover a band).

### 12.3 Presentation — `js/features/forces-fx.js`, `css/forces.css`
Wraps (does not edit) `Renderer.render` / `Renderer._drawShips`, `Hud.enterLevel` / `Hud.update` and
`Game._onSimEvent`. Visuals: wind streaks, flying leaves, rain + storm grade + lightning, swaying trees,
windsock, flag and tower pennants; quake camera rumble, cliff dust and pebbles, cracks growing in the banks.
HUD: forecast chip, warning banner 3 s before an event, live banner, event timeline on the sim bar. Audio:
wind howl + whistle, quake rumble, thunder, warning chirp (own WebAudio nodes on `BG.Audio.context`).

### 12.4 Bonus chapter "Forces of Nature" (levels 51–53)
Hidden in level select until one of its levels is unlocked (finish 50, the Roads finale - a gate, §15); chapter entry
`{n: 7, from: 51, to: 53, hidden: true}` is pushed onto `BG.Hud.CHAPTERS` by forces-fx.js. 51 Hurricane Alley
(wind 34 m/s headwind + gusts: plain-road stayed decks fail by uplift/bending), 52 Fault Line (M8 quake),
53 Galloping Gertie (swept resonant wind: slender suspension decks gallop to failure, stiffened ones pass).
Verified like every level (reference + best); no template reaches ★★★ (checked by test-events.js).
The chapter is a Roads-tab chapter (levels 51–53 have no `campaign`, so they are road levels for unlocking and
stars). Until it is revealed its levels are left out of the Roads star total and the badge total
(`BG.Hud.hiddenLevelIds()`; used by hud.js and goals-ui.js), so the level select reads "/ 150" on a fresh profile.

## 13. Daily Challenge & procedural levels (extension)

A generated level per calendar day plus an Endless mode. Campaign levels, progress and verification are untouched.

### 13.1 `BG.Generator` — `js/core/generator.js` (core: browser + Node, no DOM)
```js
BG.Generator.generate(seed, opts)      // -> level (SPEC §4.3 shape) + level.generator meta; synchronous
BG.Generator.createJob(seed, opts)     // -> job; job.step(ms) -> done?; job.level | job.error; job.progress
BG.Generator.generateAsync(seed, opts, done(err, level, job), onProgress)  // rAF / setTimeout slices
BG.Generator.daily(dateOrSeed)         // daily level; seed = YYYYMMDD (player's local date)
BG.Generator.dailyOpts(seed) / endlessOpts(runSeed, k) / endlessSeed(runSeed, k)
BG.Generator.dailySeed(date), dailyDifficulty(seed), weekdayOf(seed) /* 0 = Mon */, dateLabel(seed), addDays(seed, k)
// opts: { difficulty 0..1, mode: 'daily'|'endless'|'custom', id, index, name }
```
- **Deterministic:** own mulberry32 PRNG + `Math.imul` hash; only IEEE basic ops and `sqrt` (no `Math.random`,
  no transcendental functions). The same seed + `BG.Generator.VERSION` gives a bit-identical level everywhere.
  Bump `VERSION` whenever the output changes (it invalidates browser caches).
- **Difficulty:** daily difficulty = weekday curve Mon 0.08 → Sun 0.88 (± 0.035 per date). Endless crossing k:
  `0.06 + 0.075 k` (capped at 1).
- **Level ids:** `'daily-YYYYMMDD'`, `'endless-<runSeed>-<k>'` (strings, never in `BG.Levels`); `templates: false`.
- **Road levels only:** no `campaign` (so never an Iron Road level, §9), no rail materials or train traffic, and no
  `events` (§12). Generated levels have no badge goals (§11; the goals UI hides itself when a level has none).
  `tools/test-generator.js` asserts the road-only rule on every generated level.
- **Solvable by construction:** an in-generator solver builds editor-buildable parametric trusses (0.25 m grid;
  Pratt / Warren; above, below or both sides; 1–2 tiers; wood / steel; road / reinforced road; 0–2 piers),
  validates them with `BG.Model.validate` and runs them headless in `BG.Simulation` (seed 1). A candidate passes
  on `success` with peak stress ≤ 0.92 (early abort as soon as the peak exceeds it). Families are tried
  cheapest-first by their strongest variant, then the passing family is binary-searched for cheaper variants.
  `budget = ceil(cost / 0.75 / 50) * 50`, `timeLimit = max(25, ceil5(1.3 t + 6))`. If no candidate passes, the
  level is adjusted deterministically (more materials → pier zone → lighter traffic → shorter gap → re-roll).
- `level.generator = { version, seed, difficulty, mode, archetype, attempt, sims, date?, index?,
  solution: { design, kind, cost, peak, time, params } }` — the proof design (not shown to the player).
- `node tools/test-generator.js`: 365 consecutive days + 200 random seeds; asserts well-formed levels, valid
  editor-buildable solutions, re-verified pass on the final level, `0.70 < cost/budget ≤ 0.75`, determinism
  (repeat + time-sliced job == sync), rising weekday curve, p95 generation time ≤ 2 s; prints distributions.

### 13.2 `BG.Daily` — `js/features/daily.js` + `css/daily.css`
- Title button "Daily Challenge" (date, today's stars, streak) opens the daily panel: today's crossing (name,
  thumbnail, gap, traffic, budget, weekday difficulty pips), today's best, streak / best streak, 14-day history
  (click a past day → practice), Play, Copy result, Endless (continue / new run).
- Integration is by **wrapping** public methods (no edits to shared files beyond `index.html` tags):
  `BG.Game.findLevel` (resolves generated ids), `nextLevel` (daily → panel, endless → next crossing),
  `goLevelSelect` (from a generated level → title + panel), `resetProgress` (also clears daily/endless), `init`
  (URL helpers); `BG.Storage.recordResult` (generated ids → daily/endless records, never campaign progress),
  `setLastLevel` (ignores generated ids); `BG.Hud.init` (inject UI), `refreshTitle`, `enterLevel` (DAILY /
  ENDLESS badge), `showResults` (share card / run score, "Daily menu" / "Next crossing").
- Storage keys (`BG.Storage.get/set`): `daily` = `{ days: { YYYYMMDD: { name, budget, gap, difficulty,
  attempts, passed, stars, cost, members, practice? } }, bestStreak }`; `endless` = `{ best:{cleared, stars},
  run:{seed, index, cleared, stars, starsBy}, runs }`; caches `dailyCache` (today) and `endlessCache`
  (current crossing), both keyed by `VERSION`. Designs use the normal `design.<id>` keys (old ones pruned).
- Streak = consecutive days whose daily was passed **on that day**; today still open does not break it.
- Share text: `SPAN Daily #<n> · <Ddd D Mon YYYY>` / `🌉 <name> · <gap> m` / `★★☆ · 82% of budget · 24 members` /
  10-cell emoji bar (🟩 ≤ 70 %, 🟨, 🟧, 🟥, ⬜) / `🔥 N-day streak`. Clipboard API with `execCommand` fallback.
- Generation in the browser runs time-sliced on `requestAnimationFrame` (6 ms slices while prefetching on the
  title screen, 80 ms while the player waits behind the loader); no Web Worker, because `file://` pages
  cannot load worker scripts reliably in every browser (slicing never changes the result). `node tools/test-daily.js` covers records + the headless browser flow.

## 14. Famous Bridges — real-world campaign (extension module)

A separate campaign of real bridges, each preceded by a history card. Lives in new files
(`js/features/requirements.js`, `js/features/famous.js`, `css/famous.css`, `assets/famous/*.svg`,
`tools/test-famous.js`). Since the cross-feature integration it is an ordinary campaign of the shared campaign
system (§15): `BG.Storage.CAMPAIGNS.famous` holds its rules, `BG.Hud.registerCampaign('famous', ...)` its tab, so it
is never part of the Roads (unlocking, "next level", continue, star totals).

### 14.1 Levels
- Ids **201+**, `tools/levels/level-2NN.json`, `campaign: 'famous'`, built into `BG.Levels` by `build-levels`
  like every other level (sorted by id, after road and rail levels). Solutions `tools/solutions/level-2NN(-best).json`;
  same verification rules as road levels (ref peak ≤ 0.92 and ≤ ≈ 88 % of budget, best ≤ 70 %, no template ★★★ —
  checked over *all* templates, not only the offered ones, by `tools/test-famous.js`).
- Each level is a scaled-down but faithful version of the real crossing (span ratios, pier positions, ship channel,
  traffic) set up so the historical structural type is the efficient answer.
- Extra level fields:
  - `history: { name, year, built, location, crosses, engineer, span, type, facts: [2–3 strings], why, note?, art }`
    where `art` is the SVG illustration path (`assets/famous/<slug>.svg`, 400 × 200, used on the card and the tile).
  - `requires: ['wind' | 'rail' | 'masonry' ...]` — optional modules the level needs (see 14.3).
  - `stub: true | 'what is missing'` — the level is not finished (no verified solutions yet) even though its
    modules may be installed: it is locked and skipped exactly like a level with a missing module (14.3).
  - `templates` may be an **array of template ids**: only those (history-appropriate) templates are offered.
    `famous.js` wraps `BG.Templates.available` in the browser to flag the others `ok: false`; `true`/`false` keep
    their old meaning.
- All twelve are playable: 201 Pont du Gard, 202 Ponte Vecchio, 203 Iron Bridge, 204 Brooklyn, 205 Forth Bridge,
  206 Tower Bridge, 207 Sydney Harbour, 208 Golden Gate, 209 Tacoma Narrows, 210 Akashi Kaikyō, 211 Øresund, 212 Millau.
  The two former stubs were finished at the cross-feature integration:
  - **205 Forth Bridge** (`requires: ['rail']`, rail / steel / wood, one `steam_express`, three pier zones, two shipping
    channels clear below the deck). The verified designs stand a tall pier in each zone (top 15 m above the track) and
    hang a deep steel truss from it - 15 m over the piers, 6-8 m over the channels: three balanced cantilevers. Budget
    $245k: reference 0.71 (peak 0.87, kink 0.26 of its limit), best 0.69 (peak 0.94, kink 0.41, structure held).
    Rail rules apply to any level with train traffic (track strip, ride verdicts, "structure held" for ★★★).
  - **209 Tacoma Narrows** (`requires: ['wind']`): `events: [{ preset: 'tacoma', period: [3.6, 2.6], lift: 0.4 }]` -
    `BG.Forces.presets.tacoma` (19 m/s, gust 0.15, 30 s from t = 4 s) with a swept gust rhythm over the slender deck's
    modes. Budget $86k: reference 0.83 (fan stays + cable hangers + diagonal rope hangers, peak 0.57), best 0.68 (lower
    towers, peak 0.69). The lesson is checked by `test-famous.js`: the same bridges without their diagonal hangers (a
    plain suspension deck) pass in calm air but gallop to a bending failure in the wind; the suspension template fails.
- Badge goals (§11) exist for every famous level (`node tools/gen-goals.js --only 201,...`); the famous tiles get the
  same badge count as road tiles (goals-ui decorates every campaign's tiles).
- Pont du Gard is historically masonry: once §9.2 `masonry` exists, add it to level 201's `materials`
  and re-verify (the current solutions use wood/steel).

### 14.2 Campaign rules (`BG.Storage.CAMPAIGNS.famous` + `BG.Famous`, js/features/famous.js)
- Unlock: the first playable famous level opens when **road level 15** is completed (or `?unlockall`); inside the
  campaign a level opens when either of the two previous *playable* famous levels is complete (stubs are skipped).
  The bridges run in date order with no chapters, so only the finale (212) is a gate.
  This is the shared rule of §15 (`unlockAfter: 15`); `BG.Famous.isUnlocked` just asks `BG.Storage`.
- `BG.Game.openLevel(famousId)` shows the history card first (Build it / Back; Enter/Space = build, Esc = back);
  `opts.skipCard` skips it. Levels with unmet requirements never open, even with `force` / `?unlockall` —
  their card explains which module is missing (or that the crossing is still a stub).
- `nextLevel` / results `hasNext` / finale stay inside the campaign (next playable famous id; after 212 the
  finale, then back to the Famous Bridges tab) - all through §15, nothing famous-specific.
- Level select: the third campaign tab **Famous Bridges** (`.camp-tab[data-camp=famous]`), registered with
  `BG.Hud.registerCampaign('famous', { render, modeClass: 'fb-mode', panelClass: 'fb-panel', ... })`: while it is
  active the Hud hides the chapters and `BG.Famous.tab.render(panel)` fills the `.fb-panel` with picture tiles
  (`.fb-tile[data-fbid][data-id]`). `BG.Game.goLevelSelect()` reopens the tab of the level just played.
- In a famous level the top bar badge shows the campaign number (1–12), the subtitle "Famous Bridges · year · place",
  and a history button reopens the card.

### 14.3 Requirements (`BG.Requirements`, js/features/requirements.js — browser and Node)
- `has(req)`, `missing(level)`, `isStub(level)`, `met(level)` (= not a stub and nothing missing), `label(req)`,
  `provide(req)`, `register(req, checkFn, label)`.
- Default detection: `wind` → `BG.Forces` (§12.2; also `BG.Events || BG.Weather || BG.Wind`); `rail` →
  `BG.Trains && BG.Materials.rail` (§9); `masonry` → `BG.Materials.masonry`. A module may also call
  `BG.Requirements.provide('wind')`.
- `tools/harness.js` loads it; `verify-levels`, `test-templates`, `test-goals` and `e2e-goals` skip levels that are
  not `met` (stubs).

## 15. Campaigns — one system for every campaign (cross-feature integration)

After the Iron Road, terrain fix, goals, weather events, daily challenge and Famous Bridges were merged, the
campaign logic that each feature had grown separately was folded into one system.

- **Rules: `BG.Storage.CAMPAIGNS`** (js/ui/storage.js) - `road {first 1, last 50, bonusLast 53, bonus: [{id 'anchorages', first 54,
  last 58, unlockAfter 40}]}`,
  `rail {first 101, last 120, unlockAfter 10}`, `famous {first 201, last 212, unlockAfter 15}`, order
  `CAMPAIGN_ORDER = ['road', 'rail', 'famous']`. `campaignOf(level)` (`level.campaign`, absent = road),
  `isPlayable(level)` (`BG.Requirements.met`), `campaignLevels(levels, c)` (playable, by id: the unlock and "Next"
  order), `isCampaignUnlocked(c)`, `campaignLockText(c)`, `campaignStars`, `isUnlocked(id, levels)` (unplayable
  levels never open, not even with `?unlockall`), `finaleOf(level)` → `'road' | 'bonus' | 'anchorages' | 'rail' | 'famous' | null`.
  `js/main.js` and `js/ui/hud.js` delegate `campaignOf` to it; no other file decides unlocking.
- **Unlock rule** (`BG.Storage.isUnlocked`, tested by `tools/test-unlock.js`): a level opens when either of the two
  levels before it in its campaign is complete (skip one hard crossing, come back later), **but never past an
  unfinished gate**. Gates (`isGate(level)`) = each campaign's `gates` (the chapter / line ends: road 5, 10, 20, 30, 40,
  50; rail 105, 110, 115, 120; famous none) plus its `last` and `bonusLast`; so 21 needs 20 and the bonus chapter needs
  50. Daily / endless levels are not in any campaign list and are unaffected. Helpers: `isSkipped(id, levels)` (open,
  unfinished, a later level of the campaign done), `lockText(id, levels)` ("Complete level 20 first - chapter finales
  can't be skipped."), `unlockRuleText(campaign)`.
- **Branching bonus chapters** (`CAMPAIGNS[c].bonus`; the Anchorages, 54-58): a chapter that branches off a campaign's main line.
  `bonusChapterOf(level)` names it, `unlockList(levels, level)` is the list a level unlocks along and **Next** follows (the
  chapter's own levels, or the main line without any branching chapter). Its first level opens once `unlockAfter` is complete,
  then the either-of-two rule applies inside the chapter; none of its levels is a gate, finishing one never opens or "skips"
  a main-line level, and finishing `last` is its own finale (`finaleOf` → the chapter id, `'anchorages'`; hud.js
  `CAMPAIGN_UI.road.bonusFinales`, styled like the Forces of Nature finale). A result that opens such a chapter carries
  `bonusOpened: [ids]` and toasts "A hidden chapter has opened: Anchorages (levels 54–58)". The migration skips these
  chapters (they postdate the gates). Its level-select chapter (`{n: 8, name: 'Anchorages', from: 54, to: 58, hidden: true}`)
  is in hud.js `CHAPTERS`; chapters are listed by their first level, so Forces of Nature (7) comes before it once both
  are revealed. Hidden levels stay out of the star / badge totals until revealed, as in §12.4.
- **Migration** (`migrateUnlocks(levels)`, run once by `BG.Game.init`; key `unlocks {v: 2, keep: [ids]}`): every level
  the old rule had open, or that was ever played, but that the gates would now lock stays open (`keep`); the gates
  only affect levels that were not open yet. Reset progress empties `keep`; a save import without the key migrates
  again on reload.
- **Explained in the UI**: level tiles of skipped-but-open levels carry "Skipped — come back later" (`.tile-skip`, also
  on Famous Bridges tiles); gate tiles a small flag (`.tile-gate`); every chapter header (and the Famous Bridges intro)
  an (i) button (`.ch-info`, hover / focus tooltip on desktop, a tap toasts the rule); a pass that opens a level whose
  predecessor is unfinished toasts "Level N unlocked — you can skip one level (chapter finales can't be skipped)"
  (results carry `skipUnlocked`); a locked tile toasts `lockText`.
- **Looks: `BG.Hud.registerCampaign(id, ui)`** - Roads and Iron Road are built in; Famous Bridges registers itself.
  `ui = { name, sub, icon(), cls, levelK, levelNum(level), levelSub(level, gap), allLabel, maxDefault, chapters() |
  render(panel, info) + panelClass + modeClass, locked(), continueLabel(level), finale: {banner, title, text(starLine)} }`.
  The tab bar (`.camp-tabs`, one `.camp-tab[data-camp]` per campaign that has levels; locked tabs read "Complete
  level N"), header star chip, subtitle and the chapters / custom panel all come from it. The Roads tab includes the
  hidden *Forces of Nature* chapter (§12.4) once revealed; its levels stay out of the totals until then.
- **Game flow (`BG.Game`)**: `nextInCampaign` = next playable level of the same campaign (50 → 51 once the bonus chapter
  is open; 53, 120, 212 have none). Results carry `finale` / `finaleKind` (finales after 50 - "A hidden chapter has
  opened" when 51 follows -, after 53 "Forces of Nature weathered", after 120, after 212) and `campaignsOpened` (a toast
  announces the Iron Road / Famous Bridges the moment a result opens them). `continueTarget()`: the last level played if
  unfinished, else the first open unfinished level of its campaign, then of the other campaigns in order; the title's
  Continue label uses the campaign's `continueLabel` (famous: the bridge's name). Any level with train traffic is a
  railway level (track strip, ride card, "structure held" for ★★★), e.g. the Forth Bridge.
- **Title screen**: Play (level select), Continue, **Daily Challenge** and **Endless** (js/features/daily.js; the endless
  button continues the current run or starts one). Daily / endless results never touch campaign progress (§13.2).
- **Results modal layering** (`#screen-level .results`, inside `#ui`): `BG.Hud.showResults` fills banner, stars, stats and
  the campaign finale text; then the wrappers add, in this order, the badge reveal (`.res-badges`, goals-ui; only on
  levels with goals, so never on daily / endless levels) and the daily share card / endless score (`.dly-res`, daily.js;
  only on generated levels) - both inserted just above `.res-actions`, so they never overlap. Overlays above it:
  toasts (z 40), the famous history card (`.fb-overlay`, z 40; from a famous result's **Next** it opens over the
  results and Esc / Back returns to them), the daily panel and the settings modal (`.modal`, z 45). Each overlay owns
  the keyboard while open (capture-phase listeners), so Enter / Esc never reach the game underneath.
- Tests: `tools/e2e.js` (campaign tabs, unlock gates incl. chapter finales, skipped markers, the (i), the skip toast and
  the migration, Next / finale per campaign, Continue across campaigns, title entry points, results layering),
  `tools/test-unlock.js` (the rule in Node), `tools/test-famous.js`, `tools/e2e-goals.js`, `tools/test-daily.js`.

## 16. Mobile, PWA, History (extension)

Three feature modules, each a classic script in `js/features/` (+ a stylesheet in `css/`), loaded after
`js/main.js` **and after every other feature script** in this order: `history.js`, `pwa.js`, `mobile.js`
(stylesheets after every other stylesheet: `pwa.css`, `history.css`, `mobile.css` - `mobile.css` is always the
last stylesheet, so its touch rules win over feature styles of equal specificity). New features keep this order. They **hook** the core by wrapping existing methods (each wrapper calls
through to the original, so wrappers stack) and do not edit core files; desktop with a mouse is unchanged.
Shared-file touch points are commented `// mobile:` / `// pwa:` / `// history:`. Everything must keep
working from `file://` and without storage.

### 16.1 Touch layer — `BG.Mobile`, `BG.Perf` (`js/features/mobile.js`, `css/mobile.css`)
- Classes on `<html>`: `m-touch` (coarse primary pointer, or `?touchui=1`; `?touchui=0` forces it off),
  `m-phone` (touch + short side <= 520 px) / `m-tablet`, `m-portrait` / `m-landscape`, `m-lowperf`.
  **All touch CSS is scoped under these classes.** HUD elements added by other features must work under
  them: visible buttons >= 44 px, nothing outside the viewport (respect `env(safe-area-inset-*)`), and long
  lists scroll inside a container the touch guard accepts (`BG.Mobile.scrollers`: `.ls-scroll`, `.tpl-menu`,
  `.modal-card`, `.results-card`, `.palette`, `.rail`, `.simbar`, `.m-ctx`, `.goals-panel`, `.fb-card`, `.fb-body`,
  `.dly-hist`, `.camp-tabs`, `.hist-body`); every other touchmove is prevented. Visible wording goes through
  `BG.Mobile.touchText` on touch (hints, toasts, the derail callout): no keys, clicks or hover.
- Phones: compact top bar, tool rail as 46 px floating buttons (two columns in landscape), material palette
  as a bottom sheet behind a "current material" chip, sim controls beside the Test button, two-column
  results card in landscape, templates as a sheet, a once-per-session rotate prompt in portrait (edit / sim).
- Building: magnifier loupe while dragging, optional offset cursor (aim 64 px above the finger), larger
  touch snap / pick radius (wraps `Editor.prototype._magR` / `_pickR`), long-press + lift = context menu
  (delete joint / beam / pier, stop chain, undo, erase tool, fit view); long-press + drag still moves a joint.
- Camera: pinch / two-finger pan in the editor; one-finger pan and pinch in the sim view. Opening a level fits it
  to the touch HUD (`BG.Mobile.fitLevel`, insets from the top bar, rail and chip / palette) measured where those
  panels rest in edit mode: their CSS slide transform is taken off, since after a test (Next, Build) the rail is
  still sliding back in and would otherwise read as ~0 px wide, putting the level's left end under it.
- Haptics via `navigator.vibrate` on snap / place / break; fullscreen button (title, top bar except phone
  portrait, Settings); hints and toasts reworded for touch (`BG.Mobile.touchText`); Settings shows a
  gesture guide instead of keyboard shortcuts. Settings keys: `loupe`, `offsetCursor`, `haptics`, `perfMode`.
- `BG.Perf {mode: 'auto'|'on'|'off', low, dprCap, particleScale, maxParticles, cheapBackground, setMode(m)}`.
  Auto = on for phones / low-end devices, or after 3 s of slow frames on a touch device. Low mode: fewer
  particles, no ambient particles / vignette, fewer parallax layers, no glass blur, DPR cap 1.5 on slow
  devices (else 2). `BG.Renderer.resize` reads `BG.Perf.dprCap` (the one core edit).

- **Phase 2 - the other features' screens** (all in the "phase 2" block of `css/mobile.css` + small hooks in
  `mobile.js`): title meta chips compact, entry buttons stacked in portrait / wrapping in landscape; campaign tabs
  44 px (Famous Bridges tiles one column in portrait, three in landscape); Goals button 44 px, on phones the goals
  panel starts closed (`BG.GoalsUI.setOpen(open, noSave)`), is a sheet under the top bar and closes when the canvas
  is touched; results card on phones: rail verdicts / ride card, badge reveal, daily share card / endless score and
  bests line stack full width (landscape: title column + stats column above them) and the action row is sticky at
  the bottom of the scrolling card, with a "More below" cue (`.m-more`) while the card has more under it; Iron Road
  results in phone landscape put the verdicts under the reason and a compact ride card under the budget, so both sit
  above the footer without scrolling; Iron Road track strip docked above the sim bar (landscape) or under the top bar
  (portrait, `--m-strip` pushes toasts / callouts / the forces banner down), derail callout docked under the top bar
  without its stem; daily panel days >= 44 px (a sideways strip on phones that keeps the selected day in view,
  one 14-day row on tablets), endless / copy buttons 44 px; famous history card within the safe area, art and story
  side by side in phone landscape (the story scrolls); Forces of Nature forecast as a chip under the top bar while
  building on phones, warning banner sized to the phone.

### 16.2 PWA shell — `BG.PWA` (`js/features/pwa.js`, `sw.js`, `manifest.webmanifest`)
- Registers `sw.js` only on http(s) (no-op on `file://`). The worker precaches a **generated** file list:
  navigations network-first (cached copy when offline or after 3.5 s), everything else cache-first, an
  uncached file offline -> 504. Old `span-precache-*` caches are deleted on activate.
- **Every change to a shipped file (`index.html`, `css/`, `js/`, `assets/`) requires
  `node tools/gen-precache.js`** (rewrites the list + content-hash version in `sw.js`; `--check` only
  verifies). `tools/test-pwa.js` fails on a stale list. On a merge conflict in the list block, take either
  side and re-run the generator.
- Updates: a waiting worker shows "New version available — tap to reload"; tap -> `SKIP_WAITING` -> reload.
- Install: Settings row "Install SPAN" once `beforeinstallprompt` fired; on iOS an "Add to Home Screen"
  hint; "Offline play: Ready" once precached. Icons in `assets/icons/app/` (`tools/gen-icons.js`).
- `.github/workflows/pages.yml` deploys `main` to GitHub Pages (runs physics + level checks, regenerates
  the precache, publishes only game files). All paths are relative.

### 16.3 History, bests, autosave — `BG.History` (`js/features/history.js`, `css/history.css`)
- Storage goes through `BG.Storage` (prefix `span.v1.`; legacy keys are never rewritten);
  `BG.Storage.SCHEMA = 2`. Keys: `hist.meta {schema, migratedAt, from}`; `hist.runs` (<= 500, newest last,
  `{i, t, l, c, n, ok, f, s, p, d, b, k?}` = id, time, level, cost, members, passed, fail reason, stars,
  peak stress, sim time, broken beams, snapshot key); `hist.bests {[levelId]: {cost, members, peak, time,
  stars: {v, t, k?}, runs, passes, first, last}}`; `hist.stats`; `hist.snaps` + `hist.s.<k>` (compact
  design snapshots: 8 latest passing + 3 latest failing per level + any holding a best, 1.2 MB budget,
  oldest dropped on quota errors); `hist.session` (screen, level, camera, tab, scroll, follow, viewport, time).
- Migration from schema 1 (no `hist.meta`) fills bests and run counts from `progress.levels`.
- Data API (also runs in Node): `migrate, recordRun(info), getRuns, runsFor, getBests, getStats, summary,
  encodeDesign / decodeDesign, loadSnapshot, hasSnapshot, getSession, saveSession, resumePlan,
  exportSave / exportString, validateSave, importSave, resetAll`; UI: `open(tab), close(), isOpen()`.
- Browser hooks: wraps `Game.init / _finishRun / _setState / openLevel / continueGame / resetProgress`,
  `Editor.prototype.undo / redo / load`, `Hud.init / refreshTitle / buildLevelSelect / setCampaignTab`;
  defines `Game.onDesignChanged` and `Game.resumeSession`.
- Autosave 350 ms after each design change and on pagehide / hidden tab / beforeunload. On load the game
  resumes the level (design + camera; a running sim comes back in edit mode) or level select; skipped when
  the session is > 72 h old or the URL has `?level`, `?screen` or `?noresume`. The camera is not restored
  if the viewport changed by > 15 % (rotation).
- UI: results-card bests line ("First pass on this level", "New best! −$X vs your previous $Y", attempt N),
  tile tooltips, History screen (Runs with level / result filters and a cost sparkline; Levels with
  "Load best"; Stats); "Load" is one undo step. Settings "Save data": Export `span-save-YYYYMMDD.json`
  (all `span.v1.*` keys); Import validates (rejects junk and newer schemas), replaces, migrates, reloads.
  Reset progress also clears history.

### 16.4 Tests
- `tools/test-mobile.js`: phones / tablets in both orientations with touch emulation; overflow and 44 px
  targets on every screen including History and the Install / Save data rows; level 1 built by touch;
  loupe, context menu, pinch, history list scroll; phase 2: campaign tabs + famous tiles, goals panel + badge
  reveal, famous history card (finger scroll) + famous top bar, Iron Road track strip / derail callout / ride-quality
  results, forces forecast + banner, daily panel / share card, endless score, title with every entry point; result
  action rows must be on screen and tappable.
- `tools/test-pwa.js`: install, precache freshness, offline reload incl. a deep link, update toast,
  install UI, `file://` no-op.
- `tools/test-offline-tour.js`: offline guarantee. Installs online (waits for the full precache), then
  `context.setOffline(true)` and tours title, every level-select tab (all famous art forced to load), level 1
  run + results badges, bonus 52 quake FX, rail 106 + 120 (smoke, track strip), famous 208 + 209 cards + runs,
  daily (generated offline), endless, history, settings (install row, save export download) on desktop
  1440x900 and a touch phone 844x390. Fails on any page request not answered by the service worker, any
  worker network fetch other than the index.html probe (= precache miss), console / page errors, images with
  naturalWidth 0, failed sprites; static: every literal `assets/` path, every theme background and badge icon
  is in the precache. Also checks the update path and reports the precache size. `--drop=<file>` serves a
  precache without that file to prove the detector fails.
- `tools/test-history.js`: Node (fake storage) + browser (desktop, phones, tablet); `--node-only` skips the browser.

## 17. Land-side structures — inland anchors, land pylons, roadway envelope (GitHub issue #2)

Engine, editor, renderer and template support for structures that stand on the banks: backstayed pylons, deadman
anchorages and hillside anchor blocks. **A level without the new fields behaves exactly as before**: every rule below
is gated on them (all 170 reference / best designs and every goal design were re-run against the pre-change engine:
validation, cost and the full simulation trace are bit-identical). `tools/test-anchors.js` asserts that only the
Anchorages levels (54-58, §17.7) use them.

### 17.1 Level fields (all optional)
```js
anchors:   [ ..., { x: -24, y: 0, inland: true },    // deadman anchor on the left bank top
                  { x: 60, y: 7, inland: true } ],   // anchorage set into a hillside 7 m above the right bank
pierZones: [ ..., { x0: -8, x1: -3, ground: 'left' }, { x0: 43, x1: 48, ground: 'right', footing: 4e5 } ],
roadClearance: true | 5.5 | false                    // force the envelope on / set its height (m) / switch it off
```
- **Inland anchor** (`BG.Model.anchorInfo(level, i)` → `{kind, bank, surfaceY, side, explicit}`): an anchor on a bank
  (x ≤ leftEdge − 1 m or x ≥ rightEdge + 1 m, or flagged `inland` on a bank) at or above its surface. `kind`:
  `'edge'` (every other anchor: road anchors, cliff-face anchors), `'inland'` (on the bank top: a deadman block buried
  flush, bolt plate on the surface), `'hill'` (more than `HILL_MIN` = 0.3 m above the bank: set into a hillside that
  rises behind the road). The anchor point is the bolt plate on the block's face: members attach there and end there.
  Any material may attach, but only rope and cable may cross the roadway envelope to reach it (§17.2). Also `inlandAnchors(level)`, `isInlandAnchorId`.
- **Hillside** (`anchorMounds(level)` → `[{i, bank, anchor, poly}]`): under a `'hill'` anchor a convex quadrilateral
  stands on the bank surface - the anchor face is its gap-side top corner, a 3 m plateau behind it, slopes down to the
  bank (front 0.5 m per m of height + 0.3 m, never past the gap edge; back 1.4 m per m + 0.6 m). It is solid ground for
  `inTerrain`, `segmentInTerrain` and `terrainDistance` (joints keep 0.5 m clear and members cannot pass through it:
  they end at the anchor face), but not for vehicles or debris (in depth it stands beside the road).
- **Land pier zone** (`zone.ground`): a pier there is a **land pylon**. Its base is the bank surface
  (`pierBaseY(level, pier)`, `landPierBank(level, pier)`, `pierZoneAt(level, x)`); `pier_too_short`, the no-build check
  and the cost (`pierBase + pierPerMeter × (topY − base)`) are measured from there. The editor's pier tool works in these
  zones as on the floor (the top is clamped above the roadway envelope).
- `hasLandFeatures(level)`: a flagged inland anchor, a hillside anchor, a land pier zone, or `roadClearance` true /
  a number (`false` always wins). Unflagged bank-top anchors (as on levels 25, 36, 40, 51, 53) are drawn as deadman
  blocks but switch no rule on.

### 17.2 Roadway clearance envelope
`roadEnvelope(level)` → `null` unless `hasLandFeatures`, else `{height, vehicle, margin, rects}`: an open band over each
bank road (x < leftEdge above leftY, x > rightEdge above rightY), height = the tallest vehicle in the traffic (road
vehicles and rail cars, `tallestVehicle(level)`) + `ROAD_MARGIN` 0.5 m, or `roadClearance` m. `validate` adds
`{type: 'roadway', msg: ROADWAY_MSG}` ("Keep the road clear") for
- a user joint inside it (`inRoadway`; the road surface and the band's top edge are legal),
- a member crossing it (`beamInRoadway(level, aId, bId, x1, y1, x2, y2, m)`), **except** a tension-only member (rope,
  cable) that ends at an inland anchor (anchorage stays run beside the carriageway into their deadman, as on real
  suspension and cable-stayed bridges). Decks get no exemption of their own: a deck lying on the road surface does not
  cross the open band, while a road strut propping a land pylon from the road anchor (it replaced the backstay), a ramp
  over the road, or a steel / wood / road member from a deadman through the traffic does,
- a land pylon whose top is inside it (the road passes through the pylon's portal; its top must clear the traffic).

Editor: `_pointProblem` returns `'roadway'` (red ghost, drags clamp, no mirror partner there), `_beamProblem` and
`_moveValid` reject crossing members, a refused placement toasts `ROADWAY_MSG`, the renderer's ghost label shows it, and
edit mode draws the envelope as an amber hatched band labelled "ROAD · KEEP CLEAR h m". The label is drawn in the
overlay pass with the pier labels (over the structure and the parked vehicle, so no stay or pylon hides it), in the
widest visible stretch of the band clear of the HUD side panels, the hillsides and the built land pylons (and of the
empty land pier zones when there is room), or is left out.

### 17.3 Land pylon physics (`BG.Simulation`; constants `BG.LandPylon` in materials.js)
- A land pylon's top `p<i>` is a **free joint** (`sim.nodes[k].fixed = false`, `.pylon = true`) held by a rigid concrete
  column (distance constraint, EA `stiffness` 5e10 N) to its footing (a fixed point on the bank, not a node) and by an
  **elastic-plastic footing**: a rotation spring (`footingStiffness` 2e9 N·m/rad) that never resists more than
  `momentLimit` 3e5 N·m (`zone.footing` overrides). Mass at the top: `massPerMeter` 900 kg/m × height / 3 (a uniform
  column's swing) plus half of every attached member as usual. Light rocking damping.
- Pulled sideways by its stays, a pylon leans until its backstays take the pull (the footing yields at its limit; the
  stays are far stiffer). With nothing to balance the pull it keeps turning: past `PYLON_TILT_MAX` 0.05 rad (≈ 2.9°) the
  footing is torn out (event `{type: 'pylon_fail', pier, x, y, moment, time}`, `sim.firstTopple`) and the pylon falls
  about its base until it lies on the bank. An unloaded land pylon stands.
- Read-outs: `sim.piers[i] = {x, baseY, topY, ground, topX, tilt (rad, + = toward −x), footing (|moment| / limit), peak,
  failed}`; `summary()` adds `pylonsToppled` and `firstTopple` only when there are land pylons (`sim.nPyl > 0`). Quakes
  (§12) move the footings with the ground. Floor piers are unchanged fixed points (`baseY = floorY`).
- Results: a failed run whose first failure was a toppled pylon says "A land pylon toppled first: its footing could not
  hold the pull of its stays. Guy it back with backstays to an inland anchor behind it." Effects: dust + shake; audio: a
  masonry break.

### 17.4 Rendering
Deadman anchors: a concrete block buried flush in the bank (drawn in section) with a tie rod up to a steel bolt plate on
the surface. Hillside anchors: an earth hillside (theme soil, strata, grassy crest) with a concrete block set into its
face and a vertical bolt plate facing the gap. Both carry a shackle eye at the anchor point instead of the anchor sprite.
Land pylons: a footing block on the bank and a tapered concrete column with a portal opening over the road, drawn along
the live (leaning or fallen) column; the footing glows red above 85 % of its limit. Land pier zones are striped on the
bank surface. `levelBounds` / `fitToLevel` (and so the follow camera's zoom) include `landExtent(level)` (inland anchors,
hillsides, land pier zones) on levels with land features, and the follow camera's far-bank stop moves out to the
right-hand land structures.

### 17.5 Templates
`suspension` and `cable_stayed` try a `'land'` tower mode first when the level has land pier zones (suspension: on both
banks): a land pylon in each zone (nearest the gap with a reachable backstay; top = deck + tower height, at least the
envelope + 0.5 m), backstayed by one tension member to the inland anchor furthest behind it that the material reaches (and that it may
cross the roadway envelope to reach: only rope / cable may).
A pylon with no inland anchor to backstay to is not built (it would topple). Cable-stayed stays from a land pylon skip
deck joints whose stay would cross the envelope. Gap pier zones keep their old modes (`ctx.zones` = gap zones only,
`ctx.landZones` the land ones); bank towers keep backstaying to the nearest anchor behind them (inland ones included).

### 17.6 Tests
`node tools/test-anchors.js`: anchor kinds, envelope rules and the one exemption (a road strut propping a pylon, a road
ramp and a steel strut from a deadman are refused; the same cable is not), Anchorages level lint (land zones on their
banks, no overlaps, no room below the deck on 54-57 so the pylon-free under-deck truss is refused), land pier base / cost, hillside solidity,
a guyed pylon standing vs an unguyed one toppling (deterministic), an unloaded pylon standing, quake footing motion,
both templates (valid, pass, backstayed), editor feedback + pier tool, shipped levels untouched. `tools/e2e.js` (at the
end): a land level in the browser - camera framing, the red "roadway" ghost + toast, the pier tool on the bank, the
cable-stayed template passing with standing pylons, and the same bridge without backstays toppling with the explanation;
for 54-58 with their best designs the "KEEP CLEAR" labels stay clear of the HUD, the pylons and the hillsides.

### 17.7 Bonus chapter "Anchorages" (levels 54–58)
A hidden Roads chapter that opens when level 40 is complete (a branching bonus chapter, §15: not a gate, its own unlock list,
Next and finale). Every level has land pier zones, flagged inland anchors, the roadway envelope and a hint; 54-57 offer
only road, reinforced road, rope and cable, 58 adds wood and steel for a stiffening truss. Road is a compression member
too, so on 54-57 the build area stops at the deck (`buildArea.y0` = the road level): with room below it, a pylon-free
under-deck truss (cable bottom chord, road diagonals) passed 54 and 56 at well under half the budget (review fix). Above
the deck the same truss stalls the traffic (vehicles drive into road members) or fails, and a road deck arch, a cable-braced
deck arch or a towerless main cable from the hillside anchors (55) all fail, so the deck has to hang from pylons. On 58
a pylon-free steel truss under, over or through the deck fails or costs more than the budget.

| Level | Gap | Land structures | Traffic | Budget | Reference | Best |
|---|---|---|---|---|---|---|
| 54 Dead Weight | 36 m | land zones at the edges, deadmen 22 m behind | 3 buses, truck | 26.5k | 0.78 (stayed, reinforced deck) | 0.70 (two 8 m pylons, road deck) |
| 55 Guy Lines | 44 m | zones 10-15 m behind the edges, hillside anchors 6 m up | 3 trucks | 44k | 0.78 (16 m pylons) | 0.70 (12 m pylons) |
| 56 Lone Pylon | 34 m | one zone on the left, two deadmen behind it | 2 trucks, 2 buses | 28k | 0.77 (backstays to both deadmen) | 0.69 |
| 57 Buried or Tied | 60 m | river pier zones near both cliffs + land zones, deadmen 30 m back | 3 buses, 2 vans | 34k | 0.81 (river towers, stays, ends tied down) | 0.70 (land towers, earth-anchored suspension) |
| 58 Grand Anchorage | 100 m | land zones, hillside anchorages 34 m back | 2 buses, 3 trucks | 98k | 0.84 | 0.70 (suspension, steel stiffening truss) |

The designs come from parametric generators / optimisers (cable-stayed and suspension families, greedy coordinate search
with random restarts). Budget = best / 0.70 rounded up to $500 (54-57) / $1000 (58). `tools/test-anchors.js` checks that
every best design stands its land pylons, that the same design without the members tied into the inland anchors topples a
pylon and fails, and that no template (offered or not) reaches ★★★; the cable-stayed template passes 54 at ★★, no template
passes 55-58.
