# 🧪 Automated Acceptance & Unit Testing Guide

This document provides step-by-step instructions for running and verifying all **17 automated test suites** in the **Durable MySQL Delayed Job Queue** repository.

---

## ⚡ Quick Test Execution (1-Command Runner)

To run the entire test suite (Unit Tests + Acceptance Tests T1 through T7):

```bash
npm test
```

### Expected Output:
```text
PASS tests/acceptance/api.test.ts
PASS tests/acceptance/t1-due-execution.test.ts
PASS tests/acceptance/t2-concurrency-claim.test.ts
PASS tests/acceptance/t3-crash-recovery.test.ts
PASS tests/acceptance/t4-retry-deadletter-requeue.test.ts
PASS tests/acceptance/t5-stale-fencing.test.ts
PASS tests/acceptance/t6-worker-identity-reuse.test.ts
PASS tests/acceptance/t7-restart-midrun.test.ts
PASS tests/unit/lease-policy.test.ts
PASS tests/unit/retry-policy.test.ts

Test Suites: 10 passed, 10 total
Tests:       17 passed, 17 total
Snapshots:   0 total
Time:        ~7-10s
```

---

## 📋 Individual Acceptance Test Scenarios (T1 to T7)

You can run each acceptance scenario individually using Jest:

### 1. Scenario T1: Runs When Due (Delayed Execution)
* **What it tests**: A job scheduled with an offset waits in `READY` and is only claimed when its `run_after` timestamp arrives.
```bash
npx jest tests/acceptance/t1-due-execution.test.ts
```

---

### 2. Scenario T2: One Owner (Concurrency Race)
* **What it tests**: Two workers poll for the same due job at the exact same millisecond. Proves that `SELECT ... FOR UPDATE SKIP LOCKED` guarantees exactly one worker claims it with 0 duplicate executions.
```bash
npx jest tests/acceptance/t2-concurrency-claim.test.ts
```

---

### 3. Scenario T3: Crash Mid-Job (Lease Recovery)
* **What it tests**: Worker 1 is killed while running a job. Proves that Worker 2 does *not* steal the job while the lease is valid, but automatically reclaims it once the lease expires.
```bash
npx jest tests/acceptance/t3-crash-recovery.test.ts
```

---

### 4. Scenario T4: Multi-Worker Retries & Dead-Letter Quarantine
* **What it tests**: 
  - **T4.1**: Worker 1 fails on Attempt 1 $\rightarrow$ schedules backoff $\rightarrow$ Worker 2 picks up Attempt 2 and succeeds.
  - **T4.2**: Job fails 3 times across alternating workers $\rightarrow$ moves to `DEAD_LETTER` $\rightarrow$ Requeue resets to `READY` while preserving 100% of attempt history.
```bash
npx jest tests/acceptance/t4-retry-deadletter-requeue.test.ts
```

---

### 5. Scenario T5: Slow Job & Stale Fencing Defense
* **What it tests**: A slow/zombie worker takes longer than its lease. The job is reclaimed by another worker. When the zombie worker finally tries to mark the job `DONE`, its outdated fencing token is rejected (`LeaseFenceLostError`), preventing double-writes.
```bash
npx jest tests/acceptance/t5-stale-fencing.test.ts
```

---

### 6. Scenario T6: Worker Identity Reuse & Token Protection
* **What it tests**: Even if a restarted worker reuses the same name (`worker-1`), it cannot complete an old job if its specific attempt token has expired.
```bash
npx jest tests/acceptance/t6-worker-identity-reuse.test.ts
```

---

### 7. Scenario T7: Restart Mid-Run Recovery
* **What it tests**: Both workers are killed mid-run. Upon rebooting, fresh worker instances reconnect to MySQL and resume draining in-flight and pending jobs without data loss.
```bash
npx jest tests/acceptance/t7-restart-midrun.test.ts
```

---

## 🔬 Unit Tests

```bash
# Test mathematical exponential backoff formulas
npx jest tests/unit/retry-policy.test.ts

# Test lease expiration timestamp math
npx jest tests/unit/lease-policy.test.ts
```

---

## 🌐 API Acceptance Tests
```bash
npx jest tests/acceptance/api.test.ts
```
