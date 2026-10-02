import assert from 'node:assert/strict';
import mariadb from 'mariadb';
import { afterEach, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { AuthStore, calculateExpiryDate, validatePassword } from '../src/lib/auth-store.mjs';

const testDatabase = process.env.MARIADB_TEST_DATABASE;
const hasTestDatabaseConfig = Boolean(testDatabase && process.env.MARIADB_TEST_USER);
const testDatabaseOptions = hasTestDatabaseConfig ? {
  host: process.env.MARIADB_TEST_HOST || '127.0.0.1',
  port: Number(process.env.MARIADB_TEST_PORT || 3306),
  database: testDatabase,
  user: process.env.MARIADB_TEST_USER,
  password: process.env.MARIADB_TEST_PASSWORD || '',
  connectionLimit: 2,
} : null;
let store;
let pool;
let tablePrefix;

afterEach(async () => {
  if (!pool) return;
  try {
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_prescription_attachments\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_prescriptions\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_appointments\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_patients\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_doctors\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_sessions\``);
    await pool.query(`DROP TABLE IF EXISTS \`${tablePrefix}_users\``);
  } finally {
    await pool.end();
    store = undefined;
    pool = undefined;
    tablePrefix = undefined;
  }
});

async function createStore() {
  tablePrefix = `test_${randomBytes(8).toString('hex')}`;
  pool = mariadb.createPool(testDatabaseOptions);
  store = new AuthStore(pool, tablePrefix);
  await store.initialize();
}

test('doctor temporary password is valid once and must be changed before access', { skip: !hasTestDatabaseConfig }, async () => {
  await createStore();
  await store.ensureSuperadmin({ userId: 'maniksar', password: 'a longer bootstrap secret' });
  const { temporaryPassword } = await store.createDoctor({
    userId: 'doctor-ava',
    name: 'Ava Patel',
    email: 'ava@example.test',
    specialty: 'Family medicine',
    address: '14 Example Street',
    packageName: '3 months',
    registerDate: '2026-01-31',
    lastRenewal: '2026-01-31',
  });

  const doctor = await store.authenticate('doctor-ava', temporaryPassword);
  assert.equal(doctor.role, 'doctor');
  assert.equal(doctor.mustChangePassword, true);
  assert.equal((await store.listDoctors())[0].mustChangePassword, true);

  const session = await store.createSession(doctor.id, 3600);
  const updated = await store.changePassword(session.token, 'a new private password');
  assert.equal(updated.mustChangePassword, false);
  assert.equal(await store.authenticate('doctor-ava', temporaryPassword), null);
  assert.equal((await store.authenticate('doctor-ava', 'a new private password')).mustChangePassword, false);
  assert.equal((await store.getSession(session.token)).user.mustChangePassword, false);
});

test('superadmin bootstrap is idempotent and does not reset its password', { skip: !hasTestDatabaseConfig }, async () => {
  await createStore();
  assert.equal(await store.ensureSuperadmin({ userId: 'maniksar', password: 'a longer bootstrap secret' }), true);
  assert.equal(await store.ensureSuperadmin({ userId: 'maniksar', password: undefined }), false);
  assert.equal((await store.authenticate('maniksar', 'a longer bootstrap secret')).role, 'superadmin');
});

test('doctor IDs are unique and passwords have a minimum length', { skip: !hasTestDatabaseConfig }, async () => {
  await createStore();
  await store.ensureSuperadmin({ userId: 'maniksar', password: 'a longer bootstrap secret' });
  await assert.rejects(store.createDoctor({ userId: 'bad id', name: 'Ava Patel', email: 'ava@example.test', specialty: 'Family medicine' }));
  const profile = { address: '14 Example Street', packageName: '3 months', registerDate: '2026-01-31', lastRenewal: '2026-01-31' };
  const doctor = { userId: 'doctor-ava', name: 'Ava Patel', email: 'ava@example.test', specialty: 'Family medicine', ...profile };
  await store.createDoctor(doctor);
  await assert.rejects(store.createDoctor(doctor), (error) => error.code === 'ER_DUP_ENTRY');
  await assert.rejects(store.changePassword('invalid-session', 'short'), /at least 12 characters/);
});

test('doctor package expiry clamps month ends and leaves lifetime blank', () => {
  assert.equal(calculateExpiryDate('3 months', '2026-01-31'), '2026-04-30');
  assert.equal(calculateExpiryDate('12 months', '2024-02-29'), '2025-02-28');
  assert.equal(calculateExpiryDate('Lifetime', '2026-01-31'), '');
});

test('password validation enforces length and string type', () => {
  assert.equal(validatePassword('a long enough password'), true);
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('a'.repeat(257)), false);
  assert.equal(validatePassword(null), false);
});

test('MariaDB schema uses isolated InnoDB tables and rejects unsafe prefixes', async () => {
  const statements = [];
  const fakePool = {
    async query(sql) {
      statements.push(sql);
      return [];
    },
  };
  const schema = new AuthStore(fakePool, 'unit_test');
  await schema.initialize();

  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS `unit_test_users`/);
  assert.match(statements[0], /ENGINE=InnoDB/);
  assert.match(statements[1], /`unit_test_sessions`/);
  assert.match(statements[1], /FOREIGN KEY \(user_id\)/);
  assert.ok(statements.some((sql) => sql.includes('`unit_test_doctors`')));
  assert.ok(statements.some((sql) => sql.includes('`unit_test_patients`')));
  assert.ok(statements.some((sql) => sql.includes('`unit_test_appointments`')));
  assert.ok(statements.some((sql) => sql.includes('`unit_test_prescriptions`')));
  assert.ok(statements.some((sql) => sql.includes('`unit_test_prescription_attachments`')));
  assert.ok(statements.some((sql) => sql.includes('PatientId VARCHAR(64)')));
  assert.ok(statements.some((sql) => sql.includes("gender ENUM('Male', 'Female')")));
  assert.ok(statements.some((sql) => sql.includes('age TINYINT UNSIGNED')));
  assert.ok(statements.some((sql) => sql.includes('AppointId VARCHAR(64)')));
  assert.ok(statements.some((sql) => sql.includes('MedicationId VARCHAR(64)')));
  assert.ok(statements.some((sql) => sql.includes('AttachId VARCHAR(255)')));
  assert.ok(statements.some((sql) => sql.includes('information_schema.columns')));
  assert.throws(() => new AuthStore(fakePool, 'unsafe`prefix'), /Invalid database table prefix/);
});
