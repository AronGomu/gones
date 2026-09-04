import '@angular/compiler';
import axe from 'axe-core';
import { HttpClient, HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, EventImageUploadResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { parseEventCreateDraft } from './event-create-draft';
import { EventImageUploaderComponent } from './event-image-uploader.component';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

const copy: Record<string, string> = {
  'common.retry': 'Retry', 'eventImages.title': 'Event image', 'eventImages.help': 'Help',
  'eventImages.choose': 'Choose image', 'eventImages.existingName': 'Existing image',
  'eventImages.maximum': 'Only one Event image is allowed.', 'eventImages.typeUnsupported': 'Unsupported',
  'eventImages.tooLarge': 'Too large', 'eventImages.uploading': 'Uploading… {progress}%',
  'eventImages.uploadFailed': 'Upload failed', 'eventImages.previewFailed': 'Preview failed',
  'eventImages.removeFailed': 'Remove failed', 'eventImages.expired': 'Expired', 'eventImages.reupload': 'Re-upload',
  'eventImages.removeNamed': 'Remove {name}', 'eventImages.removing': 'Removing…',
  'eventImages.removingNamed': 'Removing {name}', 'eventImages.publishBlocked': 'Blocked'
};
const i18n = { t: (key: string, params: Record<string, string | number> = {}) => Object.entries(params)
  .reduce((value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)), copy[key] ?? key) };

const uploaded = (id: string): EventImageUploadResponse => ({
  id, state: 'Temporary', width: 960, height: 540, expiresAt: '2030-01-02T12:00:00Z',
  variants: [{ width: 320, height: 180, url: `/api/event-images/${id}/variants/320` }]
});
const file = (name: string) => new File([new Uint8Array(3)], name, { type: 'image/png' });

function harness(dom = false) {
  const requests: Subject<HttpEvent<EventImageUploadResponse>>[] = [];
  const http = {
    request: vi.fn(() => { const request = new Subject<HttpEvent<EventImageUploadResponse>>(); requests.push(request); return request.asObservable(); }),
    get: vi.fn(() => of(new Blob([new Uint8Array([1])] , { type: 'image/webp' }))), delete: vi.fn(() => of(undefined))
  };
  if (!dom) {
    const injector = Injector.create({ providers: [
      { provide: HttpClient, useValue: http }, { provide: API_BASE_URL, useValue: '' }, { provide: I18nService, useValue: i18n }
    ] });
    return { component: runInInjectionContext(injector, () => new EventImageUploaderComponent()), http, requests, fixture: undefined };
  }
  TestBed.configureTestingModule({ imports: [EventImageUploaderComponent], providers: [
    { provide: HttpClient, useValue: http }, { provide: API_BASE_URL, useValue: '' }, { provide: I18nService, useValue: i18n }
  ] });
  const fixture = TestBed.createComponent(EventImageUploaderComponent);
  fixture.detectChanges();
  return { component: fixture.componentInstance, http, requests, fixture };
}

function finish(request: Subject<HttpEvent<EventImageUploadResponse>>, id: string): void {
  request.next({ type: HttpEventType.UploadProgress, loaded: 1, total: 1 });
  request.next(new HttpResponse({ status: 201, body: uploaded(id) }));
  request.complete();
}

