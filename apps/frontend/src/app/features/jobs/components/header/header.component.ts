import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent {
  public autoRefresh = input.required<boolean>();
  public isLoading = input.required<boolean>();
  public isResetting = input.required<boolean>();

  public toggleAutoRefresh = output<void>();
  public refresh = output<void>();
  public resetSeed = output<void>();

  public showModal = false;

  public openResetModal(): void {
    this.showModal = true;
  }

  public closeResetModal(): void {
    this.showModal = false;
  }

  public confirmReset(): void {
    this.showModal = false;
    this.resetSeed.emit();
  }
}
