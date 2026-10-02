// BG.Audio — fully synthesized WebAudio sound (no asset files).
// Lazily creates the AudioContext; call BG.Audio.unlock() from a user gesture
// (main.js does this on the first pointerdown/keydown).
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  let ctx = null, master = null, sfxBus = null, ambBus = null, engBus = null, comp = null;
  let noiseBuf = null, brownBuf = null;
  let volume = 0.7, muted = false, ambientOn = false, ambientNodes = null;
  const engines = new Map(); // key -> {osc1, osc2, filt, gain, pan}
  const lastPlayed = {};
  const warned = {};
  let seed = 12345;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  function ensure() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; return null; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : gainFor(volume);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9;
    ambBus = ctx.createGain(); ambBus.gain.value = 0.55;
    engBus = ctx.createGain(); engBus.gain.value = 0.6;
    sfxBus.connect(comp); ambBus.connect(comp); engBus.connect(comp);
    comp.connect(master); master.connect(ctx.destination);
    // white + brown noise buffers
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = rnd() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    return ctx;
  }
  function gainFor(v) { return v * v * 1.2; }
  function ready() { return ctx && ctx.state === 'running' && !muted && volume > 0.001; }
  function now() { return ctx.currentTime; }

  // ---- building blocks ----
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function connectOut(node, dest, pan) {
    if (pan != null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p); p.connect(dest);
    } else node.connect(dest);
  }
  function tone(o) {
    // {type,freq,freqEnd,glide,t,a,d,gain,dest,detune,filter,ff,q,pan}
    const t = o.t != null ? o.t : now();
    const a = o.a || 0.005, d = o.d || 0.2;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + (o.glide || a + d));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    env(g, t, a, o.gain || 0.2, d);
    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter; f.frequency.value = o.ff || 1200; f.Q.value = o.q || 0.7;
      node.connect(f); node = f;
    }
    node.connect(g);
    connectOut(g, o.dest || sfxBus, o.pan);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }
  function noise(o) {
    // {t,a,d,gain,filter,ff,ffEnd,q,dest,brown,pan,rate}
    const t = o.t != null ? o.t : now();
    const a = o.a || 0.003, d = o.d || 0.2;
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? brownBuf : noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.ff || 1000, t);
    if (o.ffEnd) f.frequency.exponentialRampToValueAtTime(o.ffEnd, t + a + d);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    env(g, t, a, o.gain || 0.2, d);
    src.connect(f); f.connect(g);
    connectOut(g, o.dest || sfxBus, o.pan);
    src.start(t, rnd() * 1.5); src.stop(t + a + d + 0.05);
  }
  function throttle(name, ms) {
    const t = (root.performance ? performance.now() : Date.now());
    if (lastPlayed[name] && t - lastPlayed[name] < ms) return false;
    lastPlayed[name] = t; return true;
  }

  // ---- sounds ----
  const S = {
    click() {
      const t = now();
      tone({ type: 'sine', freq: 1500, freqEnd: 900, t, a: 0.002, d: 0.05, gain: 0.12 });
      noise({ t, filter: 'highpass', ff: 4000, a: 0.001, d: 0.02, gain: 0.05 });
    },
    hover() {
      if (!throttle('hover', 40)) return;
      tone({ type: 'sine', freq: 2400, t: now(), a: 0.002, d: 0.03, gain: 0.02 });
    },
    toggle(o) {
      const on = o.on !== false;
      tone({ type: 'triangle', freq: on ? 700 : 900, freqEnd: on ? 1100 : 600, t: now(), a: 0.003, d: 0.08, gain: 0.1 });
    },
    place(o) {
      if (!throttle('place', 30)) return;
      const m = o.material || 'wood';
      const t = now();
      const pan = o.pan;
      if (m === 'steel') {
        // metallic clank: inharmonic partials + thunk
        [523, 1381, 2207, 3170].forEach((f, i) => tone({ type: 'sine', freq: f * (0.97 + rnd() * 0.06), t, a: 0.002, d: 0.35 - i * 0.06, gain: 0.07 / (i + 1), pan }));
        tone({ type: 'triangle', freq: 160, freqEnd: 70, t, a: 0.002, d: 0.12, gain: 0.25, pan });
        noise({ t, filter: 'bandpass', ff: 3000, q: 2, a: 0.001, d: 0.05, gain: 0.12, pan });
      } else if (m === 'rope' || m === 'cable') {
        // taut twang
        const f0 = m === 'cable' ? 110 : 150;
        tone({ type: 'sawtooth', freq: f0 * 1.6, freqEnd: f0, glide: 0.08, t, a: 0.003, d: 0.35, gain: 0.08, filter: 'lowpass', ff: 1400, q: 3, pan });
        tone({ type: 'sine', freq: f0 * 2, t, a: 0.003, d: 0.25, gain: 0.05, pan });
        noise({ t, filter: 'highpass', ff: 2500, a: 0.001, d: 0.03, gain: 0.05, pan });
      } else if (m === 'road' || m === 'reinforced_road') {
        // heavy slab thud
        tone({ type: 'sine', freq: 120, freqEnd: 50, t, a: 0.003, d: 0.2, gain: 0.35, pan });
        noise({ t, filter: 'lowpass', ff: 900, a: 0.002, d: 0.12, gain: 0.25, brown: true, pan });
        if (m === 'reinforced_road') tone({ type: 'sine', freq: 880 * (0.95 + rnd() * 0.1), t, a: 0.002, d: 0.18, gain: 0.04, pan });
      } else {
        // woody knock
        tone({ type: 'triangle', freq: 260 * (0.92 + rnd() * 0.16), freqEnd: 140, t, a: 0.002, d: 0.09, gain: 0.3, pan });
        noise({ t, filter: 'bandpass', ff: 900 + rnd() * 300, q: 3, a: 0.001, d: 0.07, gain: 0.25, pan });
      }
    },
    snap() { // magnet snap onto a joint
      if (!throttle('snap', 50)) return;
      const t = now();
      tone({ type: 'sine', freq: 1900, freqEnd: 2600, t, a: 0.002, d: 0.035, gain: 0.04 });
    },
    pier() {
      const t = now();
      tone({ type: 'sine', freq: 80, freqEnd: 40, t, a: 0.004, d: 0.35, gain: 0.4 });
      noise({ t, filter: 'lowpass', ff: 600, a: 0.003, d: 0.3, gain: 0.3, brown: true });
    },
    erase() {
      const t = now();
      noise({ t, filter: 'bandpass', ff: 2500, ffEnd: 400, q: 1.5, a: 0.01, d: 0.18, gain: 0.18 });
      tone({ type: 'sine', freq: 500, freqEnd: 180, t, a: 0.003, d: 0.12, gain: 0.12 });
    },
    error() {
      if (!throttle('error', 120)) return;
      const t = now();
      tone({ type: 'square', freq: 155, t, a: 0.004, d: 0.16, gain: 0.07, filter: 'lowpass', ff: 900 });
      tone({ type: 'square', freq: 147, t, a: 0.004, d: 0.16, gain: 0.07, filter: 'lowpass', ff: 900 });
      tone({ type: 'square', freq: 110, t: t + 0.12, a: 0.004, d: 0.18, gain: 0.07, filter: 'lowpass', ff: 700 });
    },
    creak(o) {
      if (!throttle('creak', 140)) return;
      const s = Math.min(1.2, Math.abs(o.stress || 0.8));
      const t = now();
      const steel = o.material === 'steel' || o.material === 'cable';
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const base = steel ? 210 + rnd() * 80 : 85 + rnd() * 50;
      osc.frequency.setValueAtTime(base, t);
      // irregular stick-slip wobble
      for (let i = 1; i <= 8; i++) osc.frequency.linearRampToValueAtTime(base * (0.8 + rnd() * 0.5), t + i * 0.045);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = steel ? 1400 : 650; f.Q.value = steel ? 6 : 3;
      const g = ctx.createGain(); env(g, t, 0.05, 0.04 + 0.07 * s, 0.35);
      osc.connect(f); f.connect(g); connectOut(g, sfxBus, o.pan);
      osc.start(t); osc.stop(t + 0.45);
    },
    break(o) {
      if (!throttle('break', 25)) return;
      const t = now();
      const m = o.material || 'wood';
      const pan = o.pan;
      noise({ t, filter: 'highpass', ff: 1800, a: 0.001, d: 0.09, gain: 0.5, pan });
      noise({ t: t + 0.01, filter: 'bandpass', ff: 700, q: 0.8, a: 0.002, d: 0.35, gain: 0.35, pan });
      tone({ type: 'sine', freq: 90, freqEnd: 35, t, a: 0.003, d: 0.45, gain: 0.45, pan });
      if (m === 'steel' || m === 'cable' || m === 'reinforced_road') {
        [740, 1630, 2890].forEach((f, i) => tone({ type: 'sine', freq: f * (0.95 + rnd() * 0.1), t, a: 0.001, d: 0.8 - i * 0.2, gain: 0.08 / (i + 1), pan }));
        tone({ type: 'sawtooth', freq: 1200, freqEnd: 300, t, a: 0.001, d: 0.25, gain: 0.04, filter: 'bandpass', ff: 1500, q: 4, pan });
      } else if (m === 'rope') {
        tone({ type: 'sawtooth', freq: 400, freqEnd: 90, t, a: 0.001, d: 0.3, gain: 0.08, filter: 'lowpass', ff: 1600, pan });
      } else {
        // splintering crackles
        for (let i = 0; i < 5; i++) noise({ t: t + 0.03 + rnd() * 0.2, filter: 'bandpass', ff: 1500 + rnd() * 2500, q: 4, a: 0.001, d: 0.03, gain: 0.18, pan });
      }
    },
    splash(o) {
      if (!throttle('splash', 90)) return;
      const t = now();
      const size = Math.min(2, Math.max(0.3, o.size || 1));
      const pan = o.pan;
      noise({ t, filter: 'lowpass', ff: 3500, ffEnd: 300, a: 0.01, d: 0.6 + size * 0.4, gain: 0.25 + size * 0.15, pan });
      noise({ t, filter: 'lowpass', ff: 400, a: 0.005, d: 0.4, gain: 0.3 * size, brown: true, pan });
      for (let i = 0; i < 6; i++) {
        const f = 400 + rnd() * 900;
        tone({ type: 'sine', freq: f, freqEnd: f * 1.8, glide: 0.05, t: t + 0.1 + rnd() * 0.6, a: 0.003, d: 0.06, gain: 0.04, pan });
      }
    },
    finish() { // a vehicle made it across
      const t = now();
      tone({ type: 'sine', freq: 1318.5, t, a: 0.003, d: 0.5, gain: 0.06, pan: 0.6 });
      tone({ type: 'sine', freq: 1975.5, t: t + 0.07, a: 0.003, d: 0.5, gain: 0.04, pan: 0.6 });
    },
    star(o) {
      const i = o.index || 0;
      const t = now();
      const base = [880, 1108.7, 1318.5][i % 3];
      tone({ type: 'triangle', freq: base, t, a: 0.004, d: 0.6, gain: 0.14 });
      tone({ type: 'sine', freq: base * 2, t, a: 0.004, d: 0.5, gain: 0.06 });
      tone({ type: 'sine', freq: base * 3.01, t: t + 0.02, a: 0.004, d: 0.4, gain: 0.03 });
      noise({ t, filter: 'highpass', ff: 6000, a: 0.002, d: 0.25, gain: 0.04 });
    },
    success() {
      const t = now();
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone({ type: 'triangle', freq: f, t: t + i * 0.11, a: 0.006, d: 0.35, gain: 0.16 });
        tone({ type: 'sine', freq: f * 2, t: t + i * 0.11, a: 0.006, d: 0.25, gain: 0.04 });
      });
      const tc = t + 0.46;
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        tone({ type: 'sawtooth', freq: f, t: tc, a: 0.03, d: 1.4, gain: 0.035, filter: 'lowpass', ff: 2400, detune: (i - 2) * 4 });
        tone({ type: 'sine', freq: f, t: tc, a: 0.02, d: 1.6, gain: 0.06 });
      });
      noise({ t: tc, filter: 'highpass', ff: 7000, a: 0.01, d: 1.0, gain: 0.05 });
    },
    fail() {
      const t = now();
      [392, 369.99, 349.23, 293.66].forEach((f, i) => {
        const d = i === 3 ? 0.9 : 0.22;
        tone({ type: 'sawtooth', freq: f, freqEnd: i === 3 ? f * 0.94 : null, glide: 0.9, t: t + i * 0.24, a: 0.01, d, gain: 0.08, filter: 'lowpass', ff: 1100, q: 2 });
        tone({ type: 'sine', freq: f / 2, t: t + i * 0.24, a: 0.01, d, gain: 0.08 });
      });
    },
    whoosh() {
      noise({ t: now(), filter: 'bandpass', ff: 300, ffEnd: 2200, q: 1.2, a: 0.12, d: 0.25, gain: 0.12 });
    },
    start() { // test begins
      const t = now();
      tone({ type: 'triangle', freq: 392, t, a: 0.005, d: 0.12, gain: 0.12 });
      tone({ type: 'triangle', freq: 587.33, t: t + 0.09, a: 0.005, d: 0.25, gain: 0.12 });
    },
    stop() {
      const t = now();
      tone({ type: 'triangle', freq: 587.33, t, a: 0.005, d: 0.1, gain: 0.1 });
      tone({ type: 'triangle', freq: 392, t: t + 0.08, a: 0.005, d: 0.2, gain: 0.1 });
    },

    // ---- Iron Road ----
    // horn({kind: 'whistle' | 'diesel' | 'chime' | 'bell', pan})
    horn(o) {
      if (!throttle('horn', 700)) return;
      const t = now(), pan = o.pan;
      const kind = o.kind || 'diesel';
      if (kind === 'whistle') {
        // steam whistle: a breathy chord (three pipes) with a pitch scoop and a long tail
        const chord = [523.25, 659.25, 783.99];
        chord.forEach((f, i) => {
          const osc = ctx.createOscillator(); osc.type = 'triangle';
          osc.frequency.setValueAtTime(f * 0.94, t);
          osc.frequency.exponentialRampToValueAtTime(f, t + 0.12);
          osc.frequency.setValueAtTime(f, t + 1.0);
          osc.frequency.exponentialRampToValueAtTime(f * 0.97, t + 1.35);
          const vib = ctx.createOscillator(); vib.frequency.value = 5.5 + i * 0.4;
          const vg = ctx.createGain(); vg.gain.value = f * 0.004;
          vib.connect(vg); vg.connect(osc.frequency);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.05, t + 0.09);
          g.gain.setValueAtTime(0.05, t + 1.0);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
          osc.connect(g); connectOut(g, sfxBus, pan);
          osc.start(t); vib.start(t); osc.stop(t + 1.45); vib.stop(t + 1.45);
        });
        noise({ t, filter: 'bandpass', ff: 2600, q: 1.2, a: 0.06, d: 1.3, gain: 0.07, pan });
      } else if (kind === 'chime') {
        // high-speed two-tone chime: clean, bright, slightly detuned pairs
        [[880, 0], [698.46, 0.32]].forEach(([f, dt]) => {
          tone({ type: 'sine', freq: f, t: t + dt, a: 0.01, d: 0.55, gain: 0.08, pan });
          tone({ type: 'sine', freq: f * 2.005, t: t + dt, a: 0.01, d: 0.4, gain: 0.03, pan });
          tone({ type: 'triangle', freq: f * 0.5, t: t + dt, a: 0.01, d: 0.5, gain: 0.03, pan });
        });
      } else if (kind === 'bell') {
        // tram bell: two dings of an inharmonic bell
        [0, 0.24].forEach(dt => [1, 2.76, 5.4].forEach((m, i) => tone({ type: 'sine', freq: 1180 * m, t: t + dt, a: 0.002, d: 0.6 - i * 0.15, gain: 0.07 / (i + 1), pan })));
      } else {
        // diesel air horn: a dissonant reed chord, sawtooth through a resonant low-pass
        [311.13, 369.99, 466.16].forEach((f, i) => {
          const osc = ctx.createOscillator(); osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(f * 0.97, t);
          osc.frequency.linearRampToValueAtTime(f, t + 0.06);
          osc.detune.value = (i - 1) * 6;
          const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 1600; flt.Q.value = 2.5;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.035, t + 0.05);
          g.gain.setValueAtTime(0.035, t + 0.95);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
          osc.connect(flt); flt.connect(g); connectOut(g, sfxBus, pan);
          osc.start(t); osc.stop(t + 1.2);
        });
      }
    },
    // one wheel over a rail joint: the "clack". Use BG.Audio.trainTick(speed, opts) rather than play().
    tick(o) {
      const sp = Math.max(0, o.speed || 0);
      if (sp < 0.6) return;
      if (!throttle('tick', sp > 25 ? 22 : 38)) return;
      const t = now(), pan = o.pan, heavy = Math.min(1, Math.max(0, o.heavy || 0));
      const lvl = Math.min(1, 0.25 + sp / 30) * (o.timeScale > 2 ? 0.6 : 1);
      noise({ t, filter: 'bandpass', ff: 1700 - heavy * 700 + rnd() * 300, q: 2.2, a: 0.001, d: 0.035, gain: 0.07 * lvl, pan });
      tone({ type: 'triangle', freq: 150 - heavy * 50 + rnd() * 20, freqEnd: 70, t, a: 0.001, d: 0.06, gain: 0.1 * lvl * (0.6 + heavy * 0.6), pan });
    },
    derail(o) {
      if (!throttle('derail', 400)) return;
      const t = now(), pan = o.pan, heavy = Math.min(1, Math.max(0, o.heavy != null ? o.heavy : 0.5));
      // impact
      noise({ t, filter: 'lowpass', ff: 2600, ffEnd: 200, a: 0.002, d: 0.9 + heavy * 0.6, gain: 0.55, pan });
      tone({ type: 'sine', freq: 70, freqEnd: 28, t, a: 0.003, d: 0.9, gain: 0.6, pan });
      // metal: crumpling partials and a long screech of steel on stone
      [430, 1170, 2310, 3530].forEach((f, i) => tone({ type: 'sine', freq: f * (0.95 + rnd() * 0.1), t: t + 0.02 * i, a: 0.002, d: 1.1 - i * 0.2, gain: 0.07 / (i + 1), pan }));
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1900, t + 0.1);
      for (let i = 1; i <= 10; i++) osc.frequency.linearRampToValueAtTime(900 + rnd() * 1400, t + 0.1 + i * 0.12);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 5;
      const g = ctx.createGain(); env(g, t + 0.08, 0.05, 0.05, 1.3);
      osc.connect(f); f.connect(g); connectOut(g, sfxBus, pan);
      osc.start(t + 0.08); osc.stop(t + 1.6);
      // tumbling crashes
      for (let i = 0; i < 6; i++) noise({ t: t + 0.25 + i * 0.16 + rnd() * 0.1, filter: 'bandpass', ff: 300 + rnd() * 900, q: 1.2, a: 0.002, d: 0.18, gain: 0.25 * (1 - i / 8), brown: true, pan });
    },
  };

  // ---- trains (continuous: rolling, traction, brake squeal, steam chuffs) ----
  // list: [{key, traction:'steam'|'diesel'|'electric'|'none', speed (m/s, already time-scale weighted),
  //         simSpeed, timeScale, braking (0..1), pan, mass (kg), gain?}] for every driving train
  const trains = new Map();
  function makeTrain(v) {
    const out = ctx.createGain(); out.gain.value = 1;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { out.connect(pan); pan.connect(engBus); } else out.connect(engBus);
    // rolling rumble
    const roll = ctx.createBufferSource(); roll.buffer = brownBuf; roll.loop = true;
    const rollF = ctx.createBiquadFilter(); rollF.type = 'lowpass'; rollF.frequency.value = 220;
    const rollG = ctx.createGain(); rollG.gain.value = 0.0001;
    roll.connect(rollF); rollF.connect(rollG); rollG.connect(out);
    // brake squeal: a thin, wavering whine
    const sq = ctx.createOscillator(); sq.type = 'sawtooth'; sq.frequency.value = 2900;
    const sqV = ctx.createOscillator(); sqV.frequency.value = 7;
    const sqVG = ctx.createGain(); sqVG.gain.value = 60;
    sqV.connect(sqVG); sqVG.connect(sq.frequency);
    const sqF = ctx.createBiquadFilter(); sqF.type = 'bandpass'; sqF.frequency.value = 3100; sqF.Q.value = 9;
    const sqG = ctx.createGain(); sqG.gain.value = 0.0001;
    sq.connect(sqF); sqF.connect(sqG); sqG.connect(out);
    const all = [roll, sq, sqV];
    const e = { out, pan, rollF, rollG, sqG, all, phase: 0, lastT: now(), traction: v.traction };
    if (v.traction === 'diesel') {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; f.Q.value = 2;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(out);
      all.push(o1, o2);
      Object.assign(e, { d1: o1, d2: o2, dG: g });
    } else if (v.traction === 'electric') {
      const o = ctx.createOscillator(); o.type = 'sine';
      const o2 = ctx.createOscillator(); o2.type = 'triangle';
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o.connect(g); o2.connect(g); g.connect(out);
      all.push(o, o2);
      Object.assign(e, { w1: o, w2: o2, wG: g });
    }
    all.forEach(n => n.start());
    return e;
  }
  function chuff(e, t, strength, pan) {
    // one exhaust beat: a short, gritty burst of filtered noise with a low thump
    noise({ t, filter: 'bandpass', ff: 700 + rnd() * 200, q: 0.9, a: 0.004, d: 0.13, gain: 0.12 * strength, dest: e.out });
    noise({ t, filter: 'lowpass', ff: 260, a: 0.003, d: 0.12, gain: 0.16 * strength, brown: true, dest: e.out });
  }
  function updateTrains(list) {
    if (!ctx || ctx.state !== 'running') return;
    const t = now();
    const seen = new Set();
    (list || []).slice(0, 6).forEach(v => {
      seen.add(v.key);
      let e = trains.get(v.key);
      if (!e) { e = makeTrain(v); trains.set(v.key, e); }
      const sp = Math.max(0, v.speed || 0);
      const heavy = Math.min(1, Math.max(0, (v.mass || 1e5) / 1.5e6));
      const g0 = v.gain != null ? v.gain : 1;
      if (e.pan && v.pan != null) e.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, v.pan)), t, 0.15);
      e.rollF.frequency.setTargetAtTime(120 + sp * 9 + heavy * 40, t, 0.2);
      e.rollG.gain.setTargetAtTime((0.01 + Math.min(1, sp / 30) * (0.05 + heavy * 0.05)) * g0, t, 0.25);
      e.sqG.gain.setTargetAtTime(v.braking > 0.15 && sp > 2 ? 0.02 * Math.min(1, v.braking) * g0 : 0.0001, t, 0.12);
      if (e.dG) {
        const f = 38 + sp * 1.4 + heavy * 6;
        e.d1.frequency.setTargetAtTime(f, t, 0.3); e.d2.frequency.setTargetAtTime(f * 0.5, t, 0.3);
        e.dG.gain.setTargetAtTime((0.022 + heavy * 0.02) * g0, t, 0.3);
      }
      if (e.wG) {
        const f = 180 + sp * 14;
        e.w1.frequency.setTargetAtTime(f, t, 0.3); e.w2.frequency.setTargetAtTime(f * 1.5, t, 0.3);
        e.wG.gain.setTargetAtTime((0.004 + Math.min(1, sp / 60) * 0.012) * g0, t, 0.3);
      }
      if (e.traction === 'steam') {
        // four exhaust beats per turn of a ~1.6 m driving wheel; capped so fast-forward stays musical
        const dt = Math.min(0.25, Math.max(0, t - e.lastT));
        const rate = Math.min(11, (4 * (v.simSpeed != null ? v.simSpeed : sp) * Math.min(2, v.timeScale || 1)) / (Math.PI * 1.6));
        e.phase += dt * Math.max(rate, sp > 0.3 ? 0.9 : 0);
        let n = 0;
        while (e.phase >= 1 && n < 3) {
          e.phase -= 1; n++;
          const accent = (e.beat = ((e.beat | 0) + 1) % 4) === 0 ? 1.25 : 1;
          chuff(e, t + n * 0.01, accent * g0 * (rate > 6 ? 0.7 : 1));
        }
        if (e.phase > 1) e.phase = 0;
      }
      e.lastT = t;
    });
    trains.forEach((e, key) => {
      if (seen.has(key)) return;
      e.out.gain.setTargetAtTime(0.0001, t, 0.2);
      trains.delete(key);
      setTimeout(() => { e.all.forEach(n => { try { n.stop(); } catch (x) { /* */ } }); try { e.out.disconnect(); } catch (x) { /* */ } }, 1200);
    });
  }

  // ---- ambient wind loop ----
  function buildAmbient() {
    if (!ctx || ambientNodes) return;
    const src = ctx.createBufferSource(); src.buffer = brownBuf; src.loop = true;
    const src2 = ctx.createBufferSource(); src2.buffer = noiseBuf; src2.loop = true; src2.playbackRate.value = 0.5;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1300; f2.Q.value = 4;
    const g = ctx.createGain();
    const g2 = ctx.createGain(); g2.gain.value = 0.008;
    // slow LFOs for gusts
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 260;
    lfo.connect(lfoG); lfoG.connect(f.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.035;
    lfo2.connect(lfo2G); lfo2G.connect(g.gain);
    const lfo3 = ctx.createOscillator(); lfo3.frequency.value = 0.045;
    const lfo3G = ctx.createGain(); lfo3G.gain.value = 500;
    lfo3.connect(lfo3G); lfo3G.connect(f2.frequency);
    src.connect(f); f.connect(g); g.connect(ambBus);
    src2.connect(f2); f2.connect(g2); g2.connect(ambBus);
    const t = now();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 3);
    [src, src2, lfo, lfo2, lfo3].forEach(n => n.start());
    ambientNodes = { all: [src, src2, lfo, lfo2, lfo3], g, g2 };
  }
  function stopAmbient() {
    ambientOn = false;
    if (!ambientNodes || !ctx) return;
    const n = ambientNodes; ambientNodes = null;
    const t = now();
    n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0, t, 0.4);
    n.g2.gain.setTargetAtTime(0, t, 0.4);
    setTimeout(() => n.all.forEach(x => { try { x.stop(); } catch (e) { /* */ } }), 2500);
  }

  // ---- engines ----
  // list: [{key, mass, speed (m/s), pan (-1..1), gain?}] for every *driving* vehicle; missing keys fade out.
  function updateEngines(list) {
    if (!ctx || ctx.state !== 'running') return;
    const t = now();
    const seen = new Set();
    (list || []).slice(0, 10).forEach(v => {
      seen.add(v.key);
      let e = engines.get(v.key);
      const heavy = Math.min(1, Math.max(0, ((v.mass || 1500) - 1000) / 40000));
      if (!e) {
        const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
        const osc2 = ctx.createOscillator(); osc2.type = 'square';
        const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 260 - heavy * 120; filt.Q.value = 1.5;
        const gain = ctx.createGain(); gain.gain.value = 0.0001;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        osc1.connect(filt); osc2.connect(filt); filt.connect(gain);
        if (pan) { gain.connect(pan); pan.connect(engBus); } else gain.connect(engBus);
        osc1.start(); osc2.start();
        e = { osc1, osc2, filt, gain, pan };
        engines.set(v.key, e);
      }
      const sp = Math.max(0, Math.abs(v.speed || 0));
      const f = (34 - heavy * 16) + sp * (2.2 - heavy * 0.9);
      e.osc1.frequency.setTargetAtTime(f, t, 0.15);
      e.osc2.frequency.setTargetAtTime(f * 0.505, t, 0.15);
      const g = (0.016 + heavy * 0.028) * (0.5 + Math.min(1, sp / 15) * 0.5) * (v.gain != null ? v.gain : 1);
      e.gain.gain.setTargetAtTime(g, t, 0.2);
      if (e.pan && v.pan != null) e.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, v.pan)), t, 0.1);
    });
    engines.forEach((e, key) => {
      if (seen.has(key)) return;
      e.gain.gain.setTargetAtTime(0.0001, t, 0.15);
      engines.delete(key);
      setTimeout(() => { try { e.osc1.stop(); e.osc2.stop(); } catch (x) { /* */ } }, 900);
    });
  }

  const Audio = {
    get context() { return ctx; },
    get volume() { return volume; },
    get muted() { return muted; },
    // Create/resume the AudioContext. Must be called from a user gesture at least once.
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') { try { ctx.resume().then(() => { if (ambientOn) buildAmbient(); }); } catch (e) { /* */ } }
      if (ambientOn && ctx.state === 'running') buildAmbient();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, +v || 0));
      if (master) master.gain.setTargetAtTime(muted ? 0 : gainFor(volume), ctx.currentTime, 0.05);
    },
    setMuted(m) { muted = !!m; Audio.setVolume(volume); },
    // name: click hover toggle place pier erase error creak break splash finish star success fail whoosh start stop
    play(name, opts) {
      if (!ready()) return;
      const fn = S[name];
      if (!fn) return;
      try { fn(opts || {}); } catch (e) { if (!warned[name]) { warned[name] = 1; console.warn('[audio] ' + name + ':', e && e.message); } }
    },
    startAmbient() { ambientOn = true; if (ctx && ctx.state === 'running') buildAmbient(); },
    stopAmbient() { stopAmbient(); },
    updateEngines(list) { try { updateEngines(list); } catch (e) { /* */ } },
    stopEngines() { try { updateEngines([]); } catch (e) { /* */ } try { updateTrains([]); } catch (e) { /* */ } },
    // trains: see updateTrains above; missing keys fade out
    updateTrains(list) { if (!ready()) { try { updateTrains([]); } catch (e) { /* */ } return; } try { updateTrains(list); } catch (e) { if (!warned.trains) { warned.trains = 1; console.warn('[audio] trains:', e && e.message); } } },
    // clickety-clack: call once per wheel passing a rail joint. speed in m/s (sim), opts {pan, heavy 0..1, timeScale}
    trainTick(speed, opts) { Audio.play('tick', Object.assign({ speed }, opts || {})); },
    sounds: Object.keys(S),
  };

  // convenience aliases: BG.Audio.place({material}) etc.
  Object.keys(S).forEach(k => { if (!(k in Audio)) Audio[k] = o => Audio.play(k, o); });

  BG.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
