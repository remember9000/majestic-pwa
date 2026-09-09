/* Majestic resident PWA — Phase 1: onboarding, config theming, home + notices.
   Mirrors the iOS app against the same Apps Script backend. */

'use strict';

const BACKEND_DEFAULT = 'https://script.google.com/macros/s/AKfycbzKXGWnrpZQ_E7gevVH15W5iyz6PkcHNLpY9t20AJNfGbGHW31n5wVBr7r95HOsY18O/exec';
const APP_VERSION = 'pwa-0.1';

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Resident-facing wording for failures — never raw "Unexpected token '<'".
// Messages the backend wrote for residents pass through untouched.
function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (!navigator.onLine || /failed to fetch|load failed|networkerror|network request failed/i.test(m)) {
    return 'You appear to be offline. Please check your connection and try again.';
  }
  if (/unexpected token|<!doctype|<html|is not valid json|json\.parse|unexpected end/i.test(m)) {
    return "The building's server didn't answer properly. Please try again in a moment.";
  }
  if (/timeout|timed out/i.test(m)) {
    return "The building's server is taking too long to answer. Please try again in a moment.";
  }
  return m || 'Something went wrong. Please try again.';
}
const DRAFT_KEPT = '\n\nNothing was lost — your answers are still here.';

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
  // Tell the backend which logo we already hold; a matching version comes
  // back without the ~240 KB image, and we carry the cached bytes over.
  const cached = store.config;
  u.searchParams.set('logoVersion', (cached && cached.code === code && cached.logoVersion) || '');
  const r = await fetch(u);
  const j = await r.json();
  if (!j.success || !j.config) throw new Error(j.error || 'Could not load configuration.');
  const fresh = j.config;
  if (!fresh.logoBase64 && fresh.logoVersion && cached &&
      cached.code === code && cached.logoVersion === fresh.logoVersion) {
    fresh.logoBase64 = cached.logoBase64;
  }
  return fresh;
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
      $('onboardError').textContent = friendlyError(e);
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
// phase: 'idle' | 'loading' | 'loaded' | 'failed'; hasResult = any real
// notices result (cached or fresh) is on screen.
const homeState = { unread: 0, openReports: null, blocked: false,
                    attention: false, urgentTitle: '', alertCount: 0,
                    phase: 'idle', hasResult: false };

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
const MEGAPHONE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 11v2a2 2 0 0 0 2 2h2l6 4V5L7 9H5a2 2 0 0 0-2 2z"/><path d="M17 8a5 5 0 0 1 0 8"/></svg>';
const BELL_SMALL_SVG = BELL_SVG.replace('width="18" height="18"', 'width="14" height="14"');

// Two pills that sit like column headings over the tile grid — Notices
// centred over the left column, Updates over the right (above the
// Updates tile). Fixed height, so the grid never moves. Mirrors
// HomeView.strip / noticesPillText / updatesPillText.
function noticesPillText() {
  if (!homeState.hasResult) return homeState.phase === 'failed' ? 'Tap to retry' : 'Checking…';
  if (homeState.urgentTitle) return 'Important: ' + homeState.urgentTitle;
  const n = homeState.unread - homeState.alertCount;
  return n === 0 ? 'No notices' : n + ' notice' + (n === 1 ? '' : 's');
}
function updatesPillText() {
  if (!homeState.hasResult) return homeState.phase === 'failed' ? "Couldn't check" : 'Checking…';
  const n = homeState.alertCount;
  return n === 0 ? 'No updates' : n + ' update' + (n === 1 ? '' : 's');
}

