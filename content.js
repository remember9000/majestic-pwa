/* Majestic resident PWA — Phase 4: content pages.
   My Majestic (PDF documents + History repository + My Unit) and FAQ,
   mirroring the iOS pages against the same endpoints. PDFs render with
   vendored pdf.js so they work on Android Chrome (which won't inline
   PDFs natively). */

'use strict';

// ---------- pdf.js ----------
let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./vendor/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

async function renderPDF(container, bytes) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes }).promise;
  container.innerHTML = '';
  const width = container.clientWidth || 340;
  const ratio = window.devicePixelRatio || 1;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const vp = page.getViewport({ scale: scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = '100%';
    canvas.className = 'pdfpage';
    container.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }
}

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// in-memory media cache for the session (PDFs/photos are too big for localStorage)
const mediaCache = new Map();
async function cachedMedia(key, fetcher) {
  if (!mediaCache.has(key)) {
    mediaCache.set(key, fetcher().catch((e) => { mediaCache.delete(key); throw e; }));
  }
  return mediaCache.get(key);
}

async function backendJSON(params) {
  const u = new URL(store.backendURL);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'Could not load.');
  return j;
}

// ---------- My Majestic ----------
const DOC_PAGES = [
  ['Rules Guide', '📖', 'buildingRules'],
  ['Plan of Subdivision', '🗺', 'planOfSubdivision'],
  ['Boundary Document', '📐', 'boundaryDocument'],
  ['Legislation', '🏛', 'legislation']
];

Pages.myBuilding = function () {
  const config = store.config;
  openPage(label(config, 'myBuilding', 'My ' + (config.appName || 'Building')), (body) => {
    const mk = (icon, title, fn) => {
      const b = el(`<button class="navrow"><span class="icon">${icon}</span>${esc(title)}<span class="chev">›</span></button>`);
      b.addEventListener('click', fn);
      return b;
    };
    let c = card();
    c.appendChild(mk('🏠', label(config, 'myUnit', 'My ' + label(config, 'unitNoun', 'Unit')), Pages.myUnit));
    body.appendChild(c);

    c = card();
    DOC_PAGES.forEach(([title, icon, key]) => c.appendChild(mk(icon, title, () => Pages.document(title, key))));
    body.appendChild(c);

    c = card();
    c.appendChild(mk('🕰', 'History', Pages.history));
    body.appendChild(c);
  });
};

// ---------- document viewer ----------
Pages.document = function (title, docKey) {
  const config = store.config;
  openPage(title, (body) => {
    const available = (config.availableDocuments || {})[docKey];
    if (!available) {
      const c = card();
      c.appendChild(el('<div class="frow" style="font-size:15px"><b>This document isn\'t available yet.</b><br><span class="muted">Content for this page is coming soon.</span></div>'));
      body.appendChild(c);
      return;
    }
    const holder = el('<div class="pdfholder"><div class="fhint" style="text-align:center">Loading document…</div></div>');
    body.appendChild(holder);
    cachedMedia('doc-' + docKey + '-' + available, async () => {
      const j = await backendJSON({ action: 'document', code: config.code, doc: docKey });
      return b64ToBytes(j.base64);
    }).then((bytes) => renderPDF(holder, bytes))
      .catch((e) => { holder.innerHTML = `<div class="ferror">Couldn't load this document. ${esc(e.message)}</div>`; });
  });
};

