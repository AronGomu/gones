import '@angular/compiler';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Component, Input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, Client, EventImageUploadResponse, UserProfileResponse } from '../../api/generated/gones-api';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { EventDetailView, EventDetailViewComponent } from './event-detail-view.component';
import { EventImageUploaderComponent } from './event-image-uploader.component';
import { EventProposalService } from './event-proposal.service';
import { OrganizerEventCreateComponent } from './organizer-event-create.component';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

@Component({
  selector: 'gones-back-button',
  standalone: true,
  template: '<button type="button" data-cy="back-button-stub">Back</button>'
})
class BackButtonStubComponent {
  @Input() link?: readonly string[];
  @Input() label = '';
  @Input() position: 'top' | 'bottom' = 'top';
}

@Component({
  selector: 'gones-event-detail-view',
  standalone: true,
  template: '<div data-cy="event-detail-view-stub"></div>'
})
class EventDetailViewStubComponent {
  @Input({ required: true }) event!: EventDetailView;
  @Input() draftPlaceholderMode = false;
  @Input() showIcsAction = true;
}

function file(): File {
  return new File([new Uint8Array([1, 2, 3])], 'proposal.png', { type: 'image/png' });
}

describe('OrganizerEventCreateComponent proposal DOM', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:proposal') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('renders uploader for a plain User and disables proposal submit for pending and failed uploads', async () => {
    const uploads: Subject<HttpEvent<EventImageUploadResponse>>[] = [];
    const http = {
      request: vi.fn(() => {
        const request = new Subject<HttpEvent<EventImageUploadResponse>>();
        uploads.push(request);
        return request.asObservable();
      }),
      get: vi.fn(() => of(new Blob())),
      delete: vi.fn(() => of(undefined))
    };
    const profile = signal({
      id: 'user-1',
      email: 'user@example.test',
      emailVerified: true,
      globalRole: 'User'
    } as unknown as UserProfileResponse);
    const client = {
      formatsAll: vi.fn(() => of([{ id: 'format-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }])),
      organizationsGET: vi.fn(() => of({
        items: [{ id: 'organization-1', name: 'Public Club' }],
        page: 1,
        pageSize: 100,
        totalCount: 1
      }))
    };

    TestBed.configureTestingModule({
      imports: [OrganizerEventCreateComponent],
      providers: [
        provideRouter([]),
        { provide: Client, useValue: client },
        { provide: HttpClient, useValue: http },
        { provide: API_BASE_URL, useValue: '' },
        { provide: AuthService, useValue: { profile } },
        { provide: EventProposalService, useValue: {} },
        { provide: PowerUserSettingsService, useValue: { enabled: signal(true) } },
        { provide: I18nService, useValue: { t: (key: string) => key, language: () => 'en' } }
      ]
    });
    TestBed.overrideComponent(OrganizerEventCreateComponent, {
      remove: { imports: [BackButtonComponent, EventDetailViewComponent] },
      add: { imports: [BackButtonStubComponent, EventDetailViewStubComponent] }
    });
    const fixture = TestBed.createComponent(OrganizerEventCreateComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.loadingReferences.set(false);
    fixture.componentInstance.organizations.set([{ id: 'organization-1', name: 'Public Club' }]);
    fixture.componentInstance.form.controls.organizationId.setValue('organization-1');
    fixture.componentInstance.selectedOrganizationId.set('organization-1');
    fixture.detectChanges();

    const uploaderDebug = fixture.debugElement.query(By.directive(EventImageUploaderComponent));
    const submit = fixture.nativeElement.querySelector('[data-cy="event-submit-for-approval"]') as HTMLButtonElement;
    expect(uploaderDebug).not.toBeNull();
    expect(submit).not.toBeNull();
    expect(submit.disabled).toBe(false);

    const uploader = uploaderDebug.componentInstance as EventImageUploaderComponent;
    uploader.addFiles([file()]);
    fixture.detectChanges();

    expect(uploader.card()!.status).toBe('pending');
    expect(submit.disabled).toBe(true);

    uploads[0].error(new Error('injected upload failure'));
    fixture.detectChanges();

    expect(uploader.card()!.status).toBe('error');
    expect(submit.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-cy="event-image-publish-blocked"]').textContent)
      .toContain('eventImages.proposalBlocked');
  });
});
