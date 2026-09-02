# Architecture Specification: MySQL-Backed Durable Delayed Job Queue

## 1. System Overview

The system is a production-grade, fault-tolerant, lease-based distributed job queue using MySQL 8.0+ as the single source of truth. It delivers **at-least-once execution guarantees** across concurrent worker nodes, ensuring jobs are never lost, never executed concurrently by multiple active workers, and recover reliably after worker crashes.

```
┌────────────────────────────────────────────────────────┐
│                      Angular UI                        │
│         (State-grouped view, attempt audits)           │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Express REST API                     │
│            (Read models, Requeue endpoints)            │
└───────────────────────────┬────────────────────────────┘
                            │
                            │ Connection Pool
                            ▼
┌──────────────────┐  ┌──────────────────────────────────┐  ┌──────────────────┐
│  Producer Node   ├─►│         MySQL 8.0 Database       │◄─┤  Worker Node 1   │
│  (Seed CSV Load) │  │  - jobs (State, Lease Token)     │  │  (Atomic Claim)  │
└──────────────────┘  │  - job_attempts (Audit History)  │  └──────────────────┘
                      └────────────────▲─────────────────┘
                                       │
                                       │ SELECT FOR UPDATE SKIP LOCKED
                                       │
                      ┌────────────────┴─────────────────┐
                      │          Worker Node 2           │
                      │      (Atomic Claim / Drain)      │
                      └──────────────────────────────────┘
```

---

## 2. Job State Machine & Lifecycle Invariants

```
               [ Enqueue / Producer Seed ]
                            │
                            ▼
                      ┌───────────┐
             ┌───────►│   READY   │◄─────────────────────────┐
             │        └─────┬─────┘                          │
             │              │                                │
             │              │ Claim / Reclaim (Atomic)       │ Requeue (POST /api/jobs/:id/requeue)
             │              │ [Generates unique lease_token] │
             │              ▼                                │
             │        ┌───────────┐                          │
             │        │  RUNNING  │                          │
             │        └──┬──┬──┬──┘                          │
             │           │  │  │                             │
Failure      │           │  │  │ Success (with token fencing)│
(Attempts <  │           │  │  └───────────────────┐         │
MaxAttempts) │           │  │                      ▼         │
             └───────────┘  │                 ┌──────────┐   │
                            │ Failure         │   DONE   │   │
                            │ (Exhausted)     └──────────┘   │
                            ▼                                │
                      ┌─────────────┐                        │
                      │ DEAD_LETTER ├────────────────────────┘
                      └─────────────┘

Crash Recovery:
  RUNNING (Worker crashes/stalls) ───[ lease_until < NOW() ]───► Reclaimed by Worker B (New lease_token, old attempt closed as TIMED_OUT)
```

### State Definitions & Invariants

1. **`READY`**:
   - Job is waiting for execution.
   - `run_after` is set to the scheduled execution time.
   - `lease_owner = NULL`, `lease_token = NULL`, `lease_until = NULL`.
2. **`RUNNING`**:
   - Job is leased to an active worker.
   - `lease_owner` contains the worker's unique ID.
   - `lease_token` contains a freshly generated UUID for this exact execution attempt.
   - `lease_until` contains the expiration timestamp computed at claim/reclaim time.
3. **`DONE`**:
   - Terminal success state.
   - `completed_at` is set.
   - `lease_owner = NULL`, `lease_token = NULL`, `lease_until = NULL`.
4. **`DEAD_LETTER`**:
   - Terminal failure state after retry exhaustion.
   - Retains original payload, `last_error`, and all associated attempt history in `job_attempts`.
   - `lease_owner = NULL`, `lease_token = NULL`, `lease_until = NULL`.

---

## 3. Database Schema & Indexing

### `jobs` Table
```sql
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
) ENGINE=InnoDB;
```

### `job_attempts` Table
```sql
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
) ENGINE=InnoDB;
```

---

## 4. First-Class Claim & Reclaim Protocol

### Atomic Claim & Reclaim Algorithm
Both claiming a `READY` job and reclaiming an expired `RUNNING` job execute within an atomic, short-lived database transaction (<5ms):

```sql
START TRANSACTION;

-- 1. Atomically locate and lock the next due or expired job without blocking concurrent workers
SELECT id, job_id, payload, status, attempt_count, max_attempts, fail_times, lease_token
FROM jobs
WHERE (status = 'READY' AND run_after <= NOW(3))
   OR (status = 'RUNNING' AND lease_until < NOW(3))
ORDER BY run_after ASC, id ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

If a row is matched:
1. **Determine Operation Type**:
   - If `status == 'RUNNING'`: This is a **Reclaim**.
     - Find the prior open attempt for this job (`status = 'RUNNING'`) and close it:
       ```sql
       UPDATE job_attempts
       SET status = 'TIMED_OUT',
           finished_at = NOW(3),
           error_message = 'Lease expired; execution reclaimed by new worker'
       WHERE job_id = :job_id AND status = 'RUNNING';
       ```
2. **Generate New Fencing Token & Lease Expiration**:
   - Compute `new_lease_token = crypto.randomUUID()`.
   - Compute absolute timestamp in application code: `new_lease_until = new Date(Date.now() + leaseDurationMs)`.
   - Increment attempt counter: `new_attempt_count = attempt_count + 1`.
   - Determine next attempt number monotonically: `attempt_number = (SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM job_attempts WHERE job_id = :job_id)`.
3. **Update Job State**:
   ```sql
   UPDATE jobs
   SET status = 'RUNNING',
       lease_owner = :worker_id,
       lease_token = :new_lease_token,
       lease_until = :new_lease_until,
       attempt_count = :new_attempt_count,
       updated_at = NOW(3)
   WHERE id = :id;
   ```
4. **Insert New Attempt Record**:
   ```sql
   INSERT INTO job_attempts (job_id, attempt_number, worker_id, lease_token, started_at, status, created_at, updated_at)
   VALUES (:job_id, :attempt_number, :worker_id, :new_lease_token, NOW(3), 'RUNNING', NOW(3), NOW(3));
   ```
5. `COMMIT;`

---

## 5. Explicit Execution Fencing (Zombie Worker Protection)

When an opaque handler finishes, Worker A commits the outcome (Success or Failure) with strict token fencing:

```sql
START TRANSACTION;

