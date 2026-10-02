import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AuthStore, calculateExpiryDate } from '../src/lib/auth-store.mjs';

let store;

afterEach(() => {
  store?.close();
  store = undefined;
});

test('doctor temporary password is valid once and must be changed before access', () => {
  store = new AuthStore(':memory:');
  store.ensureSuperadmin({ userId: 'maniksar', password: 'a longer bootstrap secret' });
  const { temporaryPassword } = store.createDoctor({
    userId: 'doctor-ava',
    name: 'Ava Patel',
    email: 'ava@example.test',
    specialty: 'Family medicine',
    address: '14 Example Street',
    packageName: '3 months',
    registerDate: '2026-01-31',
    lastRenewal: '2026-01-31',
  });

  const doctor = store.authenticate('doctor-ava', temporaryPassword);
  assert.equal(doctor.role, 'doctor');
  assert.equal(doctor.mustChangePassword, true);
  assert.equal(store.listDoctors()[0].mustChangePassword, true);

  const session = store.createSession(doctor.id, 3600);
  const updated = store.changePassword(session.token, 'a new private password');
  assert.equal(updated.mustChangePassword, false);
  assert.equal(store.authenticate('doctor-ava', temporaryPassword), null);
  assert.equal(store.authenticate('doctor-ava', 'a new private password').mustChangePassword, false);
  assert.equal(store.getSession(session.token).user.mustChangePassword, false);
});

test('superadmin bootstrap is idempotent and does not reset its password', () => {
  store = new AuthStore(':memory:');
  assert.equal(store.ensureSuperadmin({ userId: 'maniksar', password: 'a longer bootstrap secret' }), true);
  assert.equal(store.ensureSuperadmin({ userId: 'maniksar', password: undefined }), false);
  assert.equal(store.authenticate('maniksar', 'a longer bootstrap secret').role, 'superadmin');
});

test('doctor IDs are unique and passwords have a minimum length', () => {
  store = new AuthStore(':memory:');
  store.ensureSuperadmin({ userId: 'maniksar', password: 'a longer bootstrap secret' });
  assert.throws(() => store.createDoctor({ userId: 'bad id', name: 'Ava Patel', email: 'ava@example.test', specialty: 'Family medicine' }));
  const profile = { address: '14 Example Street', packageName: '3 months', registerDate: '2026-01-31', lastRenewal: '2026-01-31' };
  store.createDoctor({ userId: 'doctor-ava', name: 'Ava Patel', email: 'ava@example.test', specialty: 'Family medicine', ...profile });
  assert.throws(() => store.createDoctor({ userId: 'doctor-ava', name: 'Ava Patel', email: 'ava@example.test', specialty: 'Family medicine', ...profile }));
  assert.throws(() => store.changePassword('invalid-session', 'short'));
});

test('doctor package expiry clamps month ends and leaves lifetime blank', () => {
  assert.equal(calculateExpiryDate('3 months', '2026-01-31'), '2026-04-30');
  assert.equal(calculateExpiryDate('12 months', '2024-02-29'), '2025-02-28');
  assert.equal(calculateExpiryDate('Lifetime', '2026-01-31'), '');
});