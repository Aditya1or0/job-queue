import { RetryPolicy } from '../../packages/core/src/domain/retry-policy';

describe('RetryPolicy Unit Tests', () => {
  const policy = new RetryPolicy({
    maxAttempts: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60000
  });

  test('calculates correct exponential backoff delays', () => {
    // Attempt 1 -> 2000 * 2^0 = 2000
    expect(policy.calculateRetryDelay(1)).toBe(2000);
    // Attempt 2 -> 2000 * 2^1 = 4000
    expect(policy.calculateRetryDelay(2)).toBe(4000);
    // Attempt 3 -> 2000 * 2^2 = 8000
    expect(policy.calculateRetryDelay(3)).toBe(8000);
    // Attempt 4 -> 2000 * 2^3 = 16000
    expect(policy.calculateRetryDelay(4)).toBe(16000);
  });

  test('caps retry delay at maxDelayMs', () => {
    const cappedPolicy = new RetryPolicy({
      maxAttempts: 10,
      baseDelayMs: 2000,
      maxDelayMs: 10000
    });
    // 2000 * 2^4 = 32000 > 10000 -> capped at 10000
    expect(cappedPolicy.calculateRetryDelay(5)).toBe(10000);
  });

  test('identifies retry exhaustion correctly without off-by-one errors', () => {
    // With maxAttempts = 3:
    expect(policy.isRetryExhausted(1)).toBe(false);
    expect(policy.isRetryExhausted(2)).toBe(false);
    expect(policy.isRetryExhausted(3)).toBe(true);
    expect(policy.isRetryExhausted(4)).toBe(true);
  });

  test('calculates next run_after date accurately', () => {
    const baseDate = new Date('2026-01-01T00:00:00.000Z');
    const nextDate = policy.calculateNextRunAfter(1, baseDate);
    expect(nextDate.toISOString()).toBe('2026-01-01T00:00:02.000Z');
  });
});
