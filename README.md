# Durable MySQL Delayed Job Queue

A high-reliability, fault-tolerant, lease-based distributed delayed job queue system backed by **MySQL 8.0+**, featuring atomic claiming, execution fencing tokens, bounded exponential backoff, crash recovery, complete attempt auditing, and a real-time Angular UI.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────┐
│                      Angular UI                        │
│            (Real-time State & Audit Log)               │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP (Port 4200/3000)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Express REST API                     │
│               (State Queries & Requeue)                │
└───────────────────────────┬────────────────────────────┘
                            │
                            │ Sequelize Connection Pool
                            ▼
┌──────────────────┐  ┌──────────────────────────────────┐  ┌──────────────────┐
│  Producer Node   ├─►│         MySQL 8.0 Database       │◄─┤  Worker Node 1   │
│  (Seed CSV Load) │  │  - jobs (State, Lease Token)     │  │  (Atomic Claim)  │
└──────────────────┘  │  - job_attempts (Audit Trail)    │  └──────────────────┘
                      └────────────────▲─────────────────┘
                                       │
                                       │ SELECT FOR UPDATE SKIP LOCKED
                                       │
                      ┌────────────────┴─────────────────┐
                      │          Worker Node 2           │
                      │      (Atomic Claim / Drain)      │
                      └──────────────────────────────────┘
```

### Architectural Boundaries
- **`packages/core`**: Pure domain entities, state machine rules, retry policies, Sequelize models, and transactional repositories.
- **`apps/worker`**: Distributed worker daemon executing atomic claims, running opaque handlers asynchronously with zero database connections held, and committing outcomes with execution fencing tokens.
- **`apps/producer`**: Ingestion service that parses `jobs_seed.csv` and idempotently enqueues jobs with calculated `run_after` timestamps.
- **`apps/api`**: REST visibility service providing aggregated state counts, job lists, full execution attempt timelines, and dead-letter requeue endpoints.
- **`apps/web`**: Single-page Angular application displaying live job states, KPI counters, and expandable execution attempt audits.

---

## 2. Values, Thresholds, and Business Logic

| Parameter | Default Value | Environment Variable | Rationale & Logic |
| :--- | :--- | :--- | :--- |
| **Lease Duration** | `30,000ms` (30s) | `LEASE_DURATION_MS` | Generous enough for slow handlers (up to 30s) to complete without false steal; short enough to recover crashed workers in 30s. |
| **Max Attempts** | `3` | `MAX_ATTEMPTS` | Maximum retry attempts per execution cycle before quarantining a job to `DEAD_LETTER`. |
| **Retry Base Delay** | `2,000ms` (2s) | `RETRY_BASE_DELAY_MS` | Initial backoff delay for the first retry. |
| **Retry Max Delay** | `60,000ms` (60s) | `RETRY_MAX_DELAY_MS` | Upper bound for exponential backoff delays. |
| **Polling Interval** | `500ms` | `POLL_INTERVAL_MS` | Base polling delay when active work is flowing. |
| **Max Poll Backoff** | `3,000ms` (3s) | `MAX_POLL_INTERVAL_MS` | Bounded idle backoff cap to prevent hammering MySQL when the queue is quiet. |

### Retry Delay Formula
$$\text{delay} = \min(\text{baseDelay} \times 2^{\text{attempt\_count} - 1}, \text{maxDelay})$$
- **Attempt 1 Failure** $\rightarrow$ delay $= 2000 \times 2^0 = 2,000\text{ms}$ (2s)
- **Attempt 2 Failure** $\rightarrow$ delay $= 2000 \times 2^1 = 4,000\text{ms}$ (4s)
- **Attempt 3 Failure** $\rightarrow$ $3 \ge \text{max\_attempts} \rightarrow$ transitions to **`DEAD_LETTER`**

---

## 3. The `fail_times` Column in `jobs_seed.csv`

The assignment seed file includes a `fail_times` column:
- `fail_times = 0`: Handler succeeds on Attempt #1 (e.g. `JOB-0001`).
- `fail_times = 1`: Handler fails once, then succeeds on retry Attempt #2 (e.g. `JOB-0003`).
- `fail_times = 2`: Handler fails twice, then succeeds on retry Attempt #3 (e.g. `JOB-0004`).
- `fail_times = 9`: Simulates a prolonged dependency outage. The job will fail attempts 1 to 9 before it succeeds.
  - On Cycle 1, it runs attempts 1, 2, 3 (all $\le 9$), and moves to `DEAD_LETTER`.
  - When requeued, it runs attempts 4, 5, 6 (all $\le 9$), and returns to `DEAD_LETTER`.
  - When requeued again, it runs attempts 7, 8, 9, and on attempt 10 ($10 > 9$) it finally succeeds!

---

## 4. Execution Semantics & Idempotency Guarantee

### At-Least-Once Delivery
This system provides **at-least-once execution semantics**. If a worker crashes or encounters an unrecoverable network partition after an external side-effect completes but before recording completion in MySQL, the job's lease will eventually expire and another worker will reclaim and re-execute it.

### Handler Obligation
Because jobs may be executed more than once under failure or crash conditions, **opaque handlers must be designed to be idempotent, duplicate-tolerant, or protected by an external idempotency key**.

---

## 5. Atomic Claiming & Concurrency Protection

To guarantee that two workers never simultaneously execute the same job, the claim operation utilizes MySQL 8.0's **`SELECT ... FOR UPDATE SKIP LOCKED`** inside a short-lived transaction (<5ms):

```sql
START TRANSACTION;

