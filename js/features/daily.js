// SPAN — Daily Challenge + Endless mode (BG.Daily). Feature module: plugs into BG.Game / BG.Hud /
// BG.Storage by wrapping a few of their public methods (see "integration" below), so the shared
// files stay untouched. Levels come from BG.Generator (js/core/generator.js).
//
//   Daily:   one generated crossing per calendar day (seed = YYYYMMDD, identical in every browser),
//            weekday difficulty curve (Mon easy -> Sun hard). Best result per day, streak and history
//            are kept in BG.Storage ('daily'); results show a share card (emoji grid) for the clipboard.
//   Endless: random seeds with rising difficulty; run score + best run in BG.Storage ('endless').
//
// Records/streak/share helpers have no DOM dependency (Node-testable: tools/test-daily.js).
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const SKEY = 'daily', EKEY = 'endless', CKEY = 'dailyCache', ECKEY = 'endlessCache';
  const HISTORY_DAYS = 14;
  const EPOCH = 20260101; // "SPAN Daily #1"

  function stor() { return BG.Storage || null; }
  function gen() { return BG.Generator || null; }
  function sget(k, d) { const S = stor(); try { return S ? S.get(k, d) : d; } catch (e) { return d; } }
  function sset(k, v) { const S = stor(); try { if (S) S.set(k, v); } catch (e) { /* ignore */ } }
  function safe(fn, fb) { try { return fn(); } catch (e) { if (root.console) console.error(e); return fb; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function money(n) { return BG.Hud && BG.Hud.money ? BG.Hud.money(n) : '$' + Math.round(n); }
  function sfx(name, o) { try { BG.Audio && BG.Audio.play(name, o); } catch (e) { /* */ } }

  function isGenId(id) { return typeof id === 'string' && /^(daily|endless)-/.test(id); }
  function isGenLevel(lv) { return !!(lv && isGenId(lv.id)); }
  function modeOf(lv) { return lv && typeof lv.id === 'string' ? (lv.id.indexOf('daily-') === 0 ? 'daily' : lv.id.indexOf('endless-') === 0 ? 'endless' : null) : null; }
  function seedOfDaily(lv) { return lv && typeof lv.id === 'string' ? +lv.id.slice(6) : null; }
  function gapOf(lv) { const t = (lv && lv.terrain) || {}; return Math.round((t.rightEdge || 0) - (t.leftEdge || 0)); }
  function trafficText(lv) { return BG.Model && BG.Model.trafficSummary ? BG.Model.trafficSummary(lv).text : ''; }

  // ================================================================== records (no DOM)
  function loadDays() {
    const d = sget(SKEY, null);
    if (!d || typeof d !== 'object' || !d.days || typeof d.days !== 'object') return { days: {}, bestStreak: 0 };
    return d;
  }
  function better(a, b) { return (a.stars | 0) > (b.stars | 0) || ((a.stars | 0) === (b.stars | 0) && a.cost < b.cost); }
  function todaySeed() { return Daily._today || gen().dailySeed(new Date()); }

  /** res: {passed, stars, cost, members}. Only a result on the day itself counts for the streak;
   *  playing a past daily later is practice (kept separately). */
  function recordDaily(seed, level, res, today) {
    const all = loadDays();
    const onTime = seed === (today || todaySeed());
    const e = all.days[seed] || { name: level.name, budget: level.budget, gap: gapOf(level), difficulty: level.generator ? level.generator.difficulty : null, attempts: 0, passed: false, stars: 0, cost: null, members: null };
    e.attempts = (e.attempts | 0) + 1;
    e.budget = level.budget; e.name = level.name;
    let improved = false;
    if (res && res.passed) {
      const cand = { stars: res.stars | 0, cost: res.cost, members: res.members | 0 };
      if (onTime) {
        if (!e.passed || better(cand, e)) { e.stars = cand.stars; e.cost = cand.cost; e.members = cand.members; improved = true; }
        e.passed = true;
      } else if (!e.practice || better(cand, e.practice)) { e.practice = cand; improved = true; }
    }
    all.days[seed] = e;
    const st = streakInfo(all, today || todaySeed());
    all.bestStreak = Math.max(all.bestStreak | 0, st.current);
    // keep a bit over a year of history
    const keys = Object.keys(all.days).map(Number).sort((a, b) => a - b);
    while (keys.length > 400) delete all.days[keys.shift()];
    sset(SKEY, all);
    const best = e.passed ? e : (e.practice || null);
    return { entry: { completed: !!best, stars: best ? best.stars : 0, bestCost: best ? best.cost : null, attempts: e.attempts }, improved };
  }

  function streakInfo(all, today) {
    const G = gen();
    all = all || loadDays();
    const passed = s => !!(all.days[s] && all.days[s].passed);
    let s = today, cur = 0;
    if (!passed(s)) s = G.addDays(s, -1);
    while (passed(s)) { cur++; s = G.addDays(s, -1); }
    return { current: cur, best: Math.max(all.bestStreak | 0, cur), today: passed(today) };
  }

  function history(today, n) {
    const G = gen(), all = loadDays(), out = [];
    for (let k = (n || HISTORY_DAYS) - 1; k >= 0; k--) { const s = G.addDays(today, -k); out.push({ seed: s, entry: all.days[s] || null }); }
    return out;
  }

  function shareText(seed, level, entry, streak) {
    const G = gen();
    const pct = Math.round((entry.cost / (entry.budget || level.budget)) * 100);
    const stars = '★'.repeat(entry.stars | 0) + '☆'.repeat(3 - (entry.stars | 0));
    const filled = Math.max(1, Math.min(10, Math.ceil(pct / 10)));
    let grid = '';
    for (let i = 0; i < 10; i++) grid += i >= filled ? '⬜' : i < 7 ? '🟩' : i === 7 ? '🟨' : i === 8 ? '🟧' : '🟥';
    const no = G.dayNumber(seed) - G.dayNumber(EPOCH) + 1;
    const lines = [
      'SPAN Daily #' + no + ' · ' + G.dateLabel(seed),
      '🌉 ' + level.name + ' · ' + gapOf(level) + ' m',
      stars + ' · ' + pct + '% of budget · ' + (entry.members | 0) + ' members',
      grid,
    ];
    if (streak && streak.current > 0) lines.push('🔥 ' + streak.current + '-day streak');
    return lines.join('\n');
  }

  // ---- endless
  function loadEndless() {
    const e = sget(EKEY, null);
    if (!e || typeof e !== 'object') return { best: { cleared: 0, stars: 0 }, run: null, runs: 0 };
    e.best = e.best || { cleared: 0, stars: 0 };
    return e;
  }
  function recordEndless(index, res) {
    const e = loadEndless();
    const run = e.run;
    let improved = false;
    if (run && res && res.passed) {
      run.starsBy = run.starsBy || {};
      const prev = run.starsBy[index];
      if (prev == null || (res.stars | 0) > prev) { run.starsBy[index] = res.stars | 0; improved = true; }
      run.cleared = Object.keys(run.starsBy).length;
      run.stars = Object.keys(run.starsBy).reduce((a, k) => a + run.starsBy[k], 0);
      if (run.cleared > e.best.cleared || (run.cleared === e.best.cleared && run.stars > e.best.stars)) e.best = { cleared: run.cleared, stars: run.stars };
    }
    sset(EKEY, e);
    const st = run && run.starsBy ? run.starsBy[index] : null;
    return { entry: { completed: st != null, stars: st || 0, bestCost: null, attempts: 0 }, improved };
  }

  // ================================================================== generation (cached, time-sliced)
  const jobs = {};
  let pumping = false;
  function cachedDaily(seed) {
    const c = sget(CKEY, null), G = gen();
    if (c && c.v === G.VERSION && c.seed === seed && c.level && c.level.id === 'daily-' + seed) return c.level;
    return null;
  }
  function cachedEndless(runSeed, k) {
    const c = sget(ECKEY, null), G = gen();
    if (c && c.v === G.VERSION && c.run === runSeed && c.k === k && c.level) return c.level;
    return null;
  }
  /** request a level; cb(err, level). urgent jobs get big time slices (the player is waiting). */
  function request(key, seed, opts, urgent, cb, store) {
    let j = jobs[key];
    if (!j) {
      j = jobs[key] = { key, job: gen().createJob(seed, opts), cbs: [], urgent: false, store, t0: Date.now() };
    }
    if (urgent) j.urgent = true;
    if (cb) j.cbs.push(cb);
    pump();
    return j;
  }
  function pump() {
    if (pumping) return;
    pumping = true;
    const tick = () => {
      const keys = Object.keys(jobs);
      if (!keys.length) { pumping = false; Daily._updateLoader(); return; }
      for (const k of keys) {
        const j = jobs[k];
        const fin = j.job.step(j.urgent ? 80 : 6); // urgent: the player is waiting (CSS spinner keeps turning)
        if (fin) {
          delete jobs[k];
          if (!j.job.error && j.store) safe(() => j.store(j.job.level));
          j.ms = Date.now() - j.t0;
          Daily.lastGenMs = j.ms;
          j.cbs.forEach(cb => safe(() => cb(j.job.error, j.job.level)));
        }
      }
      Daily._updateLoader();
      if (typeof root.requestAnimationFrame === 'function' && !(root.document && root.document.hidden)) root.requestAnimationFrame(tick);
      else setTimeout(tick, 0);
    };
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(tick); else setTimeout(tick, 0);
  }
  function getDaily(seed, urgent, cb) {
    const lv = cachedDaily(seed);
    if (lv) { cb(null, lv); return; }
    const G = gen();
    request('daily-' + seed, seed, G.dailyOpts(seed), urgent, cb, level => { if (seed === todaySeed()) sset(CKEY, { v: G.VERSION, seed, level }); });
  }
  function getEndless(runSeed, k, urgent, cb) {
    const lv = cachedEndless(runSeed, k);
    if (lv) { cb(null, lv); return; }
    const G = gen();
    request('endless-' + runSeed + '-' + k, G.endlessSeed(runSeed, k), G.endlessOpts(runSeed, k), urgent, cb, level => sset(ECKEY, { v: G.VERSION, run: runSeed, k, level }));
  }

  // ================================================================== the feature object
  const Daily = {
    level: null,         // generated level currently open (or about to be)
    lastGenMs: null,
    _today: null,        // test override (YYYYMMDD)
    isGenLevel, isGenId, recordDaily, recordEndless, streakInfo, history, shareText, loadDays, loadEndless, todaySeed,
    getDaily, getEndless, cachedDaily,

    // ---------------------------------------------------------------- play
    playDaily(seed) {
      seed = seed || todaySeed();
      this._showLoader('Surveying ' + gen().dateLabel(seed) + '…');
      getDaily(seed, true, (err, lv) => {
        this._hideLoader();
        if (err || !lv) { this._toast('Could not generate this crossing.', 'warn'); return; }
        this._open(lv);
      });
    },
    startEndless(fresh) {
      const e = loadEndless();
      if (fresh || !e.run) {
        // previous run's in-progress design is no longer needed
        if (e.run) safe(() => stor() && stor().clearDesign('endless-' + e.run.seed + '-' + e.run.index));
        e.run = { seed: ((Date.now() % 2147483629) ^ 0x5bd1e995) >>> 0, index: 0, cleared: 0, stars: 0, starsBy: {} };
        e.runs = (e.runs | 0) + 1;
        sset(EKEY, e);
      }
      this._playEndless(e.run);
    },
    _playEndless(run) {
      this._showLoader('Finding crossing ' + (run.index + 1) + '…');
      getEndless(run.seed, run.index, true, (err, lv) => {
        this._hideLoader();
        if (err || !lv) { this._toast('Could not generate this crossing.', 'warn'); return; }
        this._open(lv);
      });
    },
    nextEndless() {
      const e = loadEndless();
      if (!e.run) { this.startEndless(true); return; }
      const prevId = 'endless-' + e.run.seed + '-' + e.run.index;
      e.run.index++;
      sset(EKEY, e);
      safe(() => stor() && stor().clearDesign(prevId));
      this._playEndless(e.run);
    },
    _open(lv) {
      this.level = lv;
      this.closePanel();
      const g = BG.Game;
      if (g && g.openLevel) g.openLevel(lv.id, { force: true });
    },

    // ---------------------------------------------------------------- integration with BG.Game / BG.Hud / BG.Storage
    install() {
      if (this._installed) return;
      this._installed = true;
      const D = this, Game = BG.Game, Hud = BG.Hud, S = BG.Storage;
      if (Game) {
        // generated levels are not in BG.Levels: resolve them here
        const findLevel = Game.findLevel;
        Game.findLevel = function (id) {
          if (D.level && id === D.level.id) return D.level;
          return findLevel.apply(this, arguments);
        };
        // after a daily: back to the daily panel; endless: on to the next crossing
        const nextLevel = Game.nextLevel;
        Game.nextLevel = function () {
          const m = modeOf(this.level);
          if (m === 'endless') { D.nextEndless(); return; }
          if (m === 'daily') { this.goTitle(); D.openPanel(); return; }
          return nextLevel.apply(this, arguments);
        };
        // leaving a generated level returns to the title + daily panel (not the level grid)
        const goLevelSelect = Game.goLevelSelect;
        Game.goLevelSelect = function () {
          if (isGenLevel(this.level)) { this.goTitle(); D.openPanel(); return; }
          return goLevelSelect.apply(this, arguments);
        };
        const resetProgress = Game.resetProgress;
        Game.resetProgress = function () {
          const r = resetProgress.apply(this, arguments);
          safe(() => { if (stor()) { stor().remove(SKEY); stor().remove(EKEY); } });
          safe(() => Hud && Hud.refreshTitle && Hud.refreshTitle());
          return r;
        };
        const init = Game.init;
        Game.init = function () {
          const r = init.apply(this, arguments);
          safe(() => D._afterInit());
          return r;
        };
      }
      if (S) {
        // daily / endless results go to their own records, never into the campaign progress
        const recordResult = S.recordResult;
        S.recordResult = function (id, result) {
          if (isGenId(id)) {
            const lv = D.level && D.level.id === id ? D.level : null;
            const members = safe(() => BG.Game.getDesign().beams.length, 0);
            const res = Object.assign({}, result, { members });
            if (id.indexOf('daily-') === 0 && lv) return recordDaily(+id.slice(6), lv, res);
            if (id.indexOf('endless-') === 0) return recordEndless(+id.split('-')[2], res);
            return { entry: null, improved: false };
          }
          return recordResult.apply(this, arguments);
        };
        const setLastLevel = S.setLastLevel;
        S.setLastLevel = function (id) { if (isGenId(id)) return; return setLastLevel.apply(this, arguments); };
      }
      if (Hud) {
        const hinit = Hud.init;
        Hud.init = function () { const r = hinit.apply(this, arguments); safe(() => D._buildUi()); return r; };
        const refreshTitle = Hud.refreshTitle;
        Hud.refreshTitle = function () { const r = refreshTitle.apply(this, arguments); safe(() => D._refreshTitleBtn()); return r; };
        const enterLevel = Hud.enterLevel;
        Hud.enterLevel = function (level) { const r = enterLevel.apply(this, arguments); safe(() => D._decorateLevelHud(level)); return r; };
        const showResults = Hud.showResults;
        Hud.showResults = function (res) { const r = showResults.apply(this, arguments); safe(() => D._decorateResults(res)); return r; };
      }
    },

    _afterInit() {
      // prune saved designs of old dailies (the daily record itself is kept)
      const G = gen();
      let params = null;
      try { params = new URLSearchParams(root.location.search); } catch (e) { /* */ }
      const all = loadDays(), today = todaySeed();
      Object.keys(all.days).forEach(k => { if (+k < G.addDays(today, -7)) safe(() => stor() && stor().clearDesign('daily-' + k)); });
      // test helpers: ?today=YYYYMMDD pretends it is that day; ?daily[=YYYYMMDD] plays a daily; ?endless
      if (params && params.has('today') && G.isDateSeed(+params.get('today'))) this._today = +params.get('today');
      if (params && params.has('daily')) {
        const v = params.get('daily');
        this.playDaily(v && G.isDateSeed(+v) ? +v : todaySeed());
      } else if (params && params.has('endless')) this.startEndless(false);
      else {
        // warm up today's crossing quietly while the title screen plays
        setTimeout(() => { if (!cachedDaily(todaySeed())) getDaily(todaySeed(), false, () => this._refreshTitleBtn()); }, 1500);
      }
      this._refreshTitleBtn();
    },

    // ================================================================== DOM
    _buildUi() {
      const doc = root.document;
      if (!doc) return;
      const ui = doc.getElementById('ui') || doc.body;
      // title button
      const wrap = doc.querySelector('#screen-title .title-buttons');
      if (wrap && !wrap.querySelector('.dly-title-btn')) {
        const b = doc.createElement('button');
        b.className = 'btn btn-glass btn-xl dly-title-btn';
        b.dataset.dly = 'open';
        b.innerHTML = CAL_ICON + '<span class="dly-btn-txt"><b>Daily Challenge</b><small data-dref="titleSub"></small></span>';
        b.addEventListener('click', e => { e.stopPropagation(); sfx('click'); this.openPanel(); setTimeout(() => b.blur(), 0); });
        wrap.appendChild(b);
        this._titleBtn = b;
      }
      // panel
      const p = doc.createElement('div');
      p.id = 'daily-panel';
      p.className = 'modal dly-modal';
      p.innerHTML = `
        <div class="modal-card glass dly-card" role="dialog" aria-label="Daily Challenge">
          <div class="modal-head"><h3>${CAL_ICON}Daily Challenge</h3><button class="btn btn-icon btn-ghost" data-dly="close" title="Close (Esc)">${CLOSE_ICON}</button></div>
          <div class="dly-hero">
            <div class="dly-thumb" data-dref="thumb"></div>
            <div class="dly-info">
              <div class="dly-date" data-dref="date"></div>
              <div class="dly-name" data-dref="name">Surveying…</div>
              <div class="dly-meta" data-dref="meta"></div>
              <div class="dly-week" data-dref="week"></div>
            </div>
          </div>
          <div class="dly-stats" data-dref="stats"></div>
          <div class="dly-hist" data-dref="hist"></div>
          <div class="dly-actions">
            <button class="btn btn-primary" data-dly="play">${PLAY_ICON}<span>Play today's crossing</span></button>
            <button class="btn btn-glass" data-dly="share" hidden>${SHARE_ICON}<span>Copy result</span></button>
          </div>
          <div class="dly-endless">
            <div class="dly-e-txt"><b>Endless</b><small data-dref="endless">Random crossings that keep getting harder.</small></div>
            <div class="dly-e-btns">
              <button class="btn btn-glass" data-dly="endlessContinue" hidden><span>Continue</span></button>
              <button class="btn btn-glass" data-dly="endlessNew"><span>New run</span></button>
            </div>
          </div>
        </div>`;
      p.addEventListener('click', e => {
        if (e.target === p) { this.closePanel(); return; }
        const b = e.target.closest('[data-dly]');
        if (!b) return;
        const act = b.dataset.dly;
        sfx('click');
        if (act === 'close') this.closePanel();
        else if (act === 'play') this.playDaily(this._panelSeed || todaySeed());
        else if (act === 'share') this.copyShare(this._panelSeed || todaySeed(), b);
        else if (act === 'endlessNew') this.startEndless(true);
        else if (act === 'endlessContinue') this.startEndless(false);
        else if (act === 'day') { this._panelSeed = +b.dataset.seed; this._renderPanel(); }
        setTimeout(() => b.blur && b.blur(), 0);
      });
      ui.appendChild(p);
      this._panel = p;
      // loader
      const l = doc.createElement('div');
      l.className = 'dly-loading';
      l.innerHTML = '<div class="dly-loading-card glass"><div class="dly-spin"></div><b data-dref="lText">Surveying…</b><small data-dref="lSub">proving the crossing can be bridged</small><div class="dly-lbar"><span></span></div></div>';
      ui.appendChild(l);
      this._loader = l;
      // keys: the panel / loader own the keyboard while open (capture, before BG.Game's handler)
      root.addEventListener('keydown', e => {
        if (this._loaderOn) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        if (!this.panelOpen()) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.closePanel(); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); this.playDaily(this._panelSeed || todaySeed()); }
        else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
    },
    _ref(name, el) { return (el || this._panel).querySelector('[data-dref=' + name + ']'); },

    panelOpen() { return !!(this._panel && this._panel.classList.contains('show')); },
    openPanel(seed) {
      if (!this._panel) return;
      this._panelSeed = seed || todaySeed();
      this._panel.classList.add('show');
      this._renderPanel();
    },
    closePanel() { if (this._panel) this._panel.classList.remove('show'); },

    _renderPanel() {
      const G = gen(), p = this._panel;
      if (!p) return;
      const today = todaySeed();
      const seed = this._panelSeed || today;
      const isToday = seed === today;
      const all = loadDays();
      const e = all.days[seed] || null;
      const st = streakInfo(all, today);
      this._ref('date').textContent = (isToday ? 'Today · ' : 'Past daily · ') + G.dateLabel(seed);
      const wd = G.weekdayOf(seed);
      this._ref('week').innerHTML = G.WEEKDAYS.map((w, i) => '<span class="dly-wd' + (i === wd ? ' on' : '') + '" title="' + w + '">' + w[0] + '</span>').join('') + '<em>' + (DIFF_WORDS[wd] || '') + '</em>';
      const lv = cachedDaily(seed) || (this.level && this.level.id === 'daily-' + seed ? this.level : null);
      const fill = level => {
        this._ref('name').textContent = level.name;
        this._ref('meta').textContent = gapOf(level) + ' m gap · ' + trafficText(level) + ' · budget ' + money(level.budget);
        this._ref('thumb').innerHTML = thumbSvg(level);
      };
      if (lv) fill(lv);
      else {
        this._ref('name').textContent = 'Surveying…';
        this._ref('meta').textContent = 'Generating and proving today\'s crossing';
        this._ref('thumb').innerHTML = '';
        getDaily(seed, false, (err, level) => { if (!err && level && this.panelOpen() && (this._panelSeed || todaySeed()) === seed) fill(level); });
      }
      const best = e && e.passed ? e : (e && e.practice ? Object.assign({ practice: true, budget: e.budget }, e.practice) : null);
      const todayTxt = best ? starsHtml(best.stars) + '<b>' + Math.round(best.cost / (best.budget || e.budget) * 100) + '%</b>' + (best.practice ? '<i>practice</i>' : '') : (e ? '<b>' + e.attempts + '</b> attempt' + (e.attempts === 1 ? '' : 's') : '<b>—</b>');
      this._ref('stats').innerHTML =
        '<div class="dly-stat"><span>' + (isToday ? 'Today' : 'Best') + '</span><div>' + todayTxt + '</div></div>' +
        '<div class="dly-stat"><span>Streak</span><div><b>🔥 ' + st.current + '</b></div></div>' +
        '<div class="dly-stat"><span>Best streak</span><div><b>' + st.best + '</b></div></div>';
      this._ref('hist').innerHTML = history(today, HISTORY_DAYS).map(h => {
        const en = h.entry;
        const cls = en && en.passed ? 's' + en.stars : en && en.practice ? 'pr' : en ? 'tried' : 'none';
        const d = h.seed % 100;
        const label = G.dateLabel(h.seed) + (en && en.passed ? ' — ' + '★'.repeat(en.stars) + ' ' + Math.round(en.cost / en.budget * 100) + '%' : en && en.practice ? ' — practice' : en ? ' — not crossed' : '');
        return '<button class="dly-day ' + cls + (h.seed === seed ? ' sel' : '') + (h.seed === today ? ' today' : '') + '" data-dly="day" data-seed="' + h.seed + '" title="' + esc(label) + '"><i>' + G.WEEKDAYS[G.weekdayOf(h.seed)][0] + '</i><b>' + d + '</b><s>' + (en && en.passed ? '★'.repeat(en.stars) : '') + '</s></button>';
      }).join('');
      $q('[data-dly=play] span', p).textContent = isToday ? (e && e.passed ? 'Improve today\'s bridge' : 'Play today\'s crossing') : 'Play as practice';
      $q('[data-dly=share]', p).hidden = !(e && e.passed);
      // endless
      const en = loadEndless();
      const run = en.run;
      this._ref('endless').textContent = (run ? 'Current run: crossing ' + (run.index + 1) + ' · ' + (run.cleared | 0) + ' cleared · ★' + (run.stars | 0) + '. ' : 'Random crossings that keep getting harder. ') + 'Best: ' + (en.best.cleared | 0) + ' cleared · ★' + (en.best.stars | 0);
      $q('[data-dly=endlessContinue]', p).hidden = !run;
      $q('[data-dly=endlessContinue] span', p).textContent = run ? 'Continue · #' + (run.index + 1) : 'Continue';
    },

    _refreshTitleBtn() {
      const b = this._titleBtn;
      if (!b || !gen()) return;
      const today = todaySeed(), G = gen();
      const all = loadDays(), st = streakInfo(all, today), e = all.days[today];
      const parts = [G.dateLabel(today).replace(/ \d{4}$/, '')];
      if (e && e.passed) parts.push('★'.repeat(e.stars));
      if (st.current) parts.push('🔥 ' + st.current);
      const sub = b.querySelector('[data-dref=titleSub]');
      if (sub) sub.textContent = parts.join(' · ');
      b.classList.toggle('done', !!(e && e.passed));
    },

    _decorateLevelHud(level) {
      const H = BG.Hud, el = H && H.el && H.el.level;
      if (!el) return;
      const k = el.querySelector('.lvl-k');
      if (k && this._origK == null) this._origK = k.textContent;
      const m = modeOf(level);
      root.document.body.classList.toggle('dly-mode', !!m);
      if (!m) { if (k && this._kChanged) { k.textContent = this._origK; this._kChanged = false; } return; }
      const G = gen(), g = level.generator || {};
      if (k) { k.textContent = m === 'daily' ? 'DAILY' : 'ENDLESS'; this._kChanged = true; }
      if (H.el.lvlNum) H.el.lvlNum.textContent = m === 'daily' ? String(seedOfDaily(level) % 100) : String((g.index | 0) + 1);
      if (H.el.lvlSub) {
        const head = m === 'daily' ? G.dateLabel(seedOfDaily(level)) : 'Crossing ' + ((g.index | 0) + 1);
        H.el.lvlSub.textContent = [head, gapOf(level) + ' m gap', level.timeLimit ? level.timeLimit + ' s limit' : null].filter(Boolean).join(' · ');
      }
    },

    _decorateResults(res) {
      const H = BG.Hud, el = H && H.el && H.el.results;
      if (!el) return;
      const card = el.querySelector('.results-card');
      const old = card && card.querySelector('.dly-res');
      if (old) old.remove();
      const lv = BG.Game && BG.Game.level;
      const m = modeOf(lv);
      el.classList.toggle('dly-results', !!m);
      if (!m || !card) return;
      const nb = el.querySelector('[data-act=next] span');
      if (nb) nb.textContent = m === 'daily' ? 'Daily menu' : 'Next crossing';
      const box = root.document.createElement('div');
      box.className = 'dly-res';
      if (m === 'daily') {
        const seed = seedOfDaily(lv);
        const all = loadDays(), e = all.days[seed];
        if (res.passed && H.el.resBanner) H.el.resBanner.textContent = res.improved ? 'Daily · new best' : 'Daily complete';
        if (e && e.passed) {
          const txt = shareText(seed, lv, e, streakInfo(all, todaySeed()));
          box.innerHTML = '<div class="dly-res-head"><span>Today\'s best</span>' + starsHtml(e.stars) + '<b>' + Math.round(e.cost / e.budget * 100) + '% of budget</b></div>' +
            '<pre class="dly-share-text">' + esc(txt) + '</pre>' +
            '<button class="btn btn-glass" data-dly-res="copy">' + SHARE_ICON + '<span>Copy result</span></button>';
        } else if (e && e.practice) {
          box.innerHTML = '<div class="dly-res-head"><span>Practice best</span>' + starsHtml(e.practice.stars) + '<b>' + Math.round(e.practice.cost / e.budget * 100) + '% of budget</b></div>';
        } else {
          box.innerHTML = '<div class="dly-res-head"><span>' + gen().dateLabel(seed) + '</span><b>' + (e ? e.attempts : 1) + ' attempt' + (e && e.attempts !== 1 ? 's' : '') + ' today</b></div>';
        }
      } else {
        const en = loadEndless(), run = en.run || { cleared: 0, stars: 0, index: 0 };
        if (res.passed && H.el.resBanner) H.el.resBanner.textContent = 'Crossing ' + ((run.index | 0) + 1) + ' cleared';
        box.innerHTML = '<div class="dly-res-head"><span>Endless run</span><b>' + (run.cleared | 0) + ' cleared · ★' + (run.stars | 0) + '</b><i>best ' + (en.best.cleared | 0) + ' · ★' + (en.best.stars | 0) + '</i></div>';
      }
      box.addEventListener('click', ev => {
        const b = ev.target.closest('[data-dly-res=copy]');
        if (b) { sfx('click'); this.copyShare(seedOfDaily(lv), b); }
      });
      const actions = card.querySelector('.res-actions');
      card.insertBefore(box, actions || null);
    },

    copyShare(seed, btn) {
      const all = loadDays(), e = all.days[seed];
      const lv = cachedDaily(seed) || (this.level && this.level.id === 'daily-' + seed ? this.level : null);
      if (!e || !e.passed || !lv) return false;
      const txt = shareText(seed, lv, e, streakInfo(all, todaySeed()));
      this.lastShare = txt;
      const done = ok => {
        this._toast(ok ? 'Result copied — paste it anywhere.' : 'Copy failed — select the text and copy it.', ok ? 'info' : 'warn');
        if (btn) { const s = btn.querySelector('span'); if (s) { const t = s.textContent; s.textContent = ok ? 'Copied!' : 'Copy failed'; setTimeout(() => { s.textContent = t; }, 1600); } }
      };
      const fallback = () => {
        let ok = false;
        safe(() => {
          const ta = root.document.createElement('textarea');
          ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          root.document.body.appendChild(ta); ta.select();
          ok = root.document.execCommand('copy');
          ta.remove();
        });
        done(ok);
      };
      const nav = root.navigator;
      if (nav && nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(txt).then(() => done(true), fallback);
      else fallback();
      return txt;
    },

    _toast(msg, kind) { if (BG.Hud && BG.Hud.toast) BG.Hud.toast(msg, kind || 'info'); },
    _showLoader(text) {
      this._loaderOn = true;
      this._loaderSince = Date.now();
      if (!this._loader) return;
      this._ref('lText', this._loader).textContent = text || 'Surveying…';
      // cached levels resolve synchronously: only show the overlay if it takes a moment
      clearTimeout(this._loaderT);
      this._loaderT = setTimeout(() => { if (this._loaderOn) this._loader.classList.add('show'); }, 120);
    },
    _hideLoader() {
      this._loaderOn = false;
      clearTimeout(this._loaderT);
      if (this._loader) this._loader.classList.remove('show');
    },
    _updateLoader() {
      if (!this._loader || !this._loaderOn) return;
      let sims = 0;
      Object.keys(jobs).forEach(k => { if (jobs[k].urgent) sims = jobs[k].job.progress.sims; });
      this._ref('lSub', this._loader).textContent = sims ? 'test-driving candidate bridge ' + (sims + 1) + '…' : 'proving the crossing can be bridged';
    },
  };

  function $q(sel, el) { return el.querySelector(sel); }
  function starsHtml(n) { let s = '<span class="dly-stars">'; for (let i = 0; i < 3; i++) s += '<i class="' + (i < (n | 0) ? 'on' : '') + '">★</i>'; return s + '</span>'; }
  const DIFF_WORDS = ['Gentle', 'Easy', 'Steady', 'Tricky', 'Hard', 'Tough', 'Brutal'];
  const CAL_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8.5 14.5l2.2 2.2 4.8-4.8"/></svg>';
  const CLOSE_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const PLAY_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5l12.5 7.5L7 19.5z" fill="currentColor"/></svg>';
  const SHARE_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/></svg>';

  // small side-view of the crossing
  function thumbSvg(lv) {
    const t = lv.terrain, gap = gapOf(lv);
    const ba = lv.buildArea || { y1: 8 };
    const x0 = -gap * 0.18, x1 = gap * 1.18, yTop = Math.max(ba.y1, 2) + 1, yBot = t.floorY - 1.5;
    const W = 120, Hh = 68, sx = W / (x1 - x0), sy = Hh / (yTop - yBot);
    const X = x => ((x - x0) * sx).toFixed(1), Y = y => ((yTop - y) * sy).toFixed(1);
    const th = (BG.Hud && BG.Hud.theme) ? BG.Hud.theme(lv.theme) : { sky: ['#8fd3f4', '#d8f3ff'], ground: '#5aa35a', deep: '#3d7a44', water: '#3d9bd6' };
    let s = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="none" aria-hidden="true">';
    s += '<defs><linearGradient id="dlySky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + th.sky[0] + '"/><stop offset="1" stop-color="' + th.sky[1] + '"/></linearGradient></defs>';
    s += '<rect width="' + W + '" height="' + Hh + '" fill="url(#dlySky)"/>';
    if (t.waterY != null) s += '<rect x="0" y="' + Y(t.waterY) + '" width="' + W + '" height="' + Hh + '" fill="' + th.water + '" opacity=".85"/>';
    (lv.noBuild || []).forEach(z => { s += '<rect x="' + X(z.x0) + '" y="' + Y(z.y1) + '" width="' + (sx * (z.x1 - z.x0)).toFixed(1) + '" height="' + (sy * (z.y1 - z.y0)).toFixed(1) + '" fill="rgba(255,80,80,.35)"/>'; });
    s += '<path d="M0 ' + Y(t.leftY) + 'H' + X(t.leftEdge) + 'V' + Y(t.floorY) + 'H' + X(t.rightEdge) + 'V' + Y(t.rightY) + 'H' + W + 'V' + Hh + 'H0Z" fill="' + th.ground + '"/>';
    (lv.pierZones || []).forEach(z => { s += '<rect x="' + X(z.x0) + '" y="' + (+Y(t.floorY) - 2) + '" width="' + (sx * (z.x1 - z.x0)).toFixed(1) + '" height="3" fill="#ffd25e"/>'; });
    (lv.anchors || []).forEach(a => { s += '<circle cx="' + X(a.x) + '" cy="' + Y(a.y) + '" r="2" fill="#fff" stroke="#333" stroke-width=".8"/>'; });
    s += '<path d="M' + X(t.leftEdge) + ' ' + Y(t.leftY) + 'L' + X(t.rightEdge) + ' ' + Y(t.rightY) + '" stroke="rgba(255,255,255,.75)" stroke-width="1.2" stroke-dasharray="3 2"/>';
    return s + '</svg>';
  }
  Daily.thumbSvg = thumbSvg;

  BG.Daily = Daily;
  // wire up now (before BG.Game boots on DOMContentLoaded)
  if (root.document && BG.Game) Daily.install();
})(typeof window !== 'undefined' ? window : globalThis);
