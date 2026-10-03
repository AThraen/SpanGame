/* SPAN — Famous Bridges campaign (extra module). Real-world bridges, level ids 201+, campaign: 'famous'.
 *  - the campaign's look: the third level-select tab (Roads | Iron Road | Famous Bridges), registered with
 *    BG.Hud.registerCampaign('famous', ...) - picture tiles in an .fb-panel instead of chapters, top-bar labels,
 *    Continue label and finale text. Its RULES (opens after road level 15, either of the two previous playable
 *    levels inside the campaign, stubs / missing modules never open, finale after 212) are the shared campaign
 *    table BG.Storage.CAMPAIGNS like every other campaign's.
 *  - a history card (year, place, engineer, span, type, facts, why it matters) shown before each level
 *  - levels whose modules are missing (level.requires) or that are still stubs (level.stub), see
 *    js/features/requirements.js, stay locked
 * Hooks into existing objects by wrapping BG.Game.openLevel (history card), BG.Hud.enterLevel (history button)
 * and BG.Templates.available (level.templates as an id list).
 * Load order: after js/main.js (BG.Game exists but has not booted yet - it boots on DOMContentLoaded). */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const CAMPAIGN = 'famous';

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
  function vehName(t) { const V = BG.Vehicles && BG.Vehicles[t]; return (V && V.name) || t; }

  // ------------------------------------------------------------------ campaign model
  // The rules (unlock after road 15, either-of-two-previous inside the campaign, stubs / missing modules never
  // open, finale after 212) are BG.Storage's campaign table - this is a thin famous-flavoured view of it.
  function conf() { const st = S(); return (st && st.CAMPAIGNS && st.CAMPAIGNS[CAMPAIGN]) || { unlockAfter: 15, last: 212 }; }
  const Famous = {
    CAMPAIGN,
    get UNLOCK_AFTER() { return conf().unlockAfter; },
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
      return !st || !st.isCampaignUnlocked ? true : safe(() => st.isCampaignUnlocked(CAMPAIGN), false);
    },
    isUnlocked(id) {
      const st = S();
      if (!st) return !!Famous.find(id) && Famous.playable(Famous.find(id));
      return safe(() => st.isUnlocked(id, BG.Levels), false);
    },
    lockReason(lv) {
      const miss = Famous.missing(lv);
      if (miss.length) return 'Needs the ' + miss.map(r => BG.Requirements ? BG.Requirements.label(r) : r).join(' + ') + ' module - coming with a later update.';
      if (Famous.isStub(lv)) return 'This crossing is still being surveyed - it opens with a later update.';
      if (!Famous.campaignOpen()) return 'Famous Bridges opens after road level ' + Famous.UNLOCK_AFTER + '.';
      const st = S(), why = st && st.lockText ? safe(() => st.lockText(lv.id, BG.Levels), null) : null;
      return why || 'Complete one of the two famous bridges before this one to unlock it.';
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
      const traffic = (level.traffic || []).map(g => (g.count || 1) + ' × ' + esc(g.type === 'train' ? ((BG.Trains && BG.Trains[g.train] && BG.Trains[g.train].name) || g.train || 'train') : vehName(g.type))).join(', ');
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

  // ------------------------------------------------------------------ level select panel
  // Famous Bridges is the third campaign tab of the level select (BG.Hud owns the tabs: Roads | Iron Road |
  // Famous Bridges). Registered below with BG.Hud.registerCampaign; while it is active the Hud hides the
  // chapters (#screen-levels.fb-mode) and calls Tab.render(panel) to fill its .fb-panel with picture tiles.
  const Tab = {
    active() { return BG.Hud && BG.Hud.tab === CAMPAIGN ? CAMPAIGN : 'roads'; },
    // remember the tab without rebuilding (the level select is rebuilt when it is shown)
    set(name) { if (BG.Hud && BG.Hud.setCampaignTab) BG.Hud.setCampaignTab(name === CAMPAIGN ? CAMPAIGN : 'road', true); },
    render(panel, info) {
      if (!panel) return;
      if (!panel.__fbClick) {
        panel.__fbClick = true;
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
      const open = info ? info.open : Famous.campaignOpen();
      const st = S();
      const max = Famous.playableLevels().length * 3;
      const tiles = Famous.levels().map((lv, i) => {
        const H = lv.history || {};
        const miss = Famous.missing(lv);
        const blocked = !Famous.playable(lv);
        const unlocked = Famous.isUnlocked(lv.id);
        const stars = st ? safe(() => st.getStars(lv.id), 0) : 0;
        const done = st && safe(() => st.isCompleted(lv.id), false);
        // open, unfinished, and a later bridge is done: "Skipped - come back later" (BG.Storage.isSkipped)
        const skip = unlocked && !done && !!(st && st.isSkipped && safe(() => st.isSkipped(lv.id, BG.Levels), false));
        const badge = miss.length ? '<span class="fb-need">Needs ' + esc(miss.map(r => BG.Requirements ? BG.Requirements.label(r) : r).join(' + ')) + '</span>'
          : blocked ? '<span class="fb-need">Coming soon</span>' : '';
        return `<button class="fb-tile ${unlocked ? 'open' : 'locked'} ${done ? 'done' : ''} ${blocked ? 'stub' : ''} ${skip ? 'skipped' : ''}" data-fbid="${lv.id}" data-id="${lv.id}" ${unlocked ? '' : 'aria-disabled="true"'} style="animation-delay:${Math.min(i, 20) * 22}ms">
            <span class="fb-tile-art"><img src="${esc(H.art || '')}" alt="" draggable="false" loading="lazy" onerror="this.style.display='none'"><span class="fb-tile-year">${esc(H.year || '')}</span>${unlocked ? '' : '<span class="fb-tile-lock">' + icon('lock') + '</span>'}${badge}${skip ? '<span class="tile-skip">Skipped — come back later</span>' : ''}</span>
            <span class="fb-tile-body"><span class="fb-tile-num">${i + 1}</span><span class="fb-tile-txt"><b>${esc(lv.name)}</b><small>${esc(H.location || '')}</small></span>
            <span class="fb-tile-stars">${blocked ? '' : [0, 1, 2].map(k => starSvg(k < stars)).join('')}</span></span>
          </button>`;
      }).join('');
      panel.innerHTML = `
        <div class="fb-intro glass">
          <div><h3>Build the bridges that made history</h3><p>Each crossing is a scaled-down version of a real bridge - its gap, its piers, its shipping channel. Read the story, then find out why the engineers chose the shape they did.</p></div>
          <span class="chip chip-lg">${starSvg(true)}<b>${Famous.stars()}</b> / ${max}</span>
          ${BG.Hud && BG.Hud.unlockInfoBtn ? BG.Hud.unlockInfoBtn(CAMPAIGN) : ''}
        </div>
        ${open ? '' : '<p class="fb-gate">' + icon('lock') + '<span>Complete road level ' + Famous.UNLOCK_AFTER + ' to open Famous Bridges.</span></p>'}
        <div class="fb-grid">${tiles}</div>`;
    },
  };
  Famous.tab = Tab;

  // ------------------------------------------------------------------ hooks into Templates / Game / Hud
  // Unlocking, "Next level", the finale, Continue and the tab itself are the shared campaign system
  // (BG.Storage.CAMPAIGNS + BG.Hud.registerCampaign); only the history card, the history button and the
  // per-level template list are famous-specific.
  function wrap(obj, name, make) {
    if (!obj || typeof obj[name] !== 'function' || obj[name].__famous) return;
    const orig = obj[name];
    const w = make(orig);
    w.__famous = true;
    obj[name] = w;
  }

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

  const Hud = BG.Hud;
  // the third campaign tab: looks, labels and finale (rules: BG.Storage.CAMPAIGNS.famous)
  if (Hud && Hud.registerCampaign) {
    Hud.registerCampaign(CAMPAIGN, {
      name: 'Famous Bridges', sub: 'Real crossings · Roman arches to record spans', icon: fbIcon, cls: 'is-famous',
      allLabel: 'All bridges', maxDefault: 36, modeClass: 'fb-mode', panelClass: 'fb-panel',
      render: (panel, info) => Tab.render(panel, info),
      continueLabel: lv => lv.name,
      levelNum: lv => Famous.index(lv),
      levelK: 'BRIDGE',
      // the place is on the history card; the bar keeps to what fits: year, gap, piers
      levelSub: (lv, gap) => { const H = lv.history || {}, p = lv.maxPiers | 0; return ['Famous Bridges', H.year, gap ? gap + ' m gap' : null, p ? p + (p === 1 ? ' pier' : ' piers') : null].filter(Boolean).join(' · '); },
      finale: {
        banner: 'Famous Bridges complete', title: 'A builder for the ages!',
        text: starLine => 'From Roman arches to the Millau Viaduct - ' + Famous.playableLevels().length + ' famous crossings rebuilt. ' + starLine,
      },
    });
  }
  // the history button in the top bar of a famous level
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
    });
    return out;
  });

  function fbIcon() {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18"/><path d="M4 18c2-6 14-6 16 0"/><path d="M8 18v-3.2M12 18v-4.4M16 18v-3.2"/><path d="M12 3.5v4M10 5.5h4"/></svg>';
  }
})(typeof window !== 'undefined' ? window : globalThis);
