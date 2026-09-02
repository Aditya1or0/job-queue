import os from 'os';
import crypto from 'crypto';
import { JobRepository } from '@core/repositories/job.repository';
import { RetryPolicy } from '@core/domain/retry-policy';
import { LeasePolicy } from '@core/domain/lease-policy';
import { ClaimedJob } from '@core/domain/job.types';
import { LeaseFenceLostError } from '@core/domain/job-errors';
import { JobHandler } from '../handlers/job-handler.interface';

export interface WorkerConfig {
  workerId?: string;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  leaseDurationMs?: number;
}

export class WorkerEngine {
  public readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private currentPollDelay: number;
  private isRunning: boolean = false;
  private stopRequested: boolean = false;

  constructor(
    private readonly jobRepo: JobRepository,
    private readonly handler: JobHandler,
    private readonly retryPolicy: RetryPolicy = new RetryPolicy(),
    private readonly leasePolicy: LeasePolicy = new LeasePolicy(),
    config?: WorkerConfig
  ) {
    const hostname = os.hostname().replace(/[^a-zA-Z0-9_-]/g, '');
    const pid = process.pid;
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    this.workerId = config?.workerId ?? `worker-${hostname}-${pid}-${randomSuffix}`;
    this.pollIntervalMs = config?.pollIntervalMs ?? 500;
    this.maxPollIntervalMs = config?.maxPollIntervalMs ?? 3000;
    this.leaseDurationMs = config?.leaseDurationMs ?? this.leasePolicy.leaseDurationMs;
    this.currentPollDelay = this.pollIntervalMs;
  }

  public log(event: string, meta: { jobId?: string; attempt?: number; durationMs?: number; error?: string; [k: string]: any } = {}) {
    const timestamp = new Date().toISOString();
    const metaParts = Object.entries(meta)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    console.log(`[${timestamp}] [${event.padEnd(20)}] [${this.workerId}] ${metaParts}`);
  }

  /**
   * Executes a single claim-process-commit iteration.
   * Returns true if a job was claimed and executed, false if no job was claimable.
   */
  public async runOnce(): Promise<boolean> {
    let claimedJob: ClaimedJob | null = null;

    try {
      // 1. ATOMIC CLAIM / RECLAIM (Short DB transaction)
      claimedJob = await this.jobRepo.claimNextDueOrExpiredJob(
        this.workerId,
        this.leaseDurationMs
      );
    } catch (claimErr: any) {
      this.log('CLAIM_ERROR', { error: claimErr.message });
      return false;
    }

    if (!claimedJob) {
      return false;
    }

    const startTime = Date.now();
    this.log(claimedJob.isReclaim ? 'JOB_RECLAIMED' : 'JOB_CLAIMED', {
      jobId: claimedJob.jobId,
      attempt: claimedJob.attemptNumber,
      attemptCount: claimedJob.attemptCount,
      leaseUntil: claimedJob.leaseUntil.toISOString()
    });

    this.log('JOB_STARTED', {
      jobId: claimedJob.jobId,
      attempt: claimedJob.attemptNumber,
      payload: claimedJob.payload
    });

    // 2. OPAQUE HANDLER EXECUTION (ZERO DB connections or transactions held)
    try {
      await this.handler.execute(claimedJob);

      const durationMs = Date.now() - startTime;

      // 3. ATOMIC SUCCESS COMMIT (Protected by execution fencing token)
      await this.jobRepo.finalizeJobSuccess(claimedJob.jobId, claimedJob.leaseToken);

      this.log('JOB_SUCCEEDED', {
        jobId: claimedJob.jobId,
        attempt: claimedJob.attemptNumber,
        durationMs
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      if (err instanceof LeaseFenceLostError) {
        this.log('LEASE_FENCE_LOST', {
          jobId: claimedJob.jobId,
          attempt: claimedJob.attemptNumber,
          error: `Execution completed or failed but lease fence was lost. Update rejected.`
        });
        return true;
      }

      const errorMessage = err.message ?? String(err);
      this.log('JOB_FAILED', {
        jobId: claimedJob.jobId,
        attempt: claimedJob.attemptNumber,
        durationMs,
        error: errorMessage
      });

      // Check retry bounds
      const isExhausted = this.retryPolicy.isRetryExhausted(
        claimedJob.attemptCount,
        claimedJob.maxAttempts
      );

      try {
        if (isExhausted) {
          await this.jobRepo.finalizeJobFailure(
            claimedJob.jobId,
            claimedJob.leaseToken,
            errorMessage,
            null,
            true // isDeadLetter
          );
          this.log('JOB_DEAD_LETTERED', {
            jobId: claimedJob.jobId,
            attempt: claimedJob.attemptNumber,
            totalAttempts: claimedJob.attemptCount,
            error: errorMessage
          });
        } else {
          const nextRunAfter = this.retryPolicy.calculateNextRunAfter(claimedJob.attemptCount);
          await this.jobRepo.finalizeJobFailure(
            claimedJob.jobId,
            claimedJob.leaseToken,
            errorMessage,
            nextRunAfter,
            false // isDeadLetter
          );
          this.log('JOB_RETRY_SCHEDULED', {
            jobId: claimedJob.jobId,
            attempt: claimedJob.attemptNumber,
            nextRunAfter: nextRunAfter.toISOString(),
            retryDelayMs: this.retryPolicy.calculateRetryDelay(claimedJob.attemptCount)
          });
        }
      } catch (finalizeErr: any) {
        if (finalizeErr instanceof LeaseFenceLostError) {
          this.log('LEASE_FENCE_LOST', {
            jobId: claimedJob.jobId,
            attempt: claimedJob.attemptNumber,
            error: `Failure recording rejected because lease fence was lost.`
          });
        } else {
          this.log('FINALIZE_ERROR', {
            jobId: claimedJob.jobId,
            error: finalizeErr.message
          });
        }
      }
    }

    return true;
  }

  /**
   * Starts the polling loop with bounded exponential idle backoff.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stopRequested = false;

    this.log('WORKER_STARTED', {
      pollIntervalMs: this.pollIntervalMs,
      maxPollIntervalMs: this.maxPollIntervalMs,
      leaseDurationMs: this.leaseDurationMs
    });

    while (!this.stopRequested) {
      try {
        const processed = await this.runOnce();

        if (processed) {
          // Immediately reset backoff to drain queue without unnecessary delays
          this.currentPollDelay = this.pollIntervalMs;
        } else {
          // No due work available: backoff exponentially up to maxPollIntervalMs
          await this.sleep(this.currentPollDelay);
          this.currentPollDelay = Math.min(
            Math.round(this.currentPollDelay * 1.5),
            this.maxPollIntervalMs
          );
        }
      } catch (loopErr: any) {
        this.log('POLL_LOOP_ERROR', { error: loopErr.message });
        await this.sleep(this.currentPollDelay);
      }
    }

    this.isRunning = false;
    this.log('WORKER_STOPPED');
  }

  public stop(): void {
    this.stopRequested = true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
