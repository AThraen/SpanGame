// SPAN — runs the test suites one after another and prints a summary. Never opens a window (the browser
// suites drive headless Chrome through Playwright).
// Usage: node tools/run-tests.js [node|browser|all]      (npm test = node, npm run test:all = all)
//   node     the Node-only suites: physics, every level, editor, templates, goals, events, generator, ...
//   browser  the headless-Chrome suites: e2e runs, mobile layouts, PWA / offline, plus the browser half of the mixed suites
//   all      both
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const NODE = [
  ['test-physics.js'],
  ['verify-levels.js'],
  ['test-editor.js'],
  ['test-unlock.js'],
  ['test-templates.js'],
  ['test-railinfo.js'],
  ['test-anchors.js'],
  ['test-goals.js'],
  ['test-events.js'],
  ['test-generator.js', '--quick'],
  ['test-terrain-fix.js', '--no-browser'],
  ['test-daily.js', '--node-only'],
  ['test-famous.js', '--node-only'],
  ['test-history.js', '--node-only'],
  ['test-i18n.js', '--node-only', '--report-only'], // i18n: the hard-coded string lint reports until the extraction is done
  ['test-i18n-content.js'], // i18n: level, famous, vehicle and generated texts in both languages
];
const BROWSER = [
  ['e2e.js'],
  ['e2e-goals.js'],
  ['e2e-events.js'],
  ['test-terrain-fix.js'],
  ['test-daily.js'],
  ['test-famous.js'],
  ['test-history.js'],
  ['test-mobile.js'],
  ['test-pwa.js'],
  ['test-offline-tour.js', '--no-shots'],
  ['test-i18n.js', '--browser-only'],
  ['test-i18n-ui.js'], // i18n: the in-level HUD, results card, ride card and derail callout switch language in place
];

const which = process.argv[2] || 'node';
const list = which === 'all' ? NODE.concat(BROWSER) : which === 'browser' ? BROWSER : NODE;
const results = [];
for (const [file, ...args] of list) {
  const label = [file].concat(args).join(' ');
  console.log('\n=== ' + label);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, file)].concat(args), { stdio: 'inherit' });
  results.push({ label, ok: r.status === 0, s: ((Date.now() - t0) / 1000).toFixed(0) });
}
console.log('\n=== summary (' + which + ')');
results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.label + '  (' + r.s + ' s)'));
const failed = results.filter(r => !r.ok).length;
console.log(failed ? failed + ' suite(s) failed' : 'all ' + results.length + ' suites passed');
process.exit(failed ? 1 : 0);
