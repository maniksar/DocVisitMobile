import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

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

function validatePatient({ name, gender, age, address, email, phone, birthDate }) {
  const displayName = typeof name === 'string' ? name.trim() : '';
  const patientAge = typeof age === 'string' && age.trim() !== '' ? Number(age) : age;
  const optionalText = (value, label, maxLength) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new Error(`Enter a valid ${label}.`);
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maxLength) throw new Error(`Enter a valid ${label}.`);
    return normalized;
  };
  const patientAddress = optionalText(address, 'address or locality', 300);
  const patientEmail = optionalText(email, 'email address', 254)?.toLowerCase() ?? null;
  const patientPhone = optionalText(phone, 'phone number', 40);
  const patientBirthDate = optionalText(birthDate, 'date of birth', 10);
  if (displayName.length < 2 || displayName.length > 120) throw new Error('Enter a valid patient name.');
  if (gender !== 'Male' && gender !== 'Female') throw new Error('Choose Male or Female for gender.');
  if (!Number.isInteger(patientAge) || patientAge < 0 || patientAge > 130) throw new Error('Enter an age between 0 and 130.');
  if (patientAddress !== null && patientAddress.length < 2) throw new Error('Enter a valid address or locality.');
  if (patientEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) throw new Error('Enter a valid email address.');
  if (patientPhone !== null && patientPhone.length < 3) throw new Error('Enter a valid phone number.');
  if (patientBirthDate !== null && !isValidDate(patientBirthDate)) throw new Error('Enter a valid date of birth.');
  return { name: displayName, gender, age: patientAge, address: patientAddress, email: patientEmail, phone: patientPhone, birthDate: patientBirthDate };
}

function validatePrescription({ patientId, appointmentId, medication, directions, refills, expires, notes, status }) {
  const medicationName = typeof medication === 'string' ? medication.trim() : '';
  const medicationDirections = typeof directions === 'string' ? directions.trim() : '';
  const refillCount = typeof refills === 'string' && refills.trim() !== '' ? Number(refills) : refills;
  const reviewDate = typeof expires === 'string' ? expires.trim() : '';
  const prescriptionNotes = typeof notes === 'string' ? notes.trim() : '';
  if (typeof patientId !== 'string' || !patientId) throw new Error('Select a patient.');
  if (medicationName.length < 1 || medicationName.length > 200) throw new Error('Enter a valid medication name.');
  if (medicationDirections.length < 1 || medicationDirections.length > 500) throw new Error('Enter valid medication directions.');
  if (!Number.isInteger(refillCount) || refillCount < 0 || refillCount > 12) throw new Error('Refills must be between 0 and 12.');
  if (!isValidDate(reviewDate)) throw new Error('Enter a valid review date.');
  if (prescriptionNotes.length > 5000) throw new Error('Prescription notes must be 5000 characters or fewer.');
  if (!['Active', 'Renewal due', 'Completed'].includes(status)) throw new Error('Choose a valid prescription status.');
  if (appointmentId !== undefined && appointmentId !== null && typeof appointmentId !== 'string') throw new Error('Choose a valid appointment.');
  return {
    patientId,
    appointmentId: appointmentId || null,
    medication: medicationName,
    directions: medicationDirections,
    refills: refillCount,
    expires: reviewDate,
    notes: prescriptionNotes,
    status,
  };
}

function validateAppointment({ patientId, date, time, type, room, status }) {
  const visitType = typeof type === 'string' ? type.trim() : '';
  const appointmentRoom = typeof room === 'string' ? room.trim() : '';
  const appointmentStatus = typeof status === 'string' ? status.trim() : 'Confirmed';
  if (typeof patientId !== 'string' || !patientId) throw new Error('Select a patient.');
  if (!isValidDate(date)) throw new Error('Enter a valid appointment date.');
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter a valid appointment time.');
  if (!['Consultation', 'Follow-up', 'Annual check-up', 'Medication review'].includes(visitType)) throw new Error('Choose a valid visit type.');
  if (appointmentRoom.length > 40) throw new Error('Enter a valid room.');
  if (!['Pending', 'Confirmed', 'Checked in', 'Completed', 'Cancelled'].includes(appointmentStatus)) throw new Error('Choose a valid appointment status.');
  return { patientId, date, time, type: visitType, room: appointmentRoom, status: appointmentStatus };
}

