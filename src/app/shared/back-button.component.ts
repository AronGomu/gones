import { Location, NgTemplateOutlet } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../i18n/i18n.service';

@Component({
  selector: 'gones-back-button',
  standalone: true,
  imports: [RouterLink, MatButtonModule, NgTemplateOutlet],
  template: `
    @if (position === 'bottom') {
      <footer class="back-button-row back-button-row--bottom" data-cy="back-button-row-bottom" [attr.aria-label]="i18n.t('nav.footerNav')">
        <ng-container *ngTemplateOutlet="backButton" />
      </footer>
    } @else {
      <div class="back-button-row back-button-row--top" data-cy="back-button-row-top">
        <ng-container *ngTemplateOutlet="backButton" />
      </div>
    }

    <ng-template #backButton>
      @if (link) {
        <a mat-stroked-button class="back-button secondary-action" [attr.data-cy]="'back-button-link-' + position" [routerLink]="link" [attr.aria-label]="accessibleLabel"><svg class="back-button__icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M15.5 5.5 9 12l6.5 6.5" /></svg><span [attr.data-cy]="'back-button-link-label-' + position">{{ displayLabel }}</span></a>
      } @else {
        <button mat-stroked-button class="back-button secondary-action" type="button" [attr.data-cy]="'back-button-action-' + position" (click)="goBack()" [attr.aria-label]="accessibleLabel"><svg class="back-button__icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M15.5 5.5 9 12l6.5 6.5" /></svg><span [attr.data-cy]="'back-button-action-label-' + position">{{ displayLabel }}</span></button>
      }
    </ng-template>
  `
})
export class BackButtonComponent {
  readonly i18n = inject(I18nService);
  @Input() link: string | unknown[] | null = null;
  @Input() label = '';
  @Input() position: 'top' | 'bottom' = 'top';

  constructor(private readonly location: Location, private readonly router: Router) {}

  get displayLabel(): string {
    return this.label || this.i18n.t('nav.back');
  }

  get accessibleLabel(): string {
    const position = this.position === 'bottom' ? this.i18n.t('nav.positionBottom') : this.i18n.t('nav.positionTop');
    return this.i18n.t('nav.backPosition', { label: this.displayLabel, position });
  }

  goBack(): void {
    if (history.length > 1) {
      this.location.back();
      return;
    }

    void this.router.navigate(['/archive/league-seasons']);
  }
}
