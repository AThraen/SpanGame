# SPAN — Bridge Construction Game: Spec & Plan

A browser bridge-building puzzle game. Plain HTML + JavaScript, no build step, no dependencies.
Opens directly from `index.html` (file://) — so **classic `<script>` tags, no ES modules**.

## 1. Player experience

1. Pick a level (50 in 6 chapters, 0–3 stars each). A level unlocks when either of the two levels before it is complete.
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
css/style.css
js/core/materials.js     BG.Materials
js/core/vehicles.js      BG.Vehicles (definitions)
js/core/model.js         BG.Model (design helpers, cost, validation, serialization)
js/core/physics.js       BG.Simulation
js/core/levels.js        BG.Levels (array of 50 level objects)
js/core/templates.js     BG.Templates (bridge-type generators)
js/render/effects.js     BG.Effects (particles, debris, shake)
js/render/renderer.js    BG.Renderer
js/ui/audio.js           BG.Audio (WebAudio, synthesized — no asset files)
js/ui/storage.js         BG.Storage
js/ui/editor.js          BG.Editor
js/ui/hud.js             BG.Hud (menus, level select, palette, results, tooltips)
js/main.js               BG.Game (state machine + main loop)
tools/harness.js         Node loader for js/core/* + runHeadless()
tools/test-physics.js    physics unit/behaviour tests
tools/verify-levels.js   runs every level against its reference + best designs
tools/build-levels.js    tools/levels/level-NN.json -> js/core/levels.js (generated; never edit levels.js by hand)
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
  pierZones: [ {x0: 20, x1: 30} ],   // where piers may stand on the floor ([] = none)
  maxPiers: 0,
  noBuild: [ {x0, x1, y0, y1} ],     // e.g. ship clearance; no joint or beam may enter
  buildArea: { x0, x1, y0, y1 },     // joints must be inside
  materials: ['road', 'wood'],       // allowed
  budget: 2500,
  traffic: [ {type: 'car', count: 2, interval: 2.5 /* s between spawns */} ], // groups in order
  timeLimit: 40,                      // seconds of sim time
  templates: true                     // whether template tool is offered
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
                                   //    only anchors and piers may bear on rock)
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
  `explorer`. Write screenshots to the scratch/temp dir, not the project.
- Node 24 available; no Python.

## 9. Iron Road — railway campaign (extension)

A separate 20-level campaign of railway bridges with ever larger trains. Road campaign (levels 1–50) must
keep working unchanged: **`node tools/verify-levels.js` must stay 100% green for road levels** after any
engine change (re-verify; if a shared change breaks a road design, fix the engine change, not the level).

### 9.1 Levels & campaign
- Rail levels use ids **101–120**, files `tools/levels/level-101.json` … with `campaign: 'rail'`
  (road levels: `campaign` absent or `'road'`). Solutions `tools/solutions/level-101.json` / `-best.json`.
- Unlock: level 101 unlocks when road level 10 is completed (or `?unlockall`). Inside the campaign the
  usual rule (previous one or two completed) applies, on ids 101–120.
- Chapters (5 levels each): 101–105 "Branch Lines" (handcar, tram, light steam; short spans, learn derail
  limits), 106–110 "Stone & Steam" (steam + coaches, masonry viaducts over valleys), 111–115 "Freight Corridor"
  (commuter, long freight, ore trains; whole span loaded; deep steel trusses, cantilevers),
  116–120 "High Speed" (high-speed trains, speed impact, double-deck road + rail finale).
- Level select gets campaign tabs: **Roads** / **Iron Road** (locked tab shows "Complete level 10").
- New traffic entry form: `{ type: 'train', train: '<preset id>', count, interval }`. Road vehicle entries may
  be mixed in on double-deck levels (they drive on `road` beams; trains only on `rail` beams).
- Optional level field `rail: { maxGrade: 0.04, maxKinkDeg: 3 }` overrides derail thresholds.

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
  of its wheels, the rail grade exceeds `maxGrade` for > 0.3 s, or the vertical angle between consecutive
  rail segments under a bogie exceeds `maxKinkDeg`, or the rail is missing / broken under a wheel. A derailed
  car tumbles physically (drags its coupled neighbours) — dramatic but stable.
- `sim.vehicles` entries for trains: `{kind:'train', type:'train', preset, cars:[{type, def, x, y, angle,
  wheels:[{x,y,r,rot}], state}], state, ...}`; road vehicles get `kind:'road'`. Finish = last car's rear
  passes `rightEdge + 15`. Trains spawn so the whole consist starts on the left bank.

