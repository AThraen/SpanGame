# SPAN: Bridge Builder

SPAN is a physics bridge-construction puzzle game that runs in the browser. You build a bridge across a gap from road, wood, steel, rope and cable, stay under budget, then press **Test** to watch real traffic drive across. If the bridge is too weak it sags, beams snap, and the bus ends up in the river.

It is plain HTML, CSS and JavaScript, with no build step and no runtime dependencies. Double-click `index.html`; it works straight from `file://`.

## How to play

1. **Pick a crossing** on the level select screen. Levels unlock in order, and each one awards 0–3 stars.
2. **Read the gap.** The top bar shows the cost/budget bar (with ★★★ and ★★ thresholds) and the traffic waiting to cross. The dashed rectangle is the build area. Hatched zones are no-build areas, such as ship clearance. Yellow-striped floor bands are pier zones.
3. **Build.**
   - Pick a material in the bottom palette.
   - Drag from any anchor (the concrete bolts) or joint to place a beam. The beam stops at the material's maximum length and snaps to a 1 m grid and to nearby joints.
   - After you place a beam, building continues from its end. Click again to chain more beams; press Esc, right-click, or click empty space to stop.
   - **Road** and **reinforced road** are what vehicles drive on. **Wood** and **steel** are structural members. **Rope** and **cable** only carry tension.
4. **Test** (Space). Beams are coloured by live stress, from cool through yellow to red, and glow when above 85%. Hover a beam to see its exact force and stress. Overloaded members snap.
5. **Optimise.** After a run, **Inspect** shows the peak stress each member reached. Trim the members that never worked hard and reinforce the red ones.

**Pass** means every vehicle reaches the far bank within the time limit and the cost is at or under budget. Over-budget bridges can still be tested, but they can't complete the level.

| Stars | Requirement |
|---|---|
| ★ | Pass |
| ★★ | Pass, cost ≤ 85% of budget |
| ★★★ | Pass, cost ≤ 70% of budget |

Your progress and your last design for each level are saved in `localStorage` automatically. The game still works when storage is unavailable.

## Controls

### Building (edit mode)

| Input | Action |
|---|---|
| Drag from a joint | Build a beam (auto-chains from its end) |
| `Shift` while dragging | Fine snap (0.25 m) |
| `Ctrl`/`Alt`+drag a joint, or long-press then drag | Move a joint; drop it on another joint to merge them |
| Right-click / `E` | Erase (click or drag-sweep) |
| `P` | Pier tool: click in a pier zone, drag to set height (piers can rise above the deck as towers) |
| `S` | Select tool: box-select, then `Delete`; `Ctrl+A` selects all |
| `B` | Build tool |
| `1`–`6` | Choose a material (in palette order) |
| `M` | Mirror symmetry around the gap centre |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| Templates button | Start from a Warren, Pratt, Howe, deck arch, through arch, suspension or cable-stayed bridge (ordinary editable beams) |
| `H` | Show the level hint |
| Wheel / pinch | Zoom |
| Right- or middle-drag, `Space`+drag, drag on empty space, arrow keys | Pan |
| `F` | Re-fit the camera to the level |
| `Space` (tap) | Test the bridge |
| `Esc` | Cancel the current action, or go back to level select |

### Testing (sim mode)

| Input | Action |
|---|---|
| `Space` | Stop the test and go back to editing (design is kept) |
| `R` | Restart the test |
| `P` | Pause / resume |
| `.` | Single step (while paused) |
| `-` / `=` | Slow motion (0.25×) / fast (2×) |
| `Enter` (results) | Next level if passed, otherwise retry |

## Running it

- **Play:** open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari). No server is needed.
- **Handy URL parameters:**
  - `index.html?level=3` jumps straight into level 3.
  - `?screen=levels` opens level select.
  - `?unlockall` unlocks every level.

## Project structure

```
index.html               page shell; loads the classic scripts below in order
css/style.css            HUD / menus (glass panels, system font stack)
js/core/                 simulation core - runs in the browser AND in Node, no DOM
  materials.js           BG.Materials, BG.MaterialOrder, BG.Costs
  vehicles.js            BG.Vehicles (car ... 60 t heavy hauler), BG.VehicleOrder
  model.js               BG.Model - design helpers, cost, validation, (de)serialisation
  physics.js             BG.Simulation - deterministic XPBD, fixed 1/60 s step with substeps
  levels.js              BG.Levels - level definitions
  templates.js           BG.Templates - bridge-type generators
js/render/
  effects.js             BG.Effects - particles, debris, splashes, camera shake
  renderer.js            BG.Renderer + BG.Sprites - layered canvas renderer (parallax, water, terrain, beams, vehicles)
js/ui/
  audio.js               BG.Audio - synthesized WebAudio SFX, engines, ambience (no audio files)
  storage.js             BG.Storage - settings, progress, saved designs (localStorage, try/catch)
  editor.js              BG.Editor - mouse/touch/keyboard construction tools
  hud.js                 BG.Hud - title, level select, top bar, palette, tool rail, results, settings
js/main.js               BG.Game - state machine (title -> levelSelect -> edit <-> sim -> results) + main loop
assets/sprites/          hand-written SVG vehicles (1 unit = 1 cm), wheels, anchor, joint
assets/icons/            SVG UI icons
assets/bg/               painterly per-theme backgrounds (<theme>.jpg)
tools/                   Node tooling (not loaded by the game)
  harness.js             loads js/core/* in Node; runHeadless(level, design, opts)
  test-physics.js        physics unit / behaviour / performance tests
  verify-levels.js       runs every level against tools/solutions/level-NN.json
  test-editor.js         editor tests (fake DOM / renderer)
  test-templates.js      template generator tests (--verbose, --svg out.html)
  e2e.js                 headless-Chrome end-to-end check of the real game
  shot.js                headless screenshot helper
  solutions/             reference designs proving each level is solvable
SPEC.md                  binding data contracts between modules
```

All modules hang off one global, `window.BG`. Every `js/core` file is wrapped so that it also loads in Node (`globalThis.BG`). The simulation is deterministic: it uses a seeded PRNG and its own trig helpers, so the headless verifier's result matches what the browser shows.

## Tests and tools

You need Node 18 or later (developed on Node 24). The browser checks also need the dev dependency (`npm install` installs Playwright) and a local Chrome. They always run **headless**; nothing opens a window.

```sh
node tools/test-physics.js     # 16 physics tests incl. stability & >=4x realtime perf
node tools/verify-levels.js    # every level: reference solution passes, peak stress <= 0.92, cost <= budget
node tools/test-editor.js      # editor behaviour (122 checks)
node tools/test-templates.js   # templates across synthetic + real levels
node tools/e2e.js [outDir]     # full browser run; screenshots go to %TEMP%/span-e2e by default
node tools/shot.js out.png [script.js] [waitMs]   # one headless screenshot, optional in-page eval
```

### Adding a level

1. Append a level object to `BG.Levels` in `js/core/levels.js`. The shape is in SPEC.md §4.3.
2. Save a reference design as `tools/solutions/level-NN.json`. You can build it in the game and copy it with `BG.Model.serialize(BG.Game.getDesign())` in the browser console.
3. Run `node tools/verify-levels.js`. The level must pass with peak stress ≤ 0.92 and cost ≤ budget. The budget is usually set at about 1.45× the reference cost for early levels, falling to about 1.12× for late ones.
