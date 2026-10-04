#!/usr/bin/env node
// ceiling tests: build ceilings drawn as scenery (js/features/ceiling.js).
//   Node part:    which levels get a ceiling (every campaign level with a low cap, generated "low roof" crossings,
//                 never Famous Bridges), its height (never below buildArea.y1, always above the tallest traffic),
//                 the drawn outline covers the gap and never dips below the ceiling, and the field is cosmetic
//                 (the simulation of a level is identical with and without it).
//   Browser part: (headless Chromium via playwright, never a visible window) every level renders in edit mode without
//                 errors; on a sample of levels and a generated crossing the reference design is run and every
//                 drawn vehicle roof stays under the drawn ceiling; the label is translated.
// Usage: node tools/test-ceiling.js [--no-browser | --browser-only]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { BG, runHeadless } = require('./harness');
const load = (rel) => require(path.join(ROOT, rel));
load('js/core/generator.js');
load('js/render/effects.js');
load('js/render/renderer.js'); // BG.Renderer.drawnHeight: the sprite heights the ceiling has to clear
load('js/features/ceiling.js');
const Ceil = BG.Ceiling;

let pass = 0, fail = 0;
const ok = (c, msg, info) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + msg + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } };
const section = (s) => console.log('- ' + s);
const args = process.argv.slice(2);
const NODE = args.indexOf('--browser-only') < 0, BROWSER = args.indexOf('--no-browser') < 0;

// the campaign levels whose cap leaves no room over the traffic (they all name the kind in terrain.ceiling)
const EXPECTED = [1, 2, 4, 8, 9, 11, 17, 27, 32, 101, 102, 104, 106, 107, 108, 109, 110, 111, 112, 114];
const deckTop = L => Math.max(L.terrain.leftY, L.terrain.rightY);
const headroom = L => L.buildArea.y1 - (L.terrain.leftY + L.terrain.rightY) / 2;

function tallestDrawn(L) {
  let h = 0;
  for (const g of L.traffic || []) {
    if (g.type === 'train') for (const c of BG.Trains[g.train].cars) h = Math.max(h, BG.Renderer.drawnHeight(c));
    else h = Math.max(h, BG.Renderer.drawnHeight(g.type));
  }
  return h;
}
function checkShape(L, C, tag) {
  const P = Ceil.profile(C);
  ok(P.x0 <= C.le - 3 && P.x1 >= C.re + 3, tag + ': outline spans the gap and beyond', [P.x0, P.x1, C.le, C.re]);
  let low = Infinity, inv = 0;
  for (const q of P.pts) { if (q.x >= C.le - 6 && q.x <= C.re + 6) low = Math.min(low, q.u); if (q.t < q.u - 1e-9) inv++; }
  ok(low >= C.y - 1e-9, tag + ': underside never dips below the ceiling over the gap', [low, C.y]);
  ok(inv === 0, tag + ': top above underside everywhere', inv);
  for (let x = C.le; x <= C.re; x += 0.5) { const u = Ceil.underAt(P, x); if (!(u >= C.y - 1e-9)) { ok(false, tag + ': underAt covers the gap', x); return; } }
  pass++;
}

