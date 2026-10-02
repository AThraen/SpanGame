// pwa: BG.PWA - installable / offline shell for SPAN.
//  - registers sw.js, but only over http(s); on file:// it does nothing (the game still runs)
//  - "New version available - tap to reload" toast when an updated worker is waiting
//  - one-time "ready to play offline" toast after the first install
//  - Settings: an "Install app" button (beforeinstallprompt) and an iOS "Add to Home Screen" hint
// Hooks: wraps BG.Hud.init to add its rows to the settings modal; never edits other modules' state.
(function (root) {
  'use strict';
  const BG = root.BG = root.BG || {};
  const doc = root.document;
  const nav = root.navigator || {};
  const supported = !!(doc && /^https?:$/.test(root.location && root.location.protocol) && 'serviceWorker' in nav);
  const UPDATE_CHECK_MS = 30 * 60 * 1000;
  const OFFLINE_FLAG = 'span.pwa.offlineReady';

  const lsGet = k => { try { return root.localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* storage off */ } };
  const mq = q => { try { return !!(root.matchMedia && root.matchMedia(q).matches); } catch (e) { return false; } };

  const PWA = BG.PWA = {
    supported,
    registration: null,
    waiting: null,          // a worker that is installed and waiting to take over
    installEvent: null,     // the deferred beforeinstallprompt event
    installed: false,
    offlineReady: false,
    version: null,
    ready: null,            // Promise<ServiceWorkerRegistration|null>

    isStandalone() {
      return mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || mq('(display-mode: minimal-ui)') || nav.standalone === true;
    },
    isIOS() {
      const ua = nav.userAgent || '';
      return /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    },
    canInstall() { return !!this.installEvent && !this.isStandalone(); },
    showIOSHint() { return this.isIOS() && !this.isStandalone(); },

    async install() {
      const ev = this.installEvent;
      if (!ev) return 'unavailable';
      this.installEvent = null;
      refreshRows();
      try {
        await ev.prompt();
        const choice = ev.userChoice ? await ev.userChoice : null;
        return (choice && choice.outcome) || 'prompted';
      } catch (e) { return 'error'; }
    },

    // tell the waiting worker to take over; the page reloads when it does
    applyUpdate() {
      const w = this.waiting || (this.registration && this.registration.waiting);
      if (!w) return false;
      reloadOnChange = true;
      w.postMessage({ type: 'SKIP_WAITING' });
      return true;
    },

    checkForUpdate() {
      const reg = this.registration;
      if (!reg) return Promise.resolve(false);
      lastCheck = Date.now();
      return reg.update().then(() => true, () => false);
    },

    // asks the active worker for {version, cache, files}
    getVersion() {
      const c = nav.serviceWorker && nav.serviceWorker.controller;
      if (!c || typeof MessageChannel === 'undefined') return Promise.resolve(null);
      return new Promise(res => {
        const ch = new MessageChannel();
        const t = setTimeout(() => res(null), 2000);
        ch.port1.onmessage = e => { clearTimeout(t); PWA.version = e.data && e.data.version; res(e.data); };
        c.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      });
    },
  };

  let reloadOnChange = false;
  let lastCheck = Date.now();

  // ------------------------------------------------------------------ toasts
  function hudToast(msg, kind, ms) {
    try { if (BG.Hud && BG.Hud.toast) BG.Hud.toast(msg, kind, ms); } catch (e) { /* hud not ready */ }
  }

  let updateEl = null;
  function showUpdateToast(worker) {
    PWA.waiting = worker;
    if (!doc || !doc.body) return;
    if (!updateEl) {
      updateEl = doc.createElement('button');
      updateEl.type = 'button';
      updateEl.className = 'pwa-update glass';
      updateEl.setAttribute('role', 'status');
      updateEl.innerHTML = '<span class="dot"></span><span class="pwa-update-text">New version available — tap to reload</span>';
      updateEl.addEventListener('click', () => {
        updateEl.classList.add('busy');
        if (!PWA.applyUpdate()) root.location.reload();
      });
      doc.body.appendChild(updateEl);
    }
    requestAnimationFrame(() => updateEl && updateEl.classList.add('in'));
  }

  // ------------------------------------------------------------------ service worker
  function trackInstalling(reg, w) {
    if (!w) return;
    const first = !nav.serviceWorker.controller;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && !first && nav.serviceWorker.controller) showUpdateToast(w);
      if (w.state === 'activated' && first) markOfflineReady();
    });
  }

  function markOfflineReady() {
    PWA.offlineReady = true;
    refreshRows();
    if (!lsGet(OFFLINE_FLAG)) {
      lsSet(OFFLINE_FLAG, '1');
      hudToast('SPAN is ready to play offline.', 'good', 3200);
    }
  }

  function register() {
    if (!supported) { PWA.ready = Promise.resolve(null); return; }
    nav.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadOnChange) { reloadOnChange = false; root.location.reload(); }
    });
    PWA.ready = nav.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      PWA.registration = reg;
      if (reg.waiting && nav.serviceWorker.controller) showUpdateToast(reg.waiting);
      if (reg.installing) trackInstalling(reg, reg.installing);
      if (reg.active && nav.serviceWorker.controller) { PWA.offlineReady = true; lsSet(OFFLINE_FLAG, '1'); }
      reg.addEventListener('updatefound', () => trackInstalling(reg, reg.installing));
      // phones keep the app open for days: look for a new version when it comes back to the front
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'visible' && Date.now() - lastCheck > UPDATE_CHECK_MS) PWA.checkForUpdate();
      });
      refreshRows();
      return reg;
    }).catch(err => {
      if (root.console) console.info('[pwa] service worker not registered:', err && err.message);
      return null;
    });
  }

  // ------------------------------------------------------------------ install prompt
  if (root.addEventListener) {
    root.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();               // keep it for the Settings button instead of the mini-infobar
      PWA.installEvent = e;
      refreshRows();
    });
    root.addEventListener('appinstalled', () => {
      PWA.installed = true; PWA.installEvent = null;
      refreshRows();
      hudToast('SPAN installed — find it on your home screen.', 'good', 3200);
    });
  }

  // ------------------------------------------------------------------ settings rows
  const ICON_INSTALL = '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3v11m0 0-4.5-4.5M12 14l4.5-4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_SHARE = '<svg class="pwa-share" viewBox="0 0 24 24" width="16" height="16" aria-label="Share"><path d="M12 15V3m0 0L8 7m4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_OFFLINE = '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let rowsEl = null;
  function mountSettings() {
    const modal = doc && doc.getElementById('settings');
    if (!modal) return;
    const card = modal.querySelector('.modal-card') || modal;
    if (card.querySelector('.pwa-rows')) { rowsEl = card.querySelector('.pwa-rows'); refreshRows(); return; }
    rowsEl = doc.createElement('div');
    rowsEl.className = 'pwa-rows';
    rowsEl.innerHTML =
      '<div class="set-row pwa-row" data-pwa="install" hidden><span>' + ICON_INSTALL + 'Install SPAN</span>' +
        '<button type="button" class="btn btn-primary pwa-btn" data-pwa-act="install">Install</button></div>' +
      '<div class="set-row pwa-row pwa-ios" data-pwa="ios" hidden><span>' + ICON_INSTALL + 'Add to Home Screen</span>' +
        '<small>Tap ' + ICON_SHARE + ' <b>Share</b>, then <b>Add to Home Screen</b> to play full-screen and offline.</small></div>' +
      '<div class="set-row pwa-row" data-pwa="offline" hidden><span>' + ICON_OFFLINE + 'Offline play</span><small class="pwa-ok">Ready</small></div>';
    rowsEl.addEventListener('click', e => {
      const b = e.target.closest('[data-pwa-act]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.pwaAct === 'install') PWA.install();
    });
    const keys = card.querySelector('.set-row.keys');
    if (keys) card.insertBefore(rowsEl, keys);
    else card.insertBefore(rowsEl, card.querySelector('.modal-foot'));
    refreshRows();
  }

  function refreshRows() {
    if (!rowsEl) return;
    const set = (k, on) => { const r = rowsEl.querySelector('[data-pwa=' + k + ']'); if (r) r.hidden = !on; };
    set('install', PWA.canInstall());
    set('ios', !PWA.canInstall() && PWA.showIOSHint());
    set('offline', supported && PWA.offlineReady);
  }

  // hook: every time the HUD (re)builds its DOM, add our rows to its settings modal
  function hookHud() {
    const Hud = BG.Hud;
    if (!Hud || Hud._pwaHooked || typeof Hud.init !== 'function') return false;
    const init = Hud.init;
    Hud.init = function () { const r = init.apply(this, arguments); try { mountSettings(); } catch (e) { /* never break the HUD */ } return r; };
    Hud._pwaHooked = true;
    return true;
  }

  if (doc) {
    hookHud();
    mountSettings();                    // HUD already built (pwa.js loaded late)
    const start = () => { hookHud(); if (!rowsEl) mountSettings(); register(); };
    if (doc.readyState === 'complete') start();
    else root.addEventListener('load', start);   // after load: never competes with the game's first paint
  }
})(typeof window !== 'undefined' ? window : globalThis);
