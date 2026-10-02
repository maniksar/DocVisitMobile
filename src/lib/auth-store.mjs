import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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
  constructor(pool, tablePrefix = 'docvisit') {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(tablePrefix)) throw new Error('Invalid database table prefix.');
    this.database = pool;
    this.usersTable = `${tablePrefix}_users`;
    this.sessionsTable = `${tablePrefix}_sessions`;
  }

  async initialize() {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS \`${this.usersTable}\` (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL UNIQUE,
        display_name VARCHAR(120) NOT NULL,
        email VARCHAR(254) NOT NULL,
        specialty VARCHAR(120) NOT NULL DEFAULT '',
        role ENUM('superadmin', 'doctor') NOT NULL,
        password_salt CHAR(32) NOT NULL,
        password_hash CHAR(128) NOT NULL,
        must_change_password TINYINT UNSIGNED NOT NULL DEFAULT 0,
        address VARCHAR(300) NOT NULL DEFAULT '',
        package_name VARCHAR(30) NOT NULL DEFAULT '3 months',
        register_date CHAR(10) NOT NULL DEFAULT '',
        last_renewal CHAR(10) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS \`${this.sessionsTable}\` (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        expires_at BIGINT UNSIGNED NOT NULL,
        KEY sessions_expiry (expires_at),
        CONSTRAINT \`${this.sessionsTable}_user_fk\`
          FOREIGN KEY (user_id) REFERENCES \`${this.usersTable}\` (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const existingColumns = new Set((await this.database.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
      [this.usersTable],
    )).map((column) => column.COLUMN_NAME || column.column_name));
    for (const [name, definition] of [
      ['address', "VARCHAR(300) NOT NULL DEFAULT ''"],
      ['package_name', "VARCHAR(30) NOT NULL DEFAULT '3 months'"],
      ['register_date', "CHAR(10) NOT NULL DEFAULT ''"],
      ['last_renewal', "CHAR(10) NOT NULL DEFAULT ''"],
    ]) {
      if (!existingColumns.has(name)) {
        await this.database.query(`ALTER TABLE \`${this.usersTable}\` ADD COLUMN \`${name}\` ${definition}`);
      }
    }
    await this.database.query(`
      UPDATE \`${this.usersTable}\`
      SET register_date = DATE_FORMAT(created_at, '%Y-%m-%d')
      WHERE role = 'doctor' AND register_date = ''
    `);
    await this.database.query(`
      UPDATE \`${this.usersTable}\`
      SET last_renewal = register_date
      WHERE role = 'doctor' AND last_renewal = ''
    `);
  }

  async ensureSuperadmin({ userId, password }) {
    const existing = await this.database.query(
      `SELECT id, role FROM \`${this.usersTable}\` WHERE user_id = ?`,
      [userId],
    );
    if (existing[0]) {
      if (existing[0].role !== 'superadmin') throw new Error('The configured superadmin ID belongs to a non-admin account.');
      return false;
    }
    if (!userId || !validatePassword(password)) {
      throw new Error('Set SUPERADMIN_PASSWORD to a value between 12 and 256 characters.');
    }

    const { salt, hash } = makePasswordHash(password);
    await this.database.query(`
      INSERT INTO \`${this.usersTable}\` (user_id, display_name, email, role, password_salt, password_hash)
      VALUES (?, 'Practice administrator', '', 'superadmin', ?, ?)
    `, [userId, salt, hash]);
    return true;
  }

  async hasSuperadmin() {
    const rows = await this.database.query(`SELECT 1 FROM \`${this.usersTable}\` WHERE role = 'superadmin' LIMIT 1`);
    return rows.length > 0;
  }

  async authenticate(userId, password) {
    if (typeof userId !== 'string' || typeof password !== 'string') return null;
    const rows = await this.database.query(`SELECT * FROM \`${this.usersTable}\` WHERE user_id = ?`, [userId]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) return null;
    return publicUser(user);
  }

  async createSession(userId, lifetimeSeconds) {
    const rows = await this.database.query(`SELECT id FROM \`${this.usersTable}\` WHERE user_id = ?`, [userId]);
    const user = rows[0];
    if (!user) throw new Error('Account not found.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
    await this.database.query(
      `INSERT INTO \`${this.sessionsTable}\` (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
      [hashToken(token), user.id, expiresAt],
    );
    await this.database.query(`DELETE FROM \`${this.sessionsTable}\` WHERE expires_at <= ?`, [Math.floor(Date.now() / 1000)]);
    return { token, expiresAt };
  }

  async getSession(token) {
    if (!token) return null;
    const now = Math.floor(Date.now() / 1000);
    const rows = await this.database.query(`
      SELECT users.*, sessions.expires_at
      FROM \`${this.sessionsTable}\` AS sessions
      JOIN \`${this.usersTable}\` AS users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `, [hashToken(token), now]);
    const session = rows[0];
    return session ? { user: publicUser(session), expiresAt: Number(session.expires_at) } : null;
  }

  async revokeSession(token) {
    if (token) await this.database.query(`DELETE FROM \`${this.sessionsTable}\` WHERE token_hash = ?`, [hashToken(token)]);
  }

  async changePassword(token, password) {
    if (!validatePassword(password)) throw new Error('Password must be at least 12 characters.');
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const sessions = await connection.query(`
        SELECT users.id FROM \`${this.sessionsTable}\` AS sessions
        JOIN \`${this.usersTable}\` AS users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `, [hashToken(token), Math.floor(Date.now() / 1000)]);
      if (!sessions[0]) {
        await connection.rollback();
        return null;
      }

      const { salt, hash } = makePasswordHash(password);
      await connection.query(
        `UPDATE \`${this.usersTable}\` SET password_salt = ?, password_hash = ?, must_change_password = 0 WHERE id = ?`,
        [salt, hash, sessions[0].id],
      );
      await connection.query(
        `DELETE FROM \`${this.sessionsTable}\` WHERE user_id = ? AND token_hash != ?`,
        [sessions[0].id, hashToken(token)],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return (await this.getSession(token))?.user ?? null;
  }

  async listDoctors() {
    const rows = await this.database.query(`
      SELECT user_id, display_name, email, specialty, address, package_name, register_date, last_renewal, must_change_password,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM \`${this.usersTable}\` WHERE role = 'doctor' ORDER BY display_name
    `);
    return rows.map((doctor) => ({
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

  async createDoctor({ userId, name, email, specialty, address, packageName, registerDate, lastRenewal }) {
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(userId ?? '')) throw new Error('User ID must be 3 to 32 letters, numbers, dots, underscores, or hyphens.');
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw new Error('Enter a valid doctor name.');
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
    if (typeof specialty !== 'string' || specialty.trim().length < 2 || specialty.length > 120) throw new Error('Enter a valid specialty.');
    const profile = validateDoctorProfile({ address, packageName, registerDate, lastRenewal });
    const temporaryPassword = randomBytes(18).toString('base64url');
    const { salt, hash } = makePasswordHash(temporaryPassword);
    await this.database.query(`
      INSERT INTO \`${this.usersTable}\` (user_id, display_name, email, specialty, role, password_salt, password_hash, must_change_password, address, package_name, register_date, last_renewal)
      VALUES (?, ?, ?, ?, 'doctor', ?, ?, 1, ?, ?, ?, ?)
    `, [userId.trim(), name.trim(), email.trim().toLowerCase(), specialty.trim(), salt, hash, profile.address, profile.packageName, profile.registerDate, profile.lastRenewal]);
    return { temporaryPassword };
  }

  async updateDoctorProfile(userId, profileValues) {
    const doctors = await this.database.query(
      `SELECT id FROM \`${this.usersTable}\` WHERE user_id = ? AND role = 'doctor'`,
      [userId],
    );
    const doctor = doctors[0];
    if (!doctor) return null;
    const profile = validateDoctorProfile(profileValues);
    await this.database.query(
      `UPDATE \`${this.usersTable}\` SET address = ?, package_name = ?, register_date = ?, last_renewal = ? WHERE id = ?`,
      [profile.address, profile.packageName, profile.registerDate, profile.lastRenewal, doctor.id],
    );
    return (await this.listDoctors()).find((item) => item.id === userId);
  }

  async resetDoctorPassword(userId) {
    const doctors = await this.database.query(
      `SELECT id FROM \`${this.usersTable}\` WHERE user_id = ? AND role = 'doctor'`,
      [userId],
    );
    const doctor = doctors[0];
    if (!doctor) return null;

    const temporaryPassword = randomBytes(18).toString('base64url');
    const { salt, hash } = makePasswordHash(temporaryPassword);
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE \`${this.usersTable}\` SET password_salt = ?, password_hash = ?, must_change_password = 1 WHERE id = ?`,
        [salt, hash, doctor.id],
      );
      await connection.query(`DELETE FROM \`${this.sessionsTable}\` WHERE user_id = ?`, [doctor.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { temporaryPassword };
  }

  async close() {
    await this.database.end();
  }
}
