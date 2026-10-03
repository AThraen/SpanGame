// SPAN — inland anchors, land pylons and the roadway clearance envelope (SPEC §17). Node only.
// Usage: node tools/test-anchors.js [--verbose]
//   model: anchor kinds (edge / inland deadman / hillside), hillsides are solid, land pier zones (base on the bank,
//          cost from the bank), roadway envelope (height = tallest vehicle + margin; joints, members and land pylon
//          tops; road / rail decks and members ending at an inland anchor exempt), only the Anchorages levels (54-58)
//          use land features - every other shipped level is untouched;
//   Anchorages (54-58): land features on every level, the best designs stand their pylons, the same designs
//          without their backstays topple, no template earns three stars;
//   physics: a land pylon guyed back with a backstay stays up, without it the stay pull topples it; an unloaded
//          land pylon stands; deterministic; quake moves the footing; floor piers stay fixed;
//   templates: suspension + cable-stayed use land pylons backstayed to inland anchors (valid, pass);
//   editor: ghost / joint feedback "Keep the road clear", pier tool in a land zone.
'use strict';
const path = require('path');
const { BG, runHeadless } = require('./harness');
require(path.join(__dirname, '..', 'js', 'ui', 'editor.js'));

const verbose = process.argv.includes('--verbose');
let pass = 0, fail = 0;
function ok(c, msg, info) {
  if (c) { pass++; if (verbose) console.log('  ok   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
function section(s) { console.log('- ' + s); }
const M = BG.Model;
const types = (r) => r.errors.map((e) => e.type);

// a 40 m crossing with a land pier zone on each bank, a deadman anchor on the left bank top and a
// hillside anchorage on the right bank (7 m above the road)
function landLevel(o) {
  return Object.assign({
    id: 'anchors-test', name: 'Anchor Test', theme: 'meadow',
    terrain: { leftEdge: 0, leftY: 0, rightEdge: 40, rightY: 0, floorY: -10, waterY: -6 },
    anchors: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: -24, y: 0, inland: true }, { x: 60, y: 7, inland: true }, { x: 0, y: -4 }],
    pierZones: [{ x0: -8, x1: -3, ground: 'left' }, { x0: 43, x1: 48, ground: 'right' }, { x0: 18, x1: 22 }], maxPiers: 3,
    noBuild: [], buildArea: { x0: -26, x1: 62, y0: -6, y1: 26 },
    materials: ['road', 'reinforced_road', 'steel', 'cable'], budget: 1e6,
    traffic: [{ type: 'bus', count: 2, interval: 3 }], timeLimit: 30, templates: true,
  }, o || {});
}
// cable-stayed deck: land pylons at x = -5 and 45 (top 14 m), stays to the deck, optional backstays
function stayed(back) {
  const d = { nodes: [], beams: [], piers: [{ x: -5, topY: 14 }, { x: 45, topY: 14 }] };
  const xs = [5, 10, 15, 20, 25, 30, 35];
  xs.forEach((x, i) => d.nodes.push({ id: 'n' + (i + 1), x, y: 0 }));
  const ids = ['a0'].concat(xs.map((x, i) => 'n' + (i + 1)), ['a1']);
  for (let i = 0; i < ids.length - 1; i++) d.beams.push({ a: ids[i], b: ids[i + 1], m: 'reinforced_road' });
  ['n1', 'n2', 'n3', 'n4'].forEach((n) => d.beams.push({ a: 'p0', b: n, m: 'cable' }));
  ['n4', 'n5', 'n6', 'n7'].forEach((n) => d.beams.push({ a: 'p1', b: n, m: 'cable' }));
  if (back) { d.beams.push({ a: 'p0', b: 'a2', m: 'cable' }); d.beams.push({ a: 'p1', b: 'a3', m: 'cable' }); }
  return d;
}

// ====================================================================== model
section('anchor kinds');
{
  const L = landLevel();
  const k = L.anchors.map((a, i) => M.anchorInfo(L, i).kind);
  ok(k.join() === 'edge,edge,inland,hill,edge', 'road anchors and the cliff anchor are edge anchors; deadman = inland; above the bank = hill', k);
  ok(M.anchorInfo(L, 2).bank === 'left' && M.anchorInfo(L, 3).bank === 'right' && M.anchorInfo(L, 3).surfaceY === 0, 'banks + surface of inland anchors');
  ok(M.inlandAnchors(L).map((a) => a.id).join() === 'a2,a3', 'inlandAnchors lists a2, a3');
  const geo = landLevel({ anchors: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: -14, y: 0 }], pierZones: [] });
  ok(M.anchorInfo(geo, 2).kind === 'inland' && !M.hasLandFeatures(geo), 'an unflagged bank-top anchor is drawn as a deadman but does not switch the new rules on');
  ok(M.anchorMounds(L).length === 1 && M.anchorMounds(L)[0].i === 3, 'one hillside (under a3)');
}