export class AuthStore {
  constructor(pool, tablePrefix = 'docvisit') {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(tablePrefix)) throw new Error('Invalid database table prefix.');
    this.database = pool;
    this.tablePrefix = tablePrefix;
    this.usersTable = `${tablePrefix}_users`;
    this.sessionsTable = `${tablePrefix}_sessions`;
    this.doctorsTable = `${tablePrefix}_doctors`;
    this.patientsTable = `${tablePrefix}_patients`;
    this.appointmentsTable = `${tablePrefix}_appointments`;
    this.prescriptionsTable = `${tablePrefix}_prescriptions`;
    this.attachmentsTable = `${tablePrefix}_prescription_attachments`;
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
        Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        token_hash CHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        expires_at BIGINT UNSIGNED NOT NULL,
        UNIQUE KEY sessions_token_hash (token_hash),
        KEY sessions_expiry (expires_at),
        CONSTRAINT \`${this.sessionsTable}_user_fk\`
          FOREIGN KEY (user_id) REFERENCES \`${this.usersTable}\` (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS \`${this.doctorsTable}\` (
        DoctorId VARCHAR(32) NOT NULL,
        specialty VARCHAR(120) NOT NULL DEFAULT '',
        address VARCHAR(300) NOT NULL DEFAULT '',
        package_name VARCHAR(30) NOT NULL DEFAULT '3 months',
        register_date CHAR(10) NOT NULL DEFAULT '',
        last_renewal CHAR(10) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (DoctorId),
        CONSTRAINT \`${this.doctorsTable}_user_fk\`
          FOREIGN KEY (DoctorId) REFERENCES \`${this.usersTable}\` (user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS \`${this.patientsTable}\` (
        PatientId VARCHAR(64) NOT NULL,
        doctor_user_id VARCHAR(32) NULL,
        display_name VARCHAR(120) NOT NULL,
        gender ENUM('Male', 'Female') NOT NULL,
        age TINYINT UNSIGNED NOT NULL,
        address VARCHAR(300) NULL,
        email VARCHAR(254) NULL,
        phone VARCHAR(40) NULL,
        birth_date DATE NULL,
        last_visit DATE NULL,
        initials VARCHAR(4) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (PatientId),
        KEY patients_doctor_name (doctor_user_id, display_name),
        KEY patients_email (email),
        CONSTRAINT \`${this.patientsTable}_doctor_fk\`
          FOREIGN KEY (doctor_user_id) REFERENCES \`${this.doctorsTable}\` (DoctorId) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS \`${this.appointmentsTable}\` (
        AppointId VARCHAR(64) NOT NULL,
        doctor_user_id VARCHAR(32) NOT NULL,
        patient_id VARCHAR(64) NOT NULL,
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        visit_type VARCHAR(80) NOT NULL,
        room VARCHAR(40) NOT NULL DEFAULT '',
        status VARCHAR(32) NOT NULL DEFAULT 'Confirmed',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (AppointId),
        KEY appointments_doctor_schedule (doctor_user_id, appointment_date, appointment_time),
        KEY appointments_patient_history (patient_id, appointment_date),
        CONSTRAINT \`${this.appointmentsTable}_doctor_fk\`
          FOREIGN KEY (doctor_user_id) REFERENCES \`${this.doctorsTable}\` (DoctorId) ON DELETE RESTRICT,
        CONSTRAINT \`${this.appointmentsTable}_patient_fk\`
          FOREIGN KEY (patient_id) REFERENCES \`${this.patientsTable}\` (PatientId) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS \`${this.prescriptionsTable}\` (
        MedicationId VARCHAR(64) NOT NULL,
        doctor_user_id VARCHAR(32) NOT NULL,
        patient_id VARCHAR(64) NOT NULL,
        appointment_id VARCHAR(64) NULL,
        medication VARCHAR(200) NOT NULL,
        directions VARCHAR(500) NOT NULL,
        refills TINYINT UNSIGNED NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'Active',
        review_date DATE NOT NULL,
        notes TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (MedicationId),
        KEY prescriptions_doctor_status (doctor_user_id, status, review_date),
        KEY prescriptions_patient_history (patient_id, created_at),
        KEY prescriptions_appointment (appointment_id),
        CONSTRAINT \`${this.prescriptionsTable}_doctor_fk\`
          FOREIGN KEY (doctor_user_id) REFERENCES \`${this.doctorsTable}\` (DoctorId) ON DELETE RESTRICT,
        CONSTRAINT \`${this.prescriptionsTable}_patient_fk\`
          FOREIGN KEY (patient_id) REFERENCES \`${this.patientsTable}\` (PatientId) ON DELETE RESTRICT,
        CONSTRAINT \`${this.prescriptionsTable}_appointment_fk\`
          FOREIGN KEY (appointment_id) REFERENCES \`${this.appointmentsTable}\` (AppointId) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS \`${this.attachmentsTable}\` (
        AttachId VARCHAR(255) NOT NULL,
        prescription_id VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        content_type VARCHAR(127) NOT NULL,
        file_size INT UNSIGNED NOT NULL,
        file_data LONGBLOB NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (AttachId),
        KEY attachments_prescription (prescription_id),
        CONSTRAINT \`${this.tablePrefix}_attachment_rx_fk\`
          FOREIGN KEY (prescription_id) REFERENCES \`${this.prescriptionsTable}\` (MedicationId) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.migrateClinicalPrimaryKeys();
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
    await this.database.query(`
      INSERT IGNORE INTO \`${this.doctorsTable}\`
        (DoctorId, specialty, address, package_name, register_date, last_renewal)
      SELECT user_id, specialty, address, package_name, register_date, last_renewal
      FROM \`${this.usersTable}\` WHERE role = 'doctor'
    `);
  }

  async migrateClinicalPrimaryKeys() {
    const columnsByTable = new Map();
    for (const table of [this.sessionsTable, this.doctorsTable, this.patientsTable, this.appointmentsTable, this.prescriptionsTable, this.attachmentsTable]) {
      const columns = await this.database.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
        [table],
      );
      columnsByTable.set(table, new Set(columns.map((column) => column.COLUMN_NAME || column.column_name)));
    }
    const migrationColumns = [
      [this.sessionsTable, 'Id', 'BIGINT UNSIGNED', null],
      [this.doctorsTable, 'DoctorId', 'VARCHAR(32)', 'user_id'],
      [this.patientsTable, 'PatientId', 'VARCHAR(64)', 'id'],
      [this.appointmentsTable, 'AppointId', 'VARCHAR(64)', 'id'],
      [this.prescriptionsTable, 'MedicationId', 'VARCHAR(64)', 'id'],
      [this.attachmentsTable, 'AttachId', 'VARCHAR(255)', 'id'],
    ];
    const pending = migrationColumns.filter(([table, column]) => !columnsByTable.get(table).has(column));
    if (pending.length) {
      for (const table of [this.sessionsTable, this.doctorsTable, this.patientsTable, this.appointmentsTable, this.prescriptionsTable, this.attachmentsTable]) {
        const constraints = await this.database.query(`
          SELECT constraint_name FROM information_schema.table_constraints
          WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_type = 'FOREIGN KEY'
        `, [table]);
        for (const constraint of constraints) {
          const name = constraint.CONSTRAINT_NAME || constraint.constraint_name;
          await this.database.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
        }
      }
      for (const [table, column, type, source] of pending) {
        if (column === 'Id') {
          await this.database.query(`ALTER TABLE \`${table}\` ADD COLUMN \`Id\` ${type} NOT NULL AUTO_INCREMENT UNIQUE FIRST`);
          await this.database.query(`ALTER TABLE \`${table}\` DROP PRIMARY KEY, ADD PRIMARY KEY (\`Id\`)`);
          continue;
        }
        await this.database.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type} NULL`);
        await this.database.query(`UPDATE \`${table}\` SET \`${column}\` = \`${source}\``);
        await this.database.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${type} NOT NULL`);
        await this.database.query(`ALTER TABLE \`${table}\` DROP PRIMARY KEY, ADD PRIMARY KEY (\`${column}\`)`);
      }
      if (columnsByTable.get(this.doctorsTable).has('user_id')) {
        await this.database.query(`ALTER TABLE \`${this.doctorsTable}\` DROP COLUMN \`user_id\``);
      }
      for (const [table, column, definition] of [
        [this.patientsTable, 'gender', "ENUM('Male', 'Female') NULL"],
        [this.patientsTable, 'age', 'TINYINT UNSIGNED NULL'],
      ]) {
        if (!columnsByTable.get(table).has(column)) {
          await this.database.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        }
      }
      const foreignKeys = [
        [this.sessionsTable, `${this.sessionsTable}_user_fk`, 'user_id', this.usersTable, 'id', 'CASCADE'],
        [this.doctorsTable, `${this.doctorsTable}_user_fk`, 'DoctorId', this.usersTable, 'user_id', 'CASCADE'],
        [this.patientsTable, `${this.patientsTable}_doctor_fk`, 'doctor_user_id', this.doctorsTable, 'DoctorId', 'RESTRICT'],
        [this.appointmentsTable, `${this.appointmentsTable}_doctor_fk`, 'doctor_user_id', this.doctorsTable, 'DoctorId', 'RESTRICT'],
        [this.appointmentsTable, `${this.appointmentsTable}_patient_fk`, 'patient_id', this.patientsTable, 'PatientId', 'RESTRICT'],
        [this.prescriptionsTable, `${this.prescriptionsTable}_doctor_fk`, 'doctor_user_id', this.doctorsTable, 'DoctorId', 'RESTRICT'],
        [this.prescriptionsTable, `${this.prescriptionsTable}_patient_fk`, 'patient_id', this.patientsTable, 'PatientId', 'RESTRICT'],
        [this.prescriptionsTable, `${this.prescriptionsTable}_appointment_fk`, 'appointment_id', this.appointmentsTable, 'AppointId', 'SET NULL'],
        [this.attachmentsTable, `${this.tablePrefix}_attachment_rx_fk`, 'prescription_id', this.prescriptionsTable, 'MedicationId', 'CASCADE'],
      ];
      for (const [table, constraint, column, parent, parentColumn, onDelete] of foreignKeys) {
        await this.database.query(`
          ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\`
          FOREIGN KEY (\`${column}\`) REFERENCES \`${parent}\` (\`${parentColumn}\`) ON DELETE ${onDelete}
        `);
      }
    }
    const patientColumns = await this.database.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
      [this.patientsTable],
    );
    const existingPatientColumns = new Set(patientColumns.map((column) => column.COLUMN_NAME || column.column_name));
    for (const [column, definition] of [
      ['gender', "ENUM('Male', 'Female') NULL"],
      ['age', 'TINYINT UNSIGNED NULL'],
    ]) {
      if (!existingPatientColumns.has(column)) {
        await this.database.query(`ALTER TABLE \`${this.patientsTable}\` ADD COLUMN \`${column}\` ${definition}`);
      }
    }
    const patientOptionalColumns = await this.database.query(`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
    `, [this.patientsTable]);
    for (const [column, definition] of [
      ['address', 'VARCHAR(300)'],
      ['email', 'VARCHAR(254)'],
      ['phone', 'VARCHAR(40)'],
      ['birth_date', 'DATE'],
    ]) {
      const existing = patientOptionalColumns.find((item) => (item.COLUMN_NAME || item.column_name) === column);
      if (existing && (existing.IS_NULLABLE || existing.is_nullable) === 'NO') {
        await this.database.query(`ALTER TABLE \`${this.patientsTable}\` MODIFY COLUMN \`${column}\` ${definition} NULL`);
      }
    }
    for (const [table, legacyColumn] of [
      [this.doctorsTable, 'user_id'],
      [this.patientsTable, 'id'],
      [this.appointmentsTable, 'id'],
      [this.prescriptionsTable, 'id'],
      [this.attachmentsTable, 'id'],
    ]) {
      const columns = await this.database.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
        [table],
      );
      if (!columns.some((column) => (column.COLUMN_NAME || column.column_name) === legacyColumn)) continue;
      if (table === this.doctorsTable) await this.dropForeignKeys(table);
      await this.database.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${legacyColumn}\``);
      if (table === this.doctorsTable) await this.ensureClinicalForeignKeys();
    }
  }

  async dropForeignKeys(table) {
    const constraints = await this.database.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_type = 'FOREIGN KEY'
    `, [table]);
    for (const constraint of constraints) {
      const name = constraint.CONSTRAINT_NAME || constraint.constraint_name;
      await this.database.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
    }
  }

  async ensureClinicalForeignKeys() {
    const foreignKeys = [
      [this.sessionsTable, `${this.sessionsTable}_user_fk`, 'user_id', this.usersTable, 'id', 'CASCADE'],
      [this.doctorsTable, `${this.doctorsTable}_user_fk`, 'DoctorId', this.usersTable, 'user_id', 'CASCADE'],
      [this.patientsTable, `${this.patientsTable}_doctor_fk`, 'doctor_user_id', this.doctorsTable, 'DoctorId', 'RESTRICT'],
      [this.appointmentsTable, `${this.appointmentsTable}_doctor_fk`, 'doctor_user_id', this.doctorsTable, 'DoctorId', 'RESTRICT'],
      [this.appointmentsTable, `${this.appointmentsTable}_patient_fk`, 'patient_id', this.patientsTable, 'PatientId', 'RESTRICT'],
      [this.prescriptionsTable, `${this.prescriptionsTable}_doctor_fk`, 'doctor_user_id', this.doctorsTable, 'DoctorId', 'RESTRICT'],
      [this.prescriptionsTable, `${this.prescriptionsTable}_patient_fk`, 'patient_id', this.patientsTable, 'PatientId', 'RESTRICT'],
      [this.prescriptionsTable, `${this.prescriptionsTable}_appointment_fk`, 'appointment_id', this.appointmentsTable, 'AppointId', 'SET NULL'],
      [this.attachmentsTable, `${this.tablePrefix}_attachment_rx_fk`, 'prescription_id', this.prescriptionsTable, 'MedicationId', 'CASCADE'],
    ];
    for (const [table, constraint, column, parent, parentColumn, onDelete] of foreignKeys) {
      const existing = await this.database.query(`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ? AND constraint_type = 'FOREIGN KEY'
      `, [table, constraint]);
      if (!existing.length) {
        await this.database.query(`
          ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\`
          FOREIGN KEY (\`${column}\`) REFERENCES \`${parent}\` (\`${parentColumn}\`) ON DELETE ${onDelete}
        `);
      }
    }
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

  async listPatients(doctorId = null) {
    const rows = await this.database.query(`
      SELECT PatientId, doctor_user_id, display_name, gender, age, address, email, phone,
        DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date,
        DATE_FORMAT(last_visit, '%Y-%m-%d') AS last_visit,
        initials, DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at
      FROM \`${this.patientsTable}\`
      ${doctorId ? 'WHERE doctor_user_id = ?' : ''}
      ORDER BY created_at DESC
    `, doctorId ? [doctorId] : []);
    return rows.map((patient) => ({
      id: patient.PatientId,
      persisted: true,
      doctorId: patient.doctor_user_id,
      name: patient.display_name,
      gender: patient.gender,
      age: Number(patient.age),
      address: patient.address || '',
      email: patient.email || '',
      phone: patient.phone || '',
      birthDate: patient.birth_date || '',
      lastVisit: patient.last_visit,
      initials: patient.initials,
      createdAt: patient.created_at,
    }));
  }

  async createPatient(doctorId, values) {
    const patient = validatePatient(values);
    const id = randomUUID();
    const initials = patient.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
    await this.database.query(`
      INSERT INTO \`${this.patientsTable}\`
        (PatientId, doctor_user_id, display_name, gender, age, address, email, phone, birth_date, last_visit, initials)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE(), ?)
    `, [id, doctorId, patient.name, patient.gender, patient.age, patient.address, patient.email, patient.phone, patient.birthDate, initials]);
    return (await this.listPatients(doctorId)).find((item) => item.id === id);
  }

  async updatePatient(doctorId, patientId, values) {
    const patient = validatePatient(values);
    const initials = patient.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
    await this.database.query(`
      UPDATE \`${this.patientsTable}\`
      SET display_name = ?, gender = ?, age = ?, address = ?, email = ?, phone = ?, birth_date = ?, initials = ?
      WHERE PatientId = ? AND doctor_user_id = ?
    `, [patient.name, patient.gender, patient.age, patient.address, patient.email, patient.phone, patient.birthDate, initials, patientId, doctorId]);
    return (await this.listPatients(doctorId)).find((item) => item.id === patientId) || null;
  }

  async listAppointments(doctorId = null) {
    const rows = await this.database.query(`
      SELECT AppointId, doctor_user_id, patient_id,
        DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appointment_date,
        TIME_FORMAT(appointment_time, '%H:%i') AS appointment_time,
        visit_type, room, status
      FROM \`${this.appointmentsTable}\`
      ${doctorId ? 'WHERE doctor_user_id = ?' : ''}
      ORDER BY appointment_date, appointment_time
    `, doctorId ? [doctorId] : []);
    return rows.map((appointment) => ({
      id: appointment.AppointId,
      doctorId: appointment.doctor_user_id,
      patientId: appointment.patient_id,
      date: appointment.appointment_date,
      time: appointment.appointment_time,
      type: appointment.visit_type,
      room: appointment.room,
      status: appointment.status,
    }));
  }

  async createAppointment(doctorId, values) {
    const appointment = validateAppointment(values);
    const patients = await this.database.query(
      `SELECT PatientId FROM \`${this.patientsTable}\` WHERE PatientId = ? AND doctor_user_id = ?`,
      [appointment.patientId, doctorId],
    );
    if (!patients[0]) return null;
    const id = randomUUID();
    await this.database.query(`
      INSERT INTO \`${this.appointmentsTable}\`
        (AppointId, doctor_user_id, patient_id, appointment_date, appointment_time, visit_type, room, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, doctorId, appointment.patientId, appointment.date, appointment.time, appointment.type, appointment.room, appointment.status]);
    return (await this.listAppointments(doctorId)).find((item) => item.id === id);
  }

  async updateAppointment(doctorId, appointmentId, values) {
    const appointment = validateAppointment(values);
    const patients = await this.database.query(
      `SELECT PatientId FROM \`${this.patientsTable}\` WHERE PatientId = ? AND doctor_user_id = ?`,
      [appointment.patientId, doctorId],
    );
    if (!patients[0]) return null;
    const result = await this.database.query(`
      UPDATE \`${this.appointmentsTable}\`
      SET patient_id = ?, appointment_date = ?, appointment_time = ?, visit_type = ?, room = ?, status = ?
      WHERE AppointId = ? AND doctor_user_id = ?
    `, [appointment.patientId, appointment.date, appointment.time, appointment.type, appointment.room, appointment.status, appointmentId, doctorId]);
    if (!result.affectedRows) {
      const existing = await this.database.query(
        `SELECT AppointId FROM \`${this.appointmentsTable}\` WHERE AppointId = ? AND doctor_user_id = ?`,
        [appointmentId, doctorId],
      );
      if (!existing[0]) return null;
    }
    return (await this.listAppointments(doctorId)).find((item) => item.id === appointmentId) || null;
  }

  async deleteAppointment(doctorId, appointmentId) {
    const result = await this.database.query(
      `DELETE FROM \`${this.appointmentsTable}\` WHERE AppointId = ? AND doctor_user_id = ?`,
      [appointmentId, doctorId],
    );
    return result.affectedRows > 0;
  }

  async listPrescriptions(doctorId = null) {
    const prescriptions = await this.database.query(`
      SELECT MedicationId, doctor_user_id, patient_id, appointment_id, medication, directions, refills, status,
        DATE_FORMAT(review_date, '%Y-%m-%d') AS review_date, notes
      FROM \`${this.prescriptionsTable}\`
      ${doctorId ? 'WHERE doctor_user_id = ?' : ''}
      ORDER BY created_at DESC
    `, doctorId ? [doctorId] : []);
    if (!prescriptions.length) return [];
    const attachments = await this.database.query(`
      SELECT attachment.AttachId, attachment.prescription_id, attachment.file_name, attachment.content_type, attachment.file_size
      FROM \`${this.attachmentsTable}\` AS attachment
      JOIN \`${this.prescriptionsTable}\` AS prescription ON prescription.MedicationId = attachment.prescription_id
      ${doctorId ? 'WHERE prescription.doctor_user_id = ?' : ''}
      ORDER BY attachment.created_at, attachment.AttachId
    `, doctorId ? [doctorId] : []);
    const attachmentsByPrescription = new Map();
    for (const attachment of attachments) {
      const list = attachmentsByPrescription.get(attachment.prescription_id) || [];
      list.push({
        id: attachment.AttachId,
        name: attachment.file_name,
        type: attachment.content_type,
        size: Number(attachment.file_size),
      });
      attachmentsByPrescription.set(attachment.prescription_id, list);
    }
    return prescriptions.map((prescription) => ({
      id: prescription.MedicationId,
      doctorId: prescription.doctor_user_id,
      patientId: prescription.patient_id,
      appointmentId: prescription.appointment_id,
      medication: prescription.medication,
      directions: prescription.directions,
      refills: Number(prescription.refills),
      status: prescription.status,
      expires: prescription.review_date,
      notes: prescription.notes,
      attachments: attachmentsByPrescription.get(prescription.MedicationId) || [],
    }));
  }

  async createPrescription(doctorId, values) {
    const prescription = validatePrescription(values);
    const patientRows = await this.database.query(
      `SELECT PatientId FROM \`${this.patientsTable}\` WHERE PatientId = ? AND doctor_user_id = ?`,
      [prescription.patientId, doctorId],
    );
    if (!patientRows[0]) return null;
    let appointmentId = null;
    if (prescription.appointmentId) {
      const appointmentRows = await this.database.query(`
        SELECT AppointId FROM \`${this.appointmentsTable}\`
        WHERE AppointId = ? AND patient_id = ? AND doctor_user_id = ?
      `, [prescription.appointmentId, prescription.patientId, doctorId]);
      if (appointmentRows[0]) appointmentId = appointmentRows[0].AppointId;
    }
    const id = randomUUID();
    await this.database.query(`
      INSERT INTO \`${this.prescriptionsTable}\`
        (MedicationId, doctor_user_id, patient_id, appointment_id, medication, directions, refills, status, review_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, doctorId, prescription.patientId, appointmentId, prescription.medication, prescription.directions,
      prescription.refills, prescription.status, prescription.expires, prescription.notes]);
    return (await this.listPrescriptions(doctorId)).find((item) => item.id === id);
  }

  async updatePrescription(doctorId, prescriptionId, values) {
    const prescription = validatePrescription(values);
    const patientRows = await this.database.query(
      `SELECT PatientId FROM \`${this.patientsTable}\` WHERE PatientId = ? AND doctor_user_id = ?`,
      [prescription.patientId, doctorId],
    );
    if (!patientRows[0]) return null;
    const existingRows = await this.database.query(
      `SELECT MedicationId FROM \`${this.prescriptionsTable}\` WHERE MedicationId = ? AND doctor_user_id = ?`,
      [prescriptionId, doctorId],
    );
    if (!existingRows[0]) return null;
    let appointmentId = null;
    if (prescription.appointmentId) {
      const appointmentRows = await this.database.query(`
        SELECT AppointId FROM \`${this.appointmentsTable}\`
        WHERE AppointId = ? AND patient_id = ? AND doctor_user_id = ?
      `, [prescription.appointmentId, prescription.patientId, doctorId]);
      if (appointmentRows[0]) appointmentId = appointmentRows[0].AppointId;
    }
    await this.database.query(`
      UPDATE \`${this.prescriptionsTable}\`
      SET patient_id = ?, appointment_id = ?, medication = ?, directions = ?, refills = ?, status = ?, review_date = ?, notes = ?
      WHERE MedicationId = ? AND doctor_user_id = ?
    `, [prescription.patientId, appointmentId, prescription.medication, prescription.directions, prescription.refills,
      prescription.status, prescription.expires, prescription.notes, prescriptionId, doctorId]);
    return (await this.listPrescriptions(doctorId)).find((item) => item.id === prescriptionId) || null;
  }

  async deletePrescription(doctorId, prescriptionId) {
    const result = await this.database.query(
      `DELETE FROM \`${this.prescriptionsTable}\` WHERE MedicationId = ? AND doctor_user_id = ?`,
      [prescriptionId, doctorId],
    );
    return result.affectedRows > 0;
  }

  async addPrescriptionAttachment(doctorId, prescriptionId, { name, type, data }) {
    const fileName = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    const contentType = typeof type === 'string' ? type.toLowerCase() : '';
    if (!fileName || fileName.length > 255) throw new Error('Enter a valid attachment file name.');
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) {
      throw new Error('Attachments must be a PDF or image file.');
    }
    if (!Buffer.isBuffer(data) || data.length < 1 || data.length > 20 * 1024 * 1024) {
      throw new Error('Each attachment must be between 1 byte and 20 MB.');
    }
    const prescriptionRows = await this.database.query(
      `SELECT MedicationId FROM \`${this.prescriptionsTable}\` WHERE MedicationId = ? AND doctor_user_id = ?`,
      [prescriptionId, doctorId],
    );
    if (!prescriptionRows[0]) return null;
    const countRows = await this.database.query(
      `SELECT COUNT(*) AS attachment_count FROM \`${this.attachmentsTable}\` WHERE prescription_id = ?`,
      [prescriptionId],
    );
    if (Number(countRows[0].attachment_count) >= 5) throw new Error('A prescription can have at most 5 attachments.');
    const id = randomUUID();
    await this.database.query(`
      INSERT INTO \`${this.attachmentsTable}\` (AttachId, prescription_id, file_name, content_type, file_size, file_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, prescriptionId, fileName, contentType, data.length, data]);
    return { id, name: fileName, type: contentType, size: data.length };
  }

  async getPrescriptionAttachment(doctorId, prescriptionId, attachmentId) {
    const rows = await this.database.query(`
      SELECT attachment.file_name, attachment.content_type, attachment.file_data
      FROM \`${this.attachmentsTable}\` AS attachment
      JOIN \`${this.prescriptionsTable}\` AS prescription ON prescription.MedicationId = attachment.prescription_id
      WHERE prescription.MedicationId = ? AND prescription.doctor_user_id = ? AND attachment.AttachId = ?
    `, [prescriptionId, doctorId, attachmentId]);
    return rows[0] ? { name: rows[0].file_name, type: rows[0].content_type, data: rows[0].file_data } : null;
  }

  async deletePrescriptionAttachment(doctorId, prescriptionId, attachmentId) {
    const result = await this.database.query(`
      DELETE attachment FROM \`${this.attachmentsTable}\` AS attachment
      JOIN \`${this.prescriptionsTable}\` AS prescription ON prescription.MedicationId = attachment.prescription_id
      WHERE prescription.MedicationId = ? AND prescription.doctor_user_id = ? AND attachment.AttachId = ?
    `, [prescriptionId, doctorId, attachmentId]);
    return result.affectedRows > 0;
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
      SELECT doctors.DoctorId AS user_id, users.display_name, users.email, doctors.specialty, doctors.address,
        doctors.package_name, doctors.register_date, doctors.last_renewal, users.must_change_password,
        DATE_FORMAT(users.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM \`${this.usersTable}\` AS users
      JOIN \`${this.doctorsTable}\` AS doctors ON doctors.DoctorId = users.user_id
      WHERE users.role = 'doctor' ORDER BY users.display_name
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
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(`
        INSERT INTO \`${this.usersTable}\` (user_id, display_name, email, specialty, role, password_salt, password_hash, must_change_password, address, package_name, register_date, last_renewal)
        VALUES (?, ?, ?, ?, 'doctor', ?, ?, 1, ?, ?, ?, ?)
      `, [userId.trim(), name.trim(), email.trim().toLowerCase(), specialty.trim(), salt, hash, profile.address, profile.packageName, profile.registerDate, profile.lastRenewal]);
      await connection.query(`
        INSERT INTO \`${this.doctorsTable}\` (DoctorId, specialty, address, package_name, register_date, last_renewal)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [userId.trim(), specialty.trim(), profile.address, profile.packageName, profile.registerDate, profile.lastRenewal]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { temporaryPassword };
  }

  async updateDoctorProfile(userId, profileValues) {
    const doctors = await this.database.query(
      `SELECT DoctorId FROM \`${this.doctorsTable}\` WHERE DoctorId = ?`,
      [userId],
    );
    const doctor = doctors[0];
    if (!doctor) return null;
    const profile = validateDoctorProfile(profileValues);
    await this.database.query(
      `UPDATE \`${this.doctorsTable}\` SET address = ?, package_name = ?, register_date = ?, last_renewal = ? WHERE DoctorId = ?`,
      [profile.address, profile.packageName, profile.registerDate, profile.lastRenewal, doctor.DoctorId],
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
