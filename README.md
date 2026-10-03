# SPAN: Bridge Builder

### ▶ [Play SPAN in your browser](https://athraen.github.io/SpanGame/)
Free, no install. Works on desktop, tablet and phone, and can be installed as an app that plays offline.

SPAN is a physics bridge-construction puzzle game that runs in the browser. You build a bridge across a gap from road, wood, steel, rope and cable, stay under budget, then press **Test** to watch real traffic drive across. If the bridge is too weak it sags, beams snap, and the bus ends up in the river.

It is plain HTML, CSS and JavaScript, with no build step and no runtime dependencies. Double-click `index.html`; it works straight from `file://`, on desktop, tablet and phone.

## The game at a glance

- **Three campaigns, 90 hand-made levels**, one tab each on the level select:
  - **Roads** (levels 1–50 in six chapters): from a 10 m creek crossed with two planks to a 150 m span carrying tankers and heavy haulers. Finishing the Roads reveals the bonus chapter **Forces of Nature** (51–53): a hurricane, an earthquake and a galloping deck in pulsing wind. Finishing level 40 reveals a second bonus chapter, **Anchorages** (54–58): land pylons, buried deadman anchors and backstays.
  - **Iron Road** (101–120, opens after level 10): railway bridges for handcars, trams, steam, 2000-tonne ore trains and 150 km/h expresses. Trains derail on kinks, steep grades and broken rails, and a track recording and ride-quality grade show why.
  - **Famous Bridges** (201–212, opens after level 15): scaled-down versions of real crossings, from the Pont du Gard to the Golden Gate, the Forth Bridge, Tacoma Narrows and the Millau Viaduct. Each one opens with a history card: who built it, when, and why the engineers chose that shape.
- **Real physics:** every member carries tension, compression and bending; road decks flex between supports; members turn yellow, then red, then snap. **Inspect** shows the peak stress each member reached, and the results name the first member that gave way and why.
- **Stars and challenge badges:** up to three stars per level for staying under budget, plus 2–3 optional badges per level (Minimalist, Penny Pincher, Featherweight, Cool Head, Symmetric, No Steel, Timber Only, No Piers, Smooth Ride). Every badge is proven achievable.
- **Daily Challenge and Endless:** a new generated crossing every day, the same for everyone, with streaks and a shareable result; Endless keeps generating harder crossings. The generator proves every crossing solvable before you see it.
- **History and personal bests:** every test run is recorded; per-level bests, a cost sparkline, lifetime stats, one-tap **Load** of any earlier design, autosave and **Resume** where you left off, and save export / import.
- **Templates and tools:** nine bridge templates from level 4 (beam, Warren, Pratt and Howe trusses, deck and through arches, suspension, cable-stayed, viaduct), an **Arch & Curve** tool that lays properly rounded arches and hanging cables in one gesture, mirror building, select / move / delete / smooth, undo / redo, piers and a build grid. Every level keeps your last design.
- **Plays anywhere:** mouse and keyboard on desktop. On phones and tablets there are touch gestures, a magnifier, a bottom-sheet palette and haptics. Served over http(s), SPAN installs as an app and works offline (PWA).
- **Polished presentation:** themed scenery for every region (meadow to volcanic), animated weather and quakes, trains with signals and catenary, procedural audio, slow-motion derailments, and a results card that reveals stars and badges one by one.

