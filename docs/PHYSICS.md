# Physics

SPAN's simulation (`js/core/physics.js`, `BG.Simulation`) is a 2D **XPBD** solver (extended position-based dynamics) with substepping. It runs the same in the browser and in Node, and it is deterministic: the same level and design produce bit-identical results everywhere. This page explains the model: what is simulated, how members break, how vehicles and trains load the bridge, and how wind and earthquakes push on it. The public API is in [SPEC.md §4.6](../SPEC.md).

## Units and the time step

- Metres, kilograms, seconds and newtons. **y points up**; gravity is 9.81 m/s².
- `sim.step()` advances exactly **1/60 s**, split into **30 substeps** (`h = 1/1800 s`) with one Gauss–Seidel pass each. Many small steps with one iteration each ("small steps" XPBD) converge better than few steps with many iterations, and they keep stiff steel and soft rope in the same scene stable.
- Gravity ramps in smoothly over the first 1.2 s with extra damping, so a design settles under its own weight before traffic arrives instead of dropping onto its supports.
- Light global air damping (0.5 /s) plus axial damping on members keep vibration realistic but finite.

## Determinism

The headless verifier proves levels solvable, so the browser has to reproduce its result exactly:

- no `Math.random` (the sim uses a seeded PRNG), no wall-clock time;
- fixed iteration order; beam sweeps alternate direction each substep to avoid a directional bias, but always in the same pattern;
- vehicle rotations are stored as unit complex numbers, so the state update needs no `sin` / `cos` (whose last bits can differ between JavaScript engines); the wind and quake code uses its own `BG.Forces.sinDet`;
- the frame rate never reaches the sim: the game feeds it whole 1/60 s steps from an accumulator.

## The structure

**Joints** are particles. A joint's mass is half the mass of every member attached to it plus a small 15 kg joint mass. Level anchors and pier tops are fixed (infinite mass), except land pylons (below).

**Members** are distance constraints. A member of length *L* and axial stiffness *EA* gets XPBD compliance *L / EA*, which makes it behave like a real elastic bar regardless of the substep size. The constraint's Lagrange multiplier gives the **axial force** each substep (positive = tension), and

```
stress = force / limit        (limit = tensionLimit or compressionLimit of the material)
```

`|stress| = 1` is the breaking point. That signed ratio is what the stress colours show: white at rest, green around 30 %, yellow around 55 %, orange around 78 %, red at 100 %.

**Tension-only members** (rope and cable) are skipped while they are compressed: they go slack, exactly like a real cable.

**Deck bending.** A road or rail deck is a chain of segments, and a chain of pin-jointed segments would fold. Consecutive deck segments are linked by angle constraints with a bending stiffness, so the deck resists bending at its joints. The bending moment, divided by the material's moment limit, is added to the axial stress ratio. This is why a long unsupported deck fails "bent too far" even when its axial force is small, and why decks need a support about every 5–6 m. Short segments get a proportionally stiffer link, so cutting a deck into many tiny pieces is not a cheap way to make it floppier or cheaper.

**Breaking.** Every member's |stress| goes through an 8 ms low-pass filter, so a single-substep spike does not snap it. When the filtered value passes 1, the member breaks: it becomes two dangling fragments attached to its old joints, which keeps collapses dramatic but numerically stable. The first break is recorded (`sim.firstBreak`) with its mode (*tension*, *compression* or *bending*), and the results screen explains it.

**Peaks.** Each member also keeps the highest |stress| it reached (`peak`). After a run, **Inspect** draws those peaks on the bridge as built.

### Materials

Tuned values from `js/core/materials.js` (the game reads them from there; this table is a snapshot):

| Material | $/m | Max length | Mass kg/m | Tension limit | Compression limit | Notes |
|---|---|---|---|---|---|---|
| Road | 100 | 6 m | 120 | 300 kN | 300 kN | vehicles drive on it; bends at joints |
| Reinforced road | 180 | 6 m | 160 | 720 kN | 720 kN | stiffer, stronger deck |
| Wood | 50 | 6 m | 15 | 130 kN | 110 kN | cheap, light, weak |
| Steel | 120 | 10 m | 45 | 650 kN | 550 kN | the workhorse |
| Rope | 20 | 20 m | 2 | 60 kN | — | tension only |
| Cable | 60 | 40 m | 12 | 1200 kN | — | tension only, very stiff |
| Rail | 160 | 6 m | 240 | 1200 kN | 1200 kN | the only deck trains ride on; stiff in bending |
| Masonry | 35 | 5 m | 700 | 50 kN | 3000 kN | huge in compression, cracks under tension |
| Box girder | 480 | 12 m | 260 | 4000 kN | 3400 kN | heavy steel for the ore trains |