function renderStrip(config) {
  const urgent = !!homeState.urgentTitle;
  const noticesActive = homeState.hasResult && (urgent || homeState.unread - homeState.alertCount > 0);
  const updatesActive = homeState.hasResult && homeState.alertCount > 0;
  const nText = noticesPillText(), uText = updatesPillText();
  const holder = $('statusStrip');
  holder.innerHTML =
    `<div class="pillrow">
       <button class="colpill${noticesActive ? (urgent ? ' red' : ' navy') : ''}" aria-label="${esc(nText)}. Building notices. Opens notices.">
         <span aria-hidden="true">${MEGAPHONE_SVG}</span>${esc(nText)}</button>
       <button class="colpill${updatesActive ? ' red' : ''}" aria-label="${esc(uText)}. Updates on your reports. Opens notices.">
         <span aria-hidden="true">${BELL_SMALL_SVG}</span>${esc(uText)}</button>
     </div>`;
  holder.querySelectorAll('.colpill').forEach((b, i) => b.addEventListener('click', () => {
    // A failed check retries in place; Notices pill → Notices page,
    // Updates pill → Updates page (it sits over the Updates tile).
    if (!homeState.hasResult && homeState.phase === 'failed') { loadNotices(config); return; }
    i === 0 ? Pages.notices() : Pages.myReports();
  }));
}

// Tile icons drawn as SVG where no emoji matches the iOS SF Symbol.
// They use currentColor so the tile tone (.tile.warm/.cool .ticon) tints them.
// Updates: two overlapping speech bubbles (bubble.left.and.bubble.right).
const REPORTS_ICON_SVG =
  '<svg viewBox="0 0 48 40" aria-hidden="true">' +
  '<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9 6h16a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4H15l-6 5v-5a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4z"/>' +
  '<path fill="#e8ebf5" d="M23 14h16a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4v5l-6-5H23a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4z"/>' +
  '</g></svg>';
// My Details: person in a rounded rectangle (person.crop.rectangle).
const DETAILS_ICON_SVG =
  '<svg viewBox="0 0 48 40" aria-hidden="true">' +
  '<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="4" y="4" width="40" height="32" rx="6"/>' +
  '<circle cx="24" cy="16" r="5.5" fill="currentColor"/>' +
  '<path fill="currentColor" d="M12 36c1.5-7 6.5-10.5 12-10.5S34.5 29 36 36z"/>' +
  '</g></svg>';
// FAQs: folder with a question mark (questionmark.folder).
const FAQ_ICON_SVG =
  '<svg viewBox="0 0 48 40" aria-hidden="true">' +
  '<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 10a3 3 0 0 1 3-3h11l4 4h19a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/>' +
  '<path d="M20.5 19.5a4 4 0 1 1 5.5 3.7c-1.2.5-2 1.4-2 2.8"/>' +
  '</g><circle cx="24" cy="30.5" r="1.6" fill="currentColor"/></svg>';

