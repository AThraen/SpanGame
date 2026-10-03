#!/usr/bin/env node
// SPAN — Famous Bridges campaign tests.
//   Node part:    level data (ids 201+, campaign, history cards, art files), stub levels gated by
//                 BG.Requirements, every template that the level offers (and every other one) stays
//                 below three stars, reference/best designs exist for playable levels.
//   Browser part: headless Chrome (never a visible window): tab, unlock after road 15, history card
//                 before a level, stubs locked, a reference design passing in the real game, next level
//                 inside the campaign, finale, road campaign unaffected.
// Usage: node tools/test-famous.js [--node-only] [outDir=%TEMP%/span-famous]
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');
const { BG, runHeadless } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const nodeOnly = args.includes('--node-only');
const OUT = args.find(a => !a.startsWith('--')) || path.join(require('os').tmpdir(), 'span-famous');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && info !== undefined ? '  ' + JSON.stringify(info) : '')); };

// ------------------------------------------------------------------ node checks
const famous = BG.Levels.filter(l => l.campaign === 'famous');
const playable = famous.filter(l => BG.Requirements.met(l));
const stubs = famous.filter(l => !BG.Requirements.met(l));
ok('requirements module loaded headless', !!BG.Requirements && typeof BG.Requirements.met === 'function');
ok('famous campaign has >= 8 playable levels', playable.length >= 8, playable.length);
ok('famous ids are 201+ and unique', famous.every(l => l.id >= 201) && new Set(famous.map(l => l.id)).size === famous.length);
ok('road levels unchanged (50 + 3 bonus, no campaign field)', BG.Levels.filter(l => !l.campaign || l.campaign === 'road').filter(l => l.id <= 50).length === 50);
ok('stubs: wind (Tacoma) and rail (Forth) present and gated', ['wind', 'rail'].every(r => stubs.some(l => (l.requires || []).includes(r))), stubs.map(l => [l.id, l.requires]));
// the merged modules are detected (Iron Road: BG.Trains + rail; Forces of Nature: BG.Forces); stubs stay gated by level.stub
ok('requirements: rail and wind modules detected', BG.Requirements.has('rail') && BG.Requirements.has('wind'), { rail: BG.Requirements.has('rail'), wind: BG.Requirements.has('wind'), forces: !!BG.Forces });
ok('stubs are gated by level.stub once their module exists', stubs.every(l => BG.Requirements.isStub(l) || BG.Requirements.missing(l).length), stubs.map(l => l.id));

for (const l of famous) {
  const H = l.history || {};
  const fields = ['year', 'location', 'engineer', 'span', 'type', 'why', 'art'].filter(k => !H[k]);
  ok(`[${l.id} ${l.name}] history card complete`, !fields.length && Array.isArray(H.facts) && H.facts.length >= 2 && H.facts.length <= 3, { missing: fields, facts: H.facts && H.facts.length });
  ok(`[${l.id}] illustration exists`, !!H.art && fs.existsSync(path.join(ROOT, H.art)), H.art);
  if (Array.isArray(l.templates)) ok(`[${l.id}] offered templates are known ids`, l.templates.every(id => BG.Templates.list.some(t => t.id === id)), l.templates);
}

for (const l of playable) {
  const nn = String(l.id);
  ok(`[${l.id}] reference + best solutions exist`, ['', '-best'].every(s => fs.existsSync(path.join(__dirname, 'solutions', 'level-' + nn + s + '.json'))));
  // no template may reach ★★★ (pass at <= 70 % of budget) - check all, not only the offered ones
  const bad = [];
  for (const t of BG.Templates.available(l).filter(t => t.ok)) {
    const d = BG.Templates.generate(t.id, l, {});
    const r = runHeadless(l, d);
    if (r.status === 'success' && r.cost <= 0.7 * l.budget) bad.push(t.id + '@' + (r.cost / l.budget).toFixed(2));
  }
  ok(`[${l.id}] no template earns three stars`, !bad.length, bad);
}
// a module can announce itself; levels needing it then count as playable
{
  const probe = { requires: ['probe_module'] };
  const before = BG.Requirements.met(probe);
  BG.Requirements.provide('probe_module');
  ok('BG.Requirements.provide() unlocks a requirement', !before && BG.Requirements.met(probe));
}

