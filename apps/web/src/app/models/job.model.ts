export type JobStatus = 'READY' | 'RUNNING' | 'DONE' | 'DEAD_LETTER';
export type AttemptStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';

export interface Job {
  id: number;
  jobId: string;
  payload: string;
  status: JobStatus;
  runAfter: string;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
  failTimes: number;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobAttempt {
  id: number;
  jobId: string;
  attemptNumber: number;
  workerId: string;
  leaseToken: string;
  startedAt: string;
  finishedAt: string | null;
  status: AttemptStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobCounts {
  READY: number;
  RUNNING: number;
  DONE: number;
  DEAD_LETTER: number;
}

export interface JobsResponse {
  counts: JobCounts;
  jobs: Job[];
}

export interface JobDetailsResponse {
  job: Job;
  attempts: JobAttempt[];
}
