# Contributing to SPAN

Thanks for your interest in SPAN! Bug reports, level ideas, new levels, fixes and polish are all welcome. This page explains how the project works and what a pull request needs.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** with the [bug report template](https://github.com/umage-ai/SpanGame/issues/new?template=bug_report.yml). Include the level, your browser and device, and if you can, your design: in the browser console run `copy(BG.Model.serialize(BG.Game.getDesign()))` and paste the result.
- **Suggest a level** with the [level idea template](https://github.com/umage-ai/SpanGame/issues/new?template=level_idea.yml). A sketch of the gap and the idea it teaches is enough.
- **Build a level** and send it as a pull request (see below).
- **Fix or improve** something from the [issue tracker](https://github.com/umage-ai/SpanGame/issues).

For a large change (a new campaign, a new mechanic, an engine change) please open an issue first, so we can agree on the approach before you invest the time.

## The no-build philosophy

SPAN is deliberately plain:

- **No build step.** The files in the repository are the files that run. No bundler, transpiler, minifier or framework.
- **Classic scripts only.** No ES modules and no `import`: the game must run when `index.html` is opened straight from `file://`. Each file attaches what it defines to the global `BG` object, and `index.html` loads the files in dependency order.
- **No runtime dependencies.** Nothing from npm or a CDN is loaded by the game. The only dev dependency is Playwright, for the headless browser tests.
- **Everything ships.** Sprites are hand-written SVG, audio is synthesized at runtime, and the only raster assets are the painted backgrounds and the app icons.
- **Works offline and without storage.** Every `localStorage` access is wrapped in try/catch, and the PWA shell must cache every shipped file.

If a change would need a build tool or a library, it is probably the wrong change for this project; open an issue to talk it through.

## Every level must prove it is solvable

No level ships on faith. A level is a JSON file in `tools/levels/` **plus two saved designs** in `tools/solutions/`:

- `level-NN.json`, a reference design that passes with peak stress ≤ 92 % and within budget;
- `level-NN-best.json`, a cheap design that passes at ≤ 70 % of the budget, proving three stars are reachable.

`node tools/verify-levels.js` re-simulates both, checks they are valid and buildable in the editor, and fails if either does not pass. No built-in template may earn three stars. Every challenge badge needs its own proving design too. The full procedure is in [docs/LEVEL-AUTHORING.md](docs/LEVEL-AUTHORING.md).

Engine changes are held to the same standard: **a physics change must keep every existing level's designs passing.** If a change breaks a level, fix the change, not the level (unless the level was relying on a bug).

## Development setup

```sh
git clone https://github.com/umage-ai/SpanGame.git
cd SpanGame
npm install            # Playwright, for the headless browser tests
```

Open `index.html` in a browser and edit away; reload to see changes. `node tools/serve.js` serves the game on `http://localhost:8080/` when you need the service worker. Useful URL parameters: `?level=N`, `?unlockall`, `?noresume`, `?touchui=1`.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first, then [SPEC.md](SPEC.md) for the data contracts of the module you are touching.

## Before you open a pull request

1. **Run the tests.** All suites must be green:
   ```sh
   npm run test:all
   ```
   That is `npm test` (Node suites) plus `npm run test:browser` (headless Chrome; needs a local Chrome). See [docs/TESTING.md](docs/TESTING.md) for what each suite covers. Nothing may open a visible window.
2. **Regenerate generated files** you affected:
   - changed a level JSON → `node tools/build-levels.js`
   - changed or added levels or anything badges depend on → `node tools/gen-goals.js --only <ids>` and `node tools/test-goals.js`
   - changed **any shipped file** (`index.html`, `css/`, `js/`, `assets/`, the manifest) → `node tools/gen-precache.js`
3. **Add or update tests** for behaviour you changed. Browser tests go through real input where the feature is about input.
4. **Check it on a phone layout** if you touched the UI: `?touchui=1` in a narrow window, or `node tools/test-mobile.js`.
5. **Update the docs** (README, SPEC.md, docs/) when behaviour or contracts change.
6. **Refresh the screenshots** if the change is visible in them: `node tools/screenshots.js`.

Keep pull requests focused: one feature or fix each.

## Code style

There is no linter configuration; match the code around you.

- Modern JavaScript (ES2020) in classic scripts. Core files use the wrapper:
  ```js
  (function (root) {
    'use strict';
    const BG = (root.BG = root.BG || {});
    // ...
  })(typeof window !== 'undefined' ? window : globalThis);
  ```
- 2-space indentation, single quotes, semicolons, `const` / `let` (no `var`).
- **`js/core/` is pure:** no DOM, no canvas, no `window`-only APIs, no `Math.random`, no `Date.now()`. It must run in Node via `tools/harness.js` and stay deterministic. Use the seeded PRNG and keep iteration orders fixed.
- **Extend, don't edit, from feature modules.** A new feature goes in `js/features/` and wraps the methods it needs (see the existing modules for the pattern), so it stays in one place. List what it wraps in the file's header comment.
- **Fail soft in the UI.** Wrap optional calls (audio, storage, feature hooks) so a failure in one feature never breaks the game.
- Every file starts with a short header comment saying what it is and what it touches.
- Comments explain *why*; units go in names or comments (metres, kg, N, seconds).
- Keep the visual language: glass panels, the system font stack, SVG icons in `assets/icons/`, colours from the CSS custom properties in `css/style.css`. `css/mobile.css` stays the last stylesheet.

## Commit messages

Short imperative subject line ("Add level 59: Cantilever Cove"), then a body explaining what and why when it is not obvious.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