// ---------- My Unit ----------
Pages.myUnit = function () {
  const config = store.config;
  const noun = label(config, 'unitNoun', 'Unit');
  const unitNumber = details.load().unitNumber.trim();
  openPage(label(config, 'myUnit', 'My ' + noun) + (unitNumber ? ' — ' + unitNumber : ''), (body) => {
    if (!unitNumber) {
      const c = card();
      c.appendChild(el(`<div class="frow muted" style="font-size:15px">Enter your ${esc(noun.toLowerCase())} number on the My Details page first, so we know which ${esc(noun.toLowerCase())} to show.</div>`));
      body.appendChild(c);
      return;
    }
    const holder = el('<div></div>');
    body.appendChild(holder);

    const cacheKey = 'unitinfo-' + config.code + '-' + unitNumber;
    const render = (info) => {
      holder.innerHTML = '';
      if (!info || (!info.waterMeter && !info.waterShutoff && !info.electricalMeter && !info.boundaries)) {
        const c = card();
        c.appendChild(el(`<div class="frow muted" style="font-size:15px">Information for ${esc(noun.toLowerCase())} ${esc(unitNumber)} is being prepared — check back soon.</div>`));
        holder.appendChild(c);
        return;
      }
      [['Water Meter', '⏲', info.waterMeter],
       ['Water Shut-off Valve', '💧', info.waterShutoff],
       ['Electrical Meter', '⚡', info.electricalMeter],
       ['Property Boundaries', '⬜', info.boundaries]]
        .forEach(([t, icon, text]) => {
          if (!text) return;
          holder.appendChild(sectionTitle(t));
          const c = card();
          c.appendChild(el(`<div class="frow" style="font-size:15px"><span style="margin-right:8px">${icon}</span>${esc(text)}</div>`));
          holder.appendChild(c);
        });
    };

    try { render(JSON.parse(localStorage.getItem(cacheKey))); } catch { /* no cache */ }
    backendJSON({ action: 'unit', code: config.code, unit: unitNumber })
      .then((j) => {
        localStorage.setItem(cacheKey, JSON.stringify(j.unit));
        render(j.unit);
      })
      .catch(() => { /* keep cache */ });
  });
};

// ---------- History ----------
Pages.history = function () {
  const config = store.config;
  openPage('History', (body) => {
    const holder = el('<div><div class="fhint" style="text-align:center">Loading…</div></div>');
    body.appendChild(holder);

    backendJSON({ action: 'history', code: config.code }).then((j) => {
      const items = j.items || [];
      holder.innerHTML = '';
      if (!items.length) {
        const c = card();
        c.appendChild(el('<div class="frow muted" style="font-size:15px">The building history is being prepared — check back soon.</div>'));
        holder.appendChild(c);
        return;
      }
      const images = items.filter((it) => it.kind === 'image');
      const c = card();
      items.forEach((item) => {
        const row = el(`<button class="navrow histrow">
            <span class="histthumb">${item.kind === 'image' ? '🖼' : '📄'}</span>
            <span class="histmeta">
              ${item.date ? `<span class="histdate">${esc(item.date)}</span>` : ''}
              ${item.title ? `<span class="histtitle">${esc(item.title)}</span>` : ''}
              ${item.caption ? `<span class="histcap">${esc(item.caption)}</span>` : ''}
            </span><span class="chev">›</span></button>`);
        row.addEventListener('click', () => {
          if (item.kind === 'image') openCarousel(config, images, item.id);
          else Pages.historyPDF(item);
        });
        c.appendChild(row);
        // lazy thumbnail
        cachedMedia('thumb-' + item.id + '-' + item.version, async () => {
          const t = await backendJSON({ action: 'historyThumb', code: config.code, id: item.id });
          return t.base64;
        }).then((b64) => {
          row.querySelector('.histthumb').innerHTML =
            `<img src="data:image/jpeg;base64,${b64}" alt="">`;
        }).catch(() => { /* keep icon */ });
      });
      holder.appendChild(c);
    }).catch((e) => {
      holder.innerHTML = `<div class="ferror">Couldn't load the history. ${esc(e.message)}</div>`;
    });
  });
};

Pages.historyPDF = function (item) {
  const config = store.config;
  openPage(item.title || 'Document', (body) => {
    const holder = el('<div class="pdfholder"><div class="fhint" style="text-align:center">Loading document…</div></div>');
    body.appendChild(holder);
    cachedMedia('hist-' + item.id + '-' + item.version, async () => {
      const j = await backendJSON({ action: 'historyItem', code: config.code, id: item.id });
      return b64ToBytes(j.base64);
    }).then((bytes) => renderPDF(holder, bytes))
      .catch((e) => { holder.innerHTML = `<div class="ferror">Couldn't load this document. ${esc(e.message)}</div>`; });
  });
};

