# Level authoring

Every level in SPAN is a small JSON file plus two saved bridge designs that prove it can be solved. This page covers the level format, the solution files, how budgets are set, the verify pipeline, challenge badges, and how to add a whole campaign.

The one rule that matters most: **a level is not finished until `node tools/verify-levels.js` proves it.** No level ships on the hope that it is solvable.

## The workflow

1. Write `tools/levels/level-NN.json`.
2. Run `node tools/build-levels.js`. It compiles every level file into `js/core/levels.js` (`BG.Levels`). Never edit `levels.js` by hand.
3. Open `index.html?level=NN&unlockall`, build a solid bridge, and copy it from the browser console:
   ```js
   copy(BG.Model.serialize(BG.Game.getDesign()))
   ```
   Save it as `tools/solutions/level-NN.json` (the **reference** design).
4. Build a cheap bridge that still passes and save it as `tools/solutions/level-NN-best.json` (the **best** design).
5. Run `node tools/verify-levels.js --only NN` and adjust the budget (or the designs) until both pass.
6. Generate and prove the challenge badges: `node tools/gen-goals.js --only NN`, then `node tools/test-goals.js`.
7. Run `node tools/test-templates.js` to make sure no template earns three stars, then `node tools/gen-precache.js` (levels.js is a shipped file) and the rest of the suites ([TESTING.md](TESTING.md)).

Ids: Roads use 1–58 (`level-01.json` … with two-digit padding below 100), the Iron Road 101–120, Famous Bridges 201–212. Pick a free range for a new campaign.

## Level JSON reference

A complete road level (level 24, *Coral Gate*):

```json
{
  "id": 24,
  "name": "Coral Gate",
  "theme": "tropical",
  "hint": "Tall masts sail through here and there is no room for piers. Spring an arch from the cliff bolts, high over the road, and hang the deck from it.",
  "terrain": { "leftEdge": 0, "leftY": 0, "rightEdge": 54, "rightY": 0, "floorY": -12, "waterY": -6 },
  "anchors": [ { "x": 0, "y": 0 }, { "x": 54, "y": 0 }, { "x": 0, "y": -3 }, { "x": 54, "y": -3 } ],
  "pierZones": [],
  "maxPiers": 0,
  "noBuild": [ { "x0": 4, "x1": 50, "y0": -6, "y1": -1 } ],
  "buildArea": { "x0": 0, "x1": 54, "y0": -6, "y1": 15 },
  "materials": [ "road", "reinforced_road", "wood", "steel", "rope", "cable" ],
  "budget": 35000,
  "traffic": [ { "type": "bus", "count": 2, "interval": 3.5 }, { "type": "truck", "count": 2, "interval": 5 } ],
  "timeLimit": 40,
  "templates": true
}
```

Coordinates are metres, with **y up**. The left bank's road surface usually sits at `x = 0, y = 0`.

### Required fields

