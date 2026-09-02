import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { JobAttempt } from '../../models/job.model';

@Component({
  selector: 'app-attempt-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './attempt-history.component.html',
  styleUrl: './attempt-history.component.css'
})
export class AttemptHistoryComponent {
  public jobId = input.required<string>();
  public attempts = input<JobAttempt[] | undefined>();
  public isLoading = input.required<boolean>();

  public formatTime(dateStr: string | Date | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  public calculateDuration(startStr: string, finishStr: string | null): string {
    if (!finishStr) return 'In progress...';
    const start = new Date(startStr).getTime();
    const finish = new Date(finishStr).getTime();
    const ms = finish - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }
}
