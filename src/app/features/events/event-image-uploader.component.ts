import { HttpClient, HttpEventType, HttpResponse } from '@angular/common/http';
import { Component, EventEmitter, Input, OnDestroy, Output, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Subscription, firstValueFrom, forkJoin } from 'rxjs';
import { joinApiUrl } from '../../api/api-boundary';
import { API_BASE_URL, EventImageResponse, EventImageUploadResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { MessageKey } from '../../i18n/messages';

export type EventImageUploadStatus = 'pending' | 'uploaded' | 'error';
type EventImageClientResponse = EventImageResponse | EventImageUploadResponse;

export interface EventImageSelection {
  readonly imageId: string;
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
  imports: [MatButtonModule],
  styles: [`
    :host { display: block; }
    [data-cy="event-image-drop-zone"] { display: flex; min-height: 8rem; padding: 1rem; flex-direction: column; align-items: center; justify-content: center; gap: .75rem; border: 1px dashed var(--steel); background: var(--black-metal); text-align: center; }
    [data-cy="event-image-picker-label"] { display: block; font-weight: 800; }
    [data-cy="event-image-picker"] { max-width: 100%; }
    .event-image-card { max-width: 24rem; margin-top: 1rem; padding: .75rem; border: 1px solid var(--soot); background: var(--iron); }
    .event-image-card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--forge); }
    .event-image-card progress { width: 100%; }
    .event-image-remove { color: var(--hot-blood); border-color: currentColor; }
    .event-image-remove svg { width: 1.25rem; height: 1.25rem; }
  `],
  template: `
    <section class="stack" data-cy="event-image-uploader" [attr.aria-busy]="hasPending()" aria-labelledby="event-image-uploader-title">
      <h2 id="event-image-uploader-title" data-cy="event-image-uploader-title">{{ i18n.t('eventImages.title') }}</h2>
      <p class="muted" data-cy="event-image-uploader-help">{{ i18n.t('eventImages.help') }}</p>
      <div data-cy="event-image-drop-zone" (dragover)="allowFileDrop($event)" (drop)="onFileDrop($event)">
        <label for="event-image-picker" data-cy="event-image-picker-label">{{ i18n.t('eventImages.choose') }}</label>
        <input id="event-image-picker" data-cy="event-image-picker" type="file" accept="image/jpeg,image/png,image/webp" (change)="onFileInput($event)" />
      </div>
      @if (limitError()) { <p class="error" role="alert" data-cy="event-image-limit-error">{{ limitError() }}</p> }
      @if (card(); as imageCard) {
        <article class="event-image-card" [attr.data-cy]="'event-image-card-' + imageCard.localId">
          <img [src]="imageCard.previewUrl" [attr.srcset]="imageCard.srcset" sizes="(max-width: 480px) 100vw, 320px" alt="" [attr.data-cy]="'event-image-preview-' + imageCard.localId" />
          <p [attr.data-cy]="'event-image-name-' + imageCard.localId">{{ imageCard.fileName }}</p>
          @if (imageCard.status === 'pending' && !imageCard.removePending) {
            <progress max="100" [value]="imageCard.progress" [attr.data-cy]="'event-image-progress-' + imageCard.localId"></progress>
            <p role="status" [attr.data-cy]="'event-image-pending-' + imageCard.localId">{{ i18n.t('eventImages.uploading', { progress: imageCard.progress }) }}</p>
          }
          @if (imageCard.status === 'error') {
            <p class="error" role="alert" [attr.data-cy]="'event-image-error-' + imageCard.localId">{{ imageCard.error }}</p>
            @if (imageCard.retryUpload || imageCard.retryDelete || imageCard.retryPreview) {
              <button mat-stroked-button type="button" [attr.data-cy]="'event-image-retry-' + imageCard.localId" (click)="retry()">{{ imageCard.expired ? i18n.t('eventImages.reupload') : i18n.t('common.retry') }}</button>
            }
          }
          <button mat-stroked-button class="event-image-remove" type="button" [attr.data-cy]="'event-image-remove-' + imageCard.localId" [attr.aria-label]="i18n.t(imageCard.removePending ? 'eventImages.removingNamed' : 'eventImages.removeNamed', { name: imageCard.fileName })" [disabled]="imageCard.removePending" (click)="remove()">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg>
          </button>
          @if (imageCard.removePending) { <p role="status" [attr.data-cy]="'event-image-removing-' + imageCard.localId">{{ i18n.t('eventImages.removing') }}</p> }
        </article>
      }
      @if (publishBlocked()) { <p class="warning" role="status" data-cy="event-image-publish-blocked">{{ i18n.t(blockedMessageKey) }}</p> }
    </section>
  `
})
export class EventImageUploaderComponent implements OnDestroy {
  private static readonly MaximumBytes = 5 * 1024 * 1024;
  private static readonly AcceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  readonly i18n = inject(I18nService);
  private request?: Subscription;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private nextId = 0;
  private initialImageValue?: EventImageResponse;

