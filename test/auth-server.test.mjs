import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const siteDirectory = fileURLToPath(new URL('..', import.meta.url));

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

test('superadmin provisions doctors who must change temporary passwords', async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'docvisit-auth-'));
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const superadminPassword = randomBytes(28).toString('base64url');
  const child = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server.mjs'], {
    cwd: siteDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_PATH: join(dataDirectory, 'integration.sqlite'),
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
    await rm(dataDirectory, { recursive: true, force: true });
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
