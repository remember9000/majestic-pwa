/* Majestic resident PWA — Phase 1: onboarding, config theming, home + notices.
   Mirrors the iOS app against the same Apps Script backend. */

'use strict';

const BACKEND_DEFAULT = 'https://script.google.com/macros/s/AKfycbzPpjeUtGsX7LkHqVUmnzJvS0OZ_HjTGe1JLiOOJk2F7MFpYW84_JJTPW3G9LWqZgjpVQ/exec';
const APP_VERSION = 'pwa-0.1';

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- persistent state (mirrors iOS UserDefaults/Keychain) ----------
const store = {
  get backendURL() { return localStorage.getItem('backendURL') || BACKEND_DEFAULT; },
  set backendURL(v) { localStorage.setItem('backendURL', v); },
  get config() { try { return JSON.parse(localStorage.getItem('config')); } catch { return null; } },
  set config(v) { v ? localStorage.setItem('config', JSON.stringify(v)) : localStorage.removeItem('config'); },
  get deviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem('deviceId', id); }
    return id;
  },
  readKeys(code) { try { return new Set(JSON.parse(localStorage.getItem('read-' + code)) || []); } catch { return new Set(); } },
  markRead(code, key) {
    const s = this.readKeys(code); s.add(key);
    localStorage.setItem('read-' + code, JSON.stringify([...s]));
  },
  cachedNotices(code) { try { return JSON.parse(localStorage.getItem('notices-' + code)); } catch { return null; } },
  setCachedNotices(code, v) { localStorage.setItem('notices-' + code, JSON.stringify(v)); }
};

// config label override, mirroring AppConfig.label(_:default:)
function label(config, key, dflt) {
  const v = ((config.settings || {})['label.' + key] || '').trim();
  return v || dflt;
}

// ---------- backend ----------
async function fetchConfig(code) {
  const u = new URL(store.backendURL);
  u.searchParams.set('code', code);
  u.searchParams.set('deviceId', store.deviceId);
  u.searchParams.set('model', 'Web (' + (navigator.platform || 'browser') + ')');
  u.searchParams.set('os', navigator.userAgent.slice(0, 80));
  u.searchParams.set('appVersion', APP_VERSION);
  const r = await fetch(u);
  const j = await r.json();
  if (!j.success || !j.config) throw new Error(j.error || 'Could not load configuration.');
  return j.config;
}

async function fetchNotices(code) {
  const u = new URL(store.backendURL);
  u.searchParams.set('action', 'notices');
  u.searchParams.set('code', code);
  u.searchParams.set('deviceId', store.deviceId);
  const r = await fetch(u);
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'Could not load notices.');
  return j;
}

// ---------- screens ----------
function show(screen) {
  $('onboarding').hidden = screen !== 'onboarding';
  // never reveal home while a subpage is open (async refreshes re-render
  // home in the background; the subpage stays on top)
  const subpageOpen = document.body.dataset.subpage === '1';
  $('home').hidden = screen !== 'home' || subpageOpen;
}

function applyTheme(config) {
  document.documentElement.style.setProperty('--primary', config.primaryColor || '#002147');
  document.documentElement.style.setProperty('--accent', config.accentColor || '#FFE18C');
  document.title = config.appName || 'Resident App';
}

// ---------- onboarding ----------
function initOnboarding() {
  $('unlockBtn').addEventListener('click', unlock);
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

  async function unlock() {
    const code = $('codeInput').value.trim().toUpperCase();
    if (!code) return;
    $('unlockBtn').disabled = true;
    $('onboardError').hidden = true;
    try {
      const config = await fetchConfig(code);
      store.config = config;
      renderHome();
    } catch (e) {
      $('onboardError').textContent = e.message;
      $('onboardError').hidden = false;
    }
    $('unlockBtn').disabled = false;
  }
}

// ---------- home ----------
// One-time welcome popup, first time a device lands on home. The sheet's
// "Welcome Message" column, if filled, is the body — each building writes
// its own. Fallback self-brands with the building name.
function maybeShowWelcome() {
  if (localStorage.getItem('welcomeShown')) return;
  localStorage.setItem('welcomeShown', '1');
  const config = store.config || {};
  const custom = (config.welcomeMessage || '').trim();
  showAlert('Welcome!', custom ||
    'Your ' + (config.appName || '') + ' app is packed with features that let you send and receive information relevant to your home and building.\n\nEnjoy!');
}

function renderHome() {
  const config = store.config;
  if (!config) { show('onboarding'); return; }
  applyTheme(config);
  show('home');

  $('barTitle').textContent = config.appName || '';

  const photo = $('brandPhoto');
  if (config.logoBase64) {
    photo.src = 'data:image;base64,' + config.logoBase64;
    photo.hidden = false;
  } else {
    photo.hidden = true;
  }

  renderNavButtons(config, false);
  renderLegal(config);
  loadNotices(config);
  maybeShowWelcome();
}

