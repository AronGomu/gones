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
import { EventImageUploaderComponent } from './event-image-uploader.component';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

const copy: Record<string, string> = {
  'common.retry': 'Retry',
  'eventImages.title': 'Event images',
  'eventImages.help': 'Help',
  'eventImages.choose': 'Choose images',
  'eventImages.existingName': 'Existing image {index}',
  'eventImages.maximum': 'Maximum five images.',
  'eventImages.typeUnsupported': 'Use a JPEG, PNG, or WebP image.',
  'eventImages.tooLarge': 'Image must be 5 MiB or smaller.',
  'eventImages.uploading': 'Uploading… {progress}%',
  'eventImages.uploadFailed': 'Image upload failed.',
  'eventImages.previewFailed': 'Processed image previews could not load.',
  'eventImages.removeFailed': 'Image removal failed.',
  'eventImages.expired': 'Image upload expired. Re-upload or remove it.',
  'eventImages.reupload': 'Re-upload',
  'eventImages.moveLeft': 'Move left',
  'eventImages.moveRight': 'Move right',
  'eventImages.moveLeftNamed': 'Move {name} left',
  'eventImages.moveRightNamed': 'Move {name} right',
  'eventImages.remove': 'Remove',
  'eventImages.removeNamed': 'Remove {name}',
  'eventImages.removing': 'Removing…',
  'eventImages.publishBlocked': 'Finish image uploads before publishing.'
};

const i18n = {
  t: (key: string, params: Record<string, string | number> = {}) => Object.entries(params)
    .reduce((value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)), copy[key] ?? key)
};

const uploaded = (id: string, expiresAt = '2030-01-02T12:00:00Z'): EventImageUploadResponse => ({
  id,
  state: 'Temporary',
  width: 960,
  height: 540,
  expiresAt,
  variants: [
    { width: 320, height: 180, url: `/api/event-images/${id}/variants/320` },
    { width: 960, height: 540, url: `/api/event-images/${id}/variants/960` }
  ]
});

function file(name: string, type = 'image/png', size = 3): File {
  return new File([new Uint8Array(size)], name, { type });
}

function httpHarness() {
  const requests: Subject<HttpEvent<EventImageUploadResponse>>[] = [];
  const http = {
    request: vi.fn(() => {
      const subject = new Subject<HttpEvent<EventImageUploadResponse>>();
      requests.push(subject);
      return subject.asObservable();
    }),
    get: vi.fn(() => of(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }))),
    delete: vi.fn(() => of(undefined))
  };
  return { http, requests };
}

function setup() {
  const { http, requests } = httpHarness();
  const injector = Injector.create({ providers: [
    { provide: HttpClient, useValue: http },
    { provide: API_BASE_URL, useValue: '' },
    { provide: I18nService, useValue: i18n }
  ] });
  const component = runInInjectionContext(injector, () => new EventImageUploaderComponent());
  return { component, http, requests };
}

function setupDom() {
  const { http, requests } = httpHarness();
  TestBed.configureTestingModule({
    imports: [EventImageUploaderComponent],
    providers: [
      { provide: HttpClient, useValue: http },
      { provide: API_BASE_URL, useValue: '' },
      { provide: I18nService, useValue: i18n }
    ]
  });
  const fixture = TestBed.createComponent(EventImageUploaderComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, http, requests };
}

function finish(subject: Subject<HttpEvent<EventImageUploadResponse>>, id: string, expiresAt?: string): void {
  subject.next({ type: HttpEventType.UploadProgress, loaded: 2, total: 3 });
  subject.next(new HttpResponse({ status: 201, body: uploaded(id, expiresAt) }));
  subject.complete();
}

