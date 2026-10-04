// SPAN — headless check: sim speed + camera follow are remembered player preferences; the Arch tool button toggles.
// Usage: node tools/test-prefs.js   (never opens a window)
const { chromium } = require('playwright');
const url = require('url');
(async () => {
  const b = await require('./browser').launch(chromium);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url.pathToFileURL(require('path').resolve(__dirname, '..', 'index.html')).href + '?unlockall&noresume');
  await p.waitForTimeout(1500);
  const r = {};
  // 1. long-gap level: follow should start OFF (no saved pref)
  await p.evaluate(() => BG.Game.openLevel(47, { force: true })); await p.waitForTimeout(400);
  r.follow47_default = await p.evaluate(() => BG.Game.followOn);
  // set prefs: follow on, speed 4
  await p.evaluate(() => { BG.Game.setFollow(true); BG.Game.setSpeed(4); });
  await p.evaluate(() => BG.Game.openLevel(3, { force: true })); await p.waitForTimeout(400);
  r.follow3_after = await p.evaluate(() => BG.Game.followOn);
  r.speed3_after = await p.evaluate(() => BG.Game.speed);
  // persists across reload
  await p.reload(); await p.waitForTimeout(1500);
  await p.evaluate(() => BG.Game.openLevel(2, { force: true })); await p.waitForTimeout(400);
  r.afterReload = await p.evaluate(() => [BG.Game.followOn, BG.Game.speed]);
  // speed kept when starting sim
  await p.evaluate(() => { BG.Game._lastToggle = -1e9; BG.Game.startSim(); }); await p.waitForTimeout(300);
  r.simSpeed = await p.evaluate(() => BG.Game.speed);
  await p.evaluate(() => BG.Game.stopSim ? BG.Game.stopSim() : BG.Game.toggleSim && BG.Game.toggleSim()); await p.waitForTimeout(400);
  // 3. arch button click twice
  await p.evaluate(() => BG.Game.openLevel(15, { force: true })); await p.waitForTimeout(500);
  await p.click('[data-tool=arch]'); await p.waitForTimeout(200);
  r.arch1 = await p.evaluate(() => BG.Game.editor.tool);
  await p.click('[data-tool=arch]'); await p.waitForTimeout(200);
  r.arch2 = await p.evaluate(() => BG.Game.editor.tool);
  r.errs = errs;
  const checks = [
    ['follow starts off on a long level when never chosen', r.follow47_default === false],
    ['follow choice carries to the next level', r.follow3_after === true],
    ['speed choice carries to the next level', r.speed3_after === 4],
    ['follow + speed survive a reload', r.afterReload[0] === true && r.afterReload[1] === 4],
    ['speed kept when the test starts', r.simSpeed === 4],
    ['arch button selects the arch tool', r.arch1 === 'arch'],
    ['clicking the active arch button returns to build', r.arch2 === 'build'],
    ['no page errors', r.errs.length === 0],
  ];
  let bad = 0; for (const [n, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) bad++; }
  console.log(bad ? 'FAILED: ' + bad + ' of ' + checks.length : 'OK: ' + checks.length + ' passed');
  if (bad) process.exitCode = 1;
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
