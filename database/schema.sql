-- DocVisitMobile MariaDB schema
-- Select the target database in phpMyAdmin before importing this file.
-- The Node.js app migrates existing deployments on startup.
-- Never insert plaintext passwords into the database.

CREATE TABLE IF NOT EXISTS `docvisit_users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(32) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL,
  `email` VARCHAR(254) NOT NULL,
  `specialty` VARCHAR(120) NOT NULL DEFAULT '',
  `role` ENUM('superadmin', 'doctor') NOT NULL,
  `password_salt` CHAR(32) NOT NULL,
  `password_hash` CHAR(128) NOT NULL,
  `must_change_password` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `address` VARCHAR(300) NOT NULL DEFAULT '',
  `package_name` VARCHAR(30) NOT NULL DEFAULT '3 months',
  `register_date` CHAR(10) NOT NULL DEFAULT '',
  `last_renewal` CHAR(10) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `docvisit_sessions` (
  `Id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash` CHAR(64) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `expires_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `sessions_token_hash` (`token_hash`),
  KEY `sessions_expiry` (`expires_at`),
  CONSTRAINT `docvisit_sessions_user_fk`
    FOREIGN KEY (`user_id`) REFERENCES `docvisit_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `docvisit_doctors` (
  `DoctorId` VARCHAR(32) NOT NULL,
  `specialty` VARCHAR(120) NOT NULL DEFAULT '',
  `address` VARCHAR(300) NOT NULL DEFAULT '',
  `package_name` VARCHAR(30) NOT NULL DEFAULT '3 months',
  `register_date` CHAR(10) NOT NULL DEFAULT '',
  `last_renewal` CHAR(10) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`DoctorId`),
  CONSTRAINT `docvisit_doctors_user_fk`
    FOREIGN KEY (`DoctorId`) REFERENCES `docvisit_users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `docvisit_patients` (
  `PatientId` VARCHAR(64) NOT NULL,
  `doctor_user_id` VARCHAR(32) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL,
  `gender` ENUM('Male', 'Female') NOT NULL,
  `age` TINYINT UNSIGNED NOT NULL,
  `address` VARCHAR(300) NULL,
  `email` VARCHAR(254) NULL,
  `phone` VARCHAR(40) NULL,
  `birth_date` DATE NULL,
  `last_visit` DATE NULL,
  `initials` VARCHAR(4) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`PatientId`),
  KEY `patients_doctor_name` (`doctor_user_id`, `display_name`),
  KEY `patients_email` (`email`),
  CONSTRAINT `docvisit_patients_doctor_fk`
    FOREIGN KEY (`doctor_user_id`) REFERENCES `docvisit_doctors` (`DoctorId`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `docvisit_appointments` (
  `AppointId` VARCHAR(64) NOT NULL,
  `doctor_user_id` VARCHAR(32) NOT NULL,
  `patient_id` VARCHAR(64) NOT NULL,
  `appointment_date` DATE NOT NULL,
  `appointment_time` TIME NOT NULL,
  `visit_type` VARCHAR(80) NOT NULL,
  `room` VARCHAR(40) NOT NULL DEFAULT '',
  `status` VARCHAR(32) NOT NULL DEFAULT 'Confirmed',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`AppointId`),
  KEY `appointments_doctor_schedule` (`doctor_user_id`, `appointment_date`, `appointment_time`),
  KEY `appointments_patient_history` (`patient_id`, `appointment_date`),
  CONSTRAINT `docvisit_appointments_doctor_fk`
    FOREIGN KEY (`doctor_user_id`) REFERENCES `docvisit_doctors` (`DoctorId`) ON DELETE RESTRICT,
  CONSTRAINT `docvisit_appointments_patient_fk`
    FOREIGN KEY (`patient_id`) REFERENCES `docvisit_patients` (`PatientId`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `docvisit_prescriptions` (
  `MedicationId` VARCHAR(64) NOT NULL,
  `doctor_user_id` VARCHAR(32) NOT NULL,
  `patient_id` VARCHAR(64) NOT NULL,
  `appointment_id` VARCHAR(64) NULL,
  `medication` VARCHAR(200) NOT NULL,
  `directions` VARCHAR(500) NOT NULL,
  `refills` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'Active',
  `review_date` DATE NOT NULL,
  `notes` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`MedicationId`),
  KEY `prescriptions_doctor_status` (`doctor_user_id`, `status`, `review_date`),
  KEY `prescriptions_patient_history` (`patient_id`, `created_at`),
  KEY `prescriptions_appointment` (`appointment_id`),
  CONSTRAINT `docvisit_prescriptions_doctor_fk`
    FOREIGN KEY (`doctor_user_id`) REFERENCES `docvisit_doctors` (`DoctorId`) ON DELETE RESTRICT,
  CONSTRAINT `docvisit_prescriptions_patient_fk`
    FOREIGN KEY (`patient_id`) REFERENCES `docvisit_patients` (`PatientId`) ON DELETE RESTRICT,
  CONSTRAINT `docvisit_prescriptions_appointment_fk`
    FOREIGN KEY (`appointment_id`) REFERENCES `docvisit_appointments` (`AppointId`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `docvisit_prescription_attachments` (
  `AttachId` VARCHAR(255) NOT NULL,
  `prescription_id` VARCHAR(64) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `content_type` VARCHAR(127) NOT NULL,
  `file_size` INT UNSIGNED NOT NULL,
  `file_data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`AttachId`),
  KEY `attachments_prescription` (`prescription_id`),
  CONSTRAINT `docvisit_attachment_rx_fk`
    FOREIGN KEY (`prescription_id`) REFERENCES `docvisit_prescriptions` (`MedicationId`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
