/* Majestic resident PWA — Phase 1: onboarding, config theming, home + notices.
   Mirrors the iOS app against the same Apps Script backend. */

'use strict';

const BACKEND_DEFAULT = 'https://script.google.com/macros/s/AKfycbxSRjvUXWCJB93OA0kOytB0buSVSv9s-TXRr19nv0rek1qlZ973MKfXvEiQP5TqEpuN6g/exec';
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

// In-memory home state: strip counts survive re-renders without flicker.
const homeState = { unread: 0, openReports: null, blocked: false };

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

  renderStrip(config);
  renderTiles(config, homeState.blocked);
  renderLegal(config);
  loadNotices(config);
  // content.js (fetchMyReports) parses after app.js — defer past it.
  setTimeout(() => loadOpenReports(config), 0);
  maybeShowWelcome();
}

// Bell outline that takes the brand colour (emoji bells are yellow).
const BELL_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

// Status strip: most residents open the app to check something — open
// reports and unread notices lead, and tapping opens the Notices page.
function renderStrip(config) {
  const parts = [];
  if (homeState.openReports > 0) {
    parts.push(homeState.openReports + ' open report' + (homeState.openReports === 1 ? '' : 's'));
  }
  if (homeState.unread > 0) {
    parts.push(homeState.unread + ' new notice' + (homeState.unread === 1 ? '' : 's'));
  }
  const text = parts.length ? parts.join(' · ') : "Notices — you're all caught up";
  const holder = $('statusStrip');
  holder.innerHTML =
    `<button class="strip">
       <span class="strip-bell">${BELL_SVG}</span>
       <span class="strip-text">${esc(text)}</span>
       ${homeState.unread > 0 ? `<span class="strip-badge">${homeState.unread}</span>` : ''}
       <span class="chev">›</span>
     </button>`;
  holder.querySelector('.strip').addEventListener('click', () => Pages.notices());
}

// Fixed-order two-up tile grid, mirroring HomeView.swift: order never
// changes (people learn position), colours checkerboard warm/cool with
// no semantics. Sub-icons preview what's inside each tile.
function renderTiles(config, blocked) {
  const holder = $('navButtons');
  const tiles = [
    ['letUsKnow', '👋', label(config, 'letUsKnow', 'Let Us Know'), true, 'warm',
     ['📷', '📝', '🛠', '🔨'], () => Pages.letUsKnow()],
    ['myDetails', '👤', label(config, 'myDetails', 'My Details'), false, 'cool',
     ['📞', '✉️', '🚗'], () => Pages.myDetails()],
    ['myReports', '📋', label(config, 'myReports', 'My Reports'), false, 'cool',
     ['🕐', '✔️'], () => Pages.myReports()],
    ['myBuilding', '🏢', label(config, 'myBuilding', 'My ' + (config.appName || 'Building')), false, 'warm',
     ['🏠', '📖', '🗺', '🔄'], () => Pages.myBuilding()],
    ['faq', '❓', label(config, 'faq', 'FAQs'), false, 'warm',
     ['🔍', '💬'], () => Pages.faq()],
    ['contacts', '👥', 'Key Contacts', false, 'cool',
     ['📞', '✉️'], () => Pages.contacts()]
  ].filter(([, , , blockedHidden]) => !(blockedHidden && blocked));
  holder.innerHTML = '<div class="tilegrid">' + tiles.map(([key, icon, title, , tone, subs], i) =>
    `<button class="tile ${tone}" data-i="${i}">
       <span class="ticon">${icon}</span>
       <span class="tlabel">${esc(title)}</span>
       <span class="tsubs">${subs.map((s) => `<span>${s}</span>`).join('')}</span>
     </button>`).join('') + '</div>';
  holder.querySelectorAll('.tile').forEach((b, i) => {
    b.addEventListener('click', tiles[i][6]);
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

// Renders one heading + card of expandable notice rows into a container
// element (used by the Notices page; the home strip only counts them).
function renderNoticeGroup(container, config, heading, items, isAlert) {
  if (!items || !items.length) return;
  const read = store.readKeys(config.code);
  const holder = document.createElement('div');
  holder.innerHTML =
    `<div class="section-title">${esc(heading)}</div><div class="card">` +
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
  container.appendChild(holder);
}

function unreadIn(config, data) {
  const read = store.readKeys(config.code);
  return [...(data.alerts || []), ...(data.notices || [])]
    .filter((n) => !read.has(noticeKey(n))).length;
}

async function loadNotices(config) {
  // cached first (instant/offline), then fresh — mirrors NoticesStore
  const cached = store.cachedNotices(config.code);
  if (cached) {
    homeState.blocked = !!cached.blocked;
    homeState.unread = unreadIn(config, cached);
    renderStrip(config);
    renderTiles(config, homeState.blocked);
  }
  try {
    const fresh = await fetchNotices(config.code);
    const blocked = fresh.deviceStatus === 'blocked';
    store.setCachedNotices(config.code, { notices: fresh.notices, alerts: fresh.alerts || [], blocked });
    homeState.blocked = blocked;
    homeState.unread = unreadIn(config, fresh);
    renderStrip(config);
    renderTiles(config, blocked);
  } catch { /* keep cache */ }
}

// Open (not closed) submissions for the strip, mirroring refreshOpenReports.
async function loadOpenReports(config) {
  if (typeof fetchMyReports !== 'function') return;
  try {
    const reports = await fetchMyReports();
    homeState.openReports = reports.filter((r) => !r.isClosed).length;
    renderStrip(config);
  } catch { /* strip just omits the count */ }
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
