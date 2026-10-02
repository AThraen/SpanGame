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
    // A level is unlocked if it is the first one or the previous level (by array order) is completed.
    isUnlocked(id, levels) {
      if (Storage.get('unlockAll', false)) return true;
      if (!levels || !levels.length) return id === 1;
      const idx = levels.findIndex(l => (l.id != null ? l.id : -1) === id);
      if (idx <= 0) return idx === 0 || id === 1;
      const prev = levels[idx - 1];
      return Storage.isCompleted(prev.id != null ? prev.id : idx);
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
