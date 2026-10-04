import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';

const siteDirectory = fileURLToPath(new URL('..', import.meta.url));
const hasTestDatabaseConfig = Boolean(process.env.MARIADB_TEST_DATABASE && process.env.MARIADB_TEST_USER);

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitUntilReady(child, baseUrl) {
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Auth server exited early: ${output}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch { /* Wait for the listener to start. */ }
    await delay(100);
  }
  child.kill();
  throw new Error(`Auth server did not start: ${output}`);
}

async function api(baseUrl, path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  return { response, result, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

test('user is locked out after 3 consecutive failed login attempts', { skip: !hasTestDatabaseConfig }, async (context) => {
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const superadminPassword = randomBytes(28).toString('base64url');
  const tablePrefix = `test_${randomBytes(8).toString('hex')}`;
  const databaseOptions = {
    host: process.env.MARIADB_TEST_HOST || '127.0.0.1',
    port: Number(process.env.MARIADB_TEST_PORT || 3306),
    database: process.env.MARIADB_TEST_DATABASE,
    user: process.env.MARIADB_TEST_USER,
    password: process.env.MARIADB_TEST_PASSWORD || '',
    connectionLimit: 2,
  };
  const pool = mariadb.createPool(databaseOptions);
  const child = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server.mjs'], {
    cwd: siteDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: databaseOptions.host,
      DB_PORT: String(databaseOptions.port),
      DB_NAME: databaseOptions.database,
      DB_USER: databaseOptions.user,
      DB_PASSWORD: databaseOptions.password,
      DB_TABLE_PREFIX: tablePrefix,
      SUPERADMIN_PASSWORD: superadminPassword,
      PORT: String(port),
      SERVER_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(async () => {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
      });
    }
    await pool.query(`DROP TABLE IF EXISTS \
      \`${tablePrefix}_prescription_attachments\`\n    `);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_prescriptions\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_appointments\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_patients\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_doctors\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_sessions\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_users\``);
    await pool.end();
  });
  await waitUntilReady(child, baseUrl);

  for (let index = 0; index < 3; index += 1) {
    const failed = await api(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { userId: 'maniksar', password: 'wrong-password' },
    });
    assert.equal(failed.response.status, 401);
  }

  const blocked = await api(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { userId: 'maniksar', password: superadminPassword },
  });
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.result.error, 'Too many sign-in attempts. Try again later.');
});

