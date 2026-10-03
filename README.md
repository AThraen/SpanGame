# SPAN: Bridge Builder

SPAN is a physics bridge-construction puzzle game that runs in the browser. You build a bridge across a gap from road, wood, steel, rope and cable, stay under budget, then press **Test** to watch real traffic drive across. If the bridge is too weak it sags, beams snap, and the bus ends up in the river.

It is plain HTML, CSS and JavaScript, with no build step and no runtime dependencies. Double-click `index.html`; it works straight from `file://`.

## How to play

1. **Pick a crossing** on the level select screen. A level opens once either of the two levels before it is complete, so one hard crossing can be skipped and revisited. Each level awards 0–3 stars.
2. **Read the gap.** The top bar shows the cost/budget bar (with ★★★ and ★★ thresholds) and the traffic waiting to cross. The dashed rectangle is the build area. Hatched zones are no-build areas, such as ship clearance. Yellow-striped floor bands are pier zones.
3. **Build.**
   - Pick a material in the bottom palette.
   - Drag from any anchor (the concrete bolts) or joint to place a beam. The beam stops at the material's maximum length and snaps to a 1 m grid and to nearby joints.
   - After you place a beam, building continues from its end: each click places the next beam (clicking empty space builds there too). Reaching an anchor ends the chain; Esc or right-click stops it anywhere. Clicking a joint that is out of reach builds toward it and stops at the material's maximum length, just as the preview shows.
   - A new joint that lands on an existing beam joins it: the beam is split there. So a strut that stops on the road is connected to the road.
   - Joints must stay at least 0.5 m clear of the ground (only anchors and piers bear on rock), and beams may not pass through it.
   - **Road** and **reinforced road** are what vehicles drive on. The road must run continuously from bank to bank, and it bends at its joints: it needs a supported joint (a strut, hanger or chord) about every 5–6 m. **Wood** and **steel** are structural members. **Rope** and **cable** only carry tension. Pier tops are rigid concrete supports.
4. **Test** (Space). Beams are coloured by live stress, from cool through yellow to red, and glow when above 85%. Hover a beam to see its force, stress and (for road) how much of it is bending. Overloaded members snap; the results say which member gave way first and why.
5. **Optimise.** After a run, **Inspect** shows the peak stress each member reached, drawn on the bridge as built, with broken members marked. Back in the editor, hovering a beam shows its peak from the last test. Trim the members that stay white or green and reinforce the red ones.
6. **Railway levels (Iron Road).** Trains derail on a kink between rail segments, a grade that is too steep, a broken or missing rail, or a bogie lifted off a crest. While a train runs, the **track recording** strip above the sim controls (`T`) plots the grade and kink at every rail joint against the red limit bands; the kink limit shrinks for fast trains. When a train derails, the action drops into slow motion, the offending wheel and rail segment pulse red, and a callout names the cause with numbers (for example "Kink 4.1° at 32 m/s — limit here is 1.9°"). The results show two verdicts, *Structure held* and *Train stayed on the rails*, plus a ride-quality card: worst grade, worst kink against its limit, peak sag and a smoothness grade from A to F. Masonry that is being pulled glows red with crack marks, live and in the peak view.

**Pass** means every vehicle drives across to the far bank within the time limit and the cost is at or under budget. Over-budget bridges can still be tested, but they can't complete the level. A run fails when a vehicle falls, when a vehicle is launched across instead of driving (a ramp is not a bridge), when all traffic is stuck for 5 s, or at the time limit.

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
| Drag from a joint | Build a beam (auto-chains from its end; reaching an anchor ends the chain) |
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
| `-` / `=` | Slower / faster (¼×, 1×, 2×, 4×, 8×) |
| `F` | Camera follows the traffic |
| `T` | Track recording strip on railway levels: grade and kink at every rail joint against the derail limits |
| `Enter` (results) | Next level if passed, otherwise back to editing |

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
  railinfo.js            BG.RailInfo - derailment explainer, track recording strip, ride-quality card (display only)
  hud.js                 BG.Hud - title, level select, top bar, palette, tool rail, results, settings
