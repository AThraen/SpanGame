// Node test of the campaign unlock rule (BG.Storage, js/ui/storage.js). No browser.
// Usage: node tools/test-unlock.js
// - a level opens when either of the two levels before it in its campaign is complete (skip one, come back later)
// - gates (chapter / line finales and each campaign's finale) can't be skipped: nothing after an unfinished gate opens
// - every chapter end of the level select is a gate; Famous Bridges only gate their finale
// - campaigns open after road 10 (Iron Road) / road 15 (Famous Bridges); ?unlockall opens everything
// - "skipped" levels (open, unfinished, a later level done), lock texts, the rule text
// - migration: levels the old rule had open (or that were played) stay open; other levels follow the gates
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BG } = require('./harness');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'storage.js'), 'utf8'), { filename: 'storage.js' });
const S = BG.Storage, L = BG.Levels;

let pass = 0, fail = 0;
const ok = (name, cond, info) => {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && info !== undefined ? '  ' + JSON.stringify(info) : ''));
};
const fresh = (done, opts) => {
  S.remove('progress'); S.remove('unlocks'); S.remove('unlockAll');
  if (!(opts && opts.legacy)) S.migrateUnlocks(L); // a new player: migrated with nothing to keep, then plays
  (done || []).forEach(id => S.recordResult(id, { passed: true, stars: 1, cost: 1 }));
  ((opts && opts.played) || []).forEach(id => S.recordResult(id, { passed: false }));
};
const open = id => S.isUnlocked(id, L);
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
const openIds = (ids) => ids.filter(open);

// ---- gates are the chapter ends
const CH_ROAD = [[1, 5], [6, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 53]];
const CH_RAIL = [[101, 105], [106, 110], [111, 115], [116, 120]];
const gateIds = L.filter(l => S.isGate(l)).map(l => l.id).sort((a, b) => a - b);
ok('gates = every chapter / line end + each finale (famous: only 212)', JSON.stringify(gateIds) === JSON.stringify(CH_ROAD.concat(CH_RAIL).map(c => c[1]).concat([212]).sort((a, b) => a - b)), gateIds);

// ---- the basic rule
fresh([]);
ok('fresh: only level 1 of the Roads is open', JSON.stringify(openIds(range(1, 10))) === '[1]', openIds(range(1, 10)));
fresh([1]);
ok('1 done: 2 and 3 open (3 by skipping 2), 4 locked', open(2) && open(3) && !open(4));
fresh([1, 3]);
ok('1 + 3 done: 2 skipped-but-open, 4 + 5 open', open(2) && open(4) && open(5) && S.isSkipped(2, L) && !S.isSkipped(4, L) && !S.isSkipped(3, L));
fresh([1, 2, 3]);
ok('a skipped level that is done is no longer "skipped"', !S.isSkipped(2, L) && !S.isSkipped(1, L));