section('shipped levels are untouched (only the Anchorages, 54-58, use land features)');
{
  const ANCH = [54, 55, 56, 57, 58];
  const lv = BG.Levels.filter((l) => M.hasLandFeatures(l) || M.roadEnvelope(l) || (l.pierZones || []).some((z) => z.ground) || M.anchorMounds(l).length);
  ok(JSON.stringify(lv.map((l) => l.id)) === JSON.stringify(ANCH), 'land features (envelope, land zones, hillsides) on exactly levels 54-58', lv.map((l) => l.id));
  const fs = require('fs');
  let bad = [];
  for (const l of BG.Levels.filter((q) => ANCH.indexOf(q.id) < 0)) for (const suf of ['', '-best']) {
    const f = path.join(__dirname, 'solutions', 'level-' + String(l.id).padStart(2, '0') + suf + '.json');
    if (!fs.existsSync(f)) continue;
    const d = M.deserialize(fs.readFileSync(f, 'utf8'));
    if (types(M.validate(l, d)).some((t) => t === 'roadway')) bad.push(l.id + suf);
    for (const p of d.piers) if (M.pierBaseY(l, p) !== l.terrain.floorY) bad.push(l.id + suf + ' pier base');
  }
  ok(bad.length === 0, 'no shipped design gets a roadway error; every shipped pier stands on the floor', bad);
}