function renderNavButtons(config, blocked) {
  const holder = $('navButtons');
  const btns = [
    ['👤', label(config, 'myDetails', 'My Details'), () => Pages.myDetails()],
    ['🏛', label(config, 'myBuilding', 'My ' + (config.appName || 'Building')), () => Pages.myBuilding()],
    ...(blocked ? [] : [['🗣', label(config, 'letUsKnow', 'Let Us Know'), () => Pages.letUsKnow()]]),
    ['❓', label(config, 'faq', 'Frequently Asked Questions'), () => Pages.faq()]
  ];
  holder.innerHTML = btns.map(([icon, title], i) =>
    `<button class="navbtn" data-i="${i}">
       <span class="icon">${icon}</span>${esc(title)}<span class="chev">›</span>
     </button>`).join('');
  holder.querySelectorAll('.navbtn').forEach((b, i) => {
    b.addEventListener('click', btns[i][2]);
  });
  $('blockedBanner').hidden = !blocked;
}

function renderLegal(config) {
  const links = [];
  // Short link text on the footer; full titles on the opened document.
  if ((config.privacyStatement || '').trim()) links.push(['Privacy', 'Privacy Statement', config.privacyStatement]);
  if ((config.termsAndConditions || '').trim()) links.push(['Terms', 'Terms of Use', config.termsAndConditions]);
  $('legalLinks').innerHTML = links.map(([t], i) => `<a href="#" data-doc="${i}">${esc(t)}</a>`).join('');
  $('legalLinks').querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const [, title, text] = links[Number(a.dataset.doc)];
      $('docTitle').textContent = title;
      $('docText').textContent = text;
      $('docOverlay').hidden = false;
    });
  });
  const fb = $('feedbackLink');
  fb.hidden = false;
  fb.href = 'mailto:info@flexidev.com';
}

function noticeKey(n) { return (n.date || '') + '|' + (n.title || ''); }

function renderNoticeList(config, holderId, heading, items, isAlert) {
  const holder = $(holderId);
  if (!items || !items.length) { holder.innerHTML = ''; return; }
  const read = store.readKeys(config.code);
  const unread = items.filter((n) => !read.has(noticeKey(n))).length;
  const title = unread > 0 ? `${heading} — ${unread} new` : heading;
  holder.innerHTML =
    `<div class="section-title">${esc(title)}</div><div class="card">` +
    items.map((n, i) => {
      const isRead = read.has(noticeKey(n));
      return `<div class="notice ${n.priority === 'High' ? 'high' : ''}" data-i="${i}">
        <div class="nhead">
          ${isRead ? '' : '<span class="dot"></span>'}
          <span class="ntitle">${isAlert ? '🔔 ' : ''}${esc(n.title)}</span>
          <span class="ndate">${esc(isAlert && n.incidentID ? n.incidentID + ' — ' + n.date : n.date)}</span>
        </div>
        <div class="nbody">${esc(n.message)}</div>
      </div>`;
    }).join('') + '</div>';
  holder.querySelectorAll('.notice').forEach((el) => {
    el.addEventListener('click', () => {
      el.classList.toggle('open');
      const n = items[Number(el.dataset.i)];
      if (!store.readKeys(config.code).has(noticeKey(n))) {
        store.markRead(config.code, noticeKey(n));
        el.querySelector('.dot')?.remove();
      }
    });
  });
}

async function loadNotices(config) {
  // cached first (instant/offline), then fresh — mirrors NoticesStore
  const cached = store.cachedNotices(config.code);
  if (cached) {
    renderNoticeList(config, 'alertsSection', 'My Alerts', cached.alerts, true);
    renderNoticeList(config, 'noticesSection', 'Notices', cached.notices, false);
    renderNavButtons(config, !!cached.blocked);
  }
  try {
    const fresh = await fetchNotices(config.code);
    const blocked = fresh.deviceStatus === 'blocked';
    store.setCachedNotices(config.code, { notices: fresh.notices, alerts: fresh.alerts || [], blocked });
    renderNoticeList(config, 'alertsSection', 'My Alerts', fresh.alerts || [], true);
    renderNoticeList(config, 'noticesSection', 'Notices', fresh.notices || [], false);
    renderNavButtons(config, blocked);
  } catch { /* keep cache */ }
}