The top bar of a level states only facts about that level: chapter number (or the bonus chapter's name), gap, how many piers it allows and the time limit. The chapter names on the level select describe a whole region, and not every level in a region uses every feature its name mentions.

## How to play

1. **Pick a crossing** on the level select screen. A level opens once either of the two levels before it is complete, so one hard crossing can be skipped and revisited (its tile says "Skipped — come back later"). Chapter finales, the last level of each chapter, can't be skipped: nothing after one opens until it is complete. The (i) on each chapter header explains the rule. Each level awards 0–3 stars.
2. **Read the gap.** The top bar shows the cost/budget bar (with ★★★ and ★★ thresholds) and the traffic waiting to cross. The dashed rectangle is the build area. Hatched zones are no-build areas, such as ship clearance. Yellow-striped floor bands are pier zones. Nothing but piers and anchors may go under the water (or lava): joints must stay at or above the waterline. Where the build area reaches below the water, the waterline is drawn as a dashed limit over a hatched "piers only" band.
3. **Build.**
   - Pick a material in the bottom palette.
   - Drag from any anchor (the concrete bolts) or joint to place a beam. The beam stops at the material's maximum length and snaps to a 1 m grid and to nearby joints.
   - After you place a beam, building continues from its end: each click places the next beam (clicking empty space builds there too). Reaching an anchor ends the chain; Esc or right-click stops it anywhere. Clicking a joint that is out of reach builds toward it and stops at the material's maximum length, just as the preview shows.
   - A new joint that lands on an existing beam joins it: the beam is split there. So a strut that stops on the road is connected to the road.
   - Joints must stay at least 0.5 m clear of the ground (only anchors and piers bear on rock), and beams may not pass through it.
   - **Building on the banks.** Some crossings have *inland anchors*: concrete deadman blocks buried in a bank top, or anchor blocks set into a hillside behind the road, each with a steel bolt plate where members attach. Their *land pier zones* (striped on the bank) take **land pylons**: concrete towers on a footing that the road passes through. A land pylon is not a fixed point like a pier in the valley: its footing only resists a small push, so a pylon pulled by its stays must be **guyed back** with a backstay to an inland anchor behind it, or it topples. On these levels the bank road also has a **clearance envelope** (the amber "keep clear" band, as tall as the tallest vehicle plus 0.5 m): no joint or member may go inside it, except the road deck itself and stays that end at an inland anchor. The editor marks a violating beam red and says "Keep the road clear".
   - **Arches and cables: the Arch & Curve tool** (`A`, the arch button on the tool rail). Press on the start point (a bolt, a pier top, a joint or an empty grid point), drag to the end point and release; then move the pointer up or down to set the rise (below the line, the curve sags like a cable) and click to place it. The tool picks the fewest segments that fit the material's maximum length, keeps the joints on the grid and shows the curve, its joints, the span, rise, segment count and cost before you click; a red segment says why it can't go there. `+`/`−` or the wheel change the number of segments, `Esc` or right-click cancels. The bar under the top bar picks the shape: **Parabolic** (the ideal arch under an evenly loaded deck), **Circular** (the Roman arch, up to a half circle) or **Catenary** (a hanging cable; drag it below the line for a suspension main cable). With **Connect to deck** on, the curve's joints line up under (or over) the deck joints and every joint gets a vertical post (arch below the road) or hanger (arch or cable above it); **Brace panels** adds the diagonals a pin-jointed arch needs so it doesn't sway. Rope and cable can only hang below the line, stone can only arch above it. In mirror mode an arch on one side of the gap is mirrored. Each placement is one undo step. With the **Select** tool, **Smooth** fits a curve through three or more selected joints and spaces them evenly along it.
   - **Road** and **reinforced road** are what vehicles drive on. The road must run continuously from bank to bank, and it bends at its joints: it needs a supported joint (a strut, hanger or chord) about every 5–6 m. **Wood** and **steel** are structural members. **Rope** and **cable** only carry tension. Pier tops are rigid concrete supports.
4. **Test** (Space). Beams are coloured by live stress, from cool through yellow to red, and glow when above 85%. Hover a beam to see its force, stress and (for road) how much of it is bending. Overloaded members snap; the results say which member gave way first and why.
5. **Optimise.** After a run, **Inspect** shows the peak stress each member reached, drawn on the bridge as built, with broken members marked. Back in the editor, hovering a beam shows its peak from the last test. Trim the members that stay white or green and reinforce the red ones.
6. **Railway levels (Iron Road).** Trains derail on a kink between rail segments, a grade that is too steep, a broken or missing rail, or a bogie lifted off a crest. The kink is judged the way a bogie feels it: the angle between the rail segments under its first and last axle, averaged over its whole passage across the joint, against a limit of 4° that shrinks above 15 m/s (1.4° at 42 m/s). On the same track a slower train gets a wider kink limit. While a train runs, the **track recording** strip above the sim controls (`T`) plots the grade and kink at every rail joint against the red limit bands; the kink limit shrinks for fast trains. When a train derails, the action drops into slow motion, the offending wheel and rail segment pulse red, and a callout names the cause with numbers (for example "Kink 4.1° at 32 m/s — limit here is 1.9°"). The results show two verdicts, *Structure held* and *Train stayed on the rails*, plus a ride-quality card: worst grade, worst kink against its limit, peak sag and a smoothness grade from A to F. Masonry that is being pulled glows red with crack marks, live and in the peak view.

**Pass** means every vehicle drives across to the far bank within the time limit and the cost is at or under budget. Over-budget bridges can still be tested, but they can't complete the level. A run fails when a vehicle falls, when a vehicle is launched across instead of driving (a ramp is not a bridge), when all traffic is stuck for 5 s, or at the time limit.

| Stars | Requirement |
|---|---|
| ★ | Pass |
| ★★ | Pass, cost ≤ 85% of budget |
| ★★★ | Pass, cost ≤ 70% of budget (Iron Road: and no member broke, the *Structure held* verdict) |

Your progress and your last design for each level are saved in `localStorage` automatically. The game still works when storage is unavailable.

## Challenge badges

Beyond stars, every level (Roads with the bonus chapter, Iron Road and Famous Bridges) has 2-3 optional **challenge badges**: *Minimalist* (at most N members), *Penny Pincher* (under a share of the budget), *Featherweight* (lightest structures), *Cool Head* (peak stress at or below 50-60 %), *Symmetric* (mirror-perfect about mid-span), *No Steel*, *Timber Only*, *No Piers* and, on railway levels, *Smooth Ride* (the worst track kink the train felt stays at or below a share of its limit, for example 40 %). A badge needs a **passing** run. The **Goals** button in the top bar (key **G**) opens a panel with live progress; the results screen reveals earned badges one by one, level tiles show `earned/total`, and the title and level-select screens show the grand total. Badges are saved per level id in `localStorage` (`span.v1.badges`). Every goal is guaranteed achievable: `tools/gen-goals.js` proves each one with a saved design in `tools/solutions/goals/`.

## Daily Challenge and Endless

The **Daily Challenge** button on the title screen opens a new generated crossing every day. Everyone gets the same level for the same date, in every browser. Difficulty follows the week: Monday is gentle and Sunday is brutal. The generator proves that every level can be solved before you see it (see "Level generator" below). Its own bridge costs about 75% of the budget, so its design earns ★★. For ★★★ you need a better bridge than the generator found.

- The daily panel shows today's crossing, your best result today, your streak (consecutive days with a passed daily) and your best streak. It also has a 14-day history strip. Click a past day to play it as practice. Practice results are kept, but they don't count toward the streak.
- After a pass, the results show a share card: date, stars, cost as a percentage of the budget, number of members, and an emoji bar. **Copy result** puts it on the clipboard.
- **Endless** plays random generated crossings that get harder each time. Your run score is crossings cleared plus stars. The best run is saved, and you can continue the current run later.
- Daily and endless results are stored apart from the campaigns (Roads, the bonus chapter, the Iron Road and Famous Bridges), so they never change campaign stars, unlocks or badges. Today's level is cached, and your design for each daily is saved like any other level.
- URL helpers: `?daily` plays today's daily, `?daily=20261002` plays a given date, `?endless` continues the endless run, and `?today=20261005` pretends it is that day (for testing).

<!-- history: -->
### History, personal bests and resume

- **Autosave and resume:** the design is saved shortly after every change and whenever the tab is hidden or closed. On reload the game returns to the level (design and camera) or the level-select screen you were on; the title shows **Resume · Level N**. A test in progress comes back in edit mode. Resume is skipped after 72 hours or when the URL has `?level`, `?screen` or `?noresume`.
- **Personal bests:** each level tracks your lowest cost, fewest members, lowest peak stress, fastest crossing and most stars over passing runs. The results card says "First pass on this level" or "New best! −$420 vs your previous $X" and shows the attempt number; level tiles list your bests in their tooltip.
- **History screen** (clock button on the title and level-select screens): **Runs** (every test, filterable by level and pass/fail, with a cost sparkline against the budget), **Levels** (bests per level, **Load best**) and **Stats** (runs, bridges that held, collapses, beams placed, budget spent, favourite material, play time, levels passed). **Load** opens a stored design in the editor as one undo step. The latest 500 runs are kept, plus a few design snapshots per level (always the ones that hold a best).
- **Save export / import:** Settings → **Save data** → **Export** downloads `span-save-YYYYMMDD.json` with all your progress, designs, history and settings; **Import** checks the file, replaces the save on this device and reloads. Use it to move progress between browsers or devices. **Reset progress** also clears history and stats.

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
| `A` | Arch & Curve tool: drag start to end, release, move up/down for the rise, click to place; `+`/`−` or wheel = segments, `Esc` / right-click cancels |
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
| `F` / **Follow** button | Camera follows the traffic: the lead train (or the lead vehicle) at a comfortable zoom, stopping at the far bank. On by default for gaps over 60 m; your choice is kept per level. While following, the wheel scales the follow zoom and a drag peeks around (it eases back) |
| `T` / **Track** button | Track recording strip on railway levels (on by default there): grade per rail segment and kink per joint, against red limit bands. The kink band slides with the train's speed; a red bar is over the limit, a white tick is that joint's peak so far, and the right-hand readout shows the worst grade and the worst kink with the speed it was judged at |
| `Enter` (results) | Next level if passed, otherwise back to editing |

<!-- mobile: touch controls -->
### Touch (phones and tablets)

The HUD adapts on touch screens: a compact top bar, the tools as floating buttons, and on phones the materials in a bottom sheet behind the current-material chip. Portrait works; landscape gives the bridge more room.

| Gesture | Action |
|---|---|
| Drag from a joint | Build a beam (a magnifier shows the spot under your finger) |
| Tap a joint | Start building from it; tap the last joint again to stop |
| Hold, then drag | Move a joint |
| Hold and lift | Menu: delete the joint / beam / pier under the finger, stop building, undo, fit view |
| Arch tool: drag start to end, then drag the handle | Set the rise; tap to place the curve, two-finger tap cancels, − / + in the bar change the segments |
| Drag empty space / two fingers | Pan |
| Pinch | Zoom (also while the test runs) |

Settings has touch options: magnifier, offset cursor (aim above the finger), vibration, performance mode (Auto / On / Off: fewer particles and background layers, lower pixel density on slow devices) and fullscreen.

Every mode works by touch. On phones the **Goals** panel opens from its top-bar button as a sheet and closes when you touch the bridge. On the Iron Road the track recording sits just above the test controls (in portrait, under the top bar), and a derailment explanation appears under the top bar. The daily panel's 14-day history scrolls sideways. A Famous Bridges history card shows the picture and the story side by side in landscape. On Forces of Nature levels a forecast chip under the top bar lists the coming wind and quakes. On a long results card the buttons stay pinned to the bottom.

## Running it

- **Play:** open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari). No server is needed.
- **Handy URL parameters:**
  - `index.html?level=3` jumps straight into level 3.
  - `?screen=levels` opens level select.
  - `?unlockall` unlocks every level.
  - `?touchui=1` / `?touchui=0` forces the touch layout on or off (it normally follows the device's pointer).
  - `?noresume` starts on the title screen instead of resuming the last session.

## Install and offline play (PWA)

<!-- pwa: -->
Served over **http(s)**, SPAN is an installable Progressive Web App that works offline. From `file://` the game runs exactly as before, just without these extras.

- **Install:** on Android/desktop Chrome or Edge, open Settings and press **Install SPAN** (or use the browser's install icon). On iPhone/iPad, Settings shows how: tap **Share**, then **Add to Home Screen**. The app opens full-screen in any orientation.
- **Offline:** the first visit precaches every game file (about 2.9 MB, 132 files; `node tools/gen-precache.js` prints the current size). After that everything works with no connection: all three campaigns and the bonus chapter, daily challenge and endless (generated on the device), history, settings and save export, and your saved progress. `node tools/test-offline-tour.js` proves it by touring every screen offline.
- **Updates:** when a new version is deployed, a **New version available — tap to reload** toast appears. Your designs are saved, so reloading is safe.
- **Serve locally:** `node tools/serve.js [port]` (no dependencies) serves the repo at `http://localhost:8080/`. Service workers only run on `localhost` or https, so a phone on your network can play from it but won't install it.

How it works: `manifest.webmanifest` describes the app, and the icons live in `assets/icons/app/` (they are regenerated by `node tools/gen-icons.js`). `sw.js` precaches a versioned file list. It serves css, js and assets cache-first, serves `index.html` network-first (falling back to the cached copy when offline or after 3.5 s), deletes old caches on activate, and waits for the player's tap before switching versions. `js/features/pwa.js` registers the worker (on http(s) only) and drives the toast and the Settings rows.

**After changing any shipped file, run `node tools/gen-precache.js`.** It rescans `index.html`, `css/`, `js/` and `assets/`, then rewrites the list and content-hash version in `sw.js`. `--check` reports a stale list without rewriting it.

### Deploying to GitHub Pages

`.github/workflows/pages.yml` deploys on every push to `main` (or when run manually). It runs the physics and level checks, regenerates the precache, and publishes only the game files (`index.html`, `sw.js`, `manifest.webmanifest`, `css/`, `js/`, `assets/`). To turn it on, go to **Settings → Pages → Source: GitHub Actions** in the repository. Every path is relative, so the site works at `https://<user>.github.io/<repo>/`.

## Project structure

```
index.html               page shell; loads the classic scripts below in order
css/style.css            HUD / menus (glass panels, system font stack)
js/core/                 simulation core - runs in the browser AND in Node, no DOM
  materials.js           BG.Materials, BG.MaterialOrder, BG.Costs
  vehicles.js            BG.Vehicles (car ... 60 t heavy hauler), BG.VehicleOrder
  trains.js              BG.RailCars, BG.Trains (handcar ... ore, high-speed), BG.RailRules + designer notes
  model.js               BG.Model - design helpers, cost, validation, (de)serialisation
  physics.js             BG.Simulation - deterministic XPBD, fixed 1/60 s step with substeps
  levels.js              BG.Levels - level definitions
  templates.js           BG.Templates - bridge-type generators
  curves.js              BG.Curves - curve geometry for the Arch & Curve tool (parabola / circle / catenary, equal segments, grid)
  events.js              BG.Forces - wind and earthquake events (level.events), plugged in via BG.SimHooks
  generator.js           BG.Generator - deterministic procedural levels, each proven solvable (daily / endless)
js/render/
  effects.js             BG.Effects - particles, debris, splashes, camera shake
  renderer.js            BG.Renderer + BG.Sprites - layered canvas renderer (parallax, water, terrain, beams, vehicles)
js/ui/
  audio.js               BG.Audio - synthesized WebAudio SFX, engines, ambience (no audio files)
  storage.js             BG.Storage - settings, progress, saved designs (localStorage, try/catch)
  editor.js              BG.Editor - mouse/touch/keyboard construction tools
  railinfo.js            BG.RailInfo - derailment explainer, track recording strip, ride-quality card (display only)
  hud.js                 BG.Hud - title, level select, top bar, palette, tool rail, results, settings
  arch-tool.js           BG.ArchTool - the Arch & Curve tool + Smooth (extends BG.Editor, contextual bar, hint; loaded after main.js)
js/features/
  terrain-fix.js         BG.TerrainFix - draws the waterline build limit in edit mode
  goals.js               BG.Goals - badge evaluation (pure, Node-testable)
  goals-data.js          BG.GoalsData - per-level goal sets (GENERATED by tools/gen-goals.js)
  goals-ui.js            goals panel, results badge reveal, tile counts, badge persistence (wraps BG.Hud, extends BG.Storage)
  forces-fx.js           wind / quake visuals, warning banner + timeline, wind and rumble audio, bonus chapter (wraps BG.Renderer / BG.Hud / BG.Game)
  daily.js               BG.Daily - Daily Challenge + Endless mode (title button, panel, share card, streak/history; wraps BG.Game / BG.Hud / BG.Storage)
  requirements.js        BG.Requirements - which optional modules a level needs (level.requires, stub levels); also loaded headless
  famous.js              BG.Famous - Famous Bridges campaign: its level-select tab (BG.Hud.registerCampaign), history cards
css/arch-tool.css        the Arch & Curve contextual bar
css/goals.css            styles for the above
css/forces.css           styles for the Forces of Nature HUD
css/daily.css            styles for the daily panel, loader and share card
css/famous.css           Famous Bridges tiles and history card
js/main.js               BG.Game - state machine (title -> levelSelect -> edit <-> sim -> results) + main loop
js/features/pwa.js       BG.PWA - service-worker registration, update toast, install button / iOS hint
css/pwa.css              styles for the above
js/features/history.js   BG.History - run history, personal bests, stats, autosave / resume, save export / import (data part also runs in Node)
css/history.css          History screen, results bests line, Save data row
js/features/mobile.js    BG.Mobile + BG.Perf - touch layer (loupe, long-press menu, bottom sheet, rotate prompt, haptics), performance mode
css/mobile.css           touch / phone / tablet layout (only active under .m-touch on <html>)
sw.js                    service worker (precache list generated by tools/gen-precache.js)
manifest.webmanifest     web app manifest; icons in assets/icons/app/
assets/famous/           hand-made SVG illustrations, one per famous bridge
assets/sprites/          hand-written SVG vehicles (1 unit = 1 cm), wheels, anchor, joint; rail/ holds the rolling stock
assets/icons/            SVG UI icons
assets/icons/badges/     hand-made challenge badge medallions
assets/bg/               painterly per-theme backgrounds (<theme>.jpg)
tools/                   Node tooling (not loaded by the game)
  harness.js             loads js/core/* in Node; runHeadless(level, design, opts)
  test-physics.js        physics unit / behaviour / performance tests
  verify-levels.js       runs every level against its reference and best designs
  build-levels.js        assembles tools/levels/level-NN.json into js/core/levels.js
  levels/                one JSON file per level (the source of js/core/levels.js)
  test-editor.js         editor tests (fake DOM / renderer)
  test-templates.js      template generator tests (--verbose, --svg out.html)
  test-events.js         wind / quake physics, bit-identity of event-free levels, levels 51-53
  e2e.js                 headless-Chrome end-to-end check of the real game
  test-terrain-fix.js    underwater build rule + drawn terrain matches the model (Node + headless Chrome)
  test-anchors.js        inland anchors, land pylons, roadway clearance envelope (SPEC §17)
  test-arch-tool.js      Arch & Curve tool: curve geometry, editor gesture + rules, levels 15 / 106 / 208 built with it (Node + headless Chrome)
  e2e-events.js          headless-Chrome check of the Forces of Nature levels and HUD
  test-generator.js      365 dailies + 200 random seeds: valid, road-only, solvable, deterministic; distribution + timing
  test-daily.js          daily/endless records, streaks, share text (Node) + headless-browser daily/endless flow
  test-famous.js         Famous Bridges data, gating, templates + a headless browser run of the campaign
  shot.js                headless screenshot helper
  test-railinfo.js       derailment explainer tests
  gen-goals.js           picks + proves 2-3 achievable goals per level (roads and Iron Road) -> js/features/goals-data.js
  test-goals.js          re-verifies every shipped goal against its saved design
  solutions/goals/       level-NN-<goal>.json: one verifying design per goal
  solutions/             level-NN.json (reference) and level-NN-best.json (proves ★★★) for every level
SPEC.md                  binding data contracts between modules
```

All modules hang off one global, `window.BG`. Every `js/core` file is wrapped so that it also loads in Node (`globalThis.BG`). The simulation is deterministic: it uses a seeded PRNG and its own trig helpers, so the headless verifier's result matches what the browser shows.

## Tests and tools

You need Node 18 or later (developed on Node 24). The browser checks also need the dev dependency (`npm install` installs Playwright) and a local Chrome. They always run **headless**; nothing opens a window.

```sh
node tools/test-physics.js     # 31 physics tests incl. exploits, stability, rail rules & >=4x realtime perf
node tools/verify-levels.js    # every level (50 road + 8 bonus + 20 rail + 12 Famous Bridges), reference + best design each (see "Levels" below)
                               #   --campaign road|rail|famous, --only 101-120, --ref-only
node tools/test-editor.js      # editor behaviour (140 checks)
node tools/test-unlock.js      # campaign unlock rule: skip one level, chapter-finale gates, skipped markers, migration
node tools/test-templates.js   # templates across synthetic + real levels; no template earns ★★★ on 101-120 (--no-sim skips that)
node tools/test-railinfo.js    # derailment explainer: every derail cause, ride card, read-only readouts
node tools/test-terrain-fix.js # underwater rule, editor feedback, drawn cliffs vs model (--no-browser: Node only)
node tools/test-arch-tool.js [--node-only] # Arch & Curve tool: geometry, editor, levels 15 / 106 / 208 built with it and passing, touch
node tools/test-anchors.js     # inland anchors, land pylons (guyed stands / unguyed topples), roadway envelope, templates, editor, Anchorages 54-58
node tools/test-goals.js       # every badge goal re-verified by simulation (tools/gen-goals.js regenerates them)
node tools/test-events.js      # wind / quake events (add --full for the bit-identity check on every road and rail design)
node tools/e2e-goals.js [outDir]   # headless browser check of the badges UI + persistence
node tools/e2e.js [outDir]     # full browser run incl. the Iron Road; screenshots go to %TEMP%/span-e2e by default
node tools/e2e-events.js [dir] # browser run of levels 51-53 (banner, timeline, rumble); %TEMP%/span-e2e-events
node tools/test-generator.js   # generator batch: 365 days + 200 seeds (--quick for a short run, --verbose per level)
node tools/test-daily.js       # daily/endless: Node records + headless browser flow (--node-only)
node tools/test-famous.js      # Famous Bridges campaign (add --node-only to skip the browser part)
node tools/shot.js out.png [script.js] [waitMs]   # one headless screenshot, optional in-page eval
node tools/test-pwa.js [outDir] # PWA: SW install, precache, offline reload, update toast, install UI (phones/tablets)
node tools/test-offline-tour.js [outDir] [--no-shots] # offline guarantee: install once, go offline, tour every screen + campaign (desktop + phone); fails on any request not served by the SW, console errors, broken images
node tools/test-mobile.js [outDir] # touch: phone/tablet layouts, touch-built level 1, loupe, long-press menu, pinch, History + Install rows, every feature screen (goals, Iron Road, daily/endless, famous, forces) (headless)
node tools/test-history.js [--node-only]     # history: migration, bests, retention, export/import, autosave + resume in the browser
node tools/gen-precache.js [--check]   # refresh / verify the service worker's precache list
node tools/gen-icons.js        # re-render the app icons
node tools/serve.js [port]     # static http server (PWA features need http(s))
```

## Levels

Roads: 50 levels in 6 chapters, plus two hidden bonus chapters (the level select groups them the same way):

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

The hidden bonus chapters **7 Forces of Nature** (51–53) and **8 Anchorages** (54–58) are described below.

Every level is verified by `node tools/verify-levels.js` against two designs in `tools/solutions/`:

- **`level-NN.json` (reference):** passes with peak stress ≤ 0.92 and cost ≤ budget.
- **`level-NN-best.json` (best):** passes with peak stress ≤ 0.99 and cost ≤ 70% of the budget, so ★★★ is provably reachable.
- Both must be valid and buildable in the editor (joints on the 0.25 m grid, no two joints closer than the 0.6 m joint magnet) and must have no floppy parts (no joint drifting more than 1 m while nothing breaks).

Budgets are set so the reference costs at most about 88% of the budget and the best design at most 70% (at most 68% on levels 41–50, leaving a little room for hand-built designs). No built-in template earns ★★★ on any level; templates are switched off on levels 1–3, and templates that break a level's rules (for example an arch through a ship channel) are hidden from the menu.

### Iron Road (levels 101–120)

The railway campaign opens when road level 10 is complete (the **Iron Road** tab on the level select says so while it is locked; `?unlockall` opens it too). Inside it the usual rule applies: a level opens when either of the two before it is complete, and the last level of each line (105, 110, 115, 120) can't be skipped.

| Chapter | Levels | Gaps | Trains | Introduces |
|---|---|---|---|---|
| 1 Branch Lines | 101–105 | 10–24 m | handcar, tram, local steam | rail track, kinks and grades, trusses under the track |
| 2 Stone & Steam | 106–110 | 26–50 m | local steam, steam express | masonry: arches and viaducts that stay in compression |
| 3 Freight Corridor | 111–115 | 50–100 m | commuter, long freight, 2000 t ore | the whole span loaded at once, deep trusses, box girders |
| 4 High Speed | 116–120 | 80–140 m | high-speed sets at 42 m/s | dips that only a fast train notices; double-deck road + rail |

**Branch Lines:** 101 Pump Trolley (10 m) · 102 Mind the Kink (12 m) · 103 Over the Top (16 m) · 104 Full Steam (18 m) · 105 Branch Closer (24 m)

**Stone & Steam:** 106 Push, Don't Pull (26 m) · 107 Twin Arches (32 m) · 108 Stone Steps (40 m) · 109 Night Mail (50 m) · 110 Ash Valley (48 m)

**Freight Corridor:** 111 Commuter Belt (50 m) · 112 Fourteen Wagons (65 m) · 113 Cantilever Firth (90 m) · 114 Iron Mountain (60 m) · 115 Heavy Metal (100 m)

**High Speed:** 116 Smooth Operator (80 m) · 117 Stay Fast (120 m) · 118 Two Storeys (90 m) · 119 Whiteout Express (130 m) · 120 Grand Terminus (140 m, the finale)

- **Materials:** *Rail Track* is the only deck trains ride on (road vehicles never use it), heavier and stiffer than road and laid nearly level. *Masonry* is cheap and enormously strong in compression but cracks in tension (it glows red when pulled). *Box Girder* is the heavy steel member for the ore trains.
- **Derailment:** a kink, a grade over the limit for 0.3 s, a missing or broken rail under a wheel, or a bogie lifted off the track. Levels may set their own limits.
- **Double-deck levels (118, 120):** road and rail both start at the top bank bolts; the road ramps down onto a lower deck. The express crosses first; road traffic follows; a train that comes after road traffic waits until it can no longer catch up with it on the shared approaches.
- **Stars:** as on the road, plus ★★★ needs the structure to hold. Following the train with the camera (`F`) and the track strip (`T`) are the main tools for reading a run.

Rail levels are verified like road levels, plus a ride margin: the reference design's worst kink stays at or below 95% of its limit and the best design's at or below 100% (both pass with no grade over its limit), and the best design passes with no broken member. On 116–120 the best designs cost about 67% of the budget, leaving room for hand-built three-star bridges.

### Forces of Nature (bonus chapter, levels 51–53)

Finishing level 50 reveals a hidden seventh chapter where the weather fights back. A **Forecast** chip in the top bar lists what is coming, a banner counts down the last 3 seconds ("Hurricane incoming in 3 s") and then shows the live wind speed or ground shaking, and the sim bar's timeline marks each event.

| Level | Event | Lesson |
|---|---|---|
| 51 Hurricane Alley (60 m) | 34 m/s headwind gusting to ~50 m/s, rain | Gusts lift the deck and cables can only pull: a light road on stays snaps in bending. A heavier, stiffer deck rides it out. |
| 52 Fault Line (40 m) | M8 earthquake (0.4 g) at 8 s | The banks lurch and the far bank lags the near one. Heavy decks shake hardest; light, stiff triangles win. |
| 53 Galloping Gertie (70 m) | 19 m/s wind that pulses every ~2.5 → 1.7 s | A slender suspension deck bounces in step with the gusts until it tears itself apart (Tacoma Narrows, 1940). Diagonal hangers, a stiffening truss or stays make it bounce faster than the wind pushes. |

Any level can use weather: add an `events` list to its JSON (see SPEC.md §12).

### Anchorages (bonus chapter, levels 54–58)

Finishing level 40 reveals a hidden eighth chapter about structures that stand on the banks (SPEC.md §17). It branches off the Roads: completing 40 opens 54 (a toast says so), inside the chapter the usual rule applies (either of the two before), none of its levels is a chapter finale that blocks anything, and the Roads carry on at 41 as before. No steel on 54–57: only road, cable and rope, so the deck has to hang from pylons. A pylon in a striped land zone is a concrete column on a footing that can only take a small sideways pull; the stays pull it toward the gap, so every pylon needs a backstay to an inland anchor behind it, or it leans and topples onto the bank. Nothing may cross the amber "KEEP CLEAR" band over the bank roads except the deck and members that end at an inland anchor.

| Level | Gap | Traffic | The idea |
|---|---|---|---|
| 54 Dead Weight | 36 m | 3 buses, 1 truck | Two land pylons, each tied back to a deadman anchor buried in the bank: the backstays are the whole puzzle. |
| 55 Guy Lines | 44 m | 3 trucks | The land zones stand well back from the crumbling edges, so the pylons must be tall enough for their stays to clear the trucks; guy them back to anchorages set into hillsides. |
| 56 Lone Pylon | 34 m | 2 trucks, 2 buses | One pylon on the near bank fans stays across the whole gorge, and two deadmen behind it can share the pull. |
| 57 Buried or Tied | 60 m | 3 buses, 2 vans | A suspension or stayed span either way: towers in the river with the cable ends tied down to the road ends, or cheaper towers on the banks with the cables run back to buried deadmen. |
| 58 Grand Anchorage | 100 m | 2 buses, 3 trucks | The finale: a suspension bridge with towers on both banks, a stiffened deck (steel is back) and the main cable carried into hillside anchorages. |

The reference design of 57 stands its towers in the river; every best design uses land pylons. Without their backstays the best designs lose their pylons (checked by `tools/test-anchors.js`, which also checks that no template earns ★★★ here).

### Famous Bridges (levels 201–212)

A separate campaign of real bridges, scaled down but faithful: each crossing keeps the real bridge's proportions, pier positions, shipping channel and kind of traffic, and is set up so that the historical structural type is the natural answer. Before each level a **history card** shows when and where it was built, its engineers, span and type, three facts, and why it matters (the bridge icon in the top bar opens it again). Pick a bridge from the **Famous Bridges** tab on the level select (the third campaign tab, after Roads and Iron Road). It opens when road level 15 is complete; after that the usual rule applies (either of the two previous famous bridges; only the last one, the finale, can't be skipped).

| # | Bridge | Year | Gap | The idea |
|---|---|---|---|---|
| 1 | Pont du Gard | c. 50 AD | 64 m | arches on piers over the Gardon (wood/steel for now; masonry comes when the level is re-verified with it) |
| 2 | Ponte Vecchio | 1345 | 44 m | shallow segmental arches on two low piers, nothing above the deck |
| 3 | The Iron Bridge | 1779 | 30 m | one deck arch from the banks, no piers (river traffic) |
| 4 | Brooklyn Bridge | 1883 | 100 m | towers in the river, suspension cables plus stays |
| 5 | Forth Bridge | 1890 | 150 m | a steam express on three steel cantilevers hung from tall pier towers, shallow over the two shipping channels |
| 6 | Tower Bridge | 1894 | 90 m | two towers, ship channel, everything carried from above |
| 7 | Sydney Harbour Bridge | 1932 | 100 m | through arch, harbour clear below the road |
| 8 | Golden Gate Bridge | 1937 | 140 m | long suspension span between two towers |
| 9 | Tacoma Narrows | 1940 | 140 m | suspension span in a pulsing 19 m/s wind (`BG.Forces.presets.tacoma`): a plain deck on vertical hangers gallops apart, diagonal hangers stiffen it |
| 10 | Akashi Kaikyō Bridge | 1998 | 150 m | longest span: suspension with a stiffening truss, trucks |
| 11 | Øresund Bridge | 2000 | 140 m | cable-stayed pylons beside the shipping lane |
| 12 | Millau Viaduct | 2004 | 150 m | seven piers in a deep valley, short masts with fans of stays |

Levels use ids 201+ and `campaign: 'famous'` (`tools/levels/level-2NN.json`, solutions in `tools/solutions/` as usual). A level can list modules it needs in `requires` (`'wind'`, `'rail'`, `'masonry'`) and can be marked `stub` while it has no verified designs; until `BG.Requirements` sees the module and the stub mark is gone, the level is shown locked with its history card and the verifiers (and badge tests) skip it. All twelve are playable now (the Forth Bridge needs the Iron Road's trains, Tacoma Narrows the Forces of Nature wind), and every one has challenge badges.

### Campaigns, tabs and the title screen

The level select has one tab per campaign: **Roads** (1–50, plus the hidden *Forces of Nature* chapter 51–53 once 50 is done and the hidden *Anchorages* chapter 54–58 once 40 is done), **Iron Road** (101–120, opens after road level 10) and **Famous Bridges** (201–212, opens after road level 15). The rules live in one table, `BG.Storage.CAMPAIGNS` (unlock level, final id, the bonus chapter's end), and every campaign follows them the same way: a level opens when either of the two playable levels before it in its campaign is complete, but never past an unfinished chapter finale (the `gates`: road 5, 10, 20, 30, 40, 50, rail 105, 110, 115, 120, and each campaign's last level; players who already had levels open past one keep them), **Next** stays inside the campaign, and each campaign has its own finale (after 50, after the bonus level 53, after 120 and after 212). `BG.Hud` draws the tabs from its own table of looks; a feature adds a campaign with `BG.Hud.registerCampaign(id, {...})` (Famous Bridges does). **Continue** on the title screen resumes the last level played in any campaign, or the next open level of that campaign (then of the others). The title screen also has the **Daily Challenge** and **Endless** buttons; both keep their results apart from the campaigns.

### Adding a level

1. Write `tools/levels/level-NN.json` (the shape is in SPEC.md §4.3) and run `node tools/build-levels.js`, which regenerates `js/core/levels.js`. Do not edit `levels.js` by hand.
2. Save a reference design as `tools/solutions/level-NN.json` and a cheap one as `level-NN-best.json`. You can build them in the game and copy them with `BG.Model.serialize(BG.Game.getDesign())` in the browser console.
3. Run `node tools/verify-levels.js --only NN` and adjust the budget until both designs pass.

Land-side structures (SPEC.md §17) are opt-in per level: mark an anchor on a bank `{"x": -24, "y": 0, "inland": true}` (a deadman block; give it a `y` above the bank to set it into a hillside), give a pier zone `"ground": "left"` or `"right"` to let land pylons stand on that bank (optional `"footing"`: its overturning limit in N·m), and the roadway clearance envelope switches on by itself (`"roadClearance"` sets its height in metres, or `false` turns it off). Levels without these fields play exactly as before.

## Level generator

`BG.Generator` (`js/core/generator.js`) builds a level from a seed and a difficulty from 0 to 1. Daily seeds are dates in `YYYYMMDD` form. The generator uses its own seeded PRNG and only basic arithmetic and `sqrt`, so a seed gives a bit-identical level in Node and in every browser.

1. **Shape.** A seeded archetype picks the layout: open valley, cliff ledges, low headroom, no ledges, a ship channel or a pier valley. The difficulty sets the gap (about 12–42 m, or 34–62 m for pier valleys), bank heights, water, materials and traffic. Traffic runs from cars and vans up to semis and tankers.
2. **Proof.** A built-in solver makes parametric trusses on the editor's 0.25 m grid. They come in Pratt or Warren form, above, below or on both sides of the deck, with one or two tiers, in wood or steel, on road or reinforced road, with or without piers. The solver runs each candidate through the real simulation headless. It takes the cheapest family whose strongest truss passes with peak stress ≤ 92%, then binary-searches that family's cheaper variants.
3. **Budget.** The budget is set to the cheapest passing cost ÷ 0.75. The time limit comes from that bridge's run.
4. **Retry.** If nothing passes, the level is adjusted the same way every time and solved again: first more materials, then a pier zone, then lighter traffic, then a shorter gap.

Generation takes about 0.1–1 s (about 0.45 s on average in Node). The browser runs it in time slices and caches today's level. `node tools/test-generator.js` checks 365 days and 200 random seeds and reports the distributions.
