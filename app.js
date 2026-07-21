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
  if ((config.privacyStatement || '').trim()) links.push(['Privacy Statement', config.privacyStatement]);
  if ((config.termsAndConditions || '').trim()) links.push(['Terms of Use', config.termsAndConditions]);
  $('legalLinks').innerHTML = links.map(([t], i) => `<a href="#" data-doc="${i}">${esc(t)}</a>`).join('');
  $('legalLinks').querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const [t, text] = links[Number(a.dataset.doc)];
      $('docTitle').textContent = t;
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
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* http/localhost quirks are fine */ });
  }
  // Android/Chrome offers an install event; surface it in the gear sheet.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const btn = $('installBtn');
    btn.hidden = false;
    btn.onclick = async () => {
      btn.hidden = true;
      $('settingsSheet').hidden = true;
      e.prompt();
    };
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
  } else {
    show('onboarding');
  }
}

boot();
