import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Job, JobAttempt } from '../../models/job.model';
import { AttemptHistoryComponent } from '../attempt-history/attempt-history.component';

@Component({
  selector: 'app-jobs-table',
  standalone: true,
  imports: [CommonModule, AttemptHistoryComponent],
  templateUrl: './jobs-table.component.html',
  styleUrl: './jobs-table.component.css'
})
export class JobsTableComponent {
  public jobs = input.required<Job[]>();
  public expandedJobIds = input.required<Set<string>>();
  public attemptsMap = input.required<Map<string, JobAttempt[]>>();
  public loadingAttemptsMap = input.required<Set<string>>();
  public requeueingMap = input.required<Set<string>>();

  public toggleExpand = output<string>();
  public requeue = output<string>();

  public isExpanded(jobId: string): boolean {
    return this.expandedJobIds().has(jobId);
  }

  public getAttempts(jobId: string): JobAttempt[] | undefined {
    return this.attemptsMap().get(jobId);
  }

  public isLoadingAttempts(jobId: string): boolean {
    return this.loadingAttemptsMap().has(jobId);
  }

  public isRequeueing(jobId: string): boolean {
    return this.requeueingMap().has(jobId);
  }

  public getLastWorker(jobId: string): string | null {
    const attempts = this.attemptsMap().get(jobId);
    if (attempts && attempts.length > 0) {
      return attempts[attempts.length - 1].workerId;
    }
    return null;
  }

  public formatTime(dateStr: string | Date | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  public getRelativeTime(dateStr: string | Date): string {
    if (!dateStr) return '';
    const now = Date.now();
    const target = new Date(dateStr).getTime();
    const diffSec = Math.round((target - now) / 1000);

    if (diffSec <= 0) {
      return 'Due now';
    }
    if (diffSec < 60) {
      return `in ${diffSec}s`;
    }
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `in ${mins}m ${secs}s`;
  }
}
