import { Component, ErrorHandler, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RedirectCommand, Router, RouterLink } from '@angular/router';
import { I18nService } from '../i18n/i18n.service';
import { BackButtonComponent } from './back-button.component';
import { logBoundaryError } from './app-logger';

export const ROUTE_ERROR_PATH = '/app-error';

/**
 * Route-level error boundary. A failed lazy chunk load (stale deploy, dropped network) or a route
 * resolver throwing used to leave the user on the previous screen with no feedback; navigation now
 * lands on a recoverable error page instead.
 */
export function routeErrorBoundary(error: unknown): RedirectCommand {
  logBoundaryError('router.navigation', error);
  return new RedirectCommand(inject(Router).parseUrl(ROUTE_ERROR_PATH), { skipLocationChange: true });
}

/** Structured logging for anything that escapes a component, instead of a bare console stack. */
export class GonesErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    logBoundaryError('app.unhandled', error);
  }
}

@Component({
  selector: 'gones-route-error',
  standalone: true,
  imports: [MatButtonModule, RouterLink, BackButtonComponent],
  template: `
    <gones-back-button data-cy="route-error-back-top" [label]="i18n.t('nav.backToPrevious')" position="top" />

    <section class="page stack" role="alert" data-cy="route-error">
      <h1 data-cy="route-error-title">{{ i18n.t('routeError.title') }}</h1>
      <p data-cy="route-error-body">{{ i18n.t('routeError.body') }}</p>
      <div class="stack-row" data-cy="route-error-actions">
        <button mat-flat-button type="button" data-cy="route-error-reload" (click)="reload()">{{ i18n.t('common.retry') }}</button>
        <a mat-stroked-button routerLink="/" data-cy="route-error-home">{{ i18n.t('routeError.home') }}</a>
      </div>
    </section>

    <gones-back-button data-cy="route-error-back-bottom" [label]="i18n.t('nav.backToPrevious')" position="bottom" />
  `
})
export class RouteErrorComponent {
  readonly i18n = inject(I18nService);

  reload(): void {
    location.reload();
  }
}