// ---------- PWA: service worker + install prompt ----------
// ---------- install nudge (second visit) ----------
// First load stays quiet; from the second visit on, returning residents get
// a gentle banner. Android/Chrome can trigger the real install dialog; iOS
// Safari only allows coaching (Share -> Add to Home Screen). Never shown
// when already running from the home screen; dismissing snoozes it for a
// few visits rather than nagging.
let deferredInstallPrompt = null;

const installNudge = {
  get visits() { return Number(localStorage.getItem('visitCount') || 0); },
  set visits(v) { localStorage.setItem('visitCount', String(v)); },
  get snoozedUntil() { return Number(localStorage.getItem('installSnoozeUntil') || 0); },
  set snoozedUntil(v) { localStorage.setItem('installSnoozeUntil', String(v)); }
};

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
const isIOSBrowser = /iphone|ipad|ipod/i.test(navigator.userAgent);

const IOS_SHARE_SVG = '<svg width="13" height="16" viewBox="0 0 14 17" fill="none" ' +
  'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M7 1v10M4 3.5L7 1l3 2.5"/><path d="M4.5 6.5H2v9h10v-9H9.5"/></svg>';

function maybeOfferInstall() {
  if (isStandalone() || !store.config) return;
  if (installNudge.visits < 2 || installNudge.visits < installNudge.snoozedUntil) return;
  const banner = $('installBanner');
  if (!banner.hidden) return;
  if (isIOSBrowser) {
    $('installBannerText').innerHTML =
      'Add this app to your Home Screen: tap <b>Share</b> ' + IOS_SHARE_SVG +
      ' below, then <b>Add to Home Screen</b>.';
    $('installBannerGo').hidden = true;
    banner.hidden = false;
  } else if (deferredInstallPrompt) {
    $('installBannerText').textContent =
      'Add this app to your home screen for one-tap access.';
    $('installBannerGo').hidden = false;
    banner.hidden = false;
  }
}

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* http/localhost quirks are fine */ });
  }

  // Count one visit per browser session (reloads don't inflate it).
  if (!sessionStorage.getItem('visitCounted')) {
    sessionStorage.setItem('visitCounted', '1');
    installNudge.visits += 1;
  }

  // Android/Chrome offers an install event; keep the gear-sheet button
  // AND feed the second-visit banner.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = $('installBtn');
    btn.hidden = false;
    btn.onclick = async () => {
      btn.hidden = true;
      $('settingsSheet').hidden = true;
      e.prompt();
    };
    maybeOfferInstall();
  });

  $('installBannerGo').addEventListener('click', async () => {
    $('installBanner').hidden = true;
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    }
  });
  $('installBannerClose').addEventListener('click', () => {
    $('installBanner').hidden = true;
    // Snooze: don't ask again until a few more visits have happened.
    installNudge.snoozedUntil = installNudge.visits + 4;
  });
  window.addEventListener('appinstalled', () => {
    $('installBanner').hidden = true;
    $('installBtn').hidden = true;
  });
}

// ---------- settings / change property ----------
function initChrome() {
  $('gearBtn').addEventListener('click', () => { $('settingsSheet').hidden = false; });
  $('settingsCancel').addEventListener('click', () => { $('settingsSheet').hidden = true; });
  $('settingsSheet').addEventListener('click', (e) => { if (e.target === $('settingsSheet')) $('settingsSheet').hidden = true; });
  $('changeProperty').addEventListener('click', () => {
    store.config = null;
    localStorage.removeItem('backendURL');
    $('settingsSheet').hidden = true;
    $('codeInput').value = '';
    show('onboarding');
  });
  $('docClose').addEventListener('click', () => { $('docOverlay').hidden = true; });
}

// ---------- boot ----------
async function boot() {
  initOnboarding();
  initChrome();
  initPWA();

  // QR onboarding: ?code=MAJ123. The backend URL is deliberately NOT
  // accepted from the URL — a crafted link/QR could otherwise silently
  // repoint every submission at an attacker's endpoint. Other tenants
  // get their own hosted copy with their own BACKEND_DEFAULT.
  const params = new URLSearchParams(location.search);
  const qrCode = (params.get('code') || '').trim().toUpperCase();

  if (store.config) {
    renderHome();
    maybeOfferInstall();
    // silent refresh, mirroring the iOS launch-time config re-fetch
    try {
      const fresh = await fetchConfig(store.config.code);
      if (JSON.stringify(fresh) !== JSON.stringify(store.config)) {
        store.config = fresh;
        renderHome();
      }
    } catch { /* cached config stands */ }
  } else if (qrCode) {
    show('onboarding');
    $('codeInput').value = qrCode;
    $('unlockBtn').click();
    // Once the auto-unlock lands on home, the next visit becomes eligible.
  } else {
    show('onboarding');
  }
}

boot();
