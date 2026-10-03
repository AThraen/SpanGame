// BG.Storage — progress, per-level designs and settings in localStorage.
// Every access is wrapped in try/catch; when storage is unavailable the game
// keeps working with an in-memory store for the session.
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const PREFIX = 'span.v1.';
  const mem = {};
  let available = null;

  function hasLS() {
    if (available !== null) return available;
    try {
      const k = PREFIX + '__probe';
      root.localStorage.setItem(k, '1');
      root.localStorage.removeItem(k);
      available = true;
    } catch (e) { available = false; }
    return available;
  }
  function rawGet(key) {
    if (hasLS()) { try { return root.localStorage.getItem(PREFIX + key); } catch (e) { /* fall through */ } }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
  }
  function rawSet(key, str) {
    mem[key] = str;
    if (hasLS()) { try { root.localStorage.setItem(PREFIX + key, str); } catch (e) { /* quota etc. */ } }
  }
  function rawDel(key) {
    delete mem[key];
    if (hasLS()) { try { root.localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ } }
  }

  function get(key, def) {
    const s = rawGet(key);
    if (s == null) return def;
    try { return JSON.parse(s); } catch (e) { return def; }
  }
  function set(key, value) {
    try { rawSet(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  const progCache = { s: undefined, v: {} };
  function progLevels() {
    const s = rawGet('progress');
    if (s !== progCache.s) {
      progCache.s = s;
      let p = null;
      try { p = s == null ? null : JSON.parse(s); } catch (e) { p = null; }
      progCache.v = p && typeof p === 'object' && p.levels && typeof p.levels === 'object' ? p.levels : {};
    }
    return progCache.v;
  }

  const DEFAULT_SETTINGS = { volume: 0.7, muted: false, showStress: true, showGrid: true, music: true };

  const Storage = {
    available: hasLS,
    get, set,
    remove: rawDel,

    // ---- settings ----
    getSettings() {
      const s = get('settings', {});
      return Object.assign({}, DEFAULT_SETTINGS, s && typeof s === 'object' ? s : {});
    },
    setSettings(patch) {
      const s = Object.assign(Storage.getSettings(), patch || {});
      set('settings', s);
      return s;
    },

    // ---- progress ----
    // { levels: { [id]: { completed, stars, bestCost, attempts } }, lastLevel }
    getProgress() {
      const p = get('progress', null);
      if (!p || typeof p !== 'object' || !p.levels) return { levels: {}, lastLevel: null };
      return p;
    },
    getLevelProgress(id) {
      const p = Storage.getProgress().levels[id];
      return Object.assign({ completed: false, stars: 0, bestCost: null, attempts: 0 }, p || {});
    },
    getStars(id) { return Storage.getLevelProgress(id).stars | 0; },
    // unlock checks ask this a lot: the parsed progress is cached until the stored string changes
    isCompleted(id) { const p = progLevels()[id]; return !!(p && p.completed); },
    totalStars() {
      const lv = Storage.getProgress().levels;
      let t = 0;
      for (const k in lv) t += (lv[k] && lv[k].stars) | 0;
      return t;
    },
    // ---- campaigns ----
    // ONE table for every campaign (rules only; js/ui/hud.js owns their tabs and looks). A level names its
    // campaign in `level.campaign` ('rail' = Iron Road, 'famous' = Famous Bridges); no field (or 'road') = Roads,
    // which also holds the hidden bonus chapter (51-53). `last` is the declared final id (the finale shows after
    // it, never after whichever level happens to be built last), `bonusLast` the end of the Roads' bonus chapter,
    // `unlockAfter` the road level that opens the campaign (with ?unlockall everything is open).
    // `gates`: the chapter finales (last level of each chapter / Iron Road line). A gate can't be skipped:
    // nothing after it unlocks until it is complete. The campaign's `last` and `bonusLast` are gates too.
    // Famous Bridges run in date order with no chapters, so only their finale is a gate.
    CAMPAIGNS: {
      road: { id: 'road', name: 'Roads', first: 1, last: 50, bonusLast: 53, unlockAfter: null, gates: [5, 10, 20, 30, 40, 50], gateWord: 'chapter finale' },
      rail: { id: 'rail', name: 'Iron Road', first: 101, last: 120, unlockAfter: 10, gates: [105, 110, 115, 120], gateWord: 'line finale' },
      famous: { id: 'famous', name: 'Famous Bridges', first: 201, last: 212, unlockAfter: 15, gates: [], gateWord: 'finale' },
    },
    CAMPAIGN_ORDER: ['road', 'rail', 'famous'],
    RAIL_UNLOCK_LEVEL: 10,
    campaignOf(level) {
      const c = level && level.campaign;
      return c && c !== 'road' && Object.prototype.hasOwnProperty.call(Storage.CAMPAIGNS, c) ? c : 'road';
    },
    campaignDef(campaign) { return Storage.CAMPAIGNS[campaign] || null; },
    campaignFinalId(campaign) { const c = Storage.CAMPAIGNS[campaign]; return c ? c.last : null; },
    // which finale a passed level ends: its campaign's id at the campaign's last level, 'bonus' at the end
    // of the Roads' bonus chapter, else null
    finaleOf(level) {
      if (!level || level.id == null) return null;
      const camp = Storage.campaignOf(level), c = Storage.CAMPAIGNS[camp];
      if (!c) return null;
      if (level.id === c.last) return camp;
      if (c.bonusLast != null && level.id === c.bonusLast) return 'bonus';
      return null;
    },
    isCampaignFinale(level) { return Storage.finaleOf(level) != null; },
    // a level can be played when the optional modules it needs are installed and it is not a stub
    // (js/features/requirements.js; famous levels use level.requires / level.stub)
    isPlayable(level) {
      if (!level) return false;
      try { return !BG.Requirements || BG.Requirements.met(level); } catch (e) { return true; }
    },
    // the playable levels of one campaign, sorted by id (the order unlocking and "Next level" follow)
    campaignLevels(levels, campaign) {
      return (levels || []).filter(l => l && Storage.campaignOf(l) === campaign && Storage.isPlayable(l))
        .slice().sort((a, b) => (a.id != null ? a.id : 0) - (b.id != null ? b.id : 0));
    },
    // a campaign opens once its unlockAfter road level is complete (or with ?unlockall)
    isCampaignUnlocked(campaign) {
      const c = Storage.CAMPAIGNS[campaign];
      if (!c || c.unlockAfter == null) return true;
      if (Storage.get('unlockAll', false)) return true;
      return Storage.isCompleted(c.unlockAfter);
    },
    // "Complete level 10 to open the Iron Road." (null when the campaign is open)
    campaignLockText(campaign) {
      const c = Storage.CAMPAIGNS[campaign];
      if (!c || Storage.isCampaignUnlocked(campaign)) return null;
      return 'Complete level ' + c.unlockAfter + ' to open ' + (campaign === 'famous' ? c.name : 'the ' + c.name) + '.';
    },
    campaignStars(levels, campaign) {
      let got = 0, max = 0;
      Storage.campaignLevels(levels, campaign).forEach(l => { got += Storage.getStars(l.id); max += 3; });
      return { got, max };
    },
    // a gate (chapter / line finale, or a campaign's declared finale) must be completed before anything after it opens
    isGate(level) {
      if (!level || level.id == null) return false;
      const c = Storage.CAMPAIGNS[Storage.campaignOf(level)];
      if (!c) return false;
      return level.id === c.last || (c.bonusLast != null && level.id === c.bonusLast) || (Array.isArray(c.gates) && c.gates.indexOf(level.id) >= 0);
    },
    // THE unlock rule, on one campaign's ordered list: a level opens when either of the two levels before it is
    // complete (one hard crossing never blocks progress - skip it and come back later), but never past an
    // unfinished gate. `done(k)` says whether list[k] is complete; legacy = the pre-gate rule (for the migration).
    _ruleOpen(list, idx, done, legacy) {
      if (idx <= 0) return idx === 0;
      if (!legacy) for (let k = 0; k < idx; k++) if (Storage.isGate(list[k]) && !done(k)) return false;
      return done(idx - 1) || done(idx - 2);
    },
    _campaignListOf(id, levels) {
      const lv = levels && levels.length ? levels.find(l => l && l.id === id) : null;
      const campaign = lv ? Storage.campaignOf(lv) : (id > 200 ? 'famous' : id > 100 ? 'rail' : 'road');
      const list = lv ? Storage.campaignLevels(levels, campaign) : (levels || []);
      return { lv, campaign, list, idx: list.findIndex(l => (l.id != null ? l.id : -1) === id) };
    },
    // A level is unlocked if it is the first one of its campaign (and that campaign is open), or by the rule
    // above, or if the player already had it open before the gates existed (`unlocks.keep`, see migrateUnlocks).
    // Levels that are not playable (missing module / stub) never unlock, not even with ?unlockall.
    isUnlocked(id, levels) {
      const lv = levels && levels.length ? levels.find(l => l && l.id === id) : null;
      if (lv && !Storage.isPlayable(lv)) return false;
      if (Storage.get('unlockAll', false)) return true;
      if (!levels || !levels.length) return id === 1;
      const { campaign, list, idx } = Storage._campaignListOf(id, levels);
      if (!Storage.isCampaignUnlocked(campaign)) return false;
      if (idx <= 0) return idx === 0 || id === 1;
      if (Storage.keptUnlocks().indexOf(id) >= 0) return true;
      const done = (k) => k >= 0 && Storage.isCompleted(list[k].id != null ? list[k].id : k + 1);
      return Storage._ruleOpen(list, idx, done, false);
    },
    // open, not complete, and the player has already completed a later level of the campaign: "Skipped - come back later"
    isSkipped(id, levels) {
      if (Storage.isCompleted(id) || !Storage.isUnlocked(id, levels)) return false;
      const { list, idx } = Storage._campaignListOf(id, levels);
      if (idx < 0) return false;
      for (let k = idx + 1; k < list.length; k++) if (Storage.isCompleted(list[k].id)) return true;
      return false;
    },
    // why a level is still locked ("Complete level 20 first - chapter finales can't be skipped."), null when open
    lockText(id, levels) {
      if (Storage.isUnlocked(id, levels)) return null;
      const { lv, campaign, list, idx } = Storage._campaignListOf(id, levels);
      if (lv && !Storage.isPlayable(lv)) return 'This crossing is not available yet.';
      const shut = Storage.campaignLockText(campaign);
      if (shut) return shut;
      const c = Storage.CAMPAIGNS[campaign] || {};
      const name = l => (campaign === 'famous' && l.name ? l.name : 'level ' + l.id);
      for (let k = 0; k < idx; k++) {
        if (Storage.isGate(list[k]) && !Storage.isCompleted(list[k].id))
          return 'Complete ' + name(list[k]) + ' first - ' + (c.gateWord || 'chapter finale') + "s can't be skipped.";
      }
      const prev = list.slice(Math.max(0, idx - 2), idx).map(name);
      return prev.length ? 'Complete ' + prev.join(' or ') + ' to unlock this one.' : 'Complete the previous level first.';
    },
    // the rule in one sentence, for the level-select info tooltips
    unlockRuleText(campaign) {
      const unit = campaign === 'famous' ? 'bridge' : 'level';
      const fin = campaign === 'famous' ? "The finale can't be skipped."
        : (campaign === 'rail' ? 'Line finales (the last level of each line)' : 'Chapter finales (the last level of each chapter)') +
          " can't be skipped: finish one to go on.";
      return 'A ' + unit + ' opens when either of the two ' + unit + 's before it is complete, so you can skip one ' + unit +
        ' and come back later. ' + fin;
    },
    // the levels kept open by the unlock migration (players who had levels open past an unfinished gate keep them)
    keptUnlocks() {
      const u = get('unlocks', null);
      return u && Array.isArray(u.keep) ? u.keep : [];
    },
    // One-time migration to the gate rule (BG.Game.init runs it with every level): each level the old rule
    // (either of the two before it) had open, or that was ever played, but that the gate rule would lock, stays
    // open - the gates only affect levels that were not open yet. Idempotent; returns the kept ids.
    UNLOCK_RULES: 2,
    migrateUnlocks(levels) {
      const u = get('unlocks', null);
      if (u && (u.v | 0) >= Storage.UNLOCK_RULES) return Storage.keptUnlocks();
      const keep = [];
      const prog = Storage.getProgress().levels || {};
      Storage.CAMPAIGN_ORDER.forEach(camp => {
        const list = Storage.campaignLevels(levels || [], camp);
        const done = (k) => k >= 0 && Storage.isCompleted(list[k].id);
        for (let i = 1; i < list.length; i++) {
          if (Storage._ruleOpen(list, i, done, false)) continue;
          const p = prog[list[i].id];
          const played = !!(p && ((p.attempts | 0) > 0 || p.completed));
          if (played || Storage._ruleOpen(list, i, done, true)) keep.push(list[i].id);
        }
      });
      set('unlocks', { v: Storage.UNLOCK_RULES, keep });
      return keep;
    },
    // result: { passed, stars, cost }
    recordResult(id, result) {
      const p = Storage.getProgress();
      const cur = Object.assign({ completed: false, stars: 0, bestCost: null, attempts: 0 }, p.levels[id] || {});
      cur.attempts = (cur.attempts | 0) + 1;
      let improved = false;
      if (result && result.passed) {
        if (!cur.completed) improved = true;
        cur.completed = true;
        if ((result.stars | 0) > cur.stars) { cur.stars = result.stars | 0; improved = true; }
        if (cur.bestCost == null || result.cost < cur.bestCost) { cur.bestCost = result.cost; improved = true; }
      }
      p.levels[id] = cur;
      p.lastLevel = id;
      set('progress', p);
      return { entry: cur, improved };
    },
    setLastLevel(id) {
      const p = Storage.getProgress();
      p.lastLevel = id;
      set('progress', p);
    },
    resetProgress() { rawDel('progress'); set('unlocks', { v: Storage.UNLOCK_RULES, keep: [] }); },

    // ---- designs ----
    saveDesign(id, design) {
      if (!design) return;
      let str;
      try {
        str = BG.Model && BG.Model.serialize ? BG.Model.serialize(design) : JSON.stringify(design);
      } catch (e) {
        try { str = JSON.stringify(design); } catch (e2) { return; }
      }
      if (typeof str !== 'string') { try { str = JSON.stringify(str); } catch (e) { return; } }
      rawSet('design.' + id, str);
    },
    loadDesign(id) {
      const s = rawGet('design.' + id);
      if (!s) return null;
      let d = null;
      try { d = BG.Model && BG.Model.deserialize ? BG.Model.deserialize(s) : JSON.parse(s); } catch (e) {
        try { d = JSON.parse(s); } catch (e2) { d = null; }
      }
      if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.beams)) return null;
      if (!Array.isArray(d.piers)) d.piers = [];
      return d;
    },
    clearDesign(id) { rawDel('design.' + id); },
  };

  BG.Storage = Storage;
})(typeof window !== 'undefined' ? window : globalThis);