// Fixed-order two-up tile grid, mirroring HomeView.swift: order never
// changes (people learn position), colours checkerboard warm/cool with
// no semantics. Sub-icons preview what's inside each tile.
function renderTiles(config, blocked) {
  const holder = $('navButtons');
  const tiles = [
    // Order (2026-09-09): Let Us Know | Updates, My Majestic | FAQs,
    // My Details | Key Contacts. Checkerboard follows position (warm at
    // 1, 4, 5) — mirrors HomeView.swift.
    ['letUsKnow', '💬', label(config, 'letUsKnow', 'Let Us Know'), true, 'warm',
     ['📷', '📝', '🛠', '🔨'], () => Pages.letUsKnow()],
    ['myReports', REPORTS_ICON_SVG, label(config, 'myReports', 'Updates'), false, 'cool',
     ['🕐', '✔️'], () => Pages.myReports()],
    ['myBuilding', '🏢', label(config, 'myBuilding', 'My ' + (config.appName || 'Building')), false, 'cool',
     ['🏠', '📖', '🗺', '🔄'], () => Pages.myBuilding()],
    ['faq', FAQ_ICON_SVG, label(config, 'faq', 'FAQs'), false, 'warm',
     ['🔍', '💬'], () => Pages.faq()],
    ['myDetails', DETAILS_ICON_SVG, label(config, 'myDetails', 'My Details'), false, 'warm',
     ['📞', '✉️', '🚗'], () => Pages.myDetails()],
    ['contacts', '👥', 'Key Contacts', false, 'cool',
     ['📞', '✉️'], () => Pages.contacts()]
  ].filter(([, , , blockedHidden]) => !(blockedHidden && blocked));
  // Screen readers get just the tile name (icons and sub-icons hidden);
  // the Updates tile carries the open-report count.
  holder.innerHTML = '<div class="tilegrid">' + tiles.map(([key, icon, title, , tone, subs], i) => {
    const count = key === 'myReports' && homeState.openReports > 0 ? homeState.openReports : 0;
    const label = count ? `${title}, ${count} open report${count === 1 ? '' : 's'}` : title;
    return `<button class="tile ${tone}" data-i="${i}" aria-label="${esc(label)}">
       ${count ? `<span class="tile-count" aria-hidden="true">${count}</span>` : ''}
       <span class="ticon" aria-hidden="true">${icon}</span>
       <span class="tlabel">${esc(title)}</span>
       <span class="tsubs" aria-hidden="true">${subs.map((s) => `<span>${s}</span>`).join('')}</span>
     </button>`; }).join('') + '</div>';
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
        <div class="nbody">${esc(n.message)}${isAlert && n.incidentID
          ? `<button class="alert-report" data-ref="${esc(n.incidentID)}">🗨 View this report ›</button>` : ''}</div>
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

// Unread High-priority notice, or an unread personal alert.
function attentionIn(config, data) {
  const read = store.readKeys(config.code);
  return (data.alerts || []).some((a) => !read.has(noticeKey(a))) ||
    (data.notices || []).some((n) => n.priority === 'High' && !read.has(noticeKey(n)));
}

// Fills the strip's content-aware fields from a notices result.
function applyNoticesState(config, data) {
  const read = store.readKeys(config.code);
  homeState.unread = unreadIn(config, data);
  homeState.attention = attentionIn(config, data);
  homeState.alertCount = (data.alerts || []).filter((a) => !read.has(noticeKey(a))).length;
  const urgent = (data.notices || []).find((n) => n.priority === 'High' && !read.has(noticeKey(n)));
  homeState.urgentTitle = urgent ? urgent.title : '';
  homeState.hasResult = true;
}

async function loadNotices(config) {
  // cached first (instant/offline), then fresh — mirrors NoticesStore
  const cached = store.cachedNotices(config.code);
  if (cached) {
    homeState.blocked = !!cached.blocked;
    applyNoticesState(config, cached);
  }
  homeState.phase = 'loading';
  renderStrip(config);
  renderTiles(config, homeState.blocked);
  try {
    const fresh = await fetchNotices(config.code);
    const blocked = fresh.deviceStatus === 'blocked';
    store.setCachedNotices(config.code, { notices: fresh.notices, alerts: fresh.alerts || [], blocked });
    homeState.blocked = blocked;
    applyNoticesState(config, fresh);
    homeState.phase = 'loaded';
    renderStrip(config);
    renderTiles(config, blocked);
  } catch {
    homeState.phase = 'failed';   // cached state (if any) stays on screen
    renderStrip(config);
  }
}

// Open (not closed) submissions for the strip, mirroring refreshOpenReports.
async function loadOpenReports(config) {
  if (typeof fetchMyReports !== 'function') return;
  try {
    const reports = await fetchMyReports();
    homeState.openReports = reports.filter((r) => !r.isClosed).length;
    renderTiles(config, homeState.blocked);   // count pill on the Updates tile
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
    // Confirm first — one tap used to wipe the app (UI review #8).
    const name = (store.config && store.config.appName) || 'this building';
    if (!window.confirm(`Leave ${name}?\n\nThis removes ${name} from this device. You'll need the building's code or QR poster to set it up again. Your details are kept.`)) return;
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

  // Coming back to the tab/app: refresh so the strip isn't stale.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && store.config &&
        document.body.dataset.subpage !== '1') {
      loadNotices(store.config);
      loadOpenReports(store.config);
    }
  });

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
