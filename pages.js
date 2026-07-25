/* Majestic resident PWA — Phase 2: My Details (+ email verification),
   Let Us Know, and the four attachment-free forms (trades, renovation,
   access pass, lift booking). Payloads and validation mirror the iOS app. */

'use strict';

// ---------- user details (mirror of iOS UserDetails/UserDefaults) ----------
const details = {
  load() {
    try { return { ...this.blank(), ...(JSON.parse(localStorage.getItem('userDetails')) || {}) }; }
    catch { return this.blank(); }
  },
  save(d) { localStorage.setItem('userDetails', JSON.stringify(d)); },
  blank() {
    return { title: '', firstName: '', lastName: '', unitNumber: '', phoneNumber: '',
             email: '', verifiedEmail: '', carLicenses: '', carLots: '',
             hasAgent: false, managingAgent: '', managementCompany: '',
             agentContact: '', agentEmail: '' };
  },
  fullName(d) { return [d.title, d.firstName, d.lastName].filter(Boolean).join(' '); },
  emailVerified(d) { return !!d.email && d.email === d.verifiedEmail; }
};

// ---------- normalisers (ported from MyDetailsView.swift) ----------
function normalizeUnit(raw) {
  let digits = '', letter = '';
  for (const ch of raw.toUpperCase()) {
    if (/[0-9]/.test(ch) && !letter) digits += ch;
    else if (/[A-Z]/.test(ch) && digits && !letter) letter = ch;
  }
  return (digits + letter).slice(0, 6);
}
function filterPhone(raw) {
  let out = raw.startsWith('+') ? '+' : '';
  let digits = 0;
  for (const ch of raw) {
    if (/[0-9]/.test(ch)) { if (digits >= 15) break; digits++; out += ch; }
    else if (ch === ' ' && out && !out.endsWith(' ') && !out.endsWith('+')) out += ch;
  }
  return out.replace(/ +$/, '');
}
function groupPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') || digits.length !== 10 || !digits.startsWith('0')) return raw;
  return digits.startsWith('04')
    ? `${digits.slice(0,4)} ${digits.slice(4,7)} ${digits.slice(7)}`
    : `${digits.slice(0,2)} ${digits.slice(2,6)} ${digits.slice(6)}`;
}
const emailValid = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

// ---------- page navigation ----------
const Pages = {};
let pageStack = [];

function openPage(title, render) {
  pageStack.push({ title, render });
  drawPage();
}
function drawPage() {
  const top = pageStack[pageStack.length - 1];
  document.body.dataset.subpage = '1';
  $('home').hidden = true;
  $('page').hidden = false;
  $('pageTitle').textContent = top.title;
  const body = $('pageBody');
  body.innerHTML = '';
  top.render(body);
  window.scrollTo(0, 0);
}
function goBack() {
  pageStack.pop();
  if (pageStack.length) { drawPage(); return; }
  delete document.body.dataset.subpage;
  $('page').hidden = true;
  renderHome();
}
$('backBtn').addEventListener('click', goBack);

function showAlert(title, msg, onClose) {
  $('alertTitle').textContent = title;
  $('alertMsg').textContent = msg;
  $('alertBox').hidden = false;
  $('alertClose').onclick = () => { $('alertBox').hidden = true; onClose && onClose(); };
}

// ---------- element builders ----------
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}
function card() { return el('<div class="card"></div>'); }
function sectionTitle(text) { return el(`<div class="section-title">${esc(text)}</div>`); }

