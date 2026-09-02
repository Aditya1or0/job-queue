import { Sequelize } from 'sequelize';

export async function createSchema(sequelize: Sequelize): Promise<void> {
  const queryInterface = sequelize.getQueryInterface();

  // Create jobs table with microsecond precision and explicit indexes
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      status ENUM('READY', 'RUNNING', 'DONE', 'DEAD_LETTER') NOT NULL DEFAULT 'READY',
      run_after DATETIME(3) NOT NULL,
      attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
      max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
      lease_owner VARCHAR(128) NULL,
      lease_token VARCHAR(64) NULL,
      lease_until DATETIME(3) NULL,
      fail_times INT UNSIGNED NOT NULL DEFAULT 0,
      last_error TEXT NULL,
      completed_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

      INDEX idx_jobs_claim (status, run_after),
      INDEX idx_jobs_reclaim (status, lease_until),
      INDEX idx_jobs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Create job_attempts table
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS job_attempts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL,
      attempt_number INT UNSIGNED NOT NULL,
      worker_id VARCHAR(128) NOT NULL,
      lease_token VARCHAR(64) NOT NULL,
      started_at DATETIME(3) NOT NULL,
      finished_at DATETIME(3) NULL,
      status ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT') NOT NULL DEFAULT 'RUNNING',
      error_message TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

      INDEX idx_job_attempts_lookup (job_id, attempt_number),
      CONSTRAINT fk_job_attempts_job_id FOREIGN KEY (job_id) REFERENCES jobs (job_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

export async function dropSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`SET FOREIGN_KEY_CHECKS = 0;`);
  await sequelize.query(`DROP TABLE IF EXISTS job_attempts;`);
  await sequelize.query(`DROP TABLE IF EXISTS jobs;`);
  await sequelize.query(`SET FOREIGN_KEY_CHECKS = 1;`);
}
