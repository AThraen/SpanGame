// SPAN — i18n checks for game content: level names and hints, famous bridge history cards, vehicle / train /
// material names, generated daily / endless names and hints, bridge templates. See docs/I18N.md.
// Usage: node tools/test-i18n-content.js        (Node only, no browser)
//   1  the English dictionaries match the level JSON (tools/levels/*.json is the English source of truth), and
//      Danish has every level name / hint and every history field
//   2  level.name / level.hint / level.history.* follow the language (getters made by js/core/levels.js)
//   3  vehicle, train, rail car and material names follow the language; BG.Model.trafficSummary in both languages
//   4  generated crossings: every noun / adjective has its words, Danish names are grammatical compounds /
//      "Den/Det <adj> <noun>", names survive a JSON round trip (the daily cache) through BG.Generator.localize
//   5  bridge templates: names, descriptions and reasons in both languages
//   No [i18n] warning (missing key) may be logged in any of it.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let failed = 0, passed = 0;
const ok = (name, cond, info) => {
  if (cond) passed++; else failed++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info).slice(0, 2000)) : ''));
};

// collect [i18n] warnings (missing keys) while the checks run
const warnings = [];
const warn0 = console.warn;
console.warn = function () { const s = Array.prototype.join.call(arguments, ' '); if (/\[i18n\]/.test(s)) warnings.push(s); else warn0.apply(console, arguments); };

const { BG } = require('./harness');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'core', 'generator.js'), 'utf8'), { filename: 'generator.js' });
const I = BG.i18n;
const en = I.dict.en, da = I.dict.da;

// ====================================================================== 1. dictionaries vs level JSON
const DIR = path.join(ROOT, 'tools', 'levels');
const JSONS = fs.readdirSync(DIR).filter(f => /^level-\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))).sort((a, b) => a.id - b.id);
console.log('--- 1. dictionaries vs tools/levels/*.json (' + JSONS.length + ' levels)');
{
  const stale = [], missingDa = [], same = [];
  for (const l of JSONS) {
    for (const f of ['name', 'hint']) {
      const k = 'levels.' + l.id + '.' + f;
      if (en[k] !== l[f]) stale.push(k);
      if (!da[k]) missingDa.push(k);
      else if (f === 'hint' && da[k] === l[f]) same.push(k);
    }
  }
  ok('js/i18n/en/levels.js matches every level name and hint in the JSON', !stale.length, stale);
  ok('js/i18n/da/levels.js has every level name and hint', !missingDa.length, missingDa);
  ok('every Danish hint is translated (not a copy of the English)', !same.length, same);
  const ids = new Set(JSONS.map(l => String(l.id)));
  const orphan = Object.keys(en).concat(Object.keys(da)).filter(k => /^levels\./.test(k) && !ids.has(k.split('.')[1]));
  ok('no level text for a level that does not exist', !orphan.length, orphan);
}
{
  const stale = [], missingDa = [], same = [];
  const HF = ['name', 'year', 'built', 'location', 'crosses', 'engineer', 'span', 'type', 'why', 'note'];
  for (const l of JSONS) {
    const H = l.history;
    if (!H) continue;
    const fields = HF.filter(f => typeof H[f] === 'string').map(f => [f, H[f]]).concat((H.facts || []).map((x, i) => ['fact' + (i + 1), x]));
    for (const [f, text] of fields) {
      const k = 'famous.' + l.id + '.' + f;
      if (en[k] !== text) stale.push(k);
      if (!da[k]) missingDa.push(k);
      else if (/^(fact\d|why|note)$/.test(f) && da[k] === text) same.push(k);
    }
  }
  ok('js/i18n/en/famous.js matches every history card field in the JSON', !stale.length, stale);
  ok('js/i18n/da/famous.js has every history card field', !missingDa.length, missingDa);
  ok('every Danish fact / why / note is translated', !same.length, same);
}

// ====================================================================== 2. level getters
console.log('--- 2. level.name / level.hint / level.history follow the language');
{
  I.setLanguage('en');
  const byId = id => BG.Levels.find(l => l.id === id);
  const enOk = JSONS.every(j => { const l = byId(j.id); return l && l.name === j.name && l.hint === j.hint; });
  ok('English: every BG.Levels name / hint equals the JSON', enOk);
  I.setLanguage('da');
  const daOk = BG.Levels.every(l => l.name === da['levels.' + l.id + '.name'] && l.hint === da['levels.' + l.id + '.hint']);
  ok('Danish: every BG.Levels name / hint comes from js/i18n/da/levels.js', daOk);
  const l1 = byId(1);
  ok('Danish: levelText(level 1) and level.name agree', I.levelText(l1, 'name') === l1.name && l1.name === 'Vaklebækken', l1.name);
  const f = byId(211);
  ok('Danish: history card of 211 (name, facts, art untouched)', f.history.name === 'Øresundsbroen' && f.history.facts.length === 3 &&
    f.history.facts[2] === da['famous.211.fact3'] && f.history.art === 'assets/famous/oresund-bridge.svg', f.history);
  const clone = JSON.parse(JSON.stringify(f));
  ok('Danish: a JSON copy of a level carries the Danish text', clone.name === 'Øresundsbroen' && clone.history.why === da['famous.211.why']);
  I.setLanguage('en');
  ok('back to English: history card of 211', f.history.name === 'Øresund Bridge' && f.history.facts[2] === JSONS.find(j => j.id === 211).history.facts[2]);
  const saved = l1.name; l1.name = 'Custom'; const set = l1.name === 'Custom'; l1.name = undefined;
  ok('a level name can still be set (override) and reset', set && l1.name === saved);
}

