-- DocVisitMobile MariaDB schema
-- Select the target database in phpMyAdmin before importing this file.
-- The application creates its initial superadmin through SUPERADMIN_PASSWORD;
-- never insert plaintext passwords into this database.

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
  `token_hash` CHAR(64) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `expires_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `sessions_expiry` (`expires_at`),
  CONSTRAINT `docvisit_sessions_user_fk`
    FOREIGN KEY (`user_id`) REFERENCES `docvisit_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
