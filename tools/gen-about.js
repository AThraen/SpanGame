// about: generates js/features/about-data.js, the numbers on the About screen (js/features/about.js).
// Usage: node tools/gen-about.js           rewrite js/features/about-data.js
//        node tools/gen-about.js --print   print the data, write nothing
// Refresh it before a release (after tagging) or whenever levels, solutions, suites or languages change;
// tools/test-about.js fails while the level / language counts in the file disagree with the game.
// Everything comes from the repository itself: the version is the latest git tag (fallback: package.json),
// levels and languages from the game data (tools/harness.js), proven designs from tools/solutions/, test suites
// from tools/run-tests.js, lines of JavaScript from js/ and tools/ (generated files excluded), commits and dates
// from git. The output is data only (no names, no e-mail addresses) and deterministic for a given commit.
// Run with uncommitted changes (the usual case: the data file is committed together with the change), the commit
// count and the "as of" date include that pending commit, so a re-run after committing gives the same numbers.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'js', 'features', 'about-data.js');
const REPO = 'https://github.com/umage-ai/SpanGame';
// generated JavaScript does not count as written code
const GENERATED = new Set(['js/core/levels.js', 'js/features/goals-data.js', 'js/features/about-data.js']);

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; }
}
function walkJs(rel, out) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const r = rel + '/' + ent.name;
    if (ent.isDirectory()) walkJs(r, out);
    else if (ent.isFile() && ent.name.endsWith('.js') && !GENERATED.has(r)) out.push(r);
  }
  return out;
}
// non-blank lines
function lines(files) {
  return files.reduce((n, f) => n + fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).filter(l => l.trim()).length, 0);
}
function count(dir, re) {
  const abs = path.join(ROOT, dir);
  return fs.existsSync(abs) ? fs.readdirSync(abs).filter(f => re.test(f)).length : 0;
}

function collect() {
  const { BG } = require('./harness');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // version: the latest release tag reachable from HEAD, else package.json
  const tag = git(['describe', '--tags', '--abbrev=0']);
  const version = tag || 'v' + pkg.version;
  const released = tag ? git(['log', '-1', '--format=%cs', tag]) : null;
  const first = git(['log', '--reverse', '--format=%cs']).split('\n')[0] || null;
  // uncommitted changes to tracked files: the numbers are for the commit about to be made
  const pending = git(['status', '--porcelain', '--untracked-files=no']) !== '';
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const levels = BG.Levels || [];
  const perCampaign = {};
  levels.forEach(l => { const c = l.campaign || 'road'; perCampaign[c] = (perCampaign[c] || 0) + 1; });
  const suites = require('./run-tests.js');
  const game = walkJs('js', []), tools = walkJs('tools', []);
  const levelDesigns = count('tools/solutions', /^level-.*\.json$/);
  const badgeDesigns = count('tools/solutions/goals', /\.json$/);
  return {
    version,
    versionFrom: tag ? 'tag' : 'package.json',
    released,                                   // date of the release tag's commit (YYYY-MM-DD) or null
    firstCommit: first,                         // the day the spec was written
    asOf: pending ? today : (git(['log', '-1', '--format=%cs']) || null),   // date of the commit the numbers describe
    commits: (+git(['rev-list', '--count', 'HEAD']) || 0) + (pending ? 1 : 0),
    levels: levels.length,
    campaigns: Object.keys(perCampaign).length,
    campaignLevels: perCampaign,
    designs: levelDesigns + badgeDesigns,       // designs the simulator proves: reference + best per level, one per badge
    levelDesigns,
    badgeDesigns,
    testSuites: suites.NODE.length + suites.BROWSER.length,
    nodeSuites: suites.NODE.length,
    browserSuites: suites.BROWSER.length,
    languages: BG.i18n ? BG.i18n.languages().length : 1,
    jsLines: { total: lines(game) + lines(tools), game: lines(game), tools: lines(tools) },
    jsFiles: game.length + tools.length,
    repo: REPO,
    releaseNotes: tag ? REPO + '/releases/tag/' + tag : REPO + '/releases',
    // how it was built: agent counts from docs/agentic-stats.json (kept by hand from the agent transcripts)
    agentic: agenticStats(),
  };
}

function agenticStats() {
  const f = path.join(ROOT, 'docs', 'agentic-stats.json');
  if (!fs.existsSync(f)) return null;
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { agents: s.agents, workflows: s.workflows, toolCalls: s.toolCalls, models: s.models, asOf: s.asOf, milestones: s.milestones || null };
}

function render(data) {
  return '// SPAN about: the numbers on the About screen (BG.AboutData, shown by js/features/about.js).\n' +
    '// GENERATED by tools/gen-about.js - do not edit by hand; refresh with: node tools/gen-about.js\n' +
    '(function (root) {\n' +
    "  'use strict';\n" +
    '  const BG = (root.BG = root.BG || {});\n' +
    '  BG.AboutData = ' + JSON.stringify(data, null, 2).split('\n').join('\n  ') + ';\n' +
    "})(typeof window !== 'undefined' ? window : globalThis);\n";
}

if (require.main === module) {
  const data = collect();
  if (process.argv.includes('--print')) { console.log(JSON.stringify(data, null, 2)); process.exit(0); }
  const next = render(data);
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (next !== prev) fs.writeFileSync(OUT, next);
  console.log((next !== prev ? 'updated' : 'unchanged') + ' js/features/about-data.js: ' + data.version + ', ' + data.levels + ' levels, ' +
    data.designs + ' proven designs, ' + data.testSuites + ' test suites, ' + data.jsLines.total + ' lines of JavaScript, ' + data.commits + ' commits');
}
module.exports = { collect, render, OUT };