describe('EventImageUploaderComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    let objectUrl = 0;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:test-${++objectUrl}`) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('hydrates existing Event-owned images and defers reorder, alt edit, and removal to Event PATCH', async () => {
    const { component, http } = setup();
    component.initialImages = [
      {
        id: 'existing-1', altText: 'First',
        variants: [{ width: 320, height: 180, url: '/api/event-images/existing-1/variants/320' }]
      },
      {
        id: 'existing-2', altText: undefined,
        variants: [{ width: 320, height: 180, url: '/api/event-images/existing-2/variants/320' }]
      }
    ];

    expect(component.cards().map(card => card.response?.id)).toEqual(['existing-1', 'existing-2']);
    expect(component.publishBlocked()).toBe(false);
    component.moveLeft('existing-existing-2');
    component.setAltText('existing-existing-2', { target: { value: '  New alt  ' } } as unknown as Event);
    await component.remove('existing-existing-1');

    expect(http.delete).not.toHaveBeenCalled();
    expect(component.selectedImages().map(image => ({ imageId: image.imageId, altText: image.altText }))).toEqual([
      { imageId: 'existing-2', altText: 'New alt' }
    ]);

    component.addFiles([file('bad.gif', 'image/gif')]);
    expect(component.publishBlocked()).toBe(true);
    component.initialImages = [{
      id: 'latest', altText: 'Latest',
      variants: [{ width: 320, height: 180, url: '/api/event-images/latest/variants/320' }]
    }];
    expect(component.publishBlocked()).toBe(false);
    expect(component.selectedImages().map(image => image.imageId)).toEqual(['latest']);
  });

  it('keeps valid peers when one file is invalid and blocks publish while pending or failed', () => {
    const { component, http, requests } = setup();

    component.addFiles([file('one.png'), file('bad.gif', 'image/gif'), file('two.png')]);
    finish(requests[0], 'one');
    requests[1].error(new Error('network'));

    expect(component.cards().map(card => card.status)).toEqual(['uploaded', 'error', 'error']);
    expect(component.cards()[0].progress).toBe(100);
    expect(component.cards()[0].srcset).toContain('960w');
    expect(http.get).toHaveBeenCalledWith('/api/event-images/one/variants/320', { responseType: 'blob' });
    expect(http.get).toHaveBeenCalledWith('/api/event-images/one/variants/960', { responseType: 'blob' });
    expect(component.publishBlocked()).toBe(true);
  });

  it('does not offer or execute retry for client-validation errors', () => {
    const { fixture, component, http } = setupDom();
    component.addFiles([file('bad.gif', 'image/gif')]);
    fixture.detectChanges();
    const localId = component.cards()[0].localId;

    expect(fixture.nativeElement.querySelector(`[data-cy="event-image-error-${localId}"]`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector(`[data-cy="event-image-retry-${localId}"]`)).toBeNull();
    component.retry(localId);
    expect(http.request).not.toHaveBeenCalled();
  });

  it('retries a failed upload without discarding successful peers', () => {
    const { component, requests } = setup();
    component.addFiles([file('one.png'), file('two.png')]);
    finish(requests[0], 'one');
    requests[1].error(new Error('network'));
    const failedId = component.cards()[1].localId;

    component.retry(failedId);
    finish(requests[2], 'two');

    expect(component.cards().map(card => card.response?.id)).toEqual(['one', 'two']);
    expect(component.publishBlocked()).toBe(false);
  });

  it('emits ordered image IDs with optional trimmed alt text and preview metadata', () => {
    const { component, requests } = setup();
    component.addFiles([file('hero.png')]);
    finish(requests[0], 'hero');
    const localId = component.cards()[0].localId;

    component.setAltText(localId, { target: { value: '  Main hall  ' } } as unknown as Event);

    expect(component.selectedImages()).toEqual([expect.objectContaining({
      imageId: 'hero',
      altText: 'Main hall',
      previewUrl: expect.stringContaining('blob:')
    })]);
  });

  it('blocks at response expiry and supports re-upload or local removal without losing card draft state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    try {
      const { component, http, requests } = setup();
      const blockedStates: boolean[] = [];
      component.publishBlockedChange.subscribe(value => blockedStates.push(value));
      component.addFiles([file('one.png'), file('two.png')]);
      finish(requests[0], 'one', '2030-01-01T12:00:01Z');
      finish(requests[1], 'two', '2030-01-01T12:00:01Z');
      const [one, two] = component.cards().map(card => card.localId);
      component.setAltText(one, { target: { value: '  Main hall  ' } } as unknown as Event);

      await vi.advanceTimersByTimeAsync(999);
      expect(component.publishBlocked()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(component.cards().map(card => card.expired)).toEqual([true, true]);
      expect(component.cards().map(card => card.status)).toEqual(['error', 'error']);
      expect(component.selectedImages()).toEqual([]);
      expect(component.publishBlocked()).toBe(true);
      expect(blockedStates.at(-1)).toBe(true);

      component.retry(one);
      expect(component.cards()[0].altText).toBe('  Main hall  ');
      expect(component.cards()[1].localId).toBe(two);
      finish(requests[2], 'one-reuploaded', '2030-01-02T12:00:00Z');
      expect(component.selectedImages()).toEqual([expect.objectContaining({
        imageId: 'one-reuploaded',
        altText: 'Main hall'
      })]);

      await component.remove(two);
      expect(http.delete).not.toHaveBeenCalled();
      expect(component.cards()).toHaveLength(1);
      expect(component.publishBlocked()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps cards at five and reports excess files without replacing peers', () => {
    const { component, requests } = setup();
    component.addFiles(Array.from({ length: 6 }, (_, index) => file(`${index}.png`)));

    expect(component.cards()).toHaveLength(5);
    expect(requests).toHaveLength(5);
    expect(component.limitError()).toBeTruthy();
  });

  it('reorders by keyboard actions and drag contract', () => {
    const { component } = setup();
    component.addFiles([file('one.png'), file('two.png'), file('three.png')]);
    const [one, two, three] = component.cards().map(card => card.localId);

    component.moveRight(one);
    expect(component.cards().map(card => card.localId)).toEqual([two, one, three]);
    component.moveLeft(three);
    expect(component.cards().map(card => card.localId)).toEqual([two, three, one]);
    component.drop({ previousIndex: 2, currentIndex: 0 } as never);
    expect(component.cards().map(card => card.localId)).toEqual([one, two, three]);
  });

  it('renders image-specific accessible action names without basic axe violations', async () => {
    const { fixture, component, requests } = setupDom();
    component.addFiles([file('one.png')]);
    finish(requests[0], 'one');
    fixture.detectChanges();
    const localId = component.cards()[0].localId;

    expect(fixture.nativeElement.querySelector(`[data-cy="event-image-move-left-${localId}"]`).getAttribute('aria-label')).toBe('Move one.png left');
    expect(fixture.nativeElement.querySelector(`[data-cy="event-image-move-right-${localId}"]`).getAttribute('aria-label')).toBe('Move one.png right');
    expect(fixture.nativeElement.querySelector(`[data-cy="event-image-remove-${localId}"]`).getAttribute('aria-label')).toBe('Remove one.png');
    const audit = await axe.run(fixture.nativeElement, { rules: { 'color-contrast': { enabled: false } } });
    expect(audit.violations.map(violation => violation.id)).toEqual([]);
  });

  it('does not announce uploading while an uploaded image is being removed', async () => {
    const { fixture, component, http, requests } = setupDom();
    const deletion = new Subject<undefined>();
    http.delete.mockReturnValue(deletion.asObservable());
    component.addFiles([file('one.png')]);
    finish(requests[0], 'one');
    const localId = component.cards()[0].localId;

    const removal = component.remove(localId);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(`[data-cy="event-image-pending-${localId}"]`)).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Uploading');
    expect(fixture.nativeElement.textContent).toContain('Removing');
    deletion.next(undefined);
    deletion.complete();
    await removal;
  });

  it('blocks duplicate removes while deletion is pending', async () => {
    const { component, http, requests } = setup();
    const deletion = new Subject<undefined>();
    http.delete.mockReturnValue(deletion.asObservable());
    component.addFiles([file('one.png')]);
    finish(requests[0], 'one');
    const localId = component.cards()[0].localId;

    const first = component.remove(localId);
    const second = component.remove(localId);
    expect(http.delete).toHaveBeenCalledTimes(1);
    expect(component.cards()[0].removePending).toBe(true);
    deletion.next(undefined);
    deletion.complete();
    await Promise.all([first, second]);

    expect(component.cards()).toEqual([]);
  });

  it('revokes local and processed blob URLs after replacement, removal, and destroy', async () => {
    const { component, requests } = setup();
    component.addFiles([file('one.png')]);
    finish(requests[0], 'one');

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
    await component.remove(component.cards()[0].localId);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-3');

    component.addFiles([file('bad.gif', 'image/gif')]);
    component.ngOnDestroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-4');
  });

  it('removes uploaded image through API and keeps remaining order', async () => {
    const { component, http, requests } = setup();
    component.addFiles([file('one.png'), file('two.png')]);
    finish(requests[0], 'one');
    finish(requests[1], 'two');

    await component.remove(component.cards()[0].localId);

    expect(http.delete).toHaveBeenCalledWith('/api/event-images/one');
    expect(component.cards().map(card => card.response?.id)).toEqual(['two']);
  });
});