test('superadmin provisions doctors who must change temporary passwords', { skip: !hasTestDatabaseConfig }, async (context) => {
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const superadminPassword = randomBytes(28).toString('base64url');
  const tablePrefix = `test_${randomBytes(8).toString('hex')}`;
  const databaseOptions = {
    host: process.env.MARIADB_TEST_HOST || '127.0.0.1',
    port: Number(process.env.MARIADB_TEST_PORT || 3306),
    database: process.env.MARIADB_TEST_DATABASE,
    user: process.env.MARIADB_TEST_USER,
    password: process.env.MARIADB_TEST_PASSWORD || '',
    connectionLimit: 2,
  };
  const pool = mariadb.createPool(databaseOptions);
  const child = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server.mjs'], {
    cwd: siteDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: databaseOptions.host,
      DB_PORT: String(databaseOptions.port),
      DB_NAME: databaseOptions.database,
      DB_USER: databaseOptions.user,
      DB_PASSWORD: databaseOptions.password,
      DB_TABLE_PREFIX: tablePrefix,
      SUPERADMIN_PASSWORD: '',
      PORT: String(port),
      SERVER_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(async () => {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
      });
    }
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_prescription_attachments\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_prescriptions\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_appointments\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_patients\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_doctors\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_sessions\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_users\``);
    await pool.end();
  });
  await waitUntilReady(child, baseUrl);

  const setupStatus = await api(baseUrl, '/api/setup/status');
  assert.equal(setupStatus.response.status, 200);
  assert.equal(setupStatus.result.required, true);
  assert.equal(setupStatus.result.userId, 'maniksar');

  const invalidSetup = await api(baseUrl, '/api/setup', {
    method: 'POST',
    body: { password: superadminPassword, confirmPassword: 'a different password' },
  });
  assert.equal(invalidSetup.response.status, 400);

  const setup = await api(baseUrl, '/api/setup', {
    method: 'POST',
    body: { password: superadminPassword, confirmPassword: superadminPassword },
  });
  assert.equal(setup.response.status, 201);
  assert.equal(setup.result.user.role, 'superadmin');
  assert.equal(setup.result.user.id, 'maniksar');
  const adminCookie = setup.cookie;

  const completedSetup = await api(baseUrl, '/api/setup/status');
  assert.equal(completedSetup.result.required, false);
  const repeatedSetup = await api(baseUrl, '/api/setup', {
    method: 'POST',
    body: { password: superadminPassword, confirmPassword: superadminPassword },
  });
  assert.equal(repeatedSetup.response.status, 409);

  const createdDoctor = await api(baseUrl, '/api/admin/doctors', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      userId: 'doctor-ava', name: 'Ava Patel', email: 'ava@example.test', specialty: 'Family medicine',
      address: '14 Example Street', packageName: '3 months', registerDate: '2026-01-31', lastRenewal: '2026-01-31',
    },
  });
  assert.equal(createdDoctor.response.status, 201);
  assert.equal(createdDoctor.result.doctor.id, 'doctor-ava');
  assert.equal(typeof createdDoctor.result.temporaryPassword, 'string');

  const temporaryLogin = await api(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { userId: 'doctor-ava', password: createdDoctor.result.temporaryPassword },
  });
  assert.equal(temporaryLogin.response.status, 200);
  assert.equal(temporaryLogin.result.user.mustChangePassword, true);

  const adminList = await api(baseUrl, '/api/admin/doctors', { cookie: adminCookie });
  assert.equal(adminList.response.status, 200);
  assert.equal(adminList.result.doctors[0].mustChangePassword, true);
  assert.equal(adminList.result.doctors[0].expiryDate, '2026-04-30');

  const updatedProfile = await api(baseUrl, '/api/admin/doctors/doctor-ava/profile', {
    method: 'PUT',
    cookie: adminCookie,
    body: { address: '22 Renewal Road', packageName: 'Lifetime', registerDate: '2026-01-31', lastRenewal: '2026-10-01' },
  });
  assert.equal(updatedProfile.response.status, 200);
  assert.equal(updatedProfile.result.doctor.address, '22 Renewal Road');
  assert.equal(updatedProfile.result.doctor.packageName, 'Lifetime');
  assert.equal(updatedProfile.result.doctor.expiryDate, '');

  const reset = await api(baseUrl, '/api/auth/password', {
    method: 'POST',
    cookie: temporaryLogin.cookie,
    body: { password: 'a changed and private password', confirmPassword: 'a changed and private password' },
  });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.result.user.mustChangePassword, false);

  const oldPasswordLogin = await api(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { userId: 'doctor-ava', password: createdDoctor.result.temporaryPassword },
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const doctorAccess = await api(baseUrl, '/api/admin/doctors', { cookie: temporaryLogin.cookie });
  assert.equal(doctorAccess.response.status, 403);
  const doctorLogin = await api(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { userId: 'doctor-ava', password: 'a changed and private password' },
  });
  assert.equal(doctorLogin.response.status, 200);
  assert.equal(doctorLogin.result.user.mustChangePassword, false);

  const patientInput = {
    name: 'Jamie Example', gender: 'Female', age: '34', address: '45 Sample Lane',
    email: 'jamie@example.test', phone: '555-0123', birthDate: '1992-04-05',
  };
  const createdPatient = await api(baseUrl, '/api/patients', {
    method: 'POST',
    cookie: doctorLogin.cookie,
    body: patientInput,
  });
  assert.equal(createdPatient.response.status, 201);
  assert.equal(createdPatient.result.patient.name, patientInput.name);
  assert.equal(createdPatient.result.patient.gender, patientInput.gender);
  assert.equal(createdPatient.result.patient.age, 34);
  assert.equal(createdPatient.result.patient.doctorId, 'doctor-ava');
  assert.equal(typeof createdPatient.result.patient.id, 'string');

  const updatedPatient = await api(baseUrl, `/api/patients/${encodeURIComponent(createdPatient.result.patient.id)}`, {
    method: 'PUT',
    cookie: doctorLogin.cookie,
    body: { ...patientInput, name: 'Jamie Updated', gender: 'Male', age: '35' },
  });
  assert.equal(updatedPatient.response.status, 200);
  assert.equal(updatedPatient.result.patient.name, 'Jamie Updated');
  assert.equal(updatedPatient.result.patient.gender, 'Male');
  assert.equal(updatedPatient.result.patient.age, 35);
  const missingPatient = await api(baseUrl, '/api/patients/not-owned-by-this-doctor', {
    method: 'PUT',
    cookie: doctorLogin.cookie,
    body: patientInput,
  });
  assert.equal(missingPatient.response.status, 404);

  const patients = await api(baseUrl, '/api/patients', { cookie: doctorLogin.cookie });
  assert.equal(patients.response.status, 200);
  assert.ok(patients.result.patients.some((patient) => patient.id === createdPatient.result.patient.id && patient.name === 'Jamie Updated'));

  const emptyAppointments = await api(baseUrl, '/api/appointments', { cookie: doctorLogin.cookie });
  assert.equal(emptyAppointments.response.status, 200);
  assert.deepEqual(emptyAppointments.result.appointments, []);
  const appointmentInput = {
    patientId: createdPatient.result.patient.id,
    date: '2026-11-15',
    time: '09:30',
    type: 'Follow-up',
    room: 'Room 02',
    status: 'Confirmed',
  };
  const createdAppointment = await api(baseUrl, '/api/appointments', {
    method: 'POST',
    cookie: doctorLogin.cookie,
    body: appointmentInput,
  });
  assert.equal(createdAppointment.response.status, 201);
  assert.equal(createdAppointment.result.appointment.doctorId, 'doctor-ava');
  assert.equal(createdAppointment.result.appointment.patientId, createdPatient.result.patient.id);
  assert.equal(createdAppointment.result.appointment.date, appointmentInput.date);
  assert.equal(typeof createdAppointment.result.appointment.id, 'string');

  const updatedAppointment = await api(baseUrl, `/api/appointments/${encodeURIComponent(createdAppointment.result.appointment.id)}`, {
    method: 'PUT',
    cookie: doctorLogin.cookie,
    body: { ...appointmentInput, date: '2026-11-16', time: '10:15', status: 'Checked in' },
  });
  assert.equal(updatedAppointment.response.status, 200);
  assert.equal(updatedAppointment.result.appointment.date, '2026-11-16');
  assert.equal(updatedAppointment.result.appointment.status, 'Checked in');
  const appointmentsAfterUpdate = await api(baseUrl, '/api/appointments', { cookie: doctorLogin.cookie });
  assert.equal(appointmentsAfterUpdate.result.appointments.length, 1);
  assert.equal(appointmentsAfterUpdate.result.appointments[0].id, createdAppointment.result.appointment.id);
  const invalidAppointment = await api(baseUrl, '/api/appointments', {
    method: 'POST',
    cookie: doctorLogin.cookie,
    body: { ...appointmentInput, status: 'Unknown' },
  });
  assert.equal(invalidAppointment.response.status, 400);

  const prescriptionInput = {
    patientId: createdPatient.result.patient.id,
    appointmentId: createdAppointment.result.appointment.id,
    medication: 'Example medication',
    directions: 'One tablet daily',
    refills: '2',
    status: 'Active',
    expires: '2026-12-31',
    notes: 'Take with water',
  };
  const createdPrescription = await api(baseUrl, '/api/prescriptions', {
    method: 'POST',
    cookie: doctorLogin.cookie,
    body: prescriptionInput,
  });
  assert.equal(createdPrescription.response.status, 201);
  assert.equal(createdPrescription.result.prescription.doctorId, 'doctor-ava');
  assert.equal(createdPrescription.result.prescription.patientId, createdPatient.result.patient.id);
  assert.equal(createdPrescription.result.prescription.appointmentId, createdAppointment.result.appointment.id);
  assert.equal(createdPrescription.result.prescription.medication, prescriptionInput.medication);

  const updatedPrescription = await api(baseUrl, `/api/prescriptions/${encodeURIComponent(createdPrescription.result.prescription.id)}`, {
    method: 'PUT',
    cookie: doctorLogin.cookie,
    body: { ...prescriptionInput, medication: 'Updated medication', status: 'Renewal due' },
  });
  assert.equal(updatedPrescription.response.status, 200);
  assert.equal(updatedPrescription.result.prescription.medication, 'Updated medication');
  assert.equal(updatedPrescription.result.prescription.status, 'Renewal due');

  const attachmentBytes = Buffer.from('database-backed prescription file');
  const attachmentResponse = await fetch(`${baseUrl}/api/prescriptions/${encodeURIComponent(createdPrescription.result.prescription.id)}/attachments?name=example.png`, {
    method: 'POST',
    headers: { Cookie: doctorLogin.cookie, 'Content-Type': 'image/png' },
    body: attachmentBytes,
  });
  const savedAttachment = await attachmentResponse.json();
  assert.equal(attachmentResponse.status, 201);
  assert.equal(savedAttachment.attachment.name, 'example.png');
  const relogin = await api(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { userId: 'doctor-ava', password: 'a changed and private password' },
  });
  assert.equal(relogin.response.status, 200);
  const prescriptionListAfterRelogin = await api(baseUrl, '/api/prescriptions', { cookie: relogin.cookie });
  assert.ok(prescriptionListAfterRelogin.result.prescriptions.some((item) => item.id === createdPrescription.result.prescription.id));
  assert.equal(prescriptionListAfterRelogin.result.prescriptions.find((item) => item.id === createdPrescription.result.prescription.id).attachments.length, 1);

  const downloadedAttachment = await fetch(`${baseUrl}/api/prescriptions/${encodeURIComponent(createdPrescription.result.prescription.id)}/attachments/${encodeURIComponent(savedAttachment.attachment.id)}`, {
    headers: { Cookie: relogin.cookie },
  });
  assert.equal(downloadedAttachment.status, 200);
  assert.deepEqual(Buffer.from(await downloadedAttachment.arrayBuffer()), attachmentBytes);
  const appointmentsAfterRelogin = await api(baseUrl, '/api/appointments', { cookie: relogin.cookie });
  assert.equal(appointmentsAfterRelogin.result.appointments.length, 1);
  assert.equal(appointmentsAfterRelogin.result.appointments[0].status, 'Checked in');
  const deletedAppointment = await api(baseUrl, `/api/appointments/${encodeURIComponent(createdAppointment.result.appointment.id)}`, {
    method: 'DELETE',
    cookie: relogin.cookie,
  });
  assert.equal(deletedAppointment.response.status, 200);
  const prescriptionAfterAppointmentDelete = await api(baseUrl, '/api/prescriptions', { cookie: relogin.cookie });
  assert.equal(prescriptionAfterAppointmentDelete.result.prescriptions.find((item) => item.id === createdPrescription.result.prescription.id).appointmentId, null);
  const removedAttachment = await api(baseUrl, `/api/prescriptions/${encodeURIComponent(createdPrescription.result.prescription.id)}/attachments/${encodeURIComponent(savedAttachment.attachment.id)}`, {
    method: 'DELETE',
    cookie: doctorLogin.cookie,
  });
  assert.equal(removedAttachment.response.status, 200);
  const removedPrescription = await api(baseUrl, `/api/prescriptions/${encodeURIComponent(createdPrescription.result.prescription.id)}`, {
    method: 'DELETE',
    cookie: doctorLogin.cookie,
  });
  assert.equal(removedPrescription.response.status, 200);
  const prescriptionsAfterDelete = await api(baseUrl, '/api/prescriptions', { cookie: doctorLogin.cookie });
  assert.ok(!prescriptionsAfterDelete.result.prescriptions.some((item) => item.id === createdPrescription.result.prescription.id));

  const invalidPatient = await api(baseUrl, '/api/patients', {
    method: 'POST',
    cookie: doctorLogin.cookie,
    body: { ...patientInput, gender: 'Other' },
  });
  assert.equal(invalidPatient.response.status, 400);

  const patientWithoutOptionalFields = await api(baseUrl, '/api/patients', {
    method: 'POST',
    cookie: doctorLogin.cookie,
    body: { name: 'Casey Optional', gender: 'Female', age: '28' },
  });
  assert.equal(patientWithoutOptionalFields.response.status, 201);
  assert.equal(patientWithoutOptionalFields.result.patient.address, '');
  assert.equal(patientWithoutOptionalFields.result.patient.email, '');
  assert.equal(patientWithoutOptionalFields.result.patient.phone, '');
  assert.equal(patientWithoutOptionalFields.result.patient.birthDate, '');

  const clearedOptionalFields = await api(baseUrl, `/api/patients/${encodeURIComponent(createdPatient.result.patient.id)}`, {
    method: 'PUT',
    cookie: doctorLogin.cookie,
    body: { name: 'Jamie Updated', gender: 'Male', age: '35', address: '', email: '', phone: '', birthDate: '' },
  });
  assert.equal(clearedOptionalFields.response.status, 200);
  assert.equal(clearedOptionalFields.result.patient.address, '');
  assert.equal(clearedOptionalFields.result.patient.email, '');
  assert.equal(clearedOptionalFields.result.patient.phone, '');
  assert.equal(clearedOptionalFields.result.patient.birthDate, '');

  const deniedReset = await api(baseUrl, '/api/admin/doctors/doctor-ava/reset-password', {
    method: 'POST',
    cookie: doctorLogin.cookie,
  });
  assert.equal(deniedReset.response.status, 403);

  const adminReset = await api(baseUrl, '/api/admin/doctors/doctor-ava/reset-password', {
    method: 'POST',
    cookie: adminCookie,
  });
  assert.equal(adminReset.response.status, 200);
  assert.equal(typeof adminReset.result.temporaryPassword, 'string');
  assert.notEqual(adminReset.result.temporaryPassword, createdDoctor.result.temporaryPassword);

  const revokedSession = await api(baseUrl, '/api/auth/me', { cookie: doctorLogin.cookie });
  assert.equal(revokedSession.response.status, 401);

  const previousPasswordLogin = await api(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { userId: 'doctor-ava', password: 'a changed and private password' },
  });
  assert.equal(previousPasswordLogin.response.status, 401);

  const resetPasswordLogin = await api(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { userId: 'doctor-ava', password: adminReset.result.temporaryPassword },
  });
  assert.equal(resetPasswordLogin.response.status, 200);
  assert.equal(resetPasswordLogin.result.user.mustChangePassword, true);
});