function textRow(labelText, value, oninput, opts = {}) {
  const row = el(`<div class="frow"><label>${esc(labelText)}</label></div>`);
  const input = el(`<input type="${opts.type || 'text'}" value="${esc(value)}" placeholder="${esc(opts.placeholder || '')}">`);
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => input.setAttribute(k, v));
  input.addEventListener('input', () => oninput(input));
  if (opts.onblur) input.addEventListener('blur', () => opts.onblur(input));
  row.appendChild(input);
  return row;
}
function textareaRow(labelText, value, oninput, placeholder) {
  const row = el(`<div class="frow"><label>${esc(labelText)}</label></div>`);
  const input = el(`<textarea placeholder="${esc(placeholder || '')}"></textarea>`);
  input.value = value;
  input.addEventListener('input', () => oninput(input.value));
  row.appendChild(input);
  return row;
}
function selectRow(labelText, options, value, onchange, placeholder) {
  const row = el(`<div class="frow"><label>${esc(labelText)}</label></div>`);
  const sel = el('<select></select>');
  sel.appendChild(el(`<option value="">${esc(placeholder || 'Select…')}</option>`));
  options.forEach((o) => {
    const opt = el(`<option value="${esc(o)}">${esc(o)}</option>`);
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onchange(sel.value));
  return row.appendChild(sel), row;
}
function dateRow(labelText, value, onchange, min) {
  const row = el(`<div class="frow"><div class="inline"><span>${esc(labelText)}</span></div></div>`);
  const input = el(`<input type="date" value="${value}">`);
  if (min) input.min = min;
  input.addEventListener('change', () => onchange(input));
  row.firstChild.appendChild(input);
  return row;
}
function timeRow(labelText, value, onchange) {
  const row = el(`<div class="frow"><div class="inline"><span>${esc(labelText)}</span></div></div>`);
  const input = el(`<input type="time" value="${value}">`);
  input.addEventListener('change', () => onchange(input.value));
  row.firstChild.appendChild(input);
  return row;
}

/** Yes/No/Unsure question with optional details field (iOS YesNoQuestion). */
function questionBlock(q, state, key, detailsKey, hint, detailsPrompt, onchange) {
  const block = el(`<div class="qblock">
      <div class="q">${esc(q)}</div>
      ${hint ? `<div class="qhint">${esc(hint)}</div>` : ''}
      <div class="seg"></div>
    </div>`);
  const seg = block.querySelector('.seg');
  ['Yes', 'No', 'Unsure'].forEach((o) => {
    const b = el(`<button type="button">${o}</button>`);
    if (state[key] === o) b.classList.add('sel');
    b.addEventListener('click', () => {
      state[key] = o;
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      onchange();
    });
    seg.appendChild(b);
  });
  const dt = el(`<input type="text" placeholder="${esc(detailsPrompt)}">`);
  dt.value = state[detailsKey] || '';
  dt.addEventListener('input', () => { state[detailsKey] = dt.value; });
  block.appendChild(dt);
  return block;
}

// ---------- reporter section (mirrors ReporterDetailsSection) ----------
function reporterSection(container, config) {
  const d = details.load();
  const noun = label(config, 'unitNoun', 'Unit');
  container.appendChild(sectionTitle('Your Details'));
  const c = card();
  const name = details.fullName(d);
  if (name || d.unitNumber || d.phoneNumber || d.email) {
    const bub = el('<div class="bubbles"></div>');
    if (name) bub.appendChild(el(`<span class="bubble">${esc(name)}</span>`));
    if (d.unitNumber) bub.appendChild(el(`<span class="bubble">${esc(noun + ' ' + d.unitNumber)}</span>`));
    if (d.phoneNumber) bub.appendChild(el(`<span class="bubble">${esc(d.phoneNumber)}</span>`));
    if (d.email) bub.appendChild(el(`<span class="bubble">${esc(d.email)}</span>`));
    c.appendChild(bub);
  }
  if (!name.trim() || !d.unitNumber.trim()) {
    const warn = el(`<div class="warnrow">⚠ <a href="#">Add your name and ${esc(noun.toLowerCase())} number in My Details</a></div>`);
    warn.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); Pages.myDetails(); });
    c.appendChild(warn);
  }
  container.appendChild(c);
  const up = el('<div class="updetails"><a href="#">Update details</a></div>');
  up.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); Pages.myDetails(); });
  container.appendChild(up);
}

// ---------- backend submit ----------
async function postReport(payload) {
  const d = details.load();
  payload.schemaVersion = 2;
  payload.deviceId = store.deviceId;
  payload.emailVerified = details.emailVerified(d) ? 'Yes' : 'No';
  const r = await fetch(store.backendURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'payload=' + encodeURIComponent(JSON.stringify(payload))
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'Submission failed — please try again.');
  return j;
}

// incident/reference IDs, mirroring IncidentIDGenerator (PREFIX-YYYYMMDD-NNN)
function incidentID(prefix) {
  const now = new Date();
  const ymd = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const key = 'ctr-' + prefix + '-' + ymd;
  const n = (Number(localStorage.getItem(key)) || 0) + 1;
  localStorage.setItem(key, String(n));
  return `${prefix}-${ymd}-${String(n).padStart(3, '0')}`;
}