section('roadway envelope');
{
  const L = landLevel();
  const env = M.roadEnvelope(L);
  ok(env && Math.abs(env.height - 3.7) < 1e-9 && env.vehicle === 3.2, 'height = tallest vehicle (bus 3.2 m) + 0.5 m', env && env.height);
  ok(Math.abs(M.roadEnvelope(landLevel({ traffic: [{ type: 'semi', count: 1 }] })).height - 4.5) < 1e-9, 'semi: 4.0 + 0.5');
  ok(Math.abs(M.roadEnvelope(landLevel({ traffic: [{ type: 'train', train: 'steam_local', count: 1 }] })).height - 4.8) < 1e-9, 'trains: tallest rail car (steam loco 4.3) + 0.5');
  ok(M.roadEnvelope(landLevel({ roadClearance: 6 })).height === 6, 'roadClearance: <m> overrides the height');
  ok(M.roadEnvelope(landLevel({ roadClearance: false })) === null, 'roadClearance: false switches it off');
  ok(M.roadEnvelope(landLevel({ anchors: [{ x: 0, y: 0 }, { x: 40, y: 0 }], pierZones: [], roadClearance: true })) !== null, 'roadClearance: true switches it on without land features');
  ok(M.inRoadway(L, -10, 2) && M.inRoadway(L, 50, 3.6) && !M.inRoadway(L, -10, 3.75) && !M.inRoadway(L, 20, 1) && !M.inRoadway(L, -10, 0), 'inside: over the bank roads below the envelope top; the gap, the road surface and the top edge are legal');

  const base = stayed(true);
  ok(M.validate(L, base).ok, 'the guyed cable-stayed design is valid', types(M.validate(L, base)));
  const d1 = M.clone(base); d1.nodes.push({ id: 'n20', x: -12, y: 2 }); d1.beams.push({ a: 'p0', b: 'n20', m: 'steel' });
  const v1 = M.validate(L, d1);
  ok(v1.errors.some((e) => e.type === 'roadway' && e.nodeId === 'n20' && e.msg === 'Keep the road clear'), 'a joint over the bank road inside the envelope -> roadway "Keep the road clear"', types(v1));
  const d2 = M.clone(base); d2.nodes.push({ id: 'n20', x: -12, y: 4 }); d2.beams.push({ a: 'n20', b: 'a0', m: 'steel' });
  const v2 = M.validate(L, d2);
  ok(v2.errors.some((e) => e.type === 'roadway' && e.beamIndex === d2.beams.length - 1) && !v2.errors.some((e) => e.nodeId === 'n20'), 'a steel member diving through the envelope -> roadway (its joint above it is fine)', types(v2));
  const d3 = M.clone(base); d3.nodes.push({ id: 'n20', x: -6, y: 0 }); d3.beams.push({ a: 'n20', b: 'a0', m: 'road' });
  ok(!types(M.validate(L, d3)).includes('roadway'), 'road deck members on the bank are exempt (the road itself)', types(M.validate(L, d3)));
  ok(!types(M.validate(L, base)).includes('roadway'), 'members ending at an inland anchor are exempt (anchorage stays run beside the road)');
  const d4 = M.clone(base); d4.piers[0].topY = 3;
  ok(M.validate(L, d4).errors.some((e) => e.type === 'roadway' && e.pierIndex === 0), 'a land pylon whose top is inside the envelope -> roadway');
  const d5 = M.clone(base); d5.nodes.push({ id: 'n20', x: -12, y: 2 });
  ok(!types(M.validate(landLevel({ roadClearance: false }), d5)).includes('roadway'), 'no envelope -> no roadway errors');
}

section('land pier zones');
{
  const L = landLevel();
  ok(M.landPierBank(L, -5) === 'left' && M.landPierBank(L, 45) === 'right' && M.landPierBank(L, 20) === null, 'landPierBank');
  ok(M.pierBaseY(L, { x: -5 }) === 0 && M.pierBaseY(L, { x: 20 }) === -10, 'base: bank surface in a land zone, floor in the gap');
  ok(M.pierCost(L, { x: -5, topY: 14 }) === BG.Costs.pierBase + BG.Costs.pierPerMeter * 14 && M.pierCost(L, { x: 20, topY: 0 }) === BG.Costs.pierBase + BG.Costs.pierPerMeter * 10, 'cost measured from the base');
  const d = { nodes: [], beams: [], piers: [{ x: -5, topY: 0.3 }] };
  ok(types(M.validate(L, d)).includes('pier_too_short'), 'a land pylon must rise above its bank', types(M.validate(L, d)));
  const d2 = { nodes: [], beams: [], piers: [{ x: -10, topY: 10 }] };
  ok(types(M.validate(L, d2)).includes('pier_out_of_zone'), 'outside the land zone -> pier_out_of_zone');
  const ext = M.landExtent(L, { piers: [{ x: -5, topY: 14 }] });
  ok(ext.x0 === -24 && ext.x1 > 60 && ext.y1 === 14, 'landExtent covers inland anchors, the hillside and land pylons', ext);
}

