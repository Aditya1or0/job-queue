import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { Sequelize } from 'sequelize';
import { JobModel } from '@core/models/job.model';
import { JobStatus } from '@core/domain/job-status.enum';

export interface SeedRow {
  job_id: string;
  payload: string;
  run_after_offset_sec: string | number;
  fail_times: string | number;
}

export class SeedLoader {
  constructor(private readonly sequelize: Sequelize) {}

  public async loadFromCsv(filePath: string, baseTime: Date = new Date()): Promise<number> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Seed file not found at path: ${filePath}`);
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as SeedRow[];

    console.log(`[SEED_LOADER] Parsing ${records.length} jobs from ${filePath} at base time ${baseTime.toISOString()}...`);

    let loadedCount = 0;

    for (const record of records) {
      const offsetSec = parseInt(String(record.run_after_offset_sec), 10) || 0;
      const failTimes = parseInt(String(record.fail_times), 10) || 0;
      const runAfter = new Date(baseTime.getTime() + offsetSec * 1000);

      // Check if already exists
      const existing = await JobModel.findOne({ where: { job_id: record.job_id } });
      if (existing) {
        console.log(`[SEED_LOADER] Skipped existing job ${record.job_id} (current status: ${existing.status})`);
        continue;
      }

      await JobModel.create({
        job_id: record.job_id,
        payload: record.payload,
        status: JobStatus.READY,
        run_after: runAfter,
        attempt_count: 0,
        max_attempts: 3,
        fail_times: failTimes,
        lease_owner: null,
        lease_token: null,
        lease_until: null,
        last_error: null,
        completed_at: null
      });

      loadedCount++;
      console.log(`[SEED_LOADER] Enqueued new job ${record.job_id}: "${record.payload}" (due in ${offsetSec}s, fail_times: ${failTimes})`);
    }

    console.log(`[SEED_LOADER] Completed ingestion: ${loadedCount} new jobs enqueued.`);
    return loadedCount;
  }
}
