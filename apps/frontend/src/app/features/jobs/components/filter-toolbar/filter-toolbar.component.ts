import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { JobCounts } from '../../models/job.model';

@Component({
  selector: 'app-filter-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './filter-toolbar.component.html',
  styleUrl: './filter-toolbar.component.css'
})
export class FilterToolbarComponent {
  public counts = input.required<JobCounts>();
  public selectedFilter = input.required<string>();
  public searchQuery = input.required<string>();
  public totalJobs = input.required<number>();

  public filterChange = output<'ALL' | 'READY' | 'RUNNING' | 'DONE' | 'DEAD_LETTER'>();
  public searchQueryChange = output<string>();
}
