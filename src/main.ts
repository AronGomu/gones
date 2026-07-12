import { ViewportScroller } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { enableProdMode, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { environment } from './environments/environment';

const routeScrollOffset: [number, number] = [0, 128];

if (environment.production) enableProdMode();

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideAnimationsAsync(),
    provideAppInitializer(() => inject(ViewportScroller).setOffset(routeScrollOffset)),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
    provideServiceWorker('ngsw-worker.js', { enabled: environment.production, registrationStrategy: 'registerWhenStable:30000' })
  ]
}).catch((error: unknown) => console.error(error));