// ------------------------------------------------------------------ browser checks
if (nodeOnly) finish();
else browser().then(finish, e => { ok('browser run', false, e.message); finish(); });

async function browser() {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = require('playwright');
  const b = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  const sol = (id, suf) => JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions', 'level-' + id + (suf || '') + '.json'), 'utf8'));
  const E = (fn, a) => page.evaluate(fn, a);
  const runSim = () => E(() => {
    const g = BG.Game; let t = 0;
    while (g.state === 'sim' && t < 200) { g._updateSim(1 / 6); t += 1 / 6; }
    return { state: g.state, res: g.lastResult && { passed: g.lastResult.passed, stars: g.lastResult.stars, hasNext: g.lastResult.hasNext, finale: g.lastResult.finale } };
  });
  const first = playable[0].id, second = playable[1].id, last = playable[playable.length - 1].id;

  await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href);
  await page.waitForTimeout(1200);
  await E(() => { BG.Storage.resetProgress(); BG.Storage.set('unlockAll', false); BG.Game.goLevelSelect(); });
  await page.waitForTimeout(300);
  ok('level select has a Famous Bridges tab', await E(() => !!document.querySelector('.camp-tab[data-camp=famous]')));
  await page.click('.camp-tab[data-camp=famous]');
  await page.waitForTimeout(500);
  const ls = await E(() => ({ tiles: document.querySelectorAll('.fb-tile').length, open: document.querySelectorAll('.fb-tile.open').length, roadHidden: getComputedStyle(document.querySelector('.chapters')).display === 'none', tabLocked: document.querySelector('.camp-tab[data-camp=famous]').classList.contains('locked') }));
  ok('famous tab lists every famous level, all locked before road 15', ls.tiles === famous.length && ls.open === 0 && ls.roadHidden && ls.tabLocked, ls);
  await page.screenshot({ path: path.join(OUT, 'famous-locked.png') });
  ok('locked famous level does not open', await E(id => { BG.Game.openLevel(id); return BG.Game.state === 'levelSelect' && !BG.Famous.card.open; }, first));

  await E(() => { BG.Storage.recordResult(15, { passed: true, stars: 1, cost: 1 }); BG.Hud.buildLevelSelect(); });
  await page.waitForTimeout(300);
  const un = await E(([a, b2]) => ({ a: BG.Game.isUnlocked(a), b: BG.Game.isUnlocked(b2), open: Array.from(document.querySelectorAll('.fb-tile.open')).map(t => +t.dataset.fbid) }), [first, second]);
  ok('road level 15 opens the first famous bridge only', un.a && !un.b && un.open.length === 1 && un.open[0] === first, un);
  ok('famous levels are their own campaign (not in the Roads list or road stars)', await E(() => BG.Storage.campaignLevels(BG.Levels, 'road').every(l => l.campaign !== 'famous') && BG.Storage.campaignLevels(BG.Levels, 'famous').length === BG.Famous.levels().length && BG.Game.campaignOf(BG.Famous.levels()[0]) === 'famous'));
  ok('road campaign unlocking unchanged', await E(() => BG.Storage.isUnlocked(16, BG.Levels) && !BG.Storage.isUnlocked(18, BG.Levels) && BG.Storage.isUnlocked(1, BG.Levels)));

  // history card, then build
  await page.click('.fb-tile[data-fbid="' + first + '"]');
  await page.waitForTimeout(500);
  const card = await E(() => ({ open: BG.Famous.card.open, state: BG.Game.state, title: (document.querySelector('.fb-card h2') || {}).textContent, facts: document.querySelectorAll('.fb-facts li').length, build: !!document.querySelector('[data-fb=build]') }));
  ok('history card shows before the level', card.open && card.state === 'levelSelect' && card.facts >= 2 && card.build, card);
  await page.screenshot({ path: path.join(OUT, 'famous-card.png') });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const lv = await E(() => ({ state: BG.Game.state, id: BG.Game.level && BG.Game.level.id, card: BG.Famous.card.open, sub: document.querySelector('[data-ref=lvlSub]').textContent, hist: !document.querySelector('[data-fb-history]').hidden }));
  ok('Enter on the card opens the level', lv.state === 'edit' && lv.id === first && !lv.card && /Famous Bridges/.test(lv.sub) && lv.hist, lv);
  const tpl = await E(() => Array.from(document.querySelectorAll('[data-ref=tplMenu] [data-tpl]')).map(b => b.dataset.tpl));
  const want = Array.isArray(BG.Levels.find(l => l.id === first).templates) ? BG.Levels.find(l => l.id === first).templates : null;
  ok('template menu offers only the historical templates', !want || (tpl.length > 0 && tpl.every(id => want.includes(id))), { tpl, want });
  await page.click('[data-fb-history]');
  await page.waitForTimeout(300);
  ok('history button reopens the card (info mode)', await E(() => BG.Famous.card.open && !document.querySelector('[data-fb=build]') && BG.Game.state === 'edit'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Esc closes the card and keeps the level', await E(() => !BG.Famous.card.open && BG.Game.state === 'edit'));

  // reference design passes in the real game; next level stays in the campaign
  await E(d => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(first));
  let r = await runSim();
  ok('reference design passes in the browser', r.res && r.res.passed && r.res.hasNext && !r.res.finale, r);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'famous-results.png') });
  await E(() => BG.Game.nextLevel());
  await page.waitForTimeout(400);
  ok('next level shows the next famous bridge card', await E(id => BG.Famous.card.open && (document.querySelector('.fb-card h2') || {}).textContent === BG.Famous.find(id).name, second));
  await page.keyboard.press('Escape');

  // stubs stay locked even with ?unlockall
  await E(() => BG.Storage.set('unlockAll', true));
  for (const s of stubs) {
    const st = await E(id => { const opened = BG.Game.openLevel(id, { force: true }); const o = { opened, state: BG.Game.state, card: BG.Famous.card.open, build: !!document.querySelector('[data-fb=build]'), locked: (document.querySelector('.fb-locked') || {}).textContent || '' }; BG.Famous.card.close(); return o; }, s.id);
    ok(`stub ${s.id} (${s.requires.join('+')}) cannot be played, card explains why`, !st.opened && st.state !== 'edit' && st.card && !st.build && /module|later update/.test(st.locked), st);
  }
  // finale on the last playable famous level
  await E(id => BG.Game.openLevel(id, { skipCard: true, force: true }), last);
  await page.waitForTimeout(500);
  await E(d => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(last, '-best'));
  r = await runSim();
  ok('last famous bridge: best design earns 3 stars and the campaign finale', r.res && r.res.passed && r.res.stars === 3 && r.res.finale && !r.res.hasNext, r);
  await page.waitForTimeout(1500);
  ok('finale text is the Famous Bridges one', await E(() => /Famous Bridges complete/.test(document.querySelector('[data-ref=resBanner]').textContent)));
  await page.screenshot({ path: path.join(OUT, 'famous-finale.png') });
  await E(() => BG.Game.nextLevel());
  await page.waitForTimeout(500);
  ok('after the finale "next" returns to the Famous Bridges tab', await E(() => BG.Game.state === 'levelSelect' && document.getElementById('screen-levels').classList.contains('fb-mode')));
  // road tab back
  await page.click('.camp-tab[data-camp=road]');
  await page.waitForTimeout(300);
  {
    // (unlockAll is on here, so the hidden bonus chapter 51-53 of the Roads is revealed too)
    const rd = await E(() => ({ tiles: document.querySelectorAll('.tile').length, roads: BG.Levels.filter(l => !l.campaign || l.campaign === 'road').length, tab: BG.Hud.tab, shown: getComputedStyle(document.querySelector('.chapters')).display !== 'none', famous: Array.from(document.querySelectorAll('.tile[data-id]')).filter(t => +t.dataset.id >= 201).length }));
    ok('roads tab shows the road levels again (no famous tiles)', rd.tab === 'road' && rd.tiles === rd.roads && rd.shown && !rd.famous, rd);
  }
  await E(() => { BG.Storage.resetProgress(); BG.Storage.set('unlockAll', false); });
  ok('no console errors', !errors.length, errors);
  await b.close();
}

function finish() {
  console.log('\n' + pass + '/' + (pass + fail) + ' famous checks passed' + (nodeOnly ? ' (node only)' : '') + (fail ? '  —  ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
}
