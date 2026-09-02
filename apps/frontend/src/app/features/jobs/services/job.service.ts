import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { JobsResponse, JobDetailsResponse, Job } from '../models/job.model';

@Injectable({
  providedIn: 'root'
})
export class JobService {
  private http = inject(HttpClient);
  private baseUrl = '/api/jobs';

  getJobs(statusFilter?: string): Observable<JobsResponse> {
    const url = statusFilter && statusFilter !== 'ALL'
      ? `${this.baseUrl}?status=${statusFilter}`
      : this.baseUrl;
    return this.http.get<JobsResponse>(url);
  }

  getJobDetails(jobId: string): Observable<JobDetailsResponse> {
    return this.http.get<JobDetailsResponse>(`${this.baseUrl}/${encodeURIComponent(jobId)}`);
  }

  getJobAttempts(jobId: string): Observable<{ attempts: any[] }> {
    return this.http.get<{ attempts: any[] }>(`${this.baseUrl}/${encodeURIComponent(jobId)}/attempts`);
  }

  requeueJob(jobId: string): Observable<{ message: string; job: Job }> {
    return this.http.post<{ message: string; job: Job }>(
      `${this.baseUrl}/${encodeURIComponent(jobId)}/requeue`,
      {}
    );
  }

  resetAndSeed(): Observable<{ message: string; seededCount: number }> {
    return this.http.post<{ message: string; seededCount: number }>(
      `${this.baseUrl}/reset-seed`,
      {}
    );
  }
}
