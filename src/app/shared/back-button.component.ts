import { Location } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'gones-back-button',
  standalone: true,
  imports: [RouterLink, MatButtonModule],
  template: `
    <div class="back-button-row" [class.back-button-row--top]="position === 'top'" [class.back-button-row--bottom]="position === 'bottom'">
      @if (link) {
        <a mat-stroked-button class="back-button secondary-action" [routerLink]="link" [attr.aria-label]="accessibleLabel"><svg class="back-button__icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M15.5 5.5 9 12l6.5 6.5" /></svg><span>{{ label }}</span></a>
      } @else {
        <button mat-stroked-button class="back-button secondary-action" type="button" (click)="goBack()" [attr.aria-label]="accessibleLabel"><svg class="back-button__icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M15.5 5.5 9 12l6.5 6.5" /></svg><span>{{ label }}</span></button>
      }
    </div>
  `
})
export class BackButtonComponent {
  @Input() link: string | unknown[] | null = null;
  @Input() label = 'Back';
  @Input() position: 'top' | 'bottom' = 'top';

  constructor(private readonly location: Location, private readonly router: Router) {}

  get accessibleLabel(): string {
    return `${this.label} (${this.position} of page)`;
  }

  goBack(): void {
    if (history.length > 1) {
      this.location.back();
      return;
    }

    void this.router.navigate(['/leagues']);
  }
}
