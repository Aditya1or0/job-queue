import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { JobCounts, JobStatus } from '../../models/job.model';

@Component({
  selector: 'app-summary-cards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './summary-cards.component.html',
  styleUrl: './summary-cards.component.css'
})
export class SummaryCardsComponent {
  public counts = input.required<JobCounts>();
  public selectedFilter = input.required<string>();

  public filterChange = output<'ALL' | 'READY' | 'RUNNING' | 'DONE' | 'DEAD_LETTER'>();
}
