import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { I18nService } from '../i18n/i18n.service';
import { BackButtonComponent } from './back-button.component';

@Component({
  standalone: true,
  imports: [MatCardModule, BackButtonComponent],
  template: `
    <gones-back-button data-cy="not-found-back-top" [label]="i18n.t('nav.backToPrevious')" position="top" />
    <mat-card class="panel" data-cy="not-found">
      <mat-card-title data-cy="not-found-title">{{ i18n.t('notFound.title') }}</mat-card-title>
      <mat-card-content data-cy="not-found-content"><p data-cy="not-found-body">{{ i18n.t('notFound.body') }}</p></mat-card-content>
    </mat-card>
    <gones-back-button data-cy="not-found-back-bottom" [label]="i18n.t('nav.backToPrevious')" position="bottom" />
  `
})
export class NotFoundComponent {
  readonly i18n = inject(I18nService);
}