section('terrain: hillsides are solid, members end at the anchor face');
{
  const L = landLevel();
  const m = M.anchorMounds(L)[0];
  ok(M.inTerrain(L, 62, 4) && !M.inTerrain(L, 55, 6), 'a point inside the hillside is in the ground; in front of the face is not');
  ok(M.segmentInTerrain(L, 55, 2, 70, 2) && !M.segmentInTerrain(L, 45, 14, 60, 7), 'a member through the hillside hits rock; a backstay to the face does not');
  ok(!M.segmentInTerrain(L, 60, 7, 70, 7, 0.05), 'grazing the hillside plateau is allowed');
  const td = M.terrainDistance(L, 58, 7);
  ok(td > 1.7 && td < 1.8 && M.terrainDistance(L, 60, 7.4) < 0.41, 'terrainDistance includes the hillside (to its front slope)', td);
  ok(m.poly.every((p) => p.x >= 40 - 1e-9), 'the hillside never overhangs the gap');
  const d = stayed(true); d.nodes.push({ id: 'n30', x: 62, y: 4 }); d.beams.push({ a: 'a3', b: 'n30', m: 'steel' });
  const v = M.validate(L, d);
  ok(v.errors.some((e) => e.type === 'in_terrain' && e.nodeId === 'n30'), 'a joint inside the hillside -> in_terrain', types(v));
  const d2 = stayed(true); d2.nodes.push({ id: 'n30', x: -24, y: -3 });
  d2.beams.push({ a: 'a2', b: 'n30', m: 'cable' });
  ok(types(M.validate(L, d2)).includes('in_terrain'), 'a member from a deadman down into the bank -> in_terrain (it ends at the plate)');
  const near = M.clone(stayed(true)); near.nodes.push({ id: 'n30', x: 58, y: 9.25 }); near.beams.push({ a: 'n30', b: 'p1', m: 'steel' });
  ok(!types(M.validate(L, near)).includes('near_terrain'), 'a joint 2 m clear of the hillside is fine');
}

// ====================================================================== physics
section('physics: land pylons');
{
  const L = landLevel();
  const guyed = runHeadless(L, stayed(true), { keepSim: true });
  const gp = guyed.sim.piers;
  ok(guyed.status === 'success' && guyed.pylonsToppled === 0, 'guyed back with backstays: passes, nothing topples', { st: guyed.status, f: guyed.failReason, t: guyed.pylonsToppled });
  ok(gp.every((p) => Math.abs(p.tilt) < 0.01 && Math.hypot(p.topX - p.x, p.topY - 14) < 0.12), 'guyed pylons stay upright (tilt < 0.01 rad, top within 0.12 m)', gp.map((p) => [p.tilt, p.topX, p.topY]));
  const free = runHeadless(L, stayed(false), { keepSim: true });
  for (let i = 0; i < 360; i++) free.sim.step(); // keep watching after the failure: they fall all the way
  const fp = free.sim.piers;
  ok(free.pylonsToppled === 2 && fp.every((p) => p.failed && Math.abs(p.tilt) > 1), 'no backstay: the stay pull overturns both footings and the pylons topple', { t: free.pylonsToppled, tilt: fp.map((p) => p.tilt) });
  ok(free.status === 'failed' && free.firstTopple && free.firstTopple.type === 'pylon_fail', 'the run fails, firstTopple recorded', { st: free.status, ft: free.firstTopple });
  ok(fp.every((p) => p.topY >= p.baseY - 1e-9), 'a toppled pylon comes to rest on the bank, not through it', fp.map((p) => p.topY));
  // toward the gap: the left pylon falls to +x, the right to -x
  ok(fp[0].topX > fp[0].x && fp[1].topX < fp[1].x, 'they fall toward the pull (into the gap)');
  const again = runHeadless(L, stayed(false), { keepSim: true });
  for (let i = 0; i < 360; i++) again.sim.step();
  ok(again.sim.piers[0].topX === fp[0].topX && again.time === free.time && again.peakStress === free.peakStress, 'deterministic');
  // a land pylon carrying nothing stands; its top joint is free (not fixed) in the sim
  const lone = runHeadless(landLevel({ traffic: [{ type: 'car', count: 1 }] }), { nodes: [], beams: [{ a: 'a0', b: 'a1', m: 'road' }], piers: [{ x: -5, topY: 14 }] }, { keepSim: true, maxTime: 8 });
  const ln = lone.sim.nodes[lone.sim.nodeIndex.get('p0')];
  ok(lone.pylonsToppled === 0 && Math.abs(lone.sim.piers[0].tilt) < 1e-3 && ln.fixed === false && ln.pylon === true, 'an unloaded land pylon stands (top is a free joint held by its footing)');
  // floor piers stay fixed points (unchanged engine behaviour)
  const fl = new BG.Simulation(L, { nodes: [], beams: [], piers: [{ x: 20, topY: 0 }] });
  ok(fl.nPyl === 0 && fl.w[fl.nodeIndex.get('p0')] === 0 && fl.piers[0].baseY === -10 && !fl.piers[0].ground, 'a pier in a gap zone is still a fixed point on the floor');
  // quake: the footing rides on the ground
  const q = new BG.Simulation(landLevel({ events: [{ type: 'quake', start: 0.5, duration: 3, magnitude: 7 }] }), stayed(true), { seed: 1 });
  let moved = 0, finite = true;
  for (let i = 0; i < 120; i++) { q.step(); moved = Math.max(moved, Math.abs(q.pyBX[0] - q.pyBX0[0])); finite = finite && isFinite(q.px[q.pyN[0]]); }
  ok(moved > 1e-3 && finite, 'quake: land pylon footings move with the ground', moved);
}

