import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { HttpClient, HttpEventType, HttpResponse } from '@angular/common/http';
import { Component, EventEmitter, Input, OnDestroy, Output, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Subscription, firstValueFrom, forkJoin } from 'rxjs';
import { joinApiUrl } from '../../api/api-boundary';
import { API_BASE_URL, EventImageResponse, EventImageUploadResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';

export type EventImageUploadStatus = 'pending' | 'uploaded' | 'error';

type EventImageClientResponse = EventImageResponse | EventImageUploadResponse;

export interface EventImageSelection {
  readonly imageId: string;
  readonly altText: string | null;
  readonly response: EventImageClientResponse;
  readonly previewUrl: string;
  readonly srcset: string;
}

export interface EventImageUploadCard {
  readonly localId: string;
  readonly file?: File;
  readonly fileName: string;
  readonly existing: boolean;
  readonly status: EventImageUploadStatus;
  readonly progress: number;
  readonly previewUrl: string;
  readonly srcset: string;
  readonly response?: EventImageClientResponse;
  readonly altText: string;
  readonly error: string;
  readonly retryUpload: boolean;
  readonly retryDelete: boolean;
  readonly retryPreview: boolean;
  readonly removePending: boolean;
  readonly expired: boolean;
  readonly objectUrls: readonly string[];
}

@Component({
  selector: 'gones-event-image-uploader',
  standalone: true,
  imports: [CdkDropList, CdkDrag, MatButtonModule],
  styles: [`
    :host { display: block; }
    [data-cy="event-image-drop-zone"] { padding: 1rem; border: 1px dashed var(--steel); background: var(--black-metal); }
    [data-cy="event-image-picker-label"] { display: block; margin-bottom: .5rem; font-weight: 800; }
    .event-image-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
    .event-image-list > li { min-width: 0; padding: .75rem; border: 1px solid var(--soot); background: var(--iron); }
    .event-image-list img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--forge); }
    .event-image-list progress { width: 100%; }
  `],
  template: `
    <section class="stack" data-cy="event-image-uploader" [attr.aria-busy]="hasPending()" aria-labelledby="event-image-uploader-title">
      <h2 id="event-image-uploader-title" data-cy="event-image-uploader-title">{{ i18n.t('eventImages.title') }}</h2>
      <p class="muted" data-cy="event-image-uploader-help">{{ i18n.t('eventImages.help') }}</p>
      <div data-cy="event-image-drop-zone" (dragover)="allowFileDrop($event)" (drop)="onFileDrop($event)">
        <label for="event-image-picker" data-cy="event-image-picker-label">{{ i18n.t('eventImages.choose') }}</label>
        <input id="event-image-picker" data-cy="event-image-picker" type="file" accept="image/jpeg,image/png,image/webp" multiple (change)="onFileInput($event)" />
      </div>
      @if (limitError()) { <p class="error" role="alert" data-cy="event-image-limit-error">{{ limitError() }}</p> }
      <ul class="event-image-list" data-cy="event-image-list" cdkDropList cdkDropListOrientation="horizontal" (cdkDropListDropped)="drop($event)">
        @for (card of cards(); track card.localId; let index = $index) {
          <li cdkDrag [attr.data-cy]="'event-image-card-' + card.localId">
            <img [src]="card.previewUrl" [attr.srcset]="card.srcset" sizes="(max-width: 480px) 100vw, 320px" alt="" [attr.data-cy]="'event-image-preview-' + card.localId" />
            <p [attr.data-cy]="'event-image-name-' + card.localId">{{ card.fileName }}</p>
            <label [for]="'event-image-alt-' + card.localId" [attr.data-cy]="'event-image-alt-label-' + card.localId">{{ i18n.t('eventImages.altText') }}</label>
            <input [id]="'event-image-alt-' + card.localId" [attr.data-cy]="'event-image-alt-' + card.localId" type="text" maxlength="300" [value]="card.altText" [attr.aria-label]="i18n.t('eventImages.altTextNamed', { name: card.fileName })" (input)="setAltText(card.localId, $event)" />
            @if (card.status === 'pending' && !card.removePending) {
              <progress max="100" [value]="card.progress" [attr.data-cy]="'event-image-progress-' + card.localId"></progress>
              <p role="status" [attr.data-cy]="'event-image-pending-' + card.localId">{{ i18n.t('eventImages.uploading', { progress: card.progress }) }}</p>
            }
            @if (card.status === 'error') {
              <p class="error" role="alert" [attr.data-cy]="'event-image-error-' + card.localId">{{ card.error }}</p>
              @if (card.retryUpload || card.retryDelete || card.retryPreview) {
                <button mat-stroked-button type="button" [attr.data-cy]="'event-image-retry-' + card.localId" (click)="retry(card.localId)">{{ card.expired ? i18n.t('eventImages.reupload') : i18n.t('common.retry') }}</button>
              }
            }
            <div class="actions" [attr.data-cy]="'event-image-actions-' + card.localId">
              <button mat-stroked-button type="button" [attr.data-cy]="'event-image-move-left-' + card.localId" [attr.aria-label]="i18n.t('eventImages.moveLeftNamed', { name: card.fileName })" [disabled]="index === 0" (click)="moveLeft(card.localId)">{{ i18n.t('eventImages.moveLeft') }}</button>
              <button mat-stroked-button type="button" [attr.data-cy]="'event-image-move-right-' + card.localId" [attr.aria-label]="i18n.t('eventImages.moveRightNamed', { name: card.fileName })" [disabled]="index === cards().length - 1" (click)="moveRight(card.localId)">{{ i18n.t('eventImages.moveRight') }}</button>
              <button mat-stroked-button type="button" [attr.data-cy]="'event-image-remove-' + card.localId" [attr.aria-label]="i18n.t('eventImages.removeNamed', { name: card.fileName })" [disabled]="card.removePending" (click)="remove(card.localId)">{{ card.removePending ? i18n.t('eventImages.removing') : i18n.t('eventImages.remove') }}</button>
            </div>
          </li>
        }
      </ul>
      @if (publishBlocked()) { <p class="warning" role="status" data-cy="event-image-publish-blocked">{{ i18n.t('eventImages.publishBlocked') }}</p> }
    </section>
  `
})
export class EventImageUploaderComponent implements OnDestroy {
  private static readonly MaximumImages = 5;
  private static readonly MaximumBytes = 5 * 1024 * 1024;
  private static readonly AcceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  readonly i18n = inject(I18nService);
  private readonly requests = new Map<string, Subscription>();
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private nextId = 0;
  private initialImagesValue?: readonly EventImageResponse[];

  readonly cards = signal<EventImageUploadCard[]>([]);
  readonly limitError = signal('');
  readonly hasPending = computed(() => this.cards().some(card => card.status === 'pending'));
  readonly publishBlocked = computed(() => this.cards().some(card => card.status !== 'uploaded' || card.expired));
  readonly uploadedImages = computed(() => this.cards().flatMap(card => card.response && !card.expired ? [card.response] : []));
  readonly selectedImages = computed<EventImageSelection[]>(() => this.cards().flatMap(card =>
    card.response && card.status === 'uploaded'
      ? [{
          imageId: card.response.id,
          altText: card.altText.trim() || null,
          response: card.response,
          previewUrl: card.previewUrl,
          srcset: card.srcset
        }]
      : []));

  @Output() readonly imagesChange = new EventEmitter<readonly EventImageSelection[]>();
  @Output() readonly publishBlockedChange = new EventEmitter<boolean>();

  @Input() set initialImages(images: readonly EventImageResponse[]) {
    if (images === this.initialImagesValue) return;
    this.initialImagesValue = images;
    for (const request of this.requests.values()) request.unsubscribe();
    this.requests.clear();
    for (const card of this.cards()) this.revoke(card.objectUrls);
    this.cards.set(images.map((image, index) => {
      const variants = [...image.variants].sort((left, right) => left.width - right.width);
      const urls = variants.map(variant => joinApiUrl(this.baseUrl, variant.url));
      return {
        localId: `existing-${image.id}`,
        fileName: this.i18n.t('eventImages.existingName', { index: index + 1 }),
        existing: true,
        status: 'uploaded',
        progress: 100,
        previewUrl: urls.at(-1) ?? '',
        srcset: variants.map((variant, variantIndex) => `${urls[variantIndex]} ${variant.width}w`).join(', '),
        response: image,
        altText: image.altText ?? '',
        error: '',
        retryUpload: false,
        retryDelete: false,
        retryPreview: false,
        removePending: false,
        expired: false,
        objectUrls: []
      } satisfies EventImageUploadCard;
    }));
    this.limitError.set('');
    this.emitState();
  }

  addFiles(files: readonly File[]): void {
    this.limitError.set('');
    const available = EventImageUploaderComponent.MaximumImages - this.cards().length;
    if (files.length > available) this.limitError.set(this.i18n.t('eventImages.maximum'));
    for (const file of files.slice(0, Math.max(0, available)))
    {
      const previewUrl = URL.createObjectURL(file);
      const card: EventImageUploadCard = {
        localId: `local-${++this.nextId}`,
        file,
        fileName: file.name,
        existing: false,
        status: 'pending',
        progress: 0,
        previewUrl,
        srcset: '',
        altText: '',
        error: '',
        retryUpload: false,
        retryDelete: false,
        retryPreview: false,
        removePending: false,
        expired: false,
        objectUrls: [previewUrl]
      };
      this.cards.update(cards => [...cards, card]);
      if (!EventImageUploaderComponent.AcceptedTypes.has(file.type))
      {
        this.fail(card.localId, this.i18n.t('eventImages.typeUnsupported'));
      }
      else if (file.size > EventImageUploaderComponent.MaximumBytes)
      {
        this.fail(card.localId, this.i18n.t('eventImages.tooLarge'));
      }
      else
      {
        this.upload(card.localId);
      }
    }
    this.emitState();
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  allowFileDrop(event: DragEvent): void {
    event.preventDefault();
  }

  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  retry(localId: string): void {
    const card = this.find(localId);
    if (!card || card.status !== 'error') return;
    if (card.retryDelete) void this.remove(localId);
    else if (card.retryPreview && card.response && this.isUploadResponse(card.response)) this.loadPreviews(localId, card.response);
    else if (card.retryUpload) this.upload(localId);
  }

  async remove(localId: string): Promise<void> {
    const card = this.find(localId);
    if (!card || card.removePending) return;
    this.requests.get(localId)?.unsubscribe();
    this.requests.delete(localId);
    if (!card.existing && card.response && !card.expired && !this.responseExpired(card.response))
    {
      this.patch(localId, { status: 'pending', progress: 0, error: '', retryUpload: false, retryDelete: false, retryPreview: false, removePending: true });
      try
      {
        await firstValueFrom(this.http.delete<void>(joinApiUrl(this.baseUrl, `/api/event-images/${card.response.id}`)));
      }
      catch
      {
        this.patch(localId, {
          status: 'error',
          error: this.i18n.t('eventImages.removeFailed'),
          retryUpload: false,
          retryDelete: true,
          retryPreview: false,
          removePending: false
        });
        return;
      }
    }
    this.revoke(card.objectUrls);
    this.cards.update(cards => cards.filter(item => item.localId !== localId));
    this.emitState();
  }

  setAltText(localId: string, event: Event): void {
    this.patch(localId, { altText: (event.target as HTMLInputElement).value.slice(0, 300) });
  }

  moveLeft(localId: string): void {
    this.move(localId, -1);
  }

  moveRight(localId: string): void {
    this.move(localId, 1);
  }

  drop(event: CdkDragDrop<EventImageUploadCard[]>): void {
    const cards = [...this.cards()];
    moveItemInArray(cards, event.previousIndex, event.currentIndex);
    this.cards.set(cards);
    this.emitState();
  }

  ngOnDestroy(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    for (const request of this.requests.values()) request.unsubscribe();
    for (const card of this.cards()) this.revoke(card.objectUrls);
  }

  private upload(localId: string): void {
    const card = this.find(localId);
    if (!card?.file || card.existing) return;
    this.requests.get(localId)?.unsubscribe();
    this.patch(localId, {
      status: 'pending',
      progress: 0,
      response: undefined,
      error: '',
      retryUpload: false,
      retryDelete: false,
      retryPreview: false,
      expired: false
    });
    const form = new FormData();
    form.append('file', card.file, card.file.name);
    const request = this.http.request<EventImageUploadResponse>('POST', joinApiUrl(this.baseUrl, '/api/event-images'), {
      body: form,
      observe: 'events',
      reportProgress: true
    }).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress)
        {
          const progress = event.total ? Math.round(event.loaded * 100 / event.total) : 0;
          this.patch(localId, { progress });
        }
        else if (event instanceof HttpResponse && event.body)
        {
          this.patch(localId, {
            status: 'pending',
            progress: 100,
            response: event.body,
            error: '',
            retryUpload: false,
            retryDelete: false,
            retryPreview: false,
            expired: false
          });
          this.requests.delete(localId);
          if (this.responseExpired(event.body)) this.markExpired(localId);
          else this.loadPreviews(localId, event.body);
        }
      },
      error: () => {
        this.requests.delete(localId);
        this.fail(localId, this.i18n.t('eventImages.uploadFailed'), true);
      }
    });
    if (!request.closed) this.requests.set(localId, request);
  }

  private loadPreviews(localId: string, response: EventImageUploadResponse): void {
    const variants = [...response.variants].sort((left, right) => left.width - right.width);
    this.patch(localId, { status: 'pending', error: '', retryUpload: false, retryDelete: false, retryPreview: false });
    const request = forkJoin(variants.map(variant => this.http.get(
      joinApiUrl(this.baseUrl, variant.url),
      { responseType: 'blob' }
    ))).subscribe({
      next: blobs => {
        const card = this.find(localId);
        if (!card) return;
        if (this.responseExpired(response)) {
          this.markExpired(localId);
          return;
        }
        this.revoke(card.objectUrls);
        const objectUrls = blobs.map(blob => URL.createObjectURL(blob));
        this.patch(localId, {
          status: 'uploaded',
          previewUrl: objectUrls.at(-1) ?? '',
          srcset: variants.map((variant, index) => `${objectUrls[index]} ${variant.width}w`).join(', '),
          error: '',
          retryUpload: false,
          retryDelete: false,
          retryPreview: false,
          expired: false,
          objectUrls
        });
        this.requests.delete(localId);
      },
      error: () => {
        this.requests.delete(localId);
        this.patch(localId, {
          status: 'error',
          error: this.i18n.t('eventImages.previewFailed'),
          retryUpload: false,
          retryDelete: false,
          retryPreview: true
        });
      }
    });
    if (!request.closed) this.requests.set(localId, request);
  }

  private fail(localId: string, error: string, retryUpload = false): void {
    this.patch(localId, { status: 'error', error, retryUpload, retryDelete: false, retryPreview: false, expired: false });
  }

  private markExpired(localId: string): void {
    this.requests.get(localId)?.unsubscribe();
    this.requests.delete(localId);
    this.patch(localId, {
      status: 'error',
      error: this.i18n.t('eventImages.expired'),
      retryUpload: true,
      retryDelete: false,
      retryPreview: false,
      removePending: false,
      expired: true
    });
  }

  private expireReadyCards(): void {
    const expiredIds = this.cards()
      .filter(card => card.response && !card.expired && this.responseExpired(card.response))
      .map(card => card.localId);
    for (const localId of expiredIds) {
      this.requests.get(localId)?.unsubscribe();
      this.requests.delete(localId);
    }
    if (expiredIds.length) {
      const expired = new Set(expiredIds);
      this.cards.update(cards => cards.map(card => expired.has(card.localId) ? {
        ...card,
        status: 'error',
        error: this.i18n.t('eventImages.expired'),
        retryUpload: true,
        retryDelete: false,
        retryPreview: false,
        removePending: false,
        expired: true
      } : card));
    }
    this.emitState();
  }

  private responseExpired(response: EventImageClientResponse): boolean {
    if (!this.isUploadResponse(response)) return false;
    const expiresAt = Date.parse(response.expiresAt);
    return !Number.isFinite(expiresAt) || Date.now() >= expiresAt;
  }

  private isUploadResponse(response: EventImageClientResponse): response is EventImageUploadResponse {
    return 'expiresAt' in response;
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    const expiries = this.cards()
      .filter(card => card.response && !card.expired)
      .map(card => Date.parse(card.response!.expiresAt))
      .filter(Number.isFinite);
    if (!expiries.length) return;
    const delay = Math.min(2_147_483_647, Math.max(0, Math.min(...expiries) - Date.now()));
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined;
      this.expireReadyCards();
    }, delay);
  }

  private move(localId: string, offset: number): void {
    const cards = [...this.cards()];
    const from = cards.findIndex(card => card.localId === localId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= cards.length) return;
    moveItemInArray(cards, from, to);
    this.cards.set(cards);
    this.emitState();
  }

  private find(localId: string): EventImageUploadCard | undefined {
    return this.cards().find(card => card.localId === localId);
  }

  private patch(localId: string, patch: Partial<EventImageUploadCard>): void {
    this.cards.update(cards => cards.map(card => card.localId === localId ? { ...card, ...patch } : card));
    this.emitState();
  }

  private revoke(urls: readonly string[]): void {
    for (const url of urls) URL.revokeObjectURL(url);
  }

  private emitState(): void {
    this.scheduleExpiry();
    this.imagesChange.emit(this.selectedImages());
    this.publishBlockedChange.emit(this.publishBlocked());
  }
}