// full-screen swipeable image carousel (scroll-snap)
function openCarousel(config, images, startID) {
  const overlay = el(`<div id="carousel">
      <button class="car-close">✕</button>
      <div class="car-track"></div>
      <div class="car-caption"></div>
    </div>`);
  const track = overlay.querySelector('.car-track');
  const caption = overlay.querySelector('.car-caption');

  images.forEach((item) => {
    const slide = el(`<div class="car-slide" data-id="${esc(item.id)}"><div class="car-spin">Loading…</div></div>`);
    track.appendChild(slide);
  });

  function captionFor(item) {
    return [item.date, item.title].filter(Boolean).join(' — ') || ' ';
  }

  const loadSlide = (slide) => {
    if (slide.dataset.loaded) return;
    slide.dataset.loaded = '1';
    const item = images.find((i) => i.id === slide.dataset.id);
    cachedMedia('hist-' + item.id + '-' + item.version, async () => {
      const j = await backendJSON({ action: 'historyItem', code: config.code, id: item.id });
      return j.base64;
    }).then((b64) => {
      slide.innerHTML = `<img src="data:image/jpeg;base64,${b64}" alt="">`;
    }).catch(() => { slide.innerHTML = '<div class="car-spin">Couldn\'t load</div>'; });
  };

  // load slides as they scroll into view; update the caption
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        loadSlide(entry.target);
        const item = images.find((i) => i.id === entry.target.dataset.id);
        if (item) caption.textContent = captionFor(item);
      }
    });
  }, { root: track, threshold: 0.6 });
  track.querySelectorAll('.car-slide').forEach((s) => io.observe(s));

  overlay.querySelector('.car-close').addEventListener('click', () => {
    io.disconnect();
    overlay.remove();
  });
  document.body.appendChild(overlay);

  // jump to the tapped image
  const startSlide = track.querySelector(`.car-slide[data-id="${CSS.escape(startID)}"]`);
  if (startSlide) startSlide.scrollIntoView({ behavior: 'instant', inline: 'start' });
}

// ---------- FAQ ----------
Pages.faq = function () {
  const config = store.config;
  openPage(label(config, 'faq', 'Frequently Asked Questions'), (body) => {
    const search = el('<div class="card"><div class="frow"><input type="text" placeholder="Search FAQs"></div></div>');
    const input = search.querySelector('input');
    const holder = el('<div><div class="fhint" style="text-align:center">Loading…</div></div>');
    body.appendChild(search);
    body.appendChild(holder);

    let items = [];
    const openCats = new Set();
    const cacheKey = 'faq-' + config.code;

    function grouped(list) {
      const order = [];
      const map = {};
      list.forEach((it) => {
        if (!map[it.category]) { order.push(it.category); map[it.category] = []; }
        map[it.category].push(it);
      });
      return order.map((catName) => ({ category: catName, items: map[catName] }));
    }

    function render() {
      const q = input.value.trim().toLowerCase();
      const filtered = q
        ? items.filter((it) => (it.question + ' ' + it.answer + ' ' + it.category).toLowerCase().includes(q))
        : items;
      holder.innerHTML = '';
      if (!items.length) {
        const c = card();
        c.appendChild(el('<div class="frow muted" style="font-size:15px">FAQs are being prepared — check back soon.</div>'));
        holder.appendChild(c);
        return;
      }
      if (!filtered.length) {
        const c = card();
        c.appendChild(el(`<div class="frow muted" style="font-size:15px">No questions match “${esc(input.value.trim())}”.</div>`));
        holder.appendChild(c);
        return;
      }
      grouped(filtered).forEach((group) => {
        const isOpen = q ? true : openCats.has(group.category);
        const c = card();
        const head = el(`<button class="navrow"><b>${esc(group.category)}</b>
          <span class="chev">${isOpen ? '⌄' : '›'}</span></button>`);
        head.addEventListener('click', () => {
          openCats.has(group.category) ? openCats.delete(group.category) : openCats.add(group.category);
          render();
        });
        c.appendChild(head);
        if (isOpen) {
          group.items.forEach((it) => {
            const qa = el(`<div class="frow faqitem"><div class="faqq">${esc(it.question)}</div>
              <div class="faqa" hidden>${esc(it.answer)}</div></div>`);
            qa.addEventListener('click', () => {
              const a = qa.querySelector('.faqa');
              a.hidden = !a.hidden;
            });
            c.appendChild(qa);
          });
        }
        holder.appendChild(c);
      });
    }

    input.addEventListener('input', render);

    try { items = JSON.parse(localStorage.getItem(cacheKey)) || []; render(); } catch { /* no cache */ }
    backendJSON({ action: 'faq', code: config.code }).then((j) => {
      items = j.faq || [];
      localStorage.setItem(cacheKey, JSON.stringify(items));
      render();
    }).catch(() => { if (!items.length) holder.innerHTML = '<div class="ferror">Couldn\'t load the FAQs.</div>'; });
  });
};


