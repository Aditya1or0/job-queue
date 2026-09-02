import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { JobService } from './services/job.service';
import { Job, JobAttempt, JobCounts } from './models/job.model';
import { HeaderComponent } from './components/header/header.component';
import { SummaryCardsComponent } from './components/summary-cards/summary-cards.component';
import { FilterToolbarComponent } from './components/filter-toolbar/filter-toolbar.component';
import { JobsTableComponent } from './components/jobs-table/jobs-table.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    SummaryCardsComponent,
    FilterToolbarComponent,
    JobsTableComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class App implements OnInit, OnDestroy {
  private jobService = inject(JobService);

  // Reactive State Signals
  public jobs = signal<Job[]>([]);
  public counts = signal<JobCounts>({ READY: 0, RUNNING: 0, DONE: 0, DEAD_LETTER: 0 });
  public selectedFilter = signal<'ALL' | 'READY' | 'RUNNING' | 'DONE' | 'DEAD_LETTER'>('ALL');
  public searchQuery = signal<string>('');
  public expandedJobIds = signal<Set<string>>(new Set());
  public attemptsMap = signal<Map<string, JobAttempt[]>>(new Map());
  public loadingAttemptsMap = signal<Set<string>>(new Set());
  public requeueingMap = signal<Set<string>>(new Set());
  public autoRefresh = signal<boolean>(true);
  public isLoading = signal<boolean>(false);
  public lastUpdated = signal<Date>(new Date());

  private pollIntervalId: any = null;

  public totalJobs = computed(() => {
    const c = this.counts();
    return c.READY + c.RUNNING + c.DONE + c.DEAD_LETTER;
  });

  public filteredJobs = computed(() => {
    const list = this.jobs();
    const filter = this.selectedFilter();
    const q = this.searchQuery().toLowerCase().trim();

    return list.filter((job) => {
      // 1. Status Filter
      if (filter !== 'ALL' && job.status !== filter) {
        return false;
      }
      // 2. Search Query Filter
      if (q) {
        const matchesId = job.jobId.toLowerCase().includes(q);
        const matchesPayload = job.payload.toLowerCase().includes(q);
        return matchesId || matchesPayload;
      }
      return true;
    });
  });

  ngOnInit(): void {
    this.loadJobs();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  public loadJobs(): void {
    this.isLoading.set(true);
    this.jobService.getJobs().subscribe({
      next: (res) => {
        this.counts.set(res.counts);
        this.jobs.set(res.jobs);
        this.lastUpdated.set(new Date());
        this.isLoading.set(false);

        // Refresh attempts for open rows
        const expanded = this.expandedJobIds();
        expanded.forEach((jobId) => {
          this.fetchAttempts(jobId);
        });
      },
      error: (err) => {
        console.error('Failed to load jobs from API:', err);
        this.isLoading.set(false);
      }
    });
  }

  public toggleExpand(jobId: string): void {
    const current = new Set(this.expandedJobIds());
    if (current.has(jobId)) {
      current.delete(jobId);
    } else {
      current.add(jobId);
      this.fetchAttempts(jobId);
    }
    this.expandedJobIds.set(current);
  }

  public fetchAttempts(jobId: string): void {
    const loadingSet = new Set(this.loadingAttemptsMap());
    loadingSet.add(jobId);
    this.loadingAttemptsMap.set(loadingSet);

    this.jobService.getJobAttempts(jobId).subscribe({
      next: (res) => {
        const map = new Map(this.attemptsMap());
        map.set(jobId, res.attempts || []);
        this.attemptsMap.set(map);

        const currentLoading = new Set(this.loadingAttemptsMap());
        currentLoading.delete(jobId);
        this.loadingAttemptsMap.set(currentLoading);
      },
      error: (err) => {
        console.error(`Failed to load attempts for ${jobId}:`, err);
        const currentLoading = new Set(this.loadingAttemptsMap());
        currentLoading.delete(jobId);
        this.loadingAttemptsMap.set(currentLoading);
      }
    });
  }

  public requeueJob(jobId: string): void {
    const rMap = new Set(this.requeueingMap());
    rMap.add(jobId);
    this.requeueingMap.set(rMap);

    this.jobService.requeueJob(jobId).subscribe({
      next: () => {
        const activeRMap = new Set(this.requeueingMap());
        activeRMap.delete(jobId);
        this.requeueingMap.set(activeRMap);
        this.loadJobs();
        this.fetchAttempts(jobId);
      },
      error: (err) => {
        console.error(`Failed to requeue job ${jobId}:`, err);
        const activeRMap = new Set(this.requeueingMap());
        activeRMap.delete(jobId);
        this.requeueingMap.set(activeRMap);
      }
    });
  }

  public setFilter(filter: 'ALL' | 'READY' | 'RUNNING' | 'DONE' | 'DEAD_LETTER'): void {
    this.selectedFilter.set(filter);
  }

  public toggleAutoRefresh(): void {
    const next = !this.autoRefresh();
    this.autoRefresh.set(next);
    if (next) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    this.pollIntervalId = setInterval(() => {
      if (this.autoRefresh()) {
        this.loadJobs();
      }
    }, 2000);
  }

  private stopAutoRefresh(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  public formatTime(dateStr: string | Date | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
