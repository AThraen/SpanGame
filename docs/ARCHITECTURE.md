# Architecture

SPAN is a static web page: one `index.html`, a few stylesheets, and about thirty classic `<script>` files that all attach themselves to one global object, `BG`. There is no bundler, no module loader and no framework. This page explains how the pieces fit together. The exact data shapes each module exchanges are in [SPEC.md](../SPEC.md), which is the binding contract.

## Design constraints

These rules shape everything below:

- **No build step.** What is in the repository is what runs. Editing a file and reloading the page is the whole development loop.
- **`file://` compatible.** Double-clicking `index.html` must work, so there are no ES modules (browsers block them from `file://`), no `fetch` of local JSON, and no reading pixels back from canvases. Levels are compiled into a script (`js/core/levels.js`), and images load through `<img>`.
- **No runtime dependencies.** The only npm package is Playwright, a dev dependency used to drive headless Chrome in the tests.
- **Every player-facing text is translatable.** UI code reads its words from `BG.i18n` dictionaries (English and Danish) and formats numbers through it; see [I18N.md](I18N.md).
- **A deterministic simulation that also runs in Node.** The headless verifier must see exactly what the player sees, so the physics core has no DOM access, no `Math.random` and no wall-clock time.

## Layers and load order

`index.html` loads the scripts in this order. Each layer may use the layers above it, never the ones below.

```
js/i18n/        i18n.js  en/<area>.js  da/<area>.js
                  BG.i18n and the dictionaries: no dependencies, loaded first (docs/I18N.md)
js/core/        materials.js  vehicles.js  trains.js  model.js  physics.js  events.js
                levels.js  templates.js  generator.js
                  pure logic: browser AND Node, no DOM, deterministic
js/render/      effects.js  renderer.js
                  canvas drawing, particles, camera
js/ui/          audio.js  storage.js  editor.js  railinfo.js  hud.js
                  input, menus, synthesized sound, localStorage
js/main.js      BG.Game: state machine and main loop
js/features/    terrain-fix  goals goals-data goals-ui  forces-fx  daily  requirements famous
                history  pwa  mobile
                  optional modules that extend what is already loaded
```

Every core file is wrapped so it can load in either environment:

```js
(function (root) {
  const BG = (root.BG = root.BG || {});
  // ...
})(typeof window !== 'undefined' ? window : globalThis);
```

`tools/harness.js` loads the core files into Node with `vm.runInThisContext`, in the same order, and exposes `runHeadless(level, design)`. That is how the level verifier, the badge prover and the generator tests run the real simulation without a browser.

## The modules

| Module | Global | Role |
|---|---|---|
| `i18n/i18n.js`, `i18n/<lang>/<area>.js` | `BG.i18n` | translations (English, Danish), plurals, number / money / length formatting, the `languagechange` event (see [I18N.md](I18N.md)) |
| `core/materials.js` | `BG.Materials`, `BG.MaterialOrder`, `BG.Costs`, `BG.LandPylon` | material properties (cost, mass, stiffness, strength, max length), pier costs |
| `core/vehicles.js` | `BG.Vehicles` | road vehicles from a 1.2 t car to a 60 t heavy hauler |
| `core/trains.js` | `BG.RailCars`, `BG.Trains`, `BG.RailRules` | rolling stock, train presets, derailment limits |
| `core/model.js` | `BG.Model` | the design data model: node lookup, cost, validation, road connectivity, (de)serialisation |
| `core/physics.js` | `BG.Simulation`, `BG.SimHooks` | the XPBD simulation (see [PHYSICS.md](PHYSICS.md)) |
| `core/events.js` | `BG.Forces` | wind and earthquake loads, plugged into the sim through `BG.SimHooks` |
| `core/levels.js` | `BG.Levels` | every campaign level, **generated** from `tools/levels/*.json` |
| `core/templates.js` | `BG.Templates` | generators for the nine bridge templates |
| `core/generator.js` | `BG.Generator` | procedural daily / endless levels, each proven solvable with its own solver |
| `render/effects.js` | `BG.Effects` | particles, debris, splashes, smoke, camera shake |
| `render/renderer.js` | `BG.Renderer`, `BG.Sprites` | the layered canvas renderer and camera (including follow mode) |
| `ui/audio.js` | `BG.Audio` | all sound, synthesized with Web Audio (engines, horns, creaks, crashes, ambience) |
| `ui/storage.js` | `BG.Storage` | settings, progress, saved designs and the campaign table, all in `localStorage` behind try/catch |
| `ui/editor.js` | `BG.Editor` | building tools for mouse, touch and keyboard; undo / redo; snapping; mirror |
| `ui/railinfo.js` | `BG.RailInfo` | the derailment explainer, track recording strip and ride-quality card (display only) |
| `ui/hud.js` | `BG.Hud` | title screen, level select, top bar, palette, sim controls, results, settings |
| `main.js` | `BG.Game` | owns the current level, design and simulation; runs the loop |
| `features/*` | `BG.Goals`, `BG.Daily`, `BG.Famous`, `BG.History`, `BG.PWA`, `BG.Mobile`, ... | badges, weather presentation, daily challenge, famous bridges, run history, PWA shell, touch layer |

## The game state machine

`BG.Game` (in `js/main.js`) moves between five states:

```
boot -> title -> levelSelect -> edit <-> sim -> results
                     ^            |               |
                     +------------+---------------+   (Esc / Back / Next)
```

- **title / levelSelect** run a small demo simulation in the background (a truss with traffic on the title screen).
- **edit** hands input to `BG.Editor`, which owns the design being built. Changes are autosaved (throttled) by level id.
- **sim** creates a fresh `BG.Simulation` from the level and the design and advances it with a fixed-step accumulator.
- **results** is the sim kept alive (collapses keep falling) under the results card. `BG.Storage.recordResult` updates progress and stars; feature modules add badges and history entries.