  readonly card = signal<EventImageUploadCard | null>(null);
  readonly limitError = signal('');
  readonly hasPending = computed(() => this.card()?.status === 'pending');
  readonly publishBlocked = computed(() => this.card() !== null && (this.card()!.status !== 'uploaded' || this.card()!.expired));
  readonly selectedImage = computed<EventImageSelection | null>(() => {
    const card = this.card();
    return card?.response && card.status === 'uploaded'
      ? { imageId: card.response.id, response: card.response, previewUrl: card.previewUrl, srcset: card.srcset }
      : null;
  });
  readonly temporaryImage = computed<EventImageUploadResponse | null>(() => {
    const card = this.card();
    return card?.response && this.isUploadResponse(card.response) && !card.expired && !this.responseExpired(card.response)
      ? card.response
      : null;
  });

  @Input() blockedMessageKey: MessageKey = 'eventImages.publishBlocked';
  @Output() readonly imageChange = new EventEmitter<EventImageSelection | null>();
  @Output() readonly temporaryImageChange = new EventEmitter<EventImageUploadResponse | null>();
  @Output() readonly publishBlockedChange = new EventEmitter<boolean>();

  @Input() set initialImage(image: EventImageResponse | undefined) {
    if (image === this.initialImageValue) return;
    this.initialImageValue = image;
    this.request?.unsubscribe();
    this.request = undefined;
    if (this.card()) this.revoke(this.card()!.objectUrls);
    if (!image) this.card.set(null);
    else {
      const variants = [...image.variants].sort((left, right) => left.width - right.width);
      const urls = variants.map(variant => joinApiUrl(this.baseUrl, variant.url));
      this.card.set({
        localId: `existing-${image.id}`, fileName: this.i18n.t('eventImages.existingName'), existing: true,
        status: 'uploaded', progress: 100, previewUrl: urls.at(-1) ?? '',
        srcset: variants.map((variant, index) => `${urls[index]} ${variant.width}w`).join(', '), response: image,
        error: '', retryUpload: false, retryDelete: false, retryPreview: false, removePending: false,
        expired: false, objectUrls: []
      });
    }
    this.limitError.set('');
    this.emitState();
  }

  restoreTemporaryImage(response: EventImageUploadResponse): void {
    const expiresAt = Date.parse(response.expiresAt);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return;
    this.request?.unsubscribe();
    this.request = undefined;
    if (this.card()) this.revoke(this.card()!.objectUrls);
    this.card.set({
      localId: `restored-${response.id}`, fileName: this.i18n.t('eventImages.existingName'), existing: false,
      status: 'pending', progress: 100, previewUrl: '', srcset: '', response,
      error: '', retryUpload: false, retryDelete: false, retryPreview: false, removePending: false,
      expired: false, objectUrls: []
    });
    this.limitError.set('');
    this.loadPreviews(response);
  }