// ====================================================================== 3. vehicles, trains, materials
console.log('--- 3. vehicle, train, rail car and material names');
{
  const groups = [['vehicles.material.', BG.Materials], ['vehicles.road.', BG.Vehicles], ['vehicles.car.', BG.RailCars], ['vehicles.train.', BG.Trains]];
  const miss = [];
  groups.forEach(([p, obj]) => Object.keys(obj).forEach(id => { if (!en[p + id] || !da[p + id]) miss.push(p + id); }));
  Object.keys(BG.Vehicles).forEach(id => { if (!en['vehicles.road.' + id + '.count'] || !da['vehicles.road.' + id + '.count']) miss.push('vehicles.road.' + id + '.count'); });
  Object.keys(BG.Trains).forEach(id => { if (!en['vehicles.train.' + id + '.count'] || !da['vehicles.train.' + id + '.count']) miss.push('vehicles.train.' + id + '.count'); });
  ok('every material, vehicle, rail car and train has a name (and a count) in both languages', !miss.length, miss);
  I.setLanguage('da');
  ok('Danish names through .name', BG.Materials.reinforced_road.name === 'Forstærket vej' && BG.Vehicles.truck.name === 'Lastbil' &&
    BG.RailCars.loco_steam.name === 'Damplokomotiv' && BG.Trains.ore.name === 'Malmtog', [BG.Materials.reinforced_road.name, BG.Vehicles.truck.name]);
  const L = id => BG.Levels.find(l => l.id === id);
  const s1 = BG.Model.trafficSummary(L(1)).text, s120 = BG.Model.trafficSummary(L(120)).text;
  ok('Danish traffic summary', s1 === '2 biler, 2 varevogne' && s120 === '1 langt højhastighedstog (14 vogne), 2 biler, 2 lastbiler, 1 malmtog (24 vogne)', [s1, s120]);
  I.setLanguage('en');
  const e1 = BG.Model.trafficSummary(L(1)).text, e120 = BG.Model.trafficSummary(L(120)).text, e31 = BG.Model.trafficSummary(L(31)).text;
  ok('English traffic summary unchanged', e1 === '2 cars, 2 vans' && e120 === '1 high-speed (long) train (14 cars), 2 cars, 2 trucks, 1 ore train (24 cars)' && e31 === '4 trucks', [e1, e120, e31]);
  ok('English names through .name', BG.Materials.cable.name === 'Steel Cable' && BG.Vehicles.semi.name === 'Semi Trailer' && BG.Trains.highspeed_long.name === 'High-Speed (long)');
}