describe('EventImageUploaderComponent singular image', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('uploads only first file and refuses a second without replacement or POST', () => {
    const { component, http, requests } = harness();
    component.addFiles([file('one.png')]);
    finish(requests[0], 'one');
    component.addFiles([file('two.png')]);

    expect(http.request).toHaveBeenCalledTimes(1);
    expect(component.selectedImage()?.imageId).toBe('one');
    expect(component.limitError()).toBe('Only one Event image is allowed.');
  });

  it('uploads only first file from a multi-file drop and reports the limit', () => {
    const { component, http } = harness();
    component.addFiles([file('one.png'), file('two.png')]);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(component.card()?.fileName).toBe('one.png');
    expect(component.limitError()).toBeTruthy();
  });

  it('emits interaction identity before upload ID and clears it when failed selection is removed', async () => {
    const { component, requests } = harness();
    const interactions = vi.fn();
    component.imageInteractionChange.subscribe(interactions);

    component.addFiles([file('one.png')]);
    expect(interactions).toHaveBeenLastCalledWith('local-1');
    requests[0].error(new Error('network'));
    expect(interactions).toHaveBeenLastCalledWith('local-1');

    await component.remove();
    expect(interactions).toHaveBeenLastCalledWith(null);
  });

  it('hydrates one existing image and removes it locally without DELETE', async () => {
    const { component, http } = harness();
    component.initialImage = { id: 'existing', variants: [{ width: 320, height: 180, url: '/image' }] };
    await component.remove();
    expect(http.delete).not.toHaveBeenCalled();
    expect(component.selectedImage()).toBeNull();
  });

  it('does no uploader HTTP when draft parser omits a path-traversing image', () => {
    const maliciousId = '../users/me';
    const restored = parseEventCreateDraft(JSON.stringify({
      version: 1,
      userId: 'u1',
      savedAt: '2029-01-01T00:00:00Z',
      value: {
        organizationId: 'org-1', title: 'Retained Cup', summary: '', bodyMarkdown: '', streetAddress: '',
        postalCode: '', city: '', country: '', region: '', timeZoneId: '', eventType: 'weekly',
        startDate: '', startTime: '', capacity: null, formatId: ''
      },
      image: {
        id: maliciousId, state: 'Temporary', width: 960, height: 540, expiresAt: '2030-01-02T12:00:00Z',
        variants: [
          { width: 320, height: 180, url: `/api/event-images/${maliciousId}/variants/320` },
          { width: 960, height: 540, url: `/api/event-images/${maliciousId}/variants/960` }
        ]
      }
    }), 'u1', Date.parse('2029-01-01T00:00:00Z'));
    const { component, http } = harness();

    if (restored?.image) component.restoreTemporaryImage(restored.image);

    expect(restored?.value.title).toBe('Retained Cup');
    expect(restored?.image).toBeUndefined();
    expect(component.card()).toBeNull();
    expect(http.request).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('restores one unexpired Temporary image through authenticated variant blob reads', () => {
    vi.setSystemTime('2029-01-01T00:00:00Z');
    const { component, http } = harness();
    const changes = vi.fn();
    component.imageChange.subscribe(changes);

    component.restoreTemporaryImage(uploaded('restored'));

    expect(http.get).toHaveBeenCalledWith('/api/event-images/restored/variants/320', { responseType: 'blob' });
    expect(component.card()?.localId).toBe('restored-restored');
    expect(component.selectedImage()?.imageId).toBe('restored');
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ imageId: 'restored' }));
    vi.useRealTimers();
  });

  it('keeps publish blocked until every restored variant blob finishes', () => {
    vi.setSystemTime('2029-01-01T00:00:00Z');
    const { component, http } = harness();
    const first = new Subject<Blob>();
    const second = new Subject<Blob>();
    http.get.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const blocked = vi.fn();
    const selections = vi.fn();
    component.publishBlockedChange.subscribe(blocked);
    component.imageChange.subscribe(selections);
    const response = {
      ...uploaded('restored'),
      variants: [
        { width: 320, height: 180, url: '/api/event-images/restored/variants/320' },
        { width: 960, height: 540, url: '/api/event-images/restored/variants/960' }
      ]
    };

    component.restoreTemporaryImage(response);
    expect(component.publishBlocked()).toBe(true);
    expect(blocked).toHaveBeenLastCalledWith(true);
    expect(selections).toHaveBeenLastCalledWith(expect.objectContaining({ imageId: 'restored' }));

    first.next(new Blob());
    first.complete();
    expect(component.publishBlocked()).toBe(true);
    second.next(new Blob());
    second.complete();

    expect(component.publishBlocked()).toBe(false);
    expect(blocked).toHaveBeenLastCalledWith(false);
    vi.useRealTimers();
  });

  it('retains Temporary response through preview failure and retries without original File', () => {
    vi.setSystemTime('2029-01-01T00:00:00Z');
    const { component, http } = harness();
    const failed = new Subject<Blob>();
    http.get.mockReturnValueOnce(failed);
    const temporaryImages = vi.fn();
    const selections = vi.fn();
    component.temporaryImageChange.subscribe(temporaryImages);
    component.imageChange.subscribe(selections);
    const response = uploaded('restored');

    component.restoreTemporaryImage(response);
    failed.error(new Error('network'));

    expect(component.card()).toMatchObject({ status: 'error', response, retryPreview: true });
    expect(temporaryImages).toHaveBeenLastCalledWith(response);
    expect(selections).toHaveBeenLastCalledWith(expect.objectContaining({ imageId: 'restored' }));
    expect(component.publishBlocked()).toBe(true);

    http.get.mockReturnValueOnce(of(new Blob()));
    component.retry();

    expect(component.selectedImage()?.imageId).toBe('restored');
    expect(component.publishBlocked()).toBe(false);
    expect(http.request).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('ignores expired Temporary image restoration', () => {
    vi.setSystemTime('2031-01-01T00:00:00Z');
    const { component, http } = harness();

    component.restoreTemporaryImage(uploaded('expired'));

    expect(http.get).not.toHaveBeenCalled();
    expect(component.card()).toBeNull();
    vi.useRealTimers();
  });

  it('shows expired restored image as remove-and-reselect with no dead retry action', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2029-01-01T00:00:00Z');
    const { component, fixture } = harness(true);
    const selections = vi.fn();
    component.imageChange.subscribe(selections);
    component.restoreTemporaryImage({ ...uploaded('restored'), expiresAt: '2029-01-01T00:00:01Z' });
    vi.advanceTimersByTime(1_000);
    fixture!.detectChanges();

    expect(component.card()).toMatchObject({ status: 'error', expired: true, retryUpload: false, retryPreview: false });
    expect(selections).toHaveBeenLastCalledWith(null);
    expect(fixture!.nativeElement.querySelector('[data-cy="event-image-error-restored-restored"]')?.textContent).toContain('Expired');
    expect(fixture!.nativeElement.querySelector('[data-cy="event-image-retry-restored-restored"]')).toBeNull();
    expect(fixture!.nativeElement.querySelector('[data-cy="event-image-remove-restored-restored"]')).not.toBeNull();
    fixture!.destroy();
    vi.useRealTimers();
  });

  it('centers the singular picker in the drop zone while preserving keyboard file access', () => {
    const { fixture } = harness(true);
    const dropZone = fixture!.nativeElement.querySelector('[data-cy="event-image-drop-zone"]') as HTMLElement;
    const picker = fixture!.nativeElement.querySelector('[data-cy="event-image-picker"]') as HTMLInputElement;
    const style = getComputedStyle(dropZone);

    expect(style.display).toBe('flex');
    expect(style.alignItems).toBe('center');
    expect(style.justifyContent).toBe('center');
    expect(style.textAlign).toBe('center');
    expect(picker.type).toBe('file');
    expect(picker.disabled).toBe(false);
    expect(fixture!.nativeElement.querySelector('label[for="event-image-picker"]')).not.toBeNull();
  });

  it('renders no alt, move, reorder, or multiple controls; red icon remove has accessible pending name', async () => {
    const { component, requests, fixture } = harness(true);
    component.addFiles([file('one.png')]);
    finish(requests[0], 'one');
    fixture!.detectChanges();
    const button = fixture!.nativeElement.querySelector('[data-cy^="event-image-remove-"]') as HTMLButtonElement;

    expect(fixture!.nativeElement.querySelector('input[type="file"]').hasAttribute('multiple')).toBe(false);
    expect(fixture!.nativeElement.querySelector('[data-cy*="event-image-alt-"]')).toBeNull();
    expect(fixture!.nativeElement.querySelector('[data-cy*="event-image-move-"]')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Remove one.png');
    expect(button.querySelector('svg')).not.toBeNull();
    const audit = await axe.run(fixture!.nativeElement, { rules: { 'color-contrast': { enabled: false } } });
    expect(audit.violations.map(item => item.id)).toEqual([]);
  });

  it('keeps upload, preview, and delete failures visible with retry', async () => {
    const { component, requests, http } = harness();
    component.addFiles([file('one.png')]);
    requests[0].error(new Error('network'));
    expect(component.card()?.error).toBe('Upload failed');
    expect(component.card()?.retryUpload).toBe(true);

    component.retry();
    finish(requests[1], 'one');
    http.delete.mockReturnValueOnce(new Subject<undefined>().asObservable());
    void component.remove();
    expect(component.card()?.removePending).toBe(true);
  });
});