  addFiles(files: readonly File[]): void {
    this.limitError.set('');
    if (this.card()) {
      this.limitError.set(this.i18n.t('eventImages.maximum'));
      return;
    }
    if (files.length > 1) this.limitError.set(this.i18n.t('eventImages.maximum'));
    const file = files[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    const card: EventImageUploadCard = {
      localId: `local-${++this.nextId}`, file, fileName: file.name, existing: false, status: 'pending', progress: 0,
      previewUrl, srcset: '', error: '', retryUpload: false, retryDelete: false, retryPreview: false,
      removePending: false, expired: false, objectUrls: [previewUrl]
    };
    this.card.set(card);
    if (!EventImageUploaderComponent.AcceptedTypes.has(file.type)) this.fail(this.i18n.t('eventImages.typeUnsupported'));
    else if (file.size > EventImageUploaderComponent.MaximumBytes) this.fail(this.i18n.t('eventImages.tooLarge'));
    else this.upload();
    this.emitState();
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  allowFileDrop(event: DragEvent): void { event.preventDefault(); }
  onFileDrop(event: DragEvent): void { event.preventDefault(); this.addFiles(Array.from(event.dataTransfer?.files ?? [])); }

  retry(): void {
    const card = this.card();
    if (!card || card.status !== 'error') return;
    if (card.retryDelete) void this.remove();
    else if (card.retryPreview && card.response && this.isUploadResponse(card.response)) this.loadPreviews(card.response);
    else if (card.retryUpload) this.upload();
  }

  async remove(): Promise<void> {
    const card = this.card();
    if (!card || card.removePending) return;
    this.request?.unsubscribe();
    this.request = undefined;
    if (!card.existing && card.response && !card.expired && !this.responseExpired(card.response)) {
      this.patch({ status: 'pending', progress: 0, error: '', retryUpload: false, retryDelete: false, retryPreview: false, removePending: true });
      try {
        await firstValueFrom(this.http.delete<void>(joinApiUrl(this.baseUrl, `/api/event-images/${card.response.id}`)));
      } catch {
        this.patch({ status: 'error', error: this.i18n.t('eventImages.removeFailed'), retryUpload: false, retryDelete: true, retryPreview: false, removePending: false });
        return;
      }
    }
    this.revoke(card.objectUrls);
    this.card.set(null);
    this.emitState();
  }

  ngOnDestroy(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.request?.unsubscribe();
    if (this.card()) this.revoke(this.card()!.objectUrls);
  }

  private upload(): void {
    const card = this.card();
    if (!card?.file || card.existing) return;
    this.request?.unsubscribe();
    this.patch({ status: 'pending', progress: 0, response: undefined, error: '', retryUpload: false, retryDelete: false, retryPreview: false, expired: false });
    const form = new FormData();
    form.append('file', card.file, card.file.name);
    const request = this.http.request<EventImageUploadResponse>('POST', joinApiUrl(this.baseUrl, '/api/event-images'), { body: form, observe: 'events', reportProgress: true }).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress) this.patch({ progress: event.total ? Math.round(event.loaded * 100 / event.total) : 0 });
        else if (event instanceof HttpResponse && event.body) {
          this.patch({ status: 'pending', progress: 100, response: event.body, error: '', retryUpload: false, retryDelete: false, retryPreview: false, expired: false });
          this.request = undefined;
          if (this.responseExpired(event.body)) this.markExpired(); else this.loadPreviews(event.body);
        }
      },
      error: () => { this.request = undefined; this.fail(this.i18n.t('eventImages.uploadFailed'), true); }
    });
    if (!request.closed) this.request = request;
  }

  private loadPreviews(response: EventImageUploadResponse, emitPending = true): void {
    const variants = [...response.variants].sort((left, right) => left.width - right.width);
    this.patch({ status: 'pending', error: '', retryUpload: false, retryDelete: false, retryPreview: false }, emitPending);
    const request = forkJoin(variants.map(variant => this.http.get(joinApiUrl(this.baseUrl, variant.url), { responseType: 'blob' }))).subscribe({
      next: blobs => {
        const card = this.card();
        if (!card) return;
        if (this.responseExpired(response)) { this.markExpired(); return; }
        this.revoke(card.objectUrls);
        const objectUrls = blobs.map(blob => URL.createObjectURL(blob));
        this.patch({ status: 'uploaded', previewUrl: objectUrls.at(-1) ?? '', srcset: variants.map((variant, index) => `${objectUrls[index]} ${variant.width}w`).join(', '), error: '', retryUpload: false, retryDelete: false, retryPreview: false, expired: false, objectUrls });
        this.request = undefined;
      },
      error: () => { this.request = undefined; this.patch({ status: 'error', error: this.i18n.t('eventImages.previewFailed'), retryUpload: false, retryDelete: false, retryPreview: true }); }
    });
    if (!request.closed) this.request = request;
  }

  private fail(error: string, retryUpload = false): void { this.patch({ status: 'error', error, retryUpload, retryDelete: false, retryPreview: false, expired: false }); }
  private markExpired(): void { this.request?.unsubscribe(); this.request = undefined; this.patch({ status: 'error', error: this.i18n.t('eventImages.expired'), retryUpload: false, retryDelete: false, retryPreview: false, removePending: false, expired: true }); }
  private responseExpired(response: EventImageClientResponse): boolean { return this.isUploadResponse(response) && (!Number.isFinite(Date.parse(response.expiresAt)) || Date.now() >= Date.parse(response.expiresAt)); }
  private isUploadResponse(response: EventImageClientResponse): response is EventImageUploadResponse { return 'expiresAt' in response; }
  private patch(patch: Partial<EventImageUploadCard>, emit = true): void { if (this.card()) this.card.update(card => card ? { ...card, ...patch } : null); if (emit) this.emitState(); }
  private revoke(urls: readonly string[]): void { for (const url of urls) URL.revokeObjectURL(url); }
  private emitState(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const response = this.card()?.response;
    if (response && this.isUploadResponse(response) && !this.card()?.expired) {
      const delay = Math.min(2_147_483_647, Math.max(0, Date.parse(response.expiresAt) - Date.now()));
      this.expiryTimer = setTimeout(() => this.markExpired(), delay);
    }
    this.imageChange.emit(this.selectedImage());
    this.temporaryImageChange.emit(this.temporaryImage());
    this.publishBlockedChange.emit(this.publishBlocked());
  }
}
