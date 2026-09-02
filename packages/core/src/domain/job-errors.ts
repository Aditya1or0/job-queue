export class JobNotFoundError extends Error {
  constructor(public readonly jobId: string) {
    super(`Job with ID '${jobId}' was not found.`);
    this.name = 'JobNotFoundError';
  }
}

export class InvalidJobStateError extends Error {
  constructor(public readonly jobId: string, public readonly currentState: string, public readonly expectedState: string) {
    super(`Job '${jobId}' is in state '${currentState}', but '${expectedState}' was expected.`);
    this.name = 'InvalidJobStateError';
  }
}

export class LeaseFenceLostError extends Error {
  constructor(public readonly jobId: string, public readonly leaseToken: string) {
    super(`Job '${jobId}' lease fence lost. Token '${leaseToken}' is no longer active or valid.`);
    this.name = 'LeaseFenceLostError';
  }
}

export class JobNotDeadLetteredError extends Error {
  constructor(public readonly jobId: string, public readonly currentState: string) {
    super(`Cannot requeue job '${jobId}' because its status is '${currentState}', not 'DEAD_LETTER'.`);
    this.name = 'JobNotDeadLetteredError';
  }
}
