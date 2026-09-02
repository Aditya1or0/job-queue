import { RetryPolicyConfig } from './job.types';

export class RetryPolicy {
  public readonly maxAttempts: number;
  public readonly baseDelayMs: number;
  public readonly maxDelayMs: number;

  constructor(config?: Partial<RetryPolicyConfig>) {
    this.maxAttempts = config?.maxAttempts ?? 3;
    this.baseDelayMs = config?.baseDelayMs ?? 2000;
    this.maxDelayMs = config?.maxDelayMs ?? 60000;
  }

  /**
   * Calculates the delay in milliseconds before the next retry attempt using exponential backoff.
   * Formula: min(baseDelay * (2 ^ (attemptCount - 1)), maxDelay)
   * 
   * Example (baseDelay = 2000ms):
   * attempt 1 failure -> attemptCount 1 -> delay = 2000 * (2^0) = 2000ms
   * attempt 2 failure -> attemptCount 2 -> delay = 2000 * (2^1) = 4000ms
   * attempt 3 failure -> attemptCount 3 -> delay = 2000 * (2^2) = 8000ms
   */
  public calculateRetryDelay(attemptCount: number): number {
    if (attemptCount <= 0) {
      return this.baseDelayMs;
    }
    const factor = Math.pow(2, attemptCount - 1);
    const delay = this.baseDelayMs * factor;
    return Math.min(delay, this.maxDelayMs);
  }

  /**
   * Calculates the next execution timestamp (run_after) based on current attempt count.
   */
  public calculateNextRunAfter(attemptCount: number, fromDate: Date = new Date()): Date {
    const delayMs = this.calculateRetryDelay(attemptCount);
    return new Date(fromDate.getTime() + delayMs);
  }

  /**
   * Checks if a job has exhausted its retry attempts.
   */
  public isRetryExhausted(attemptCount: number, customMaxAttempts?: number): boolean {
    const limit = customMaxAttempts ?? this.maxAttempts;
    return attemptCount >= limit;
  }
}
