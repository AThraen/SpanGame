# Testing

SPAN has no build step, so the tests are the safety net. They run in two places:

- **Node**, against the real simulation core loaded by `tools/harness.js`. Fast, and most of what matters (physics, every level, editor logic, badges, the generator) is checked here.
- **Headless Chrome**, driven by Playwright, against the real game in `index.html`. These check what only a browser can: rendering, input, layouts on phones and tablets, the service worker and offline play.

Nothing ever opens a visible window. Screenshots and logs from the browser suites go to your temp directory (`%TEMP%` / `$TMPDIR`), never into the repository.

## Setup

- **Node 18 or later** (the project is developed on Node 24).
- For the browser suites: `npm install` (installs Playwright, the only dev dependency) and a local **Google Chrome**. The suites launch Chrome through Playwright's `channel: 'chrome'`, so no separate browser download is needed. They all take their launch options from `tools/browser.js`, which renders in software (no GL, software compositing): the game only draws 2D canvases, and frames, screenshots and Playwright's click checks then work even when the machine's GPU cannot bring up GL (a busy or sleeping GPU, a driver update, a remote session), where headless Chrome would otherwise produce no frames at all.

## Running

```sh
npm test               # every Node-only suite (node tools/run-tests.js node)
npm run test:browser   # every headless-Chrome suite
npm run test:all       # both; run this before a pull request
```

`tools/run-tests.js` runs the suites one after another and prints a pass / fail summary with timings. Every suite can also run on its own, and every one exits with code 1 on failure.

## The suites

### Node

| Suite | What it proves |
|---|---|
| `node tools/test-physics.js [filter]` | physics behaviour: model and validation, trusses, arches and suspension bridges carrying their traffic, tension-only members, vehicles and wheel loads, trains, couplers, kink and grade derailment, masonry, stability (no NaN), determinism, exploit guards (finely cut decks, ramps, unconnected roads), stalled traffic, and the performance budget (≥ 4× real time for a 300-member bridge, ≥ 3× with a 24-car ore train) |
| `node tools/verify-levels.js` | every level is solvable: the reference and best designs pass within their stress, cost and ride limits, and are valid, editor-buildable and free of floppy parts. Flags: `--only 1,5,101-120`, `--campaign road\|rail\|famous`, `--ref-only`, `--verbose` |
| `node tools/test-editor.js` | the editor with a fake DOM: building, chaining, snapping, splitting beams, moving and merging joints, erase, select, mirror, piers, undo / redo, templates, keyboard shortcuts |
| `node tools/test-unlock.js` | the campaign unlock rule: skip one level, chapter finales as gates, skipped markers, campaign unlocks, migration of old saves |
| `node tools/test-templates.js` | every template generates a valid design on synthetic and real levels, and none earns ★★★ on any level (`--no-sim` skips the simulation part, `--svg out.html` draws them) |
| `node tools/test-railinfo.js` | the derailment explainer: every derail cause gets a deliberately bad design, and the explanation names it with numbers |
| `node tools/test-anchors.js` | inland anchors, land pylons (guyed pylons stand, unguyed ones topple), the roadway envelope, and the Anchorages levels |
| `node tools/test-goals.js` | every shipped challenge badge still has a saved design that passes the level and earns exactly that badge |
| `node tools/test-events.js [--full]` | wind and earthquake physics; levels without events simulate bit-identically to the engine without the feature (`--full` checks every road and rail design) |
| `node tools/test-generator.js [--quick]` | 365 daily levels and 200 random seeds: well-formed, proven solvable, deterministic, plus difficulty distributions and timing |
| `node tools/test-terrain-fix.js --no-browser` | the waterline build rule and the editor feedback for it |
| `node tools/test-ceiling.js --no-browser` | build ceilings drawn as scenery: exactly the low-cap levels (and generated low-roof crossings) get one, never below the build limit or the tallest traffic, the outline covers the gap, and the field never changes a run |
| `node tools/test-daily.js --node-only` | daily and endless records, streaks, practice runs, the share text |
| `node tools/test-famous.js --node-only` | Famous Bridges data: history cards complete, illustrations exist, stubs stay locked, no template earns ★★★ |
| `node tools/test-history.js --node-only` | run history, personal bests, retention, save export / import, storage failures |
| `node tools/test-i18n.js --node-only` | translations: every key in English and Danish with the same params and plural forms; Danish complete (no placeholders, nothing copied from English, no English words inside a translation); formatting in both languages (with and without `Intl`); the hard-coded string lint, which fails on user-visible English not routed through `t()` (`--verbose` lists every hit). See [I18N.md](I18N.md) |
| `node tools/test-i18n-content.js` | game content in both languages: the English level / history-card dictionaries match `tools/levels/*.json` and Danish has every entry; `level.name`, `level.hint`, `level.history.*`, vehicle / train / material names and template names follow the language; `trafficSummary` in both; every generated daily / endless name is grammatical Danish ("Mandagskløften", "Den blæsende kløft") and survives the daily cache. See [I18N.md](I18N.md) |
| `node tools/test-about.js` | the About screen's generated numbers (`js/features/about-data.js`): present, well-formed, data only (no e-mail addresses), and the level, campaign, language and suite counts still match the game. When it fails, refresh the file with `node tools/gen-about.js` |

