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
    isCompleted(id) { return !!Storage.getLevelProgress(id).completed; },
    totalStars() {
      const lv = Storage.getProgress().levels;
      let t = 0;
      for (const k in lv) t += (lv[k] && lv[k].stars) | 0;
      return t;
    },
    // ---- campaigns ----
    // Road levels (1-50) have no campaign field (or 'road'); Iron Road levels (101-120) have campaign 'rail'.
    RAIL_UNLOCK_LEVEL: 10,
    // declared id range of each campaign; the finale screen shows only after its LAST id, never
    // after whichever level happens to be the last one built so far
    CAMPAIGNS: { road: { first: 1, last: 50 }, rail: { first: 101, last: 120 } },
    campaignFinalId(campaign) { const c = Storage.CAMPAIGNS[campaign]; return c ? c.last : null; },
    isCampaignFinale(level) {
      if (!level || level.id == null) return false;
      return level.id === Storage.campaignFinalId(Storage.campaignOf(level));
    },
    // famous: Famous Bridges (campaign 'famous', ids 201+) is a separate campaign; its unlock rule lives in js/features/famous.js
    campaignOf(level) { return level && (level.campaign === 'rail' || level.campaign === 'famous') ? level.campaign : 'road'; },
    // the levels of one campaign, sorted by id (the order unlocking and "Next level" follow)
    campaignLevels(levels, campaign) {
      return (levels || []).filter(l => l && Storage.campaignOf(l) === campaign)
        .slice().sort((a, b) => (a.id != null ? a.id : 0) - (b.id != null ? b.id : 0));
    },
    // the Iron Road opens once road level 10 is complete (or with ?unlockall)
    isCampaignUnlocked(campaign) {
      if (campaign !== 'rail') return true;
      if (Storage.get('unlockAll', false)) return true;
      return Storage.isCompleted(Storage.RAIL_UNLOCK_LEVEL);
    },
    campaignStars(levels, campaign) {
      let got = 0, max = 0;
      Storage.campaignLevels(levels, campaign).forEach(l => { got += Storage.getStars(l.id); max += 3; });
      return { got, max };
    },
    // A level is unlocked if it is the first one of its campaign (and that campaign is open), or if
    // either of the two levels before it in the same campaign is completed.
    isUnlocked(id, levels) {
      if (Storage.get('unlockAll', false)) return true;
      if (!levels || !levels.length) return id === 1;
      const lv = levels.find(l => l && l.id === id);
      const campaign = lv ? Storage.campaignOf(lv) : (id > 100 ? 'rail' : 'road');
      if (!Storage.isCampaignUnlocked(campaign)) return false;
      const list = lv ? Storage.campaignLevels(levels, campaign) : levels;
      const idx = list.findIndex(l => (l.id != null ? l.id : -1) === id);
      if (idx <= 0) return idx === 0 || id === 1;
      // a level opens when either of the two levels before it is complete, so one hard
      // crossing never blocks progress: it can be skipped and come back to later
      const done = (k) => k >= 0 && Storage.isCompleted(list[k].id != null ? list[k].id : k + 1);
      return done(idx - 1) || done(idx - 2);
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
    resetProgress() { rawDel('progress'); },

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