// ====================================================================== 4. generated crossings
console.log('--- 4. generated daily / endless names and hints');
{
  const G = BG.Generator;
  const src = fs.readFileSync(path.join(ROOT, 'js', 'core', 'generator.js'), 'utf8');
  const nounBlock = (src.match(/const NOUNS = \{([\s\S]*?)\};/) || [])[1] || '';
  const nouns = (nounBlock.match(/'([A-Za-z]+)'/g) || []).map(s => s.slice(1, -1).toLowerCase());
  const adjs = (((src.match(/const ADJ = \[([^\]]*)\]/) || [])[1] || '').match(/'([A-Za-z]+)'/g) || []).map(s => s.slice(1, -1).toLowerCase());
  ok('found the generator word lists', nouns.length === 25 && adjs.length === 12, [nouns.length, adjs.length]);
  const miss = [];
  nouns.forEach(n => ['.day', '.adj'].forEach(f => { const k = 'content.gen.noun.' + n + f; if (!en[k] || !da[k]) miss.push(k); }));
  adjs.forEach(a => { const k = 'content.gen.adj.' + a; if (!en[k] || !da[k]) miss.push(k); });
  for (let d = 0; d < 7; d++) if (!en['content.gen.weekday.' + d] || !da['content.gen.weekday.' + d]) miss.push('content.gen.weekday.' + d);
  ['channel', 'piers', 'lowroof', 'noledge', 'default', 'addPier'].forEach(h => { if (!en['content.gen.hint.' + h] || !da['content.gen.hint.' + h]) miss.push('content.gen.hint.' + h); });
  ok('every noun, adjective, weekday and hint has its words in both languages', !miss.length, miss);

  // every Danish combination is grammatical: "Mandagskløften" / "Den blæsende kløft", "Det tågede stræde"
  I.setLanguage('da');
  const bad = [];
  for (let wd = 0; wd < 7; wd++) nouns.forEach(n => {
    const name = G.localText({ i18n: { name: { weekday: wd, noun: n } } }, 'name');
    if (!/^(Man|Tirs|Ons|Tors|Fre|Lør|Søn)dags[a-zæøå]+(en|et|n|t)$/.test(name || '')) bad.push(name);
  });
  adjs.forEach(a => nouns.forEach(n => {
    const name = G.localText({ i18n: { name: { adj: a, noun: n } } }, 'name');
    if (!/^(Den|Det) [a-zæøå]+e [a-zæøå]+$/.test(name || '')) bad.push(name);
  }));
  ok('Danish generated names are grammatical (' + (7 * nouns.length + adjs.length * nouns.length) + ' combinations)', !bad.length, bad);
  const neuter = ['strait', 'sound', 'reach', 'abyss', 'ford', 'rapids', 'gap', 'pass', 'notch'];
  const gender = nouns.filter(n => (da['content.gen.noun.' + n + '.adj'].indexOf('Det ') === 0) !== neuter.includes(n));
  ok('Danish article follows the noun gender (den / det)', !gender.length, gender);

  const lv = G.daily(20261005);
  const ed = G.generate(G.endlessSeed(7, 3), G.endlessOpts(7, 3));
  ok('levels carry what their name and hint are made of (level.i18n)', lv.i18n && lv.i18n.name && lv.i18n.name.weekday === 0 && ed.i18n && ed.i18n.name.adj && lv.i18n.hint && lv.i18n.hint.id, [lv.i18n, ed.i18n]);
  ok('Danish daily name: Monday compound', /^Mandags[a-zæøå]+$/.test(lv.name), lv.name);
  ok('Danish hint from content.gen.hint', lv.hint === da['content.gen.hint.' + lv.i18n.hint.id].replace('{gap}', lv.i18n.hint.gap != null ? I.meters(lv.i18n.hint.gap, 0) : '{gap}'), lv.hint);
  const cached = G.localize(JSON.parse(JSON.stringify(ed)));
  ok('a cached (JSON) level is localized again', cached.name === ed.name && /^(Den|Det) /.test(cached.name), cached.name);
  I.setLanguage('en');
  ok('English daily name unchanged', /^Monday's [A-Z][a-z]+$/.test(lv.name) && lv.name === 'Monday\'s ' + en['content.gen.noun.' + lv.i18n.name.noun + '.day'], lv.name);
  ok('English endless name', ed.name === en['content.gen.noun.' + ed.i18n.name.noun + '.adj'].replace('{adj}', en['content.gen.adj.' + ed.i18n.name.adj]), ed.name);
  ok('English cached level', G.localize(JSON.parse(JSON.stringify(ed))).name === ed.name);
  const piers = { i18n: { hint: { id: 'piers', gap: 34 } } };
  ok('piers hint formats the gap', /^A 34 m span/.test(G.localText(piers, 'hint')) && (I.setLanguage('da'), /^Et spænd på 34 m /.test(G.localText(piers, 'hint'))), G.localText(piers, 'hint'));
  I.setLanguage('en');
  ok('a level without level.i18n keeps its own text', G.localize({ name: 'X', hint: 'Y' }).name === 'X');
}

// ====================================================================== 5. templates
console.log('--- 5. bridge templates');
{
  const T = BG.Templates;
  const miss = T.list.filter(t => !en['content.template.' + t.id + '.name'] || !da['content.template.' + t.id + '.name'] || !en['content.template.' + t.id + '.desc'] || !da['content.template.' + t.id + '.desc']).map(t => t.id);
  ok('every template has a name and a description in both languages', !miss.length, miss);
  I.setLanguage('da');
  const L3 = BG.Levels.find(l => l.id === 3);
  const av = T.available(L3);
  const via = av.find(t => t.id === 'viaduct');
  ok('Danish template names and reasons', T.list.find(t => t.id === 'suspension').name === 'Hængebro' && via && via.reason === 'kræver murværk', [via && via.name, via && via.reason]);
  I.setLanguage('en');
  ok('English template reason unchanged', T.available(L3).find(t => t.id === 'viaduct').reason === 'needs masonry');
}

console.warn = warn0;
ok('no [i18n] warnings (missing keys) while checking', !warnings.length, warnings);
console.log('\n' + (failed ? 'FAILED: ' + failed + ' failed, ' + passed + ' passed' : 'OK: ' + passed + ' passed'));
process.exit(failed ? 1 : 0);