### Headless Chrome

| Suite | What it proves |
|---|---|
| `node tools/e2e.js [outDir] [--lang=da]` | the whole game end to end: the title's "umage.ai presents" credit and the About screen (opened from the title and from Settings, its links, Esc, a language switch while it is open; the credit clears the buttons at 1440×900 and 1024×640), level select, a level built with real mouse drags, pass and fail runs, results, inspect, templates, undo / redo, mirror and piers, the Iron Road (tab gating, a derail callout, the follow camera, the finale), campaign tabs and unlocks, Continue, the Anchorages chapter. `--lang=da` plays it all in Danish (the checked texts come from the dictionaries) |
| `node tools/e2e-goals.js [outDir]` | the badges UI: goals panel, results reveal, tile counts, persistence |
| `node tools/e2e-events.js [outDir]` | the Forces of Nature levels: hidden chapter, forecast chip, warning and live banners, timeline, quake rumble, reference designs passing in the real game |
| `node tools/test-terrain-fix.js` | the drawn cliffs match the model's terrain on every level, and the waterline overlay appears where it should |
| `node tools/test-ceiling.js --browser-only` | every level renders with its ceiling (in Danish, no warnings); reference designs run on a sample of levels and a generated crossing, and every drawn roof stays under the drawn ceiling |
| `node tools/test-daily.js` | the daily flow in the browser: generation time, browser level bit-identical to the Node level, playing the daily, the share card and clipboard, endless runs |
| `node tools/test-famous.js` | the Famous Bridges tab, unlock, history card, and a full run of a famous level |
| `node tools/test-history.js` | autosave and resume across a reload on desktop, phones and tablets; the history screen; loading a design |
| `node tools/test-mobile.js [outDir] [--no-shots] [--lang=da]` | phones and tablets in both orientations: no HUD overflow and no text cut off inside its button or heading, 44 px touch targets, a level built with real touch input, the magnifier, the long-press menu, pinch zoom, the About screen (fits, scrolls, 44 px links; opened from the title and from Settings; the title credit and About button clear the chips, buttons and hints), and every feature screen. `--lang=da` runs every device in Danish |
| `node tools/test-pwa.js [outDir]` | the service worker installs and precaches everything, the game reloads offline, the update toast works, the install button and the iOS hint appear where they should |
| `node tools/test-i18n.js --browser-only` | switching the language re-renders the title screen, level select and the open settings panel without a reload; the choice persists; a Danish browser starts in Danish; no missing-key warnings |
| `node tools/test-i18n-ui.js` | the in-level screens in both languages: HUD, palette, Arch tool bar, a passed and a failed results card, the Iron Road derail callout and ride-quality card, canvas labels; switching the language while each is on screen re-renders it in place (Danish numbers, no missing keys); then every screen and modal (title, settings, the About screen, level-select tabs, history modal, famous card, daily panel, goals panel, results with badges) is opened in English and switched to Danish, and no English dictionary text may remain on screen |
| `node tools/test-offline-tour.js [outDir] [--no-shots]` | installs once, goes offline, and tours every screen and campaign on desktop and a phone; fails on any request the service worker does not serve, any console error or any broken image |

