import { ViewportScroller } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { enableProdMode, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { AppComponent } from './app/app.component';
import { apiBoundaryInterceptor, normalizeApiBaseUrl } from './app/api/api-boundary';
import { API_BASE_URL } from './app/api/generated/gones-api';
import { routes } from './app/app.routes';
import { authSessionInterceptor } from './app/auth/auth.interceptor';
import { AuthService } from './app/auth/auth.service';
import { environment } from './environments/environment';

const routeScrollOffset: [number, number] = [0, 128];

if (environment.production) enableProdMode();

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(withInterceptors([authSessionInterceptor, apiBoundaryInterceptor])),
    { provide: API_BASE_URL, useValue: normalizeApiBaseUrl(environment.apiBaseUrl) },
    provideAnimationsAsync(),
    provideAppInitializer(() => inject(ViewportScroller).setOffset(routeScrollOffset)),
    provideAppInitializer(() => inject(AuthService).bootstrap()),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
    provideServiceWorker('ngsw-worker.js', { enabled: environment.production, registrationStrategy: 'registerWhenStable:30000' })
  ]
}).catch((error: unknown) => console.error(error));
