# SPAN — Bridge Construction Game: Spec & Plan

A browser bridge-building puzzle game. Plain HTML + JavaScript, no build step, no dependencies.
Opens directly from `index.html` (file://) — so **classic `<script>` tags, no ES modules**.

## 1. Player experience

1. Pick a level (50, unlocked sequentially, 0–3 stars each).
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
   Controls: pause, slow-mo (0.25×), fast (2×), restart, back to edit (design preserved).
5. After the run: a stress heat-map of the **peak** stress each beam saw, so the player can optimise.
6. Pass = all vehicles reach the far side within the time limit **and** cost ≤ budget.
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
tools/verify-levels.js   runs every level against its reference solution
tools/solutions/level-NN.json   reference designs (not loaded by the game)
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
  width /* render thickness, m */ }
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
                                   //    duplicate beam, pier out of zone / too many, zero-length
BG.Model.clone(design), BG.Model.serialize(design), BG.Model.deserialize(str)
BG.Model.beamLength(level, design, beam)
```

### 4.6 `BG.Simulation`
```js
const sim = new BG.Simulation(level, design, { seed: 1 });
sim.step();            // advance exactly 1/60 s (internal substeps)
sim.time               // seconds
sim.status             // 'running' | 'success' | 'failed'
sim.failReason         // 'vehicle_fell' | 'timeout' | null
sim.nodes              // [{id, x, y, fixed}]   positions live
sim.beams              // [{a, b /* indices into sim.nodes */, m, material, restLength,
                       //   force /* N, + tension */, stress /* signed ratio: force/limit, |1| = break */,
                       //   peak /* max |stress| seen */, broken }]
sim.piers              // [{x, baseY, topY}]
sim.vehicles           // [{type, def, state: 'waiting'|'driving'|'finished'|'fallen',
                       //   x, y, angle /* body pose */, wheels: [{x, y, r, rot}], vx}]
sim.events             // array pushed during step(); consumer drains with sim.drainEvents()
                       //   {type:'break', beamIndex, x, y, m} {type:'splash', x, y, size}
                       //   {type:'vehicle_finish', i} {type:'vehicle_fall', i} {type:'creak', beamIndex, stress}
sim.summary()          // { status, time, peakStress, vehiclesFinished, vehiclesTotal, brokenBeams }
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
/ right-click. Keyboard: 1–6 materials, E erase, P pier, M mirror, Ctrl+Z/Y, Space test, Esc.

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

## 5. Difficulty curve (50 levels)

| Levels | Gap | Traffic | New idea |
|---|---|---|---|
| 1–5 | 8–18 m | cars | road + wood, simple triangles; hints |
| 6–12 | 18–30 m | cars, vans | trusses, steel introduced (8), budget pressure |
| 13–20 | 30–45 m | vans, buses | piers (13), rope/cable (16), arches, uneven bank heights |
| 21–30 | 45–70 m | buses, trucks | ship clearance zones, suspension & cable-stayed towers, reinforced road |
| 31–40 | 70–100 m | trucks, semis | heavy convoys, few/no piers, deep canyons |
| 41–50 | 100–150 m | semis, tankers, heavy | long spans, mixed convoys, tight budgets — finale |

**Every level is verified solvable**: a reference design in `tools/solutions/level-NN.json` must pass
in the headless sim with peak stress ≤ 0.92 and cost ≤ budget. Budget is set from the reference cost
(≈ ×1.45 early levels → ≈ ×1.12 late levels).

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