### 9.4 Rendering, audio, UI
- SVG sprites in `assets/sprites/rail/` per car type (wheels/bogies separate so they rotate; steam loco
  connecting rods animated), same coordinate rules as §7. Steam loco smoke plume, diesel exhaust, sparks at
  derailment, sleepers + rails + ballast drawn on rail beams, masonry beams drawn as stone voussoir blocks,
  catenary masts decoration on high-speed levels, distant railway scenery details in themes.
- Audio: horn (steam whistle / diesel horn / high-speed chime), clickety-clack per rail seam scaled by
  speed, steam chuff, brake squeal, derail crash.
- **Camera follow** (both campaigns): sim-controls toggle "Follow" (key F) that smoothly tracks the lead
  vehicle/train with comfortable zoom; default ON for gaps > 60 m. Fixes tiny vehicles on big spans.
- Templates: add `viaduct` (masonry arches on piers) and make existing templates use `rail` deck on rail levels.
- HUD traffic chips show train icons with car count ("Ore ×24").

## 10. Mobile, PWA, History (extension)

Three feature modules, each a classic script in `js/features/` (+ a stylesheet in `css/`), loaded after
`js/main.js` in this order: `history.js`, `pwa.js`, `mobile.js` (stylesheets after `style.css`: `pwa.css`,
`history.css`, `mobile.css`). They **hook** the core by wrapping existing methods (each wrapper calls
through to the original, so wrappers stack) and do not edit core files; desktop with a mouse is unchanged.
Shared-file touch points are commented `// mobile:` / `// pwa:` / `// history:`. Everything must keep
working from `file://` and without storage.

### 10.1 Touch layer — `BG.Mobile`, `BG.Perf` (`js/features/mobile.js`, `css/mobile.css`)
- Classes on `<html>`: `m-touch` (coarse primary pointer, or `?touchui=1`; `?touchui=0` forces it off),
  `m-phone` (touch + short side <= 520 px) / `m-tablet`, `m-portrait` / `m-landscape`, `m-lowperf`.
  **All touch CSS is scoped under these classes.** HUD elements added by other features must work under
  them: visible buttons >= 44 px, nothing outside the viewport (respect `env(safe-area-inset-*)`), and long
  lists scroll inside a container the touch guard accepts (`.modal-card`, `.ls-scroll`, `.palette`,
  `.tpl-menu`, `.results-card`, `.rail`, `.simbar`, `.m-ctx`); every other touchmove is prevented.
- Phones: compact top bar, tool rail as 46 px floating buttons (two columns in landscape), material palette
  as a bottom sheet behind a "current material" chip, sim controls beside the Test button, two-column
  results card in landscape, templates as a sheet, a once-per-session rotate prompt in portrait (edit / sim).
- Building: magnifier loupe while dragging, optional offset cursor (aim 64 px above the finger), larger
  touch snap / pick radius (wraps `Editor.prototype._magR` / `_pickR`), long-press + lift = context menu
  (delete joint / beam / pier, stop chain, undo, erase tool, fit view); long-press + drag still moves a joint.
- Camera: pinch / two-finger pan in the editor; one-finger pan and pinch in the sim view.
- Haptics via `navigator.vibrate` on snap / place / break; fullscreen button (title, top bar except phone
  portrait, Settings); hints and toasts reworded for touch (`BG.Mobile.touchText`); Settings shows a
  gesture guide instead of keyboard shortcuts. Settings keys: `loupe`, `offsetCursor`, `haptics`, `perfMode`.
- `BG.Perf {mode: 'auto'|'on'|'off', low, dprCap, particleScale, maxParticles, cheapBackground, setMode(m)}`.
  Auto = on for phones / low-end devices, or after 3 s of slow frames on a touch device. Low mode: fewer
  particles, no ambient particles / vignette, fewer parallax layers, no glass blur, DPR cap 1.5 on slow
  devices (else 2). `BG.Renderer.resize` reads `BG.Perf.dprCap` (the one core edit).

### 10.2 PWA shell — `BG.PWA` (`js/features/pwa.js`, `sw.js`, `manifest.webmanifest`)
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

### 10.3 History, bests, autosave — `BG.History` (`js/features/history.js`, `css/history.css`)
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

### 10.4 Tests
- `tools/test-mobile.js`: phones / tablets in both orientations with touch emulation; overflow and 44 px
  targets on every screen including History and the Install / Save data rows; level 1 built by touch;
  loupe, context menu, pinch, history list scroll.
- `tools/test-pwa.js`: install, precache freshness, offline reload incl. a deep link, update toast,
  install UI, `file://` no-op.
- `tools/test-history.js`: Node (fake storage) + browser (desktop, phones, tablet); `--node-only` skips the browser.
