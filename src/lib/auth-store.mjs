import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const passwordBytes = 64;
const doctorPackages = new Map([['3 months', 3], ['12 months', 12], ['24 months', 24], ['60 Months', 60], ['Lifetime', null]]);
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const publicUser = (user) => ({
  id: user.user_id,
  name: user.display_name,
  email: user.email,
  specialty: user.specialty,
  role: user.role,
  mustChangePassword: Boolean(user.must_change_password),
});

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 256;
}

function makePasswordHash(password, salt = randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: scryptSync(password, salt, passwordBytes).toString('hex'),
  };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = scryptSync(password, salt, passwordBytes);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function calculateExpiryDate(packageName, lastRenewal) {
  const months = doctorPackages.get(packageName);
  if (months === null && doctorPackages.has(packageName)) return '';
  if (months === undefined || !isValidDate(lastRenewal)) return '';

  const [year, month, day] = lastRenewal.split('-').map(Number);
  const expiry = new Date(Date.UTC(year, month - 1, 1));
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  const monthEnd = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate();
  expiry.setUTCDate(Math.min(day, monthEnd));
  return expiry.toISOString().slice(0, 10);
}

function validateDoctorProfile({ address, packageName, registerDate, lastRenewal }) {
  if (typeof address !== 'string' || address.trim().length < 2 || address.length > 300) throw new Error('Enter a valid doctor address.');
  if (!doctorPackages.has(packageName)) throw new Error('Choose a valid package.');
  if (!isValidDate(registerDate)) throw new Error('Enter a valid registration date.');
  if (!isValidDate(lastRenewal) || lastRenewal < registerDate) throw new Error('Last Renewal must be on or after the Register Date.');
  return { address: address.trim(), packageName, registerDate, lastRenewal };
}