// ====================================================================== the Anchorages bonus chapter
section('Anchorages (54-58): land pylons stand when guyed, topple without their backstays; no template earns three stars');
{
  const fs = require('fs');
  const sol = (id, suf) => M.deserialize(fs.readFileSync(path.join(__dirname, 'solutions', 'level-' + id + suf + '.json'), 'utf8'));
  for (const id of [54, 55, 56, 57, 58]) {
    const L = BG.Levels.find((l) => l.id === id);
    ok(!!L && !L.campaign && M.hasLandFeatures(L) && M.roadEnvelope(L) && (L.pierZones || []).some((z) => z.ground) && M.inlandAnchors(L).length >= 2 && !!L.hint, id + ': a Roads level with land pier zones, inland anchors, the roadway envelope and a hint');
    const d = sol(id, '-best');
    const r = runHeadless(L, d, { keepSim: true });
    const land = r.sim.piers.filter((p) => p.ground);
    ok(r.status === 'success' && land.length >= 1 && r.pylonsToppled === 0 && land.every((p) => Math.abs(p.tilt) < 0.03), id + ': the best design stands its ' + land.length + ' land pylon(s)', { st: r.status, top: r.pylonsToppled, tilt: land.map((p) => p.tilt) });
    // the lesson: the same bridge without the members tied into the inland anchors loses its pylons
    const inland = new Set(M.inlandAnchors(L).map((a) => a.id));
    const cut = M.clone(d); cut.beams = cut.beams.filter((b) => !inland.has(b.a) && !inland.has(b.b));
    const rc = runHeadless(L, cut, { keepSim: true });
    ok(rc.status === 'failed' && rc.pylonsToppled > 0 && rc.firstTopple, id + ': without its backstays a pylon topples and the run fails', { st: rc.status, top: rc.pylonsToppled });
    // no template (offered or not) may reach three stars
    const three = [];
    for (const t of BG.Templates.list) {
      const td = BG.Templates.generate(t.id, L, {});
      if (!td || !td.beams.length || M.cost(L, td).total > 0.7 * L.budget) continue;
      const tr = runHeadless(L, td);
      if (tr.status === 'success' && tr.valid) three.push(t.id + ' ' + Math.round(100 * tr.cost / L.budget) + '%');
    }
    ok(three.length === 0, id + ': no template earns three stars', three);
  }
}

