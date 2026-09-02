import { LeasePolicy } from '../../packages/core/src/domain/lease-policy';

describe('LeasePolicy Unit Tests', () => {
  const policy = new LeasePolicy({ leaseDurationMs: 30000 });

  test('calculates lease expiration timestamp accurately', () => {
    const startTime = new Date('2026-01-01T12:00:00.000Z');
    const leaseUntil = policy.calculateLeaseUntil(startTime);
    expect(leaseUntil.toISOString()).toBe('2026-01-01T12:00:30.000Z');
  });

  test('evaluates lease expiration against current time correctly', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 10000);

    expect(policy.isLeaseExpired(null)).toBe(true);
    expect(policy.isLeaseExpired(past)).toBe(true);
    expect(policy.isLeaseExpired(future)).toBe(false);
  });
});
