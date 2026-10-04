// BG.Hud — all DOM UI: title, level select, in-level HUD, results, settings, toasts, tooltips.
// Pure view layer: reads state from BG.Game and calls BG.Game methods on interaction.
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  // ------------------------------------------------------------------ helpers
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function money(n) {
    if (I()) return I().money(n);
    n = Math.round(+n || 0);
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');
  }
  // i18n (js/i18n/i18n.js, loaded first; docs/I18N.md). Static markup carries data-i18n="key" (data-i18n-title, -aria,
  // -tip, -html) and is filled by tr(el) = BG.i18n.apply(el), which also re-translates it when the language changes;
  // text built in code uses t(key, params) and is rebuilt in the 'languagechange' handler (Hud._onLanguage).
  function I() { return BG.i18n || null; }
  function t(key, params) { return I() ? I().t(key, params) : key; }
  function tr(el) { if (I()) I().apply(el); return el; }
  function lvName(level) { return level ? (I() ? I().levelText(level, 'name') : level.name) : ''; }
  // data tables (chapters, campaign looks): fields that read their text from the dictionary on every access
  function lazyText(obj, map) { return I() ? I().lazy(obj, map) : obj; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sfx(name, o) { try { BG.Audio && BG.Audio.play(name, o); } catch (e) { /* */ } }
  function game() { return BG.Game || {}; }
  function call(name) {
    const g = game();
    const args = Array.prototype.slice.call(arguments, 1);
    if (g && typeof g[name] === 'function') { try { return g[name].apply(g, args); } catch (e) { console.error(e); } }
    return undefined;
  }

  // ------------------------------------------------------------------ icons
  const P = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    beam: '<circle cx="5" cy="17" r="2.2"/><circle cx="19" cy="7" r="2.2"/><path d="M6.8 15.8l10.4-7.6"/>',
    erase: '<path d="M20 20H9.5L4.3 14.8a2 2 0 010-2.8l8.4-8.4a2 2 0 012.8 0l4.2 4.2a2 2 0 010 2.8L12.4 17.9"/><path d="M8.5 10.5l6 6"/>',
    select: '<path d="M4 4h3M10 4h3M4 4v3M4 10v3" stroke-dasharray="0"/><path d="M16 4h1a3 3 0 013 3v1M4 16v1a3 3 0 003 3h1"/><path d="M11 11l9 3.5-4 1.5-1.5 4z" fill="currentColor"/>',
    pier: '<path d="M8 21V8h8v13"/><path d="M5 8h14"/><path d="M3 21h18"/><path d="M10 12h4M10 16h4"/>',
    mirror: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M8.5 7L3.5 12l5 5z"/><path d="M15.5 7l5 5-5 5z"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
    truss: '<path d="M2 18h20"/><path d="M4 18l4-8 4 8 4-8 4 8"/><path d="M8 10h8"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 10v6M14 10v6"/>',
    play: '<path d="M7 4.5l12.5 7.5L7 19.5z" fill="currentColor"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
    step: '<path d="M5 5l10 7-10 7z" fill="currentColor"/><path d="M18.5 5v14"/>',
    restart: '<path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    pencil: '<path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.2"/><path d="M8 11V7.5a4 4 0 018 0V11"/>',
    star: '<path d="M12 2.6l2.85 5.95 6.55.8-4.83 4.5 1.25 6.5L12 17.15 6.18 20.35l1.25-6.5L2.6 9.35l6.55-.8z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0012 3z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    stress: '<path d="M3 17l5-6 4 4 4-7 5 6"/>',
    grid: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
    volume: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    next: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.6v.2"/>',
    trophy: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 5h3a3 3 0 01-3 4M7 5H4a3 3 0 003 4"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.7.8-2.7 2s1.1 1.6 2.7 2 2.7.9 2.7 2.1-1.1 1.9-2.7 1.9c-1.1 0-2.1-.5-2.6-1.3M12 6.5V8M12 16v1.5"/>',
    road: '<path d="M4 21L9 3M20 21L15 3"/><path d="M12 5v2.5M12 11v2.5M12 17v2.5"/>',
    train: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14"/><circle cx="9" cy="13" r=".6" fill="currentColor"/><circle cx="15" cy="13" r=".6" fill="currentColor"/><path d="M8 16l-3 5M16 16l3 5M6.5 19h11"/>',
    track: '<path d="M3 18h18"/><path d="M3 14l4-3 4 2 4-6 6 4"/><path d="M6 18v2M12 18v2M18 18v2"/>',
    arch: '<path d="M2 6h20"/><path d="M3 20Q12-1 21 20"/><path d="M7.5 6v6M16.5 6v6M12 6v3.5"/>', // arch-tool
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
    follow: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/><circle cx="12" cy="12" r="7.5"/>',
  };
  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
  }
  function starSvg(cls) {
    return '<svg class="star ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P.star.match(/d="([^"]+)"/)[1] + '"/></svg>';
  }

  // vehicle silhouettes (side view, facing right) — 48x20 viewBox
  const VEH = {
    car: '<path d="M4 14v-3.2c0-.8.5-1.4 1.3-1.6L11 8l5-4.2c.5-.4 1.1-.6 1.7-.6h9.8c.7 0 1.3.3 1.7.8L33 8l7.7 1.2c1 .2 1.8 1 1.8 2.1V14z"/><path d="M17.6 5l-3.6 3h8V5zM24 5v3h7.4l-2.8-3z" fill="rgba(255,255,255,.55)"/>',
    van: '<path d="M4 14V5.2C4 4.5 4.6 4 5.3 4h23.5c.6 0 1.2.3 1.5.8L34.5 9l6.6 1.4c.9.2 1.4.9 1.4 1.8V14z"/><path d="M27.5 5.5h2l3 4h-5z" fill="rgba(255,255,255,.55)"/>',
    bus: '<path d="M2.5 14V4.2c0-.9.7-1.6 1.6-1.6h37.8c.9 0 1.7.6 1.9 1.5L45.5 11v3z"/><path d="M5 4.6h5v4H5zM11.5 4.6h5v4h-5zM18 4.6h5v4h-5zM24.5 4.6h5v4h-5zM31 4.6h5v4h-5zM37.5 4.6h4l1.4 4h-5.4z" fill="rgba(255,255,255,.55)"/>',
    truck: '<path d="M2.5 14V3.5h28V14z"/><path d="M31.5 14V6.5h7.2c.6 0 1.2.3 1.5.8l3.6 4.4c.3.4.5.9.5 1.4V14z"/><path d="M34 8h4.4l2.6 3.4H34z" fill="rgba(255,255,255,.55)"/>',
    semi: '<path d="M1 13.5V3.2h31v10.3z"/><path d="M33 14V5.5h6.3c.6 0 1.1.3 1.4.7l3.8 5c.3.4.5.9.5 1.4V14z"/><path d="M35.3 7h3.6l2.8 3.6h-6.4z" fill="rgba(255,255,255,.55)"/>',
    tanker: '<rect x="1" y="3.5" width="31" height="9" rx="4.5"/><path d="M33 14V5.5h6.3c.6 0 1.1.3 1.4.7l3.8 5c.3.4.5.9.5 1.4V14z"/><path d="M35.3 7h3.6l2.8 3.6h-6.4z" fill="rgba(255,255,255,.55)"/>',
    heavy: '<path d="M2 14V9h34v5z"/><path d="M36 14V5h5.4c.6 0 1.1.3 1.4.8l2.2 3.6V14z"/><path d="M6 9l20-7 1.4 1.2L10 9z"/><rect x="6" y="5.5" width="6" height="3.5" rx=".6"/>',
  };
  const WHEELS = {
    car: [11, 35], van: [11, 35], bus: [9, 37], truck: [8, 15, 38], semi: [6, 12, 28, 39], tanker: [6, 12, 28, 39], heavy: [6, 13, 20, 27, 40],
  };
  function vehSvg(type) {
    const body = VEH[type] || VEH.car;
    const wheels = (WHEELS[type] || WHEELS.car).map(x => '<circle cx="' + x + '" cy="15" r="3.4" class="vw"/><circle cx="' + x + '" cy="15" r="1.2" class="vh"/>').join('');
    return '<svg class="veh" viewBox="0 0 48 19" aria-hidden="true"><g class="vb">' + body + '</g>' + wheels + '</svg>';
  }

  // train silhouettes (lead unit + a hint of the next car), same 48x19 box; wheels are smaller and closer
  const TRAIN = {
    steam: '<path d="M2 13.5V6.5h9V3.5h3v3h6.5V4.2h2.4v2.3h6.4c1.2 0 2.2 1 2.2 2.2v4.8z"/><path d="M4 3.2h4.6V6H4z"/><path d="M33 13.5V7h12.5v6.5z" opacity=".55"/><path d="M5.2 8h3.6v2.6H5.2z" fill="rgba(255,255,255,.55)"/>',
    diesel: '<path d="M2 13.5V5.8c0-.8.6-1.4 1.4-1.4h24.8c.7 0 1.3.4 1.6 1l2.6 4.9v3.2z"/><path d="M26 5.6h2.1l2.1 4h-4.2z" fill="rgba(255,255,255,.55)"/><path d="M35 13.5V5.5h11v8z" opacity=".55"/><path d="M5 7h18" stroke="rgba(255,255,255,.35)" stroke-width="1"/>',
    electric: '<path d="M2 13.5V6.8c0-.8.6-1.4 1.4-1.4H22c3.4 0 6.8 1.2 9.5 3.4l3.3 2.6v2.1z"/><path d="M21 6.6h3.4c1.6.2 3.1.8 4.4 1.7l1 .8H21z" fill="rgba(255,255,255,.55)"/><path d="M10 5.4l3-3.2h4M12 2.2h7" stroke="currentColor" stroke-width="1" fill="none"/><path d="M37 13.5V6.5h9v7z" opacity=".55"/>',
    tram: '<path d="M4 13.5V5c0-.9.7-1.6 1.6-1.6h26.8c.9 0 1.6.7 1.6 1.6v8.5z"/><path d="M7 5.4h5v4H7zM14 5.4h5v4h-5zM21 5.4h5v4h-5zM28 5.4h4v4h-4z" fill="rgba(255,255,255,.55)"/><path d="M15 3.4l3-2.6h6M17 .8h8" stroke="currentColor" stroke-width="1" fill="none"/>',
    handcar: '<path d="M8 13.5V10.5h26v3z"/><path d="M20 10.5V5.5M13 4.5l14 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="20" cy="5.4" r="1.4"/>',
    freight: '<path d="M2 13.5V5.8c0-.8.6-1.4 1.4-1.4h12.8c.7 0 1.3.4 1.6 1l2 4v4.1z"/><path d="M15.2 5.6h1.6l1.6 3.2h-3.2z" fill="rgba(255,255,255,.55)"/><path d="M22 13.5V7l2-1.4h10l2 1.4v6.5zM37 13.5V7l1.6-1.4h6.8L47 7v6.5z" opacity=".6"/>',
  };
  const TRAIN_WHEELS = {
    steam: [6, 11, 16, 24, 37, 42], diesel: [5, 9, 22, 26, 38, 43], electric: [6, 10, 25, 29, 40, 44], tram: [9, 13, 25, 29],
    handcar: [13, 29], freight: [5, 9, 15, 25, 33, 40, 44],
  };
  function trainSvg(kind) {
    const k = TRAIN[kind] ? kind : 'diesel';
    const wheels = (TRAIN_WHEELS[k] || []).map(x => '<circle cx="' + x + '" cy="15.6" r="2.3" class="vw"/>').join('');
    return '<svg class="veh train" viewBox="0 0 48 19" aria-hidden="true"><path d="M0 18.2H48" class="vr"/><g class="vb">' + TRAIN[k] + '</g>' + wheels + '</svg>';
  }
  const TRAIN_FALLBACK = {
    handcar: { name: 'Handcar', cars: ['handcar'] }, tram: { name: 'Tram', cars: ['tram'] },
    steam_local: { name: 'Steam Local', cars: ['loco_steam', 'tender', 'coach', 'coach'] },
    steam_express: { name: 'Steam Express', cars: ['loco_steam', 'tender', 'coach', 'coach', 'coach', 'coach'] },
    commuter: { name: 'Commuter', cars: ['loco_diesel', 'coach', 'coach', 'coach'] },
    freight_short: { name: 'Short Freight', cars: ['loco_diesel', 'boxcar', 'boxcar', 'tank_wagon', 'boxcar'] },
    freight_long: { name: 'Long Freight', cars: ['loco_diesel', 'loco_diesel'].concat(Array(12).fill('boxcar')) },
    ore: { name: 'Ore Train', cars: ['loco_diesel', 'loco_diesel'].concat(Array(24).fill('ore_wagon')) },
    highspeed: { name: 'High-Speed', cars: ['hs_power', 'hs_coach', 'hs_coach', 'hs_coach', 'hs_coach', 'hs_power'] },
    highspeed_long: { name: 'High-Speed Long', cars: ['hs_power'].concat(Array(10).fill('hs_coach'), ['hs_power']) },
  };
  function trainPreset(id) {
    const T = BG.Trains && BG.Trains[id];
    if (T && Array.isArray(T.cars)) return T;
    return TRAIN_FALLBACK[id] || { id, name: id || 'Train', cars: [] };
  }
  function trainKind(preset) {
    const cars = (preset && preset.cars) || [];
    if (cars.indexOf('hs_power') >= 0) return 'electric';
    if (cars.indexOf('loco_steam') >= 0) return 'steam';
    if (cars.indexOf('tram') >= 0) return 'tram';
    if (cars.indexOf('handcar') >= 0) return 'handcar';
    if (cars.some(c => /boxcar|ore_wagon|tank_wagon/.test(c))) return 'freight';
    return 'diesel';
  }
  function trainShortName(preset) {
    const n = String((preset && preset.name) || 'Train').replace(/\s*train$/i, '').trim();
    return n || 'Train';
  }
  function railCarMass(type) {
    const C = BG.RailCars && BG.RailCars[type];
    if (!C) return 0;
    if (C.mass) return C.mass;
    return (C.bogies || []).reduce((a, b) => a + (+b.mass || 0), 0);
  }
  function trainMass(preset) { return ((preset && preset.cars) || []).reduce((a, c) => a + railCarMass(c), 0); }
  function isTrainGroup(g) { return !!g && (g.type === 'train' || !!g.train); }
  function fmtMass(kg) { const t = kg / 1000; return (t >= 100 ? Math.round(t).toLocaleString('en-US') : Math.round(t * 10) / 10) + ' t'; }
  // one traffic chip: road vehicle (icon ×count) or train (icon, "2 × Local Steam · 4 cars")
  function trafficChip(g) {
    const n = g.count || 1;
    if (isTrainGroup(g)) {
      const p = trainPreset(g.train);
      const cars = (p.cars || []).length;
      const m = trainMass(p);
      const tip = n + ' × ' + (p.name || g.train) + (cars ? ' — ' + cars + ' car' + (cars === 1 ? '' : 's') : '') + (m ? ', ' + fmtMass(m) : '');
      return `<span class="tr-item tr-train" title="${esc(tip)}">${trainSvg(trainKind(p))}${n > 1 ? '<i>' + n + ' ×</i>' : ''}<em>${esc(trainShortName(p))}</em>${cars > 1 ? '<b>· ' + cars + ' cars</b>' : ''}</span>`;
    }
    return `<span class="tr-item" title="${n} × ${esc(vehicleName(g.type))} (${Math.round(vehicleMass(g.type) / 100) / 10} t)">${vehSvg(g.type)}<b>×${n}</b></span>`;
  }
  // the level's headline train (heaviest group) as a small icon, for rail level tiles
  function trafficIcon(level) {
    const groups = (level && Array.isArray(level.traffic) ? level.traffic : []).filter(isTrainGroup);
    if (!groups.length) return trainSvg('diesel');
    let best = groups[0], bm = -1;
    groups.forEach(g => { const m = trainMass(trainPreset(g.train)) || (trainPreset(g.train).cars || []).length; if (m > bm) { bm = m; best = g; } });
    return trainSvg(trainKind(trainPreset(best.train)));
  }
  function trafficSummary(groups) {
    return groups.map(g => {
      const n = g.count || 1;
      if (isTrainGroup(g)) { const p = trainPreset(g.train); return n + ' ' + (p.name || 'train') + (n > 1 ? 's' : ''); }
      return n + ' ' + vehicleName(g.type);
    }).join(', ');
  }

  // ------------------------------------------------------------------ data helpers
  const FALLBACK_MATERIALS = {
    road: { id: 'road', name: 'Road', color: '#3b3f46', costPerMeter: 100, tensionLimit: 4.5e5, compressionLimit: 4.5e5, maxLength: 6, isRoad: true },
    reinforced_road: { id: 'reinforced_road', name: 'Reinforced Road', color: '#4a4f5a', costPerMeter: 180, tensionLimit: 9e5, compressionLimit: 9e5, maxLength: 6, isRoad: true },
    wood: { id: 'wood', name: 'Wood', color: '#b07a44', costPerMeter: 50, tensionLimit: 2.4e5, compressionLimit: 2e5, maxLength: 6 },
    steel: { id: 'steel', name: 'Steel', color: '#8c97a8', costPerMeter: 120, tensionLimit: 9e5, compressionLimit: 8e5, maxLength: 10 },
    rope: { id: 'rope', name: 'Rope', color: '#c8a46a', costPerMeter: 20, tensionLimit: 1.2e5, compressionLimit: 0, maxLength: 20, tensionOnly: true },
    cable: { id: 'cable', name: 'Steel Cable', color: '#5f6873', costPerMeter: 60, tensionLimit: 1.6e6, compressionLimit: 0, maxLength: 40, tensionOnly: true },
    // Iron Road (only used until BG.Materials provides them)
    rail: { id: 'rail', name: 'Rail Track', color: '#5b4a3a', costPerMeter: 220, tensionLimit: 1.2e6, compressionLimit: 1.2e6, maxLength: 6, isRail: true },
    masonry: { id: 'masonry', name: 'Masonry', color: '#b8a68a', costPerMeter: 40, tensionLimit: 2e4, compressionLimit: 6e6, maxLength: 5 },
    girder: { id: 'girder', name: 'Box Girder', color: '#4f6f8f', costPerMeter: 300, tensionLimit: 2.6e6, compressionLimit: 2.4e6, maxLength: 12 },
  };
  const MAT_ORDER = ['road', 'reinforced_road', 'rail', 'wood', 'steel', 'girder', 'masonry', 'rope', 'cable'];
  function materials() {
    const M = BG.Materials;
    if (M && typeof M === 'object' && Object.keys(M).length) return M;
    return FALLBACK_MATERIALS;
  }
  function material(id) { return materials()[id] || FALLBACK_MATERIALS[id] || { id, name: id, costPerMeter: 0, maxLength: 0 }; }
  function levelMaterials(level) {
    const M = materials();
    let ids = (level && Array.isArray(level.materials) && level.materials.length) ? level.materials.slice() : MAT_ORDER.filter(id => M[id]);
    return ids;
  }
  function strengthOf(m) { return Math.max(+m.tensionLimit || 0, +m.compressionLimit || 0); }
  // stone-like: strong in compression, (almost) nothing in tension
  function compressionOnly(m) { return !m.tensionOnly && (+m.compressionLimit || 0) > 0 && (+m.tensionLimit || 0) < 0.05 * (+m.compressionLimit || 0); }
  function strengthRange() {
    const M = materials();
    let lo = Infinity, hi = 0;
    // compression-only materials (masonry) would squash every other bar: they just clamp to full
    for (const k in M) { if (compressionOnly(M[k])) continue; const s = strengthOf(M[k]); if (s > 0) { lo = Math.min(lo, s); hi = Math.max(hi, s); } }
    if (!isFinite(lo)) lo = 1;
    return [lo, Math.max(hi, lo * 1.0001)];
  }
  function vehicleName(type) {
    const V = BG.Vehicles && BG.Vehicles[type];
    if (V && V.name) return V.name;
    return { car: 'Car', van: 'Van', bus: 'Bus', truck: 'Truck', semi: 'Semi-trailer', tanker: 'Tanker', heavy: 'Heavy hauler' }[type] || type;
  }
  function vehicleMass(type) {
    const V = BG.Vehicles && BG.Vehicles[type];
    if (V && V.mass) return V.mass;
    return { car: 1200, van: 2500, bus: 12000, truck: 20000, semi: 38000, tanker: 45000, heavy: 60000 }[type] || 1500;
  }

  const THEMES = {
    meadow: { sky: ['#8fd3f4', '#d8f3ff'], ground: '#5aa35a', deep: '#3d7a44', accent: '#7bd389', water: '#3d9bd6' },
    autumn: { sky: ['#f7b267', '#fde4c3'], ground: '#b5652d', deep: '#7a3e1d', accent: '#ffb347', water: '#4b86b4' },
    desert: { sky: ['#f9d29d', '#fff1d6'], ground: '#d8a25e', deep: '#a8693a', accent: '#f4d06f', water: '#3aa6b9' },
    canyon: { sky: ['#f29e6d', '#ffd9b8'], ground: '#b4532a', deep: '#6e2b19', accent: '#ff8a5b', water: '#2d8bb0' },
    snow: { sky: ['#bcd7f2', '#eef6ff'], ground: '#e8f0f8', deep: '#9fb4c9', accent: '#9ad0ff', water: '#4c7fa8' },
    night: { sky: ['#141a3d', '#36407a'], ground: '#2a3550', deep: '#161d30', accent: '#8f9bff', water: '#22406a' },
    city: { sky: ['#9fb3d8', '#e2e9f5'], ground: '#5c6577', deep: '#363c49', accent: '#7aa2ff', water: '#3c6e9e' },
    tropical: { sky: ['#5ed6e0', '#d4fbff'], ground: '#4fb06a', deep: '#2b7a4b', accent: '#4fd1c5', water: '#1fb5c9' },
    volcanic: { sky: ['#5a1d24', '#d1553a'], ground: '#3a2a2a', deep: '#1c1414', accent: '#ff5d73', water: '#c4442a' },
  };
  function theme(name) { return THEMES[name] || THEMES.meadow; }

  const SHORT_MAT = { reinforced_road: 'Reinf. Road', cable: 'Cable', rail: 'Rail Track', girder: 'Box Girder' };
  // a chapter's name / desc are getters that read hud.chapter.<key>.name / .desc in the current language
  function chapterText(ch) { return lazyText(ch, { name: 'hud.chapter.' + ch.key + '.name', desc: 'hud.chapter.' + ch.key + '.desc' }); }
  const RAIL_CHAPTERS = [
    { n: 1, key: 'rail1', from: 101, to: 105, theme: 'meadow', campaign: 'rail' },
    { n: 2, key: 'rail2', from: 106, to: 110, theme: 'autumn', campaign: 'rail' },
    { n: 3, key: 'rail3', from: 111, to: 115, theme: 'canyon', campaign: 'rail' },
    { n: 4, key: 'rail4', from: 116, to: 120, theme: 'city', campaign: 'rail' },
  ].map(chapterText);
  // ------------------------------------------------------------------ campaigns
  // The level select shows one tab per campaign. The RULES (id ranges, unlock level, finale ids, which levels
  // are playable) live in BG.Storage.CAMPAIGNS; this table holds how each campaign LOOKS: tab icon, subtitle,
  // chapters (or a custom panel renderer), labels and finale text. Feature modules add campaigns with
  // BG.Hud.registerCampaign(id, ui) (js/features/famous.js registers 'famous').
  const CAMPAIGN_UI = {
    road: lazyText({
      id: 'road', icon: () => icon('road'), cls: '', levelK: 'LEVEL',
      chapters: () => CHAPTERS, maxDefault: 150,
      finale: {
        banner: 'All crossings complete', title: 'You spanned them all!',
        text: (starLine, res) => 'Fifty bridges, from a wobbly plank to a 150 m suspension span. ' + starLine +
          (res && res.hasNext ? ' A hidden chapter has opened: the Forces of Nature.' : '') +
          (levelsList().some(l => campaignOf(l) === 'rail') ? ' The Iron Road is waiting on the level select.' : ''),
      },
      bonusFinale: {
        banner: 'Forces of Nature weathered', title: 'Storm-proof!',
        text: starLine => 'Hurricane, earthquake and a galloping deck - your bridges rode out all three. ' + starLine,
      },
      // finales of the branching bonus chapters (BG.Storage.CAMPAIGNS.road.bonus), keyed by chapter id
      bonusFinales: {
        anchorages: {
          banner: 'Anchorages complete', title: 'Firmly anchored!',
          text: starLine => 'Deadmen, guy lines, a lone pylon and a grand suspension span - every pull carried safely back into the ground. ' + starLine,
        },
      },
    }, { name: 'hud.camp.road.name', sub: 'hud.camp.road.sub', allLabel: 'hud.camp.road.all' }),
    rail: lazyText({
      id: 'rail', icon: () => icon('train'), cls: 'is-rail', levelK: 'RAIL',
      chapters: () => RAIL_CHAPTERS, maxDefault: 60,
      finale: {
        banner: 'Iron Road complete', title: 'End of the line!',
        text: starLine => 'Twenty railway bridges, from a handcar over a creek to high-speed expresses on a double-deck span. ' + starLine,
      },
      locked: () => `<div class="camp-locked glass">
            <div class="cl-art">${trainSvg('steam')}</div>
            <div class="cl-text"><h3>${icon('lock')}${esc(t('hud.camp.rail.closed'))}</h3>
            <p>${esc(t('hud.camp.rail.closedText', { n: (stor() && stor().CAMPAIGNS && stor().CAMPAIGNS.rail.unlockAfter) || 10 }))}</p></div>
          </div>`,
    }, { name: 'hud.camp.rail.name', sub: 'hud.camp.rail.sub', allLabel: 'hud.camp.rail.all' }),
  };
  const CAMPAIGN_ORDER = ['road', 'rail'];
  function campaignOf(level) {
    const S = stor();
    if (S && S.campaignOf) { try { return S.campaignOf(level); } catch (e) { /* */ } }
    return level && level.campaign && level.campaign !== 'road' ? level.campaign : 'road';
  }
  function campaignUi(campaign) { return CAMPAIGN_UI[campaign] || CAMPAIGN_UI.road; }
  // the level-select subtitle; the Roads mention their hidden bonus chapters once they are revealed
  function campaignSub(campaign) {
    const sub = campaignUi(campaign).sub || '';
    if (campaign !== 'road') return sub;
    const hidden = hiddenLevelIds();
    const bonus = sortChapters(CHAPTERS).filter(ch => ch.hidden && !hidden.includes(ch.from) && levelsList().some(l => l && l.id >= ch.from && l.id <= ch.to));
    return bonus.length ? t('hud.levels.subBonus', { sub, chapters: bonus.map(ch => ch.name).join(', ') }) : sub;
  }
  // chapters in level order (bonus chapters are registered by different modules: Anchorages here, Forces of Nature
  // by forces-fx.js)
  function sortChapters(list) { return list.slice().sort((a, b) => a.from - b.from); }
  function chaptersFor(campaign) { const c = campaignUi(campaign); return c.chapters ? sortChapters(c.chapters()) : []; }
  function campaignOpen(campaign) {
    const S = stor();
    try { return S && S.isCampaignUnlocked ? S.isCampaignUnlocked(campaign) : true; } catch (e) { return true; }
  }
  function railCampaignOpen() { return campaignOpen('rail'); }
  function campaignLockText(campaign) {
    const S = stor();
    try { if (S && S.campaignLockText) return S.campaignLockText(campaign); } catch (e) { /* */ }
    return null;
  }
  // the campaigns that get a tab: registered, and with at least one level in BG.Levels
  function campaignTabs() {
    return CAMPAIGN_ORDER.filter(c => c === 'road' || levelsList().some(l => campaignOf(l) === c));
  }
  // {got, max} stars of one campaign (playable levels; the Roads leave out hidden bonus levels)
  function campaignStarsOf(campaign) {
    const S = stor();
    let r;
    try { r = S && S.campaignStars ? S.campaignStars(levelsList(), campaign) : { got: S ? S.totalStars() : 0, max: 150 }; } catch (e) { r = { got: 0, max: 0 }; }
    if (campaign === 'road') r.max = Math.max(0, r.max - 3 * hiddenLevelIds().length);
    return r;
  }
  // what the player sees as the level number: the real id everywhere (1-50 on the Roads,
  // 101-120 on the Iron Road), so tiles, chapter headers and the HUD all agree
  function displayNum(level) {
    const id = levelId(level);
    return id == null ? '?' : id;
  }
  function levelLabel(level) { return t('core.level', { n: displayNum(level) }); }
  // the short name a campaign uses for one of its levels (title Continue / Resume, history): famous bridges by name
  function shortLabel(level) {
    const cu = campaignUi(campaignOf(level));
    return cu.continueLabel ? cu.continueLabel(level) : levelLabel(level);
  }
  // the number on the level badge (famous bridges count 1-12 within their campaign)
  function badgeNum(level) {
    const cu = campaignUi(campaignOf(level));
    return cu.levelNum ? cu.levelNum(level) : displayNum(level);
  }
  // top-bar subtitle: only facts that are true of THIS level. Chapter names describe a whole chapter ("Piers & Cables"
  // has levels without piers or cables), so the bar names the chapter by number and lists the level's own gap, piers
  // and time limit; a themed bonus chapter (every level shares the theme) keeps its name.
  function levelSubText(level, camp, cu, ch, gap) {
    const piers = level.maxPiers | 0;
    const chap = ch ? (ch.hidden ? ch.name : (camp === 'rail' ? 'Line ' : 'Chapter ') + ch.n) : null;
    return [camp !== 'road' ? cu.name : null, chap, gap ? gap + ' m gap' : null,
      piers > 0 ? piers + (piers === 1 ? ' pier' : ' piers') : null,
      level.timeLimit ? level.timeLimit + ' s limit' : null].filter(Boolean).join(' · ');
  }
  const CHAPTERS = [
    { n: 1, key: 'road1', from: 1, to: 5, theme: 'meadow' },
    { n: 2, key: 'road2', from: 6, to: 10, theme: 'autumn' },
    { n: 3, key: 'road3', from: 11, to: 20, theme: 'desert' },
    { n: 4, key: 'road4', from: 21, to: 30, theme: 'tropical' },
    { n: 5, key: 'road5', from: 31, to: 40, theme: 'canyon' },
    { n: 6, key: 'road6', from: 41, to: 50, theme: 'volcanic' },
    // hidden bonus chapter that branches off after level 40 (rules: BG.Storage.CAMPAIGNS.road.bonus); Forces of Nature
    // (n 7, 51-53) is added by js/features/forces-fx.js
    { n: 8, key: 'anchorages', from: 54, to: 58, theme: 'autumn', hidden: true },
  ].map(chapterText);

  function levelsList() { return Array.isArray(BG.Levels) ? BG.Levels : []; }
  function levelForSlot(n) {
    const L = levelsList();
    return L.find(l => l && l.id === n) || (L[n - 1] && L[n - 1].id == null ? L[n - 1] : null);
  }
  function levelId(level) {
    if (!level) return null;
    if (level.id != null) return level.id;
    const i = levelsList().indexOf(level);
    return i >= 0 ? i + 1 : null;
  }
  function stor() { return BG.Storage || null; }
  function starsFor(id) { const S = stor(); try { return S ? S.getStars(id) : 0; } catch (e) { return 0; } }
  function unlocked(id) {
    const S = stor();
    try { return S ? S.isUnlocked(id, levelsList()) : id === 1; } catch (e) { return id === 1; }
  }
  // unlock rule helpers (BG.Storage decides; the level select explains): skipped-but-open levels, chapter finales
  function skipped(id) {
    const S = stor();
    try { return !!(S && S.isSkipped && S.isSkipped(id, levelsList())); } catch (e) { return false; }
  }
  function isGateLevel(level) {
    const S = stor();
    try { return !!(S && S.isGate && S.isGate(level)); } catch (e) { return false; }
  }
  function unlockRuleText(campaign) {
    const S = stor();
    try { if (S && S.unlockRuleText) return S.unlockRuleText(campaign); } catch (e) { /* */ }
    return t('hud.unlock.rule.road');
  }
  function lockTextFor(id) {
    const S = stor();
    try { if (S && S.lockText) return S.lockText(id, levelsList()); } catch (e) { /* */ }
    return null;
  }
  // the small (i) button on chapter headers: hover / focus shows the rule (desktop), a tap toasts it (touch)
  function unlockInfoBtn(campaign) {
    const rule = unlockRuleText(campaign);
    return '<button class="ch-info" type="button" data-act="unlockInfo" data-camp-info="' + esc(campaign) + '" aria-label="' + esc(t('hud.levels.unlockInfo', { rule })) + '" data-tip="' + esc(rule) + '">' + icon('info') + '</button>';
  }
  // forces: ids of levels in hidden bonus chapters ({hidden: true}) that are not revealed yet (none of their
  // levels unlocked); they stay out of the level select and out of the star / badge totals until then
  function hiddenLevelIds() {
    const out = [];
    CHAPTERS.concat(RAIL_CHAPTERS).forEach(ch => {
      if (!ch.hidden) return;
      const lv = levelsList().filter(l => l && l.id >= ch.from && l.id <= ch.to);
      if (!lv.some(l => unlocked(l.id))) lv.forEach(l => out.push(l.id));
    });
    return out;
  }

  // mini terrain thumbnail for level tiles
  function thumbSvg(level) {
    const th = theme(level && level.theme);
    const t = (level && level.terrain) || { leftEdge: 0, leftY: 0, rightEdge: 20, rightY: 0, floorY: -10, waterY: -7 };
    const gap = Math.max(4, (t.rightEdge - t.leftEdge) || 20);
    const pad = gap * 0.35;
    const x0 = t.leftEdge - pad, x1 = t.rightEdge + pad;
    const top = Math.max(t.leftY || 0, t.rightY || 0) + gap * 0.25;
    const bot = Math.min(t.floorY != null ? t.floorY : -10, t.waterY != null ? t.waterY : 0) - gap * 0.06;
    const W = 100, H = 56;
    const sx = x => ((x - x0) / (x1 - x0)) * W;
    const sy = y => ((top - y) / (top - bot)) * H;
    const fy = sy(t.floorY != null ? t.floorY : bot);
    let s = '<svg class="thumb" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">';
    s += '<defs><linearGradient id="tg' + levelId(level) + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + th.sky[0] + '"/><stop offset="1" stop-color="' + th.sky[1] + '"/></linearGradient></defs>';
    s += '<rect width="100" height="56" fill="url(#tg' + levelId(level) + ')"/>';
    s += '<path d="M0 ' + (H * 0.62) + ' Q25 ' + (H * 0.42) + ' 50 ' + (H * 0.58) + ' T100 ' + (H * 0.5) + ' V56 H0Z" fill="' + th.deep + '" opacity=".25"/>';
    if (t.waterY != null) s += '<rect x="0" y="' + sy(t.waterY) + '" width="100" height="' + (H - sy(t.waterY)) + '" fill="' + th.water + '" opacity=".9"/>';
    // valley floor + banks
    s += '<path d="M0 ' + sy(t.leftY || 0) + ' H' + sx(t.leftEdge) + ' L' + (sx(t.leftEdge) + 3) + ' ' + fy + ' H' + (sx(t.rightEdge) - 3) + ' L' + sx(t.rightEdge) + ' ' + sy(t.rightY || 0) + ' H100 V56 H0Z" fill="' + th.ground + '"/>';
    if (t.waterY != null) s += '<rect x="' + (sx(t.leftEdge) + 1) + '" y="' + sy(t.waterY) + '" width="' + (sx(t.rightEdge) - sx(t.leftEdge) - 2) + '" height="' + Math.max(0, fy - sy(t.waterY)) + '" fill="' + th.water + '" opacity=".85"/>';
    (level && level.pierZones || []).forEach(z => {
      s += '<rect x="' + sx(z.x0) + '" y="' + (fy - 1.2) + '" width="' + Math.max(1, sx(z.x1) - sx(z.x0)) + '" height="1.2" fill="#fff" opacity=".6"/>';
    });
    if (campaignOf(level) === 'rail') {
      // railway: the track runs in from both banks (sleepers + rail), dashed across the gap still to bridge
      const yl = sy(t.leftY || 0), yr = sy(t.rightY || 0), xl = sx(t.leftEdge), xr = sx(t.rightEdge);
      const ties = (a, b, y) => { let p = ''; for (let x = a + 1; x < b - 0.5; x += 2.6) p += 'M' + x.toFixed(1) + ' ' + (y - 0.2).toFixed(1) + 'v1.6'; return p; };
      s += '<path d="' + ties(0, xl, yl) + ties(xr, 100, yr) + '" stroke="#5b4636" stroke-width="1.1"/>';
      s += '<path d="M0 ' + (yl - 0.4) + 'H' + xl + 'M' + xr + ' ' + (yr - 0.4) + 'H100" stroke="#d9dde3" stroke-width=".8"/>';
      s += '<path d="M' + xl + ' ' + yl + ' L' + xr + ' ' + yr + '" stroke="#ffd166" stroke-width="1.1" stroke-dasharray="1.6 2.2" opacity=".85"/>';
    } else {
      s += '<path d="M' + sx(t.leftEdge) + ' ' + sy(t.leftY || 0) + ' L' + sx(t.rightEdge) + ' ' + sy(t.rightY || 0) + '" stroke="#fff" stroke-width="1.2" stroke-dasharray="2 2" opacity=".75"/>';
    }
    s += '</svg>';
    return s;
  }

  // ------------------------------------------------------------------ HUD object
  const Hud = {
    el: {},
    screen: null,
    mode: null,
    level: null,
    _shownCost: 0,
    _sig: {},
    _hintTimer: 0,
    _resultTimers: [],

    init(g) {
      if (I()) I().init();
      const ui = document.getElementById('ui') || document.body.appendChild(h('<div id="ui"></div>'));
      this.root = ui;
      ui.innerHTML = '';
      ui.appendChild(this._buildTitle());
      ui.appendChild(this._buildLevelSelect());
      ui.appendChild(this._buildLevelHud());
      ui.appendChild(this._buildSettings());
      ui.appendChild(h('<div id="toasts" class="toasts" aria-live="polite"></div>'));
      ui.appendChild(h('<div id="tooltip" class="tooltip" role="tooltip"></div>'));
      ui.appendChild(h('<div id="fader" class="fader"></div>'));
      this.el.toasts = $('#toasts'); this.el.tooltip = $('#tooltip'); this.el.fader = $('#fader');

      // never let buttons keep focus (Space must go to the game, not "click" the button)
      ui.addEventListener('click', e => {
        const b = e.target.closest('button, .tile, input[type=checkbox]');
        if (b && b.blur) setTimeout(() => b.blur(), 0);
      });
      ui.addEventListener('pointerenter', e => {
        if (e.target && e.target.matches && e.target.matches('button:not(:disabled), .tile.open')) sfx('hover');
      }, true);
      const loader = document.getElementById('boot');
      if (loader) { loader.classList.add('gone'); setTimeout(() => loader.remove(), 700); }
      this.applySettings();
      if (I() && !this._i18nBound) { this._i18nBound = true; I().on('languagechange', ev => this._onLanguage(ev)); }
    },
    // the language changed: BG.i18n.apply has already re-translated every [data-i18n] element; rebuild the text
    // that is built in code. Feature modules that wrap these methods (Resume, Daily, badge chips) re-render with them.
    _onLanguage() {
      this.refreshTitle();
      if (this.el.levels && this.screen === 'levelSelect') this.buildLevelSelect();
      this.applySettings();
      this._sig = {};
    },

    // ---------------------------------------------------------------- title
    _buildTitle() {
      const el = h(`
        <section id="screen-title" class="screen">
          <div class="title-vignette"></div>
          <div class="title-wrap">
            <svg class="logo-art" viewBox="0 0 600 140" aria-hidden="true">
              <defs>
                <linearGradient id="cableG" x1="0" x2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#7fe0ff"/></linearGradient>
              </defs>
              <path class="la tower" d="M150 128V18M450 128V18"/>
              <path class="la cable" d="M10 104 Q80 100 150 18 Q300 132 450 18 Q520 100 590 104"/>
              <path class="la hangers" d="M190 50V128M225 74V128M260 92V128M300 99V128M340 92V128M375 74V128M410 50V128M60 101V128M100 82V128M500 82V128M540 101V128"/>
              <path class="la deck" d="M0 128H600"/>
            </svg>
            <h1 class="logo" aria-label="SPAN"><span>S</span><span>P</span><span>A</span><span>N</span></h1>
            <p class="tagline" data-i18n-html="hud.title.tagline"></p>
            <div class="title-buttons">
              <button class="btn btn-primary btn-xl" data-act="play">${icon('play')}<span data-i18n="hud.title.play"></span></button>
              <button class="btn btn-glass btn-xl" data-act="continue" hidden>${icon('next')}<span class="lbl" data-i18n="hud.title.continue"></span></button>
            </div>
            <div class="title-meta">
              <span class="chip" data-ref="titleStars" data-i18n-title="hud.title.starsTip">${starSvg('on')}<b>0</b> / 150</span>
              <button class="btn btn-icon btn-glass" data-act="settings" data-i18n-title="core.settings">${icon('gear')}</button>
            </div>
          </div>
          <div class="title-foot" data-i18n="hud.title.foot"></div>
        </section>`);
      tr(el);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        sfx('click');
        const act = b.dataset.act;
        if (act === 'play') call('goLevelSelect');
        else if (act === 'continue') call('continueGame');
        else if (act === 'settings') this.openSettings();
      });
      this.el.title = el;
      return el;
    },
    refreshTitle() {
      const el = this.el.title;
      if (!el) return;
      const S = stor();
      let total = 0;
      try { total = S ? S.totalStars() : 0; } catch (e) { /* */ }
      $('[data-ref=titleStars] b', el).textContent = total;
      // every campaign's playable levels (stubs and the still-hidden bonus chapter have nothing to earn yet)
      const max = campaignTabs().reduce((t, c) => t + campaignStarsOf(c).max, 0);
      $('[data-ref=titleStars]', el).lastChild.textContent = ' / ' + (max || 150);
      const cont = $('[data-act=continue]', el);
      const target = call('continueTarget');
      const prog = S ? S.getProgress() : null;
      const has = prog && (prog.lastLevel != null || Object.keys(prog.levels || {}).length);
      if (has && target) {
        cont.hidden = false;
        const camp = campaignOf(target);
        $('.lbl', cont).textContent = t('hud.title.continueLevel', { level: shortLabel(target) });
        CAMPAIGN_ORDER.forEach(c => { const k = campaignUi(c).cls; if (k) cont.classList.toggle(k, c === camp); });
      } else cont.hidden = true;
    },

    // ---------------------------------------------------------------- level select
    _buildLevelSelect() {
      const el = h(`
        <section id="screen-levels" class="screen">
          <header class="ls-head glass">
            <button class="btn btn-icon btn-ghost" data-act="back" data-i18n-title="hud.levels.back">${icon('back')}</button>
            <div class="ls-title"><h2 data-i18n="hud.levels.heading"></h2><p data-ref="lsSub"></p></div>
            <div class="camp-tabs" role="tablist" data-i18n-aria="hud.levels.campaigns"></div>
            <div class="ls-right">
              <span class="chip chip-lg" data-ref="lsStars" data-i18n-title="hud.levels.starsTip">${starSvg('on')}<b>0</b> / 150</span>
              <button class="btn btn-icon btn-ghost" data-act="settings" data-i18n-title="core.settings">${icon('gear')}</button>
            </div>
          </header>
          <div class="ls-scroll"><div class="chapters"></div></div>
        </section>`);
      tr(el);
      el.addEventListener('click', e => {
        const tab = e.target.closest('[data-camp]');
        if (tab) {
          if (tab.dataset.camp === this.tab) return;
          sfx(tab.classList.contains('locked') ? 'error' : 'click');
          this.setCampaignTab(tab.dataset.camp);
          return;
        }
        const b = e.target.closest('[data-act]');
        if (b) {
          sfx('click');
          if (b.dataset.act === 'back') call('goTitle');
          else if (b.dataset.act === 'settings') this.openSettings();
          else if (b.dataset.act === 'unlockInfo') this.toast(unlockRuleText(b.dataset.campInfo || this.tab), 'info', 6500);
          return;
        }
        const tile = e.target.closest('.tile');
        if (!tile) return;
        if (tile.classList.contains('open')) { sfx('click'); call('openLevel', +tile.dataset.id); }
        else {
          sfx('error');
          tile.classList.remove('nope'); void tile.offsetWidth; tile.classList.add('nope');
          const shut = campaignLockText(this.tab) || lockTextFor(+tile.dataset.id);
          this.toast(tile.classList.contains('soon') ? t('hud.levels.surveyed')
            : shut || t('hud.levels.lockedDefault'), 'info', 3600);
        }
      });
      this.el.levels = el;
      return el;
    },
    // campaign tab on the level select: any campaign in CAMPAIGN_ORDER ('road' | 'rail' | 'famous' ...).
    // noBuild: just remember it (the screen is built later); then it never lands on a locked tab.
    tab: 'road',
    setCampaignTab(campaign, noBuild) {
      this.tab = CAMPAIGN_UI[campaign] && campaignTabs().includes(campaign) ? campaign : 'road';
      // returning to the level select from a level: never land on a locked tab
      if (noBuild && !campaignOpen(this.tab)) this.tab = 'road';
      if (!noBuild && this.el.levels) {
        this.buildLevelSelect();
        const sc = $('.ls-scroll', this.el.levels);
        if (sc) sc.scrollTop = 0;
      }
    },
    // registers a campaign's look (its rules live in BG.Storage.CAMPAIGNS). ui: { name, sub, icon() -> svg,
    // cls (tab / tile class), levelK (top-bar badge word), allLabel (results button after the last level),
    // modeClass (#screen-levels class while active), panelClass + render(panel, info) (own tile panel instead of
    // chapters), continueLabel(level), finale: { banner, title, text(starLine) } }
    // Text fields may be getters (BG.i18n.lazy) or given as keys: nameKey / subKey / allLabelKey (translated on read).
    registerCampaign(id, ui) {
      const u = lazyText({ id, icon: () => icon('road'), cls: 'is-' + id, levelK: 'LEVEL', sub: '' }, { name: () => id, allLabel: 'hud.camp.road.all' });
      Object.defineProperties(u, Object.getOwnPropertyDescriptors(ui || {}));
      const keys = {};
      ['name', 'sub', 'allLabel'].forEach(k => { if (u[k + 'Key']) keys[k] = u[k + 'Key']; });
      CAMPAIGN_UI[id] = lazyText(u, keys);
      if (!CAMPAIGN_ORDER.includes(id)) CAMPAIGN_ORDER.push(id);
      if (this.el.levels && this.screen === 'levelSelect') this.buildLevelSelect();
    },
    campaignUi(id) { return CAMPAIGN_UI[id] || null; },
    campaignTabs() { return campaignTabs(); },
    campaignStars(id) { return campaignStarsOf(id); },
    _renderCampaignTabs(el, camp) {
      const bar = $('.camp-tabs', el);
      if (!bar) return;
      const S = stor();
      bar.innerHTML = campaignTabs().map(c => {
        const u = campaignUi(c), open = campaignOpen(c), st = campaignStarsOf(c);
        const gate = S && S.CAMPAIGNS && S.CAMPAIGNS[c] ? S.CAMPAIGNS[c].unlockAfter : null;
        const small = open ? st.got + ' / ' + (st.max || u.maxDefault || 0) + ' ★' : esc(t('hud.levels.tabLocked', { n: gate }));
        return '<button class="camp-tab ' + (u.cls || '') + (c === camp ? ' active' : '') + (open ? '' : ' locked') + '" role="tab" data-camp="' + c + '" aria-selected="' + (c === camp) + '" title="' + esc(open ? campaignSub(c) : campaignLockText(c) || '') + '">' +
          u.icon() + '<span class="ct-txt"><b>' + esc(u.name) + '</b><small data-ref="ct' + c.charAt(0).toUpperCase() + c.slice(1) + '">' + small + '</small></span><span class="ct-lock">' + icon('lock') + '</span></button>';
      }).join('');
    },
    buildLevelSelect() {
      const el = this.el.levels;
      const wrap = $('.chapters', el);
      wrap.innerHTML = '';
      const S = stor();
      if (!CAMPAIGN_UI[this.tab] || !campaignTabs().includes(this.tab)) this.tab = 'road';
      const camp = this.tab, cu = campaignUi(camp);
      const open = campaignOpen(camp);
      const cur = campaignStarsOf(camp);
      $('[data-ref=lsStars] b', el).textContent = cur.got;
      $('[data-ref=lsStars]', el).lastChild.textContent = ' / ' + (cur.max || cu.maxDefault || 0);
      $('[data-ref=lsSub]', el).textContent = campaignSub(camp);
      this._renderCampaignTabs(el, camp);
      CAMPAIGN_ORDER.forEach(c => {
        const u = campaignUi(c);
        el.classList.toggle('camp-' + c, c === camp);
        if (u.modeClass) el.classList.toggle(u.modeClass, c === camp);
      });
      // a campaign with its own tile panel (Famous Bridges): one panel per campaign, in place of the chapters
      $$('.camp-panel', el).forEach(p => { if (p.dataset.camp !== camp) { p.hidden = true; p.innerHTML = ''; } });
      if (cu.render) {
        let panel = $('.camp-panel[data-camp="' + camp + '"]', el);
        if (!panel) {
          panel = h('<div class="camp-panel ' + (cu.panelClass || '') + '" data-camp="' + camp + '"></div>');
          $('.ls-scroll', el).appendChild(panel);
        }
        panel.hidden = false;
        wrap.hidden = true;
        try { cu.render(panel, { open, stars: cur, lockText: campaignLockText(camp) }); } catch (e) { console.error(e); }
        return;
      }
      wrap.hidden = false;
      if (!open && cu.locked) wrap.appendChild(h(cu.locked()));
      chaptersFor(camp).forEach(ch => {
        // forces: hidden bonus chapters stay out of the list until one of their levels is unlocked
        if (ch.hidden && hiddenLevelIds().includes(ch.from)) return;
        const th = theme(ch.theme);
        let chStars = 0, chMax = 0, anyOpen = false;
        const tiles = [];
        for (let n = ch.from; n <= ch.to; n++) {
          const lv = levelForSlot(n);
          const num = n;
          if (!lv) {
            tiles.push(`<div class="tile soon ${cu.cls || ''}" data-id="${n}" style="--acc:${th.accent}"><div class="tile-art soon-art"><span>${num}</span></div><div class="tile-body"><div class="tile-name">${esc(t('core.comingSoon'))}</div><div class="tile-stars dim">${starSvg()}${starSvg()}${starSvg()}</div></div></div>`);
            continue;
          }
          const id = levelId(lv);
          const isOpen = unlocked(id);
          const st = starsFor(id);
          chStars += st; chMax += 3;
          if (isOpen) anyOpen = true;
          const lth = theme(lv.theme || ch.theme);
          const done = S && S.isCompleted && S.isCompleted(id);
          const rail = campaignOf(lv) === 'rail';
          const skip = isOpen && !done && skipped(id);
          const gate = isGateLevel(lv);
          const gateTip = esc(t(rail ? 'hud.levels.gateTipRail' : 'hud.levels.gateTipRoad'));
          tiles.push(`<button class="tile ${isOpen ? 'open' : 'locked'} ${done ? 'done' : ''} ${rail ? 'is-rail' : ''} ${skip ? 'skipped' : ''} ${gate ? 'gate' : ''}" data-id="${id}" style="--acc:${lth.accent}" ${isOpen ? '' : 'aria-disabled="true"'}>
              <div class="tile-art">${thumbSvg(lv)}<span class="tile-num">${displayNum(lv)}</span>${gate ? '<span class="tile-gate" title="' + gateTip + '">' + icon('flag') + '</span>' : ''}${skip ? '<span class="tile-skip">' + esc(t('hud.levels.skipped')) + '</span>' : ''}${rail ? '<span class="tile-train">' + trafficIcon(lv) + '</span>' : ''}${isOpen ? '' : '<span class="tile-lock">' + icon('lock') + '</span>'}</div>
              <div class="tile-body"><div class="tile-name">${esc(lvName(lv) || levelLabel(lv))}</div>
              <div class="tile-stars">${[0, 1, 2].map(i => starSvg(i < st ? 'on' : '')).join('')}</div></div>
            </button>`);
        }
        const sec = h(`<section class="chapter ${anyOpen ? '' : 'ch-locked'} ${camp === 'rail' ? 'ch-rail' : ''}" style="--acc:${th.accent};--sky0:${th.sky[0]};--sky1:${th.sky[1]}">
            <div class="ch-head">
              <div class="ch-num">${ch.n}</div>
              <div class="ch-text"><h3>${esc(ch.name)}</h3><p>${esc(t('hud.levels.chapterLine', { from: ch.from, to: ch.to, desc: ch.desc }))}</p></div>
              <div class="ch-stars">${chMax ? starSvg('on') + '<b>' + chStars + '</b>/' + chMax : '<span class="soon-tag">' + esc(t('core.comingSoon')) + '</span>'}</div>
              ${unlockInfoBtn(camp)}
            </div>
            <div class="tiles">${tiles.join('')}</div>
          </section>`);
        wrap.appendChild(sec);
      });
      // stagger-in animation
      $$('.tile', wrap).forEach((t, i) => { t.style.animationDelay = (Math.min(i, 40) * 14) + 'ms'; });
    },
    // every campaign's tiles carry data-id (chapter tiles and custom panels alike)
    scrollToLevel(id) {
      const find = () => $('.ls-scroll [data-id="' + id + '"]', this.el.levels);
      let t = find();
      if (!t) {
        const lv = levelsList().find(l => l && l.id === id);
        if (lv && campaignOf(lv) !== this.tab) { this.setCampaignTab(campaignOf(lv)); t = find(); }
      }
      if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: 'center' }); } catch (e) { /* */ } }
    },

    // ---------------------------------------------------------------- in-level HUD
    _buildLevelHud() {
      const el = h(`
        <section id="screen-level" class="screen">
          <header class="topbar glass">
            <button class="btn btn-icon btn-ghost" data-act="back" title="Levels (Esc)">${icon('back')}</button>
            <div class="lvl-badge"><span class="lvl-k">LEVEL</span><span class="lvl-n" data-ref="lvlNum">1</span></div>
            <div class="lvl-title"><div class="lvl-name" data-ref="lvlName">—</div><div class="lvl-sub" data-ref="lvlSub"></div></div>
            <div class="budget" data-ref="budget">
              <div class="budget-row"><span class="budget-k">${icon('coin')}Cost</span><span class="budget-v"><b data-ref="cost">$0</b> <i>/</i> <span data-ref="budgetV">$0</span></span></div>
              <div class="budget-bar"><div class="budget-fill" data-ref="fill"></div>
                <span class="tick t70" title="★★★ at 70% of budget"></span><span class="tick t85" title="★★ at 85% of budget"></span>
                <span class="tick-lbl l70">★★★</span><span class="tick-lbl l85">★★</span>
              </div>
            </div>
            <div class="traffic" data-ref="traffic" title="Traffic"></div>
            <button class="btn btn-icon btn-ghost" data-act="hint" title="Show hint" hidden>${icon('bulb')}</button>
            <button class="btn btn-icon btn-ghost" data-act="settings" title="Settings">${icon('gear')}</button>
          </header>

          <nav class="rail glass" data-ref="rail">
            <button class="tool" data-tool="build" title="Build (B)">${icon('beam')}<span>Build</span></button>
            <button class="tool" data-tool="erase" title="Erase (E) — or right-click">${icon('erase')}<span>Erase</span></button>
            <button class="tool" data-tool="pier" title="Pier (P)">${icon('pier')}<span>Pier</span></button>
            <button class="tool" data-tool="select" title="Select (S) — box-select, then Delete; drag joints to move">${icon('select')}<span>Select</span></button>
            <button class="tool" data-tool="arch" title="Arch &amp; Curve (A) — drag from start to end, move up/down for the rise, click to place">${icon('arch')}<span>Arch</span></button><!-- arch-tool -->
            <div class="rail-sep"></div>
            <button class="tool toggle" data-act="mirror" title="Mirror symmetry (M)">${icon('mirror')}<span>Mirror</span></button>
            <div class="tool-wrap" data-ref="tplWrap">
              <button class="tool" data-act="templates" title="Bridge templates">${icon('truss')}<span>Templates</span></button>
            </div>
            <div class="rail-sep"></div>
            <button class="tool" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo')}<span>Undo</span></button>
            <button class="tool" data-act="redo" title="Redo (Ctrl+Y)">${icon('redo')}<span>Redo</span></button>
            <button class="tool danger" data-act="clear" title="Clear all">${icon('trash')}<span>Clear</span></button>
          </nav>

          <div class="tpl-menu glass" data-ref="tplMenu"></div>

          <div class="dock">
            <div class="track-strip glass" data-ref="track" title="Track recording: grade and kink at every rail joint, red above the derail limit (T)"><canvas data-ref="trackCanvas"></canvas></div>
            <div class="palette glass" data-ref="palette"></div>
            <div class="simbar glass" data-ref="simbar">
              <button class="btn btn-ghost sb-btn" data-act="edit" title="Back to editing (Space)">${icon('pencil')}<span>Edit</span></button>
              <button class="btn btn-ghost sb-btn" data-act="restart" title="Restart test (R)">${icon('restart')}<span>Restart</span></button>
              <div class="sb-sep"></div>
              <button class="btn btn-icon btn-ghost" data-act="pause" title="Pause / resume (P)">${icon('pause')}</button>
              <button class="btn btn-icon btn-ghost" data-act="step" title="Single step (.)">${icon('step')}</button>
              <div class="seg" data-ref="speed">
                <button data-speed="0.25" title="Slow motion (-)">¼×</button><button data-speed="1">1×</button><button data-speed="2" title="Fast (=)">2×</button><button data-speed="4" title="Faster">4×</button><button data-speed="8" title="Fastest">8×</button>
              </div>
              <div class="sb-sep"></div>
              <div class="sb-stat">${icon('clock')}<b data-ref="simTime">0.0</b><span data-ref="simLimit">/ 40 s</span></div>
              <div class="sb-stat">${icon('flag')}<b data-ref="simVeh">0/0</b><span>across</span></div>
              <div class="sb-sep"></div>
              <button class="btn btn-ghost sb-btn toggle" data-act="follow" title="Camera follows the traffic (F)">${icon('follow')}<span>Follow</span></button>
              <button class="btn btn-ghost sb-btn toggle" data-act="track" title="Track recording strip (T)">${icon('track')}<span>Track</span></button>
              <button class="btn btn-ghost sb-btn toggle" data-act="stress" title="Stress overlay">${icon('stress')}<span>Stress</span></button>
            </div>
          </div>

          <button class="test-btn" data-act="test" title="Test bridge (Space)">
            <span class="tb-ico tb-play">${icon('play')}</span><span class="tb-ico tb-edit">${icon('pencil')}</span>
            <span class="tb-lbl"><b class="tb-play">Test</b><b class="tb-edit">Build</b><small>Space</small></span>
          </button>

          <div class="hint glass" data-ref="hint">
            <span class="hint-ico">${icon('bulb')}</span><p data-ref="hintText"></p>
            <button class="btn btn-icon btn-ghost sm" data-act="hideHint" title="Dismiss">${icon('close')}</button>
          </div>

          <div class="derail-callout" data-ref="derail" aria-live="assertive">
            <div class="dc-card glass"><div class="dc-head"><span class="dc-dot"></span><b data-ref="dcTitle">Derailed!</b><small data-ref="dcCar"></small></div>
              <p class="dc-cause" data-ref="dcCause"></p><p class="dc-advice" data-ref="dcAdvice"></p></div>
            <span class="dc-stem"></span>
          </div>

          <div class="results" data-ref="results">
            <div class="results-card glass">
              <div class="res-banner" data-ref="resBanner"></div>
              <div class="res-stars" data-ref="resStars">${starSvg()}${starSvg('mid')}${starSvg()}</div>
              <h2 data-ref="resTitle">Bridge passed!</h2>
              <p class="res-reason" data-ref="resReason"></p>
              <div class="res-rail" data-ref="resRail" hidden></div>
              <div class="res-stats" data-ref="resStats"></div>
              <div class="res-budget" data-ref="resBudget"><div class="rb-bar"><div class="rb-fill"></div><span class="tick t70"></span><span class="tick t85"></span><span class="rb-cap"></span></div></div>
              <div class="res-actions">
                <button class="btn btn-glass" data-act="inspect" title="Inspect peak stress map">${icon('eye')}<span>Inspect</span></button>
                <button class="btn btn-glass" data-act="resEdit">${icon('pencil')}<span>Edit</span></button>
                <button class="btn btn-glass" data-act="retry">${icon('restart')}<span>Retry</span></button>
                <button class="btn btn-primary" data-act="next">${icon('next')}<span>Next level</span></button>
              </div>
            </div>
            <button class="res-pill glass" data-act="uninspect">${icon('eye')}<span>Peak stress map</span><b data-ref="pillText"></b><em>Show results</em></button>
          </div>
        </section>`);

      el.addEventListener('click', e => this._onLevelClick(e));
      el.addEventListener('pointerdown', e => {
        // close templates menu when clicking elsewhere
        if (!e.target.closest('[data-ref=tplWrap], [data-ref=tplMenu]')) this.closeTemplates();
      });
      document.addEventListener('pointerdown', e => {
        if (!e.target.closest || !e.target.closest('[data-ref=tplWrap], [data-ref=tplMenu]')) this.closeTemplates();
      });
      this.el.level = el;
      const r = s => $('[data-ref=' + s + ']', el);
      ['lvlNum', 'lvlName', 'lvlSub', 'budget', 'cost', 'budgetV', 'fill', 'traffic', 'rail', 'tplWrap', 'tplMenu', 'palette', 'simbar', 'speed',
        'simTime', 'simLimit', 'simVeh', 'hint', 'hintText', 'results', 'resBanner', 'resStars', 'resTitle', 'resReason', 'resStats', 'resBudget', 'pillText',
        'track', 'trackCanvas', 'derail', 'dcTitle', 'dcCar', 'dcCause', 'dcAdvice', 'resRail']
        .forEach(k => { this.el[k] = r(k); });
      this.el.test = $('.test-btn', el);
      return el;
    },

    _onLevelClick(e) {
      const tool = e.target.closest('[data-tool]');
      if (tool) { if (!tool.disabled) { sfx('click'); call('setTool', tool.dataset.tool); } return; }
      const mat = e.target.closest('[data-mat]');
      if (mat) {
        if (mat.classList.contains('disabled')) { sfx('error'); this.toast(material(mat.dataset.mat).name + ' is not available on this level.', 'info'); return; }
        sfx('click'); call('setMaterial', mat.dataset.mat); return;
      }
      const sp = e.target.closest('[data-speed]');
      if (sp) { sfx('click'); call('setSpeed', +sp.dataset.speed); return; }
      const tpl = e.target.closest('[data-tpl]');
      if (tpl && tpl.disabled) return;
      if (tpl) {
        sfx('click');
        this.closeTemplates();
        call('applyTemplate', tpl.dataset.tpl);
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      switch (act) {
        case 'back': sfx('click'); call('goBack'); break;
        case 'settings': sfx('click'); this.openSettings(); break;
        case 'hint': sfx('click'); this.showHint(); break;
        case 'hideHint': sfx('click'); this.hideHint(true); break;
        case 'mirror': call('toggleMirror'); break;
        case 'templates': sfx('click'); if (this.templatesOpen()) this.closeTemplates(); else { this._positionTpl(b); this.el.tplMenu.classList.add('open'); this.el.tplWrap.classList.add('open'); } break;
        case 'undo': call('undo'); break;
        case 'redo': call('redo'); break;
        case 'clear': call('clearDesign'); break;
        case 'test': call('toggleTest'); break;
        case 'edit': call('stopSim'); break;
        case 'restart': sfx('click'); call('restartSim'); break;
        case 'pause': sfx('click'); call('togglePause'); break;
        case 'step': sfx('click'); call('stepOnce'); break;
        case 'follow': call('toggleFollow'); break;
        case 'track': call('toggleTrack'); break;
        case 'stress': { const g = game(); call('setSetting', 'showStress', !(g.settings && g.settings.showStress)); sfx('toggle', { on: game().settings && game().settings.showStress }); break; }
        case 'inspect': sfx('whoosh'); this.el.results.classList.add('inspecting'); break;
        case 'uninspect': sfx('whoosh'); this.el.results.classList.remove('inspecting'); break;
        case 'resEdit': sfx('click'); call('backToEdit'); break;
        case 'retry': sfx('click'); call('retry'); break;
        case 'next': sfx('click'); call('nextLevel'); break;
        default: break;
      }
    },

    _positionTpl(btn) {
      const r = btn.getBoundingClientRect();
      const rail = this.el.rail.getBoundingClientRect();
      const m = this.el.tplMenu;
      m.style.left = Math.round(rail.right + 10) + 'px';
      const maxTop = root.innerHeight - Math.min(m.scrollHeight || 300, root.innerHeight * 0.6) - 12;
      m.style.top = Math.round(Math.max(12, Math.min(r.top - 8, maxTop))) + 'px';
    },

    enterLevel(level) {
      this.level = level;
      if (this.el.toasts) this.el.toasts.innerHTML = '';
      this._sig = {};
      const id = levelId(level);
      const camp = campaignOf(level);
      const cu = campaignUi(camp);
      this.el.lvlNum.textContent = cu.levelNum ? cu.levelNum(level) : displayNum(level);
      $('.lvl-k', this.el.level).textContent = cu.levelK || 'LEVEL';
      CAMPAIGN_ORDER.forEach(c => this.el.level.classList.toggle('camp-' + c, c === camp));
      this.el.lvlName.textContent = level.name || levelLabel(level);
      const t = level.terrain || {};
      const gap = (t.rightEdge != null && t.leftEdge != null) ? Math.round(t.rightEdge - t.leftEdge) : null;
      const ch = chaptersFor(camp).find(c => id >= c.from && id <= c.to);
      this.el.lvlSub.textContent = cu.levelSub ? cu.levelSub(level, gap) : levelSubText(level, camp, cu, ch, gap);
      this.el.level.style.setProperty('--acc', theme(level.theme).accent);
      this.el.budgetV.textContent = money(level.budget);
      this._shownCost = 0;

      // traffic (road vehicles and trains)
      const groups = Array.isArray(level.traffic) ? level.traffic : [];
      const total = groups.reduce((a, g) => a + (g.count || 1), 0);
      const allTrains = groups.length && groups.every(isTrainGroup);
      this.el.traffic.innerHTML = groups.map(trafficChip).join('') || '<span class="tr-none">No traffic</span>';
      this.el.traffic.title = total + ' ' + (allTrains ? 'train' : 'vehicle') + (total === 1 ? '' : 's') + ': ' + trafficSummary(groups);

      // camera follow toggle (only when the renderer can follow)
      const fb = $('[data-act=follow]', this.el.simbar);
      if (fb) fb.hidden = !call('hasFollow');
      const tb = $('[data-act=track]', this.el.simbar);
      if (tb) tb.hidden = camp !== 'rail';
      this.hideDerail();
      this._sig.sim = null;

      // palette
      this._buildPalette(level);

      // tools
      const hasPiers = Array.isArray(level.pierZones) && level.pierZones.length > 0 && (level.maxPiers == null || level.maxPiers > 0);
      $('[data-tool=pier]', this.el.rail).hidden = !hasPiers;
      let list = (BG.Templates && Array.isArray(BG.Templates.list)) ? BG.Templates.list : [];
      if (level.templates && BG.Templates && typeof BG.Templates.available === 'function') {
        try { list = BG.Templates.available(level).filter(t => t.ok !== false); } catch (e) { /* keep the plain list */ }
      }
      const hasTpl = !!level.templates && list.length > 0;
      this.el.tplWrap.hidden = !hasTpl;
      // pier tool shows how many piers this crossing allows
      const pierLbl = $('[data-tool=pier] span', this.el.rail);
      if (pierLbl) pierLbl.textContent = hasPiers && level.maxPiers != null ? 'Pier 0/' + level.maxPiers : 'Pier';
      this._pierSig = null;
      this.el.tplMenu.innerHTML = '<div class="tpl-head">Start from a template</div>' + list.map(t =>
        `<button class="tpl-item" data-tpl="${esc(t.id)}"><span class="tpl-pic">${tplPic(t.id)}</span><span class="tpl-txt"><b>${esc(t.name || t.id)}</b><small>${esc(t.desc || '')}</small></span></button>`).join('');

      // hint
      const hasHint = !!level.hint;
      $('[data-act=hint]', this.el.level).hidden = !hasHint;
      this.hideHint();
      // auto-show only on a fresh start: an empty design, or a level never passed (a built, solved level - e.g. after a
      // reload - keeps it behind the hint button / H)
      if (hasHint) setTimeout(() => { if (this.level === level && this.mode === 'edit' && this.shouldAutoHint(level)) this.showHint(null, id != null && id <= 3 ? 0 : 24000); }, 650);

      this.hideResults(true);
      this.setMode('edit');
    },

    _buildPalette(level) {
      const M = materials();
      const allowed = levelMaterials(level);
      const [lo, hi] = strengthRange();
      const ids = allowed.filter(id => M[id] || FALLBACK_MATERIALS[id]);
      const html = ids.map((id, i) => {
        const m = material(id);
        const s = strengthOf(m);
        const pct = s > 0 ? clamp(0.12 + 0.88 * (Math.log(s) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1), 0.08, 1) : 0.05;
        const tags = [];
        if (m.isRoad) tags.push('road deck');
        if (m.isRail) tags.push('track: trains ride on it');
        if (m.tensionOnly) tags.push('tension only');
        if (compressionOnly(m)) tags.push('compression only: build arches');
        return `<button class="mat ${m.isRail ? 'mat-rail' : ''}" data-mat="${esc(id)}" title="${esc(m.name)} — ${money(m.costPerMeter)}/m, max ${m.maxLength} m${tags.length ? ', ' + esc(tags.join(', ')) : ''}">
            <span class="kbd">${i + 1}</span>
            <span class="mat-ico">${matSwatch(id, m)}</span>
            <span class="mat-info"><b>${esc(SHORT_MAT[id] || m.name || id)}</b>
              <span class="mat-meta"><em>${money(m.costPerMeter)}/m</em><i>≤ ${m.maxLength} m</i></span>
              <span class="mat-str" title="Strength"><span style="width:${Math.round(pct * 100)}%"></span></span>
            </span>
          </button>`;
      }).join('');
      this.el.palette.innerHTML = html;
    },

    setMode(mode) {
      this.mode = mode;
      const el = this.el.level;
      if (!el) return;
      el.classList.toggle('mode-edit', mode === 'edit');
      el.classList.toggle('mode-sim', mode === 'sim');
      el.classList.toggle('mode-results', mode === 'results');
      if (mode !== 'edit') this.closeTemplates();
      if (mode === 'sim') this.hideHint();
      this.hideTooltip();
    },

    // ---------------------------------------------------------------- hint & toasts
    shouldAutoHint(level) {
      if (!level || !level.hint) return false;
      const g = game(), S = stor();
      let beams = 0;
      try { const d = g && (g.getDesign ? g.getDesign() : g.design); beams = d && Array.isArray(d.beams) ? d.beams.length : 0; } catch (e) { beams = 0; }
      if (!beams) return true;
      try { return !(S && S.isCompleted && S.isCompleted(levelId(level))); } catch (e) { return true; }
    },
    // ms: auto-hide delay (0 = stay until dismissed; the first tutorial levels keep their hint up)
    showHint(text, ms) {
      const lv = this.level;
      const msg = text || (lv && lv.hint);
      if (!msg) return;
      this.el.hintText.textContent = msg;
      this.el.hint.classList.add('show');
      clearTimeout(this._hintTimer);
      if (ms == null) ms = 24000;
      if (ms > 0) this._hintTimer = setTimeout(() => this.hideHint(), ms);
    },
    hideHint() {
      clearTimeout(this._hintTimer);
      if (this.el.hint) this.el.hint.classList.remove('show');
    },
    toast(msg, kind, ms) {
      if (!this.el.toasts) return;
      // de-dupe identical consecutive toasts
      const last = this.el.toasts.lastElementChild;
      if (last && last.dataset.msg === msg && !last.classList.contains('out')) {
        clearTimeout(last._t); last._t = setTimeout(() => this._dropToast(last), ms || 2600);
        last.classList.remove('bump'); void last.offsetWidth; last.classList.add('bump');
        return;
      }
      const t = h(`<div class="toast glass ${kind || ''}"><span class="dot"></span><span></span></div>`);
      t.dataset.msg = msg;
      t.lastElementChild.textContent = msg;
      this.el.toasts.appendChild(t);
      while (this.el.toasts.children.length > 2) this.el.toasts.firstElementChild.remove();
      requestAnimationFrame(() => t.classList.add('in'));
      t._t = setTimeout(() => this._dropToast(t), ms || 2600);
    },
    _dropToast(t) { t.classList.add('out'); setTimeout(() => t.remove(), 400); },

    // ---------------------------------------------------------------- per-frame update
    update(dt) {
      const g = game();
      if (this.screen !== 'level' || !this.level) {
        this.hideTooltipIfAny();
        if (this.el.track && this.el.track.classList.contains('show')) { this.el.track.classList.remove('show'); document.body.classList.remove('track-on'); }
        return;
      }
      dt = Math.min(0.1, dt || 0.016);
      const lv = this.level;
      const ed = g.editor;

      // budget bar (cost tweening)
      const cost = +(call('getCost') || 0);
      const budget = +lv.budget || 1;
      const k = 1 - Math.exp(-dt * 10);
      this._shownCost += (cost - this._shownCost) * k;
      if (Math.abs(cost - this._shownCost) < 0.5) this._shownCost = cost;
      const ratio = this._shownCost / budget;
      const sigB = Math.round(this._shownCost) + '|' + budget;
      if (this._sig.budget !== sigB) {
        this._sig.budget = sigB;
        this.el.cost.textContent = money(this._shownCost);
        this.el.fill.style.width = (clamp(ratio, 0, 1) * 100).toFixed(2) + '%';
        this.el.fill.style.background = budgetColor(ratio);
        const over = cost > budget;
        if (this._sig.over !== over) {
          this._sig.over = over;
          this.el.budget.classList.toggle('over', over);
          if (over && this.mode === 'edit') { this.el.budget.classList.remove('shake'); void this.el.budget.offsetWidth; this.el.budget.classList.add('shake'); }
        }
      }

      // tools / palette state
      const tool = ed ? ed.tool : null;
      const mat = ed ? ed.material : null;
      const mir = ed ? !!ed.mirror : false;
      const sigT = tool + '|' + mat + '|' + mir;
      if (this._sig.tools !== sigT) {
        this._sig.tools = sigT;
        $$('[data-tool]', this.el.rail).forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        $$('[data-mat]', this.el.palette).forEach(b => b.classList.toggle('active', b.dataset.mat === mat && tool !== 'erase' && tool !== 'pier'));
        $('[data-act=mirror]', this.el.rail).classList.toggle('on', mir);
      }
      if (ed) {
        const cu = typeof ed.canUndo === 'function' ? ed.canUndo() : (ed.canUndo != null ? !!ed.canUndo : (ed.undoStack ? ed.undoStack.length > 0 : true));
        const cr = typeof ed.canRedo === 'function' ? ed.canRedo() : (ed.canRedo != null ? !!ed.canRedo : (ed.redoStack ? ed.redoStack.length > 0 : true));
        const sigU = cu + '|' + cr;
        if (this._sig.undo !== sigU) {
          this._sig.undo = sigU;
          $('[data-act=undo]', this.el.rail).disabled = !cu;
          $('[data-act=redo]', this.el.rail).disabled = !cr;
        }
      }

      // pier count (n / max)
      if (lv.maxPiers != null && ed && ed.design && this.mode === 'edit') {
        const np = (ed.design.piers || []).length;
        const sigP = np + '/' + lv.maxPiers;
        if (this._pierSig !== sigP) {
          this._pierSig = sigP;
          const pl = $('[data-tool=pier] span', this.el.rail);
          if (pl) pl.textContent = 'Pier ' + sigP;
          const pb = $('[data-tool=pier]', this.el.rail);
          if (pb) pb.title = 'Pier (P): ' + np + ' of ' + lv.maxPiers + ' allowed';
        }
      }

      // sim bar
      const sim = g.sim;
      if (this.mode === 'sim' || this.mode === 'results') {
        const tl = lv.timeLimit || 0;
        const t = sim ? (+sim.time || 0) : 0;
        const vt = sim && sim.vehicles ? sim.vehicles.length : 0;
        const vf = sim && sim.vehicles ? sim.vehicles.filter(v => v.state === 'finished').length : 0;
        const sigS = t.toFixed(1) + '|' + vf + '/' + vt + '|' + !!g.paused + '|' + g.speed + '|' + !!(g.settings && g.settings.showStress) + '|' + !!g.followOn + '|' + !!g.trackOn;
        if (this._sig.sim !== sigS) {
          this._sig.sim = sigS;
          this.el.simTime.textContent = t.toFixed(1);
          this.el.simLimit.textContent = tl ? '/ ' + tl + ' s' : 's';
          this.el.simVeh.textContent = vf + '/' + vt;
          const pb = $('[data-act=pause]', this.el.simbar);
          pb.innerHTML = g.paused ? icon('play') : icon('pause');
          pb.classList.toggle('on', !!g.paused);
          this.el.simbar.classList.toggle('paused', !!g.paused);
          $('[data-act=step]', this.el.simbar).disabled = !g.paused;
          $$('[data-speed]', this.el.speed).forEach(b => b.classList.toggle('active', +b.dataset.speed === +g.speed));
          $('[data-act=stress]', this.el.simbar).classList.toggle('on', !!(g.settings && g.settings.showStress));
          $('[data-act=follow]', this.el.simbar).classList.toggle('on', !!g.followOn);
          $('[data-act=track]', this.el.simbar).classList.toggle('on', !!g.trackOn);
          this.el.simTime.parentElement.classList.toggle('warn', tl && t > tl * 0.9);
        }
      }

      // track recording strip + derailment callout (rail levels)
      this._updateRail();

      // tooltip
      const info = call('getHoverInfo');
      if (info) this.showTooltip(info);
      else this.hideTooltip();
    },

    // ---------------------------------------------------------------- rail: track strip + derail callout
    _updateRail() {
      const g = game();
      const RI = BG.RailInfo;
      const strip = this.el.track;
      if (strip) {
        const inspecting = this.mode === 'results' && this.resultsInspecting();
        const ts = RI && (this.mode === 'sim' || inspecting) ? call('getTrackStrip') : null;
        const show = !!ts;
        if (strip.classList.contains('show') !== show) { strip.classList.toggle('show', show); document.body.classList.toggle('track-on', show); }
        if (show) {
          // the kink limit band follows the train's speed (eased so it slides rather than jumps)
          const sp = RI.trainSpans(ts.sim).filter(t => !t.derailed && t.state === 'driving');
          const v = sp.length ? Math.max.apply(null, sp.map(t => t.speed)) : (this._trackSpeed || 0);
          this._trackSpeed = v;
          const want = RI.kinkLimit(ts.sim, v);
          const cur = this._trackLim == null || this._trackSim !== ts.sim ? want : this._trackLim;
          this._trackLim = cur + (want - cur) * 0.15;
          this._trackSim = ts.sim;
          try { RI.drawStrip(this.el.trackCanvas, ts.sim, ts.rec, { profile: ts.profile, limitKink: this._trackLim, speed: v, derail: ts.derail }); } catch (e) { console.error(e); }
        }
      }
      // callout follows the offending wheel on screen
      const dc = this.el.derail;
      if (dc && dc.classList.contains('show')) {
        if (this.mode !== 'sim') { dc.classList.remove('show'); return; }
        const m = call('getDerailMarker');
        const r = g.renderer;
        if (m && r && r.worldToScreen && isFinite(m.x)) {
          const p = r.worldToScreen(m.x, m.y);
          const W = root.innerWidth, H = root.innerHeight;
          const card = dc.firstElementChild;
          const cw = card.offsetWidth || 320, chh = card.offsetHeight || 90;
          const stem = 54;
          let x = clamp(p.x - cw / 2, 16, W - cw - 16);
          let y = p.y - stem - chh;
          const top = 92;
          let below = false;
          if (y < top) { y = Math.min(H - chh - 170, p.y + stem); below = true; }
          dc.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
          dc.classList.toggle('below', below);
          const sx = clamp(p.x - x, 18, cw - 18);
          const st = dc.lastElementChild;
          st.style.left = Math.round(sx) + 'px';
          st.style.height = Math.max(0, below ? y - p.y - 6 : p.y - (y + chh) - 6) + 'px';
        }
      }
    },
    // info: BG.RailInfo.explain(...) {title, car, cause, advice}
    showDerail(info) {
      const dc = this.el.derail;
      if (!dc || !info) return;
      this.el.dcTitle.textContent = info.title || 'Derailed!';
      this.el.dcCar.textContent = info.car || '';
      this.el.dcCause.textContent = info.cause || '';
      this.el.dcAdvice.textContent = info.advice || '';
      dc.classList.remove('show'); void dc.offsetWidth;
      dc.classList.add('show');
    },
    hideDerail() { if (this.el.derail) this.el.derail.classList.remove('show'); },

    // rail results: two verdicts + ride-quality score card
    _railResults(res) {
      const el = this.el.resRail;
      if (!el) return;
      const c = res.rail;
      el.hidden = !c;
      if (!c) { el.innerHTML = ''; return; }
      const RI = BG.RailInfo;
      const pct = (v, fx) => RI ? RI.pct(v, fx) : String(Math.round(v * 1000) / 10);
      const deg = (v, fx) => RI ? RI.deg(v, fx) : String(Math.round(v * 573) / 10);
      const tick = ok => '<i class="rv-ico ' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓' : '✗') + '</i>';
      const verdict = (ok, label, sub) => '<div class="rv ' + (ok ? 'ok' : 'no') + '">' + tick(ok) + '<span><b>' + esc(label) + '</b><small>' + esc(sub) + '</small></span></div>';
      const d = res.derail;
      const structSub = c.structureOk ? 'No member broke' : c.broken + ' member' + (c.broken === 1 ? '' : 's') + ' broke';
      const railSub = c.railsOk ? 'Every car stayed on the track' : (d ? (d.car ? d.car + ' · ' : '') + (d.title || 'derailed').replace(/!$/, '').toLowerCase() : 'A car came off the rails');
      const cls = r => (r > 1 ? 'bad' : r > 0.8 ? 'warn' : 'good');
      const kinkSub = 'limit ' + deg(c.kinkLim) + '°' + (c.kinkSpeed > 0.5 ? ' at ' + Math.round(c.kinkSpeed) + ' m/s' : '');
      const tiles = [
        ['Worst grade', pct(c.grade, true) + '%', 'limit ' + pct(c.gradeLim) + '%', cls(c.gradeRatio)],
        ['Worst kink', deg(c.kink, true) + '°', kinkSub, cls(c.kinkRatio)],
        ['Peak sag', (Math.round(c.sag * 100) / 100).toFixed(2) + ' m', 'rail joints', ''],
      ];
      const lt = c.letter;
      const ltCls = lt === 'A' || lt === 'B' ? 'good' : lt === 'C' ? 'warn' : 'bad';
      const ltSub = lt === 'F' ? 'derailed' : lt === 'A' ? 'silky smooth' : lt === 'B' ? 'smooth' : lt === 'C' ? 'bumpy' : 'rough ride';
      el.innerHTML = '<div class="rv-row">' + verdict(c.structureOk, 'Structure held', structSub) + verdict(c.railsOk, 'Train stayed on the rails', railSub) + '</div>' +
        '<div class="ride-card"><div class="rc-head">Ride quality</div><div class="rc-tiles">' +
        tiles.map(t => '<div class="rc-t"><span>' + t[0] + '</span><b class="' + t[3] + '">' + t[1] + '</b><small>' + esc(t[2]) + '</small></div>').join('') +
        '<div class="rc-t rc-grade"><span>Smoothness</span><b class="' + ltCls + '">' + lt + '</b><small>' + ltSub + '</small></div>' +
        '</div></div>';
    },

    // ---------------------------------------------------------------- tooltip
    // info: {x, y (client px), title, color, rows:[[k,v,cls]], stress (0..), peak}
    showTooltip(info) {
      const tt = this.el.tooltip;
      const sig = info.title + '|' + info.rows.map(r => r.join(':')).join('|') + '|' + info.stress;
      if (tt._sig !== sig) {
        tt._sig = sig;
        let html = '<div class="tt-head"><span class="tt-sw" style="background:' + esc(info.color || '#888') + '"></span><b>' + esc(info.title) + '</b></div>';
        html += '<div class="tt-rows">' + info.rows.map(r => '<span class="k">' + esc(r[0]) + '</span><span class="v ' + (r[2] || '') + '">' + esc(r[1]) + '</span>').join('') + '</div>';
        if (info.stress != null) {
          const s = clamp(Math.abs(info.stress), 0, 1.2);
          html += '<div class="tt-meter"><span style="width:' + (Math.min(1, s) * 100).toFixed(1) + '%;background:' + stressColor(s) + '"></span>' +
            (info.peak != null ? '<i style="left:' + (Math.min(1, info.peak) * 100).toFixed(1) + '%"></i>' : '') + '</div>';
        }
        tt.innerHTML = html;
      }
      const W = root.innerWidth, H = root.innerHeight;
      const r = tt.getBoundingClientRect();
      let x = info.x + 18, y = info.y + 18;
      if (x + r.width > W - 8) x = info.x - r.width - 14;
      if (y + r.height > H - 8) y = info.y - r.height - 14;
      tt.style.transform = 'translate(' + Math.round(Math.max(8, x)) + 'px,' + Math.round(Math.max(8, y)) + 'px)';
      tt.classList.add('show');
    },
    hideTooltip() { if (this.el.tooltip) this.el.tooltip.classList.remove('show'); },
    hideTooltipIfAny() { this.hideTooltip(); },

    // ---------------------------------------------------------------- results
    // res: {passed, stars, cost, budget, title, reasonText, simOk, time, peakStress, vehiclesFinished, vehiclesTotal, brokenBeams, hasNext, improved, best}
    showResults(res) {
      const el = this.el.results;
      this._resultTimers.forEach(clearTimeout); this._resultTimers = [];
      el.classList.remove('inspecting');
      el.classList.toggle('pass', !!res.passed);
      el.classList.toggle('fail', !res.passed);
      this.el.resBanner.textContent = res.passed ? (res.stars === 3 ? 'Masterpiece' : res.improved ? 'New best' : 'Level complete') : (res.simOk ? 'Over budget' : 'Bridge failed');
      this.el.resTitle.textContent = res.title;
      this.el.resReason.textContent = res.reasonText || '';
      this.hideDerail();
      this._railResults(res);
      el.classList.toggle('is-rail', !!res.rail);
      const stars = $$('.star', this.el.resStars);
      stars.forEach(s => s.classList.remove('on', 'pop'));
      const pct = res.budget ? res.cost / res.budget : 0;
      const pk = res.peakStress != null ? Math.round(res.peakStress * 100) : null;
      this.el.resStats.innerHTML = [
        ['Cost', money(res.cost), res.cost > res.budget ? 'bad' : 'good'],
        ['Budget', money(res.budget), ''],
        [res.campaign === 'rail' || res.rail ? 'Traffic' : 'Vehicles', (res.vehiclesFinished || 0) + ' / ' + (res.vehiclesTotal || 0), res.vehiclesFinished >= res.vehiclesTotal && res.vehiclesTotal ? 'good' : 'bad'],
        ['Peak stress', pk != null ? pk + '%' : '—', pk != null && pk >= 100 ? 'bad' : ''],
        ['Time', (res.time || 0).toFixed(1) + ' s', ''],
        ['Broken', String(res.brokenBeams || 0), res.brokenBeams ? 'bad' : 'good'],
      ].map(r => '<div class="rs"><span>' + r[0] + '</span><b class="' + r[2] + '">' + r[1] + '</b></div>').join('');
      const rb = $('.rb-fill', this.el.resBudget);
      rb.style.width = '0%';
      rb.style.background = budgetColor(pct);
      $('.rb-cap', this.el.resBudget).textContent = Math.round(pct * 100) + '% of budget';
      this._resultTimers.push(setTimeout(() => { rb.style.width = (clamp(pct, 0, 1) * 100) + '%'; }, 250));
      const nb = $('[data-act=next]', el);
      nb.hidden = !res.passed;
      $('span', nb).textContent = res.hasNext ? 'Next level' : (campaignUi(res.campaign).allLabel || 'All levels');
      // the sim is deterministic: retrying an unchanged failed bridge replays the same failure,
      // so after a failure the main action is going back to edit
      $('[data-act=retry]', el).classList.remove('btn-primary');
      $('[data-act=retry]', el).classList.add('btn-glass');
      $('[data-act=resEdit]', el).classList.toggle('btn-primary', !res.passed);
      $('[data-act=resEdit]', el).classList.toggle('btn-glass', !!res.passed);
      $('[data-act=retry] span', el).textContent = res.passed ? 'Replay' : 'Retry';
      // finale of a campaign (res.finaleKind: 'road' after 50, 'bonus' after 53, 'rail' after 120, 'famous' after 212):
      // banner, title and text come from that campaign's registered look (CAMPAIGN_UI[...].finale)
      const kind = res.finale ? (res.finaleKind || res.campaign || 'road') : null;
      el.classList.toggle('finale', !!kind);
      const bonusFin = kind && kind !== 'bonus' && !CAMPAIGN_UI[kind] ? kind : null; // a branching bonus chapter (anchorages)
      CAMPAIGN_ORDER.concat(['bonus']).forEach(c => el.classList.toggle('finale-' + c, kind === c || (c === 'bonus' && !!bonusFin)));
      if (kind) {
        const camp = kind === 'bonus' || bonusFin ? 'road' : kind;
        const c = campaignStarsOf(camp);
        const starLine = c.max ? 'You hold ' + c.got + ' of ' + c.max + ' stars' + (c.got < c.max ? '. The three-star lines are still waiting.' : '. A perfect run.') : '';
        const fin = kind === 'bonus' ? CAMPAIGN_UI.road.bonusFinale : bonusFin ? (CAMPAIGN_UI.road.bonusFinales || {})[bonusFin] : campaignUi(camp).finale;
        if (fin) {
          this.el.resBanner.textContent = fin.banner;
          this.el.resTitle.textContent = fin.title;
          this.el.resReason.textContent = fin.text(starLine, res);
        }
      }
      this.el.pillText.textContent = res.passed ? ('★'.repeat(res.stars) + ' · ' + money(res.cost)) : (res.simOk ? 'Over budget' : 'Failed');
      el.classList.add('show');
      for (let i = 0; i < 3; i++) {
        if (i < (res.stars | 0)) {
          this._resultTimers.push(setTimeout(() => {
            stars[i].classList.add('on', 'pop');
            sfx('star', { index: i });
          }, 520 + i * 340));
        }
      }
    },
    hideResults(instant) {
      const el = this.el.results;
      if (!el) return;
      this._resultTimers.forEach(clearTimeout); this._resultTimers = [];
      el.classList.remove('show', 'inspecting');
    },

    // ---------------------------------------------------------------- settings
    _buildSettings() {
      const el = h(`
        <div id="settings" class="modal">
          <div class="modal-card glass">
            <div class="modal-head"><h3 data-i18n="core.settings">${icon('gear')}</h3><button class="btn btn-icon btn-ghost" data-act="close" data-i18n-title="core.close">${icon('close')}</button></div>
            <div class="set-row set-lang"><span data-i18n="hud.settings.language">${icon('globe')}</span>
              <div class="seg lang-seg" role="radiogroup" data-i18n-aria="hud.settings.language">${(I() ? I().languages() : []).map(l =>
                '<button type="button" role="radio" data-lang="' + esc(l.id) + '" lang="' + esc(l.id) + '">' + esc(l.name) + '</button>').join('')}</div></div>
            <label class="set-row"><span data-i18n="hud.settings.volume">${icon('volume')}</span><input type="range" min="0" max="100" step="1" data-set="volume" data-i18n-aria="hud.settings.volume"><output data-ref="volOut">70%</output></label>
            <label class="set-row"><span data-i18n="hud.settings.stress">${icon('stress')}</span><input type="checkbox" class="switch" data-set="showStress"></label>
            <label class="set-row"><span data-i18n="hud.settings.grid">${icon('grid')}</span><input type="checkbox" class="switch" data-set="showGrid"></label>
            <div class="set-row keys"><span data-i18n="hud.settings.shortcuts"></span><div class="kb">
              <span><kbd>1</kbd>–<kbd>6</kbd> <i data-i18n="hud.keys.material"></i></span><span><kbd>B</kbd> <i data-i18n="hud.keys.build"></i></span><span><kbd>E</kbd> <i data-i18n="hud.keys.erase"></i></span><span><kbd>P</kbd> <i data-i18n="hud.keys.pier"></i></span><span><kbd>S</kbd> <i data-i18n="hud.keys.select"></i></span><span><kbd>M</kbd> <i data-i18n="hud.keys.mirror"></i></span>
              <span><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd> <i data-i18n="hud.keys.undoRedo"></i></span><span><kbd>Shift</kbd> <i data-i18n="hud.keys.fineSnap"></i></span><span><kbd>Ctrl</kbd>+<i data-i18n="hud.keys.moveJoint"></i></span><span><kbd>Del</kbd> <i data-i18n="hud.keys.deleteSel"></i></span><span><kbd data-i18n="hud.keys.space"></kbd> <i data-i18n="hud.keys.test"></i></span><span><kbd>R</kbd> <i data-i18n="hud.keys.restart"></i></span><span><kbd>P</kbd> <i data-i18n="hud.keys.pause"></i></span><span><kbd data-i18n="hud.keys.wheel"></kbd> <i data-i18n="hud.keys.zoom"></i> · <kbd>F</kbd> <i data-i18n="hud.keys.fit"></i></span><span><kbd>F</kbd> <i data-i18n="hud.keys.follow"></i></span><span><kbd>T</kbd> <i data-i18n="hud.keys.track"></i></span><span data-i18n="hud.keys.pan"></span><span><kbd>Esc</kbd> <i data-i18n="hud.keys.back"></i></span></div></div>
            <div class="modal-foot"><button class="btn btn-ghost danger" data-act="reset" data-i18n="hud.settings.reset"></button><button class="btn btn-primary" data-act="close" data-i18n="core.done"></button></div>
          </div>
        </div>`);
      tr(el);
      el.addEventListener('click', e => {
        if (e.target === el) { this.closeSettings(); return; }
        const b = e.target.closest('[data-act], [data-lang]');
        if (!b) return;
        if (b.dataset.lang) { sfx('click'); if (I()) I().setLanguage(b.dataset.lang); return; }
        if (b.dataset.act === 'close') { sfx('click'); this.closeSettings(); }
        if (b.dataset.act === 'reset') {
          const label = key => { b.dataset.i18n = key; b.textContent = t(key); };
          if (!b.classList.contains('confirm')) { sfx('error'); b.classList.add('confirm'); label('hud.settings.resetConfirm'); setTimeout(() => { b.classList.remove('confirm'); label('hud.settings.reset'); }, 3500); return; }
          sfx('erase'); call('resetProgress'); b.classList.remove('confirm'); label('hud.settings.reset');
          this.toast(t('hud.settings.resetDone'), 'info');
        }
      });
      el.addEventListener('input', e => {
        const inp = e.target.closest('[data-set]');
        if (!inp) return;
        const key = inp.dataset.set;
        if (key === 'volume') {
          const v = (+inp.value) / 100;
          $('[data-ref=volOut]', el).textContent = I() ? I().percent(v) : Math.round(v * 100) + '%';
          call('setSetting', 'volume', v);
        }
      });
      el.addEventListener('change', e => {
        const inp = e.target.closest('[data-set]');
        if (!inp) return;
        if (inp.type === 'checkbox') { call('setSetting', inp.dataset.set, inp.checked); sfx('toggle', { on: inp.checked }); }
        if (inp.dataset.set === 'volume') sfx('click');
      });
      this.el.settings = el;
      return el;
    },
    applySettings() {
      const s = (game().settings) || (stor() ? stor().getSettings() : { volume: 0.7, showStress: true, showGrid: true });
      const el = this.el.settings;
      if (!el) return;
      $('[data-set=volume]', el).value = Math.round((s.volume != null ? s.volume : 0.7) * 100);
      const vol = s.volume != null ? s.volume : 0.7;
      $('[data-ref=volOut]', el).textContent = I() ? I().percent(vol) : Math.round(vol * 100) + '%';
      const cur = I() ? I().lang() : 'en';
      $$('[data-lang]', el).forEach(b => { const on = b.dataset.lang === cur; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
      $('[data-set=showStress]', el).checked = !!s.showStress;
      $('[data-set=showGrid]', el).checked = !!s.showGrid;
      this._sig.sim = null;
    },
    openSettings() { this.applySettings(); this.el.settings.classList.add('show'); },
    closeSettings() { this.el.settings.classList.remove('show'); },
    settingsOpen() { return !!(this.el.settings && this.el.settings.classList.contains('show')); },
    templatesOpen() { return !!(this.el.tplMenu && this.el.tplMenu.classList.contains('open')); },
    closeTemplates() { if (this.el.tplMenu) { this.el.tplMenu.classList.remove('open'); this.el.tplWrap.classList.remove('open'); } },
    resultsInspecting() { return !!(this.el.results && this.el.results.classList.contains('inspecting')); },
    setInspecting(on) { if (this.el.results) this.el.results.classList.toggle('inspecting', !!on); },

    // ---------------------------------------------------------------- screens
    showScreen(name) {
      this.screen = name;
      const map = { title: this.el.title, levelSelect: this.el.levels, level: this.el.level };
      Object.keys(map).forEach(k => map[k] && map[k].classList.toggle('active', k === name));
      document.body.dataset.screen = name;
      if (name === 'title') this.refreshTitle();
      if (name === 'levelSelect') this.buildLevelSelect();
      if (name !== 'level') { this.hideTooltip(); this.hideHint(); }
    },
    flash() {
      const f = this.el.fader;
      if (!f) return;
      f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    },

    // exposed helpers
    icon, money, theme, vehSvg, trainSvg, material, materials, levelMaterials, CHAPTERS, RAIL_CHAPTERS, THEMES,
    campaignOf, displayNum, levelLabel, shortLabel, badgeNum, hiddenLevelIds, unlockRuleText, unlockInfoBtn,
  };

  function budgetColor(r) {
    // green (≤70%) → lime (85%) → amber (100%) → red (over)
    if (r <= 0.7) return 'linear-gradient(90deg,#22c58b,#3ee08f)';
    if (r <= 0.85) return 'linear-gradient(90deg,#3ee08f,#c6e14a)';
    if (r <= 1) return 'linear-gradient(90deg,#c6e14a,#ffb429)';
    return 'linear-gradient(90deg,#ff8a3d,#ff4d5e)';
  }
  function stressColor(s) {
    if (s < 0.5) return '#5be38a';
    if (s < 0.75) return '#d8e04a';
    if (s < 0.9) return '#ffad33';
    return '#ff4d5e';
  }

  // tiny pictograms for the template menu (viewBox 64x30, deck at y=20)
  function tplPic(id) {
    const deck = '<path class="tp-deck" d="M4 20H60"/>';
    const P = {
      beam: '<path d="M4 20H60M4 24H60M4 20l6 4 6-4 6 4 6-4 6 4 6-4 6 4 6-4 6 4 6-4"/>',
      warren: '<path d="M4 20L10 10 16 20 22 10 28 20 34 10 40 20 46 10 52 20 58 10 60 20M10 10H58"/>',
      pratt: '<path d="M4 20L12 10H52L60 20M12 10V20M20 10V20M28 10V20M36 10V20M44 10V20M52 10V20M12 10L20 20M20 10L28 20M44 10L36 20M52 10L44 20"/>',
      howe: '<path d="M4 20L12 10H52L60 20M12 10V20M20 10V20M28 10V20M36 10V20M44 10V20M52 10V20M20 10L12 20M28 10L20 20M36 10L44 20M44 10L52 20"/>',
      deck_arch: '<path d="M4 28Q32 8 60 28M14 20V22M22 20V16.5M32 20V15M42 20V16.5M50 20V22"/>',
      through_arch: '<path d="M4 20Q32 -2 60 20M14 20V11M23 20V7M32 20V5.5M41 20V7M50 20V11"/>',
      suspension: '<path d="M16 28V4M48 28V4M2 20Q9 18 16 4Q32 26 48 4Q55 18 62 20M22 20V11M27 20V16M32 20V18M37 20V16M42 20V11"/>',
      cable_stayed: '<path d="M32 28V2M32 3L6 20M32 3L14 20M32 3L22 20M32 3L58 20M32 3L50 20M32 3L42 20"/>',
      viaduct: '<path d="M4 20V29M22 21V29M42 21V29M60 20V29M4 28Q13 20 22 28M22 28Q32 19 42 28M42 28Q51 20 60 28M9 20V23.5M13 20V22M17 20V23.5M27 20V23M32 20V21.6M37 20V23M47 20V23.5M51 20V22M55 20V23.5"/>',
    };
    return '<svg viewBox="0 0 64 30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">' + (P[id] || '') + '</g><g fill="none" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round">' + deck + '</g></svg>';
  }
  function matSwatch(id, m) {
    const c = m.color || '#999';
    switch (id) {
      case 'road': return '<svg viewBox="0 0 40 24"><rect x="2" y="8" width="36" height="8" rx="1.5" fill="#33373e"/><rect x="2" y="7" width="36" height="2" rx="1" fill="#6b7280"/><path d="M6 12h6M17 12h6M28 12h6" stroke="#ffd166" stroke-width="1.4"/></svg>';
      case 'reinforced_road': return '<svg viewBox="0 0 40 24"><rect x="2" y="8" width="36" height="8" rx="1.5" fill="#3a3f48"/><rect x="2" y="6.5" width="36" height="2.5" rx="1" fill="#9aa6b8"/><rect x="2" y="15" width="36" height="2.5" rx="1" fill="#9aa6b8"/><path d="M6 12h6M17 12h6M28 12h6" stroke="#ffd166" stroke-width="1.4"/></svg>';
      case 'wood': return '<svg viewBox="0 0 40 24"><rect x="2" y="8" width="36" height="8" rx="1.5" fill="' + c + '"/><path d="M4 10.5c8-1 14 1 22 0s10 0 12 0M4 13.5c9 1 15-1 22 0s9 0 12 0" stroke="rgba(60,30,10,.45)" stroke-width=".9" fill="none"/><circle cx="4.5" cy="12" r="1.3" fill="#d9d2c4"/><circle cx="35.5" cy="12" r="1.3" fill="#d9d2c4"/></svg>';
      case 'steel': return '<svg viewBox="0 0 40 24"><rect x="2" y="7" width="36" height="2.2" fill="#b9c3d0"/><rect x="2" y="14.8" width="36" height="2.2" fill="#8792a3"/><rect x="2" y="9" width="36" height="6" fill="' + c + '"/><g fill="#5d6675">' + [7, 14, 21, 28, 35].map(x => '<circle cx="' + x + '" cy="12" r=".9"/>').join('') + '</g></svg>';
      case 'rope': return '<svg viewBox="0 0 40 24"><path d="M2 9 Q20 18 38 9" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M2 9 Q20 18 38 9" stroke="rgba(90,60,20,.6)" stroke-width="2.4" stroke-dasharray="1 2" fill="none"/></svg>';
      case 'cable': return '<svg viewBox="0 0 40 24"><path d="M2 6 L38 18" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M2 6 L38 18" stroke="#c7ced8" stroke-width=".7" stroke-dasharray="2 1.5"/><circle cx="3" cy="6.3" r="2" fill="#c7ced8"/><circle cx="37" cy="17.7" r="2" fill="#c7ced8"/></svg>';
      case 'rail': return '<svg viewBox="0 0 40 24"><rect x="2" y="12" width="36" height="6" rx="1.5" fill="#7b6a58"/><g fill="#4a3526">' + [4, 10, 16, 22, 28, 34].map(x => '<rect x="' + x + '" y="10.5" width="3" height="4.5" rx=".5"/>').join('') + '</g><rect x="2" y="8.2" width="36" height="2.4" rx=".6" fill="#d4d9df"/><rect x="2" y="10" width="36" height=".8" fill="#7f8893"/></svg>';
      case 'masonry': return '<svg viewBox="0 0 40 24"><g fill="' + c + '" stroke="rgba(60,45,30,.55)" stroke-width=".8">' +
        '<rect x="2" y="7" width="11" height="5" rx=".8"/><rect x="14" y="7" width="12" height="5" rx=".8"/><rect x="27" y="7" width="11" height="5" rx=".8"/>' +
        '<rect x="2" y="12.5" width="6" height="5" rx=".8"/><rect x="9" y="12.5" width="12" height="5" rx=".8"/><rect x="22" y="12.5" width="10" height="5" rx=".8"/><rect x="33" y="12.5" width="5" height="5" rx=".8"/></g></svg>';
      case 'girder': return '<svg viewBox="0 0 40 24"><rect x="2" y="6" width="36" height="12" rx="1.5" fill="' + c + '"/><rect x="2" y="6" width="36" height="2.4" fill="#9fb3c8"/><rect x="2" y="15.6" width="36" height="2.4" fill="#33475c"/><path d="M8 8.4v7.2M16 8.4v7.2M24 8.4v7.2M32 8.4v7.2" stroke="rgba(255,255,255,.22)" stroke-width="1"/><g fill="#c9d4e0">' + [5, 13, 21, 29, 35].map(x => '<circle cx="' + x + '" cy="7.2" r=".7"/><circle cx="' + x + '" cy="16.8" r=".7"/>').join('') + '</g></svg>';
      default: return '<svg viewBox="0 0 40 24"><rect x="2" y="9" width="36" height="6" rx="2" fill="' + c + '"/></svg>';
    }
  }
  Hud.budgetColor = budgetColor;
  Hud.stressColor = stressColor;

  BG.Hud = Hud;
})(typeof window !== 'undefined' ? window : globalThis);
