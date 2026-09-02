import '@angular/compiler';
import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, UserProfileResponse } from '../../api/generated/gones-api';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { EventCatalogCacheService } from './event-catalog-cache.service';
import { EventRegistrationService } from './event-registration.service';
import { PublicEventListComponent } from './public-event-list.component';
import { PublicEventService } from './public-event.service';
import { of } from 'rxjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

@Component({ selector: 'gones-back-button', standalone: true, template: '' })
class BackButtonStub {
  @Input() link: readonly string[] = [];
  @Input() label = '';
  @Input() position = '';
}

@Component({ selector: 'gones-sync-bar', standalone: true, template: '' })
class SyncBarStub {
  @Input() cyPrefix = '';
  @Input() syncedAt?: string;
  @Input() loading = false;
  @Input() stale = false;
  @Output() sync = new EventEmitter<void>();
}

const unverifiedOrganizer = {
  id: 'organizer-1',
  globalRole: 'Organizer',
  emailVerified: false,
  email: 'organizer@example.test'
} as UserProfileResponse;

describe('PublicEventListComponent create Event CTA DOM', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PublicEventListComponent, RouterTestingModule.withRoutes([])],
      providers: [
        I18nService,
        { provide: AuthService, useValue: { profile: signal(unverifiedOrganizer), whenSessionReady: vi.fn(async () => undefined) } },
        { provide: Client, useValue: { organizationsAll: vi.fn(() => of([{ id: 'org-1' }])) } },
        { provide: EventCatalogCacheService, useValue: { load: vi.fn(async () => ({ items: [], fetchedAt: '2026-08-31T00:00:00Z', fromCache: false, stale: false, truncated: false })) } },
        { provide: PublicEventService, useValue: { icsUrl: vi.fn() } },
        { provide: EventRegistrationService, useValue: { capability: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    TestBed.overrideComponent(PublicEventListComponent, {
      remove: { imports: [BackButtonComponent, SyncBarComponent] },
      add: { imports: [BackButtonStub, SyncBarStub] }
    });
  });

  it('keeps disabled creation focusable, described, link-shaped, and non-navigating', async () => {
    const fixture = TestBed.createComponent(PublicEventListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const debug = fixture.debugElement.query(By.css('[data-cy="event-list-create-event"]'));
    const anchor = debug.nativeElement as HTMLAnchorElement;
    const tooltip = debug.injector.get(MatTooltip);

    expect(anchor.getAttribute('href')).toBeNull();
    expect(anchor.getAttribute('role')).toBe('link');
    expect(anchor.getAttribute('aria-disabled')).toBe('true');
    expect(anchor.tabIndex).toBe(0);
    expect(tooltip.message).toBe(fixture.componentInstance.i18n.t('event.createRequiresVerifiedEmail'));

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});
