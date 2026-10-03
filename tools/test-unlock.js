// Node test of the campaign unlock rule (BG.Storage, js/ui/storage.js). No browser.
// Usage: node tools/test-unlock.js
// - a level opens when either of the two levels before it in its campaign is complete (skip one, come back later)
// - gates (chapter / line finales and each campaign's finale) can't be skipped: nothing after an unfinished gate opens
// - every chapter end of the level select is a gate; Famous Bridges only gate their finale
// - campaigns open after road 10 (Iron Road) / road 15 (Famous Bridges); ?unlockall opens everything
// - "skipped" levels (open, unfinished, a later level done), lock texts, the rule text
// - the branching Anchorages chapter (54-58): opens after 40, own unlock list, no gates, own finale, main line untouched
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
// ---- the hidden Anchorages chapter (54-58) branches off after level 40: own unlock list, no gates, main line untouched
const lvOf = id => L.find(l => l.id === id);
ok('Anchorages registered as a branching bonus chapter of the Roads (54-58, after 40)', (() => { const b = S.bonusChapterOf(lvOf(56)); return !!b && b.id === 'anchorages' && b.first === 54 && b.last === 58 && b.unlockAfter === 40 && !S.bonusChapterOf(lvOf(53)) && !S.bonusChapterOf(lvOf(40)); })());
ok('Anchorages levels are Roads levels and none of them is a gate', [54, 55, 56, 57, 58].every(id => lvOf(id) && S.campaignOf(lvOf(id)) === 'road' && !S.isGate(lvOf(id))));
fresh(range(1, 39));
ok('Anchorages closed before level 40', !open(54) && /level 40/.test(S.lockText(54, L) || '') && /Anchorages/.test(S.lockText(54, L) || ''), S.lockText(54, L));
fresh(range(1, 40));
ok('40 done: 54 opens (and 41, 42 on the main line), 55 not yet', open(54) && !open(55) && !open(56) && open(41) && open(42) && !open(43), openIds([41, 42, 43, 54, 55, 56]));
fresh(range(1, 40).concat([54]));
ok('54 done: 55 and 56 open (skip one), 57 locked', open(55) && open(56) && !open(57));
fresh(range(1, 40).concat([54, 56]));
ok('54 + 56 done: 57 and 58 open, 55 skipped (58 is no gate, nothing after it)', open(57) && open(58) && S.isSkipped(55, L));
fresh(range(1, 40).concat(range(54, 58)));
ok('finishing the Anchorages never marks main-line levels as skipped or opens them early', !S.isSkipped(41, L) && open(42) && !open(43));
fresh(range(1, 39).concat([54]), { legacy: true });
ok('migration keeps nothing in the Anchorages (it postdates the gates)', S.migrateUnlocks(L).every(id => id < 54 || id > 58) && !open(54));
ok('unlock lists: 54-58 on their own, the main line skips them', JSON.stringify(S.unlockList(L, lvOf(55)).map(l => l.id)) === '[54,55,56,57,58]' && S.unlockList(L, lvOf(53)).every(l => l.id < 54) && S.unlockList(L, lvOf(53)).some(l => l.id === 53));
ok('finales: 53 bonus, 58 anchorages, 50 road', S.finaleOf(lvOf(53)) === 'bonus' && S.finaleOf(lvOf(58)) === 'anchorages' && S.finaleOf(lvOf(50)) === 'road' && S.finaleOf(lvOf(57)) === null);
fresh(range(1, 50));
ok('50 done: both bonus chapters open (51 and 54)', open(51) && open(54));

ok('a plain lock text names the two levels before',/level 1 or level 2/.test((fresh([]), S.lockText(3, L)) || ''), S.lockText(3, L));

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