if (NODE) {
  section('which levels get a ceiling');
  {
    const got = BG.Levels.filter(L => Ceil.forLevel(L)).map(L => L.id);
    ok(JSON.stringify(got) === JSON.stringify(EXPECTED), 'ceilings on exactly the low-cap campaign levels', got);
    const low = BG.Levels.filter(L => L.campaign !== 'famous' && headroom(L) <= Ceil.MAX_HEADROOM).map(L => L.id);
    ok(JSON.stringify(low) === JSON.stringify(EXPECTED), 'auto rule (cap within ' + Ceil.MAX_HEADROOM + ' m of the deck) finds the same levels', low);
    const unnamed = EXPECTED.filter(id => { const L = BG.Levels.find(l => l.id === id); return !(L.terrain.ceiling && Ceil.KINDS.indexOf(L.terrain.ceiling.kind) >= 0); });
    ok(unnamed.length === 0, 'each of them names its kind in terrain.ceiling', unnamed);
    const famous = BG.Levels.filter(L => L.campaign === 'famous' && Ceil.forLevel(L)).map(L => L.id);
    ok(famous.length === 0, 'no ceiling on Famous Bridges (their caps stand for the historical form)', famous);
    for (const id of [17, 27]) ok(!!Ceil.forLevel(BG.Levels.find(L => L.id === id)), 'level ' + id + ' (its hint names the overhang) gets one');
    ok(Ceil.forLevel(BG.Levels.find(L => L.id === 27)).kind === 'ice', 'level 27 is a glacier');
    ok(Ceil.forLevel(BG.Levels.find(L => L.id === 17)).kind === 'rock', 'level 17 is a rock ledge');
    const kinds = {};
    EXPECTED.forEach(id => { kinds[Ceil.forLevel(BG.Levels.find(L => L.id === id)).kind] = 1; });
    ok(Ceil.KINDS.every(k => kinds[k]), 'every kind is used somewhere', Object.keys(kinds));
  }

  section('height: never below the build limit, always above the traffic');
  for (const L of BG.Levels) {
    const C = Ceil.forLevel(L);
    if (!C) continue;
    const tag = 'level ' + L.id;
    ok(C.y >= L.buildArea.y1 - 1e-9, tag + ': drawn at or above buildArea.y1', [C.y, L.buildArea.y1]);
    const need = deckTop(L) + tallestDrawn(L) + Ceil.MARGIN;
    ok(C.y >= need - 1e-9, tag + ': tallest drawn vehicle + margin fits under it', [C.y, +need.toFixed(2)]);
    ok(C.raised === (C.y > L.buildArea.y1 + 1e-6), tag + ': raised flag', C);
    ok(Ceil.KINDS.indexOf(C.kind) >= 0, tag + ': known kind', C.kind);
    checkShape(L, C, tag);
  }
  {
    const L102 = BG.Levels.find(L => L.id === 102), C = Ceil.forLevel(L102);
    ok(C.y >= deckTop(L102) + 3.95 + 0.45 - 1e-9, 'level 102: clears the tram\'s overhead wire too', C.y);
    const L17 = BG.Levels.find(L => L.id === 17);
    ok(Ceil.forLevel(L17).y === L17.buildArea.y1 && !Ceil.forLevel(L17).raised, 'level 17: the ledge sits exactly on the 4 m cap (buses fit)', Ceil.forLevel(L17));
  }

  section('the level field');
  {
    const L = JSON.parse(JSON.stringify(BG.Levels.find(l => l.id === 17)));
    L.terrain.ceiling = false;
    ok(Ceil.forLevel(L) === null, 'ceiling: false switches it off');
    L.terrain.ceiling = { kind: 'girder', y: 7, from: 'left' };
    const C = Ceil.forLevel(L);
    ok(C && C.kind === 'girder' && C.y === 7 && C.from === 'left', 'kind / y / from are honoured', C);
    L.terrain.ceiling = { kind: 'cave', y: 1 };
    ok(Ceil.forLevel(L).y === L.buildArea.y1, 'y below the build limit is lifted to it', Ceil.forLevel(L).y);
    L.terrain.ceiling = { kind: 'bogus' };
    ok(Ceil.forLevel(L).kind === 'rock', 'unknown kind falls back to the theme default (desert: rock)');
    const hi = JSON.parse(JSON.stringify(BG.Levels.find(l => l.id === 3)));
    ok(Ceil.forLevel(hi) === null, 'a level with headroom gets none');
    hi.terrain.ceiling = { kind: 'rock' };
    ok(!!Ceil.forLevel(hi), 'unless it asks for one');
    const fam = JSON.parse(JSON.stringify(BG.Levels.find(l => l.campaign === 'famous' && headroom(l) <= 5)));
    fam.terrain.ceiling = { kind: 'girder' };
    ok(!!Ceil.forLevel(fam), 'a Famous Bridge may ask for one explicitly');
  }

  section('cosmetic: the simulation ignores it');
  for (const id of [17, 27, 104]) {
    const L = BG.Levels.find(l => l.id === id);
    const f = path.join(__dirname, 'solutions', 'level-' + String(id).padStart(2, '0') + '.json');
    const d = BG.Model.deserialize(fs.readFileSync(f, 'utf8'));
    const bare = JSON.parse(JSON.stringify(L)); delete bare.terrain.ceiling;
    const a = runHeadless(L, d), b = runHeadless(bare, d);
    const strip = r => JSON.stringify(Object.assign({}, r, { wallMs: 0 }));
    ok(strip(a) === strip(b), 'level ' + id + ': identical run with and without terrain.ceiling', [a.status, b.status]);
  }

  section('generated crossings');
  {
    const G = BG.Generator;
    let lowroof = 0, mism = [];
    for (let d = 0; d < 240; d++) {
      const seed = G.addDays(20261001, d);
      const sk = G._skeleton(seed, G.dailyDifficulty(seed), G.dailyOpts(seed), {});
      const C = Ceil.forLevel(sk.level);
      if (sk.arch === 'lowroof') lowroof++;
      if (!!C !== (sk.arch === 'lowroof')) mism.push(seed + ':' + sk.arch);
      if (C) checkShape(sk.level, C, 'daily ' + seed);
    }
    ok(lowroof > 5, 'some daily skeletons are low-roof crossings', lowroof);
    ok(mism.length === 0, 'a ceiling exactly on the low-roof crossings', mism.slice(0, 5));
    const L = G.daily(20261001); // a low-roof canyon crossing
    const C = Ceil.forLevel(L);
    ok(L.generator.archetype === 'lowroof' && !!C, 'the generated daily of 2026-10-01 (low roof) gets one', L.generator.archetype);
    ok(C && C.y >= deckTop(L) + tallestDrawn(L) + Ceil.MARGIN - 1e-9, 'and its traffic fits under it', C);
  }
}