// date/time formatting to match the iOS en_AU output
function fmtDate(iso) {  // "2026-07-12" -> "12 Jul 2026"
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU',
    { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(hm) {   // "15:30" -> "3:30 pm"
  const [h, m] = hm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-AU',
    { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}
const todayISO = () => new Date().toISOString().slice(0, 10);

// in-memory drafts (mirrors iOS FormDrafts — survives in-app navigation)
const drafts = {};

// ---------- generic form page ----------
function formPage(opts) {
  // opts: {title, draftKey, fresh(), sections(body, state, refreshFooter),
  //        isValid(state, d), invalidMsg, buildPayload(state, d), successTitle, successMsg(id)}
  openPage(opts.title, (body) => {
    const config = store.config;
    const state = drafts[opts.draftKey] || (drafts[opts.draftKey] = opts.fresh());

    reporterSection(body, config);

    const footer = el(`<div>
      <div class="fhint" style="text-align:center">Submissions go to your strata manager, building manager and committee — please keep them accurate and courteous.</div>
      <div class="ferror" hidden></div>
      <button class="submitbtn">${esc(opts.submitLabel || 'Submit')}</button></div>`);
    const errEl = footer.querySelector('.ferror');
    const btn = footer.querySelector('.submitbtn');

    // Errors appear only after a submit attempt, never on first open.
    let attempted = false;
    function refresh() {
      const d = details.load();
      const ok = opts.isValid(state, d);
      errEl.hidden = !attempted || ok;
      errEl.textContent = opts.invalidMsg;
    }

    opts.sections(body, state, refresh);
    body.appendChild(footer);
    refresh();

    btn.addEventListener('click', async () => {
      if (!opts.isValid(state, details.load())) {
        attempted = true;
        refresh();
        errEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      try {
        const d = details.load();
        const id = incidentID(opts.prefix);
        const payload = opts.buildPayload(state, d);
        payload.incidentID = id;
        payload.code = store.config.code;
        payload.reporterName = details.fullName(d);
        payload.unitNumber = d.unitNumber;
        payload.phone = d.phoneNumber;
        payload.email = d.email;
        const resp = await postReport(payload);
        delete drafts[opts.draftKey];
        // Server-decided marker: accepted but parked until the reporter
        // verifies their email (see My Details).
        const nudge = resp && resp.pendingVerification
          ? '\n\nTo send it to the building manager and receive progress updates, please verify your email address on the My Details page.'
          : '';
        showAlert(opts.successTitle, opts.successMsg(id) + nudge, goBack);
      } catch (e) {
        showAlert('Submission Failed', e.message);
        btn.disabled = false;
      }
      btn.textContent = opts.submitLabel || 'Submit';
    });
  });
}

// ---------- Let Us Know ----------
Pages.letUsKnow = function () {
  const config = store.config;
  openPage(label(config, 'letUsKnow', 'Let Us Know'), (body) => {
    const mk = (icon, title, fn, enabled = true) => {
      const b = el(`<button class="navrow"><span class="icon">${icon}</span>${esc(title)}<span class="chev">›</span></button>`);
      if (enabled) b.addEventListener('click', fn);
      else { b.addEventListener('click', () => toast('Coming in Phase 3 — use the iOS app for now.')); }
      return b;
    };

    body.appendChild(sectionTitle(label(config, 'reportIssue', 'Report an Issue')));
    let c = card();
    c.appendChild(mk('💧', 'Water Leak', Pages.leak));
    c.appendChild(mk('🏢', 'Common Property', Pages.damage));
    c.appendChild(mk('🛡', 'Security', Pages.security));
    c.appendChild(mk('🔊', 'Noise', Pages.noise));
    c.appendChild(mk('🪧', 'Public Property', Pages.publicProperty));
    body.appendChild(c);

    body.appendChild(sectionTitle(label(config, 'makeRequest', 'Make a Request')));
    c = card();
    c.appendChild(mk('🔑', 'Request an Access Pass', Pages.accessPass));
    c.appendChild(mk('↕️', 'Book the Lift', Pages.elevator));
    // Only buildings that list amenities in the sheet get this.
    if ((config.amenities || []).length) {
      c.appendChild(mk('📅', 'Book an Amenity', Pages.amenityCalendar));
    }
    body.appendChild(c);

    body.appendChild(sectionTitle(label(config, 'giveNotice', 'Give Notice')));
    c = card();
    c.appendChild(mk('🔧', 'My Trade(s) Will Be On-Site', Pages.trades));
    c.appendChild(mk('🔨', 'My Upcoming Renovations', Pages.renovation));
    body.appendChild(c);
  });
};

// ---------- My Details ----------
Pages.myDetails = function () {
  const config = store.config;
  openPage(label(config, 'myDetails', 'My Details'), (body) => {
    let d = details.load();
    const noun = label(config, 'unitNoun', 'Unit');
    const save = () => details.save(d);

    body.appendChild(sectionTitle('Name'));
    let c = card();
    c.appendChild(textRow('Title', d.title, (i) => { d.title = i.value; save(); },
      { placeholder: 'e.g. Mr, Ms, Dr' }));
    c.appendChild(textRow('First name', d.firstName, (i) => { d.firstName = i.value; save(); }));
    c.appendChild(textRow('Last name', d.lastName, (i) => { d.lastName = i.value; save(); }));
    body.appendChild(c);

    body.appendChild(sectionTitle(noun + ' Number'));
    c = card();
    c.appendChild(textRow('', d.unitNumber, (i) => {
      i.value = normalizeUnit(i.value);
      d.unitNumber = i.value; save();
    }, { placeholder: `${noun} number (e.g. 12 or 12A)` }));
    body.appendChild(c);

    body.appendChild(sectionTitle('Contact'));
    c = card();
    c.appendChild(textRow('Phone number', d.phoneNumber, (i) => {
      i.value = filterPhone(i.value);
      d.phoneNumber = i.value; save();
    }, { type: 'tel', onblur: (i) => { i.value = groupPhone(i.value); d.phoneNumber = i.value; save(); } }));

    const emailRow = textRow('Email address', d.email, (i) => {
      i.value = i.value.toLowerCase().replace(/\s+/g, '');
      d.email = i.value; save();
      renderVerify();
    }, { type: 'email', attrs: { autocapitalize: 'none', autocorrect: 'off' } });
    c.appendChild(emailRow);

    const verifyHolder = el('<div></div>');
    c.appendChild(verifyHolder);
    let codeSent = false;
    function renderVerify() {
      d = details.load();
      verifyHolder.innerHTML = '';
      if (details.emailVerified(d)) {
        verifyHolder.appendChild(el('<div class="verify-ok">✓ Email verified</div>'));
        return;
      }
      if (!emailValid(d.email)) return;
      if (!codeSent) {
        const b = el('<div class="verify-row"><button type="button">Verify email address</button></div>');
        b.querySelector('button').addEventListener('click', async () => {
          b.querySelector('button').disabled = true;
          try {
            await verifyCall('sendVerification', {});
            codeSent = true;
          } catch (e) { showVerifyError(e.message); }
          renderVerify();
        });
        verifyHolder.appendChild(b);
      } else {
        const row = el(`<div class="verify-row">
            <input type="text" inputmode="numeric" maxlength="6" placeholder="6-digit code">
            <button type="button" class="confirm">Confirm</button>
            <button type="button" class="resend">Resend</button>
          </div><div class="verify-err" hidden></div>`);
        const wrap = el('<div></div>'); wrap.appendChild(row);
        const input = wrap.querySelector('input');
        wrap.querySelector('.confirm').addEventListener('click', async () => {
          try {
            await verifyCall('checkVerification', { otp: input.value.trim() });
            d.verifiedEmail = d.email; details.save(d);
            codeSent = false;
          } catch (e) { showVerifyError(e.message); return; }
          renderVerify();
        });
        wrap.querySelector('.resend').addEventListener('click', async () => {
          try { await verifyCall('sendVerification', {}); toast('Code re-sent.'); }
          catch (e) { showVerifyError(e.message); }
        });
        verifyHolder.appendChild(wrap);
      }
    }
    function showVerifyError(msg) {
      let e = verifyHolder.querySelector('.verify-err');
      if (!e) { e = el('<div class="verify-err"></div>'); verifyHolder.appendChild(e); }
      e.textContent = msg; e.hidden = false;
    }
    async function verifyCall(action, extra) {
      const u = new URL(store.backendURL);
      u.searchParams.set('action', action);
      u.searchParams.set('code', config.code);
      u.searchParams.set('email', details.load().email);
      u.searchParams.set('deviceId', store.deviceId);
      Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
      const r = await fetch(u);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Verification failed — please try again.');
      if (action === 'sendVerification' && j.sent !== true) throw new Error("Verification isn't available yet.");
      if (action === 'checkVerification' && j.verified !== true) throw new Error("Verification isn't available yet.");
    }
    renderVerify();
    body.appendChild(c);

    body.appendChild(sectionTitle('My Car(s)'));
    c = card();
    c.appendChild(textRow('License number(s)', d.carLicenses, (i) => {
      i.value = i.value.toUpperCase();
      d.carLicenses = i.value; save();
    }));
    c.appendChild(textRow('Car lot number(s)', d.carLots, (i) => { d.carLots = i.value; save(); }));
    body.appendChild(c);

    body.appendChild(sectionTitle('Agent for property'));
    c = card();
    const radio = el(`<div class="radiorow ${d.hasAgent ? 'on' : ''}"><span class="dotr"></span>Agent for property</div>`);
    const agentHolder = el('<div></div>');
    function renderAgent() {
      agentHolder.innerHTML = '';
      if (!d.hasAgent) return;
      agentHolder.appendChild(textRow('Managing Agent', d.managingAgent, (i) => { d.managingAgent = i.value; save(); }));
      agentHolder.appendChild(textRow('Management Company', d.managementCompany, (i) => { d.managementCompany = i.value; save(); }));
      agentHolder.appendChild(textRow('Phone', d.agentContact, (i) => {
        i.value = filterPhone(i.value); d.agentContact = i.value; save();
      }, { type: 'tel', onblur: (i) => { i.value = groupPhone(i.value); d.agentContact = i.value; save(); } }));
      agentHolder.appendChild(textRow('Email', d.agentEmail, (i) => {
        i.value = i.value.toLowerCase().replace(/\s+/g, ''); d.agentEmail = i.value; save();
      }, { type: 'email' }));
    }
    radio.addEventListener('click', () => {
      d.hasAgent = !d.hasAgent; save();
      radio.classList.toggle('on', d.hasAgent);
      renderAgent();
    });
    c.appendChild(radio);
    c.appendChild(agentHolder);
    renderAgent();
    body.appendChild(c);

    body.appendChild(el('<div class="fhint" style="text-align:center">Details are saved automatically on this device and included in the reports and requests you submit.</div>'));
  });
};

// ---------- the four forms ----------
Pages.trades = () => formPage({
  title: 'My Trade(s) Will Be On-Site',
  prefix: 'TR', draftKey: 'trades', submitLabel: 'Submit Notice',
  fresh: () => ({ startDate: todayISO(), endDate: todayISO(), workType: '', companyName: '',
                  workDescription: '', commonProperty: '', commonPropertyDetails: '',
                  noisy: '', noisyDetails: '', servicesInterruption: '', servicesDetails: '' }),
  sections(body, s, refresh) {
    body.appendChild(sectionTitle('The Works'));
    const c = card();
    c.appendChild(dateRow('Start date *', s.startDate, (i) => {
      s.startDate = i.value; if (s.endDate < s.startDate) s.endDate = s.startDate; refresh();
    }));
    c.appendChild(dateRow('End date *', s.endDate, (i) => {
      s.endDate = i.value < s.startDate ? s.startDate : i.value; i.value = s.endDate;
    }, s.startDate));
    c.appendChild(selectRow('Type of work *', ['Plumbing', 'Electrical', 'Renovation / Building',
      'Painting', 'Flooring', 'Delivery / Installation', 'Other'],
      s.workType, (v) => { s.workType = v; refresh(); }, 'Select type…'));
    c.appendChild(textRow('Company / tradesperson (optional)', s.companyName, (i) => { s.companyName = i.value; }));
    c.appendChild(textareaRow('What will they be doing? *', s.workDescription,
      (v) => { s.workDescription = v; refresh(); }, 'Describe the work'));
    body.appendChild(c);

    body.appendChild(sectionTitle('Heads-up'));
    const q = card();
    q.appendChild(questionBlock('Will they need access to common property?', s, 'commonProperty',
      'commonPropertyDetails', 'e.g. lift, corridors, parking for a work vehicle', 'What access is needed?', refresh));
    q.appendChild(questionBlock('Will the work be noisy?', s, 'noisy', 'noisyDetails',
      'Lets the manager give neighbours a heads-up', 'What kind of noise, and when?', refresh));
    q.appendChild(questionBlock('Will services need interruption?', s, 'servicesInterruption',
      'servicesDetails', `e.g. water or power shut-off affecting other ${label(store.config, 'unitNoun', 'Unit').toLowerCase()}s`, 'Which service, and when?', refresh));
    body.appendChild(q);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() &&
    s.workType && s.workDescription.trim(),
  invalidMsg: 'Please fill in your name, unit number, the work type, and a description before submitting.',
  buildPayload: (s) => ({
    action: 'submitTrades',
    startDate: fmtDate(s.startDate), endDate: fmtDate(s.endDate),
    workType: s.workType, companyName: s.companyName, workDescription: s.workDescription,
    commonProperty: s.commonProperty, commonPropertyDetails: s.commonPropertyDetails,
    noisy: s.noisy, noisyDetails: s.noisyDetails,
    servicesInterruption: s.servicesInterruption, servicesDetails: s.servicesDetails
  }),
  successTitle: 'Thank you for your notice',
  successMsg: (id) => `Your notice has been recorded. Reference: ${id}.`
});

Pages.renovation = () => formPage({
  title: 'My Upcoming Renovations',
  prefix: 'RN', draftKey: 'renovation', submitLabel: 'Submit Notice',
  fresh: () => ({ startDate: todayISO(), endDate: todayISO(), workingHours: '', contractorName: '',
                  workDescription: '', commonProperty: '', commonPropertyDetails: '',
                  noisy: '', noisyDetails: '', servicesInterruption: '', servicesDetails: '' }),
  sections(body, s, refresh) {
    body.appendChild(sectionTitle('The Renovation'));
    const c = card();
    c.appendChild(dateRow('Start date *', s.startDate, (i) => {
      s.startDate = i.value; if (s.endDate < s.startDate) s.endDate = s.startDate; refresh();
    }));
    c.appendChild(dateRow('Est. completion *', s.endDate, (i) => {
      s.endDate = i.value < s.startDate ? s.startDate : i.value; i.value = s.endDate;
    }, s.startDate));
    c.appendChild(textRow('Working hours', s.workingHours, (i) => { s.workingHours = i.value; },
      { placeholder: 'e.g. Mon–Fri, 8am–5pm' }));
    c.appendChild(textRow('Contractor / company (optional)', s.contractorName, (i) => { s.contractorName = i.value; }));
    c.appendChild(textareaRow('What works will be carried out? *', s.workDescription,
      (v) => { s.workDescription = v; refresh(); }, 'Describe the renovation'));
    body.appendChild(c);

    body.appendChild(sectionTitle('Heads-up'));
    const q = card();
    q.appendChild(questionBlock('Will you need access to common property?', s, 'commonProperty',
      'commonPropertyDetails', 'e.g. lift, loading dock, corridors', 'What access is needed?', refresh));
    q.appendChild(questionBlock('Will the work be noisy?', s, 'noisy', 'noisyDetails',
      'Lets the manager give neighbours a heads-up', 'What kind of noise, and when?', refresh));
    q.appendChild(questionBlock('Will services need interruption?', s, 'servicesInterruption',
      'servicesDetails', `e.g. water or power shut-off affecting other ${label(store.config, 'unitNoun', 'Unit').toLowerCase()}s`, 'Which service, and when?', refresh));
    body.appendChild(q);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() &&
    s.workDescription.trim(),
  invalidMsg: 'Please fill in your name, unit number, and a description before submitting.',
  buildPayload: (s) => ({
    action: 'submitRenovation',
    startDate: fmtDate(s.startDate), endDate: fmtDate(s.endDate),
    workingHours: s.workingHours, workDescription: s.workDescription,
    contractorName: s.contractorName,
    commonProperty: s.commonProperty, commonPropertyDetails: s.commonPropertyDetails,
    noisy: s.noisy, noisyDetails: s.noisyDetails,
    servicesInterruption: s.servicesInterruption, servicesDetails: s.servicesDetails
  }),
  successTitle: 'Thank you for your notice',
  successMsg: (id) => `Your renovation notice has been recorded. Reference: ${id}.`
});

Pages.accessPass = () => formPage({
  title: 'Request an Access Pass',
  prefix: 'AP', draftKey: 'accessPass', submitLabel: 'Submit Request',
  fresh: () => ({ passType: '', passHolderName: '', neededFrom: todayISO(), neededUntil: todayISO(),
                  details: '', replacingLost: '', replacingLostDetails: '' }),
  sections(body, s, refresh) {
    body.appendChild(sectionTitle('Pass Details'));
    const c = card();
    c.appendChild(selectRow('Type of pass *', ['Visitor', 'Tradesperson / Contractor',
      'New Resident', 'Replacement (lost or damaged)', 'Other'],
      s.passType, (v) => { s.passType = v; refresh(); }, 'Select type…'));
    c.appendChild(textRow('Who is the pass for? *', s.passHolderName,
      (i) => { s.passHolderName = i.value; refresh(); }));
    c.appendChild(dateRow('Needed from *', s.neededFrom, (i) => {
      s.neededFrom = i.value; if (s.neededUntil < s.neededFrom) s.neededUntil = s.neededFrom; refresh();
    }));
    c.appendChild(dateRow('Needed until *', s.neededUntil, (i) => {
      s.neededUntil = i.value < s.neededFrom ? s.neededFrom : i.value; i.value = s.neededUntil;
    }, s.neededFrom));
    c.appendChild(textareaRow('Details *', s.details,
      (v) => { s.details = v; refresh(); }, 'What access is needed, and why?'));
    body.appendChild(c);

    body.appendChild(sectionTitle('Security'));
    const q = card();
    q.appendChild(questionBlock('Is this replacing a lost or stolen pass?', s, 'replacingLost',
      'replacingLostDetails', 'Lost passes may need to be deactivated for building security',
      'When and where was it lost?', refresh));
    body.appendChild(q);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() &&
    s.passType && s.passHolderName.trim() && s.details.trim(),
  invalidMsg: "Please fill in your name, unit number, the pass type, who it's for, and the details before submitting.",
  buildPayload: (s) => ({
    action: 'submitAccessPass',
    passType: s.passType, passHolderName: s.passHolderName,
    neededFrom: fmtDate(s.neededFrom), neededUntil: fmtDate(s.neededUntil),
    details: s.details, replacingLost: s.replacingLost,
    replacingLostDetails: s.replacingLostDetails
  }),
  successTitle: 'Thank you for your request',
  successMsg: (id) => `Your request has been recorded. Reference: ${id}.`
});

Pages.elevator = () => formPage({
  title: 'Book the Lift',
  prefix: 'EL', draftKey: 'elevator', submitLabel: 'Submit Request',
  fresh: () => ({ purpose: '', bookingDate: todayISO(), startTime: '09:00', endTime: '11:00',
                  details: '', needsLoadingAccess: '', loadingDetails: '',
                  needsPadding: '', paddingDetails: '' }),
  sections(body, s, refresh) {
    body.appendChild(sectionTitle('Booking Details'));
    const c = card();
    c.appendChild(selectRow('Purpose *', ['Moving In', 'Moving Out', 'Furniture / Large Delivery',
      'Renovation Materials', 'Other'],
      s.purpose, (v) => { s.purpose = v; refresh(); }, 'Select purpose…'));
    c.appendChild(dateRow('Date *', s.bookingDate, (i) => { s.bookingDate = i.value; }, todayISO()));
    c.appendChild(timeRow('From *', s.startTime, (v) => {
      s.startTime = v;
      if (s.endTime <= s.startTime) {
        const [h, m] = v.split(':').map(Number);
        s.endTime = String(Math.min(h + 2, 23)).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        drawPage();
      }
    }));
    c.appendChild(timeRow('Until *', s.endTime, (v) => { s.endTime = v; }));
    c.appendChild(textareaRow('Details *', s.details,
      (v) => { s.details = v; refresh(); }, "What's being moved? Removalist/company if any"));
    body.appendChild(c);

    body.appendChild(sectionTitle('On the day'));
    const q = card();
    q.appendChild(questionBlock('Will you need truck parking or loading access?', s, 'needsLoadingAccess',
      'loadingDetails', 'e.g. a removalist truck at the loading area', 'Vehicle size and how long?', refresh));
    q.appendChild(questionBlock('Will the lift need protective padding installed?', s, 'needsPadding',
      'paddingDetails', 'Usually required for furniture and building materials',
      'Anything unusually large or heavy?', refresh));
    body.appendChild(q);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() &&
    s.purpose && s.details.trim(),
  invalidMsg: 'Please fill in your name, unit number, the purpose, and the details before submitting.',
  buildPayload: (s) => ({
    action: 'submitElevator',
    purpose: s.purpose, bookingDate: fmtDate(s.bookingDate),
    startTime: fmtTime(s.startTime), endTime: fmtTime(s.endTime),
    details: s.details,
    needsLoadingAccess: s.needsLoadingAccess, loadingDetails: s.loadingDetails,
    needsPadding: s.needsPadding, paddingDetails: s.paddingDetails
  }),
  successTitle: 'Thank you for your request',
  successMsg: (id) => `Your booking request has been recorded (reference ${id}). The building manager will confirm your slot.`
});

// ---------- amenity bookings (shared calendar + request form) ----------
// Amenities come from the sheet's "Amenities" column; the calendar shows
// upcoming Tentative/Confirmed bookings (no names — only dates, times,
// status, and a "your booking" tag for this device's own requests).

async function fetchBookings() {
  const u = new URL(store.backendURL);
  u.searchParams.set('action', 'bookings');
  u.searchParams.set('code', store.config.code);
  u.searchParams.set('deviceId', store.deviceId);
  const r = await fetch(u);
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'Could not load the bookings calendar.');
  return j.bookings || [];
}

// "15:00" -> "3:00 pm"; "2026-07-25" -> "Sat 25 Jul"
function displayHM(hm) {
  const m = String(hm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'pm' : 'am'}`;
}
function displayISO(iso) {
  const [y, mo, d] = String(iso).split('-').map(Number);
  if (!y || !mo || !d) return iso;
  return new Date(y, mo - 1, d).toLocaleDateString('en-AU',
    { weekday: 'short', day: 'numeric', month: 'short' });
}

Pages.amenityCalendar = function () {
  const config = store.config;
  const amenities = config.amenities || [];
  openPage('Book an Amenity', (body) => {
    const state = { amenity: amenities[0] || '', month: new Date(),
                    selected: null, bookings: [], loaded: false, error: '' };
    const iso = (y, m, d) =>
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const forAmenity = () => state.bookings.filter((b) => b.amenity === state.amenity);
    const byDay = () => {
      const map = {};
      forAmenity().forEach((b) => { (map[b.date] = map[b.date] || []).push(b); });
      return map;
    };

    const picker = card();
    picker.appendChild(selectRow('Amenity', amenities, state.amenity,
      (v) => { state.amenity = v || amenities[0] || ''; state.selected = null; redrawCal(); redrawList(); }));
    body.appendChild(picker);

    body.appendChild(sectionTitle('Availability'));
    const calCard = card();
    body.appendChild(calCard);

    const listTitle = sectionTitle('Upcoming Bookings');
    const listCard = card();
    body.appendChild(listTitle);
    body.appendChild(listCard);

    const reqBtn = el('<button class="submitbtn">Request a Booking</button>');
    reqBtn.addEventListener('click', () => Pages.amenityBooking(state.amenity));
    body.appendChild(reqBtn);
    body.appendChild(el('<div class="fhint" style="text-align:center">New requests appear as tentative until the building manager confirms them.</div>'));

    function redrawCal() {
      calCard.innerHTML = '';
      const y = state.month.getFullYear(), mo = state.month.getMonth();
      const monthName = state.month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      const nav = el(`<div class="cal-nav"><button class="cal-arrow">‹</button><span>${esc(monthName)}</span><button class="cal-arrow">›</button></div>`);
      nav.children[0].addEventListener('click', () => { state.month = new Date(y, mo - 1, 1); state.selected = null; redrawCal(); redrawList(); });
      nav.children[2].addEventListener('click', () => { state.month = new Date(y, mo + 1, 1); state.selected = null; redrawCal(); redrawList(); });
      calCard.appendChild(nav);

      const grid = el('<div class="cal-grid"></div>');
      ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((w) => grid.appendChild(el(`<div class="cal-wd">${w}</div>`)));
      const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday-first
      for (let i = 0; i < lead; i++) grid.appendChild(el('<div></div>'));
      const dayCount = new Date(y, mo + 1, 0).getDate();
      const map = byDay();
      for (let d = 1; d <= dayCount; d++) {
        const key = iso(y, mo + 1, d);
        const cell = el(`<button class="cal-day${state.selected === key ? ' sel' : ''}"><span>${d}</span><span class="cal-dots"></span></button>`);
        (map[key] || []).slice(0, 3).forEach((b) => {
          cell.querySelector('.cal-dots').appendChild(
            el(`<i class="cal-dot${b.status === 'confirmed' ? ' conf' : ''}"></i>`));
        });
        cell.addEventListener('click', () => {
          state.selected = state.selected === key ? null : key;
          redrawCal(); redrawList();
        });
        grid.appendChild(cell);
      }
      calCard.appendChild(grid);
      calCard.appendChild(el('<div class="cal-legend"><span><i class="cal-dot conf"></i> Confirmed</span><span><i class="cal-dot"></i> Tentative</span></div>'));
      if (!state.loaded) calCard.appendChild(el('<div class="fhint" style="text-align:center">Loading bookings…</div>'));
      if (state.error) calCard.appendChild(el(`<div class="fhint" style="text-align:center">${esc(state.error)}</div>`));
    }

    function redrawList() {
      const map = byDay();
      const items = state.selected ? (map[state.selected] || []) : forAmenity();
      listTitle.textContent = state.selected ? displayISO(state.selected) : 'Upcoming Bookings';
      listCard.innerHTML = '';
      if (!items.length) {
        listCard.appendChild(el(`<div class="cal-empty">${state.selected ? 'No bookings this day.' : 'No upcoming bookings — it’s free.'}</div>`));
      }
      items.slice(0, 10).forEach((b) => {
        listCard.appendChild(el(
          `<div class="booking-row"><div><div>${esc(displayISO(b.date))}, ${esc(displayHM(b.start))}–${esc(displayHM(b.end))}</div>` +
          (b.mine ? '<div class="booking-mine">Your booking</div>' : '') +
          `</div><span class="badge${b.status === 'confirmed' ? ' conf' : ''}">${b.status === 'confirmed' ? 'Confirmed' : 'Tentative'}</span></div>`));
      });
    }

    redrawCal(); redrawList();
    fetchBookings()
      .then((bs) => { state.bookings = bs; state.loaded = true; redrawCal(); redrawList(); })
      .catch(() => { state.loaded = true; state.error = 'Couldn’t load the calendar.'; redrawCal(); });
  });
};

Pages.amenityBooking = (preselect) => formPage({
  title: 'Request a Booking',
  prefix: 'AB', draftKey: 'amenity', submitLabel: 'Submit Request',
  fresh: () => ({ amenity: (typeof preselect === 'string' && preselect) || (store.config.amenities || [])[0] || '',
                  bookingDate: todayISO(), startTime: '15:00', endTime: '17:00', details: '' }),
  sections(body, s, refresh) {
    body.appendChild(sectionTitle('Booking Details'));
    const c = card();
    c.appendChild(selectRow('Amenity *', store.config.amenities || [],
      s.amenity, (v) => { s.amenity = v; refresh(); }, 'Select amenity…'));
    c.appendChild(dateRow('Date *', s.bookingDate, (i) => { s.bookingDate = i.value; }, todayISO()));
    c.appendChild(timeRow('From *', s.startTime, (v) => {
      s.startTime = v;
      if (s.endTime <= s.startTime) {
        const [h, m] = v.split(':').map(Number);
        s.endTime = String(Math.min(h + 2, 23)).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        drawPage();
      }
      refresh();
    }));
    c.appendChild(timeRow('Until *', s.endTime, (v) => { s.endTime = v; refresh(); }));
    c.appendChild(textareaRow('Occasion / guests (optional)', s.details,
      (v) => { s.details = v; }, 'e.g. birthday gathering, 8 people'));
    body.appendChild(c);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() &&
    s.amenity && s.endTime > s.startTime,
  invalidMsg: 'Please fill in your name, unit number, the amenity, and an end time after the start time before submitting.',
  // ISO date + 24h times so the backend calendar can sort and filter them.
  buildPayload: (s) => ({
    action: 'submitAmenityBooking',
    amenity: s.amenity, bookingDate: s.bookingDate,
    startTime: s.startTime, endTime: s.endTime,
    details: s.details
  }),
  successTitle: 'Thank you for your request',
  successMsg: (id) => `Your booking request has been recorded. Reference: ${id}. It will show as tentative on the calendar until the building manager confirms it.`
});
