// BG.History - local run history, personal bests, stats, autosave / resume and save export / import.
// history: feature module (loaded after main.js). Everything is stored through BG.Storage (try/catch,
// in-memory fallback), so the game keeps working with no storage at all. The data part (BG.History.*)
// has no DOM and runs in Node (tools/test-history.js); the UI part installs only in a browser, by
// wrapping BG.Game / BG.Hud / BG.Editor methods (hooks, no rewrites of the shared files).
//
// Storage keys (all under BG.Storage's 'span.v1.' prefix; the legacy keys are never rewritten):
//   settings, progress, design.<id>, unlockAll   legacy (storage.js), untouched
//   hist.meta     { schema, migratedAt }
//   hist.runs     [ run, ... ]  newest last, capped to MAX_RUNS
//                 run = { i, t, l, c, n, ok, f, s, p, d, b, k? }  (id, time, level, cost, members, passed,
//                 fail reason, stars, peak stress, sim time, broken beams, snapshot key)
//   hist.bests    { [levelId]: { cost, members, peak, time, stars: {v, t, k?}, runs, passes, first, last } }
//   hist.stats    { runs, passes, collapses, spent, placed, mats: {m: n}, playMs, since }
//   hist.snaps    [ { k, l, ok, t, z } ]  index of design snapshots (z = stored size)
//   hist.s.<k>    compact design snapshot string
//   hist.session  { state, levelId, tab, cam, vw, vh, follow, t }  where the player was (for resume)
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const SCHEMA = 2;
  const MAX_RUNS = 500;
  const PASS_SNAPS_PER_LEVEL = 8;
  const FAIL_SNAPS_PER_LEVEL = 3;
  const SNAP_BUDGET = 1200000;     // chars across all snapshots
  const RESUME_MAX_AGE = 72 * 3600 * 1000;
  const SAVE_FORMAT = 'span-save';

  function S() { return BG.Storage || null; }
  function sget(k, d) { const st = S(); if (!st) return d; try { const v = st.get(k, d); return v == null ? d : v; } catch (e) { return d; } }
  function sset(k, v) { const st = S(); if (!st) return; try { st.set(k, v); } catch (e) { /* ignore */ } }
  function sdel(k) { const st = S(); if (!st) return; try { st.remove(k); } catch (e) { /* ignore */ } }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  const H = {
    SCHEMA, MAX_RUNS,
    _now() { return Date.now(); },
    _cache: null,

    // ------------------------------------------------------------ schema / migration
    // Brings the stored data up to SCHEMA. v1 (no hist.meta) = the original storage.js keys only:
    // personal bests are seeded from progress.levels (stars, bestCost) and the run counter from attempts.
    migrate() {
      const meta = sget('hist.meta', null);
      const from = isObj(meta) ? (meta.schema | 0) : 1;
      if (from >= SCHEMA) return { from, to: from, migrated: false };
      if (from < 2) {
        const prog = sget('progress', null);
        const levels = isObj(prog) && isObj(prog.levels) ? prog.levels : {};
        const bests = H._bests();
        const stats = H.getStats();
        let attempts = 0;
        Object.keys(levels).forEach(id => {
          const p = levels[id];
          if (!isObj(p)) return;
          attempts += p.attempts | 0;
          const b = bests[id] || (bests[id] = H._emptyBest());
          b.runs = Math.max(b.runs | 0, p.attempts | 0);
          if (p.completed) b.passes = Math.max(b.passes | 0, 1);
          if (p.bestCost != null && isFinite(p.bestCost) && (!b.cost || p.bestCost < b.cost.v)) b.cost = { v: +p.bestCost, t: null };
          if ((p.stars | 0) > 0 && (!b.stars || (p.stars | 0) > b.stars.v)) b.stars = { v: p.stars | 0, t: null };
        });
        if (attempts > (stats.runs | 0)) { stats.legacyRuns = attempts - (stats.runs | 0); stats.runs = attempts; }
        sset('hist.bests', bests);
        sset('hist.stats', stats);
      }
      sset('hist.meta', { schema: SCHEMA, migratedAt: H._now(), from });
      H._cache = null;
      return { from, to: SCHEMA, migrated: true };
    },

    // ------------------------------------------------------------ runs
    getRuns() {
      const r = sget('hist.runs', []);
      return Array.isArray(r) ? r.filter(x => isObj(x) && x.l != null) : [];
    },
    runsFor(levelId) { return H.getRuns().filter(r => r.l === levelId); },
    // info: { levelId, passed, simOk, stars, cost, budget, members, peak, time, broken, reason, design, materials }
    // Returns { run, improvements: [{key, label, v, prev, delta}], prev (bests before), best (after), first }
    recordRun(info) {
      if (!info || info.levelId == null) return null;
      H.migrate();
      const t = H._now();
      const runs = H.getRuns();
      const passed = !!info.passed;
      const run = {
        i: t.toString(36) + (runs.length % 1296).toString(36),
        t, l: info.levelId,
        c: Math.round(num(info.cost, 0)),
        n: num(info.members, 0) | 0,
        ok: passed ? 1 : 0,
        f: passed ? null : (info.simOk ? 'over_budget' : (info.reason || 'failed')),
        s: passed ? (info.stars | 0) : 0,
        p: info.peak != null && isFinite(info.peak) ? r3(+info.peak) : null,
        d: info.time != null && isFinite(info.time) ? Math.round(info.time * 10) / 10 : null,
        b: num(info.broken, 0) | 0,
      };
      if (info.budget) run.g = Math.round(+info.budget);
      // design snapshot: every passing run, and the latest few failing ones per level
      if (info.design) {
        const k = H._storeSnapshot(run, info.design);
        if (k) run.k = k;
      }
      runs.push(run);
      while (runs.length > MAX_RUNS) runs.shift();
      sset('hist.runs', runs);

      // personal bests
      const bests = H._bests();
      const id = String(info.levelId);
      const before = bests[id] ? JSON.parse(JSON.stringify(bests[id])) : null;
      const b = bests[id] || (bests[id] = H._emptyBest());
      b.runs = (b.runs | 0) + 1;
      if (!b.first) b.first = t;
      b.last = t;
      const imp = [];
      if (passed) {
        b.passes = (b.passes | 0) + 1;
        const better = (key, v, lower, label) => {
          if (v == null || !isFinite(v)) return;
          const cur = b[key];
          if (!cur || cur.v == null || (lower ? v < cur.v - 1e-9 : v > cur.v + 1e-9)) {
            imp.push({ key, label, v, prev: cur && cur.v != null ? cur.v : null, delta: cur && cur.v != null ? v - cur.v : null });
            b[key] = { v, t };
            if (run.k) b[key].k = run.k;
          }
        };
        better('cost', run.c, true, 'Lowest cost');
        better('members', run.n, true, 'Fewest members');
        better('peak', run.p, true, 'Lowest peak stress');
        better('time', run.d, true, 'Fastest crossing');
        better('stars', run.s, false, 'Most stars');
      }
      sset('hist.bests', bests);
      H._pruneSnapshots();

      // stats
      const st = H.getStats();
      st.runs = (st.runs | 0) + 1;
      if (passed) st.passes = (st.passes | 0) + 1;
      if (!passed && !info.simOk && run.b > 0) st.collapses = (st.collapses | 0) + 1;
      st.spent = Math.round(num(st.spent, 0) + run.c);
      if (isObj(info.materials)) {
        st.tested = isObj(st.tested) ? st.tested : {};
        Object.keys(info.materials).forEach(m => { st.tested[m] = (st.tested[m] | 0) + (info.materials[m] | 0); });
      }
      H._saveStats(st);
      return { run, improvements: imp, prev: before, best: b, first: passed && !(before && before.passes) };
    },

    // ------------------------------------------------------------ bests
    _emptyBest() { return { cost: null, members: null, peak: null, time: null, stars: null, runs: 0, passes: 0, first: null, last: null }; },
    _bests() { const b = sget('hist.bests', {}); return isObj(b) ? b : {}; },
    getBests(levelId) {
      if (levelId == null) return H._bests();
      const b = H._bests()[String(levelId)];
      return b ? Object.assign(H._emptyBest(), b) : null;
    },

    // ------------------------------------------------------------ stats
    getStats() {
      const s = sget('hist.stats', null);
      const o = Object.assign({ runs: 0, passes: 0, collapses: 0, spent: 0, placed: 0, mats: {}, tested: {}, playMs: 0, since: null }, isObj(s) ? s : {});
      if (!isObj(o.mats)) o.mats = {};
      if (!isObj(o.tested)) o.tested = {};
      return o;
    },
    _saveStats(st) { if (!st.since) st.since = H._now(); sset('hist.stats', st); },
    // material counts { wood: 3 } of newly placed beams
    addPlaced(mats) {
      if (!isObj(mats)) return;
      const st = H.getStats();
      let n = 0;
      Object.keys(mats).forEach(m => { const c = mats[m] | 0; if (c > 0) { st.mats[m] = (st.mats[m] | 0) + c; n += c; } });
      if (!n) return;
      st.placed = (st.placed | 0) + n;
      H._saveStats(st);
    },
    addPlayTime(ms) {
      ms = num(ms, 0);
      if (ms <= 0) return;
      const st = H.getStats();
      st.playMs = Math.round(num(st.playMs, 0) + ms);
      H._saveStats(st);
    },
    favouriteMaterial(st) {
      st = st || H.getStats();
      const pick = o => { let best = null, bn = 0; Object.keys(o || {}).forEach(m => { if ((o[m] | 0) > bn) { bn = o[m] | 0; best = m; } }); return best; };
      return pick(st.mats) || pick(st.tested);
    },
    summary() {
      const st = H.getStats();
      const bests = H._bests();
      const levelsPlayed = Object.keys(bests).length;
      const levelsPassed = Object.keys(bests).filter(k => (bests[k].passes | 0) > 0).length;
      return {
        runs: st.runs | 0, bridgesBuilt: st.passes | 0, failed: Math.max(0, (st.runs | 0) - (st.passes | 0)),
        collapses: st.collapses | 0, beamsPlaced: st.placed | 0, spent: st.spent | 0,
        favourite: H.favouriteMaterial(st), playMs: st.playMs | 0, levelsPlayed, levelsPassed, since: st.since,
      };
    },

    // ------------------------------------------------------------ design snapshots
    // Compact form: 'c1' + JSON {n:[[id,x,y]], b:[[ai,bi,mi]], m:[mat], p:[[x,topY]]} with numbers rounded
    // to 1 mm and beam ends as indices into an id table (anchors / pier tops appear as plain ids).
    encodeDesign(d) {
      if (!d || !Array.isArray(d.beams)) return null;
      const ids = [], idx = {};
      const ref = id => { if (!(id in idx)) { idx[id] = ids.length; ids.push(id); } return idx[id]; };
      const nodes = (d.nodes || []).map(n => { ref(n.id); return [r3(+n.x), r3(+n.y)]; });
      const mats = [], mi = {};
      const beams = d.beams.map(b => {
        if (!(b.m in mi)) { mi[b.m] = mats.length; mats.push(b.m); }
        return [ref(b.a), ref(b.b), mi[b.m]];
      });
      const o = { i: ids, n: nodes, b: beams, m: mats };
      if (d.piers && d.piers.length) o.p = d.piers.map(p => [r3(+p.x), r3(+p.topY)]);
      return 'c1' + JSON.stringify(o);
    },
    decodeDesign(s) {
      if (typeof s !== 'string') return null;
      try {
        if (s.slice(0, 2) !== 'c1') {
          const d = BG.Model && BG.Model.deserialize ? BG.Model.deserialize(s) : JSON.parse(s);
          return d && Array.isArray(d.beams) ? d : null;
        }
        const o = JSON.parse(s.slice(2));
        const ids = o.i || [];
        const out = { nodes: [], beams: [], piers: [] };
        (o.n || []).forEach((p, j) => { out.nodes.push({ id: String(ids[j]), x: +p[0], y: +p[1] }); });
        (o.b || []).forEach(b => { if (ids[b[0]] != null && ids[b[1]] != null && o.m[b[2]] != null) out.beams.push({ a: String(ids[b[0]]), b: String(ids[b[1]]), m: String(o.m[b[2]]) }); });
        (o.p || []).forEach(p => { out.piers.push({ x: +p[0], topY: +p[1] }); });
        return out;
      } catch (e) { return null; }
    },
    _snapIndex() { const a = sget('hist.snaps', []); return Array.isArray(a) ? a.filter(x => isObj(x) && x.k) : []; },
    _storeSnapshot(run, design) {
      const str = H.encodeDesign(design);
      if (!str) return null;
      const k = run.i;
      const idx = H._snapIndex();
      const write = () => { sset('hist.s.' + k, str); return sget('hist.s.' + k, null) === str; };
      let ok = write();
      if (!ok) { // quota: drop the oldest unreferenced snapshots and try once more
        H._pruneSnapshots(Math.floor(SNAP_BUDGET / 3));
        ok = write();
      }
      if (!ok) { sdel('hist.s.' + k); return null; }
      idx.push({ k, l: run.l, ok: run.ok, t: run.t, z: str.length });
      sset('hist.snaps', idx);
      return k;
    },
    loadSnapshot(k) {
      if (!k) return null;
      return H.decodeDesign(sget('hist.s.' + k, null));
    },
    hasSnapshot(k) { return !!k && H._snapIndex().some(x => x.k === k); },
    // retention: per level the latest PASS_SNAPS_PER_LEVEL passing + FAIL_SNAPS_PER_LEVEL failing runs, any
    // snapshot a personal best points at, and only snapshots whose run is still in the history; then the
    // global size budget (oldest unreferenced first)
    _pruneSnapshots(budget) {
      budget = budget || SNAP_BUDGET;
      const idx = H._snapIndex();
      if (!idx.length) return;
      const keep = new Set();
      const pinned = new Set();
      const bests = H._bests();
      Object.keys(bests).forEach(id => ['cost', 'members', 'peak', 'time', 'stars'].forEach(f => { const e = bests[id][f]; if (e && e.k) pinned.add(e.k); }));
      const live = new Set(H.getRuns().map(r => r.k).filter(Boolean));
      const per = {};
      for (let j = idx.length - 1; j >= 0; j--) {
        const e = idx[j];
        const c = per[e.l] || (per[e.l] = { ok: 0, bad: 0 });
        if (pinned.has(e.k)) { keep.add(e.k); continue; }
        if (!live.has(e.k)) continue;
        if (e.ok) { if (c.ok++ < PASS_SNAPS_PER_LEVEL) keep.add(e.k); } else if (c.bad++ < FAIL_SNAPS_PER_LEVEL) keep.add(e.k);
      }
      let total = idx.filter(e => keep.has(e.k)).reduce((a, e) => a + (e.z | 0), 0);
      for (let j = 0; j < idx.length && total > budget; j++) {
        const e = idx[j];
        if (keep.has(e.k) && !pinned.has(e.k)) { keep.delete(e.k); total -= e.z | 0; }
      }
      const out = [];
      idx.forEach(e => { if (keep.has(e.k)) out.push(e); else sdel('hist.s.' + e.k); });
      if (out.length !== idx.length) {
        sset('hist.snaps', out);
        const runs = H.getRuns();
        let dirty = false;
        runs.forEach(r => { if (r.k && !keep.has(r.k)) { delete r.k; dirty = true; } });
        if (dirty) sset('hist.runs', runs);
      }
    },

    // ------------------------------------------------------------ session (resume)
    getSession() { const s = sget('hist.session', null); return isObj(s) ? s : null; },
    saveSession(s) { if (isObj(s)) sset('hist.session', Object.assign({}, s, { t: H._now() })); },
    // what to do on launch: { action: 'level'|'levelSelect'|null, session }
    resumePlan(sess, now) {
      sess = sess || H.getSession();
      if (!sess) return { action: null, session: null };
      now = now != null ? now : H._now();
      const fresh = sess.t && now - sess.t < RESUME_MAX_AGE;
      if (!fresh) return { action: null, session: sess };
      if ((sess.state === 'edit' || sess.state === 'sim' || sess.state === 'results') && sess.levelId != null) return { action: 'level', session: sess };
      if (sess.state === 'levelSelect') return { action: 'levelSelect', session: sess };
      return { action: null, session: sess };
    },

    // ------------------------------------------------------------ export / import
    // every key under the storage prefix (localStorage), or the known keys when storage is unavailable
    _keys() {
      const out = new Set();
      const P = 'span.v1.';
      try {
        const ls = root.localStorage;
        if (ls) for (let j = 0; j < ls.length; j++) { const k = ls.key(j); if (k && k.indexOf(P) === 0) out.add(k.slice(P.length)); }
      } catch (e) { /* unavailable */ }
      ['settings', 'progress', 'unlockAll', 'hist.meta', 'hist.runs', 'hist.bests', 'hist.stats', 'hist.snaps', 'hist.session'].forEach(k => out.add(k));
      (Array.isArray(BG.Levels) ? BG.Levels : []).forEach((l, j) => out.add('design.' + (l && l.id != null ? l.id : j + 1)));
      H._snapIndex().forEach(e => out.add('hist.s.' + e.k));
      out.delete('__probe');
      return Array.from(out);
    },
    exportSave() {
      H.migrate();
      const data = {};
      H._keys().forEach(k => { const v = sget(k, undefined); if (v !== undefined && v !== null) data[k] = v; });
      return { format: SAVE_FORMAT, version: 1, schema: SCHEMA, game: 'SPAN', exported: new Date(H._now()).toISOString(), data };
    },
    exportString() { return JSON.stringify(H.exportSave()); },
    // replaces the local save with the file's contents. Returns { ok, error?, keys }
    // checks a parsed or string save without touching storage: { ok, error?, save, keys }
    validateSave(input) {
      let o = input;
      if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return { ok: false, error: 'That file is not a SPAN save (not JSON).' }; } }
      if (!isObj(o) || o.format !== SAVE_FORMAT || !isObj(o.data)) return { ok: false, error: 'That file is not a SPAN save.' };
      if ((o.schema | 0) > SCHEMA) return { ok: false, error: 'That save is from a newer version of SPAN.' };
      const keys = Object.keys(o.data).filter(k => /^[A-Za-z0-9_.\-]{1,80}$/.test(k) && k !== '__probe');
      if (!keys.length) return { ok: false, error: 'That save file is empty.' };
      if (o.data.progress != null && !isObj(o.data.progress)) return { ok: false, error: 'That save file is damaged.' };
      return { ok: true, save: o, keys };
    },
    importSave(input) {
      const v = H.validateSave(input);
      if (!v.ok) return v;
      const o = v.save, keys = v.keys;
      // replace: clear what we have, then write the file's keys
      H._keys().forEach(k => sdel(k));
      keys.forEach(k => sset(k, o.data[k]));
      if (!o.data['hist.meta']) sdel('hist.meta'); // older save without history: migrate from its progress
      H._cache = null;
      H.migrate();
      return { ok: true, keys: keys.length };
    },
    resetAll() {
      ['hist.runs', 'hist.bests', 'hist.stats', 'hist.session'].forEach(sdel);
      H._snapIndex().forEach(e => sdel('hist.s.' + e.k));
      sdel('hist.snaps');
      sset('hist.meta', { schema: SCHEMA, migratedAt: H._now(), from: SCHEMA });
    },
  };
  BG.History = H;
  if (BG.Storage) BG.Storage.SCHEMA = SCHEMA; // history: schema version of the save as a whole

  // =================================================================== browser UI
  if (typeof document === 'undefined' || !BG.Game || !BG.Hud) return;
  const Game = BG.Game, Hud = BG.Hud;

  function safe(fn, d) { try { return fn(); } catch (e) { if (root.console) console.error('[history]', e); return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function money(n) { return Hud.money ? Hud.money(n) : '$' + Math.round(n); }
  function icon(n) { return Hud.icon ? Hud.icon(n) : ''; }
  function sfx(n, o) { try { BG.Audio && BG.Audio.play(n, o); } catch (e) { /* */ } }
  function toast(m, k, ms) { safe(() => Hud.toast && Hud.toast(m, k, ms)); }
  function levels() { return Array.isArray(BG.Levels) ? BG.Levels : []; }
  function findLevel(id) { return safe(() => Game.findLevel(id), null); }
  function lvLabel(id) { const lv = findLevel(id); return (lv && Hud.levelLabel ? Hud.levelLabel(lv) : 'Level ' + id); }
  function lvName(id) { const lv = findLevel(id); return lv ? (lv.name || '') : ''; }
  function matName(m) { const d = BG.Materials && BG.Materials[m]; return d ? d.name : m; }
  function stars(n) { return '★'.repeat(n | 0) + '<span class="hs-dim">' + '★'.repeat(3 - (n | 0)) + '</span>'; }
  function fmtDur(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return Math.round(ms / 1000) + ' s';
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function ago(t) {
    if (!t) return '';
    const d = Date.now() - t, m = Math.round(d / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    const days = Math.round(h / 24);
    if (days < 7) return days === 1 ? 'yesterday' : days + ' days ago';
    try { return new Date(t).toLocaleDateString(); } catch (e) { return days + ' days ago'; }
  }
  const REASONS = { over_budget: 'Over budget', vehicle_fell: 'Fell', derailed: 'Derailed', vehicle_jumped: 'Jumped', stalled: 'Stuck', timeout: 'Out of time', failed: 'Failed' };
  function reasonText(r) { return REASONS[r] || 'Failed'; }

  function materialCounts(d) {
    const o = {};
    ((d && d.beams) || []).forEach(b => { o[b.m] = (o[b.m] | 0) + 1; });
    return o;
  }

  // ------------------------------------------------------------ sparkline (cost over attempts)
  function sparkline(runs, budget, w, h) {
    w = w || 160; h = h || 34;
    const list = runs.slice(-40);
    if (!list.length) return '';
    const vals = list.map(r => r.c);
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (budget) { lo = Math.min(lo, budget * 0.6); hi = Math.max(hi, budget); }
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    const pad = 3;
    const X = j => list.length === 1 ? w / 2 : pad + (w - 2 * pad) * j / (list.length - 1);
    const Y = v => h - pad - (h - 2 * pad) * (v - lo) / (hi - lo);
    const pts = list.map((r, j) => X(j).toFixed(1) + ',' + Y(r.c).toFixed(1)).join(' ');
    const bl = budget ? '<line class="sp-budget" x1="0" x2="' + w + '" y1="' + Y(budget).toFixed(1) + '" y2="' + Y(budget).toFixed(1) + '"/>' : '';
    const dots = list.map((r, j) => '<circle class="' + (r.ok ? 'sp-ok' : 'sp-bad') + '" cx="' + X(j).toFixed(1) + '" cy="' + Y(r.c).toFixed(1) + '" r="2.2"/>').join('');
    return '<svg class="hist-spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="Cost over ' + list.length + ' attempts">' +
      bl + '<polyline points="' + pts + '"/>' + dots + '</svg>';
  }

  // ------------------------------------------------------------ results: record the run + show bests
  const UI = { open: false, tab: 'runs', level: 'all', result: 'all' };
  const origFinish = Game._finishRun;
  Game._finishRun = function (status) { // history: record every test run
    const sim = this.sim, lv = this.level;
    const out = origFinish.apply(this, arguments);
    if (sim && lv && this.lastResult && this.state === 'results') {
      safe(() => {
        const res = this.lastResult;
        const d = this.getDesign();
        const rec = H.recordRun({
          levelId: lv.id != null ? lv.id : safe(() => levels().indexOf(lv) + 1, null),
          passed: res.passed, simOk: res.simOk, stars: res.stars, cost: res.cost, budget: res.budget,
          members: d.beams.length, peak: res.peakStress, time: res.time, broken: res.brokenBeams, reason: res.reason,
          design: d, materials: materialCounts(d),
        });
        res.history = rec;
        showResultBests(res, rec);
      });
    }
    return out;
  };
  function showResultBests(res, rec) {
    const card = Hud.el && Hud.el.results && Hud.el.results.querySelector('.results-card');
    if (!card) return;
    let box = card.querySelector('.hist-res');
    if (!box) {
      box = el('<div class="hist-res" aria-live="polite"></div>');
      const actions = card.querySelector('.res-actions');
      card.insertBefore(box, actions || null);
    }
    const parts = [];
    if (rec && res.passed) {
      const imp = rec.improvements || [];
      const cost = imp.find(i => i.key === 'cost');
      if (rec.first) parts.push('<span class="hb hb-new">' + icon('flag') + 'First pass on this level</span>');
      else if (cost && cost.prev != null) parts.push('<span class="hb hb-new">' + icon('trophy') + 'New best! <b>−' + money(-cost.delta) + '</b> vs your previous ' + money(cost.prev) + '</span>');
      imp.forEach(i => {
        if (rec.first || i.key === 'cost' || i.prev == null) return;
        let t;
        if (i.key === 'members') t = 'Fewest members: ' + i.v + ' (was ' + i.prev + ')';
        else if (i.key === 'peak') t = 'Lowest peak stress: ' + Math.round(i.v * 100) + '% (was ' + Math.round(i.prev * 100) + '%)';
        else if (i.key === 'time') t = 'Fastest crossing: ' + i.v.toFixed(1) + ' s (was ' + i.prev.toFixed(1) + ' s)';
        else if (i.key === 'stars') t = 'New star record: ' + '★'.repeat(i.v);
        if (t) parts.push('<span class="hb hb-up">' + t + '</span>');
      });
      if (!rec.first && !cost && rec.prev && rec.prev.cost) parts.push('<span class="hb">Your best: ' + money(rec.prev.cost.v) + ' (' + (res.cost > rec.prev.cost.v ? '+' : '') + money(res.cost - rec.prev.cost.v) + ')</span>');
    } else if (rec && rec.best && rec.best.cost) {
      parts.push('<span class="hb">Your best here: ' + money(rec.best.cost.v) + (rec.best.stars ? ' · ' + '★'.repeat(rec.best.stars.v) : '') + '</span>');
    }
    if (rec && rec.best) parts.push('<span class="hb hb-dim">Attempt ' + (rec.best.runs | 0) + '</span>');
    box.innerHTML = parts.join('');
    box.hidden = !parts.length;
  }

  // ------------------------------------------------------------ level tile tooltips
  function tileTip(id) {
    const b = H.getBests(id);
    if (!b || !b.runs) return '';
    const p = [];
    if (b.cost) p.push('Best ' + money(b.cost.v));
    if (b.stars) p.push('★'.repeat(b.stars.v));
    if (b.members) p.push(b.members.v + ' members');
    if (b.peak) p.push('peak ' + Math.round(b.peak.v * 100) + '%');
    if (b.time) p.push(b.time.v.toFixed(1) + ' s');
    p.push(b.runs + ' run' + (b.runs === 1 ? '' : 's'));
    return p.join(' · ');
  }
  const origBuildLS = Hud.buildLevelSelect;
  if (typeof origBuildLS === 'function') {
    Hud.buildLevelSelect = function () { // history: personal bests on tile tooltips
      const out = origBuildLS.apply(this, arguments);
      safe(() => {
        const wrap = this.el.levels;
        if (!wrap) return;
        wrap.querySelectorAll('.tile.open[data-id]').forEach(t => {
          const tip = tileTip(+t.dataset.id);
          const name = (t.querySelector('.tile-name') || {}).textContent || '';
          t.title = tip ? name + '\n' + tip : name;
        });
      });
      return out;
    };
  }

  // ------------------------------------------------------------ title: Resume
  function resumeTarget() {
    const s = H.getSession();
    const r = s && s.resume;
    if (!r || r.levelId == null || !findLevel(r.levelId)) return null;
    return r;
  }
  const origRefreshTitle = Hud.refreshTitle;
  Hud.refreshTitle = function () { // history: Resume button
    const out = origRefreshTitle ? origRefreshTitle.apply(this, arguments) : undefined;
    safe(() => {
      const t = this.el.title;
      const btn = t && t.querySelector('[data-hist=resume]');
      if (!btn) return;
      const r = resumeTarget();
      btn.hidden = !r;
      if (r) {
        btn.querySelector('.lbl').textContent = 'Resume · ' + lvLabel(r.levelId);
        // same level as Continue: one button, labelled Resume (Game.continueGame resumes it, camera included)
        const cont = t.querySelector('[data-act=continue]');
        const ct = safe(() => Game.continueTarget(), null);
        if (cont && !cont.hidden && ct && ct.id === r.levelId) {
          btn.hidden = true;
          const l = cont.querySelector('.lbl');
          if (l) l.textContent = 'Resume · ' + lvLabel(r.levelId);
        }
      }
    });
    return out;
  };

  // ------------------------------------------------------------ session tracking / autosave
  let suppress = false;
  function cameraState() {
    const r = Game.renderer;
    const c = r && r.camera;
    if (!c || !isFinite(c.x) || !isFinite(c.zoom)) return null;
    return { x: r3(c.x), y: r3(c.y), zoom: r3(c.zoom) };
  }
  function snapshotSession() {
    if (suppress) return;
    const st = Game.state;
    if (st === 'boot') return;
    const prev = H.getSession() || {};
    const s = { state: st, tab: Hud.tab || 'road', vw: root.innerWidth, vh: root.innerHeight, resume: prev.resume || null };
    if (Game.level && (st === 'edit' || st === 'sim' || st === 'results')) {
      s.levelId = Game.level.id;
      s.follow = !!Game.followOn;
      if (st === 'edit') s.cam = cameraState();
      else if (prev.levelId === s.levelId) s.cam = prev.cam || null;
      s.resume = { levelId: s.levelId, cam: s.cam, vw: s.vw, vh: s.vh, follow: s.follow };
    }
    if (st === 'levelSelect') {
      const sc = Hud.el && Hud.el.levels && Hud.el.levels.querySelector('.ls-scroll');
      if (sc) s.scroll = Math.round(sc.scrollTop);
    }
    H.saveSession(s);
  }
  let sessTimer = 0;
  function sessionSoon() { if (sessTimer) clearTimeout(sessTimer); sessTimer = setTimeout(() => { sessTimer = 0; safe(snapshotSession); }, 250); }
  const origSetState = Game._setState;
  Game._setState = function (s) { // history: remember the screen for resume
    const out = origSetState.apply(this, arguments);
    if (!this._histResuming) sessionSoon();
    return out;
  };
  const origCamp = Hud.setCampaignTab;
  if (typeof origCamp === 'function') Hud.setCampaignTab = function () { const o = origCamp.apply(this, arguments); sessionSoon(); return o; };

  function flushAll() { // history: pagehide / hidden tab (mobile tabs get killed without warning)
    if (suppress) return;
    safe(() => Game._saveNow && Game._saveNow());
    safe(snapshotSession);
    safe(tickPlay);
  }
  root.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); else lastTick = Date.now(); });
  root.addEventListener('beforeunload', flushAll);

  // debounced design autosave on every change + beams-placed stats
  let saveTimer = 0, quiet = 0, lastMats = null, lastLv = null;
  const prevChanged = Game.onDesignChanged;
  Game.onDesignChanged = function (d) {
    if (typeof prevChanged === 'function') safe(() => prevChanged.call(this, d));
    safe(() => {
      const mats = materialCounts(d);
      const lvId = this.level ? this.level.id : null;
      if (lastMats && lastLv === lvId && !quiet) {
        const add = {};
        Object.keys(mats).forEach(m => { const k = (mats[m] | 0) - (lastMats[m] | 0); if (k > 0) add[m] = k; });
        H.addPlaced(add);
      }
      lastMats = mats; lastLv = lvId;
    });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = 0; if (!suppress) safe(() => Game._saveNow && Game._saveNow()); }, 350);
  };
  function quietWrap(obj, name) {
    const f = obj && obj[name];
    if (typeof f !== 'function') return;
    obj[name] = function () { quiet++; try { return f.apply(this, arguments); } finally { quiet--; } };
  }
  if (BG.Editor && BG.Editor.prototype) ['undo', 'redo', 'load'].forEach(n => quietWrap(BG.Editor.prototype, n));
  const origOpen = Game.openLevel;
  Game.openLevel = function () { // history: baseline the material counts so loading a design is not "placing"
    quiet++;
    let out;
    try { out = origOpen.apply(this, arguments); } finally { quiet--; }
    safe(() => { lastMats = materialCounts(this.getDesign()); lastLv = this.level ? this.level.id : null; });
    return out;
  };

  // play time (only while the tab is visible)
  let lastTick = Date.now(), playAcc = 0;
  function tickPlay() {
    const now = Date.now();
    const d = now - lastTick;
    lastTick = now;
    if (typeof document !== 'undefined' && document.hidden) return;
    playAcc += Math.min(d, 15000);
    if (playAcc >= 1000) { H.addPlayTime(playAcc); playAcc = 0; }
  }
  setInterval(() => safe(tickPlay), 10000);
  setInterval(() => { if (Game.state === 'edit') safe(snapshotSession); }, 3000); // camera moves

  // reset progress also clears history
  const origReset = Game.resetProgress;
  Game.resetProgress = function () { const o = origReset.apply(this, arguments); safe(() => H.resetAll()); safe(() => Hud.refreshTitle && Hud.refreshTitle()); return o; };

  // ------------------------------------------------------------ resume on launch
  function restoreCamera(sess) {
    const r = Game.renderer;
    if (!r || !r.camera || !sess || !sess.cam) return false;
    // a different viewport (rotated phone, other window size): keep the fresh fit instead
    const vw = root.innerWidth, vh = root.innerHeight;
    if (sess.vw && sess.vh && (Math.abs(vw - sess.vw) / sess.vw > 0.15 || Math.abs(vh - sess.vh) / sess.vh > 0.15)) return false;
    const c = sess.cam;
    if (!isFinite(c.x) || !isFinite(c.y) || !(c.zoom > 0)) return false;
    const lvId = Game.level && Game.level.id;
    const apply = () => {
      if (touched || Game.state !== 'edit' || !Game.level || Game.level.id !== lvId || Game.renderer !== r) return;
      r.camera.x = c.x; r.camera.y = c.y; r.camera.zoom = c.zoom;
    };
    // other layers (the mobile layout) may re-fit the camera a frame or two after a level opens:
    // apply again shortly after, unless the player has already touched / scrolled the view
    let touched = false;
    const mark = () => { touched = true; };
    ['pointerdown', 'wheel', 'keydown'].forEach(ev => root.addEventListener(ev, mark, { capture: true, once: true, passive: true }));
    apply();
    const raf = root.requestAnimationFrame || (f => setTimeout(f, 16));
    raf(() => raf(() => raf(apply)));
    setTimeout(apply, 200);
    setTimeout(() => { apply(); ['pointerdown', 'wheel', 'keydown'].forEach(ev => root.removeEventListener(ev, mark, { capture: true })); }, 450);
    return true;
  }
  function resumeLevel(r) {
    if (!r || r.levelId == null) return false;
    const ok = Game.openLevel(r.levelId, { force: true });
    if (!ok) return false;
    restoreCamera(r);
    if (r.follow != null && !!r.follow !== !!Game.followOn) Game.followOn = !!r.follow;
    return true;
  }
  Game.resumeSession = function () { // history: Resume button on title
    const r = resumeTarget();
    if (!r) return false;
    return resumeLevel(r);
  };
  const origContinue = Game.continueGame;
  Game.continueGame = function () { // history: Continue into the level being resumed restores its camera too
    const r = resumeTarget();
    const ct = safe(() => this.continueTarget(), null);
    if (r && ct && ct.id === r.levelId && this.state === 'title' && resumeLevel(r)) return;
    return origContinue.apply(this, arguments);
  };
  const origInit = Game.init;
  Game.init = function () { // history: migrate the save, then resume where the player left off
    safe(() => H.migrate());
    const already = this._inited;
    const out = origInit.apply(this, arguments);
    if (already) return out;
    let params = null;
    try { params = new URLSearchParams(root.location.search); } catch (e) { /* */ }
    const explicit = params && (params.has('level') || params.has('screen') || params.has('noresume'));
    if (!explicit) {
      safe(() => {
        const plan = H.resumePlan();
        this._histResuming = true;
        try {
          if (plan.action === 'level') resumeLevel(plan.session);
          else if (plan.action === 'levelSelect') {
            if (plan.session.tab && Hud.setCampaignTab) Hud.setCampaignTab(plan.session.tab, true);
            this.goLevelSelect();
            const sc = Hud.el && Hud.el.levels && Hud.el.levels.querySelector('.ls-scroll');
            if (sc && plan.session.scroll) sc.scrollTop = plan.session.scroll;
          }
        } finally { this._histResuming = false; }
      });
    }
    sessionSoon();
    return out;
  };

  // ------------------------------------------------------------ DOM: history screen, buttons, settings
  const origHudInit = Hud.init;
  Hud.init = function () {
    const out = origHudInit.apply(this, arguments);
    safe(() => buildUI(this));
    return out;
  };
  function buildUI(hud) {
    const ui = hud.root || document.getElementById('ui');
    if (!ui) return;
    // title: Resume + History
    const tb = hud.el.title && hud.el.title.querySelector('.title-buttons');
    if (tb) {
      const b = el('<button class="btn btn-glass btn-xl hist-resume" data-hist="resume" hidden>' + icon('restart') + '<span class="lbl">Resume</span></button>');
      b.addEventListener('click', e => { e.stopPropagation(); sfx('click'); Game.resumeSession(); });
      tb.insertBefore(b, tb.firstChild ? tb.firstChild.nextSibling : null);
    }
    const tm = hud.el.title && hud.el.title.querySelector('.title-meta');
    if (tm) tm.insertBefore(histButton('btn-glass'), tm.lastElementChild);
    const lr = hud.el.levels && hud.el.levels.querySelector('.ls-right');
    if (lr) lr.insertBefore(histButton('btn-ghost'), lr.lastElementChild);

    // history overlay
    const ov = el(`<div id="history" class="modal hist-modal" role="dialog" aria-modal="true" aria-label="History">
        <div class="modal-card glass hist-card">
          <div class="modal-head"><h3>${icon('clock')}History</h3><button class="btn btn-icon btn-ghost" data-hact="close" title="Close (Esc)">${icon('close')}</button></div>
          <div class="hist-tabs" role="tablist">
            <button class="hist-tab" role="tab" data-htab="runs">Runs</button>
            <button class="hist-tab" role="tab" data-htab="levels">Levels</button>
            <button class="hist-tab" role="tab" data-htab="stats">Stats</button>
          </div>
          <div class="hist-filters" data-href="filters">
            <label><span>Level</span><select data-hfilter="level"></select></label>
            <label><span>Result</span><select data-hfilter="result"><option value="all">All</option><option value="pass">Passed</option><option value="fail">Failed</option></select></label>
          </div>
          <div class="hist-body" data-href="body"></div>
        </div>
      </div>`);
    ui.appendChild(ov);
    hud.el.history = ov;
    ov.addEventListener('click', e => {
      if (e.target === ov) { closeHistory(); return; }
      const tab = e.target.closest('[data-htab]');
      if (tab) { sfx('click'); UI.tab = tab.dataset.htab; renderHistory(); return; }
      const a = e.target.closest('[data-hact]');
      if (!a) return;
      const act = a.dataset.hact;
      if (act === 'close') { sfx('click'); closeHistory(); }
      else if (act === 'load') { sfx('click'); loadFromHistory(a.dataset.k, +a.dataset.l); }
      else if (act === 'level') { sfx('click'); UI.tab = 'runs'; UI.level = a.dataset.l; renderHistory(); }
    });
    ov.addEventListener('change', e => {
      const f = e.target.closest('[data-hfilter]');
      if (!f) return;
      UI[f.dataset.hfilter] = f.value;
      renderHistory();
    });

    // settings: export / import
    const card = hud.el.settings && hud.el.settings.querySelector('.modal-card');
    const foot = card && card.querySelector('.modal-foot');
    if (card) {
      const row = el(`<div class="set-row hist-save"><span>${icon('coin')}Save data</span>
          <div class="hist-save-btns">
            <button class="btn btn-glass sm" data-hsave="export" title="Download your progress as a file">Export</button>
            <button class="btn btn-glass sm" data-hsave="import" title="Load progress from a file">Import</button>
            <input type="file" accept=".json,application/json" data-hsave="file" hidden>
          </div></div>`);
      card.insertBefore(row, foot || null);
      const file = row.querySelector('[data-hsave=file]');
      row.addEventListener('click', e => {
        const b = e.target.closest('button[data-hsave]');
        if (!b) return;
        e.preventDefault();
        sfx('click');
        if (b.dataset.hsave === 'export') downloadSave();
        else file.click();
      });
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (f) readImport(f);
      });
    }
    safe(() => hud.refreshTitle && hud.refreshTitle());
  }
  function histButton(cls) {
    const b = el('<button class="btn btn-icon ' + cls + ' hist-open" data-hist="open" title="History & stats">' + icon('clock') + '</button>');
    b.addEventListener('click', e => { e.stopPropagation(); sfx('click'); openHistory(); });
    return b;
  }

  function openHistory(tab) {
    const ov = Hud.el.history;
    if (!ov) return;
    if (tab) UI.tab = tab;
    renderHistory();
    ov.classList.add('show');
    UI.open = true;
  }
  function closeHistory() {
    const ov = Hud.el.history;
    if (ov) ov.classList.remove('show');
    UI.open = false;
  }
  BG.History.open = openHistory;
  BG.History.close = closeHistory;
  BG.History.isOpen = () => UI.open;
  // Esc closes the overlay; other keys must not reach the game while it is open
  root.addEventListener('keydown', e => {
    if (!UI.open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeHistory(); }
    const tag = e.target && e.target.tagName;
    if (tag !== 'SELECT') e.stopImmediatePropagation();
  }, true);

  function renderHistory() {
    const ov = Hud.el.history;
    if (!ov) return;
    ov.querySelectorAll('[data-htab]').forEach(b => { const on = b.dataset.htab === UI.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    const runs = H.getRuns();
    const bests = H.getBests();
    const played = Object.keys(bests).map(Number).filter(id => findLevel(id)).sort((a, b) => a - b);
    const filters = ov.querySelector('[data-href=filters]');
    filters.hidden = UI.tab !== 'runs';
    const sel = ov.querySelector('[data-hfilter=level]');
    sel.innerHTML = '<option value="all">All levels</option>' + played.map(id => '<option value="' + id + '">' + esc(lvLabel(id) + ' · ' + lvName(id)) + '</option>').join('');
    if (UI.level !== 'all' && played.indexOf(+UI.level) < 0) UI.level = 'all';
    sel.value = String(UI.level);
    ov.querySelector('[data-hfilter=result]').value = UI.result;
    const body = ov.querySelector('[data-href=body]');
    if (UI.tab === 'stats') body.innerHTML = statsHtml();
    else if (UI.tab === 'levels') body.innerHTML = levelsHtml(played, bests, runs);
    else body.innerHTML = runsHtml(runs);
  }
  function runsHtml(runs) {
    let list = runs.slice();
    let head = '';
    if (UI.level !== 'all') {
      const id = +UI.level;
      list = list.filter(r => r.l === id);
      const lv = findLevel(id);
      head = '<div class="hist-lvhead">' + sparkline(list, lv ? lv.budget : null, 260, 48) +
        '<div class="hist-lvmeta"><b>' + esc(lvLabel(id)) + '</b> ' + esc(lvName(id)) + '<br><small>' + esc(tileTip(id)) + '</small></div></div>';
    }
    if (UI.result === 'pass') list = list.filter(r => r.ok);
    else if (UI.result === 'fail') list = list.filter(r => !r.ok);
    list = list.slice(-150).reverse();
    if (!list.length) return head + '<p class="hist-empty">No test runs yet. Build a bridge and press Test — every run is recorded here.</p>';
    const rows = list.map(r => {
      const res = r.ok ? '<span class="hr-ok">' + stars(r.s) + '</span>' : '<span class="hr-bad">' + esc(reasonText(r.f)) + '</span>';
      const load = r.k ? '<button class="btn btn-glass sm" data-hact="load" data-k="' + esc(r.k) + '" data-l="' + r.l + '" title="Open this design in the editor">Load</button>' : '';
      return '<li class="hist-run ' + (r.ok ? 'ok' : 'bad') + '">' +
        '<div class="hr-lv"><b>' + esc(String(r.l)) + '</b><span>' + esc(lvName(r.l)) + '</span></div>' +
        '<div class="hr-res">' + res + '<small>' + esc(ago(r.t)) + '</small></div>' +
        '<div class="hr-num"><b>' + money(r.c) + '</b><small>' + r.n + ' members' + (r.p != null ? ' · ' + Math.round(r.p * 100) + '%' : '') + '</small></div>' +
        '<div class="hr-act">' + load + '</div></li>';
    }).join('');
    return head + '<ul class="hist-runs">' + rows + '</ul>';
  }
  function levelsHtml(played, bests, runs) {
    if (!played.length) return '<p class="hist-empty">Levels you test will show here with your personal bests.</p>';
    return '<ul class="hist-levels">' + played.map(id => {
      const b = bests[String(id)] || {};
      const lr = runs.filter(r => r.l === id);
      const lv = findLevel(id);
      const bestK = b.cost && b.cost.k && H.hasSnapshot(b.cost.k) ? b.cost.k : null;
      return '<li class="hist-level">' +
        '<button class="hl-name" data-hact="level" data-l="' + id + '" title="Show the runs of this level"><b>' + id + '</b><span>' + esc(lvName(id)) + '</span></button>' +
        '<div class="hl-spark">' + sparkline(lr, lv ? lv.budget : null, 140, 30) + '</div>' +
        '<div class="hl-best">' + (b.cost ? '<b>' + money(b.cost.v) + '</b>' : '<b class="hs-dim">—</b>') + '<small>' + (b.stars ? '<span class="hr-ok">' + stars(b.stars.v) + '</span> · ' : '') + (b.runs | 0) + ' runs</small></div>' +
        '<div class="hr-act">' + (bestK ? '<button class="btn btn-glass sm" data-hact="load" data-k="' + bestK + '" data-l="' + id + '" title="Open your cheapest passing design">Load best</button>' : '') + '</div></li>';
    }).join('') + '</ul>';
  }
  function statsHtml() {
    const s = H.summary();
    const fav = s.favourite ? matName(s.favourite) : '—';
    const tiles = [
      ['Test runs', s.runs], ['Bridges that held', s.bridgesBuilt], ['Collapses', s.collapses], ['Beams placed', s.beamsPlaced],
      ['Budget spent', money(s.spent)], ['Favourite material', esc(fav)], ['Play time', fmtDur(s.playMs)], ['Levels passed', s.levelsPassed + ' / ' + s.levelsPlayed + ' played'],
    ];
    return '<div class="hist-stats">' + tiles.map(t => '<div class="hst"><small>' + t[0] + '</small><b>' + t[1] + '</b></div>').join('') + '</div>' +
      (s.since ? '<p class="hist-since">Since ' + esc(safe(() => new Date(s.since).toLocaleDateString(), '')) + ' · all data stays on this device (Settings → Export to move it)</p>' : '');
  }

  function loadFromHistory(k, levelId) {
    const d = H.loadSnapshot(k);
    if (!d) { toast('That design is no longer stored.', 'warn'); return; }
    closeHistory();
    if (!Game.level || Game.level.id !== levelId || Game.state !== 'edit') {
      if (Game.state === 'sim' || Game.state === 'results') safe(() => Game.backToEdit());
      if (!Game.level || Game.level.id !== levelId) { if (!Game.openLevel(levelId, { force: true })) return; }
    }
    const lv = Game.level;
    const clean = safe(() => Game._sanitize(lv, d), d) || d;
    const ed = Game.editor;
    quiet++;
    try {
      if (ed && typeof ed._begin === 'function' && typeof ed._restore === 'function' && typeof ed._commit === 'function') {
        ed._begin(); ed._restore(clean); ed._commit(); // one undo step back to the previous design
      } else safe(() => Game._replaceDesign(clean));
    } finally { quiet--; }
    lastMats = materialCounts(Game.getDesign());
    safe(() => Game._saveNow());
    toast('Design loaded from history — Ctrl+Z to undo', 'info');
  }

  function downloadSave() {
    safe(() => Game._saveNow && Game._saveNow());
    safe(snapshotSession);
    const str = H.exportString();
    const d = new Date();
    const name = 'span-save-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
    try {
      const blob = new Blob([str], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      toast('Save exported (' + Math.max(1, Math.round(str.length / 1024)) + ' KB).', 'good');
    } catch (e) { toast('Export is not supported in this browser.', 'warn'); }
  }
  function readImport(f) {
    if (f.size > 8 * 1024 * 1024) { toast('That file is too large to be a SPAN save.', 'warn'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      let o;
      try { o = JSON.parse(String(rd.result)); } catch (e) { toast('That file is not a SPAN save.', 'warn'); sfx('error'); return; }
      const pre = H.validateSave(o);
      if (!pre.ok) { toast(pre.error, 'warn'); sfx('error'); return; }
      // leave the level first so its design is not saved over the imported one
      safe(() => { if (Game.level) Game.goTitle(); });
      suppress = true;
      const res = H.importSave(o);
      if (!res.ok) { suppress = false; toast(res.error, 'warn'); sfx('error'); return; }
      toast('Save imported — reloading…', 'good');
      setTimeout(() => { try { root.location.reload(); } catch (e) { suppress = false; } }, 700);
    };
    rd.onerror = () => toast('Could not read that file.', 'warn');
    rd.readAsText(f);
  }
})(typeof window !== 'undefined' ? window : globalThis);