SELECT id, job_id, payload, status, attempt_count, max_attempts, fail_times, lease_token
FROM jobs
WHERE (status = 'READY' AND run_after <= NOW(3))
   OR (status = 'RUNNING' AND lease_until < NOW(3))
ORDER BY run_after ASC, id ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- Update job status and generate fresh fencing lease_token
UPDATE jobs
SET status = 'RUNNING',
    lease_owner = :worker_id,
    lease_token = :new_lease_token,
    lease_until = :new_lease_until,
    attempt_count = attempt_count + 1,
    updated_at = NOW(3)
WHERE id = :id;

INSERT INTO job_attempts (job_id, attempt_number, worker_id, lease_token, started_at, status, created_at, updated_at)
VALUES (:job_id, :attempt_number, :worker_id, :new_lease_token, NOW(3), 'RUNNING', NOW(3), NOW(3));

COMMIT;
```

**Why this is safe:**
- If Worker 1 and Worker 2 poll at the exact same millisecond, Worker 1 acquires an exclusive row lock on the first candidate.
- `SKIP LOCKED` instructs MySQL to immediately skip the locked row for Worker 2 without blocking or waiting, locking the next available job or returning zero rows.
- The transaction commits immediately, returning the DB connection to the pool **before** executing the handler.

---

## 6. Crash Recovery & Execution Fencing Tokens

### Zombie Worker / Stale Execution Defense
If Worker A claims a job, experiences an unexpected 40-second delay, its lease will expire. Worker B will then reclaim the job and generate a new `lease_token = "token-B"`.

When Worker A finally awakens and attempts to commit completion with its stale `lease_token = "token-A"`:
```sql
UPDATE jobs
SET status = 'DONE', completed_at = NOW(3), lease_owner = NULL, lease_token = NULL, lease_until = NULL
WHERE id = :id AND status = 'RUNNING' AND lease_token = :lease_token;
```
Because `lease_token` in the database is now `"token-B"`, the query matches **0 rows**. Worker A detects this fence invalidation, raises `LeaseFenceLostError`, and safely aborts without overwriting Worker B's progress.

### Reclaim Attempt Lifecycle
When an expired `RUNNING` job is reclaimed, the prior uncompleted attempt is closed atomically in `job_attempts` as **`TIMED_OUT`** with an error message and timestamp, before the new attempt is created.

---

## 7. Bounded Retries & Dead-Letter Requeue

### Dead-Letter State
When `attempt_count >= max_attempts`, the job transitions to `DEAD_LETTER`. It is **never deleted**; its payload and entire attempt history remain permanently inspectable.

### Requeue Semantics
Invoking `POST /api/jobs/:id/requeue`:
- Resets the job to `READY` with `run_after = NOW(3)` and `attempt_count = 0` (granting a fresh retry quota).
- **All historical attempt records are preserved untouched** in `job_attempts` for complete auditability.

---

## 8. How to Run Clean from Scratch

To wipe previous execution data and start fresh:

```bash
# 1. Stop all containers and delete the MySQL database volume
docker-compose down -v

# 2. Build and start the entire stack fresh
docker-compose up --build
```

### Access Points
- **Angular Dashboard**: [http://localhost:4200](http://localhost:4200)
- **API Health & Stats**: [http://localhost:3000/api/jobs](http://localhost:3000/api/jobs)

---

## 9. Running Tests

Run the complete automated test suite (including acceptance tests T1–T6 and unit tests):
```bash
npm test
```

### Specific Acceptance Suites:
- **T1: Due Execution**: `npx jest tests/acceptance/t1-due-execution.test.ts`
- **T2: Concurrency Claiming**: `npx jest tests/acceptance/t2-concurrency-claim.test.ts`
- **T3: Crash Recovery**: `npx jest tests/acceptance/t3-crash-recovery.test.ts`
- **T4: Retry & Dead-Letter Requeue**: `npx jest tests/acceptance/t4-retry-deadletter-requeue.test.ts`
- **T5: Stale Worker Fencing**: `npx jest tests/acceptance/t5-stale-fencing.test.ts`
- **T6: Worker Identity Reuse**: `npx jest tests/acceptance/t6-worker-identity-reuse.test.ts`