Piers cost $1000 plus $250 per metre of height. Joints are free.

**Masonry** is the interesting one: almost free and immensely strong when squeezed, useless when pulled. It rewards real arches and viaducts that keep every stone in compression, and the renderer shows any masonry under tension glowing red with cracks.

### Terrain and water

Banks are solid: joints collide with the terrain, and the model rejects joints closer than 0.5 m to the ground (only anchors and piers bear on rock). Below the water line, particles feel drag and buoyancy, so debris sinks slowly and splashes on entry.

### Land pylons

On levels with land pier zones, a pier on a bank is a **land pylon**: a concrete column on a footing rather than a fixed point. Its top is a free joint held by a rigid column and an elastic-plastic footing spring that never resists more than its moment limit (300 kN·m by default). Pulled sideways by its stays it leans until its backstays take the load; with nothing to balance the pull it keeps turning, and past about 2.9° the footing tears out and the pylon falls. That is why the Anchorages chapter is about backstays.

## Road vehicles

Each vehicle is a **rigid body** (position, rotation, linear and angular velocity) with wheels. Masses range from a 1.2 t car to a 60 t heavy hauler; each wheel carries its share.

- **Tyres** are compliant contacts: each wheel is a circle tested against nearby deck segments and bank surfaces. A contact pushes the vehicle up and pushes the segment's two end joints down, weighted by where along the segment the wheel sits (barycentric weight) and by inverse mass. That is how a truck's weight actually loads the bridge: there is no separate "load" calculation.
- **Suspension** is modelled through the contact compliance (2.4 Hz natural frequency, damping ratio 0.55).
- **Traction:** a cruise-control motor drives the wheels toward the vehicle's target speed, limited by tyre friction (μ = 0.95). The reaction force goes into the deck too, so a braking truck shoves the bridge.
- **Run outcomes:** a vehicle that drops below the water or the valley floor has *fallen*. A vehicle airborne for more than 0.35 s over the gap was *launched* rather than driven (a ramp is not a bridge). If every driving vehicle stays below 0.3 m/s for 5 s, the run ends as *stalled*.

## Trains

Rolling stock is defined in `js/core/trains.js`: handcars, trams, steam locomotives and tenders, coaches, diesel locomotives, box cars, tank and ore wagons, high-speed power cars and coaches. A **preset** is a list of cars plus a cruise speed:

| Preset | Cars | Mass | Speed |
|---|---|---|---|
| Handcar | 1 | 1 t | 3 m/s |
| Tram | 1 | 20 t | 7 m/s |
| Local steam | 4 | 142 t | 10 m/s |
| Steam express | 7 | 220 t | 14 m/s |
| Commuter | 5 | 168 t | 16 m/s |
| Short / long freight | 6 / 14 | 200 / 464 t | 10 m/s |
| Ore | 24 | 1954 t | 8 m/s |
| High-speed / long | 8 / 14 | 376 / 616 t | 42 m/s |

- Each **car** is a rigid body on **bogies** with one or more axles; each axle carries its share of the car's mass.
- **Flanged wheels:** wheels are held *on* the rail by a bilateral, compliant constraint (3 Hz suspension). A wheel can neither sink into the track nor bounce off it, which is what flanges and gravity do on a real railway. Axle loads go into the rail segment's end joints exactly like road tyres.
- Only `rail` members carry trains (and road vehicles never use rail).
- **Couplers** are XPBD distance constraints with a little free slack between consecutive cars, so a train can bunch and stretch.
- **Locomotives** pull and brake toward the target speed, limited by wheel/rail adhesion (μ = 0.3); every car brakes.

### Derailment

`BG.RailRules` holds the limits (a level may override them with `rail: { maxGrade, maxKinkDeg }`). A car derails when:

