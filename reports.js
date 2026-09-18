/* Majestic resident PWA — Phase 3: the four report forms with photos
   (leak, common property, security, noise) and the
   Public Property redirect page. Mirrors the iOS forms and payloads. */

'use strict';

// ---------- date+time helpers ----------
// Common-property areas: per-building from the config, else defaults.
const DEFAULT_REPORT_AREAS = ['Lobby', 'Hallway / Corridor', 'Lift', 'Stairwell',
  'Car Park', 'Garden / Grounds', 'Building Exterior', 'Other'];
function reportAreas() {
  const a = (store.config && store.config.reportAreas) || [];
  return a.length ? a : DEFAULT_REPORT_AREAS;
}

const nowHM = () => {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
// "12 Jul 2026, 3:30 pm" (en_AU medium date + short time)
const fmtDateTime = (dateISO, timeHM) => fmtDate(dateISO) + ', ' + fmtTime(timeHM);

function dateTimeRow(labelText, state, dateKey, timeKey) {
  const row = el(`<div class="frow"><label>${esc(labelText)}</label>
    <div class="inline" style="justify-content:flex-start;gap:8px"></div></div>`);
  const holder = row.querySelector('.inline');
  const dInput = el(`<input type="date" value="${state[dateKey]}" max="${todayISO()}">`);
  dInput.addEventListener('change', () => { state[dateKey] = dInput.value; });
  const tInput = el(`<input type="time" value="${state[timeKey]}">`);
  tInput.addEventListener('change', () => { state[timeKey] = tInput.value; });
  holder.appendChild(dInput);
  holder.appendChild(tInput);
  return row;
}

// ---------- photos (mirrors PhotoAttachmentSection: max 10, JPEG 0.6) ----------
const MAX_PHOTOS = 10;
const PHOTO_MAX_DIM = 1600;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataURL = canvas.toDataURL('image/jpeg', 0.6);
      resolve(dataURL.split(',')[1]); // raw base64, matching the iOS payload
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

function photosSection(body, state, titleText) {
  body.appendChild(sectionTitle(titleText || 'Photos'));
  const c = card();
  const grid = el('<div class="photogrid"></div>');
  const addRow = el(`<div class="frow"><button type="button" class="verify-link">＋ Add photos</button>
    <input type="file" accept="image/*" multiple hidden></div>`);
  const input = addRow.querySelector('input');
  const btn = addRow.querySelector('button');
  btn.addEventListener('click', () => input.click());

  function redraw() {
    grid.innerHTML = '';
    state.photos.forEach((b64, i) => {
      const cell = el(`<div class="photocell"><img src="data:image/jpeg;base64,${b64}"><button type="button">✕</button></div>`);
      cell.querySelector('button').addEventListener('click', () => {
        state.photos.splice(i, 1); redraw();
      });
      grid.appendChild(cell);
    });
    btn.disabled = state.photos.length >= MAX_PHOTOS;
    btn.textContent = state.photos.length
      ? `＋ Add photos (${state.photos.length}/${MAX_PHOTOS})` : '＋ Add photos';
  }
  input.addEventListener('change', async () => {
    for (const f of [...input.files].slice(0, MAX_PHOTOS - state.photos.length)) {
      try { state.photos.push(await compressImage(f)); }
      catch (e) { toast(e.message); }
    }
    input.value = '';
    redraw();
  });
  c.appendChild(grid);
  c.appendChild(addRow);
  body.appendChild(c);
  body.appendChild(el('<div class="fhint">Optional — up to 10 photos of the affected area.</div>'));
  redraw();
}

// (audio recording removed 2026-09-13 — replaced by the repeat-incident log on Updates)

// ---------- the four report forms ----------
// "Stop the water": the resident's shut-off valve location at the top of
// the leak form. Cache-first (same key as My Unit); fetches and caches if
// this device has never opened My Unit; silent when nothing to show.
function shutoffCallout(container) {
  const config = store.config;
  const unit = details.load().unitNumber.trim();
  if (!unit) return;
  const noun = label(config, 'unitNoun', 'Unit').toLowerCase();
  const holder = el('<div></div>');
  container.appendChild(holder);
  const show = (info) => {
    if (!info || !info.waterShutoff) return;
    holder.innerHTML = '';
    holder.appendChild(sectionTitle('Stop the water — your shut-off valve'));
    const c = card();
    c.appendChild(el(`<div class="frow" style="font-size:15px">💧 ${esc(info.waterShutoff)}</div>`));
    const more = el(`<button class="navrow"><span class="icon">🏠</span>More about ${esc(noun)} ${esc(unit)}<span class="chev">›</span></button>`);
    more.addEventListener('click', () => Pages.myUnit());
    c.appendChild(more);
    holder.appendChild(c);
  };
  const cacheKey = 'unitinfo-' + config.code + '-' + unit;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch { cached = null; }
  if (cached) { show(cached); return; }
  backendJSON({ action: 'unit', code: config.code, unit })
    .then((j) => { localStorage.setItem(cacheKey, JSON.stringify(j.unit)); show(j.unit); })
    .catch(() => { /* leave the form uncluttered */ });
}

Pages.leak = () => formPage({
  title: 'Water Leak',
  prefix: 'LK', draftKey: 'leak', submitLabel: 'Submit Report',
  fresh: () => ({ dateNoticed: todayISO(), timeNoticed: nowHM(), location: '',
                  sourceIdentified: '', sourceDetails: '', mitigationPossible: '', mitigationDetails: '',
                  weatherRelated: '', weatherDetails: '', changesOverTime: '', changesDetails: '',
                  neighbourContacted: '', neighbourApartments: '', neighbourDetails: '', photos: [] }),
  sections(body, s, refresh) {
    const noun = label(store.config, 'unitNoun', 'Unit').toLowerCase();
    shutoffCallout(body);   // the resident's own valve, where the task happens
    body.appendChild(sectionTitle('Incident Details'));
    const c = card();
    c.appendChild(dateTimeRow('Date first noticed *', s, 'dateNoticed', 'timeNoticed'));
    c.appendChild(textRow('Location *', s.location, (i) => { s.location = i.value; refresh(); },
      { placeholder: 'Be specific, if possible' }));
    body.appendChild(c);

    const q = card();
    q.appendChild(questionBlock('Can the source be immediately identified?', s, 'sourceIdentified',
      'sourceDetails', 'e.g. leaking pipe, blocked drain', 'Describe the source', refresh));
    q.appendChild(questionBlock('Can anything be done to reduce further damage?', s, 'mitigationPossible',
      'mitigationDetails', 'e.g. isolate water supply', 'What action can be taken?', refresh));
    q.appendChild(questionBlock('Does the water ingress change with the weather?', s, 'weatherRelated',
      'weatherDetails', 'e.g. worse during or after rain', 'Describe the pattern', refresh));
    q.appendChild(questionBlock('Have you noticed any changes over time?', s, 'changesOverTime',
      'changesDetails', 'e.g. water staining on ceiling increasing', 'Describe the changes', refresh));
    body.appendChild(sectionTitle('Assessment'));
    body.appendChild(q);

    body.appendChild(sectionTitle(`Neighbouring ${label(store.config, 'unitNoun', 'Unit')}`));
    const n = card();
    n.appendChild(questionBlock(`Could the source be from a neighbouring ${noun}?`, s,
      'neighbourContacted', 'neighbourApartments',
      'If yes, have you tried contacting them?',
      `Which ${noun}(s) do you believe the leak is from?`, refresh));
    n.appendChild(textareaRow('Any additional details?', s.neighbourDetails,
      (v) => { s.neighbourDetails = v; }, ''));
    body.appendChild(n);

    photosSection(body, s);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() && s.location.trim(),
  invalidMsg: 'Please fill in your name, unit number, and the location before submitting.',
  buildPayload: (s) => ({
    action: 'submitLeak',
    dateNoticed: fmtDateTime(s.dateNoticed, s.timeNoticed),
    location: s.location,
    sourceIdentified: s.sourceIdentified, sourceDetails: s.sourceDetails,
    mitigationPossible: s.mitigationPossible, mitigationDetails: s.mitigationDetails,
    weatherRelated: s.weatherRelated, weatherDetails: s.weatherDetails,
    changesOverTime: s.changesOverTime, changesDetails: s.changesDetails,
    neighbourContacted: s.neighbourContacted, neighbourApartments: s.neighbourApartments,
    neighbourDetails: s.neighbourDetails,
    photos: s.photos
  }),
  successTitle: 'Thank you for your report',
  successMsg: (id) => `Your report has been recorded. Reference: ${id}.`
});

Pages.damage = () => formPage({
  title: 'Common Property',
  prefix: 'DM', draftKey: 'damage', submitLabel: 'Submit Report',
  fresh: () => ({ dateNoticed: todayISO(), timeNoticed: nowHM(), area: '', locationDetail: '',
                  damageDescription: '', safetyHazard: '', safetyDetails: '',
                  securityRisk: '', securityDetails: '', causeKnown: '', causeDetails: '',
                  witnessed: '', witnessDetails: '', likelyToWorsen: '', worsenDetails: '', photos: [] }),
  sections(body, s, refresh) {
    const noun = label(store.config, 'unitNoun', 'Unit').toLowerCase();
    body.appendChild(sectionTitle('Damage Details'));
    const c = card();
    c.appendChild(dateTimeRow('Date first noticed *', s, 'dateNoticed', 'timeNoticed'));
    c.appendChild(selectRow('Area *', reportAreas(),
      s.area, (v) => { s.area = v; refresh(); }, 'Select area…'));
    c.appendChild(textRow('Where exactly?', s.locationDetail, (i) => { s.locationDetail = i.value; },
      { placeholder: `e.g. Level 3, outside ${noun} 12` }));
    c.appendChild(textareaRow('Description *', s.damageDescription,
      (v) => { s.damageDescription = v; refresh(); }, 'What is damaged, and how badly?'));
    body.appendChild(c);

    body.appendChild(sectionTitle('Assessment'));
    const q = card();
    q.appendChild(questionBlock('Is the damage a safety hazard?', s, 'safetyHazard', 'safetyDetails',
      'e.g. broken glass, trip hazard, exposed wiring', 'Describe the hazard', refresh));
    q.appendChild(questionBlock('Does the damage create a security risk?', s, 'securityRisk', 'securityDetails',
      'e.g. broken lock or door, gate not closing, damaged fence', 'Describe the security risk', refresh));
    q.appendChild(questionBlock('Do you know what caused the damage?', s, 'causeKnown', 'causeDetails',
      'e.g. storm, vehicle impact, vandalism', 'Describe the cause', refresh));
    q.appendChild(questionBlock('Did you see it happen, or know who was involved?', s, 'witnessed', 'witnessDetails',
      "Share only what you're comfortable with", 'What did you see?', refresh));
    q.appendChild(questionBlock('Is it likely to get worse if left unrepaired?', s, 'likelyToWorsen', 'worsenDetails',
      'e.g. water entering a crack, a loose railing', 'Describe the risk', refresh));
    body.appendChild(q);

    photosSection(body, s);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() && s.area &&
    s.damageDescription.trim(),
  invalidMsg: 'Please fill in your name, unit number, the area, and a description before submitting.',
  buildPayload: (s) => ({
    action: 'submitDamage',
    dateNoticed: fmtDateTime(s.dateNoticed, s.timeNoticed),
    area: s.area, locationDetail: s.locationDetail, damageDescription: s.damageDescription,
    safetyHazard: s.safetyHazard, safetyDetails: s.safetyDetails,
    securityRisk: s.securityRisk, securityDetails: s.securityDetails,
    causeKnown: s.causeKnown, causeDetails: s.causeDetails,
    witnessed: s.witnessed, witnessDetails: s.witnessDetails,
    likelyToWorsen: s.likelyToWorsen, worsenDetails: s.worsenDetails,
    photos: s.photos
  }),
  successTitle: 'Thank you for your report',
  successMsg: (id) => `Your report has been recorded. Reference: ${id}.`
});

Pages.security = () => formPage({
  title: 'Security',
  prefix: 'SC', draftKey: 'security', submitLabel: 'Submit Report',
  fresh: () => ({ occurredDate: todayISO(), occurredTime: nowHM(), incidentType: '', area: '',
                  locationDetail: '', incidentDescription: '', isOngoing: '', ongoingDetails: '',
                  sawPerson: '', personDetails: '', reportedToPolice: '', policeDetails: '',
                  cctvNearby: '', cctvDetails: '', photos: [] }),
  sections(body, s, refresh) {
    const config = store.config;
    const noun = label(config, 'unitNoun', 'Unit');
    body.appendChild(sectionTitle('Incident Details'));
    const c = card();
    c.appendChild(dateTimeRow('When did it happen? *', s, 'occurredDate', 'occurredTime'));
    c.appendChild(selectRow('Type of incident *', ['Break-in / Attempted break-in', 'Theft',
      'Vandalism / Graffiti', 'Unauthorised person / Trespasser',
      'Security fault (door, gate or lock)', 'Suspicious activity',
      'Vehicle-related (car park)', 'Other'],
      s.incidentType, (v) => { s.incidentType = v; refresh(); }, 'Select type…'));
    // display noun-aware "My Unit", store canonical value (mirrors iOS)
    const areaRow = el(`<div class="frow"><label>Area *</label></div>`);
    const sel = el('<select></select>');
    sel.appendChild(el('<option value="">Select area…</option>'));
    [['My Unit', `My ${noun}`], ...reportAreas().map((a) => [a, a])]
      .forEach(([value, labelText]) => {
        const opt = el(`<option value="${esc(value)}">${esc(labelText)}</option>`);
        if (value === s.area) opt.selected = true;
        sel.appendChild(opt);
      });
    sel.addEventListener('change', () => { s.area = sel.value; refresh(); });
    areaRow.appendChild(sel);
    c.appendChild(areaRow);
    c.appendChild(textRow('Where exactly?', s.locationDetail, (i) => { s.locationDetail = i.value; },
      { placeholder: 'e.g. rear gate, level 2' }));
    c.appendChild(textareaRow('Description *', s.incidentDescription,
      (v) => { s.incidentDescription = v; refresh(); }, 'What happened?'));
    body.appendChild(c);

    body.appendChild(sectionTitle('Assessment'));
    const q = card();
    q.appendChild(questionBlock('Is the risk ongoing right now?', s, 'isOngoing', 'ongoingDetails',
      'e.g. door still unsecured, person still on premises', 'Describe the current situation', refresh));
    q.appendChild(questionBlock('Did you see the person(s) involved?', s, 'sawPerson', 'personDetails',
      "Share only what you're comfortable with", 'What did you see?', refresh));
    q.appendChild(questionBlock('Have you reported it to the police?', s, 'reportedToPolice', 'policeDetails',
      'A report/event number helps with insurance claims', 'Police report / event number', refresh));
    q.appendChild(questionBlock('Might CCTV have captured it?', s, 'cctvNearby', 'cctvDetails',
      'Footage is overwritten quickly — flagging this early helps preserve it', 'Which camera or area?', refresh));
    body.appendChild(q);

    photosSection(body, s);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() && s.incidentType && s.area &&
    s.incidentDescription.trim(),
  invalidMsg: 'Please fill in your name, unit number, the incident type, area, and a description before submitting.',
  buildPayload: (s) => ({
    action: 'submitSecurity',
    occurredAt: fmtDateTime(s.occurredDate, s.occurredTime),
    incidentType: s.incidentType, area: s.area, locationDetail: s.locationDetail,
    incidentDescription: s.incidentDescription,
    isOngoing: s.isOngoing, ongoingDetails: s.ongoingDetails,
    sawPerson: s.sawPerson, personDetails: s.personDetails,
    reportedToPolice: s.reportedToPolice, policeDetails: s.policeDetails,
    cctvNearby: s.cctvNearby, cctvDetails: s.cctvDetails,
    photos: s.photos
  }),
  successTitle: 'Thank you for your report',
  successMsg: (id) => `Your report has been recorded. Reference: ${id}.`
});

Pages.noise = () => formPage({
  title: 'Noise',
  prefix: 'NS', draftKey: 'noise', submitLabel: 'Submit Report',
  fresh: () => ({ firstDate: todayISO(), firstTime: nowHM(), lastDate: todayISO(), lastTime: nowHM(),
                  noiseType: '', suspectedSource: '', noiseDescription: '',
                  isRecurring: '', recurringDetails: '', quietHours: '', quietHoursDetails: '',
                  impact: '', impactDetails: '', raisedWithPerson: '', raisedDetails: '',
                  photos: [] }),
  sections(body, s, refresh) {
    const noun = label(store.config, 'unitNoun', 'Unit').toLowerCase();
    body.appendChild(sectionTitle('Noise Details'));
    const c = card();
    c.appendChild(dateTimeRow('When did it first start? *', s, 'firstDate', 'firstTime'));
    c.appendChild(dateTimeRow('Most recent occurrence *', s, 'lastDate', 'lastTime'));
    c.appendChild(selectRow('Type of noise *', ['Music / Party', 'Voices / Shouting',
      'Footsteps / Impact', 'Machinery / Equipment', 'Animal', 'Renovation / Construction', 'Other'],
      s.noiseType, (v) => { s.noiseType = v; refresh(); }, 'Select type…'));
    c.appendChild(textRow('Where is it coming from?', s.suspectedSource, (i) => { s.suspectedSource = i.value; },
      { placeholder: `e.g. ${noun} above` }));
    c.appendChild(textareaRow('Description *', s.noiseDescription,
      (v) => { s.noiseDescription = v; refresh(); }, 'Describe the noise and how it affects you'));
    body.appendChild(c);

    body.appendChild(sectionTitle('Assessment'));
    const q = card();
    q.appendChild(questionBlock('Is the noise recurring or ongoing?', s, 'isRecurring', 'recurringDetails',
      'e.g. most evenings, every weekend', 'Describe the pattern (days, times)', refresh));
    q.appendChild(questionBlock('Does it occur during quiet hours (10pm–7am)?', s, 'quietHours', 'quietHoursDetails',
      'Late-night noise is treated with higher priority', 'What times have you noticed it?', refresh));
    q.appendChild(questionBlock('Is it affecting your sleep or ability to work?', s, 'impact', 'impactDetails',
      'This helps prioritise the response', 'How is it affecting you?', refresh));
    q.appendChild(questionBlock('Have you raised it with the person responsible?', s, 'raisedWithPerson', 'raisedDetails',
      "Share only what you're comfortable with", 'What was the outcome?', refresh));
    body.appendChild(q);

    photosSection(body, s);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() && s.noiseType &&
    s.noiseDescription.trim(),
  invalidMsg: 'Please fill in your name, unit number, the noise type, and a description before submitting.',
  buildPayload: (s) => ({
    action: 'submitNoise',
    firstStarted: fmtDateTime(s.firstDate, s.firstTime),
    lastOccurred: fmtDateTime(s.lastDate, s.lastTime),
    noiseType: s.noiseType, suspectedSource: s.suspectedSource, noiseDescription: s.noiseDescription,
    isRecurring: s.isRecurring, recurringDetails: s.recurringDetails,
    quietHours: s.quietHours, quietHoursDetails: s.quietHoursDetails,
    impact: s.impact, impactDetails: s.impactDetails,
    raisedWithPerson: s.raisedWithPerson, raisedDetails: s.raisedDetails,
    photos: s.photos
  }),
  successTitle: 'Thank you for your report',
  successMsg: (id) => `Your report has been recorded. Reference: ${id}.`
});

// ---------- Public Property (council land → Snap Send Solve) ----------
Pages.publicProperty = function () {
  openPage('Public Property', (body) => {
    const c = card();
    c.appendChild(el('<div class="frow" style="font-size:15px">Issues on public property — streets, footpaths, street lighting, parks and other council land — are handled by the local council rather than the building.</div>'));
    body.appendChild(c);
    const c2 = card();
    const link = el('<div class="frow"><a href="https://www.snapsendsolve.com" target="_blank" rel="noopener" style="color:var(--primary);font-weight:600">⤓ Get Snap Send Solve</a></div>');
    c2.appendChild(link);
    body.appendChild(c2);
    body.appendChild(el('<div class="fhint">Snap Send Solve is a free app for reporting issues to local councils and authorities. This link opens in your browser.</div>'));
  });
};

// ---------- Report an Issue — the capture screen (UI notes item 10) ----------
// Camera-first, never camera-mandatory: live preview on top (getUserMedia),
// the form right below. One triage question, structured location, the
// resident's own words. No type — the manager classifies (item 11).
const CAPTURE_LEVELS = ['Basement', 'Ground', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Roof'];
const CAPTURE_AREAS = ['Car park', 'Lobby', 'Corridor', 'Lift', 'Bin room', 'Stairwell',
  'Roof', 'Plant room', 'Pool', 'Garden / Grounds', 'Building exterior', 'Other'];
// One question, two service levels (2026-09-18): Standard first, Urgent
// starts the escalation chain. Subtitles/footers come from Settings JSON
// so the app never quotes a time the building hasn't agreed to.
const URGENCY = [['later', '🕘', 'Standard', 'responseStandard', 'Reply within 4 business hours'],
                 ['now', '⚠️', 'Urgent', 'responseUrgent', 'Someone attends now']];
function setting(key, dflt) { const v = String((store.config.settings || {})[key] || '').trim(); return v || dflt; }
function captureList(key, dflt) {
  const raw = ((store.config.settings || {})[key] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return raw.length ? raw : dflt;
}
function afterHoursContact() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('contacts-' + store.config.code)) || []; } catch { list = []; }
  const real = list.filter((c) => c.phone);   // Emergency-flagged rows (Scotia 24h) are wanted here; 000 is separate
  const match = (re) => real.find((c) => re.test(c.role + ' ' + hoursText(c.hours) + ' ' + c.notes));
  // after-hours line → security → building manager/caretaker → anyone (roster later, item 12)
  return match(/after|24/i) || match(/security/i) || match(/building manager|caretaker/i) || real[0] || null;
}
const telHref = (p) => 'tel:' + String(p || '').replace(/[^0-9+]/g, '');

Pages.captureIssue = function () {
  const config = store.config;
  openPage(label(config, 'reportIssue', 'Report an Issue'), (body) => {
    const state = drafts.capture || (drafts.capture = { urgency: '', level: '', area: '', locationDetail: '', description: '', photos: [] });   // no default: red outlines until chosen
    const noun = label(config, 'unitNoun', 'Unit').toLowerCase();
    const emergencyNumber = ((config.settings || {}).emergencyNumber || '').trim() || '000';

    // ---- camera card ----
    const cam = el(`<div class="camwrap">
      <video class="camvideo" autoplay playsinline muted hidden></video>
      <div class="camoff"><div class="camoff-icon">📷</div><div class="camoff-text">Starting camera…</div></div>
      <div class="cambar">
        <div class="camthumbs"></div>
        <label class="cambtn" title="Add from library">🖼<input type="file" accept="image/*" multiple hidden></label>
        <button type="button" class="cambtn camtorch" hidden title="Torch">🔦</button>
        <button type="button" class="camshutter" hidden aria-label="Take photo"></button>
      </div></div>`);
    body.appendChild(cam);
    const hint = el('<div class="fhint">No photo needed — just fill in the details below.</div>');
    body.appendChild(hint);
    const video = cam.querySelector('video'), off = cam.querySelector('.camoff'), offText = cam.querySelector('.camoff-text');
    const thumbs = cam.querySelector('.camthumbs'), shutter = cam.querySelector('.camshutter'), torchBtn = cam.querySelector('.camtorch');
    const fileInput = cam.querySelector('input[type=file]');
    let stream = null, track = null, torchOn = false;

    const drawThumbs = () => {
      thumbs.innerHTML = '';
      state.photos.forEach((b64, i) => {
        const t = el(`<div class="camthumb"><img src="data:image/jpeg;base64,${b64}"><button type="button" aria-label="Remove">✕</button></div>`);
        t.querySelector('button').addEventListener('click', () => { state.photos.splice(i, 1); drawThumbs(); refresh(); });
        thumbs.appendChild(t);
      });
      shutter.disabled = state.photos.length >= MAX_PHOTOS;
    };
    drawThumbs();

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { offText.textContent = 'No camera here — add photos from your library.'; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        video.srcObject = stream; video.hidden = false; off.hidden = true; shutter.hidden = false;
        hint.textContent = 'Snap a wide shot showing where, and a close-up showing what. No photo? Just fill in the details below.';
        track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) torchBtn.hidden = false;
      } catch (e) {
        offText.textContent = e && e.name === 'NotAllowedError'
          ? 'Camera access is off — allow it in your browser, or add photos from your library.'
          : 'Camera not available — add photos from your library.';
      }
    }
    function stopCamera() {
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; track = null; }
    }
    shutter.addEventListener('click', () => {
      if (!stream || state.photos.length >= MAX_PHOTOS) return;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);   // canvas re-encode: no EXIF/GPS
      state.photos.push(canvas.toDataURL('image/jpeg', 0.6).split(',')[1]);
      drawThumbs(); refresh();
    });
    torchBtn.addEventListener('click', async () => {
      if (!track) return;
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); torchBtn.classList.toggle('on', torchOn); }
      catch { /* torch is a nicety */ }
    });
    fileInput.addEventListener('change', async () => {
      for (const f of [...fileInput.files].slice(0, MAX_PHOTOS - state.photos.length)) {
        try { state.photos.push(await compressImage(f)); } catch (e) { toast(e.message); }
      }
      fileInput.value = ''; drawThumbs(); refresh();
    });
    startCamera();
    // Stop the camera when the page is left (back/home re-render the page).
    const obs = new MutationObserver(() => { if (!document.body.contains(cam)) { stopCamera(); obs.disconnect(); } });
    obs.observe($('page'), { childList: true, subtree: true });

    // ---- urgency ----
    body.appendChild(sectionTitle('How urgent is it? *'));
    const urow = el('<div class="urgrow"></div>');   // no card: three separate buttons
    const ufoot = el('<div class="fhint"></div>');
    const drawUrgency = () => {
      urow.innerHTML = '';
      URGENCY.forEach(([key, icon, title, subKey, subDefault]) => {
        const b = el(`<button type="button" class="urgbtn${state.urgency === key ? (key === 'now' ? ' red' : ' navy') : (state.urgency ? '' : ' choose')}"><span>${icon}</span><b>${esc(title)}</b><small>${esc(setting(subKey, subDefault))}</small></button>`);
        b.addEventListener('click', () => { state.urgency = key; drawUrgency(); drawCall(); refresh(); });
        urow.appendChild(b);
      });
      ufoot.textContent = state.urgency === 'now'
        ? setting('responseUrgentDetail', 'The on-duty contact is alerted straight away and must acknowledge within 15 minutes.') + ` Fire, gas or life at risk: call ${emergencyNumber} first.`
        : state.urgency === 'later'
          ? setting('responseStandardDetail', "You'll hear back within 4 business hours, and the manager may still attend sooner.")
          : setting('responseGuidance', 'Most reports are Standard: damage, cleaning, maintenance. Urgent is for an active leak, a break-in, a broken entry door, or someone hurt.');
    };
    body.appendChild(urow); body.appendChild(ufoot); drawUrgency();

    // ---- where ----
    body.appendChild(sectionTitle('Where'));
    const wc = card();
    wc.appendChild(selectRow('Level', captureList('captureLevels', CAPTURE_LEVELS), state.level, (v) => { state.level = v; }, 'Choose…'));
    const areaRow = selectRow('Area *', ['My ' + noun].concat(captureList('captureAreas', CAPTURE_AREAS)), state.area, (v) => { state.area = v; refresh(); }, 'Choose…');
    wc.appendChild(areaRow);
    wc.appendChild(textRow('Where exactly?', state.locationDetail, (i) => { state.locationDetail = i.value; }, { placeholder: `e.g. outside ${noun} 12` }));
    body.appendChild(wc);

    // ---- what ----
    body.appendChild(sectionTitle('What'));
    const dc = card();
    const whatRow = textareaRow('', state.description, (v) => { state.description = v; refresh(); }, "What's happening? Say it or type it.");
    dc.appendChild(whatRow);
    body.appendChild(dc);
    body.appendChild(el('<div class="fhint">Water is hard to see in a photo — a few words help. Please check dictated text before sending.</div>'));

    // ---- call now (urgent) — rendered below the form, see after the detailed-forms link ----
    const callHolder = el('<div></div>');
    function drawCall() {
      callHolder.innerHTML = '';
      if (state.urgency !== 'now') return;
      callHolder.appendChild(el('<div class="section-title" style="color:#d0021b">Need someone right now?</div>'));
      const ah = afterHoursContact();
      if (ah) {
        const c = card();
        c.appendChild(el(`<a class="navrow" href="${telHref(ah.phone)}"><span class="icon">📞</span><span><b>Call ${esc(ah.name || ah.role)}</b><br><span class="muted" style="font-size:13px">${[ah.name ? ah.role : '', ah.phone, hoursText(ah.hours)].filter(Boolean).map(esc).join(' · ')}</span></span><span class="chev">›</span></a>`));
        callHolder.appendChild(c);
      }
      callHolder.appendChild(el('<div class="fhint">A call gets the response tonight. Sending this report keeps the record.</div>'));
      // 000 in its own card, well clear of the after-hours row — a fat
      // finger on it is not a small mistake.
      callHolder.appendChild(el('<div class="section-title" style="color:#d0021b">Emergency</div>'));
      const e = card();
      e.appendChild(el(`<a class="navrow" href="${telHref(emergencyNumber)}" style="color:#d0021b"><span class="icon">🆘</span><b>Fire, flood, gas or safety — call ${esc(emergencyNumber)}</b><span class="chev">›</span></a>`));
      callHolder.appendChild(e);
    }
    drawCall();

    // ---- reporter + submit ----
    reporterSection(body, config);
    const footer = el(`<div>
      <div class="fhint" style="text-align:center">Goes to your building manager. They'll sort out the details and the category.</div>
      <div class="ferror" hidden></div>
      <button class="submitbtn">Send Report</button></div>`);
    const errEl = footer.querySelector('.ferror'), btn = footer.querySelector('.submitbtn');
    let attempted = false;
    const isValid = (d) => details.fullName(d).trim() && d.unitNumber.trim() && state.urgency && state.area &&
      (state.description.trim() || state.photos.length);
    function refresh() {
      const ok = isValid(details.load());
      // Red outline on required fields until filled (words or a photo for What).
      areaRow.classList.toggle('needs', !state.area);
      whatRow.classList.toggle('needs', !state.description.trim() && !state.photos.length);
      errEl.hidden = !attempted || ok;
      errEl.textContent = `Please choose Standard or Urgent, pick an area, and add a photo or a few words. Your name and ${noun} number come from My Details.`;
    }
    body.appendChild(footer);
    const alt = card();
    const altLink = el('<button class="navrow"><span class="icon">📋</span>Prefer a detailed form?<span class="chev">›</span></button>');
    altLink.addEventListener('click', () => Pages.reportIssue());
    alt.appendChild(altLink); body.appendChild(alt);
    body.appendChild(callHolder);
    refresh();

    btn.addEventListener('click', async () => {
      const d = details.load();
      if (!isValid(d)) { attempted = true; refresh(); errEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      const wasNow = state.urgency === 'now';
      try {
        const id = incidentID('IR');
        const resp = await postReport({
          action: 'submitCapture', code: config.code, incidentID: id,
          reporterName: details.fullName(d), unitNumber: d.unitNumber, phone: d.phoneNumber, email: d.email,
          urgency: state.urgency, level: state.level, area: state.area,
          locationDetail: state.locationDetail, description: state.description, photos: state.photos
        });
        delete drafts.capture;
        let msg = `Reference ${id}.`;
        if (resp.pendingVerification) msg += '\n\nTo send it to the building manager and receive progress updates, please verify your email address on the My Details page.';
        else if (resp.deliveredVia === 'email') msg += ' Sent to the building manager by email.';
        else msg += " It's in the building's register for the manager to pick up.";
        if (resp.escalation && resp.escalation.contact) {
          const e = resp.escalation;
          msg += `\n\nAlerted ${e.contact} by ${e.channel}.`;
          if (e.minutes > 0 && e.next) msg += ` If nobody acknowledges within ${e.minutes} minutes it goes to ${e.next}.`;
          msg += " You'll get an update here when someone picks it up.";
        }
        const ah = wasNow ? afterHoursContact() : null;
        if (ah) msg += `\n\nIf this needs someone right now, call ${ah.name || ah.role} on ${ah.phone}.`;
        stopCamera();
        showAlert("Thank you — it's recorded", msg, goBack);
      } catch (e) {
        showAlert('Submission Failed', friendlyError(e) + DRAFT_KEPT);
        btn.disabled = false; btn.textContent = 'Send Report';
      }
    });
  });
};
