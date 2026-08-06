import { ViewportScroller } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ErrorHandler, enableProdMode, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { AppComponent } from './app/app.component';
import { apiBoundaryInterceptor } from './app/api/api-boundary';
import { API_BASE_URL } from './app/api/generated/gones-api';
import { serviceWorkerBypassInterceptor } from './app/api/service-worker-cache';
import { buildRoutes } from './app/app.routes';
import { authSessionInterceptor } from './app/auth/auth.interceptor';
import { AuthService } from './app/auth/auth.service';
import { DataAuthority, DataAuthorityConfigurationError, dataAuthority } from './app/config/data-authority';
import { GonesErrorHandler, routeErrorBoundary } from './app/shared/route-error-boundary';
import { environment } from './environments/environment';

const routeScrollOffset: [number, number] = [0, 128];

/**
 * The declared data authority is resolved before anything else boots. A build whose declared mode
 * cannot be satisfied — unknown mode, server mode without an API base URL, a legacy build carrying
 * a server capability — refuses to start instead of falling back to the browser store (ADR 0019).
 */
function renderDataAuthorityFailure(error: DataAuthorityConfigurationError): void {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.setAttribute('data-cy', 'data-authority-failure');
  message.textContent = `Gones cannot start: ${error.code}. This build declares a data authority it cannot satisfy.`;
  document.body.replaceChildren(message);
}

let authority: DataAuthority;
try {
  authority = dataAuthority();
} catch (error) {
  if (error instanceof DataAuthorityConfigurationError) renderDataAuthorityFailure(error);
  console.error(error);
  throw error;
}

if (environment.production) enableProdMode();

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(withInterceptors([authSessionInterceptor, apiBoundaryInterceptor, serviceWorkerBypassInterceptor])),
    { provide: API_BASE_URL, useValue: authority.apiBaseUrl },
    provideAnimationsAsync(),
    provideAppInitializer(() => inject(ViewportScroller).setOffset(routeScrollOffset)),
    provideAppInitializer(() => inject(AuthService).bootstrap()),
    { provide: ErrorHandler, useClass: GonesErrorHandler },
    provideRouter(
      buildRoutes(authority.mode, environment.features),
      withComponentInputBinding(),
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
      withNavigationErrorHandler(routeErrorBoundary)
    ),
    provideServiceWorker('ngsw-worker.js', { enabled: environment.production, registrationStrategy: 'registerWhenStable:30000' })
  ]
}).catch((error: unknown) => console.error(error));
