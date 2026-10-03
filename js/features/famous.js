/* SPAN — Famous Bridges campaign (extra module). Real-world bridges, level ids 201+, campaign: 'famous'.
 *  - campaign registration + unlock rule (opens after road level 15; inside the campaign the usual
 *    "either of the two previous levels" rule, counted over playable levels only)
 *  - a history card (year, place, engineer, span, type, facts, why it matters) shown before each level
 *  - a "Famous Bridges" tab in the level select's campaign tabs (Roads | Iron Road | Famous Bridges):
 *    BG.Hud.tab = 'famous' shows the .fb-panel instead of the chapters (BG.Hud.setCampaignTab('famous'))
 *  - levels whose modules are missing (level.requires) or that are still stubs (level.stub), see
 *    js/features/requirements.js, stay locked
 * Everything hooks into existing objects by wrapping methods at load time; the only shared-file change is
 *  campaignOf() in main.js / storage.js / hud.js returning 'famous' for these levels (kept out of the Roads).
 * Load order: after js/main.js (BG.Game exists but has not booted yet - it boots on DOMContentLoaded). */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const CAMPAIGN = 'famous';
  const UNLOCK_AFTER = 15; // road level that opens the campaign

  // ------------------------------------------------------------------ helpers
  const $ = (sel, el) => (el || document).querySelector(sel);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function safe(fn, d) { try { return fn(); } catch (e) { console.error('[famous]', e); return d; } }
  function sfx(n) { try { BG.Audio && BG.Audio.play(n); } catch (e) { /* */ } }
  function toast(msg) { if (BG.Hud && BG.Hud.toast) BG.Hud.toast(msg, 'info'); }
  function S() { return BG.Storage || null; }
  function money(n) { return BG.Hud && BG.Hud.money ? BG.Hud.money(n) : '$' + Math.round(n); }
  function icon(n) { return BG.Hud && BG.Hud.icon ? BG.Hud.icon(n) : ''; }
  function starSvg(on) { return '<svg class="star ' + (on ? 'on' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.3 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z"/></svg>'; }
  // challenge badges (js/features/goals*.js) earned on a famous level, in the same style as the road tiles
  function badgeCount(id) {
    const G = BG.Goals, st = S();
    if (!G || !G.forLevel || !st || !st.getBadges) return '';
    const goals = safe(() => G.forLevel(id), []) || [];
    if (!goals.length) return '';
    const have = (safe(() => st.getBadges(id), []) || []).filter(x => goals.some(g => g.type === x)).length;
    return '<span class="tile-badges fb-badges' + (have === goals.length ? ' all' : have ? ' some' : '') + '" title="' + have + ' of ' + goals.length + ' challenge badges">' +
      '<img class="gb-img gb-tile" src="assets/icons/badges/minimalist.svg" alt="" draggable="false"><b>' + have + '</b>/' + goals.length + '</span>';
  }
  function vehName(t) { const V = BG.Vehicles && BG.Vehicles[t]; return (V && V.name) || t; }

  // ------------------------------------------------------------------ campaign model
  const Famous = {
    CAMPAIGN, UNLOCK_AFTER,
    isFamous(lv) { return !!lv && lv.campaign === CAMPAIGN; },
    levels() { return (Array.isArray(BG.Levels) ? BG.Levels : []).filter(l => l && l.campaign === CAMPAIGN).sort((a, b) => a.id - b.id); },
    find(id) { return Famous.levels().find(l => l.id === id) || null; },
    missing(lv) { return BG.Requirements ? BG.Requirements.missing(lv) : ((lv && lv.requires) || []); },
    isStub(lv) { return BG.Requirements && BG.Requirements.isStub ? BG.Requirements.isStub(lv) : !!(lv && lv.stub); },
    playable(lv) { return BG.Requirements ? BG.Requirements.met(lv) : (Famous.missing(lv).length === 0 && !Famous.isStub(lv)); },
    playableLevels() { return Famous.levels().filter(Famous.playable); },
    index(lv) { return Famous.levels().indexOf(lv) + 1; },          // 1-based number shown on tiles
    campaignOpen() {
      const st = S();
      if (!st) return true;
      return safe(() => st.get('unlockAll', false) || st.isCompleted(UNLOCK_AFTER), false);
    },
    // unlocked = requirements met AND (unlockAll OR first playable after road 15 OR one of the two previous playable done)
    isUnlocked(id) {
      const lv = Famous.find(id);
      if (!lv || !Famous.playable(lv)) return false;
      const st = S();
      if (!st) return true;
      if (safe(() => st.get('unlockAll', false), false)) return true;
      if (!Famous.campaignOpen()) return false;
      const list = Famous.playableLevels();
      const i = list.indexOf(lv);
      if (i <= 0) return true;
      const done = k => k >= 0 && safe(() => st.isCompleted(list[k].id), false);
      return done(i - 1) || done(i - 2);
    },
    lockReason(lv) {
      const miss = Famous.missing(lv);
      if (miss.length) return 'Needs the ' + miss.map(r => BG.Requirements ? BG.Requirements.label(r) : r).join(' + ') + ' module - coming with a later update.';
      if (Famous.isStub(lv)) return 'This crossing is still being surveyed - it opens with a later update.';
      if (!Famous.campaignOpen()) return 'Famous Bridges opens after road level ' + UNLOCK_AFTER + '.';
      return 'Complete one of the two famous bridges before this one to unlock it.';
    },
    nextAfter(lv) {
      const list = Famous.playableLevels();
      const i = list.indexOf(lv);
      return i >= 0 ? (list[i + 1] || null) : null;
    },
    stars() {
      const st = S();
      return Famous.levels().reduce((t, l) => t + (st ? safe(() => st.getStars(l.id), 0) : 0), 0);
    },
  };
  BG.Famous = Famous;

  // ------------------------------------------------------------------ history card
  const Card = {
    el: null,
    onBuild: null,
    open: false,
    _build() {
      if (this.el) return this.el;
      const ui = document.getElementById('ui') || document.body;
      const el = h('<div class="fb-overlay" role="dialog" aria-modal="true" aria-labelledby="fb-card-title"><div class="fb-card glass"></div></div>');
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-fb]');
        if (b) { sfx('click'); if (b.dataset.fb === 'build') this.build(); else this.close(); return; }
        if (e.target === el) this.close();
      });
      ui.appendChild(el);
      this.el = el;
      return el;
    },
    // mode: 'intro' (before building: Back / Build it) or 'info' (reopened in the level: Close)
    show(level, opts) {
      opts = opts || {};
      const el = this._build();
      const H = level.history || {};
      const t = level.terrain || {};
      const gap = Math.round((t.rightEdge || 0) - (t.leftEdge || 0));
      const traffic = (level.traffic || []).map(g => (g.count || 1) + ' × ' + esc(g.type === 'train' ? (g.train || 'train') : vehName(g.type))).join(', ');
      const miss = Famous.playable(level) ? [] : [Famous.lockReason(level)]; // whatever keeps it from being built
      const st = S();
      const stars = st ? safe(() => st.getStars(level.id), 0) : 0;
      const intro = opts.mode !== 'info';
      const rows = [['Built', H.built || H.year], ['Where', [H.location, H.crosses].filter(Boolean).join(' · ')], ['Engineers', H.engineer], ['Span', H.span], ['Type', H.type]]
        .filter(r => r[1]).map(r => '<div class="fb-row"><span>' + r[0] + '</span><b>' + esc(r[1]) + '</b></div>').join('');
      $('.fb-card', el).innerHTML = `
        <div class="fb-art"><img class="fb-art-bg" src="${esc(H.art || '')}" alt="" draggable="false" onerror="this.style.display='none'"><img class="fb-art-fg" src="${esc(H.art || '')}" alt="${esc((H.name || level.name) + ' illustration')}" draggable="false" onerror="this.style.display='none'"><span class="fb-year">${esc(H.year || '')}</span></div>
        <div class="fb-body">
          <div class="fb-kicker">Famous Bridges · ${Famous.index(level)} of ${Famous.levels().length}</div>
          <h2 id="fb-card-title">${esc(H.name || level.name)}</h2>
          <div class="fb-rows">${rows}</div>
          <ul class="fb-facts">${(H.facts || []).map(f => '<li>' + esc(f) + '</li>').join('')}</ul>
          ${H.why ? '<div class="fb-why"><span>Why it matters</span><p>' + esc(H.why) + '</p></div>' : ''}
          ${H.note ? '<p class="fb-note">' + esc(H.note) + '</p>' : ''}
          <div class="fb-challenge"><span class="fb-ch-k">Your challenge</span>
            <span class="chip">${gap} m gap</span><span class="chip">${esc(traffic || 'no traffic')}</span><span class="chip">Budget <b>${money(level.budget || 0)}</b></span>
            ${stars ? '<span class="fb-stars">' + [0, 1, 2].map(i => starSvg(i < stars)).join('') + '</span>' : ''}
          </div>
          ${miss.length ? '<p class="fb-locked">' + esc(Famous.lockReason(level)) + '</p>' : ''}
          <div class="fb-actions">
            ${intro ? '<button class="btn btn-glass" data-fb="back">' + icon('back') + '<span>Back</span></button>' : ''}
            ${intro && !miss.length ? '<button class="btn btn-primary" data-fb="build">' + icon('play') + '<span>Build it</span></button>' : ''}
            ${!intro ? '<button class="btn btn-primary" data-fb="close">' + icon('close') + '<span>Close</span></button>' : ''}
          </div>
        </div>`;
      this.onBuild = intro && !miss.length ? (opts.onBuild || null) : null;
      el.classList.add('show');
      this.open = true;
      document.body.classList.add('fb-card-open');
      sfx('whoosh');
      const primary = $('.fb-actions .btn-primary', el);
      if (primary && primary.focus) setTimeout(() => { try { primary.focus({ preventScroll: true }); } catch (e) { /* */ } }, 30);
    },
    build() { const f = this.onBuild; this.close(); if (f) f(); },
    close() {
      if (!this.el) return;
      this.el.classList.remove('show');
      this.open = false;
      this.onBuild = null;
      document.body.classList.remove('fb-card-open');
    },
  };
  Famous.card = Card;
  Famous.showCard = (level, opts) => Card.show(level, opts);

  // keys while the card is open: Enter / Space = build, Esc = back. Registered before BG.Game binds
  // its own capture listener, so we see the event first and keep it from the game.
  root.addEventListener('keydown', e => {
    if (!Card.open) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); Card.close(); }
    else if (k === 'Enter' || k === ' ' || e.code === 'Space') { e.preventDefault(); if (Card.onBuild) Card.build(); else Card.close(); }
    else if (k === 'Tab') return;
    e.stopImmediatePropagation();
  }, true);

  // ------------------------------------------------------------------ level select tab
  // The level select's campaign tabs (BG.Hud: Roads | Iron Road) get a third tab, data-camp="famous".
  // While it is active BG.Hud.tab === 'famous'; the Roads chapters are built underneath (hidden by
  // #screen-levels.fb-mode) and the famous panel is shown instead.
  const Tab = {
    active() { return BG.Hud && BG.Hud.tab === 'famous' ? 'famous' : 'roads'; },
    // remember the tab without rebuilding (the level select is rebuilt when it is shown)
    set(name) { if (BG.Hud && BG.Hud.setCampaignTab) BG.Hud.setCampaignTab(name === 'famous' ? 'famous' : 'road', true); },
    ensure(screen) {
      const tabs = $('.camp-tabs', screen);
      if (tabs && !$('[data-camp=famous]', tabs)) {
        tabs.appendChild(h('<button class="camp-tab is-famous" role="tab" data-camp="famous">' + fbIcon() + '<span class="ct-txt"><b>Famous Bridges</b><small data-ref="ctFamous">Complete level ' + UNLOCK_AFTER + '</small></span><span class="ct-lock">' + icon('lock') + '</span></button>'));
      }
      const scroll = $('.ls-scroll', screen);
      if (scroll && !$('.fb-panel', scroll)) {
        const panel = h('<div class="fb-panel"></div>');
        scroll.appendChild(panel);
        panel.addEventListener('click', e => {
          const t = e.target.closest('.fb-tile');
          if (!t) return;
          e.stopPropagation();
          const lv = Famous.find(+t.dataset.fbid);
          if (!lv) return;
          if (t.classList.contains('open')) { sfx('click'); BG.Game.openLevel(lv.id); }
          else { sfx('error'); t.classList.remove('nope'); void t.offsetWidth; t.classList.add('nope'); toast(Famous.lockReason(lv)); }
        });
      }
    },
    render(screen) {
      screen = screen || (BG.Hud && BG.Hud.el && BG.Hud.el.levels);
      if (!screen) return;
      this.ensure(screen);
      const has = Famous.levels().length > 0;
      const tab = has ? this.active() : 'roads';
      const open = Famous.campaignOpen();
      const st = S();
      const max = Famous.playableLevels().length * 3;
      screen.classList.toggle('fb-mode', tab === 'famous');
      const ftab = $('.camp-tab[data-camp=famous]', screen);
      if (ftab) {
        ftab.hidden = !has;
        ftab.classList.toggle('locked', !open);
        ftab.title = open ? 'Real bridges from history' : 'Opens after road level ' + UNLOCK_AFTER;
        const small = $('[data-ref=ctFamous]', ftab);
        if (small) small.textContent = open ? Famous.stars() + ' / ' + max + ' ★' : 'Complete level ' + UNLOCK_AFTER;
      }
      const panel = $('.fb-panel', screen);
      if (tab !== 'famous') { if (panel) panel.innerHTML = ''; return; }
      // the Hud built the Roads view underneath: point the header at the famous campaign instead
      screen.classList.remove('camp-rail');
      Array.from(screen.querySelectorAll('.camp-tab[data-camp]')).forEach(b => {
        const on = b.dataset.camp === 'famous';
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const sub = $('[data-ref=lsSub]', screen);
      if (sub) sub.textContent = 'Real crossings · Roman arches to record spans';
      const chip = $('[data-ref=lsStars]', screen);
      if (chip) chip.innerHTML = starSvg(true) + '<b>' + Famous.stars() + '</b> / ' + max;
      const tiles = Famous.levels().map((lv, i) => {
        const H = lv.history || {};
        const miss = Famous.missing(lv);
        const blocked = !Famous.playable(lv);
        const unlocked = Famous.isUnlocked(lv.id);
        const stars = st ? safe(() => st.getStars(lv.id), 0) : 0;
        const done = st && safe(() => st.isCompleted(lv.id), false);
        const badge = miss.length ? '<span class="fb-need">Needs ' + esc(miss.map(r => BG.Requirements ? BG.Requirements.label(r) : r).join(' + ')) + '</span>'
          : blocked ? '<span class="fb-need">Coming soon</span>' : '';
        return `<button class="fb-tile ${unlocked ? 'open' : 'locked'} ${done ? 'done' : ''} ${blocked ? 'stub' : ''}" data-fbid="${lv.id}" ${unlocked ? '' : 'aria-disabled="true"'} style="animation-delay:${Math.min(i, 20) * 22}ms">
            <span class="fb-tile-art"><img src="${esc(H.art || '')}" alt="" draggable="false" loading="lazy" onerror="this.style.display='none'"><span class="fb-tile-year">${esc(H.year || '')}</span>${unlocked ? '' : '<span class="fb-tile-lock">' + icon('lock') + '</span>'}${badge}</span>
            <span class="fb-tile-body"><span class="fb-tile-num">${i + 1}</span><span class="fb-tile-txt"><b>${esc(lv.name)}</b><small>${esc(H.location || '')}</small></span>
            <span class="fb-tile-stars">${blocked ? '' : [0, 1, 2].map(k => starSvg(k < stars)).join('')}</span>${blocked ? '' : badgeCount(lv.id)}</span>
          </button>`;
      }).join('');
      panel.innerHTML = `
        <div class="fb-intro glass">
          <div><h3>Build the bridges that made history</h3><p>Each crossing is a scaled-down version of a real bridge - its gap, its piers, its shipping channel. Read the story, then find out why the engineers chose the shape they did.</p></div>
          <span class="chip chip-lg">${starSvg(true)}<b>${Famous.stars()}</b> / ${max}</span>
        </div>
        ${open ? '' : '<p class="fb-gate">' + icon('lock') + '<span>Complete road level ' + UNLOCK_AFTER + ' to open Famous Bridges.</span></p>'}
        <div class="fb-grid">${tiles}</div>`;
    },
  };
  Famous.tab = Tab;

  // ------------------------------------------------------------------ hooks into Storage / Game / Hud
  function wrap(obj, name, make) {
    if (!obj || typeof obj[name] !== 'function' || obj[name].__famous) return;
    const orig = obj[name];
    const w = make(orig);
    w.__famous = true;
    obj[name] = w;
  }

  // unlock rule for famous ids; everything else unchanged
  wrap(BG.Storage, 'isUnlocked', orig => function (id, levels) {
    const lv = Famous.find(id);
    if (lv) return Famous.isUnlocked(id);
    return orig.call(this, id, levels);
  });

  // level.templates may list the history-appropriate template ids; the HUD only offers 'ok' ones
  wrap(BG.Templates, 'available', orig => function (level) {
    const list = orig.apply(this, arguments);
    if (!level || !Array.isArray(level.templates) || !Array.isArray(list)) return list;
    return list.map(t => (level.templates.indexOf(t.id) >= 0 ? t : Object.assign({}, t, { ok: false, reason: 'not used on this crossing' })));
  });

  const G = BG.Game;
  // history card before a famous level; locked / module-less levels never open
  wrap(G, 'openLevel', orig => function (id, opts) {
    const lv = Famous.find(id);
    if (!lv) return orig.call(this, id, opts);
    if (!Famous.playable(lv)) { sfx('error'); Card.show(lv, { mode: 'intro' }); return false; }
    if (!(opts && opts.force) && !Famous.isUnlocked(id)) { sfx('error'); toast(Famous.lockReason(lv)); return false; }
    if (opts && opts.skipCard) return orig.call(this, id, opts);
    const self = this;
    Card.show(lv, { mode: 'intro', onBuild: () => orig.call(self, id, Object.assign({}, opts, { force: true, skipCard: true })) });
    return true;
  });
  // next level inside the campaign (skipping stubs), not road level / rail level by array order
  wrap(G, 'nextLevel', orig => function () {
    if (Famous.isFamous(this.level)) {
      const nx = Famous.nextAfter(this.level);
      if (nx) return this.openLevel(nx.id);
      Tab.set('famous');
      return this.goLevelSelect();
    }
    return orig.apply(this, arguments);
  });

  const Hud = BG.Hud;
  wrap(Hud, 'showResults', orig => function (res) {
    const lv = G && G.level;
    if (!Famous.isFamous(lv) || !res) return orig.call(this, res);
    const nx = Famous.nextAfter(lv);
    res.hasNext = !!nx;
    res.finale = !!res.passed && !nx;
    if (G.lastResult === res) { G.lastResult.hasNext = res.hasNext; G.lastResult.finale = res.finale; }
    const out = orig.call(this, res);
    if (res.finale && this.el) {
      const n = Famous.playableLevels().length;
      this.el.resBanner.textContent = 'Famous Bridges complete';
      this.el.resTitle.textContent = 'A builder for the ages!';
      this.el.resReason.textContent = 'From Roman arches to the Millau Viaduct - ' + n + ' famous crossings rebuilt. You hold ' + Famous.stars() + ' of ' + (n * 3) + ' Famous Bridges stars.';
    }
    return out;
  });
  // campaign tab 'famous' (the Hud itself knows 'road' and 'rail'); noBuild = just remember it, and
  // never land on the locked famous tab when coming back from a level
  wrap(Hud, 'setCampaignTab', orig => function (campaign, noBuild) {
    if (campaign !== 'famous' || !Famous.levels().length) return orig.apply(this, arguments);
    if (noBuild && !Famous.campaignOpen()) return orig.call(this, 'road', noBuild);
    this.tab = 'famous';
    if (!noBuild && this.el && this.el.levels) {
      this.buildLevelSelect();
      const sc = $('.ls-scroll', this.el.levels);
      if (sc) sc.scrollTop = 0;
    }
  });
  // the Hud builds the Roads chapters (hidden while the famous tab is on), then the famous panel goes on top
  wrap(Hud, 'buildLevelSelect', orig => function () {
    const fam = this.tab === 'famous';
    if (fam) this.tab = 'road';
    let out;
    try { out = orig.apply(this, arguments); } finally { if (fam) this.tab = 'famous'; }
    safe(() => Tab.render(this.el.levels));
    return out;
  });
  wrap(Hud, 'scrollToLevel', orig => function (id) {
    if (Famous.find(id)) {
      if (this.tab !== 'famous') this.setCampaignTab('famous');
      const t = this.el.levels && this.el.levels.querySelector('.fb-tile[data-fbid="' + id + '"]');
      if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: 'center' }); } catch (e) { /* */ } }
      return;
    }
    return orig.apply(this, arguments);
  });
  wrap(Hud, 'enterLevel', orig => function (level) {
    const out = orig.apply(this, arguments);
    safe(() => {
      const bar = this.el.level && this.el.level.querySelector('.topbar');
      let btn = bar && bar.querySelector('[data-fb-history]');
      if (bar && !btn) {
        btn = h('<button class="btn btn-icon btn-ghost fb-history-btn" data-fb-history title="Bridge history">' + fbIcon() + '</button>');
        btn.addEventListener('click', e => { e.stopPropagation(); sfx('click'); if (G.level) Card.show(G.level, { mode: 'info' }); });
        const hint = bar.querySelector('[data-act=hint]');
        bar.insertBefore(btn, hint || null);
      }
      const fam = Famous.isFamous(level);
      if (btn) btn.hidden = !fam;
      if (this.el.level) this.el.level.classList.toggle('fb-level', fam);
      if (fam) {
        const H = level.history || {};
        const t = level.terrain || {};
        const gap = Math.round((t.rightEdge || 0) - (t.leftEdge || 0));
        this.el.lvlNum.textContent = Famous.index(level);
        this.el.lvlSub.textContent = ['Famous Bridges', H.year, H.location, gap ? gap + ' m gap' : null].filter(Boolean).join(' · ');
      }
    });
    return out;
  });
  wrap(Hud, 'refreshTitle', orig => function () {
    const out = orig.apply(this, arguments);
    safe(() => {
      const target = G && G.continueTarget && G.continueTarget();
      const lbl = this.el.title && this.el.title.querySelector('[data-act=continue] .lbl');
      if (target && Famous.isFamous(target) && lbl) lbl.textContent = 'Continue · ' + target.name;
      const chip = this.el.title && this.el.title.querySelector('[data-ref=titleStars]');
      const st = S();
      // the Hud counts every level; stub famous levels have nothing to earn yet
      const stubs = Famous.levels().filter(l => !Famous.playable(l)).length;
      const hidden = this.hiddenLevelIds ? safe(() => this.hiddenLevelIds().length, 0) : 0;
      if (chip && st && stubs && chip.lastChild) chip.lastChild.textContent = ' / ' + (((BG.Levels || []).length - hidden - stubs) * 3);
    });
    return out;
  });

  function fbIcon() {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18"/><path d="M4 18c2-6 14-6 16 0"/><path d="M8 18v-3.2M12 18v-4.4M16 18v-3.2"/><path d="M12 3.5v4M10 5.5h4"/></svg>';
  }
})(typeof window !== 'undefined' ? window : globalThis);
