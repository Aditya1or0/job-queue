-- =========================================================================
-- Durable MySQL Delayed Job Queue Database Schema
-- Backed by MySQL 8.0 with DATETIME(3) millisecond precision
-- =========================================================================

CREATE DATABASE IF NOT EXISTS `job_queue_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `job_queue_db`;

-- 1. Jobs Table (Durable Queue State)
CREATE TABLE IF NOT EXISTS `jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_id` VARCHAR(64) NOT NULL,
  `payload` TEXT NOT NULL,
  `status` ENUM('READY', 'RUNNING', 'DONE', 'DEAD_LETTER') NOT NULL DEFAULT 'READY',
  `run_after` DATETIME(3) NOT NULL,
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` INT UNSIGNED NOT NULL DEFAULT 3,
  `lease_owner` VARCHAR(128) NULL DEFAULT NULL,
  `lease_token` VARCHAR(64) NULL DEFAULT NULL,
  `lease_until` DATETIME(3) NULL DEFAULT NULL,
  `fail_times` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_error` TEXT NULL DEFAULT NULL,
  `completed_at` DATETIME(3) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jobs_job_id` (`job_id`),
  KEY `idx_jobs_claim` (`status`, `run_after`),
  KEY `idx_jobs_reclaim` (`status`, `lease_until`),
  KEY `idx_jobs_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Job Attempts Table (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS `job_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_id` VARCHAR(64) NOT NULL,
  `attempt_number` INT UNSIGNED NOT NULL,
  `worker_id` VARCHAR(128) NOT NULL,
  `lease_token` VARCHAR(64) NOT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL DEFAULT NULL,
  `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT') NOT NULL DEFAULT 'RUNNING',
  `error_message` TEXT NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_job_attempts_job_id` (`job_id`),
  KEY `idx_job_attempts_worker` (`worker_id`),
  KEY `idx_job_attempts_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
