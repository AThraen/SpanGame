// SPAN — i18n of the in-level screens in headless Chrome: the HUD (top bar, tool rail, palette, sim bar), the Arch
// tool bar, a passed and a failed results card, the Iron Road ride-quality card and the derail callout, the hover
// tooltip and the canvas labels, in English and Danish, and a language switch while each is on screen (no reload).
// Usage: node tools/test-i18n-ui.js        Never opens a window; exits 1 on failure.
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(msg, c, extra) {
  if (c) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
const sol = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'level-' + String(n).padStart(2, '0') + '.json'), 'utf8'));

(async () => {
  const { chromium } = require('playwright');
  const b = await require('./browser').launch(chromium);
  const href = url.pathToFileURL(path.join(ROOT, 'index.html')).href;
  const problems = [];
  try {
    const ctx = await b.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' || /\[i18n\]/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    await page.goto(href + '?noresume&lang=en');
    await page.waitForSelector('#screen-title.active');
    const txt = sel => page.$eval(sel, e => e.textContent.trim()).catch(() => null);
    const attr = (sel, a) => page.$eval(sel, (e, a2) => e.getAttribute(a2), a).catch(() => null);
    const setLang = l => page.evaluate(l2 => BG.i18n.setLanguage(l2), l);
    const runSim = maxSec => page.evaluate(ms => {
      const g = BG.Game; let t = 0;
      while (g.state === 'sim' && t < ms) { g._updateSim(1 / 6); t += 1 / 6; }
      return g.lastResult ? { passed: g.lastResult.passed, reason: g.lastResult.reason } : null;
    }, maxSec);

    // ---- the in-level HUD, English then Danish without leaving the level
    await page.evaluate(() => { BG.Game.openLevel(11, { force: true }); });
    await page.waitForSelector('#screen-level.active');
    await page.evaluate(() => BG.Hud.hideHint());
    const hud = () => page.evaluate(() => ({
      badge: document.querySelector('.lvl-k').textContent,
      name: document.querySelector('[data-ref=lvlName]').textContent,
      sub: document.querySelector('[data-ref=lvlSub]').textContent,
      cost: document.querySelector('.budget-k').textContent.trim(),
      build: document.querySelector('[data-tool=build] span').textContent,
      buildTip: document.querySelector('[data-tool=build]').title,
      pier: document.querySelector('[data-tool=pier] span').textContent,
      mat: document.querySelector('.mat .mat-info b').textContent,
      matTip: document.querySelector('.mat').title,
      perM: document.querySelector('.mat .mat-meta em').textContent,
      test: document.querySelector('.test-btn .tb-lbl .tb-play').textContent,
      space: document.querySelector('.test-btn small').textContent,
      traffic: document.querySelector('[data-ref=traffic]').title,
      tpl: (document.querySelector('.tpl-head') || {}).textContent || '',
      budget: document.querySelector('[data-ref=budgetV]').textContent,
    }));
    const en = await hud();
    ok('English HUD: badge, tools, palette, test button', en.badge === 'LEVEL' && en.build === 'Build' && en.buildTip === 'Build (B)' && en.test === 'Test' && en.space === 'Space' && en.cost === 'Cost', en);
    ok('English HUD: subtitle facts and pier count', /Chapter \d · \d+\sm gap/.test(en.sub) && /^Pier( \d+\/\d+)?$/.test(en.pier), en);
    ok('English HUD: palette tooltip with price per metre', /— \$\d+\/m, max \d+\sm/.test(en.matTip) && /^\$\d+\/m$/.test(en.perM), en);
    ok('English HUD: traffic summary', /^\d+ vehicles?: /.test(en.traffic), en.traffic);
    await setLang('da');
    await page.waitForFunction(() => document.documentElement.lang === 'da');
    const da = await hud();
    ok('Dansk HUD re-renders in place: badge, tools, test button', da.badge === 'BANE' && da.build === 'Byg' && da.buildTip === 'Byg (B)' && da.test === 'Test' && da.space === 'Mellemrum' && da.cost === 'Pris', da);
    ok('Dansk HUD: subtitle, pier label and template menu', /Kapitel \d · \d+\sm kløft/.test(da.sub) && /^Pille/.test(da.pier) && (da.tpl === '' || da.tpl === 'Start fra en skabelon'), da);
    ok('Dansk HUD: palette with Danish names and money', /^\$[\d.]+\/m$/.test(da.perM) && /maks\. \d+\sm/.test(da.matTip) && da.mat !== en.mat, da);
    ok('Dansk HUD: traffic summary', /^\d+ køretøj(er)?: /.test(da.traffic), da.traffic);

    // ---- the Arch tool bar follows the language
    await page.evaluate(() => BG.Game.setTool('arch'));
    await page.evaluate(() => BG.Hud.update(0.016));
    ok('Dansk: Arch tool bar', (await txt('.arch-bar .ab-head b')) === 'Bue og kurve' && (await txt('[data-ab-shape=catenary]')) === 'Kædelinje' && /Træk fra start til slut/.test(await txt('[data-ab=help]')),
      [await txt('.arch-bar .ab-head b'), await txt('[data-ab=help]')]);
    await setLang('en');
    await page.evaluate(() => BG.Hud.update(0.016));
    ok('English again: Arch tool bar', (await txt('.arch-bar .ab-head b')) === 'Arch & Curve' && (await txt('[data-ab-shape=catenary]')) === 'Catenary' && /Drag from start to end/.test(await txt('[data-ab=help]')));
    await page.evaluate(() => BG.Game.setTool('build'));

    // ---- a passed result, then switch the language with the card open
    await page.evaluate(d => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(11));
    const r11 = await runSim(120);
    await page.waitForTimeout(600);
    ok('level 11 reference passes', r11 && r11.passed, r11);
    const card = () => page.evaluate(() => ({
      banner: document.querySelector('[data-ref=resBanner]').textContent,
      title: document.querySelector('[data-ref=resTitle]').textContent,
      reason: document.querySelector('[data-ref=resReason]').textContent,
      stats: Array.from(document.querySelectorAll('.res-stats .rs span')).map(e => e.textContent).join('|'),
      cap: document.querySelector('.rb-cap').textContent,
      next: document.querySelector('[data-act=next] span').textContent,
      retry: document.querySelector('[data-act=retry] span').textContent,
    }));
    const c1 = await card();
    ok('English results card', /safely\./.test(c1.reason) && c1.stats === 'Cost|Budget|Vehicles|Peak stress|Time|Broken' && /% of budget$/.test(c1.cap) && c1.next === 'Next level' && c1.retry === 'Replay', c1);
    await setLang('da');
    const c2 = await card();
    ok('Dansk: the open results card is rebuilt (title, text, stats, buttons)', /sikkert over\./.test(c2.reason) && c2.stats === 'Pris|Budget|Køretøjer|Maks. belastning|Tid|Brudt' &&
      /\s%\saf budgettet$/.test(c2.cap) && c2.next === 'Næste bane' && c2.retry === 'Se igen' && c2.title !== c1.title, c2);
    await page.evaluate(() => BG.Game.backToEdit());
    await page.waitForTimeout(300);

    // ---- a failure: the explanation names the first break, in Danish
    // the reference with only its deck left: the road sags and breaks
    await page.evaluate(d => { BG.Hud.hideHint(); d.beams = d.beams.filter(x => x.m === 'road'); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(11));
    await runSim(60);
    await page.waitForTimeout(400);
    const f1 = await card();
    ok('Dansk: a failed run is explained in Danish', /Broen holdt ikke|Ud over kanten|Sammenbrud/.test(f1.banner + f1.title) && /bjælke|kørebane|vej/i.test(f1.reason) && c2.retry !== f1.retry && f1.retry === 'Prøv igen', f1);
    await setLang('en');
    const f2 = await card();
    ok('English again: the failure text follows', /beam|deck|road/i.test(f2.reason) && f2.retry === 'Retry', f2);
    await page.evaluate(() => BG.Game.backToEdit());

    // ---- canvas labels and the hover tooltip read the dictionary
    const labels = await page.evaluate(() => { BG.i18n.setLanguage('da'); return { noBuild: BG.i18n.t('editor.label.noBuild'), keep: BG.Game.renderer && BG.Game.renderer._roadwayText ? BG.Game.renderer._roadwayText({ env: { height: 4.5 } }) : '' }; });
    ok('Dansk: canvas labels (keep clear with a Danish decimal)', labels.noBuild === 'BYGGEFORBUD' && /^VEJ · HOLD FRI 4,5\sm$/.test(labels.keep), labels);

    // ---- Iron Road: the derail callout and the ride-quality card, switched while on screen
    await page.evaluate(() => { BG.Game.openLevel(102, { force: true }); });
    await page.waitForSelector('#screen-level.active');
    await page.evaluate(() => BG.Hud.hideHint());
    ok('Dansk: rail level badge', (await txt('.lvl-k')) === 'TOG');
    await page.evaluate(() => { BG.Game.editor.design = { nodes: [{ id: 'n1', x: 4, y: 0 }, { id: 'n2', x: 8, y: 0 }], beams: [{ a: 'a0', b: 'n1', m: 'rail' }, { a: 'n1', b: 'n2', m: 'rail' }, { a: 'n2', b: 'a1', m: 'rail' }], piers: [] }; BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
    await page.evaluate(() => { const g = BG.Game; for (let i = 0; i < 60 * 20 && g.state === 'sim' && !g._derailFx; i++) g._updateSim(1 / 60); });
    await page.waitForTimeout(300);
    const dc = () => page.evaluate(() => ({ show: document.querySelector('[data-ref=derail]').classList.contains('show'), title: document.querySelector('[data-ref=dcTitle]').textContent, cause: document.querySelector('[data-ref=dcCause]').textContent }));
    const d1 = await dc();
    ok('Dansk: derail callout with Danish numbers', d1.show && /Afsporet/.test(d1.title) && /^Knæk på \d+,\d° ved \d+ m\/s/.test(d1.cause), d1);
    await setLang('en');
    const d2 = await dc();
    ok('English again: the open callout is rebuilt', d2.show && /Derailed/.test(d2.title) && /^Kink \d+\.\d° at \d+ m\/s/.test(d2.cause), d2);
    await runSim(40);
    await page.waitForTimeout(400);
    const rail = () => page.evaluate(() => ({ verdicts: (document.querySelector('.rv-row') || {}).textContent || '', ride: (document.querySelector('.ride-card') || {}).textContent || '', reason: document.querySelector('[data-ref=resReason]').textContent }));
    const rc1 = await rail();
    ok('English ride-quality card', /Structure held/.test(rc1.verdicts) && /Ride quality/.test(rc1.ride) && /Worst kink/.test(rc1.ride), rc1);
    await setLang('da');
    const rc2 = await rail();
    ok('Dansk: ride-quality card and derail explanation rebuilt', /Konstruktionen holdt/.test(rc2.verdicts) && /Kørekomfort/.test(rc2.ride) && /Værste knæk/.test(rc2.ride) && /Knæk på/.test(rc2.reason), rc2);
    await ctx.close();

    // ---- every screen and modal, opened in English and switched to Danish while it is on screen: no English left.
    // "English" = a text node, title, aria-label or placeholder that matches an English dictionary text (with {params}
    // as wildcards) whose Danish text is different.
    const ctx2 = await b.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const p2 = await ctx2.newPage();
    p2.on('console', m => { if (m.type() === 'error' || /\[i18n\]/.test(m.text())) problems.push(m.text()); });
    p2.on('pageerror', e => problems.push('pageerror: ' + e.message));
    await p2.goto(href + '?noresume&unlockall&lang=en');
    await p2.waitForSelector('#screen-title.active');
    await p2.evaluate(() => {
      const en = BG.i18n.dict.en, da = BG.i18n.dict.da, vals = v => (v && typeof v === 'object' ? Object.values(v) : [v]);
      const exact = new Set(), pats = [];
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      Object.keys(en).forEach(k => vals(en[k]).forEach(x => {
        x = String(x).replace(/<[^>]*>/g, '').trim();
        if (x.replace(/\{\w+\}/g, '').replace(/[^A-Za-z]/g, '').length < 4 || vals(da[k]).some(y => String(y).replace(/<[^>]*>/g, '').trim() === x)) return;
        if (/\{\w+\}/.test(x)) pats.push(new RegExp('^' + x.split(/\{\w+\}/).map(esc).join('.+?') + '$')); else exact.add(x);
      }));
      window.__english = root => {
        const out = [], seen = new Set();
        const test = (s, where) => { s = (s || '').replace(/\s+/g, ' ').trim(); if (!s || seen.has(s)) return; if (exact.has(s) || pats.some(r => r.test(s))) { seen.add(s); out.push(where + s.slice(0, 60)); } };
        const shown = el => { for (let p = el; p && p !== document.documentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; } return true; };
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) if (n.parentElement && shown(n.parentElement)) { test(n.textContent, ''); test(n.parentElement.textContent, ''); }
        root.querySelectorAll('[title],[aria-label],[placeholder],[data-tip]').forEach(e => { if (shown(e)) ['title', 'aria-label', 'placeholder', 'data-tip'].forEach(a => test(e.getAttribute(a), a + ': ')); });
        return out;
      };
    });
    const sweep = async (label, open) => {
      await p2.evaluate(() => BG.i18n.setLanguage('en'));
      await open();
      await p2.waitForTimeout(350);
      const before = await p2.evaluate(() => window.__english(document.getElementById('ui') || document.body).length);
      await p2.evaluate(() => BG.i18n.setLanguage('da'));
      await p2.waitForTimeout(250);
      const left = await p2.evaluate(() => window.__english(document.getElementById('ui') || document.body));
      ok('live switch, no English left: ' + label, before > 0 && left.length === 0, { before, left });
    };
    await sweep('title screen', async () => {});
    await sweep('settings panel', () => p2.evaluate(() => BG.Hud.openSettings()));
    await p2.evaluate(() => BG.Hud.closeSettings());
    await sweep('About screen', () => p2.evaluate(() => BG.About.open())); // about
    await p2.evaluate(() => BG.About.close());
    await sweep('level select (Roads)', () => p2.evaluate(() => { BG.Game.goLevelSelect(); BG.Hud.setCampaignTab('road'); }));
    await sweep('level select (Iron Road)', () => p2.evaluate(() => BG.Hud.setCampaignTab('rail')));
    await sweep('level select (Famous Bridges)', () => p2.evaluate(() => BG.Hud.setCampaignTab('famous')));
    await sweep('history modal: runs', () => p2.evaluate(() => { BG.History.open('runs'); }));
    await sweep('history modal: levels', () => p2.evaluate(() => { BG.History.open('levels'); }));
    await sweep('history modal: stats', () => p2.evaluate(() => { BG.History.open('stats'); }));
    await p2.keyboard.press('Escape');
    await sweep('famous history card', () => p2.evaluate(() => { BG.Game.goLevelSelect(); BG.Famous.showCard(BG.Game.findLevel(206)); }));
    await p2.keyboard.press('Escape');
    await sweep('daily panel', () => p2.evaluate(() => { BG.Game.goTitle(); BG.Daily.openPanel(); }));
    await p2.keyboard.press('Escape');
    await sweep('level HUD + goals panel (level 11)', () => p2.evaluate(() => { BG.Game.openLevel(11, { force: true }); BG.Hud.hideHint(); BG.GoalsUI.setOpen(true, true); }));
    await sweep('results card (level 11 passed)', () => p2.evaluate(d => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); const g = BG.Game; let t = 0; while (g.state === 'sim' && t < 120) { g._updateSim(1 / 6); t += 1 / 6; } }, sol(11)));
    await sweep('history modal over a level', () => p2.evaluate(() => { BG.History.open('runs'); }));
    await p2.keyboard.press('Escape');
    await sweep('rail level HUD (level 112)', () => p2.evaluate(() => { BG.Game.openLevel(112, { force: true }); BG.Hud.hideHint(); }));
    await ctx2.close();
  } catch (e) {
    fail++; console.log('FAIL exception: ' + (e && e.stack || e));
  } finally {
    await b.close();
  }
  ok('no console errors, page errors or [i18n] missing-key warnings', problems.length === 0, problems);
  console.log('\n' + (fail ? 'FAILED: ' + fail + ' failed, ' + pass + ' passed' : 'OK: ' + pass + ' passed'));
  process.exit(fail ? 1 : 0);
})();