export class AuthStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL,
        specialty TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL CHECK (role IN ('superadmin', 'doctor')),
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        address TEXT NOT NULL DEFAULT '',
        package_name TEXT NOT NULL DEFAULT '3 months',
        register_date TEXT NOT NULL DEFAULT '',
        last_renewal TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `);

    const existingColumns = new Set(this.database.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
    for (const [name, definition] of [
      ['address', "TEXT NOT NULL DEFAULT ''"],
      ['package_name', "TEXT NOT NULL DEFAULT '3 months'"],
      ['register_date', "TEXT NOT NULL DEFAULT ''"],
      ['last_renewal', "TEXT NOT NULL DEFAULT ''"],
    ]) {
      if (!existingColumns.has(name)) this.database.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
    this.database.exec(`
      UPDATE users SET register_date = substr(created_at, 1, 10)
      WHERE role = 'doctor' AND register_date = '';
      UPDATE users SET last_renewal = register_date
      WHERE role = 'doctor' AND last_renewal = '';
    `);
  }

  ensureSuperadmin({ userId, password }) {
    const existing = this.database.prepare('SELECT id, role FROM users WHERE user_id = ?').get(userId);
    if (existing) {
      if (existing.role !== 'superadmin') throw new Error('The configured superadmin ID belongs to a non-admin account.');
      return false;
    }
    if (!userId || !validatePassword(password)) {
      throw new Error('Set SUPERADMIN_PASSWORD to a value between 12 and 256 characters.');
    }

    const { salt, hash } = makePasswordHash(password);
    this.database.prepare(`
      INSERT INTO users (user_id, display_name, email, role, password_salt, password_hash)
      VALUES (?, 'Practice administrator', '', 'superadmin', ?, ?)
    `).run(userId, salt, hash);
    return true;
  }

  hasSuperadmin() {
    return Boolean(this.database.prepare("SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1").get());
  }

  authenticate(userId, password) {
    if (typeof userId !== 'string' || typeof password !== 'string') return null;
    const user = this.database.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) return null;
    return publicUser(user);
  }

  createSession(userId, lifetimeSeconds) {
    const user = this.database.prepare('SELECT id FROM users WHERE user_id = ?').get(userId);
    if (!user) throw new Error('Account not found.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
    this.database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), user.id, expiresAt);
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
    return { token, expiresAt };
  }

  getSession(token) {
    if (!token) return null;
    const now = Math.floor(Date.now() / 1000);
    const session = this.database.prepare(`
      SELECT users.*, sessions.expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token), now);
    return session ? { user: publicUser(session), expiresAt: session.expires_at } : null;
  }

  revokeSession(token) {
    if (token) this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  changePassword(token, password) {
    if (!validatePassword(password)) throw new Error('Password must be at least 12 characters.');
    const session = this.database.prepare(`
      SELECT users.id FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token), Math.floor(Date.now() / 1000));
    if (!session) return null;

    const { salt, hash } = makePasswordHash(password);
    this.database.prepare('UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(salt, hash, session.id);
    this.database.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
      .run(session.id, hashToken(token));
    return this.getSession(token)?.user ?? null;
  }

  listDoctors() {
    return this.database.prepare(`
      SELECT user_id, display_name, email, specialty, address, package_name, register_date, last_renewal, must_change_password, created_at
      FROM users WHERE role = 'doctor' ORDER BY display_name COLLATE NOCASE
    `).all().map((doctor) => ({
      id: doctor.user_id,
      name: doctor.display_name,
      email: doctor.email,
      specialty: doctor.specialty,
      address: doctor.address,
      packageName: doctor.package_name,
      registerDate: doctor.register_date,
      lastRenewal: doctor.last_renewal,
      expiryDate: calculateExpiryDate(doctor.package_name, doctor.last_renewal),
      mustChangePassword: Boolean(doctor.must_change_password),
      createdAt: doctor.created_at,
    }));
  }

  createDoctor({ userId, name, email, specialty, address, packageName, registerDate, lastRenewal }) {
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(userId ?? '')) throw new Error('User ID must be 3 to 32 letters, numbers, dots, underscores, or hyphens.');
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw new Error('Enter a valid doctor name.');
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
    if (typeof specialty !== 'string' || specialty.trim().length < 2 || specialty.length > 120) throw new Error('Enter a valid specialty.');
    const profile = validateDoctorProfile({ address, packageName, registerDate, lastRenewal });
    const temporaryPassword = randomBytes(18).toString('base64url');
    const { salt, hash } = makePasswordHash(temporaryPassword);
    this.database.prepare(`
      INSERT INTO users (user_id, display_name, email, specialty, role, password_salt, password_hash, must_change_password, address, package_name, register_date, last_renewal)
      VALUES (?, ?, ?, ?, 'doctor', ?, ?, 1, ?, ?, ?, ?)
    `).run(userId.trim(), name.trim(), email.trim().toLowerCase(), specialty.trim(), salt, hash, profile.address, profile.packageName, profile.registerDate, profile.lastRenewal);
    return { temporaryPassword };
  }

  updateDoctorProfile(userId, profileValues) {
    const doctor = this.database.prepare("SELECT id FROM users WHERE user_id = ? AND role = 'doctor'").get(userId);
    if (!doctor) return null;
    const profile = validateDoctorProfile(profileValues);
    this.database.prepare('UPDATE users SET address = ?, package_name = ?, register_date = ?, last_renewal = ? WHERE id = ?')
      .run(profile.address, profile.packageName, profile.registerDate, profile.lastRenewal, doctor.id);
    return this.listDoctors().find((item) => item.id === userId);
  }

  resetDoctorPassword(userId) {
    const doctor = this.database.prepare("SELECT id FROM users WHERE user_id = ? AND role = 'doctor'").get(userId);
    if (!doctor) return null;

    const temporaryPassword = randomBytes(18).toString('base64url');
    const { salt, hash } = makePasswordHash(temporaryPassword);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 1 WHERE id = ?')
        .run(salt, hash, doctor.id);
      this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(doctor.id);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { temporaryPassword };
  }

  close() {
    this.database.close();
  }
}