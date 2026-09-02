export enum JobStatus {
  READY = 'READY',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  DEAD_LETTER = 'DEAD_LETTER'
}

export enum AttemptStatus {
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  TIMED_OUT = 'TIMED_OUT'
}
