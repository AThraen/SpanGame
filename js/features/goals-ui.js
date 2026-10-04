// SPAN — Goals (badges) UI + persistence. Browser only; loaded after hud.js (index.html: after main.js, before boot).
// Integrates WITHOUT editing shared files: it wraps a few BG.Hud methods (enterLevel, update, showResults,
// buildLevelSelect, refreshTitle) and extends BG.Storage with badge persistence. Pure logic lives in goals.js.
//   BG.Storage.getBadges(levelId) -> [goalId]      BG.Storage.recordBadges(levelId, ids) -> [newly earned]
//   BG.Storage.totalBadges()      -> n             BG.Storage.maxBadges() -> n
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const doc = root.document;
  if (!doc || !BG.Goals || !BG.Hud || !BG.Storage) return;
  const Hud = BG.Hud, S = BG.Storage, G = BG.Goals;
  const ICON_DIR = 'assets/icons/badges/';

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function safe(fn, dflt) { try { return fn(); } catch (e) { console.error('[goals]', e); return dflt; } }
  function img(icon, cls) { return '<img class="gb-img ' + (cls || '') + '" src="' + ICON_DIR + icon + '.svg" alt="" draggable="false">'; }
  function sfx(name, o) { if (BG.Audio) safe(() => BG.Audio.play(name, o)); }

  // ---------------------------------------------------------------- storage (keyed by level id; campaigns 101-120 work too)
  const KEY = 'badges';
  function allBadges() { const b = S.get(KEY, {}); return b && typeof b === 'object' ? b : {}; }
  S.getBadges = function (id) { const a = allBadges()[id]; return Array.isArray(a) ? a.slice() : []; };
  S.recordBadges = function (id, ids) {
    const all = allBadges(), have = new Set(Array.isArray(all[id]) ? all[id] : []);
    const fresh = [];
    (ids || []).forEach(g => { if (!have.has(g)) { have.add(g); fresh.push(g); } });
    if (fresh.length) { all[id] = Array.from(have); S.set(KEY, all); }
    return fresh;
  };
  S.totalBadges = function () {
    const all = allBadges();
    let t = 0;
    for (const id in all) {
      const valid = new Set(G.forLevel(+id).map(g => g.type));
      t += (all[id] || []).filter(g => valid.has(g)).length;
    }
    return t;
  };
  S.maxBadges = function () {
    let t = 0;
    const ids = new Set(Object.keys(BG.GoalsData || {}).map(Number));
    (BG.Levels || []).forEach(l => ids.add(l.id));
    // hidden bonus levels (Forces of Nature, before they are revealed) do not count yet
    const hidden = new Set(BG.Hud && typeof BG.Hud.hiddenLevelIds === 'function' ? BG.Hud.hiddenLevelIds() : []);
    ids.forEach(id => { if (!hidden.has(id)) t += G.forLevel(id).length; });
    return t;
  };
  if (typeof S.resetProgress === 'function') {
    const reset = S.resetProgress;
    S.resetProgress = function () { S.remove(KEY); return reset.apply(this, arguments); };
  }

  // ---------------------------------------------------------------- helpers
  const game = () => BG.Game || null;
  function lvlId(level) { return level && level.id != null ? level.id : null; }
  function levelGoals(level) { return G.forLevel(level); }
  let lastRun = null;   // { sig, summary } most recent finished test of the current level

  function designSig(d) { try { return JSON.stringify([d.nodes, d.beams, d.piers]); } catch (e) { return ''; } }
  function currentEval() {
    const g = game(), lv = Hud.level;
    if (!g || !lv || !g.getDesign) return null;
    const design = g.getDesign();
    // run-based goals use the last finished test of exactly this design
    let sim = null;
    if (g.sim && g.sim.status && g.sim.status !== 'running' && g.sim.summary) sim = Object.assign(g.sim.summary(), { ride: g.sim.ride || null });
    else if (lastRun && lastRun.lvl === lv.id && lastRun.sig === designSig(design)) sim = lastRun.summary;
    return G.evaluate(lv, design, sim);
  }

  // ---------------------------------------------------------------- level HUD: Goals button + panel
  let btn = null, panel = null, panelOpen = false, lastSig = '', lastT = 0;
  function ensureHud() {
    const screen = Hud.el && Hud.el.level;
    if (!screen || panel) return;
    const top = screen.querySelector('.topbar');
    btn = doc.createElement('button');
    btn.className = 'btn btn-glass goals-btn';
    btn.type = 'button';
    btn.title = 'Goals — optional challenge badges';
    btn.innerHTML = img('minimalist', 'gb-mini') + '<span class="goals-count"><b>0</b>/0</span>';
    const gear = top.querySelector('[data-act=settings]');
    top.insertBefore(btn, gear);
    panel = doc.createElement('aside');
    panel.className = 'goals-panel glass';
    panel.setAttribute('aria-label', 'Level goals');
    screen.appendChild(panel);
    btn.addEventListener('click', () => { sfx('click'); setPanel(!panelOpen); });
    panel.addEventListener('click', e => { if (e.target.closest('[data-goals-close]')) { sfx('click'); setPanel(false); } });
    doc.addEventListener('keydown', e => {
      if (e.key !== 'g' && e.key !== 'G') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (Hud.screen !== 'level' || !levelGoals(Hud.level).length) return;
      const t = e.target; if (t && /input|textarea|select/i.test(t.tagName)) return;
      setPanel(!panelOpen);
    });
  }
  function setPanel(open, noSave) {
    panelOpen = open;
    if (panel) panel.classList.toggle('open', open);
    if (btn) btn.classList.toggle('on', open);
    if (!noSave) safe(() => S.set('goalsPanelOpen', open));
    lastSig = '';
    refreshPanel(true);
  }
  function refreshPanel(force) {
    if (!panel) return;
    const lv = Hud.level, goals = lv ? levelGoals(lv) : [];
    btn.hidden = !goals.length;
    if (!goals.length) { panel.classList.remove('open'); return; }
    panel.classList.toggle('open', panelOpen);
    const ev = currentEval();
    if (!ev) return;
    const stored = new Set(S.getBadges(lvlId(lv)));
    const sig = JSON.stringify([ev.goals.map(g => [g.met, g.candidate, g.text]), Array.from(stored), panelOpen]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const got = ev.goals.filter(g => stored.has(g.id)).length;
    btn.querySelector('.goals-count').innerHTML = '<b>' + got + '</b>/' + ev.goals.length;
    btn.classList.toggle('all', got === ev.goals.length);
    if (!panelOpen) return;
    panel.innerHTML = '<div class="gp-head"><b>Goals</b><span>' + got + ' / ' + ev.goals.length + ' badges</span>' +
      '<button class="btn btn-icon btn-ghost sm" data-goals-close title="Close (G)" aria-label="Close goals">&times;</button></div>' +
      '<p class="gp-sub">Optional challenges. Pass the level and meet the condition to earn the badge.</p>' +
      ev.goals.map(g => {
        const have = stored.has(g.id);
        const cls = have ? 'have' : g.candidate ? 'ontrack' : '';
        const pct = Math.round((g.frac == null ? 0 : g.frac) * 100);
        return '<div class="gp-row ' + cls + '" data-goal="' + esc(g.id) + '">' + img(g.icon, have ? '' : 'locked') +
          '<div class="gp-txt"><b>' + esc(g.name) + (have ? ' <i>earned</i>' : '') + '</b><span>' + esc(g.desc) + '</span>' +
          '<div class="gp-bar"><em style="width:' + (have ? 100 : pct) + '%"></em></div>' +
          '<small>' + esc(have && !g.candidate ? 'earned on an earlier run' : g.text) + '</small></div></div>';
      }).join('');
  }

  // ---------------------------------------------------------------- results modal reveal
  function renderResultBadges(res) {
    const card = Hud.el.results && Hud.el.results.querySelector('.results-card');
    if (!card) return;
    let box = card.querySelector('.res-badges');
    if (!box) {
      box = doc.createElement('div');
      box.className = 'res-badges';
      card.insertBefore(box, card.querySelector('.res-actions'));
    }
    const lv = game() && game().level;
    const goals = lv ? levelGoals(lv) : [];
    box.classList.remove('show');
    box.innerHTML = '';
    if (!lv || !goals.length || !res.passed) { box.hidden = true; return; }
    const g = game();
    const sum = g.sim && g.sim.summary ? Object.assign(g.sim.summary(), { ride: g.sim.ride || null }) : null;
    if (sum) lastRun = { lvl: lv.id, sig: designSig(g.getDesign()), summary: sum };
    const ev = G.evaluate(lv, g.getDesign(), sum);
    const fresh = res.passed ? S.recordBadges(lv.id, ev.earned) : [];
    const stored = new Set(S.getBadges(lv.id));
    res.badges = { earned: ev.earned, fresh: fresh };
    box.hidden = false;
    box.innerHTML = '<div class="rb-title"><span>Challenge badges</span><b>' + stored.size + ' / ' + goals.length + '</b></div><div class="rb-row">' +
      ev.goals.map(x => {
        const have = stored.has(x.id), isNew = fresh.indexOf(x.id) >= 0, now = x.met;
        const cls = (have ? 'have ' : 'miss ') + (isNew ? 'new ' : '') + (now ? 'now' : '');
        const note = isNew ? 'NEW' : now ? 'earned' : have ? 'earned before' : (res.passed ? esc(x.text) : 'pass to earn');
        return '<div class="rb ' + cls + '" data-goal="' + esc(x.id) + '" title="' + esc(x.desc) + '">' + img(x.icon, have ? '' : 'locked') +
          '<b>' + esc(x.name) + '</b><span>' + note + '</span></div>';
      }).join('') + '</div>';
    // staged reveal: after the stars, one badge at a time (earned ones pop, others fade in dim)
    box.classList.add('show');
    const items = Array.prototype.slice.call(box.querySelectorAll('.rb'));
    const base = 520 + 3 * 340 + 250;
    items.forEach((el, i) => {
      const t = setTimeout(() => {
        el.classList.add('in');
        if (el.classList.contains('new')) { el.classList.add('pop'); sfx('star', { index: 2 }); }
        else if (el.classList.contains('now')) el.classList.add('pop');
      }, base + i * 380);
      Hud._resultTimers.push(t);
    });
    refreshPanel(true);
    refreshChips();
  }

  // ---------------------------------------------------------------- level select tile counts + totals
  function totalChip(cls) {
    const c = doc.createElement('span');
    c.className = 'chip ' + cls + ' badge-chip';
    c.setAttribute('data-i18n-title', 'hud.title.badgesTip');
    c.title = BG.i18n ? BG.i18n.t('hud.title.badgesTip') : '';
    c.innerHTML = img('penny', 'gb-chip') + '<b>0</b> / 0';
    return c;
  }
  function refreshChips() {
    const tot = S.totalBadges(), max = S.maxBadges();
    const put = (parent, cls, before) => {
      if (!parent) return;
      let c = parent.querySelector('.badge-chip');
      if (!c) { c = totalChip(cls); parent.insertBefore(c, before || null); }
      c.querySelector('b').nextSibling.textContent = ' / ' + max;
      c.querySelector('b').textContent = tot;
      c.hidden = !max;
    };
    const ls = Hud.el.levels, ti = Hud.el.title;
    if (ls) { const r = ls.querySelector('.ls-right'); put(r, 'chip-lg', r && r.querySelector('[data-act=settings]')); }
    if (ti) { const m = ti.querySelector('.title-meta'); put(m, '', m && m.querySelector('[data-act=settings]')); }
  }
  function decorateTiles() {
    const ls = Hud.el.levels;
    if (!ls) return;
    // every campaign's tiles: chapter tiles (Roads, Iron Road) and the Famous Bridges picture tiles
    ls.querySelectorAll('.tile[data-id]:not(.soon), .fb-tile[data-id]:not(.stub)').forEach(t => {
      const id = +t.dataset.id, goals = G.forLevel(id);
      if (!goals.length) return;
      const have = S.getBadges(id).filter(x => goals.some(g => g.type === x)).length;
      const row = t.querySelector('.tile-stars, .fb-tile-stars');
      if (!row || row.querySelector('.tile-badges')) return;
      const b = doc.createElement('span');
      b.className = 'tile-badges' + (have === goals.length ? ' all' : have ? ' some' : '');
      b.title = have + ' of ' + goals.length + ' challenge badges';
      b.innerHTML = img('minimalist', 'gb-tile') + '<b>' + have + '</b>/' + goals.length;
      row.appendChild(b);
    });
    refreshChips();
  }

  // ---------------------------------------------------------------- wrap Hud
  function wrap(name, after) {
    const orig = Hud[name];
    if (typeof orig !== 'function') return;
    Hud[name] = function () {
      const r = orig.apply(this, arguments);
      safe(() => after.apply(this, arguments));
      return r;
    };
  }
  wrap('enterLevel', function () {
    ensureHud();
    lastRun = null;
    const goals = levelGoals(Hud.level);
    let open = safe(() => S.get('goalsPanelOpen', true), true);
    if (root.innerWidth < 760) open = false;
    if (BG.Mobile && BG.Mobile.env && BG.Mobile.env.phone) open = false; // mobile: phones open the panel on demand (it would cover the build area)
    panelOpen = !!open && goals.length > 0;
    lastSig = '';
    refreshPanel(true);
    // the panel must never hide where the bridge starts: when it would cover one of the level's anchors (the far
    // bank of a long gap on a desktop window), it starts closed for this level (the saved preference stays as it is)
    if (panelOpen) root.setTimeout(() => safe(keepAnchorsClear), 60);
  });
  function keepAnchorsClear() {
    const g = BG.Game, r = g && g.renderer, lv = Hud.level;
    if (!panelOpen || !panel || !r || typeof r.worldToScreen !== 'function' || !lv || Hud.screen !== 'level') return;
    const pr = panel.getBoundingClientRect();
    if (!pr.width || !pr.height) return;
    const cr = g.canvas.getBoundingClientRect(), pad = 24;
    const covered = (lv.anchors || []).some(a => {
      const p = r.worldToScreen(a.x, a.y), x = p.x + cr.left, y = p.y + cr.top;
      return x > pr.left - pad && x < pr.right + pad && y > pr.top - pad && y < pr.bottom + pad;
    });
    if (covered) setPanel(false, true);
  }
  wrap('update', function () {
    if (Hud.screen !== 'level' || !panel) return;
    const now = root.performance ? performance.now() : Date.now();
    if (now - lastT < 250) return;
    lastT = now;
    refreshPanel(false);
  });
  wrap('showResults', function (res) {
    if (res) renderResultBadges(res);
  });
  wrap('hideResults', function () {
    const box = Hud.el.results && Hud.el.results.querySelector('.res-badges');
    if (box) box.classList.remove('show');
  });
  wrap('buildLevelSelect', decorateTiles);
  wrap('refreshTitle', refreshChips);

  BG.GoalsUI = { refresh: () => { refreshPanel(true); refreshChips(); }, evaluateCurrent: currentEval,
    isOpen: () => panelOpen, setOpen: (open, noSave) => setPanel(!!open, noSave) }; // mobile: setOpen(false, true) closes without saving the preference
})(typeof window !== 'undefined' ? window : globalThis);
