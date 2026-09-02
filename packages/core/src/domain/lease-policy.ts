import { LeasePolicyConfig } from './job.types';

export class LeasePolicy {
  public readonly leaseDurationMs: number;

  constructor(config?: Partial<LeasePolicyConfig>) {
    this.leaseDurationMs = config?.leaseDurationMs ?? 30000;
  }

  /**
   * Calculates the lease expiration timestamp given a start time.
   */
  public calculateLeaseUntil(fromTime: Date = new Date()): Date {
    return new Date(fromTime.getTime() + this.leaseDurationMs);
  }

  /**
   * Evaluates if a lease has expired against current time.
   */
  public isLeaseExpired(leaseUntil: Date | null, currentTime: Date = new Date()): boolean {
    if (!leaseUntil) {
      return true;
    }
    return leaseUntil.getTime() <= currentTime.getTime();
  }
}
