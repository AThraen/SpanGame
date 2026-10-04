# Danish review: the strings to check

The Danish dictionaries (`js/i18n/da/*.js`) are complete and have had an editing pass for grammar, tone and the glossary at the top of `js/i18n/da/core.js`. These are the strings where a native speaker's ear matters most: puns and witty names, words chosen over an alternative, and sentences built from parts. Change any of them directly in the Danish file (the key is the first column); `node tools/test-i18n.js --node-only` checks that the `{params}` still match.

| Key | English | Dansk | Note |
|---|---|---|---|
| `hud.title.tagline` | Bridge the gap. Mind the budget. *Don't drop the bus.* | Slå bro over kløften. Hold budgettet. *Tab ikke bussen.* | The title screen's first impression. Does "Tab ikke bussen" land as a joke? |
| `levels.2.name` | Three's Company | Trekantsdrama | Pun on the love triangle; the level is about triangles. |
| `levels.5.name` | Penny Pincher | Hver krone tæller | The in-game money is `$`, but the idiom is Danish. OK? |
| `levels.8.name` | Steel Yourself | Stålsat | First steel level. |
| `levels.11.name` | Pier Review | Pillerne på bordet | Pun on "kortene på bordet"; first pier level. |
| `levels.16.name` | Stay Tuned | Hængepartiet | Cable-stay pun turned into "hængeparti" (an unfinished matter). |
| `levels.103.name` | Over the Top | Over gevind | The truss goes over the track; the idiom means "over the top". |
| `levels.116.name` | Smooth Operator | Silkeføre | Ride-quality level. |
| `levels.117.name` | Stay Fast | Stagfast | Invented word: stag + fast, like "bomfast". Too clever? |
| `levels.209.name` | Tacoma Narrows | Tacoma Narrows-broen | Danish adds "-broen", like "Forth-broen"; the history card uses the same name. |
| `levels.53.name` | Galloping Gertie | Galoperende Gertrud | The history card keeps the real nickname: "Galloping Gertie" (Galoperende Gertrud). |
| `features.goals.penny.name` | Penny Pincher | Fedtsyl | Badge name. Friendly enough, or too rude? |
| `features.goals.cool_head.name` | Cool Head | Is i maven | Badge: low peak stress. |
| `features.goals.symmetric.name` | Symmetric | Spejlblank | Badge: a mirror-symmetric bridge (pun on calm water). |
| `features.goals.timber_only.name` | Timber Only | Rent træ | Badge: road and wood only. |
| `hud.sim.stress` | Stress | Belastning | Glossary choice: stress = "belastning", not the engineering term "spænding" (which also reads as "excitement"). |
| `results.stat.peakStress` | Peak stress | Maks. belastning | Same choice; also the stress map ("belastningskortet") and the Cool Head badge. |
| `hud.sim.test` | Test | Test | The big button stays "Test" (noun and verb in Danish). "Afprøv" was the alternative. |
| `hud.title.endless` | Endless | Endeløs | Game mode name. |
| `features.daily.share.head` | SPAN Daily #{no} · {date} | SPAN Dagens bro #{no} · {date} | First line of the shared result. Kept short so it fits one line on a phone; the button itself says "Dagens udfordring". |
| `features.daily.menu` | Daily menu | Dagsoversigt | Results button back to the daily panel ("Dagens menu" read like food). |
| `features.daily.levelK` | DAILY | DAGENS | Small badge above the level name in a daily level. |
| `content.gen.dailyName` | {weekday}'s {noun} | {weekday}s{noun} | Built as a compound: "Mandagskløften", "Onsdagssundet", "Lørdagsåen". |
| `content.gen.noun.gap.adj` | {adj} Gap | Det {adj} skår | Endless names: "Det blæsende skår". "Skår" is unusual for a gap in the land. |
| `content.gen.noun.reach.adj` | {adj} Reach | Det {adj} løb | "Det stille løb". |
| `features.forces.wind.2` | Near gale | Stiv kuling | Wind names follow the Danish Beaufort scale (frisk vind ... orkan), not literal translations. |
| `features.forces.resonant` | Resonant {name} | Pulserende {name} | "Pulserende hård kuling" for the Tacoma-style wind. "{name} i resonans" was the alternative. |
| `features.daily.diff.3` | Tricky | Drilsk | Difficulty ladder: Blid, Let, Jævn, Drilsk, Svær, Benhård, Brutal. |
| `results.title.jumped` | No jumping! | Ingen hop, tak! | A vehicle jumped the gap instead of driving. |
| `results.finale.road.title` | You spanned them all! | Du slog bro over det hele! | Roads campaign finale. |
| `results.finale.rail.title` | End of the line! | Endestation! | Iron Road finale. |
| `results.fail.derailed` | The {what} came off the rails. Trains are far fussier than cars: ... | Toget ({what}) sprang af sporet. Tog er langt mere sarte end biler: ... | `{what}` is a train name; Danish puts it in brackets to avoid gender agreement. |
| `results.fail.fell.vehicleWater` | A {what} fell into the water. | En {what} røg i vandet. | `{what}` is always a common-gender road vehicle (bil, bus, lastbil ...). |
| `results.rail.gradeC` | bumpy | humpet | Ride grades: silkeblødt, jævnt, humpet, hård tur. |
| `results.banner.overBudget` | Over budget | Over budgettet | Definite form everywhere (banner, history filter, failure text). |
| `hud.settings.offsetCursor` | Offset cursor (aim above finger) | Forskudt markør (sigt over fingeren) | Touch setting. |
| `editor.arch.bar.braceTip` | ... a pin-jointed arch with only posts sways | ... en charnierbue med kun stolper svajer | Technical: is "charnierbue" understandable to players? |
| `levels.106.hint` | ... Spring an arch from the low ledges, stand stone posts on it, and brace the spandrels. | ... Spænd en bue fra de lave afsatser, stil stenstolper på den, og afstiv sviklerne. | "Svikler" and "vederlag" (springings, in 107 and 110) are the right terms, but rare words. |
| `famous.205.type` | Cantilever railway bridge | Jernbanebro med udkragede konsoller (cantilever) | Danish has no single everyday word for a cantilever bridge. |
| `famous.207.why` | Nicknamed "The Coathanger", ... | Med kælenavnet "The Coathanger" (bøjlen) ... | Keeps the real nickname, explained. |
