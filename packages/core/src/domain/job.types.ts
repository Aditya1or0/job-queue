import { JobStatus, AttemptStatus } from './job-status.enum';

export interface JobEntity {
  id: number;
  jobId: string;
  payload: string;
  status: JobStatus;
  runAfter: Date;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseUntil: Date | null;
  failTimes: number;
  lastError: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobAttemptEntity {
  id: number;
  jobId: string;
  attemptNumber: number;
  workerId: string;
  leaseToken: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: AttemptStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJobParams {
  jobId: string;
  payload: string;
  runAfter: Date;
  maxAttempts?: number;
  failTimes?: number;
}

export interface ClaimedJob {
  id: number;
  jobId: string;
  payload: string;
  attemptCount: number;
  attemptNumber: number;
  maxAttempts: number;
  failTimes: number;
  leaseOwner: string;
  leaseToken: string;
  leaseUntil: Date;
  isReclaim: boolean;
}

export interface RetryPolicyConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface LeasePolicyConfig {
  leaseDurationMs: number;
}
