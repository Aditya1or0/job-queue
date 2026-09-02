import { JobHandler } from './job-handler.interface';
import { ClaimedJob } from '@core/domain/job.types';

export class OpaqueSimulationHandler implements JobHandler {
  constructor(private readonly simulatedDurationMs: number = 100) {}

  public async execute(job: ClaimedJob): Promise<void> {
    // 1. Simulate realistic work execution duration
    if (this.simulatedDurationMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDurationMs));
    }

    // 2. Deterministic failure simulation based on seed `fail_times`
    // If current attemptNumber <= failTimes, simulate business failure
    if (job.attemptNumber <= job.failTimes) {
      throw new Error(
        `Deterministic handler error: attempt ${job.attemptNumber} failed (required fail_times: ${job.failTimes}) for job ${job.jobId} payload "${job.payload}"`
      );
    }

    // Otherwise succeeds normally
  }
}