| Field | Type | Meaning |
|---|---|---|
| `id` | number | unique level id; also the file name |
| `name` | string | shown on the tile and the top bar |
| `theme` | string | scenery: `meadow`, `autumn`, `desert`, `canyon`, `snow`, `night`, `city`, `tropical`, `volcanic` |
| `hint` | string | the level hint (key `H`); write it as a nudge, not a solution |
| `terrain` | object | `leftEdge` / `rightEdge`: x where the left bank ends and the right bank starts; `leftY` / `rightY`: bank heights; `floorY`: the valley floor; `waterY`: water level, or `null` for a dry gap (the volcanic theme draws lava) |
| `anchors` | array | fixed bolts `{x, y}`. **The first two must be the road ends** (left, then right); the rest are extra bolts on the cliff faces. Referenced in designs as `a0`, `a1`, … |
| `pierZones` | array | `{x0, x1}` ranges on the valley floor where piers may stand (`[]` = none) |
| `maxPiers` | number | how many piers may be built |
| `noBuild` | array | `{x0, x1, y0, y1}` rectangles no joint or member may enter. A no-build zone over water is drawn as a shipping channel with a ship |
| `buildArea` | object | `{x0, x1, y0, y1}`: every joint must lie inside |
| `materials` | array | allowed material ids, in palette order: `road`, `reinforced_road`, `wood`, `steel`, `rope`, `cable`, `rail`, `masonry`, `girder` |
| `budget` | number | dollars; see [Budget rules](#budget-rules) |
| `traffic` | array | groups in spawn order: `{type, count, interval}` with `type` one of `car`, `van`, `bus`, `truck`, `semi`, `tanker`, `heavy`; or `{type: "train", train: "<preset>", count, interval}` |
| `timeLimit` | number | seconds of simulated time for all traffic to cross |
| `templates` | boolean or array | whether the template menu is offered; an array of template ids offers only those |

### Optional fields

| Field | Meaning |
|---|---|
| `campaign` | `"rail"` (Iron Road) or `"famous"` (Famous Bridges); absent means Roads |
| `rail` | `{maxGrade, maxKinkDeg}` overrides the derailment limits (defaults 0.06 and 4°) |
| `events` | wind and earthquake events, see below |
| `anchors[].inland` | `true` marks an inland anchor: a deadman block in a bank top, or (with `y` above the bank) an anchor block set into a hillside |
| `pierZones[].ground` | `"left"` or `"right"`: a land pier zone on that bank, where piers become land pylons (optional `footing`: the footing's moment limit in N·m) |
| `roadClearance` | the roadway clearance envelope on the banks switches on by itself when a level has inland anchors or land pier zones; a number sets its height in metres, `false` turns it off |
| `history` | Famous Bridges: the history card (`name`, `art`, `year`, `built`, `location`, `crosses`, `engineer`, `span`, `type`, `facts` (2–3), `why`, optional `note`) |
| `requires` | modules the level needs: `"wind"`, `"rail"`, `"masonry"`. Until they are loaded the level stays locked |
| `stub` | `true` while a level has no verified designs: it shows its history card but can't be played, and the verifiers skip it |

### Traffic

Vehicles spawn on the left bank 25 m before the gap, drive right and finish when their rear passes `rightEdge + 15`. Groups spawn in order, `interval` seconds apart. Masses run from a 1.2 t car to a 60 t heavy hauler (`js/core/vehicles.js`).

Train presets (`js/core/trains.js`): `handcar`, `tram`, `steam_local`, `steam_express`, `commuter`, `freight_short`, `freight_long`, `ore`, `highspeed`, `highspeed_long`. Trains need a `rail` deck; road vehicles need `road` or `reinforced_road`. On double-deck levels you can mix both; list the fast train first. The header of `js/core/trains.js` has measured engine facts for level designers: loads per metre, axle loads, how long each train takes to clear a gap, and which kinks each speed tolerates.

### Weather events

```json
"events": [
  { "type": "wind", "start": 5, "duration": 26, "speed": 34, "gust": 0.45, "dir": -1, "rain": true },
  { "type": "quake", "start": 8, "duration": 12, "magnitude": 8, "freq": 1.6 }
]
```

Wind takes `speed` (m/s), `gust` (0–1.5), `dir` (+1 blows toward +x), and optionally `period` (seconds per gust, or `[from, to]` for a swept rhythm), `lift` and `rain`. A quake takes `magnitude` (or `pga` in g), `freq` (Hz), and optionally `vertical` and `waveSpeed`. `{ "preset": "tacoma" }` (also `gale`, `storm`, `quake`) expands a ready-made event. See [PHYSICS.md](PHYSICS.md#wind-and-earthquakes) and SPEC.md §12.

## Solution designs

A design is the same structure the editor saves:

```json
{
  "nodes": [ { "id": "n1", "x": 6, "y": 0 }, { "id": "n2", "x": 11.75, "y": 0 } ],
  "beams": [ { "a": "a0", "b": "n1", "m": "road" }, { "a": "n1", "b": "p0", "m": "cable" } ],
  "piers": [ { "x": 19, "topY": 6 } ]
}
```

`a<i>` are the level's anchors, `p<i>` the tops of the design's piers, `n<i>` user joints.

Every campaign level has two:

| File | Must | Why |
|---|---|---|
| `tools/solutions/level-NN.json` (reference) | pass with peak stress ≤ 0.92 and cost ≤ budget | proves the level is solvable with margin, not on a knife edge |
| `tools/solutions/level-NN-best.json` (best) | pass with peak stress ≤ 0.99 and cost ≤ 70 % of the budget | proves ★★★ is reachable |

Both must also be:

- **valid** (`BG.Model.validate`: lengths, build area, no-build zones, materials, terrain clearance, waterline, roadway envelope);
- **buildable in the editor:** every joint on the 0.25 m grid and no two joints closer than 0.6 m (the joint magnet would merge them);
- **free of floppy parts:** no joint may drift more than 1 m while nothing has broken (a mechanism that happens to survive is not a bridge).

Railway levels add a ride margin: the reference design's worst kink stays at or below 95 % of its limit and the best design's at or below 100 %, both with no grade over the limit, and the best design must pass with **no broken member** (three stars on the Iron Road need *Structure held*).

## Budget rules

Budgets are set from the designs, not guessed:

- the reference design should cost at most about **88 %** of the budget, so ★ is comfortable;
- the best design must cost at most **70 %** (at most 68 % on the Roads finale chapter, 41–50, and about 67 % on 116–120) so there is room for a hand-built bridge to earn ★★★ too;
- **no built-in template may earn ★★★** on any level (`tools/test-templates.js` checks every level; on levels where a template breaks the rules, for example an arch through a ship channel, the template is hidden). Templates are switched off on levels 1–3.

## The verify pipeline

```sh
node tools/verify-levels.js                     # every level, reference + best
node tools/verify-levels.js --only 24           # one level
node tools/verify-levels.js --only 101-120      # a range (also 1..50, or lists: 3,4,101)
node tools/verify-levels.js --campaign rail     # road | rail | famous
node tools/verify-levels.js --ref-only --verbose
```

It loads the real simulation through `tools/harness.js`, runs each design to completion with the level's events on and seed 1 (as in the game), and checks every rule above. The exit code is 1 on any failure. The GitHub Pages workflow runs it before every deployment.

Related checks:

| Tool | Checks |
|---|---|
| `tools/test-templates.js` | templates generate valid designs on every level; none reaches ★★★ |
| `tools/test-goals.js` | every shipped badge still has a design that earns it |
| `tools/test-events.js` | weather levels; levels without events simulate bit-identically to the engine without them |
| `tools/test-anchors.js` | inland anchors, land pylons and the roadway envelope |
| `tools/test-famous.js` | Famous Bridges data: history cards complete, art files exist, stubs stay locked |

## Challenge badges

Badges are optional goals beyond stars (SPEC.md §11). `node tools/gen-goals.js --only NN` builds a pool of passing candidate designs for the level (from the solutions, templates, material swaps, mirror rebuilds and greedy member pruning), then offers a goal only when a candidate meets it, with a little slack on the threshold. Each offered goal gets a proving design in `tools/solutions/goals/level-NN-<goal>.json`, and the goal list is merged into `js/features/goals-data.js` (generated; do not edit by hand). `tools/test-goals.js` re-verifies all of them.

| Goal | Met when |
|---|---|
| Minimalist | at most N members |
| Penny Pincher | cost at most a share of the budget |
| Featherweight | total structure mass at most N kg |
| Cool Head | peak stress at most N |
| Symmetric | every member and pier has a mirror twin about the middle of the gap |
| No Steel / Timber Only / No Piers | as named |
| Smooth Ride | railway levels: the worst kink stays at or below a share of its limit |

Levels 1–5 get two goals, later levels two or three.

## Writing a good level

- **Teach one idea.** Each level in the Roads introduces or combines something: a pier, a rope, a ship channel, a heavier truck. The chapter tables in [GAMEPLAY.md](GAMEPLAY.md#levels) show the progression; slot new levels where their idea fits.
- **Make the right answer natural.** The terrain, anchors, no-build zones and materials should point toward a structure type without forcing one design. Famous Bridges levels are set up so the historical type is the natural answer.
- **Hints nudge.** A hint names the principle ("each arch pushes outward at its feet"), not the coordinates.
- **Check it in the browser.** Look at the level at phone size too (`?touchui=1` and a narrow window): the build area must not hide under the HUD.
- **Use the real tools.** `tools/screenshots.js` has a `probe` scene for a quick look at any level and design headlessly: `SPAN_LV=24 SPAN_T=5,8 node tools/screenshots.js --only probe --out <dir>`.

## Adding a campaign

A campaign is a range of level ids with its own tab on the level select, its own unlock rules and its own finale. Famous Bridges (`js/features/famous.js`) is the worked example.

1. **Rules:** add an entry to `BG.Storage.CAMPAIGNS` in `js/ui/storage.js` and its id to `CAMPAIGN_ORDER`:
   ```js
   bridges2: { id: 'bridges2', name: 'My Campaign', first: 301, last: 320, unlockAfter: 20,
               gates: [305, 310, 315, 320], gateWord: 'chapter finale' },
   ```
   `unlockAfter` is the road level that opens it; `gates` are the chapter finales that can't be skipped (the campaign's `last` is always one). Inside a campaign a level opens when either of the two playable levels before it is complete.
2. **Levels:** write `tools/levels/level-301.json` … with `"campaign": "bridges2"`, plus reference and best solutions, as above.
3. **Look:** register the tab, either with chapters like the Roads and the Iron Road (`CHAPTERS` / `RAIL_CHAPTERS` in `js/ui/hud.js`), or from a feature module:
   ```js
   BG.Hud.registerCampaign('bridges2', {
     name: 'My Campaign', sub: 'Twenty new crossings', icon: () => '<svg>...</svg>',
     levelK: 'LEVEL', allLabel: 'All crossings',
     finale: { banner: 'Campaign complete', title: 'Well built!', text: starLine => starLine },
   });
   ```
   A custom tile panel (as Famous Bridges uses) is `panelClass` + `render(panel, info)`.
4. **Verify:** `node tools/verify-levels.js --only 301-320`, `node tools/gen-goals.js --only 301,...`, then extend `tools/test-unlock.js` and `tools/e2e.js` for the new tab and its gates.
5. **Ship:** `node tools/build-levels.js`, `node tools/gen-precache.js`, and the full test run.