UPDATE jobs
SET status = 'DONE',
    completed_at = NOW(3),
    lease_owner = NULL,
    lease_token = NULL,
    lease_until = NULL,
    updated_at = NOW(3)
WHERE id = :id AND status = 'RUNNING' AND lease_token = :lease_token;
```

### Stale Worker Defense Scenario
1. Worker A claims Job 1 with `lease_token = "token-A"`.
2. Worker A's handler experiences a delay beyond `lease_until`.
3. Worker B reclaims Job 1, updating `jobs` with `lease_token = "token-B"` and closing Attempt A as `TIMED_OUT`.
4. Worker A wakes up and attempts to finalize Job 1 with `lease_token = "token-A"`.
5. The `UPDATE` query matches **0 rows** (`affectedRows == 0`).
6. Worker A detects fence invalidation, aborts its update, logs `LEASE_FENCE_LOST`, and releases its connection without corrupting Worker B's active execution or outcome.

---

## 6. Attempt Count, Retry, & Dead-Letter Semantics

### Retry Policy
- `max_attempts` default is 3.
- `attempt_count` tracks attempts in the current execution cycle (starts at 0, incremented to 1 upon first claim).
- On handler failure:
  - If `attempt_count < max_attempts`:
    - Compute backoff delay: $\text{delay} = \min(\text{baseDelay} \times 2^{\text{attempt\_count} - 1}, \text{maxDelay})$.
    - Next `run_after = NOW() + delay`.
    - `status = 'READY'`.
    - Clear lease fields (`lease_owner = NULL`, `lease_token = NULL`, `lease_until = NULL`).
    - Mark attempt in `job_attempts` as `FAILED` with `error_message` and `finished_at = NOW(3)`.
  - If `attempt_count >= max_attempts`:
    - `status = 'DEAD_LETTER'`.
    - `last_error = error_message`.
    - Clear lease fields.
    - Mark attempt in `job_attempts` as `FAILED`.

### Dead-Letter Requeue Semantics
When a dead-lettered job is requeued (`POST /api/jobs/:id/requeue`):
1. Historical rows in `job_attempts` remain **100% intact and immutable** for complete historical auditability.
2. The job's state is reset:
   - `status = 'READY'`
   - `run_after = NOW()`
   - `attempt_count = 0` (fresh retry cycle)
   - `lease_owner = NULL`, `lease_token = NULL`, `lease_until = NULL`, `last_error = NULL`.
3. When claimed again, its new attempt number in `job_attempts` will be sequentially `COALESCE(MAX(attempt_number), 0) + 1` (e.g., Attempt #4), preserving continuous history while granting a fresh cycle of attempts.

---

## 7. Layered Architecture & Dependency Direction

```
 packages/core/domain/      (Pure TypeScript domain models, interfaces, state machine rules, retry math)
        ▲
        │ (implements contracts)
 packages/core/repositories/(Sequelize database models, transactional SQL queries, claim/reclaim protocol)
        ▲
 ┌──────┴───────────────────────────┬─────────────────────────────────┐
 │                                  │                                 │
apps/worker/                   apps/api/                         apps/producer/
(Poller, Handler, Runner)      (Express Controller & DTOs)       (CSV Loader & Idempotent Upsert)
```
- **Domain layer** has zero external dependencies on Sequelize, Express, or network libraries.
- **Repository layer** isolates all SQL / transaction logic.
- **Worker/API layers** interact via domain services and repositories.

---

## 8. Test Matrix

- **T1**: Run When Due (`READY -> RUNNING -> DONE` with 1 attempt).
- **T2**: Concurrent Claiming (2 workers race for 1 due job; exactly 1 claims and executes).
- **T3**: Crash Recovery Mid-Job (Worker 1 killed -> lease expires -> Worker 2 reclaims -> completes; Attempt 1 marked `TIMED_OUT`, Attempt 2 marked `SUCCEEDED`).
- **T4**: Retry Exhaustion & Requeue (`READY -> RUNNING -> FAILED (3x) -> DEAD_LETTER -> POST /requeue -> READY -> DONE`; all 4 attempt records preserved).
- **T5 (Fencing)**: Stale Worker Reclaim Race (Worker A claims -> lease expires -> Worker B reclaims -> Worker A attempts completion -> Worker A rejected via fencing token).
- **T6 (Worker Restart)**: Worker Identity Reuse (Worker with identical worker ID but expired token cannot commit completion).
