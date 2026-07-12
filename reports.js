/* Majestic resident PWA — Phase 3: the four report forms with photos
   (leak, common property, security, noise) + audio on noise, and the
   Public Property redirect page. Mirrors the iOS forms and payloads. */

'use strict';

// ---------- date+time helpers ----------
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

// ---------- audio (mirrors AudioAttachmentSection: 60s cap per clip) ----------
const AUDIO_LIMIT_S = 60;
const audioMime = () => {
  if (!window.MediaRecorder) return null;
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
};

function audioSection(body, state) {
  body.appendChild(sectionTitle('Audio Recordings'));
  const c = card();
  const list = el('<div></div>');
  const row = el('<div class="frow"><button type="button" class="verify-link">● Record the noise</button></div>');
  const btn = row.querySelector('button');
  const mime = audioMime();
  let recorder = null, timer = null, seconds = 0;

  function redraw() {
    list.innerHTML = '';
    state.audioClips.forEach((clip, i) => {
      const item = el(`<div class="frow audioitem"><audio controls src="data:${clip.mime};base64,${clip.b64}"></audio>
        <button type="button">✕</button></div>`);
      item.querySelector('button').addEventListener('click', () => {
        state.audioClips.splice(i, 1); redraw();
      });
      list.appendChild(item);
    });
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mime });
        const b64 = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(',')[1]);
          r.readAsDataURL(blob);
        });
        state.audioClips.push({ b64, mime: mime.split(';')[0] });
        redraw();
      };
      recorder.start();
      seconds = 0;
      btn.textContent = '■ Stop (1:00)';
      timer = setInterval(() => {
        seconds++;
        const left = AUDIO_LIMIT_S - seconds;
        btn.textContent = `■ Stop (${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')})`;
        if (seconds >= AUDIO_LIMIT_S) stop();
      }, 1000);
    } catch {
      toast('Microphone access is off — enable it in your browser settings to record.');
    }
  }
  function stop() {
    clearInterval(timer);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
    btn.textContent = '● Record the noise';
  }
  btn.addEventListener('click', () => { recorder ? stop() : start(); });
  if (!mime) { btn.disabled = true; btn.textContent = 'Recording not supported in this browser'; }

  c.appendChild(list);
  c.appendChild(row);
  body.appendChild(c);
  body.appendChild(el('<div class="fhint">Optional. Record up to 60 seconds per clip of the noise itself.</div>'));
  redraw();
}

// ---------- the four report forms ----------
Pages.leak = () => formPage({
  title: 'Water Leak',
  prefix: 'LK', draftKey: 'leak', submitLabel: 'Submit Report',
  fresh: () => ({ dateNoticed: todayISO(), timeNoticed: nowHM(), location: '',
                  sourceIdentified: '', sourceDetails: '', mitigationPossible: '', mitigationDetails: '',
                  weatherRelated: '', weatherDetails: '', changesOverTime: '', changesDetails: '',
                  neighbourContacted: '', neighbourApartments: '', neighbourDetails: '', photos: [] }),
  sections(body, s, refresh) {
    const noun = label(store.config, 'unitNoun', 'Unit').toLowerCase();
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
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() && s.location.trim() &&
    s.sourceIdentified && s.mitigationPossible && s.weatherRelated && s.changesOverTime && s.neighbourContacted,
  invalidMsg: 'Please fill in your name, unit number, location, and answer all questions before submitting.',
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
    c.appendChild(selectRow('Area *', ['Lobby', 'Hallway / Corridor', 'Lift', 'Stairwell',
      'Car Park', 'Garden / Grounds', 'Building Exterior', 'Other'],
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
    s.damageDescription.trim() && s.safetyHazard && s.securityRisk && s.causeKnown && s.witnessed && s.likelyToWorsen,
  invalidMsg: 'Please fill in your name, unit number, the area, a description, and answer all questions before submitting.',
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
    [['My Unit', `My ${noun}`], ...['Lobby', 'Hallway / Corridor', 'Lift', 'Stairwell',
      'Car Park', 'Garden / Grounds', 'Building Exterior', 'Other'].map((o) => [o, o])]
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
    s.incidentDescription.trim() && s.isOngoing && s.sawPerson && s.reportedToPolice && s.cctvNearby,
  invalidMsg: 'Please fill in your name, unit number, the incident type, area, a description, and answer all questions before submitting.',
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
                  photos: [], audioClips: [] }),
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
    audioSection(body, s);
  },
  isValid: (s, d) => details.fullName(d).trim() && d.unitNumber.trim() && s.noiseType &&
    s.noiseDescription.trim() && s.isRecurring && s.quietHours && s.impact && s.raisedWithPerson,
  invalidMsg: 'Please fill in your name, unit number, the noise type, a description, and answer all questions before submitting.',
  buildPayload: (s) => ({
    action: 'submitNoise',
    firstStarted: fmtDateTime(s.firstDate, s.firstTime),
    lastOccurred: fmtDateTime(s.lastDate, s.lastTime),
    noiseType: s.noiseType, suspectedSource: s.suspectedSource, noiseDescription: s.noiseDescription,
    isRecurring: s.isRecurring, recurringDetails: s.recurringDetails,
    quietHours: s.quietHours, quietHoursDetails: s.quietHoursDetails,
    impact: s.impact, impactDetails: s.impactDetails,
    raisedWithPerson: s.raisedWithPerson, raisedDetails: s.raisedDetails,
    photos: s.photos,
    audioClips: s.audioClips.map((c) => c.b64),
    audioMimeType: s.audioClips.length ? s.audioClips[0].mime : ''
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
