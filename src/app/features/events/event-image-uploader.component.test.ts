import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpClient, HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { API_BASE_URL, EventImageUploadResponse } from '../../api/generated/gones-api';
import { EventImageUploaderComponent } from './event-image-uploader.component';

const uploaded = (id: string): EventImageUploadResponse => ({
  id,
  state: 'Temporary',
  width: 960,
  height: 540,
  expiresAt: '2030-01-02T12:00:00Z',
  variants: [
    { width: 320, height: 180, url: `/api/event-images/${id}/variants/320` },
    { width: 960, height: 540, url: `/api/event-images/${id}/variants/960` }
  ]
});

function file(name: string, type = 'image/png', size = 3): File {
  return new File([new Uint8Array(size)], name, { type });
}

function setup() {
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
  const injector = Injector.create({ providers: [
    { provide: HttpClient, useValue: http },
    { provide: API_BASE_URL, useValue: '' },
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new EventImageUploaderComponent());
  return { component, http, requests };
}

function finish(subject: Subject<HttpEvent<EventImageUploadResponse>>, id: string): void {
  subject.next({ type: HttpEventType.UploadProgress, loaded: 2, total: 3 });
  subject.next(new HttpResponse({ status: 201, body: uploaded(id) }));
  subject.complete();
}

describe('EventImageUploaderComponent', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((value: File) => `blob:${value.name}`) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
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

  it('removes uploaded image through API and keeps remaining order', async () => {
    const { component, http, requests } = setup();
    component.addFiles([file('one.png'), file('two.png')]);
    finish(requests[0], 'one');
    finish(requests[1], 'two');

    await component.remove(component.cards()[0].localId);

    expect(http.delete).toHaveBeenCalledWith('/api/event-images/one');
    expect(component.cards().map(card => card.response?.id)).toEqual(['two']);
  });

  it('renders feature-prefixed hooks, responsive variants, retry/remove, and keyboard move controls', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/features/events/event-image-uploader.component.ts'), 'utf8');

    for (const token of ['data-cy="event-image-uploader"', '[attr.srcset]="card.srcset"', '(cdkDropListDropped)="drop($event)"',
      'event-image-retry-', 'event-image-remove-', 'event-image-move-left-', 'event-image-move-right-']) {
      expect(source).toContain(token);
    }
  });

  it('ships uploader copy in English and French', () => {
    const messages = readFileSync(resolve(process.cwd(), 'src/app/i18n/messages.ts'), 'utf8');
    expect(messages.match(/'eventImages\.title'/g)).toHaveLength(2);
    expect(messages.match(/'eventImages\.moveLeft'/g)).toHaveLength(2);
    expect(messages.match(/'eventImages\.moveRight'/g)).toHaveLength(2);
  });
});