// ====================================================================== templates
section('templates: suspension + cable-stayed use land pylons and inland anchors');
{
  const L = landLevel({ pierZones: [{ x0: -8, x1: -3, ground: 'left' }, { x0: 43, x1: 48, ground: 'right' }], maxPiers: 2 });
  for (const id of ['suspension', 'cable_stayed']) {
    const d = BG.Templates.generate(id, L, {});
    const land = d.piers.filter((p) => M.landPierBank(L, p));
    const back = d.beams.filter((b) => (b.a === 'a2' || b.b === 'a2' || b.a === 'a3' || b.b === 'a3'));
    const v = M.validate(L, d);
    ok(land.length === 2 && back.length === 2 && back.every((b) => /^p\d$/.test(b.a) || /^p\d$/.test(b.b)), id + ': two land pylons, each backstayed to an inland anchor', { piers: d.piers, back });
    ok(v.ok, id + ': valid (incl. the roadway envelope)', types(v));
    const r = runHeadless(L, d, { keepSim: true });
    ok(r.status === 'success' && r.pylonsToppled === 0, id + ': passes with the pylons standing', { st: r.status, f: r.failReason, peak: r.peakStress });
    ok(BG.Templates.available(L).find((t) => t.id === id).ok, id + ': offered');
  }
  // without inland anchors there is nothing to backstay to: no land pylons (they would topple)
  const noAnchor = landLevel({ anchors: [{ x: 0, y: 0 }, { x: 40, y: 0 }], pierZones: [{ x0: -8, x1: -3, ground: 'left' }, { x0: 43, x1: 48, ground: 'right' }], maxPiers: 2 });
  const d = BG.Templates.generate('cable_stayed', noAnchor, {});
  ok(!d.piers.some((p) => M.landPierBank(noAnchor, p)), 'no inland anchor -> no unguyed land pylon from the template');
}

// ====================================================================== editor
section('editor: roadway feedback + pier tool on land');
{
  const L = landLevel();
  const game = {
    level: L, state: 'edit', sounds: [], audio: { play(n) { game.sounds.push(n); } },
    renderer: { camera: { x: 20, y: 5, zoom: 20 } }, hud: { toast(m) { game.lastToast = m; } }, onDesignChanged() {},
  };
  const ed = new BG.Editor(game);
  ok(ed._pointProblem(-10, 2) === 'roadway' && ed._pointProblem(-10, 5) === null, 'joint over the road inside the envelope -> roadway; above it -> fine');
  ed.setMaterial('steel');
  const g = ed._ghost('a0', -6, 2, {});
  ok(g && !g.valid && g.reason === 'roadway', 'ghost into the envelope is red with reason roadway', g && g.reason);
  ok(ed.buildBeam('a0', -6, 2, {}) === null && game.lastToast === 'Keep the road clear', 'placing it is refused with the toast "Keep the road clear"', game.lastToast);
  ed.setMaterial('cable');
  const g2 = ed._ghost('a2', -10, 12, {});
  ok(g2 && g2.valid, 'a cable from the inland anchor up over the road is fine', g2 && g2.reason);
  ed.setMaterial('road');
  const g3 = ed._ghost('a0', -5, 0, {});
  ok(g3 && g3.reason !== 'roadway', 'a road deck on the bank is not blocked by the envelope', g3 && g3.reason);
  // pier tool on a land zone: the pylon stands on the bank and its top clears the envelope
  ed.setTool('pier');
  ed.pointerDown(-5, 1, {}); ed.pointerMove(-5, 1.5, {}); ed.pointerUp(-5, 1.5, {});
  const p = ed.design.piers[0];
  ok(p && p.x === -5 && p.topY >= 3.7 && M.validate(L, ed.design).ok, 'pier tool in a land zone: pylon top clamped above the envelope, valid', p);
  ok(ed._pickPier(-5, 0.5) === 0, 'the land pylon can be picked near its base on the bank');
  ed.pointerDown(-5, p.topY, {}); ed.pointerMove(-5, 12, {}); ed.pointerUp(-5, 12, {});
  ok(ed.design.piers[0].topY === 12, 'drag sets its height', ed.design.piers[0].topY);
}

console.log(`\n${pass}/${pass + fail} anchor checks passed`);
process.exit(fail ? 1 : 0);
