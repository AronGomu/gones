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
import { ServerReadCacheService } from './app/backend/server-read-cache.service';
import { DataAuthority, DataAuthorityConfigurationError, configureDataAuthority, mergeRuntimeDeclaration } from './app/config/data-authority';
import { canonicalDevHostUrl } from './app/config/dev-host';
import { GonesErrorHandler, routeErrorBoundary } from './app/shared/route-error-boundary';
import { environment } from './environments/environment';

const routeScrollOffset: [number, number] = [0, 128];

/**
 * The declared data authority is resolved before anything else boots. A build whose declaration
 * cannot be satisfied — an unknown mode (the retired `legacy-browser` included), no API base URL,
 * admin without auth — refuses to start rather than running with no authority at all (ADR 0020).
 */
function renderDataAuthorityFailure(error: DataAuthorityConfigurationError): void {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.setAttribute('data-cy', 'data-authority-failure');
  message.textContent = `Gones cannot start: ${error.code}. This build declares a data authority it cannot satisfy.`;
  document.body.replaceChildren(message);
}

/**
 * Reads the declaration the host injected at container start (C44). It is fetched relative to the
 * document base URL, so the artifact is bound to no origin and no base href, and a deployment that
 * injects nothing — the frozen static site — simply keeps the declaration it was built with.
 */
async function readRuntimeDeclaration(): Promise<unknown> {
  try {
    const response = await fetch(new URL('runtime-config.json', document.baseURI), { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // No injector on this host (static hosting rewrites unknown paths to index.html) or no network.
    return null;
  }
}

async function startGones(): Promise<void> {
  let authority: DataAuthority;
  try {
    authority = configureDataAuthority(mergeRuntimeDeclaration(environment, await readRuntimeDeclaration()));
  } catch (error) {
    if (error instanceof DataAuthorityConfigurationError) renderDataAuthorityFailure(error);
    console.error(error);
    throw error;
  }

  // A dev page opened on the host the API cookie is not bound to cannot keep a session across a
  // reload, so it moves to the API's host before anything tries to restore one.
  const canonicalUrl = canonicalDevHostUrl(location.href, authority.apiBaseUrl, environment.production);
  if (canonicalUrl) {
    location.replace(canonicalUrl);
    return;
  }

  if (environment.production) enableProdMode();

  await bootstrapApplication(AppComponent, {
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(withInterceptors([authSessionInterceptor, apiBoundaryInterceptor, serviceWorkerBypassInterceptor])),
      { provide: API_BASE_URL, useValue: authority.apiBaseUrl },
      provideAnimationsAsync(),
      provideAppInitializer(() => inject(ViewportScroller).setOffset(routeScrollOffset)),
      provideAppInitializer(() => {
        inject(ServerReadCacheService); // register private-cache purge before bootstrap can fail
        return inject(AuthService).bootstrap();
      }),
      { provide: ErrorHandler, useClass: GonesErrorHandler },
      provideRouter(
        // The routed capability surface follows the resolved authority, injected value included —
        // never the compiled-in defaults, or a runtime declaration could enable a route the
        // authority decision refused.
        buildRoutes({ authV1: authority.authV1, adminV1: authority.adminV1 }),
        withComponentInputBinding(),
        withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
        withNavigationErrorHandler(routeErrorBoundary)
      ),
      provideServiceWorker('ngsw-worker.js', { enabled: environment.production, registrationStrategy: 'registerWhenStable:30000' })
    ]
  });
}

startGones().catch((error: unknown) => console.error(error));