// ---------------------------------------------------------------- browser
async function browserPart() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.log('  (playwright not available: browser part skipped)'); return; }
  const url = require('url');
  const HREF = url.pathToFileURL(path.join(ROOT, 'index.html')).href;
  const browser = await require('./browser').launch(chromium);
  try {
    section('renderer: every level draws in edit mode');
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      page.on('console', m => { if (m.type() === 'error' || /\[ceiling\]|\[i18n\]/.test(m.text())) errs.push(m.text()); });
      await page.goto(HREF + '?lang=da');
      await page.waitForTimeout(800);
      const res = await page.evaluate(() => {
        const out = [];
        for (const L of BG.Levels) {
          if (BG.Requirements && !BG.Requirements.met(L)) continue;
          BG.Game.openLevel(L.id, { force: true, skipCard: true });
          const r = BG.Game.renderer;
          r.render({ mode: 'edit', level: L, design: BG.Game.design, editorState: BG.Game.editor && BG.Game.editor.state, dt: 1 / 60 });
          if (r._ceil) out.push(L.id);
        }
        const label = BG.i18n.t('editor.label.ceiling.ice');
        BG.Game.goLevelSelect && BG.Game.goLevelSelect();
        return { ids: out, label };
      });
      ok(errs.length === 0, 'no page errors or warnings while rendering every level', errs.slice(0, 3));
      ok(res.ids.length >= 20 && [17, 27, 102, 110].every(id => res.ids.indexOf(id) >= 0), 'the renderer holds a ceiling on the low-cap levels', res.ids);
      ok(res.label === 'GLETSJER', 'label translated (da)', res.label);
      await page.close();
    }

    section('traffic fits under the drawn ceiling (reference designs run)');
    const sol = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions', 'level-' + String(n).padStart(2, '0') + '.json'), 'utf8'));
    const cases = [17, 27, 102, 110, 114].map(id => ({ q: 'level=' + id + '&unlockall&noresume', id, design: sol(id) }))
      .concat([{ q: 'daily=20261001&today=20261001&unlockall&noresume', id: 'daily-20261001', design: null }]);
    for (const c of cases) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      await page.clock.install({ time: new Date('2026-10-01T10:00:00') });
      await page.goto(HREF + '?' + c.q);
      await page.clock.runFor(1600);
      for (let i = 0; i < 60; i++) { // the daily is generated in slices
        if (await page.evaluate(id => !!(BG.Game.level && String(BG.Game.level.id) === String(id)), c.id)) break;
        await page.clock.runFor(500);
      }
      const r = await page.evaluate(([design, secs]) => {
        const g = BG.Game, frame = g._frame;
        let t = performance.now();
        g._frame = function () {};
        if (BG.Famous && BG.Famous.card && BG.Famous.card.open) { const b = document.querySelector('[data-fb=build]'); if (b) b.click(); }
        const L = g.level;
        g._replaceDesign(design || L.generator.solution.design);
        const R = g.renderer;
        let top = -1e9, n = 0;
        const vp = R._vehPose;
        R._vehPose = function () { const P = vp.apply(this, arguments); const c = Math.cos(P.ang), s = Math.sin(P.ang); top = Math.max(top, P.oy + c * P.Hm, P.oy + s * P.Lm + c * P.Hm); n++; return P; };
        const rp = R._railPose;
        R._railPose = function () { const P = rp.apply(this, arguments); if (P) { top = Math.max(top, P.oy + P.c * P.Hm, P.oy + P.s * P.Lm + P.c * P.Hm); n++; } return P; };
        g.setFollow(false); g._lastToggle = -1e9; g.startSim();
        for (let i = 0; i < secs * 10; i++) { t += 100; frame.call(g, t); }
        const C = R._ceil && R._ceil.C;
        return { y: C ? C.y : null, top, n, status: g.sim && g.sim.status };
      }, [c.design, 14]);
      ok(r.y != null && r.n > 0, c.id + ': ceiling drawn and traffic seen', r);
      ok(r.top < r.y - 0.3, c.id + ': highest drawn roof stays at least 0.3 m under the ceiling', { roof: +r.top.toFixed(2), ceiling: r.y });
      ok(errs.length === 0, c.id + ': no page errors', errs.slice(0, 2));
      await page.close();
    }
  } finally { await browser.close(); }
}

(async () => {
  if (BROWSER) {
    try { await browserPart(); } catch (e) { ok(false, 'browser part crashed: ' + e.message); }
  }
  console.log(pass + '/' + (pass + fail) + ' ceiling checks passed');
  process.exit(fail ? 1 : 0);
})();
