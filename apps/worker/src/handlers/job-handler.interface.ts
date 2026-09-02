import { ClaimedJob } from '@core/domain/job.types';

export interface JobHandler {
  execute(job: ClaimedJob): Promise<void>;
}
