const storageKey = 'docvisitmobile-demo-records-v1';
const existingDoctorIds = new Set(['moumitasarkar', 'romitasarkar']);
const today = new Date();
const isoDate = (date) => date.toISOString().slice(0, 10);
const addDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return isoDate(date); };
function createExistingDoctorSampleRecords() {
  const appointments = [
    { id: 'ap-1', doctorId: 'moumitasarkar', patientId: 'pt-1', date: addDays(0), time: '09:30', type: 'Annual check-up', room: 'Room 02', status: 'Checked in' },
    { id: 'ap-2', doctorId: 'moumitasarkar', patientId: 'pt-2', date: addDays(0), time: '10:15', type: 'Follow-up', room: 'Room 01', status: 'Confirmed' },
    { id: 'ap-3', doctorId: 'moumitasarkar', patientId: 'pt-3', date: addDays(0), time: '11:00', type: 'Consultation', room: 'Room 03', status: 'Confirmed' },
    { id: 'ap-4', doctorId: 'romitasarkar', patientId: 'pt-4', date: addDays(0), time: '13:30', type: 'Medication review', room: 'Room 02', status: 'Pending' },
    { id: 'ap-5', doctorId: 'romitasarkar', patientId: 'pt-5', date: addDays(1), time: '09:00', type: 'Follow-up', room: 'Room 01', status: 'Confirmed' },
    { id: 'ap-6', doctorId: 'romitasarkar', patientId: 'pt-6', date: addDays(2), time: '10:30', type: 'Consultation', room: 'Room 03', status: 'Pending' },
  ];
  const prescriptions = [
    { id: 'rx-1', doctorId: 'moumitasarkar', patientId: 'pt-1', medication: 'Atorvastatin', directions: '10 mg · Once daily', refills: 2, status: 'Active', expires: addDays(12) },
    { id: 'rx-2', doctorId: 'moumitasarkar', patientId: 'pt-2', medication: 'Lisinopril', directions: '5 mg · Once daily', refills: 0, status: 'Renewal due', expires: addDays(4) },
    { id: 'rx-3', doctorId: 'romitasarkar', patientId: 'pt-3', medication: 'Metformin', directions: '500 mg · Twice daily', refills: 1, status: 'Active', expires: addDays(30) },
    { id: 'rx-4', doctorId: 'romitasarkar', patientId: 'pt-4', medication: 'Amlodipine', directions: '5 mg · Once daily', refills: 0, status: 'Renewal due', expires: addDays(7) },
  ];
  return { appointments, prescriptions };
}
function loadRecords() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    /* Start with empty record collections when stored data cannot be read. */
  }
  const records = saved && ['patients', 'appointments', 'prescriptions'].every((key) => Array.isArray(saved[key]))
    ? saved
    : { patients: [], appointments: [], prescriptions: [] };
  records.patients = [];

  for (const appointment of records.appointments) {
    if (/^ap-[1-6]$/.test(appointment.id) && !appointment.doctorId) {
      appointment.doctorId = Number(appointment.id.slice(3)) <= 3 ? 'moumitasarkar' : 'romitasarkar';
    }
  }
  for (const prescription of records.prescriptions) {
    if (/^rx-[1-4]$/.test(prescription.id) && !prescription.doctorId) {
      prescription.doctorId = Number(prescription.id.slice(3)) <= 2 ? 'moumitasarkar' : 'romitasarkar';
    }
  }

  if (!saved?.existingDoctorSampleDataRestored) {
    const samples = createExistingDoctorSampleRecords();
    for (const key of ['appointments', 'prescriptions']) {
      const existingIds = new Set(records[key].map((record) => record.id));
      records[key].push(...samples[key].filter((record) => !existingIds.has(record.id)));
    }
    records.existingDoctorSampleDataRestored = true;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(records));
  } catch { /* Keep this page session usable. */ }
  return records;
}
const records = loadRecords();
let currentView = 'dashboard';
let patientDisplayMode = 'grid';
let patientSearch = '';
let doctorProfilesById = new Map();
let currentUser = null;
let previewDoctorId = null;
let historyPatientId = null;
let pendingAppointmentDraft = null;
let query = '';
let appointmentFilter = 'all';
let attachmentDbPromise;
let activeAttachmentUrls = [];
const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const patientFor = (id) => records.patients.find((patient) => patient.id === id);
const initialsFor = (patient) => patient.initials || patient.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
const dateLabel = (value, options = { month: 'short', day: 'numeric' }) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', options);
const isToday = (value) => value === isoDate(today);
const matchesQuery = (...values) => !query || values.some((value) => String(value ?? '').toLowerCase().includes(query));
function isDoctorRecord(record, doctorId = currentUser?.id) {
  if (!currentUser || currentUser.role === 'superadmin') {
    return doctorId ? (record.doctorId === doctorId || (!record.doctorId && existingDoctorIds.has(doctorId))) : true;
  }
  return record.doctorId === currentUser.id || (!record.doctorId && existingDoctorIds.has(currentUser.id));
}
function doctorPatientsForCurrentUser(doctorId = currentUser?.id) {
  if (!currentUser || currentUser.role === 'superadmin') {
    return doctorId ? records.patients.filter((patient) => {
      const appointmentMatch = patient.doctorId === doctorId || records.appointments.some((appointment) => appointment.patientId === patient.id && isDoctorRecord(appointment, doctorId));
      const prescriptionMatch = records.prescriptions.some((prescription) => prescription.patientId === patient.id && isDoctorRecord(prescription, doctorId));
      return appointmentMatch || prescriptionMatch;
    }) : records.patients;
  }
  return records.patients.filter((patient) => {
    const appointmentMatch = patient.doctorId === currentUser.id || records.appointments.some((appointment) => appointment.patientId === patient.id && isDoctorRecord(appointment));
    const prescriptionMatch = records.prescriptions.some((prescription) => prescription.patientId === patient.id && isDoctorRecord(prescription));
    return appointmentMatch || prescriptionMatch;
  });
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
function saveRecords() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      ...records,
      patients: [],
    }));
  } catch { /* Keep this page session usable. */ }
}
async function loadPatients() {
  const { patients } = await api('/api/patients');
  records.patients = patients;
  saveRecords();
}
function openAttachmentDb() {
  if (!attachmentDbPromise) {
    attachmentDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('docvisitmobile-prescription-attachments', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('attachments', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open attachment storage.'));
    });
  }
  return attachmentDbPromise;
}
async function putAttachment(attachment) {
  const database = await openAttachmentDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('attachments', 'readwrite');
    transaction.objectStore('attachments').put(attachment);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not save attachment.'));
    transaction.onabort = () => reject(transaction.error || new Error('Attachment save was cancelled.'));
  });
}
async function getAttachment(id) {
  const database = await openAttachmentDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction('attachments', 'readonly').objectStore('attachments').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not load attachment.'));
  });
}
async function deleteAttachment(id) {
  const database = await openAttachmentDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('attachments', 'readwrite');
    transaction.objectStore('attachments').delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not delete attachment.'));
  });
}
async function storePrescriptionFiles(prescriptionId, files) {
  if (files.length > 5) throw new Error('A prescription can have at most 5 attachments.');
  const saved = [];
  try {
    for (const [index, file] of files.entries()) {
      if (file.size > 20 * 1024 * 1024) throw new Error('Each attachment must be 20 MB or smaller.');
      const id = `${prescriptionId}-${index}-${crypto.randomUUID()}`;
      await putAttachment({ id, blob: file });
      saved.push({ id, name: file.name, type: file.type, size: file.size });
    }
    return saved;
  } catch (error) {
    await Promise.all(saved.map((item) => deleteAttachment(item.id).catch(() => {})));
    throw error;
  }
}
function clearModal() {
  activeAttachmentUrls.forEach((url) => URL.revokeObjectURL(url));
  activeAttachmentUrls = [];
  byId('modal-root').innerHTML = '';
}
function badge(status) {
  const modifier = status === 'Pending' || status === 'Renewal due' ? ' badge--pending' : status === 'Completed' ? ' badge--completed' : status === 'Cancelled' ? ' badge--cancelled' : status === 'Active' ? ' badge--active' : '';
  return `<span class="badge${modifier}">${escapeHtml(status)}</span>`;
}
function renderMetrics() {
  const scopedPatients = doctorPatientsForCurrentUser();
  const scopedAppointments = records.appointments.filter((item) => isDoctorRecord(item));
  const appointmentsToday = scopedAppointments.filter((item) => isToday(item.date) && item.status !== 'Cancelled');
  const newPatientsToday = scopedPatients.filter((patient) => patient.createdAt === isoDate(today)).length;
  const pendingAppointmentsToday = appointmentsToday.filter((item) => item.status === 'Pending').length;
  const metrics = [['Total Patients', scopedPatients.length, '◉', 'metric-icon--blue'], ['New Patients Today', newPatientsToday, '+', ''], ['Appointments Today', appointmentsToday.length, '◷', 'metric-icon--gold'], ['Pending Appointments Today', pendingAppointmentsToday, '◷', 'metric-icon--coral']];
  byId('metric-grid').innerHTML = metrics.map(([label, count, icon, modifier]) => `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${modifier}">${icon}</span></div><div class="metric-value">${count}</div></article>`).join('');
}
function renderDashboard() {
  const scopedAppointments = records.appointments.filter((item) => isDoctorRecord(item));
  const scopedPrescriptions = records.prescriptions.filter((item) => isDoctorRecord(item));
  const appointments = scopedAppointments.filter((item) => isToday(item.date) && item.status !== 'Cancelled').sort((a, b) => a.time.localeCompare(b.time));
  byId('today-appointments').innerHTML = appointments.length ? appointments.map((item) => { const patient = patientFor(item.patientId); if (!patient) return ''; return `<article class="appointment-item"><span class="appointment-time">${escapeHtml(item.time)}</span><div class="appointment-person"><span class="avatar">${escapeHtml(initialsFor(patient))}</span><span><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(item.type)}</small></span></div><div class="appointment-meta"><span class="appointment-room">${escapeHtml(item.room || 'Room 01')}</span>${badge(item.status)}</div></article>`; }).join('') : '<p class="empty-state">No appointments scheduled for today.</p>';
  const renewals = scopedPrescriptions.filter((item) => item.status === 'Renewal due').slice(0, 4);
  byId('renewal-list').innerHTML = renewals.length ? renewals.map((item) => `<article class="renewal-item"><span><strong>${escapeHtml(patientFor(item.patientId)?.name || 'Unknown patient')}</strong><small>${escapeHtml(item.medication)}</small></span><span class="renewal-days">${Math.max(0, Math.ceil((new Date(`${item.expires}T12:00:00`) - new Date()) / 86400000))} days</span></article>`).join('') : '<p class="empty-state">You’re all caught up.</p>';
  byId('renewal-count').textContent = scopedPrescriptions.filter((item) => item.status === 'Renewal due').length;
  byId('patient-strip').innerHTML = doctorPatientsForCurrentUser().slice(-4).reverse().map((patient) => `<div class="patient-chip"><span class="avatar">${escapeHtml(initialsFor(patient))}</span><span><strong>${escapeHtml(patient.name)}</strong><small>Last visit ${dateLabel(patient.lastVisit)}</small></span></div>`).join('');
}
function renderAppointments() {
  const filtered = records.appointments.filter((item) => { const patient = patientFor(item.patientId); const dateMatch = appointmentFilter === 'all' || (appointmentFilter === 'today' && isToday(item.date)) || (appointmentFilter === 'upcoming' && item.date >= isoDate(today)); return patient && dateMatch && matchesQuery(patient.name, item.type, item.status, item.date) && isDoctorRecord(item); }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  byId('appointments-rows').innerHTML = filtered.map((item) => { const patient = patientFor(item.patientId); return `<tr><td><span class="table-person"><span class="avatar">${escapeHtml(initialsFor(patient))}</span><strong>${escapeHtml(patient.name)}</strong></span></td><td>${dateLabel(item.date, { month: 'short', day: 'numeric', year: 'numeric' })}<span class="table-subtext">${escapeHtml(item.time)}</span></td><td>${escapeHtml(item.type)}</td><td><label class="sr-only" for="status-${escapeHtml(item.id)}">Appointment status for ${escapeHtml(patient.name)}</label><select class="status-select" id="status-${escapeHtml(item.id)}" data-status-id="${escapeHtml(item.id)}">${['Pending', 'Confirmed', 'Checked in', 'Completed', 'Cancelled'].map((status) => `<option${item.status === status ? ' selected' : ''}>${status}</option>`).join('')}</select></td><td><span class="appointment-row-actions"><button class="row-action" type="button" data-edit-appointment="${escapeHtml(item.id)}" aria-label="Edit appointment for ${escapeHtml(patient.name)}" title="Edit appointment">✎</button><button class="row-action" type="button" data-add-appointment-prescription="${escapeHtml(item.id)}" aria-label="Add prescription for ${escapeHtml(patient.name)}" title="Add prescription">＋</button><button class="row-action" type="button" data-delete-appointment="${escapeHtml(item.id)}" aria-label="Delete appointment for ${escapeHtml(patient.name)}" title="Delete appointment">×</button></span></td></tr>`; }).join('');
  byId('appointments-empty').hidden = filtered.length > 0;
}
function renderPatients() {
  const filtered = records.patients.filter((item) => {
    const patientMatches = matchesQuery(item.name, item.address, item.email, item.phone) && (!patientSearch || [item.name, item.address, item.email, item.phone].some((value) => String(value || '').toLowerCase().includes(patientSearch)));
    if (!patientMatches) return false;
    if (currentUser?.role === 'superadmin' && !previewDoctorId) return true;
    const doctorId = previewDoctorId || currentUser?.id;
    const hasDoctorRecords = item.doctorId === doctorId || records.appointments.some((appointment) => appointment.patientId === item.id && isDoctorRecord(appointment, doctorId)) || records.prescriptions.some((prescription) => prescription.patientId === item.id && isDoctorRecord(prescription, doctorId));
    return hasDoctorRecords;
  });
  byId('patient-grid').innerHTML = filtered.map((item) => `<article class="patient-card"><div class="patient-card-top"><span class="avatar">${escapeHtml(initialsFor(item))}</span><span><strong>${escapeHtml(item.name)}</strong><small>Last visit ${dateLabel(item.lastVisit, { month: 'long', year: 'numeric' })}</small></span><span class="patient-card-actions">${currentUser?.role === 'doctor' ? `<button class="icon-button patient-edit-button" type="button" data-edit-patient="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit patient">✎</button>` : ''}<button class="icon-button patient-history-button" type="button" data-patient-history="${escapeHtml(item.id)}" aria-label="View appointments and prescriptions for ${escapeHtml(item.name)}" title="View patient history">◷</button></span></div><div class="patient-detail"><span class="patient-address">Address/Locality<strong>${escapeHtml(item.address || 'Not provided')}</strong></span><span>Gender<strong>${escapeHtml(item.gender || '—')}</strong></span><span>Age<strong>${item.age ?? '—'}</strong></span><span>Email<strong>${escapeHtml(item.email || 'Not provided')}</strong></span><span>Phone<strong>${escapeHtml(item.phone || 'Not provided')}</strong></span><span>Date of birth<strong>${item.birthDate ? dateLabel(item.birthDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not provided'}</strong></span><span>Last visit<strong>${item.lastVisit ? dateLabel(item.lastVisit, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not provided'}</strong></span></div></article>`).join('');
  byId('patient-list-rows').innerHTML = filtered.map((item) => `<tr><td><span class="patient-list-identity">${currentUser?.role === 'doctor' ? `<button class="icon-button patient-edit-button" type="button" data-edit-patient="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit patient">✎</button>` : ''}<button class="icon-button patient-history-button" type="button" data-patient-history="${escapeHtml(item.id)}" aria-label="View appointments and prescriptions for ${escapeHtml(item.name)}" title="View patient history">◷</button><span class="table-person"><span class="avatar">${escapeHtml(initialsFor(item))}</span><strong>${escapeHtml(item.name)}</strong></span></span></td><td>${escapeHtml(item.gender || '—')}</td><td>${item.age ?? '—'}</td><td>${escapeHtml(item.address || 'Not provided')}</td><td>${escapeHtml(item.email || 'Not provided')}</td><td>${escapeHtml(item.phone || 'Not provided')}</td><td>${item.birthDate ? dateLabel(item.birthDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not provided'}</td><td>${item.lastVisit ? dateLabel(item.lastVisit, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not provided'}</td></tr>`).join('');
  byId('patient-grid').hidden = patientDisplayMode !== 'grid' || filtered.length === 0;
  byId('patient-list').hidden = patientDisplayMode !== 'list' || filtered.length === 0;
  document.querySelectorAll('[data-patient-mode]').forEach((button) => {
    const active = button.dataset.patientMode === patientDisplayMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  byId('patients-empty').hidden = filtered.length > 0;
}
function showPatientHistory(patientId) {
  const patient = patientFor(patientId);
  if (!patient) return;
  historyPatientId = patientId;
  byId('history-medication-search').value = '';
  currentView = 'patient-history';
  render();
}
function renderPatientHistory() {
  const patient = patientFor(historyPatientId);
  if (!patient) return;
  const doctorId = previewDoctorId || currentUser?.id;
  const canEditRecords = currentUser?.role === 'doctor';
  const appointments = records.appointments.filter((item) => item.patientId === patient.id && isDoctorRecord(item, doctorId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  const prescriptions = records.prescriptions.filter((item) => item.patientId === patient.id && isDoctorRecord(item, doctorId));
  const appointmentIds = new Set(appointments.map((item) => item.id));
  const appointmentRows = appointments.map((appointment) => {
    const medications = prescriptions.filter((item) => item.appointmentId === appointment.id);
    const appointmentDate = dateLabel(appointment.date, { month: 'short', day: 'numeric', year: 'numeric' });
    const actions = canEditRecords ? `<div class="history-appointment-actions"><button class="icon-button history-action-button" type="button" data-edit-appointment="${escapeHtml(appointment.id)}" aria-label="Edit appointment on ${appointmentDate}" title="Edit appointment">✎</button><button class="icon-button history-action-button" type="button" data-add-appointment-prescription="${escapeHtml(appointment.id)}" aria-label="Add prescription for appointment on ${appointmentDate}" title="Add prescription">＋</button></div>` : '';
    const medicationMarkup = medications.length
      ? `<ul class="history-medication-list">${medications.map((item) => `<li data-history-medication="${escapeHtml(`${item.medication} ${item.directions} ${item.status}`.toLowerCase())}"><strong>${escapeHtml(item.medication)}</strong><span>${escapeHtml(item.directions)}</span>${canEditRecords ? `<button class="icon-button history-prescription-edit" type="button" data-edit-prescription="${escapeHtml(item.id)}" aria-label="Edit prescription for ${escapeHtml(item.medication)}" title="Edit prescription">✎</button>` : ''}<button class="icon-button history-prescription-view" type="button" data-view-prescription="${escapeHtml(item.id)}" aria-label="View prescription for ${escapeHtml(item.medication)}" title="View prescription">↗</button></li>`).join('')}</ul>`
      : '<span class="history-empty">No medications recorded</span>';
    return `<article class="history-row" data-history-row><div class="history-date"><div class="history-date-heading"><strong>${appointmentDate}</strong>${actions}</div><span>${escapeHtml(appointment.time)} · ${escapeHtml(appointment.type)}</span></div><div class="history-medications">${medicationMarkup}</div></article>`;
  });
  const unlinkedMedications = prescriptions.filter((item) => !item.appointmentId || !appointmentIds.has(item.appointmentId));
  if (unlinkedMedications.length) {
    appointmentRows.push(`<article class="history-row" data-history-row><div class="history-date"><strong>Not linked to a visit</strong></div><div class="history-medications"><ul class="history-medication-list">${unlinkedMedications.map((item) => `<li data-history-medication="${escapeHtml(`${item.medication} ${item.directions} ${item.status}`.toLowerCase())}"><strong>${escapeHtml(item.medication)}</strong><span>${escapeHtml(item.directions)}</span>${canEditRecords ? `<button class="icon-button history-prescription-edit" type="button" data-edit-prescription="${escapeHtml(item.id)}" aria-label="Edit prescription for ${escapeHtml(item.medication)}" title="Edit prescription">✎</button>` : ''}<button class="icon-button history-prescription-view" type="button" data-view-prescription="${escapeHtml(item.id)}" aria-label="View prescription for ${escapeHtml(item.medication)}" title="View prescription">↗</button></li>`).join('')}</ul></div></article>`);
  }
  const appointmentContent = appointmentRows.length ? appointmentRows.join('') : '<p class="history-empty">No appointment or medication history on file.</p>';
  byId('patient-history-details').innerHTML = `<div class="patient-history-details"><div class="patient-history-identity"><span class="avatar">${escapeHtml(initialsFor(patient))}</span><div><h2>${escapeHtml(patient.name)}</h2><span>${escapeHtml(patient.email || 'Email not provided')}</span></div></div><div class="patient-history-detail-grid"><span>Address<strong>${escapeHtml(patient.address || 'Not provided')}</strong></span><span>Phone<strong>${escapeHtml(patient.phone || 'Not provided')}</strong></span><span>Date of birth<strong>${patient.birthDate ? dateLabel(patient.birthDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not provided'}</strong></span><span>Last visit<strong>${patient.lastVisit ? dateLabel(patient.lastVisit, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded'}</strong></span></div></div>`;
  byId('patient-history-content').innerHTML = appointmentContent;
  filterPatientHistoryMedications();
}
function showDoctorRecordOverview(doctorId = currentUser?.id) {
  const targetDoctor = doctorId ? doctorProfilesById.get(doctorId) || { id: doctorId, name: 'Doctor' } : currentUser;
  const doctorPatients = doctorPatientsForCurrentUser(doctorId);
  const patientCards = doctorPatients.length
    ? doctorPatients.map((patient) => {
      const appointments = records.appointments.filter((item) => item.patientId === patient.id && isDoctorRecord(item, doctorId));
      const prescriptions = records.prescriptions.filter((item) => item.patientId === patient.id && isDoctorRecord(item, doctorId));
      const appointmentList = appointments.length
        ? appointments.map((item) => `<li><strong>${dateLabel(item.date, { month: 'short', day: 'numeric', year: 'numeric' })}</strong><span>${escapeHtml(item.time)} · ${escapeHtml(item.type)}</span>${badge(item.status)}</li>`).join('')
        : '<li class="history-empty">No appointments on file.</li>';
      const prescriptionList = prescriptions.length
        ? prescriptions.map((item) => `<li><strong>${escapeHtml(item.medication)}</strong><span>${escapeHtml(item.directions)}</span>${badge(item.status)}</li>`).join('')
        : '<li class="history-empty">No prescriptions on file.</li>';
      return `<article class="history-row"><div class="history-date"><strong>${escapeHtml(patient.name)}</strong><span>${escapeHtml(patient.email)}</span></div><div class="history-medications"><div class="doctor-record-group"><h4>Appointments</h4><ul class="doctor-record-list">${appointmentList}</ul></div><div class="doctor-record-group"><h4>Prescriptions</h4><ul class="doctor-record-list">${prescriptionList}</ul></div></div></article>`;
    }).join('')
    : '<p class="history-empty">No patient record history available for this doctor.</p>';
  clearModal();
  byId('modal-root').innerHTML = `<div class="modal-layer" data-close-modal><section class="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="doctor-records-title"><div class="modal-header"><div><p class="eyebrow">DOCTOR RECORDS</p><h2 id="doctor-records-title">${escapeHtml(targetDoctor.name || 'Doctor')} patient records</h2></div><button class="modal-close" type="button" data-close-modal aria-label="Close dialog">×</button></div><section class="history-section"><div class="history-column-heads"><h3>Patient</h3><h3>Appointments &amp; prescriptions</h3></div>${patientCards}</section><div class="modal-actions"><button class="button button--secondary" type="button" data-close-modal>Close</button></div></section></div>`;
}
function renderPrescriptions() {
  const filtered = records.prescriptions.filter((item) => { const patient = patientFor(item.patientId); return patient && matchesQuery(patient.name, item.medication, item.directions, item.status) && isDoctorRecord(item); });
  byId('prescription-rows').innerHTML = filtered.map((item) => { const patient = patientFor(item.patientId); const appointment = records.appointments.find((visit) => visit.id === item.appointmentId); const attachments = item.attachments || []; return `<tr><td><span class="table-person"><span class="avatar">${escapeHtml(initialsFor(patient))}</span><strong>${escapeHtml(patient.name)}</strong></span></td><td>${escapeHtml(item.medication)}</td><td>${escapeHtml(item.directions)}</td><td>${appointment ? `${dateLabel(appointment.date, { month: 'short', day: 'numeric' })} · ${escapeHtml(appointment.time)}` : 'Not linked'}</td><td>${attachments.length ? `<button class="attachment-count-button" type="button" data-prescription-attachments="${escapeHtml(item.id)}" aria-label="View ${attachments.length} files for ${escapeHtml(item.medication)}" title="View attachments">⌁ ${attachments.length}</button>` : '—'}</td><td>${Number(item.refills)}</td><td>${badge(item.status)}</td><td><button class="row-action" type="button" data-delete-prescription="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.medication)} prescription" title="Delete prescription">×</button></td></tr>`; }).join('');
  byId('prescriptions-empty').hidden = filtered.length > 0;
}
async function showPrescriptionAttachments(prescriptionId) {
  const prescription = records.prescriptions.find((item) => item.id === prescriptionId);
  if (!prescription) return;
  clearModal();
  const attachments = await Promise.all((prescription.attachments || []).map(async (item) => {
    const stored = await getAttachment(item.id);
    const deleteAction = currentUser?.role === 'doctor' ? `<button class="icon-button attachment-delete-button" type="button" data-delete-attachment="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}" title="Delete file"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button>` : '';
    if (!stored) return `<li><span class="attachment-name"><strong>${escapeHtml(item.name)}</strong><small>File unavailable</small></span><span class="attachment-actions">${deleteAction}</span></li>`;
    const url = URL.createObjectURL(stored.blob);
    activeAttachmentUrls.push(url);
    return `<li><span class="attachment-name"><strong>${escapeHtml(item.name)}</strong><small>${Math.max(1, Math.round(item.size / 1024))} KB</small></span><span class="attachment-actions"><button class="icon-button" type="button" data-preview-attachment="${escapeHtml(item.id)}" aria-label="View ${escapeHtml(item.name)}" title="View file"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button><a class="icon-button" href="${url}" download="${escapeHtml(item.name)}" aria-label="Download ${escapeHtml(item.name)}" title="Download file"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 17v4h14v-4"/></svg></a>${deleteAction}</span></li>`;
  }));
  byId('modal-root').innerHTML = `<div class="modal-layer" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="attachment-title"><div class="modal-header"><div><p class="eyebrow">PRESCRIPTION FILES</p><h2 id="attachment-title">${escapeHtml(prescription.medication)}</h2></div><button class="modal-close" type="button" data-close-modal aria-label="Close dialog">×</button></div>${attachments.length ? `<ul class="attachment-list">${attachments.join('')}</ul>` : '<p class="history-empty">No files are attached to this prescription.</p>'}<div class="modal-actions"><button class="button button--secondary" type="button" data-close-modal>Close</button></div></section></div>`;
}
async function showAttachmentPreview(attachmentId) {
  const attachment = await getAttachment(attachmentId);
  if (!attachment) throw new Error('Attachment is unavailable.');
  const prescription = records.prescriptions.find((item) => item.attachments?.some((file) => file.id === attachmentId));
  clearModal();
  const url = URL.createObjectURL(attachment.blob);
  activeAttachmentUrls.push(url);
  const preview = attachment.blob.type.startsWith('image/')
    ? `<img class="attachment-preview" src="${url}" alt="${escapeHtml(attachment.name)}" />`
    : attachment.blob.type === 'application/pdf'
      ? `<iframe class="attachment-pdf-preview" src="${url}" title="${escapeHtml(attachment.name)}"></iframe>`
      : '<p class="history-empty">This file type can be downloaded but not previewed here.</p>';
  byId('modal-root').innerHTML = `<div class="modal-layer" data-close-modal><section class="modal attachment-preview-modal" role="dialog" aria-modal="true" aria-labelledby="attachment-preview-title"><div class="modal-header"><div><p class="eyebrow">FILE PREVIEW</p><h2 id="attachment-preview-title">${escapeHtml(attachment.name)}</h2></div><button class="modal-close" type="button" data-close-modal aria-label="Close dialog">×</button></div>${preview}<div class="modal-actions"><button class="button button--secondary" type="button" data-prescription-attachments="${escapeHtml(prescription?.id || '')}">Back to files</button><span class="attachment-actions"><a class="icon-button" href="${url}" download="${escapeHtml(attachment.name)}" aria-label="Download ${escapeHtml(attachment.name)}" title="Download file"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 17v4h14v-4"/></svg></a>${currentUser?.role === 'doctor' ? `<button class="icon-button attachment-delete-button" type="button" data-delete-attachment="${escapeHtml(attachmentId)}" aria-label="Delete ${escapeHtml(attachment.name)}" title="Delete file"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button>` : ''}</span></div></section></div>`;
}
async function viewPrescriptionFile(prescriptionId) {
  const prescription = records.prescriptions.find((item) => item.id === prescriptionId);
  if (!prescription) return;
  const attachments = prescription.attachments || [];
  if (attachments.length === 1) return showAttachmentPreview(attachments[0].id);
  if (attachments.length > 1) return showPrescriptionAttachments(prescriptionId);
  clearModal();
  byId('modal-root').innerHTML = `<div class="modal-layer" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="prescription-view-title"><div class="modal-header"><div><p class="eyebrow">PRESCRIPTION</p><h2 id="prescription-view-title">${escapeHtml(prescription.medication)}</h2></div><button class="modal-close" type="button" data-close-modal aria-label="Close dialog">×</button></div><p>${escapeHtml(prescription.directions)}</p><p class="history-empty">No file has been uploaded for this prescription.</p><div class="modal-actions"><button class="button button--secondary" type="button" data-close-modal>Close</button></div></section></div>`;
}
function filterPatientHistoryMedications() {
  const input = byId('history-medication-search');
  if (!input) return;
  const query = input.value.trim().toLowerCase();
  let matchCount = 0;
  document.querySelectorAll('[data-history-row]').forEach((row) => {
    const appointmentText = row.querySelector('.history-date')?.textContent.toLowerCase() || '';
    const appointmentMatches = !query || appointmentText.includes(query);
    const medications = [...row.querySelectorAll('[data-history-medication]')];
    const matchingMedication = medications.some((medication) => medication.dataset.historyMedication.includes(query));
    const rowMatches = appointmentMatches || matchingMedication;
    medications.forEach((medication) => {
      medication.hidden = Boolean(query) && !appointmentMatches && !medication.dataset.historyMedication.includes(query);
    });
    row.hidden = !rowMatches;
    if (rowMatches) matchCount += 1;
  });
  byId('history-search-empty').hidden = !query || matchCount > 0;
}
function render() {
  const isAdmin = currentUser?.role === 'superadmin';
  const isDoctorPreview = isAdmin && Boolean(previewDoctorId);
  const viewedDoctor = previewDoctorId ? doctorProfilesById.get(previewDoctorId) : null;
  byId('app-shell').classList.toggle('is-superadmin', isAdmin);
  byId('add-patient-button').hidden = isDoctorPreview;
  document.querySelectorAll('[data-doctor-only]').forEach((element) => {
    element.hidden = isAdmin && !(isDoctorPreview && ['patients', 'patient-history'].includes(element.dataset.panel));
  });
  byId('metric-grid').hidden = currentView === 'patient-history';
  document.querySelectorAll('[data-admin-only]').forEach((element) => { element.hidden = !isAdmin; });
  byId('return-to-doctors').hidden = !isDoctorPreview;
  byId('return-to-patients').hidden = currentView !== 'patient-history';
  byId('greeting').textContent = isDoctorPreview ? `${viewedDoctor?.name || 'Doctor'} · ${currentView === 'patient-history' ? 'Patient history' : 'Patients'}` : '';
  if (isAdmin && !isDoctorPreview) {
    currentView = 'doctors';
    loadDoctors();
  } else if (isDoctorPreview) {
    renderPatients();
    if (currentView === 'patient-history') renderPatientHistory();
  } else {
    renderMetrics(); renderDashboard(); renderAppointments(); renderPatients(); renderPrescriptions();
    if (currentView === 'patient-history') renderPatientHistory();
  }
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    const permittedPanel = isDoctorPreview
      ? ['patients', 'patient-history'].includes(panel.dataset.panel)
      : isAdmin ? panel.hasAttribute('data-admin-only') : panel.hasAttribute('data-doctor-only');
    panel.hidden = panel.dataset.panel !== currentView || !permittedPanel;
  });
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('is-active', item.dataset.view === currentView));
  const firstName = currentUser?.name?.split(/\s+/)[0] || 'Doctor';
  const historyPatient = patientFor(historyPatientId);
  const headings = { dashboard: [`Welcome, ${firstName}`, 'Here’s what’s happening with your practice today.'], appointments: ['Appointments', 'Manage your schedule and visit status.'], patients: ['Patients', 'Your patient directory and recent details.'], 'patient-history': ['Patient history', historyPatient ? `Appointments and prescriptions for ${historyPatient.name}.` : 'Patient appointments and prescriptions.'], prescriptions: ['Prescriptions', 'Review and manage current medications.'], doctors: ['Doctor profiles', 'Create and manage doctor access for your practice.'] };
  if (!isDoctorPreview) byId('greeting').textContent = headings[currentView][0];
  byId('page-subtitle').textContent = isDoctorPreview
    ? currentView === 'patient-history' && historyPatient ? `Read-only appointments and prescriptions for ${historyPatient.name}.` : `Read-only patient records for ${viewedDoctor?.name || 'this doctor'}.`
    : headings[currentView][1];
  byId('date-eyebrow').textContent = isAdmin ? 'PRACTICE ADMINISTRATION' : currentView === 'dashboard' ? 'YOUR PRACTICE' : 'DOCTOR WORKSPACE';
}
async function showApp(user) {
  currentUser = user;
  previewDoctorId = null;
  currentView = user.role === 'superadmin' ? 'doctors' : 'patients';
  byId('login-screen').hidden = true;
  byId('setup-screen').hidden = true;
  byId('password-screen').hidden = true;
  byId('app-shell').hidden = false;
  byId('today-label').textContent = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  byId('account-name').textContent = user.name;
  byId('account-role').textContent = user.role === 'superadmin' ? 'Superadmin' : user.specialty || 'Doctor';
  const initials = user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  byId('account-initials').textContent = initials;
  byId('account-avatar').textContent = initials;
  byId('patient-storage-error').hidden = true;
  try {
    await loadPatients();
  } catch (error) {
    records.patients = [];
    saveRecords();
    byId('patient-storage-error').textContent = `Patient records could not be loaded from the server: ${error.message}`;
    byId('patient-storage-error').hidden = false;
  }
  render();
}
function showLogin() {
  byId('login-screen').hidden = false;
  byId('setup-screen').hidden = true;
  byId('password-screen').hidden = true;
  byId('app-shell').hidden = true;
  currentUser = null;
  previewDoctorId = null;
  byId('login-date').textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
}
function showPasswordChange(user) {
  currentUser = user;
  byId('login-screen').hidden = true;
  byId('setup-screen').hidden = true;
  byId('app-shell').hidden = true;
  byId('password-screen').hidden = false;
  byId('password-error').hidden = true;
  byId('new-password').focus();
}
function showSetup(userId) {
  byId('login-screen').hidden = true;
  byId('password-screen').hidden = true;
  byId('app-shell').hidden = true;
  byId('setup-screen').hidden = false;
  byId('setup-user-id').value = userId;
}
async function loadDoctors() {
  try {
    const { doctors } = await api('/api/admin/doctors');
    doctorProfilesById = new Map(doctors.map((doctor) => [doctor.id, doctor]));
    byId('doctor-rows').innerHTML = doctors.map((doctor) => `<tr><td><span class="doctor-row-actions"><button class="icon-button doctor-records-button" type="button" data-doctor-records="${escapeHtml(doctor.id)}" aria-label="View patient records for ${escapeHtml(doctor.name)}" title="View patient records">☰</button><button class="icon-button doctor-edit-button" type="button" data-edit-doctor="${escapeHtml(doctor.id)}" aria-label="Edit profile for ${escapeHtml(doctor.name)}" title="Edit profile">✎</button><button class="icon-button reset-password-button" type="button" data-reset-doctor="${escapeHtml(doctor.id)}" aria-label="Reset password for ${escapeHtml(doctor.name)}" title="Reset password">↻</button></span></td><td>${escapeHtml(doctor.name)}</td><td>${escapeHtml(doctor.id)}</td><td>${escapeHtml(doctor.address)}</td><td>${escapeHtml(doctor.packageName)}</td><td>${dateLabel(doctor.registerDate, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td>${dateLabel(doctor.lastRenewal, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td>${doctor.expiryDate ? dateLabel(doctor.expiryDate, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td>${escapeHtml(doctor.specialty)}</td><td>${escapeHtml(doctor.email)}</td><td>${doctor.mustChangePassword ? '<span class="badge badge--pending">Password change required</span>' : '<span class="badge badge--active">Active</span>'}</td></tr>`).join('');
    byId('doctors-empty').hidden = doctors.length > 0;
  } catch (error) {
    byId('doctor-rows').innerHTML = `<tr><td colspan="11">${escapeHtml(error.message)}</td></tr>`;
    byId('doctors-empty').hidden = true;
  }
}
function showTemporaryPassword(doctor, temporaryPassword, title = 'Doctor account created') {
  byId('modal-root').innerHTML = `<div class="modal-layer" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="temporary-title"><div class="modal-header"><div><p class="eyebrow">ONE-TIME CREDENTIAL</p><h2 id="temporary-title">${escapeHtml(title)}</h2></div><button class="modal-close" type="button" data-close-modal aria-label="Close dialog">×</button></div><p class="section-note">Share this temporary password securely. It will not be shown again, and the doctor must change it at next sign-in.</p><label class="credential-label">User ID<input readonly value="${escapeHtml(doctor.id)}" /></label><label class="credential-label">Temporary password<input readonly id="temporary-password" value="${escapeHtml(temporaryPassword)}" /></label><div class="modal-actions"><button class="button button--secondary" type="button" data-copy-temp>Copy password</button><button class="button button--primary" type="button" data-close-modal>Done</button></div></section></div>`;
}
function updatePrescriptionSaveState(form = byId('modal-root').querySelector('[data-form="prescription"]')) {
  if (!form || form.dataset.prescriptionEdit === 'true') return;
  const hasPatient = Boolean(form.querySelector('input[name="patientId"]')?.value);
  const hasMedication = Boolean(form.querySelector('#prescription-medication')?.value.trim());
  const hasDirections = Boolean(form.querySelector('#prescription-directions')?.value.trim());
  const hasAttachment = Boolean(form.querySelector('#prescription-files')?.files.length || form.querySelector('#prescription-camera')?.files.length);
  const saveButton = form.querySelector('[data-prescription-save]');
  if (saveButton) saveButton.disabled = !(hasPatient && hasMedication && hasDirections && hasAttachment);
}

function filterAppointmentPatients() {
  const search = byId('appointment-patient-search');
  const patientIdInput = byId('appointment-patient');
  const patientOptions = byId('appointment-patient-options');
  const createPatientButton = byId('create-patient-for-appointment');
  if (!search || !patientIdInput || !patientOptions || !createPatientButton) return;
  const query = search.value.trim().toLowerCase();
  const patients = currentUser?.role === 'doctor' ? doctorPatientsForCurrentUser() : records.patients;
  const matches = patients.filter((patient) => patient.name.toLowerCase().includes(query));
  const selectedPatient = patientFor(patientIdInput.value);
  if (selectedPatient && search.value !== selectedPatient.name) patientIdInput.value = '';
  patientOptions.innerHTML = matches.map((patient) => `<button class="appointment-patient-option" type="button" role="option" aria-selected="${patient.id === patientIdInput.value}" data-select-appointment-patient="${escapeHtml(patient.id)}">${escapeHtml(patient.name)}</button>`).join('');
  const showOptions = document.activeElement === search && matches.length > 0;
  patientOptions.hidden = !showOptions;
  search.setAttribute('aria-expanded', String(showOptions));
  createPatientButton.hidden = !query || matches.length > 0;
}

function calculateDoctorExpiry(packageName, lastRenewal) {
  const months = { '3 months': 3, '12 months': 12, '24 months': 24, '60 Months': 60 }[packageName];
  if (packageName === 'Lifetime' || months === undefined || !lastRenewal) return '';
  const [year, month, day] = lastRenewal.split('-').map(Number);
  const expiry = new Date(Date.UTC(year, month - 1, 1));
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  const monthEnd = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate();
  expiry.setUTCDate(Math.min(day, monthEnd));
  return expiry.toISOString().slice(0, 10);
}

function updateDoctorExpiry() {
  const expiryInput = byId('doctor-expiry-date');
  if (expiryInput) expiryInput.value = calculateDoctorExpiry(byId('doctor-package').value, byId('doctor-last-renewal').value);
}

function doctorProfileFields(profile = {}) {
  const registerDate = profile.registerDate || isoDate(today);
  const lastRenewal = profile.lastRenewal || registerDate;
  const packages = ['3 months', '12 months', '24 months', '60 Months', 'Lifetime'];
  return `<label for="doctor-address">Address</label><input id="doctor-address" name="address" value="${escapeHtml(profile.address || '')}" autocomplete="street-address" required /><label for="doctor-package">Package</label><select id="doctor-package" name="packageName" required>${packages.map((item) => `<option${(profile.packageName || '3 months') === item ? ' selected' : ''}>${item}</option>`).join('')}</select><label class="field-half" for="doctor-register-date">Register Date</label><label class="field-half" for="doctor-last-renewal">Last Renewal</label><input class="field-half" id="doctor-register-date" name="registerDate" type="date" value="${registerDate}" required /><input class="field-half" id="doctor-last-renewal" name="lastRenewal" type="date" value="${lastRenewal}" required /><label for="doctor-expiry-date">Expiry Date</label><input id="doctor-expiry-date" type="date" value="${escapeHtml(profile.expiryDate || calculateDoctorExpiry(profile.packageName || '3 months', lastRenewal))}" readonly aria-readonly="true" />`;
}

function openModal(type, context = {}) {
  const patients = (currentUser?.role === 'doctor' ? doctorPatientsForCurrentUser() : records.patients);
  const patientValues = context.patient || {};
  const patientIsEditing = type === 'patient' && Boolean(context.patientId);
  const patientGender = patientValues.gender || '';
  const appointmentValues = context.values || {};
  const selectedPatientId = context.patientId || appointmentValues.patientId || '';
  const selectedPatientName = patients.find((item) => item.id === selectedPatientId)?.name || '';
  const appointmentPatientOptions = patients.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === selectedPatientId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  const appointmentIsEditing = type === 'appointment' && Boolean(context.appointmentId);
  const appointmentPatientLocked = Boolean(context.lockPatient || context.returnToHistory);
  const minAppointmentDate = '';
  const appointmentStatuses = ['Pending', 'Confirmed', 'Checked in', 'Completed', 'Cancelled'];
  const appointmentPatientField = appointmentIsEditing
    ? `<label for="appointment-patient-search">Patient</label><input id="appointment-patient-search" type="text" value="${escapeHtml(selectedPatientName)}" readonly aria-readonly="true" /><input id="appointment-patient" name="patientId" type="hidden" value="${escapeHtml(selectedPatientId)}" />`
    : `<label for="appointment-patient-search">Patient</label><div class="appointment-patient-picker"><div class="appointment-patient-control">${appointmentPatientLocked ? `<input id="appointment-patient-search" type="text" value="${escapeHtml(selectedPatientName)}" readonly aria-readonly="true" /><input id="appointment-patient" name="patientId" type="hidden" value="${escapeHtml(selectedPatientId)}" />` : `<input id="appointment-patient-search" type="search" placeholder="Search or select a patient" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="appointment-patient-options" aria-expanded="false" value="${escapeHtml(selectedPatientName)}" required /><input id="appointment-patient" name="patientId" type="hidden" value="${escapeHtml(selectedPatientId)}" /><div class="appointment-patient-options" id="appointment-patient-options" role="listbox" aria-label="Patients" hidden></div>`}</div>${appointmentPatientLocked ? '' : '<button class="icon-button create-patient-button" type="button" id="create-patient-for-appointment" data-create-patient-for-appointment aria-label="Create new patient and continue booking" title="Create patient" hidden>＋</button>'}</div>`;
  const prescriptionValues = context.values || {};
  const prescriptionIsEditing = type === 'prescription' && Boolean(context.prescriptionId);
  const prescriptionAppointment = records.appointments.find((item) => item.id === (context.appointmentId || prescriptionValues.appointmentId));
  const prescriptionPatientField = `<label for="prescription-patient">Patient</label><input id="prescription-patient" type="text" value="${escapeHtml(selectedPatientName || 'Patient not selected')}" readonly aria-readonly="true" /><input type="hidden" name="patientId" value="${escapeHtml(selectedPatientId)}" />`;
  const prescriptionAppointmentLabel = prescriptionAppointment
    ? `${dateLabel(prescriptionAppointment.date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${escapeHtml(prescriptionAppointment.time)} · ${escapeHtml(prescriptionAppointment.type)}`
    : 'Not linked to an appointment';
  const prescriptionAppointmentId = context.appointmentId || prescriptionValues.appointmentId || '';
  const prescriptionAppointmentField = `<label for="prescription-appointment">Appointment</label><input id="prescription-appointment" type="text" value="${prescriptionAppointmentLabel}" readonly aria-readonly="true" /><input type="hidden" name="appointmentId" value="${escapeHtml(prescriptionAppointmentId)}" />`;
  const requiredMarker = '<span class="required-marker" aria-hidden="true">*</span>';
  const returnToHistoryField = context.returnToHistory ? '<input type="hidden" name="returnToHistory" value="true" />' : '';
  const prescriptionStatus = prescriptionValues.status || 'Active';
  const prescriptionStatuses = ['Active', 'Renewal due', 'Completed'];
  if (!prescriptionStatuses.includes(prescriptionStatus)) prescriptionStatuses.push(prescriptionStatus);
  const prescriptionFormFields = `${returnToHistoryField}${prescriptionIsEditing ? `<input type="hidden" name="prescriptionId" value="${escapeHtml(context.prescriptionId)}" />` : ''}${prescriptionPatientField}${prescriptionAppointmentField}<label for="prescription-medication">Medication ${prescriptionIsEditing ? '' : requiredMarker}</label><input id="prescription-medication" name="medication" value="${escapeHtml(prescriptionValues.medication || '')}" required /><label for="prescription-directions">Directions ${prescriptionIsEditing ? '' : requiredMarker}</label><input id="prescription-directions" name="directions" value="${escapeHtml(prescriptionValues.directions || '')}" placeholder="e.g. 10 mg · Once daily" required /><span class="form-label">Attachments ${prescriptionIsEditing ? '' : requiredMarker}</span><div class="attachment-picker"><button class="button button--secondary" type="button" data-upload-target="prescription-files">Upload file</button><button class="button button--secondary" type="button" data-upload-target="prescription-camera">Take photo</button><input id="prescription-files" type="file" accept="image/*,application/pdf" multiple hidden /><input id="prescription-camera" type="file" accept="image/*" capture="environment" multiple hidden /></div><p class="selected-files" id="selected-prescription-files" aria-live="polite">${prescriptionIsEditing && prescriptionValues.attachments?.length ? 'Existing attachments will be kept.' : 'No files selected'}</p><label class="field-half" for="prescription-refills">Refills</label><label class="field-half" for="prescription-expires">Review date</label><input class="field-half" id="prescription-refills" name="refills" type="number" min="0" max="12" value="${escapeHtml(prescriptionValues.refills ?? 0)}" required /><input class="field-half" id="prescription-expires" name="expires" type="date" value="${escapeHtml(prescriptionValues.expires || addDays(30))}" required /><label for="prescription-status">Status</label><select id="prescription-status" name="status">${prescriptionStatuses.map((status) => `<option${prescriptionStatus === status ? ' selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select><label for="prescription-notes">Notes <span class="table-subtext">Optional</span></label><textarea id="prescription-notes" name="notes" rows="3">${escapeHtml(prescriptionValues.notes || '')}</textarea>`;
  const forms = {
    appointment: ['SCHEDULE', appointmentIsEditing ? 'Edit appointment' : 'New appointment', `${returnToHistoryField}${appointmentIsEditing ? `<input type="hidden" name="appointmentId" value="${escapeHtml(context.appointmentId)}" />` : ''}${appointmentPatientField}${appointmentIsEditing ? `<label for="appointment-date">Appointment date</label><input id="appointment-date" name="date" type="date" value="${escapeHtml(appointmentValues.date)}" readonly aria-readonly="true" /><label for="appointment-type">Visit type</label><select id="appointment-type" name="type"><option${appointmentValues.type === 'Consultation' ? ' selected' : ''}>Consultation</option><option${appointmentValues.type === 'Follow-up' ? ' selected' : ''}>Follow-up</option><option${appointmentValues.type === 'Annual check-up' ? ' selected' : ''}>Annual check-up</option><option${appointmentValues.type === 'Medication review' ? ' selected' : ''}>Medication review</option></select><label for="appointment-time">Time</label><input id="appointment-time" name="time" type="time" value="${escapeHtml(appointmentValues.time || '09:00')}" required /><label for="appointment-status">Status</label><select id="appointment-status" name="status">${appointmentStatuses.map((status) => `<option${(appointmentValues.status || 'Confirmed') === status ? ' selected' : ''}>${status}</option>`).join('')}</select>` : `<label for="appointment-type">Visit type</label><select id="appointment-type" name="type"><option${appointmentValues.type === 'Consultation' || !appointmentValues.type ? ' selected' : ''}>Consultation</option><option${appointmentValues.type === 'Follow-up' ? ' selected' : ''}>Follow-up</option><option${appointmentValues.type === 'Annual check-up' ? ' selected' : ''}>Annual check-up</option><option${appointmentValues.type === 'Medication review' ? ' selected' : ''}>Medication review</option></select><label class="field-half" for="appointment-date">Date</label><label class="field-half" for="appointment-time">Time</label><input class="field-half" id="appointment-date" name="date" type="date" value="${escapeHtml(appointmentValues.date || isoDate(today))}"${minAppointmentDate ? ` min="${minAppointmentDate}"` : ''} required /><input class="field-half" id="appointment-time" name="time" type="time" value="${escapeHtml(appointmentValues.time || '09:00')}" required /><label for="appointment-room">Room</label><select id="appointment-room" name="room"><option${appointmentValues.room === 'Room 01' || !appointmentValues.room ? ' selected' : ''}>Room 01</option><option${appointmentValues.room === 'Room 02' ? ' selected' : ''}>Room 02</option><option${appointmentValues.room === 'Room 03' ? ' selected' : ''}>Room 03</option></select>`}`],
    patient: ['DIRECTORY', patientIsEditing ? 'Edit patient' : 'Add patient', `${patientIsEditing ? `<input type="hidden" name="patientId" value="${escapeHtml(context.patientId)}" />` : ''}<label for="patient-name">Full name ${requiredMarker}</label><input id="patient-name" name="name" autocomplete="name" maxlength="120" value="${escapeHtml(patientValues.name || '')}" required /><label for="patient-gender">Gender ${requiredMarker}</label><select id="patient-gender" name="gender" required><option value=""${patientGender ? '' : ' selected'} disabled>Select gender</option><option${patientGender === 'Male' ? ' selected' : ''}>Male</option><option${patientGender === 'Female' ? ' selected' : ''}>Female</option></select><label for="patient-age">Age ${requiredMarker}</label><input id="patient-age" name="age" type="number" min="0" max="130" step="1" value="${escapeHtml(patientValues.age ?? '')}" required /><label for="patient-phone">Phone</label><input id="patient-phone" name="phone" type="tel" autocomplete="tel" value="${escapeHtml(patientValues.phone || '')}" /><label for="patient-address">Address/Locality</label><input id="patient-address" name="address" autocomplete="street-address" value="${escapeHtml(patientValues.address || '')}" /><label for="patient-email">Email</label><input id="patient-email" name="email" type="email" autocomplete="email" value="${escapeHtml(patientValues.email || '')}" /><label for="patient-birth">Date of birth</label><input id="patient-birth" name="birthDate" type="date" value="${escapeHtml(patientValues.birthDate || '')}" />`],
    prescription: ['MEDICATION MANAGEMENT', prescriptionIsEditing ? 'Edit prescription' : 'New prescription', `${returnToHistoryField}${prescriptionIsEditing ? `<input type="hidden" name="prescriptionId" value="${escapeHtml(context.prescriptionId)}" />` : ''}${prescriptionPatientField}${prescriptionAppointmentField}<label for="prescription-medication">Medication</label><input id="prescription-medication" name="medication" value="${escapeHtml(prescriptionValues.medication || '')}" required /><label for="prescription-directions">Directions</label><input id="prescription-directions" name="directions" value="${escapeHtml(prescriptionValues.directions || '')}" placeholder="e.g. 10 mg · Once daily" required /><span class="form-label">Attachments</span><div class="attachment-picker"><button class="button button--secondary" type="button" data-upload-target="prescription-files">Upload file</button><button class="button button--secondary" type="button" data-upload-target="prescription-camera">Take photo</button><input id="prescription-files" type="file" accept="image/*,application/pdf" multiple hidden /><input id="prescription-camera" type="file" accept="image/*" capture="environment" multiple hidden /></div><p class="selected-files" id="selected-prescription-files" aria-live="polite">${prescriptionIsEditing && prescriptionValues.attachments?.length ? 'Existing attachments will be kept.' : 'No files selected'}</p><label class="field-half" for="prescription-refills">Refills</label><label class="field-half" for="prescription-expires">Review date</label><input class="field-half" id="prescription-refills" name="refills" type="number" min="0" max="12" value="${escapeHtml(prescriptionValues.refills ?? 0)}" required /><input class="field-half" id="prescription-expires" name="expires" type="date" value="${escapeHtml(prescriptionValues.expires || addDays(30))}" required /><label for="prescription-status">Status</label><select id="prescription-status" name="status">${prescriptionStatuses.map((status) => `<option${prescriptionStatus === status ? ' selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select><label for="prescription-notes">Notes <span class="table-subtext">Optional</span></label><textarea id="prescription-notes" name="notes" rows="3">${escapeHtml(prescriptionValues.notes || '')}</textarea>`],
    doctor: ['PRACTICE ACCESS', 'Create doctor profile', `<label for="doctor-name">Doctor name</label><input id="doctor-name" name="name" autocomplete="name" required /><label for="doctor-user-id">User ID</label><input id="doctor-user-id" name="userId" autocomplete="off" minlength="3" maxlength="32" required /><label for="doctor-specialty">Specialty</label><input id="doctor-specialty" name="specialty" required /><label for="doctor-email">Work email</label><input id="doctor-email" name="email" type="email" autocomplete="email" required />${doctorProfileFields()}`],
    doctorEdit: ['PRACTICE ACCESS', 'Edit doctor profile', `<input type="hidden" name="userId" value="${escapeHtml(context.id)}" /><p class="doctor-edit-identity"><strong>${escapeHtml(context.name)}</strong><span>User ID · ${escapeHtml(context.id)}</span></p>${doctorProfileFields(context)}`],
  };
  forms.prescription[2] = prescriptionFormFields;
  const [eyebrow, title, fields] = forms[type];
  const patientFormAction = type === 'patient' && context.continueAppointment;
  const saveLabel = patientFormAction ? 'Create & continue booking' : patientIsEditing ? 'Save patient' : appointmentIsEditing ? 'Save appointment' : prescriptionIsEditing ? 'Save prescription' : `Save ${type}`;
  clearModal();
  byId('modal-root').innerHTML = `<div class="modal-layer" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><p class="eyebrow">${eyebrow}</p><h2 id="modal-title">${patientFormAction ? 'Add patient & book appointment' : title}</h2></div><button class="modal-close" type="button" data-close-modal aria-label="Close dialog">×</button></div><form class="modal-form" data-form="${type}"${appointmentIsEditing ? ' data-appointment-edit="true"' : ''}${prescriptionIsEditing ? ' data-prescription-edit="true"' : ''}${patientIsEditing ? ' data-patient-edit="true"' : ''}${patientFormAction ? ' data-continue-appointment="true"' : ''}>${fields}<div class="modal-actions"><button class="button button--secondary" type="button" data-close-modal>Cancel</button><button class="button button--primary" type="submit"${type === 'prescription' && !prescriptionIsEditing ? ' data-prescription-save disabled' : ''}${patientIsEditing ? ' data-patient-save disabled' : ''}>${saveLabel}</button></div></form></section></div>`;
  if (type === 'prescription') updatePrescriptionSaveState();
  if (patientIsEditing) {
    const form = byId('modal-root').querySelector('[data-form="patient"]');
    const saveButton = form.querySelector('[data-patient-save]');
    const originalValues = JSON.stringify(Object.fromEntries([...new FormData(form)].filter(([name]) => name !== 'patientId')));
    const updateSaveButton = () => {
      const currentValues = JSON.stringify(Object.fromEntries([...new FormData(form)].filter(([name]) => name !== 'patientId')));
      saveButton.disabled = currentValues === originalValues;
    };
    form.addEventListener('input', updateSaveButton);
    form.addEventListener('change', updateSaveButton);
  }
  if (type === 'appointment') {
    const patientSearch = byId('appointment-patient-search');
    patientSearch.addEventListener('focus', filterAppointmentPatients);
    patientSearch.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        byId('appointment-patient-options').querySelector('button')?.focus();
      } else if (event.key === 'Enter' && !byId('appointment-patient').value) {
        const firstOption = byId('appointment-patient-options').querySelector('[data-select-appointment-patient]');
        if (firstOption) {
          event.preventDefault();
          firstOption.click();
        }
      }
    });
    filterAppointmentPatients();
  }
  if (type === 'doctor' || type === 'doctorEdit') updateDoctorExpiry();
  byId('modal-root').querySelector('input:not([type="hidden"]), select')?.focus();
}
document.addEventListener('click', async (event) => {
  const target = event.target.closest('button, [data-close-modal]'); if (!target) return;
  if (target.dataset.view) {
    currentView = target.dataset.view;
    if (currentView === 'doctors') previewDoctorId = null;
    render();
  }
  if (target.id === 'return-to-doctors') {
    previewDoctorId = null;
    currentView = 'doctors';
    render();
  }
  if (target.id === 'return-to-patients') {
    historyPatientId = null;
    currentView = 'patients';
    render();
  }
  if (target.dataset.patientMode) { patientDisplayMode = target.dataset.patientMode; renderPatients(); }
  if (target.dataset.patientHistory) showPatientHistory(target.dataset.patientHistory);
  if (target.dataset.editPatient && currentUser?.role === 'doctor') {
    const patient = records.patients.find((item) => item.id === target.dataset.editPatient && item.persisted && item.doctorId === currentUser.id);
    if (patient) openModal('patient', { patientId: patient.id, patient });
    else window.alert('This is demo patient data and cannot be edited. Add a patient to save an editable record to the database.');
  }
  if (target.dataset.bookAppointment) openModal('appointment', { patientId: target.dataset.bookAppointment });
  if (target.dataset.editAppointment) {
    const appointment = records.appointments.find((item) => item.id === target.dataset.editAppointment);
    if (appointment && isDoctorRecord(appointment)) openModal('appointment', { appointmentId: appointment.id, patientId: appointment.patientId, values: appointment, returnToHistory: currentView === 'patient-history' });
  }
  if (target.dataset.addAppointmentPrescription) {
    const appointment = records.appointments.find((item) => item.id === target.dataset.addAppointmentPrescription);
    if (appointment && isDoctorRecord(appointment)) openModal('prescription', { patientId: appointment.patientId, appointmentId: appointment.id, returnToHistory: currentView === 'patient-history' });
  }
  if (target.dataset.selectAppointmentPatient) {
    const patient = patientFor(target.dataset.selectAppointmentPatient);
    if (patient) {
      byId('appointment-patient').value = patient.id;
      const patientSearch = byId('appointment-patient-search');
      patientSearch.value = patient.name;
      patientSearch.setCustomValidity('');
      filterAppointmentPatients();
    }
  }
  if (target.hasAttribute('data-create-patient-for-appointment')) {
    const appointmentForm = byId('modal-root').querySelector('[data-form="appointment"]');
    pendingAppointmentDraft = appointmentForm ? Object.fromEntries(new FormData(appointmentForm).entries()) : null;
    openModal('patient', { continueAppointment: true });
  }
  if (target.dataset.doctorRecords) {
    previewDoctorId = target.dataset.doctorRecords;
    currentView = 'patients';
    render();
  }
  if (target.dataset.editDoctor) openModal('doctorEdit', doctorProfilesById.get(target.dataset.editDoctor));
  if (target.dataset.viewPrescription) {
    try { await viewPrescriptionFile(target.dataset.viewPrescription); }
    catch (error) { window.alert(error.message); }
  }
  if (target.dataset.editPrescription) {
    const prescription = records.prescriptions.find((item) => item.id === target.dataset.editPrescription);
    if (prescription && isDoctorRecord(prescription)) {
      openModal('prescription', {
        prescriptionId: prescription.id,
        patientId: prescription.patientId,
        appointmentId: prescription.appointmentId,
        values: prescription,
        returnToHistory: currentView === 'patient-history',
      });
    }
  }
  if (target.dataset.previewAttachment) {
    try { await showAttachmentPreview(target.dataset.previewAttachment); }
    catch (error) { window.alert(error.message); }
  }
  if (target.dataset.deleteAttachment && currentUser?.role === 'doctor') {
    const attachmentId = target.dataset.deleteAttachment;
    const prescription = records.prescriptions.find((item) => item.attachments?.some((file) => file.id === attachmentId));
    if (!prescription || !isDoctorRecord(prescription)) {
      window.alert('This prescription file is no longer available to delete.');
    } else if (window.confirm('Delete this prescription file?')) {
      try {
        await deleteAttachment(attachmentId);
        prescription.attachments = prescription.attachments.filter((file) => file.id !== attachmentId);
        saveRecords();
        await showPrescriptionAttachments(prescription.id);
      } catch (error) {
        window.alert(error.message);
      }
    }
  }
  if (target.dataset.uploadTarget) byId(target.dataset.uploadTarget).click();
  if (target.dataset.prescriptionAttachments) {
    try { await showPrescriptionAttachments(target.dataset.prescriptionAttachments); }
    catch (error) { window.alert(error.message); }
  }
  if (target.id === 'logout-button' || target.id === 'logout-icon') {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  }
  if (target.dataset.action) {
    const action = target.dataset.action.replace('new-', '');
    if (action === 'appointment' && currentView === 'patient-history' && historyPatientId) {
      openModal('appointment', { patientId: historyPatientId, lockPatient: true, returnToHistory: true });
    } else {
      openModal(action);
    }
  }
  if (target.dataset.resetDoctor) {
    if (!window.confirm(`Reset the password for ${target.getAttribute('aria-label')?.replace(/^Reset password for /, '')}? The doctor will be signed out.`)) return;
    try {
      const result = await api(`/api/admin/doctors/${encodeURIComponent(target.dataset.resetDoctor)}/reset-password`, { method: 'POST' });
      showTemporaryPassword(result.doctor, result.temporaryPassword, 'Doctor password reset');
      loadDoctors();
    } catch (error) {
      document.querySelector('.admin-note').textContent = error.message;
    }
  }
  if (target.hasAttribute('data-copy-temp')) {
    await navigator.clipboard.writeText(byId('temporary-password').value);
    target.textContent = 'Copied';
  }
  if (target.hasAttribute('data-close-modal') && (target === event.target || target.matches('button'))) {
    if (byId('modal-root').querySelector('[data-continue-appointment]')) pendingAppointmentDraft = null;
    clearModal();
  }
  if (target.dataset.deleteAppointment && window.confirm('Delete this appointment?')) { records.appointments = records.appointments.filter((item) => item.id !== target.dataset.deleteAppointment); saveRecords(); render(); }
  if (target.dataset.deletePrescription && window.confirm('Delete this prescription?')) { const prescription = records.prescriptions.find((item) => item.id === target.dataset.deletePrescription); for (const attachment of prescription?.attachments || []) await deleteAttachment(attachment.id).catch(() => {}); records.prescriptions = records.prescriptions.filter((item) => item.id !== target.dataset.deletePrescription); saveRecords(); render(); }
});
document.addEventListener('submit', async (event) => {
  if (event.target.id === 'login-form') {
    event.preventDefault();
    const loginError = byId('login-error');
    loginError.hidden = true;
    const data = Object.fromEntries(new FormData(event.target).entries());
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
      if (user.mustChangePassword) showPasswordChange(user);
      else await showApp(user);
    } catch (error) {
      loginError.textContent = error.message;
      loginError.hidden = false;
    }
    return;
  }
  if (event.target.id === 'password-form') {
    event.preventDefault();
    const passwordError = byId('password-error');
    passwordError.hidden = true;
    const data = Object.fromEntries(new FormData(event.target).entries());
    try {
      const { user } = await api('/api/auth/password', { method: 'POST', body: JSON.stringify(data) });
      await showApp(user);
    } catch (error) {
      passwordError.textContent = error.message;
      passwordError.hidden = false;
    }
    return;
  }
  if (event.target.id === 'setup-form') {
    event.preventDefault();
    const setupError = byId('setup-error');
    setupError.hidden = true;
    const data = Object.fromEntries(new FormData(event.target).entries());
    try {
      const { user } = await api('/api/setup', { method: 'POST', body: JSON.stringify(data) });
      await showApp(user);
    } catch (error) {
      setupError.textContent = error.message;
      setupError.hidden = false;
    }
    return;
  }
  const form = event.target.closest('[data-form]'); if (!form) return; event.preventDefault(); const data = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.form === 'appointment' && !data.patientId) {
    const patientSearch = byId('appointment-patient-search');
    patientSearch.setCustomValidity('Select a patient from the list.');
    patientSearch.reportValidity();
    return;
  }
  if (form.dataset.form === 'appointment') {
    if (form.dataset.appointmentEdit === 'true' && !data.appointmentId) {
      const errorElement = document.createElement('p');
      errorElement.className = 'login-error';
      errorElement.setAttribute('role', 'alert');
      errorElement.textContent = 'The appointment could not be identified for editing. Close this form and reopen the appointment.';
      form.prepend(errorElement);
      return;
    }
    if (form.dataset.appointmentEdit !== 'true') {
      const duplicateAppointment = records.appointments.find((item) => item.patientId === data.patientId && item.date === data.date);
      if (duplicateAppointment) {
        const errorElement = document.createElement('p');
        errorElement.className = 'login-error';
        errorElement.setAttribute('role', 'alert');
        errorElement.textContent = 'This patient already has an appointment on that date.';
        form.prepend(errorElement);
        return;
      }
    }
  }
  if (form.dataset.form === 'prescription' && form.dataset.prescriptionEdit !== 'true') {
    const hasAttachment = Boolean(form.querySelector('#prescription-files').files.length || form.querySelector('#prescription-camera').files.length);
    if (!data.patientId || !data.medication.trim() || !data.directions.trim() || !hasAttachment) {
      const errorElement = document.createElement('p');
      errorElement.className = 'login-error';
      errorElement.setAttribute('role', 'alert');
      errorElement.textContent = !data.patientId
        ? 'Open Add Prescription from a patient appointment.'
        : 'Enter Medication and Directions and attach at least one file before saving.';
      form.prepend(errorElement);
      updatePrescriptionSaveState(form);
      return;
    }
  }
  if (form.dataset.form === 'doctor' || form.dataset.form === 'doctorEdit') {
    try {
      if (form.dataset.form === 'doctorEdit') {
        await api(`/api/admin/doctors/${encodeURIComponent(doctorProfilesById.get(data.userId)?.id || '')}/profile`, { method: 'PUT', body: JSON.stringify(data) });
        clearModal();
      } else {
        const result = await api('/api/admin/doctors', { method: 'POST', body: JSON.stringify(data) });
        showTemporaryPassword(result.doctor, result.temporaryPassword);
      }
      loadDoctors();
    } catch (error) {
      const errorElement = document.createElement('p');
      errorElement.className = 'login-error';
      errorElement.setAttribute('role', 'alert');
      errorElement.textContent = error.message;
      form.prepend(errorElement);
    }
    return;
  }
  if (form.dataset.form === 'appointment') {
    const appointmentId = data.appointmentId;
    if (form.dataset.appointmentEdit === 'true') {
      const appointment = records.appointments.find((item) => item.id === appointmentId);
      if (!appointment || !isDoctorRecord(appointment)) {
        const errorElement = document.createElement('p');
        errorElement.className = 'login-error';
        errorElement.setAttribute('role', 'alert');
        errorElement.textContent = 'This appointment is no longer available to edit.';
        form.prepend(errorElement);
        return;
      }
      appointment.type = data.type;
      appointment.time = data.time;
      appointment.status = data.status;
    } else {
      records.appointments.push({ id: `ap-${Date.now()}`, ...data, status: 'Confirmed', doctorId: currentUser?.id || null });
    }
    if (data.returnToHistory === 'true') {
      historyPatientId = data.patientId;
      currentView = 'patient-history';
    } else {
      currentView = 'patients';
    }
  }
  if (form.dataset.form === 'patient') {
    let patient;
    try {
      if (form.dataset.patientEdit === 'true') {
        const existing = records.patients.find((item) => item.id === data.patientId && item.persisted && item.doctorId === currentUser?.id);
        if (!existing) throw new Error('This patient is no longer available to edit.');
        ({ patient } = await api(`/api/patients/${encodeURIComponent(data.patientId)}`, { method: 'PUT', body: JSON.stringify(data) }));
        Object.assign(existing, patient);
      } else {
        ({ patient } = await api('/api/patients', { method: 'POST', body: JSON.stringify(data) }));
        records.patients.push(patient);
      }
    } catch (error) {
      const errorElement = document.createElement('p');
      errorElement.className = 'login-error';
      errorElement.setAttribute('role', 'alert');
      errorElement.textContent = error.message;
      form.prepend(errorElement);
      return;
    }
    byId('patient-storage-error').hidden = true;
    if (form.dataset.continueAppointment === 'true') {
      const appointmentValues = pendingAppointmentDraft || {};
      pendingAppointmentDraft = null;
      openModal('appointment', { patientId: patient.id, values: appointmentValues });
      return;
    }
    currentView = 'patients';
  }
  if (form.dataset.form === 'prescription') {
    const prescriptionId = data.prescriptionId || `rx-${Date.now()}`;
    const selectedFiles = [...form.querySelector('#prescription-files').files, ...form.querySelector('#prescription-camera').files];
    try {
      const existingPrescription = data.prescriptionId
        ? records.prescriptions.find((item) => item.id === data.prescriptionId && isDoctorRecord(item))
        : null;
      if (data.prescriptionId && !existingPrescription) {
        const errorElement = document.createElement('p');
        errorElement.className = 'login-error';
        errorElement.setAttribute('role', 'alert');
        errorElement.textContent = 'This prescription is no longer available to edit.';
        form.prepend(errorElement);
        return;
      }
      const newAttachments = selectedFiles.length ? await storePrescriptionFiles(prescriptionId, selectedFiles) : [];
      const prescriptionData = {
        patientId: data.patientId,
        appointmentId: data.appointmentId,
        medication: data.medication,
        directions: data.directions,
        refills: Number(data.refills),
        expires: data.expires,
        notes: data.notes,
        status: data.status || 'Active',
        attachments: [...(existingPrescription?.attachments || []), ...newAttachments],
        doctorId: existingPrescription?.doctorId || currentUser?.id || null,
      };
      if (existingPrescription) Object.assign(existingPrescription, prescriptionData);
      else records.prescriptions.push({ id: prescriptionId, ...prescriptionData });
      if (data.returnToHistory === 'true') {
        historyPatientId = data.patientId;
        currentView = 'patient-history';
      } else {
        currentView = 'prescriptions';
      }
    } catch (error) {
      const errorElement = document.createElement('p');
      errorElement.className = 'login-error';
      errorElement.setAttribute('role', 'alert');
      errorElement.textContent = error.message;
      form.prepend(errorElement);
      return;
    }
  }
  saveRecords(); clearModal(); render();
});
document.addEventListener('change', (event) => {
  if (event.target.matches('[data-status-id]')) { const appointment = records.appointments.find((item) => item.id === event.target.dataset.statusId); if (appointment) appointment.status = event.target.value; saveRecords(); render(); }
  if (event.target.id === 'appointment-filter') { appointmentFilter = event.target.value; renderAppointments(); }
  if (event.target.id === 'appointment-patient') {
    const patient = patientFor(event.target.value);
    if (patient) byId('appointment-patient-search').value = patient.name;
  }
  if (event.target.id === 'prescription-files' || event.target.id === 'prescription-camera') {
    const files = [...byId('prescription-files').files, ...byId('prescription-camera').files];
    byId('selected-prescription-files').textContent = files.length ? files.map((file) => file.name).join(', ') : 'No files selected';
    updatePrescriptionSaveState();
  }
});
byId('global-search').addEventListener('input', (event) => { query = event.target.value.trim().toLowerCase(); renderAppointments(); renderPatients(); renderPrescriptions(); });
byId('patient-search').addEventListener('input', (event) => { patientSearch = event.target.value.trim().toLowerCase(); renderPatients(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') clearModal(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); byId('global-search').focus(); } });
document.addEventListener('input', (event) => {
  if (event.target.id === 'history-medication-search') filterPatientHistoryMedications();
  if (event.target.id === 'prescription-medication' || event.target.id === 'prescription-directions') updatePrescriptionSaveState();
  if (event.target.id === 'appointment-patient-search') {
    event.target.setCustomValidity('');
    filterAppointmentPatients();
  }
  if (event.target.id === 'appointment-date') event.target.setCustomValidity('');
  if (event.target.id === 'doctor-package' || event.target.id === 'doctor-last-renewal') updateDoctorExpiry();
});
document.addEventListener('focusout', (event) => {
  if (event.target.id === 'appointment-patient-search') {
    window.setTimeout(() => {
      if (!byId('appointment-patient-options')?.contains(document.activeElement)) filterAppointmentPatients();
    }, 0);
  }
});
api('/api/setup/status').then(({ required, userId }) => {
  if (required) return showSetup(userId);
  return api('/api/auth/me').then(({ user }) => {
    if (user.mustChangePassword) showPasswordChange(user);
    else showApp(user);
  }).catch(showLogin);
}).catch(showLogin);