// ---- gates
fresh(range(1, 4));
ok('chapter 1 finale (5) open, but nothing past it before it is done', open(5) && !open(6) && !open(7));
fresh(range(1, 19));
ok('19 done, 20 (chapter finale) not: 20 open, 21 locked (the reported bug)', open(20) && !open(21) && !open(22), openIds(range(18, 23)));
ok('lock text names the finale', /level 20 first/.test(S.lockText(21, L) || '') && /can't be skipped/.test(S.lockText(21, L) || ''), S.lockText(21, L));
fresh(range(1, 18));
ok('18 done: 19 and the finale 20 open (finales themselves can be reached by skipping)', open(19) && open(20) && !open(21));
fresh(range(1, 18).concat([20]));
ok('finale 20 done with 19 skipped: 21 and 22 open, 19 marked skipped', open(21) && open(22) && !open(23) && S.isSkipped(19, L));
fresh(range(1, 49));
ok('Roads finale 50 gates the hidden bonus chapter (51)', open(50) && !open(51));
fresh(range(1, 50));
ok('50 done: bonus 51 and 52 open', open(51) && open(52) && !open(53));
ok('a plain lock text names the two levels before', /level 1 or level 2/.test((fresh([]), S.lockText(3, L)) || ''), S.lockText(3, L));

// ---- Iron Road
fresh(range(1, 9));
ok('Iron Road closed before road 10', !open(101) && /level 10/.test(S.lockText(101, L) || ''));
fresh(range(1, 10).concat(range(101, 104)));
ok('Iron Road: 105 (line 1 finale) gates 106', open(101) && open(105) && !open(106) && !open(107));
fresh(range(1, 10).concat([101, 102, 103, 105]));
ok('Iron Road: 105 done with 104 skipped -> 106, 107 open; 104 skipped', open(106) && open(107) && !open(108) && S.isSkipped(104, L));

// ---- Famous Bridges (date order, only the finale is a gate - and nothing comes after it)
const fam = S.campaignLevels(L, 'famous').map(l => l.id);
fresh(range(1, 15));
ok('Famous: road 15 opens the first bridge only', open(fam[0]) && !open(fam[1]));
fresh(range(1, 15).concat([fam[0], fam[2], fam[4]]));
ok('Famous: skipping is allowed all the way (no chapter gates)', open(fam[1]) && open(fam[3]) && open(fam[5]) && open(fam[6]) && !open(fam[7]) && S.isSkipped(fam[1], L));
ok('Famous lock texts name bridges, not level numbers', !/level 2\d\d/.test((fresh(range(1, 15)), S.lockText(fam[2], L)) || ''), S.lockText(fam[2], L));

// ---- unlock-all, playable
fresh([]); S.set('unlockAll', true);
ok('?unlockall opens every level incl. past gates', open(21) && open(120) && open(fam[fam.length - 1]));
S.remove('unlockAll');

// ---- migration: players who already had levels open past an unfinished gate keep them
fresh(range(1, 19).concat([21, 22]), { legacy: true });
const kept = S.migrateUnlocks(L);
ok('migration keeps 21-24 (open under the old rule) but not 25', [21, 22, 23, 24].every(id => kept.includes(id)) && !kept.includes(25) && open(21) && open(23) && open(24) && !open(25), { kept, open: openIds(range(19, 26)) });
S.recordResult(23, { passed: true, stars: 1, cost: 1 });
ok('migration: new levels past the unfinished gate stay locked (25 after 23 + 24 open)', !open(25) && /level 20/.test(S.lockText(25, L) || ''));
S.recordResult(20, { passed: true, stars: 1, cost: 1 });
ok('migration: beating the gate opens the rest as usual', open(25));
ok('migration runs once (idempotent, second call keeps the same list)', JSON.stringify(S.migrateUnlocks(L)) === JSON.stringify(kept));
fresh(range(1, 18), { legacy: true, played: [21] });
ok('migration keeps a played level even when the old rule would close it now', S.migrateUnlocks(L).includes(21) && open(21));
fresh(range(1, 19));
ok('a new player (migrated with nothing open past a gate) never gets 21 early', !open(21) && S.keptUnlocks().length === 0);
S.resetProgress();
ok('reset progress clears kept unlocks', S.keptUnlocks().length === 0 && open(1) && !open(2));

// ---- rule text
ok('rule text explains skipping + finales', /either of the two/.test(S.unlockRuleText('road')) && /Chapter finales/.test(S.unlockRuleText('road')) && /Line finales/.test(S.unlockRuleText('rail')) && /bridge/.test(S.unlockRuleText('famous')));

// ---- daily / endless levels are not campaign levels
const daily = { id: 'daily-2026-10-03', campaign: 'daily', terrain: {} };
ok('generated (daily / endless) levels are outside the rule (not in any campaign list)', S.CAMPAIGN_ORDER.every(c => !S.campaignLevels(L, c).includes(daily)));

console.log('\n' + pass + '/' + (pass + fail) + ' unlock checks passed');
process.exit(fail ? 1 : 0);