## Other tools

| Tool | Use |
|---|---|
| `node tools/gen-about.js [--print]` | regenerates `js/features/about-data.js`, the numbers on the About screen: version (latest git tag, else `package.json`), levels and campaigns, designs the simulator proves, test suites, languages, lines of JavaScript, commits and dates. **Run it before a release (after tagging)** or whenever levels, solutions, suites or languages change, then `node tools/gen-precache.js`; commit the result. With uncommitted changes the commit count and the date include the commit about to be made, so commit the data together with those changes |
| `node tools/gen-precache.js [--check]` | rewrites the service worker's precache list and version. **Run it after changing any shipped file**; `--check` only reports a stale list |
| `node tools/build-levels.js` | compiles `tools/levels/*.json` into `js/core/levels.js` |
| `node tools/gen-goals.js [--only ids]` | generates and proves challenge badges (minutes; runs in parallel worker processes) |
| `node tools/shot.js out.png [script.js] [waitMs]` | one headless screenshot, with an optional script evaluated in the page |
| `node tools/screenshots.js [--only names] [--out dir]` | regenerates `docs/screenshots/` (see below) |
| `node tools/serve.js [port]` | static http server for PWA testing on localhost |
| `node tools/gen-icons.js` | re-renders the app icons |

### The screenshot generator

`tools/screenshots.js` produces every image in the README. Each scene opens the game headlessly with Playwright's fake clock installed, takes over the game's frame loop, loads a saved design from `tools/solutions/` (or a deliberately weakened copy of one, or a template), starts the test and advances the game frame by frame to a chosen moment. Because the simulation is deterministic and the frames are stepped with an exact `dt`, a scene renders the same image on every run.

The collapse animation is captured frame by frame, downscaled and encoded as a GIF by `tools/gif.js`, a small dependency-free encoder (median-cut palette, LZW, and frame differencing so unchanged scenery costs nothing).

```sh
node tools/screenshots.js                       # all scenes
node tools/screenshots.js --only hero,collapse  # some scenes
SPAN_LV=24 SPAN_T=5,8 node tools/screenshots.js --only probe --out <dir>   # look at any level at given times
```

## Writing a test

- Put it in `tools/` as `test-<feature>.js` (Node, or Node + browser) or `e2e-<feature>.js` (browser only), and add it to the lists in `tools/run-tests.js`.
- Follow the existing style: a tiny `ok(name, condition, info)` helper that prints `PASS` / `FAIL` lines, and `process.exit(1)` when anything failed.
- Node tests load the core with `const { BG, runHeadless } = require('./harness')`.
- Browser tests launch `chromium.launch(require('./browser').options())` (headless Chrome, software rendering), open `index.html` through a `file://` URL (or `tools/serve.js` when a service worker is needed), and drive the game through real input where the feature is about input. Use `?level=N&unlockall&noresume` to skip menus.
- Write screenshots under `os.tmpdir()`, never into the repository.
- If a browser test needs a mixed suite to stay runnable without Chrome, add a `--node-only` (or `--no-browser`) flag.

## Continuous deployment

`.github/workflows/pages.yml` runs `node tools/test-physics.js` and `node tools/verify-levels.js` on every push to `main` and on `v*` tags, regenerates the precache list, and only then publishes the game to GitHub Pages. The browser suites need a local Chrome and are run locally before pushing.