js/main.js               BG.Game - state machine (title -> levelSelect -> edit <-> sim -> results) + main loop
assets/sprites/          hand-written SVG vehicles (1 unit = 1 cm), wheels, anchor, joint
assets/icons/            SVG UI icons
assets/bg/               painterly per-theme backgrounds (<theme>.jpg)
tools/                   Node tooling (not loaded by the game)
  harness.js             loads js/core/* in Node; runHeadless(level, design, opts)
  test-physics.js        physics unit / behaviour / performance tests
  verify-levels.js       runs every level against its reference and best designs
  build-levels.js        assembles tools/levels/level-NN.json into js/core/levels.js
  levels/                one JSON file per level (the source of js/core/levels.js)
  test-editor.js         editor tests (fake DOM / renderer)
  test-templates.js      template generator tests (--verbose, --svg out.html)
  e2e.js                 headless-Chrome end-to-end check of the real game
  shot.js                headless screenshot helper
  solutions/             level-NN.json (reference) and level-NN-best.json (proves ★★★) for every level
SPEC.md                  binding data contracts between modules
```

All modules hang off one global, `window.BG`. Every `js/core` file is wrapped so that it also loads in Node (`globalThis.BG`). The simulation is deterministic: it uses a seeded PRNG and its own trig helpers, so the headless verifier's result matches what the browser shows.

## Tests and tools

You need Node 18 or later (developed on Node 24). The browser checks also need the dev dependency (`npm install` installs Playwright) and a local Chrome. They always run **headless**; nothing opens a window.

```sh
node tools/test-physics.js     # 20 physics tests incl. exploits, stability & >=4x realtime perf
node tools/verify-levels.js    # all 50 levels, reference + best design each (see "Levels" below)
node tools/test-editor.js      # editor behaviour (140 checks)
node tools/test-templates.js   # templates across synthetic + real levels
node tools/test-railinfo.js    # derailment explainer: every derail cause, ride card, read-only readouts
node tools/e2e.js [outDir]     # full browser run; screenshots go to %TEMP%/span-e2e by default
node tools/shot.js out.png [script.js] [waitMs]   # one headless screenshot, optional in-page eval
```

## Levels

50 levels in 6 chapters (the level select groups them the same way):

| Chapter | Levels | Gaps | Traffic | Introduces |
|---|---|---|---|---|
| 1 First Crossings | 1–5 | 10–20 m | cars, vans | road + wood, triangles, trusses above and below the deck |
| 2 Timber & Steel | 6–10 | 20–28 m | cars, vans, buses | uneven banks, long wood trusses, steel (8) |
| 3 Piers & Cables | 11–20 | 28–45 m | vans, buses | piers (11), rope (14), arches (15), cable stays (16), ship channels (18) |
| 4 Shipping Lanes | 21–30 | 46–70 m | buses, trucks | reinforced road, clearances, towers, cable-stayed and suspension |
| 5 Heavy Haul | 31–40 | 70–100 m | trucks, semis | convoys, deep canyons, few or no piers |
| 6 Grand Spans | 41–50 | 100–150 m | semis, tankers, heavies | long arches, cantilevers, multi-span cable bridges — the finale |

**First Crossings:** 1 Wobble Creek (10 m) · 2 Three's Company (14 m) · 3 Top Hat (16 m) · 4 Underbelly (18 m) · 5 Penny Pincher (20 m)

**Timber & Steel:** 6 Uphill Both Ways (20 m) · 7 Timber Giant (22 m) · 8 Steel Yourself (24 m) · 9 Best of Both (26 m) · 10 Chapter Closer (28 m)

**Piers & Cables:** 11 Pier Review (28 m) · 12 Lopsided (30 m) · 13 Stepping Stones (34 m) · 14 Rope Trick (35 m) · 15 Keystone (36 m) · 16 Stay Tuned (38 m) · 17 Bumper to Bumper (40 m) · 18 Mind the Masts (42 m) · 19 Highs and Lows (44 m) · 20 Grand Canyon Express (45 m)

**Shipping Lanes:** 21 Twenty Tonnes (46 m) · 22 Black Ice (48 m) · 23 Harbour Mouth (50 m) · 24 Coral Gate (54 m) · 25 Strung Along (60 m) · 26 Gridlock (60 m) · 27 Ice Cathedral (64 m) · 28 Harp Strings (66 m) · 29 Crosscurrents (68 m) · 30 The Long Haul (70 m)

**Heavy Haul:** 31 Convoy (70 m) · 32 Sandstone Arch (72 m) · 33 Graveyard Shift (75 m) · 34 Avalanche Run (78 m) · 35 Rush Hour (80 m) · 36 Hanging Valley (85 m) · 37 Moonlit Strait (88 m) · 38 Mirage Mesa (92 m) · 39 Glacier Gate (96 m) · 40 Century Span (100 m)

**Grand Spans:** 41 Cold Open (100 m) · 42 Twin Channels (105 m) · 43 Monsoon Stays (115 m) · 44 Moonlit Crescent (120 m) · 45 Caldera Cantilever (125 m) · 46 Avalanche Arch (130 m) · 47 Paradise Suspended (140 m) · 48 Flight Path (135 m) · 49 The Long Night (145 m) · 50 Magnum Opus (150 m)

Every level is verified by `node tools/verify-levels.js` against two designs in `tools/solutions/`:

- **`level-NN.json` (reference):** passes with peak stress ≤ 0.92 and cost ≤ budget.
- **`level-NN-best.json` (best):** passes with peak stress ≤ 0.99 and cost ≤ 70% of the budget, so ★★★ is provably reachable.
- Both must be valid and buildable in the editor (joints on the 0.25 m grid, no two joints closer than the 0.6 m joint magnet) and must have no floppy parts (no joint drifting more than 1 m while nothing breaks).

Budgets are set so the reference costs at most about 88% of the budget and the best design at most 70% (at most 68% on levels 41–50, leaving a little room for hand-built designs). No built-in template earns ★★★ on any level; templates are switched off on levels 1–3, and templates that break a level's rules (for example an arch through a ship channel) are hidden from the menu.

### Adding a level

1. Write `tools/levels/level-NN.json` (the shape is in SPEC.md §4.3) and run `node tools/build-levels.js`, which regenerates `js/core/levels.js`. Do not edit `levels.js` by hand.
2. Save a reference design as `tools/solutions/level-NN.json` and a cheap one as `level-NN-best.json`. You can build them in the game and copy them with `BG.Model.serialize(BG.Game.getDesign())` in the browser console.
3. Run `node tools/verify-levels.js --only NN` and adjust the budget until both designs pass.