| Cause | Rule |
|---|---|
| **Grade** | the rail under a wheel is steeper than `maxGrade` (6 %) for more than 0.3 s |
| **Kink** | the angle between the rail segments under a bogie's first and last axle exceeds the kink limit |
| **Missing rail** | there is no rail (or only a broken one) under a wheel |
| **Lift** | a wheel has to be held down with more than its static load for more than 0.12 s (the bogie is being thrown off a crest) |

The **kink limit** is `maxKinkDeg` (4°) up to 15 m/s, scaled by 15 / v above that: 2° at 30 m/s, 1.4° at 42 m/s. A high-speed train therefore needs far smoother track than a steam train, and on the same track a slower train always gets a wider limit. The kink is judged the way a bogie feels it: averaged over the bogie's whole passage across the joint (a long straddle closes after 1.5 axle spacings of travel or 1 s), so the verdict does not depend on how many 1/60 s steps the bogie happens to spend over the joint.

A derailed car becomes a free rigid body that tumbles (its hull and wheels collide with the deck and the ground), stays coupled to its neighbours, and the rest of the train emergency-brakes. The run fails as *derailed*.

The sim also exposes **read-only readouts** for the UI (`sim.ride`: worst grade, worst kink against its limit, sag; `sim.firstDerail` with the wheel, segment, value, limit and speed). `BG.RailInfo` turns them into the track recording strip, the derail callout and the A–F ride grade. They never feed back into the simulation.

## Wind and earthquakes

`js/core/events.js` (`BG.Forces`) adds weather through `BG.SimHooks`, called at the start of every step and every substep. A level without `events` gets no hook at all and simulates bit-identically to the engine without this module.

### Wind

A level event `{ type: 'wind', start, duration, speed, gust, dir, period?, lift?, rain? }`:

- **Drag** on every member from the *relative* air speed, per axis, using the member's projected length and exposed depth (decks and cables catch more than their drawn width): `F = ½ ρ Cd D |Δ| v|v|`. Because it uses the relative speed, drag also damps sway.
- **Lift** on decks over their chord, `½ ρ V² B |Δx| CL g(x, t)`, where `g` is the gust signal.
- **Gusts** are convected downwind at the wind speed (frozen turbulence), so a gust travels along the deck and excites both symmetric and antisymmetric modes. The signal is smooth seeded turbulence, or a sine with a fixed or swept `period` for resonant wind. The Tacoma Narrows preset sweeps the period across the deck's first antisymmetric mode, which is how a slender suspension deck "gallops" itself apart.
- Wind ramps in and out over 1.5 s; vehicles feel frontal drag (a headwind slows them).

### Earthquakes

A level event `{ type: 'quake', start, duration, magnitude, freq, vertical?, waveSpeed? }`:

- Peak ground acceleration from the magnitude: `0.1 g · 2^(M − 6)` (M6 0.1 g, M7 0.2 g, M8 0.4 g).
- Every fixed joint (anchors and pier tops), the terrain collider and the piers follow a seeded ground displacement made of four incommensurate sines near `freq` (vertical motion at 1.6 × `freq`), with a smooth envelope.
- The ground wave travels across the gap at `waveSpeed` (300 m/s by default), so the far bank moves later than the near one and a stiff span is wrenched as well as shaken.
- The bridge feels the quake through its own inertia, which is why heavy decks shake hardest and light, stiff triangles do best.

## Performance

The solver keeps joint state in flat typed arrays and uses a broadphase for wheel contacts. `tools/test-physics.js` holds it to a budget: a 300-member bridge with six vehicles must simulate at least 4× faster than real time, and a 24-car ore train over a 300-member bridge at least 3×, in Node on one core.

## Where to look in the code

| Topic | Location |
|---|---|
| step and substep loop | `BG.Simulation.step`, `_substep` in `js/core/physics.js` |
| members, bending, breaking | `_buildStructure`, `_buildBendLinks`, `_stress`, `_breakBeam` |
| road vehicles | `_buildVehicles`, `_solveVehicleContacts`, `_tyreVelocity` |
| trains and derailment | `_makeTrain`, `_solveRailContacts`, `_solveCoupler`, `_trainTraction`, `_trainPost`, `_derail` |
| land pylons | `_buildPylons`, `_solvePylons`, `_pylonPost` |
| wind and quakes | `js/core/events.js` |
| tuning notes for level designers | the header of `js/core/trains.js` and `js/core/materials.js` |
| physics tests | `tools/test-physics.js` |
