# ⏱️ Durable MySQL Delayed Job Queue

> **A distributed, production-grade delayed job queue backed purely by MySQL 8.0 ACID primitives, featuring atomic row-level claiming, at-least-once delivery guarantees, lease-based crash recovery, execution fencing tokens, and an Angular 19 real-time dashboard.**

---

## 🚀 Beginner's Quick Start (Run with 1 Command)

### Prerequisites:
- **Docker Desktop** installed and running on your machine.
- **Node.js 18+** (if running automated tests locally).

### 1. Clone & Start the Entire Stack
From the project root directory, run:

```bash
docker-compose up -d --build
```

Docker will automatically spin up all **6 containers**:
1. **`mysql`**: MySQL 8.0 InnoDB database with millisecond timestamps (`port 3307`).
2. **`api`**: Express REST API backend (`http://localhost:3000`).
3. **`worker-1`**: Background Worker 1 Daemon.
4. **`worker-2`**: Background Worker 2 Daemon (executing in parallel).
5. **`producer`**: CSV seed ingestion daemon.
6. **`web`**: Angular 19 Real-Time Single-Page Dashboard (`http://localhost:4200`).

---

### 2. Open the Web Dashboard
Open your browser and navigate to:
👉 **[http://localhost:4200](http://localhost:4200)**

---

## 🖥️ Live Web Dashboard Features

- **Live Real-Time Sync**: Automatically polls MySQL state silently every 2 seconds without UI flickering.
- **Worker Attribution**: Displays whether `worker-1` or `worker-2` is actively running or completed each job.
- **Expandable Attempt Audit History**: Click any row to view full attempt history with timestamps, durations in milliseconds, and error messages.
- **1-Click Reset & Re-Seed Button**: Click **"Reset & Re-Seed"** in the top header and confirm to wipe all tables and reload the 15 seed jobs from `jobs_seed.csv` at $t=0$ for live presentations!
- **Dead-Letter Quarantine & 1-Click Requeue**: Click **"Requeue"** on any dead-lettered job to restart its retry cycle with preserved audit history.

---

## 🧪 How to Run Automated Tests

We include **17 automated tests** covering all acceptance criteria (T1 to T7):

```bash
# Run the complete test suite
npm test
```

For detailed per-scenario test commands and explanations, see **[`TESTING_GUIDE.md`](./TESTING_GUIDE.md)**:

| Scenario | Command |
| :--- | :--- |
| **T1: Due Execution** | `npx jest tests/acceptance/t1-due-execution.test.ts` |
| **T2: Concurrency Race** | `npx jest tests/acceptance/t2-concurrency-claim.test.ts` |
| **T3: Crash Recovery** | `npx jest tests/acceptance/t3-crash-recovery.test.ts` |
| **T4: Multi-Worker Retries & Dead-Letter** | `npx jest tests/acceptance/t4-retry-deadletter-requeue.test.ts` |
| **T5: Slow Job & Fencing Defense** | `npx jest tests/acceptance/t5-stale-fencing.test.ts` |
| **T6: Worker Identity Reuse** | `npx jest tests/acceptance/t6-worker-identity-reuse.test.ts` |
| **T7: Restart Mid-Run Recovery** | `npx jest tests/acceptance/t7-restart-midrun.test.ts` |

---

## 📐 Architecture & Core Invariants

### 1. Atomic Claiming without Race Conditions
Workers poll MySQL using row-level locking:
```sql
SELECT * FROM jobs 
WHERE status = 'READY' AND run_after <= NOW(3)
ORDER BY run_after ASC, id ASC 
LIMIT 1 
FOR UPDATE SKIP LOCKED;
```
- `FOR UPDATE`: Acquires an exclusive row lock on the first eligible job.
- `SKIP LOCKED`: Other concurrent workers skip locked rows without waiting, immediately claiming the next available job.

---

### 2. Bounded Exponential Backoff Retries
When a job encounters a transient failure, retry delays are calculated mathematically:
$$\text{delay} = \min(\text{baseDelay} \times 2^{\text{attempt} - 1}, \text{maxDelay})$$
- Attempt 1 failure: $+1\text{s}$ delay
- Attempt 2 failure: $+2\text{s}$ delay
- Attempt 3 failure: Reaches `max_attempts = 3` $\rightarrow$ Transitions to `DEAD_LETTER`.

---

### 3. Execution Fencing Token Defense
Every time a job is claimed or reclaimed, MySQL generates a unique UUID `lease_token`. When a worker completes a job, it updates MySQL conditionally:
```sql
UPDATE jobs 
SET status = 'DONE', completed_at = NOW(3)
WHERE id = :id AND status = 'RUNNING' AND lease_token = :token;
```
If a worker was slow or frozen past its 30s lease and another worker reclaimed it, the query matches `0` rows and raises `LeaseFenceLostError`, preventing zombie workers from corrupting the database.

---

### 4. Zero DB Connection Starvation on Slow Jobs
- Workers hold a MySQL database connection only for the **$\le 5\text{ms}$ atomic claim transaction**.
- During the entire execution of heavy jobs (e.g. 30 seconds), **zero database connections are held**.
- Other workers freely query and process jobs in parallel.

---

### 5. Idle Polling Backoff
When no jobs are due, workers exponentially back off polling intervals ($500\text{ms} \to 750\text{ms} \to \dots \to 3000\text{ms}$). This maintains near **0% database CPU utilization** when the queue is idle.

---

## 📁 Monorepo Folder Structure

```text
delayed-job-queue/
├── apps/
│   ├── api/              # Express REST API
│   ├── worker/           # Background Worker Daemon
│   ├── producer/         # CSV Seed Ingestion CLI
│   └── frontend/         # Angular 19 Dark-Themed SPA Dashboard
│
├── packages/
│   └── core/             # Shared Engine: Domain, Repositories, Sequelize Models
│
├── database/
│   └── schema.sql        # Standalone MySQL 8.0 DDL Schema
│
├── docker/               # Container Dockerfiles & Nginx Reverse Proxy Config
├── tests/                # Automated Acceptance & Unit Tests
├── TESTING_GUIDE.md      # Testing execution guide
├── architecture.md       # In-depth architectural design specification
└── docker-compose.yml    # Complete 1-command orchestration
```

---

## 🛑 Stop / Teardown Commands

```bash
# Stop all containers
docker-compose down

# Stop and wipe database volume for completely fresh start
docker-compose down -v
```