// ---------- My Reports ----------
// This device's own submissions with status + update history. The
// backend scopes strictly by device id; nothing here is shared.

async function fetchMyReports() {
  const u = new URL(store.backendURL);
  u.searchParams.set('action', 'myReports');
  u.searchParams.set('code', store.config.code);
  u.searchParams.set('deviceId', store.deviceId);
  const r = await fetch(u);
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'Could not load your reports.');
  return j.reports || [];
}

function statusPill(rep) {
  const text = rep.pending ? 'Verify email' : (rep.status || 'Received');
  const cls = rep.pending ? 'pill warn' : (rep.isClosed ? 'pill' : 'pill open');
  return `<span class="${cls}">${esc(text)}</span>`;
}

Pages.myReports = function () {
  openPage(label(store.config, 'myReports', 'My Reports'), (body) => {
    const status = el('<div class="fhint" style="text-align:center">Loading…</div>');
    body.appendChild(status);
    const holder = el('<div></div>');
    body.appendChild(holder);

    fetchMyReports().then((reports) => {
      status.remove();
      holder.innerHTML = '';
      if (!reports.length) {
        holder.appendChild(el(`<div class="card"><div class="empty-state">
          <div class="empty-icon">🗂</div>
          <div class="empty-title">Nothing yet</div>
          <div class="empty-sub">Reports, requests and notices you send from this device will appear here, with their progress.</div>
        </div></div>`));
        return;
      }
      const groups = [['Open', reports.filter((r) => !r.isClosed)],
                      ['Completed', reports.filter((r) => r.isClosed)]];
      groups.forEach(([heading, list]) => {
        if (!list.length) return;
        holder.appendChild(sectionTitle(heading));
        const c = card();
        list.forEach((rep) => {
          const row = el(`<button class="report-row">
            <div class="report-head"><span class="report-type">${esc(rep.type)}</span>${statusPill(rep)}</div>
            ${rep.summary ? `<div class="report-sum">${esc(rep.summary)}</div>` : ''}
            <div class="report-meta">${esc(rep.reference)} — ${esc(rep.date)}</div>
          </button>`);
          row.addEventListener('click', () => Pages.myReportDetail(rep));
          c.appendChild(row);
        });
        holder.appendChild(c);
      });
    }).catch(() => {
      status.textContent = "Couldn't load your reports just now.";
    });
  });
};

Pages.myReportDetail = function (rep) {
  openPage(rep.type, (body) => {
    body.appendChild(sectionTitle('Summary'));
    const c = card();
    c.appendChild(el(`<div class="frow"><div class="inline"><span>Reference</span><span>${esc(rep.reference)}</span></div></div>`));
    c.appendChild(el(`<div class="frow"><div class="inline"><span>Submitted</span><span>${esc(rep.date)}</span></div></div>`));
    c.appendChild(el(`<div class="frow"><div class="inline"><span>Status</span>${statusPill(rep)}</div></div>`));
    if (rep.summary) {
      c.appendChild(el(`<div class="frow"><label>What you told us</label><div class="report-sum">${esc(rep.summary)}</div></div>`));
    }
    body.appendChild(c);

    if (rep.pending) {
      const w = card();
      const link = el('<button class="navrow"><span class="icon">✉️</span>Verify your email address<span class="chev">›</span></button>');
      link.addEventListener('click', () => Pages.myDetails());
      w.appendChild(link);
      body.appendChild(w);
      body.appendChild(el('<div class="fhint">This submission is recorded but hasn\'t been sent to the building manager yet. Verifying your email releases it.</div>'));
    }

    body.appendChild(sectionTitle('Progress'));
    const p = card();
    if (!rep.updates || !rep.updates.length) {
      p.appendChild(el(`<div class="cal-empty">${rep.pending
        ? 'No updates yet — it will start moving once your email is verified.'
        : "No updates yet. You'll be notified here when the status changes."}</div>`));
    } else {
      rep.updates.forEach((u) => {
        p.appendChild(el(`<div class="update-row">
          <div class="update-title">${esc(u.title)}</div>
          <div class="update-msg">${esc(u.message)}</div>
          <div class="update-date">${esc(u.date)}</div>
        </div>`));
      });
    }
    body.appendChild(p);
  });
};
