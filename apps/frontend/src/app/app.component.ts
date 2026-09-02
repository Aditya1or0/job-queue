import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { JobsDashboardPage } from './features/jobs/pages/jobs-dashboard.page';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, JobsDashboardPage],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {}