## One frame

The browser calls `BG.Game._frame` once per animation frame:

```
_frame(ts)
  dt = time since last frame (clamped to 0.1 s)
  state == sim  ->  _updateSim(dt)
                      accumulator += dt * speed (¼× ... 8×, slowed during a derailment freeze-frame)
                      while accumulator >= 1/60:  _stepSim()
                                                    sim.step()               <- the physics, exactly 1/60 s
                                                    sim.drainEvents()        -> _onSimEvent: effects + audio
                      engine / train sounds follow the live vehicles
                      end-of-run detection (keeps simulating a little for the drama, then _finishRun)
  effects.update(dt)
  renderer.render({ mode, level, design, sim, editorState, showStress, peakView, ... })
  hud.update(dt)
```

The simulation never sees the frame rate: it only ever advances in exact 1/60 s steps, so a run at 8× speed, in slow motion, in the browser or in Node gives the same result.

### Simulation events

`sim.step()` pushes events into `sim.events`; the game drains them after every step:

| Event | Consumers |
|---|---|
| `break` | debris and sparks (`BG.Effects`), snap sound, camera shake |
| `creak` | creak sound for members above 80 % stress |
| `splash` | water splash particles and sound |
| `vehicle_fall`, `vehicle_finish`, `vehicle_jump` | sounds, HUD counters |
| `derail` | slow-motion freeze-frame, derail callout (`BG.RailInfo`), crash sound |
| `wind_start`, `quake_start`, ... | Forces of Nature banners and sounds (`forces-fx.js`) |

## The renderer

`BG.Renderer` draws everything on one `<canvas>` in layers, back to front:

1. the painted background image for the theme (`assets/bg/<theme>.jpg`), with a gradient sky fallback;
2. procedural parallax layers (mountains, hills, trees or city silhouettes), clouds, sun or moon, stars;
3. the far valley walls, water with reflections and foam, ships in channels;
4. terrain (strata, grass / snow / sand tops), anchors and piers;
5. beams, styled per material (planks, I-beams with rivets, ropes, decks with lane markings, sleepers and ballast on rail, stone voussoirs for masonry), tinted by stress in sim mode;
6. vehicles and trains from the SVG sprites in `assets/sprites/`, with rotating wheels;
7. effects (debris, smoke, sparks, splashes) and editor overlays (grid, ghost beam, labels, build limits).

Static scenery is cached in offscreen canvases and only redrawn when the camera or theme changes. In follow mode the cache is rendered with a margin and blitted with a translation, so following a train does not repaint the scenery every frame.

## Feature modules: extending without editing

Most features were added after the core was finished, and they are written so they do not edit shared files. A feature module loads after `main.js` and **wraps** the methods it needs to extend:

```js
// goals-ui.js: add badge evaluation to the results screen
const showResults = BG.Hud.showResults;
BG.Hud.showResults = function (res) {
  const out = showResults.apply(this, arguments);
  // ...evaluate goals, reveal badges...
  return out;
};
```

The pattern keeps each feature in one place and makes it easy to see what a feature touches: every module lists the methods it wraps in its header comment. For example, `forces-fx.js` wraps `Renderer.render`, `Hud.enterLevel`, `Hud.update` and `Game._onSimEvent`; `mobile.js` wraps the editor's pointer handling and the HUD layout.

Physics extensions plug in through `BG.SimHooks`, an array of factories that the `BG.Simulation` constructor calls. An extension may implement `beginStep(sim)`, `substep(sim, h, s)` and `endStep(sim)`. Wind and earthquakes (`core/events.js`) work this way. A level without `events` gets no extension at all, so it simulates bit-identically to an engine without the feature; `tools/test-events.js` checks that.

New campaigns register a level-select tab with `BG.Hud.registerCampaign(id, {...})` and declare their unlock rules in `BG.Storage.CAMPAIGNS` (see [LEVEL-AUTHORING.md](LEVEL-AUTHORING.md#adding-a-campaign)).

## Data flow of a level

```
tools/levels/level-NN.json --(node tools/build-levels.js)--> js/core/levels.js  (BG.Levels)
                                                                   |
player builds in BG.Editor --> design {nodes, beams, piers} --> BG.Model.validate / cost
                                                                   |
                                     new BG.Simulation(level, design) --> sim.step() x N --> summary
                                                                   |
                         BG.Storage (progress, design) + BG.History (runs, bests) + badges
```

A **design** is plain data: user joints, beams referencing joint ids (`a0`, `a1` for level anchors, `p0` for pier tops, `n1`... for user joints) and piers. It is what gets saved, exported, verified and shared between the editor, the simulation and the tools.

## Storage

Everything is stored in `localStorage` under the `span.v1.` prefix: settings (including the chosen language, `lang`), progress (stars, completion, best cost per level), the last design per level, badges, run history, daily records and the autosave. Every access is wrapped in try/catch, so the game runs (without saving) when storage is blocked. **Settings → Save data** exports and imports all of it as one JSON file.

## The PWA shell

`sw.js` precaches a versioned list of every shipped file. `tools/gen-precache.js` regenerates that list and a content hash after any change to `index.html`, `css/`, `js/` or `assets/`. The worker serves assets cache-first and `index.html` network-first (falling back to the cache when offline), deletes old caches on activation, and waits for the player to accept an update. `js/features/pwa.js` only registers it over http(s), so `file://` play is unaffected.

## Tooling

`tools/` holds the Node side: the harness, the test suites, the level verifier and builder, the badge prover (`gen-goals.js`), icon and precache generators, a static server and the screenshot generator. None of it is loaded by the game, and the Pages deployment publishes only the game files. See [TESTING.md](TESTING.md).
