import { AfterViewInit, Component, DestroyRef, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom, map } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, EventImageUploadResponse, EventManagementResponse, PublicFormatResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService } from '../../auth/auth.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { EventDetailView, EventDetailViewComponent } from './event-detail-view.component';
import { ApproverSelectionDialogComponent } from './approver-selection-dialog.component';
import { DirectPublicationState, eventPayload } from './organizer-event-create';
import { EventProposalService, sortApprovers } from './event-proposal.service';
import { changedEventFields, majorEventChanges, managementToDetail, managementToDraft, eventUpdatePayload } from './event-management';
import { canManageArchive } from '../../data/archive-command-ux';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { EventImageSelection, EventImageUploaderComponent } from './event-image-uploader.component';
import { renderEventMarkdown } from './event-markdown';
import { GeoOption, GeoService } from '../../shared/geo.service';
import { logBoundaryError } from '../../shared/app-logger';
import { EVENT_CREATE_DRAFT_VERSION, EventCreateDraftStore, EventDirtyShape, EventDraftValueV1, RestoredEventCreateDraft, eventCreateDraftIsEmpty, eventDraftIsDirty, normalizeEventDraftValue } from './event-create-draft';

type RecoveryAction = 'reload' | 'login' | 'review-calendar' | 'retry';
interface RecoveryError { message: string; action: RecoveryAction; }

export interface EventOrganizationOption { id: string; name: string; }

const PublicOrganizationPageSize = 100;
const MaximumPublicOrganizationPages = 20;
const PreviewCollapsedKey = 'gones.event-editor.preview-collapsed';
const EventCreateDraftDebounceMs = 300;

@Component({
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatDialogModule,
    MatTooltipModule,
    EventDetailViewComponent,
    EventImageUploaderComponent,
    BackButtonComponent
  ],
  template: `
    <gones-back-button data-cy="organizer-event-create-back-top" [label]="i18n.t('nav.backToPrevious')" position="top" />

    <section class="organizer-tournament-create stack" [attr.data-cy]="editMode ? 'organizer-event-edit' : 'organizer-event-create'" aria-labelledby="organizer-event-title">
      <header class="page-heading" data-cy="event-create-header">
        <div data-cy="event-create-heading-group"><h1 id="organizer-event-title" data-cy="event-create-title">{{ editMode ? i18n.t('eventManage.editTitle') : i18n.t('eventCreate.title') }}</h1></div>
        @if (editMode) {
          <a mat-stroked-button routerLink="/organizer/events" data-cy="event-create-back-to-list">{{ i18n.t('eventManage.backToList') }}</a>
        }
      </header>

      @if (loadingReferences()) { <p role="status" data-cy="event-loading-references">{{ i18n.t('eventCreate.loadingReferences') }}</p> }
      @if (referenceError()) {
        <div class="error stack" role="alert" data-cy="event-reference-error"><span data-cy="event-reference-error-message">{{ referenceError() }}</span><button mat-stroked-button type="button" data-cy="event-reference-retry" (click)="loadReferences()">{{ i18n.t('common.retry') }}</button></div>
      }

      @if (proposalSentCount(); as count) {
        <section class="panel" role="status" data-cy="event-proposal-sent">
          <h2 data-cy="event-proposal-sent-title">{{ i18n.t('proposal.sentTitle') }}</h2>
          <p data-cy="event-proposal-sent-body">{{ i18n.t('proposal.sentBody', { count }) }}</p>
          <a mat-stroked-button routerLink="/events" data-cy="event-proposal-sent-back">{{ i18n.t('nav.returnToMenu') }}</a>
        </section>
      } @else if (draftAccountMismatch()) {
        <p class="error" role="alert" data-cy="event-draft-account-mismatch">{{ i18n.t('eventCreate.accountChanged') }}</p>
      } @else {
        <div class="event-editor-shell" data-cy="event-editor-shell" [class.event-editor-shell--collapsed]="previewCollapsed() || editMode">
          <form class="panel tournament-create-form" data-cy="event-create-form" [formGroup]="form" (ngSubmit)="editMode ? saveEdit() : publish()" novalidate [attr.aria-busy]="formPending()">
            <p class="muted tournament-create-help" data-cy="event-create-zone-note">{{ i18n.t('eventCreate.zoneHelp') }}</p>
            <fieldset class="tournament-form-lock" data-cy="event-fieldset" [disabled]="formPending()">
              <div class="event-form-rows" data-cy="event-create-grid">
                <div class="event-form-row event-form-row--title" data-cy="event-row-title">
                  <div class="tournament-create-field event-field--organization" data-cy="event-field-organization">
                    <label for="event-organization" data-cy="event-label-organization">{{ i18n.t('eventCreate.organization') }}</label>
                    <select id="event-organization" data-cy="event-organization" formControlName="organizationId" [attr.aria-invalid]="fieldError('organizationId') ? 'true' : null" [attr.aria-describedby]="fieldError('organizationId') ? 'event-organization-error' : null">
                      @for (organization of organizations(); track organization.id) { <option [value]="organization.id" [attr.data-cy]="'event-organization-option-' + organization.id">{{ organization.name }}</option> }
                    </select>
                    @if (fieldError('organizationId'); as message) { <p id="event-organization-error" class="field-error" data-cy="event-organization-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field event-field--title" data-cy="event-field-title">
                    <label for="event-title-input" data-cy="event-label-title">{{ i18n.t('eventCreate.name') }}</label>
                    <input #titleInput id="event-title-input" data-cy="event-title" formControlName="title" autocomplete="off" maxlength="160" [attr.aria-invalid]="fieldError('title') ? 'true' : null" [attr.aria-describedby]="fieldError('title') ? 'event-title-error' : null" />
                    @if (fieldError('title'); as message) { <p id="event-title-error" class="field-error" data-cy="event-title-error">{{ message }}</p> }
                  </div>
                </div>

                <div class="event-form-row event-form-row--full" data-cy="event-row-summary">
                  <div class="tournament-create-field" data-cy="event-field-summary">
                    <label for="event-summary" data-cy="event-label-summary">{{ i18n.t('eventCreate.summary') }}</label>
                    <input id="event-summary" data-cy="event-summary" formControlName="summary" maxlength="50" [attr.aria-invalid]="fieldError('summary') ? 'true' : null" [attr.aria-describedby]="fieldError('summary') ? 'event-summary-error' : null" />
                    @if (fieldError('summary'); as message) { <p id="event-summary-error" class="field-error" data-cy="event-summary-error">{{ message }}</p> }
                  </div>
                </div>

                <div class="event-form-row" data-cy="event-row-classification">
                  <div class="tournament-create-field" data-cy="event-field-format">
                    <label for="event-format" data-cy="event-label-format">{{ i18n.t('eventCreate.format') }}</label>
                    <select id="event-format" data-cy="event-format" formControlName="formatId" [attr.aria-invalid]="fieldError('formatId') ? 'true' : null" [attr.aria-describedby]="fieldError('formatId') ? 'event-format-error event-format-help' : 'event-format-help'">
                      @for (format of formats(); track format.id) { <option [value]="format.id" [attr.data-cy]="'event-format-option-' + format.id">{{ format.name }}</option> }
                    </select>
                    <p id="event-format-help" class="muted" data-cy="event-format-help">{{ i18n.t('eventCreate.formatHelp') }}</p>
                    @if (fieldError('formatId'); as message) { <p id="event-format-error" class="field-error" data-cy="event-format-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-type">
                    <label for="event-type" data-cy="event-label-type">{{ i18n.t('event.eventType') }}</label>
                    <select id="event-type" data-cy="event-type" formControlName="eventType" [attr.aria-invalid]="fieldError('eventType') ? 'true' : null" [attr.aria-describedby]="fieldError('eventType') ? 'event-type-error' : null"><option value="" disabled data-cy="event-type-empty">{{ i18n.t('eventCreate.selectEventType') }}</option><option value="weekly" data-cy="event-type-weekly">{{ i18n.t('event.type.weekly') }}</option><option value="monthly" data-cy="event-type-monthly">{{ i18n.t('event.type.monthly') }}</option><option value="major" data-cy="event-type-major">{{ i18n.t('event.type.major') }}</option></select>
                    @if (fieldError('eventType'); as message) { <p id="event-type-error" class="field-error" data-cy="event-type-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-capacity">
                    <label for="event-capacity" data-cy="event-label-capacity">{{ i18n.t('event.capacity') }}</label>
                    <input id="event-capacity" data-cy="event-capacity" type="number" min="1" step="1" formControlName="capacity" [attr.aria-invalid]="fieldError('capacity') ? 'true' : null" [attr.aria-describedby]="fieldError('capacity') ? 'event-capacity-error' : null" />
                    @if (fieldError('capacity'); as message) { <p id="event-capacity-error" class="field-error" data-cy="event-capacity-error">{{ message }}</p> }
                  </div>
                </div>

                <div class="event-form-row event-form-row--location" data-cy="event-row-location">
                  <div class="tournament-create-field" data-cy="event-field-country">
                    <label for="event-country" data-cy="event-label-country">{{ i18n.t('eventCreate.country') }}</label>
                    <select id="event-country" data-cy="event-country" formControlName="country" autocomplete="country-name" [attr.aria-invalid]="fieldError('country') ? 'true' : null" [attr.aria-describedby]="fieldError('country') ? 'event-country-error' : null">
                      <option value="" disabled data-cy="event-country-empty">{{ i18n.t('eventCreate.selectCountry') }}</option>
                      @for (country of countries(); track country.name) { <option [value]="country.name" [attr.data-cy]="'event-country-option-' + (country.code || 'current')">{{ country.name }}</option> }
                    </select>
                    @if (fieldError('country'); as message) { <p id="event-country-error" class="field-error" data-cy="event-country-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-region">
                    <label for="event-region" data-cy="event-label-region">{{ i18n.t('profile.locationRegion') }}</label>
                    <input id="event-region" data-cy="event-region" formControlName="region" autocomplete="address-level1" [attr.aria-invalid]="fieldError('region') ? 'true' : null" [attr.aria-describedby]="fieldError('region') ? 'event-region-error' : null" />
                    @if (fieldError('region'); as message) { <p id="event-region-error" class="field-error" data-cy="event-region-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-time-zone">
                    <label for="event-time-zone" data-cy="event-label-time-zone">{{ i18n.t('eventCreate.zone') }}</label>
                    <select id="event-time-zone" data-cy="event-time-zone" formControlName="timeZoneId" [attr.aria-invalid]="fieldError('timeZoneId') ? 'true' : null" [attr.aria-describedby]="fieldError('timeZoneId') ? 'event-time-zone-error' : null">
                      <option value="" disabled data-cy="event-time-zone-empty">{{ i18n.t('eventCreate.selectTimeZone') }}</option>
                      @for (timeZone of timeZones(); track timeZone) { <option [value]="timeZone" [attr.data-cy]="'event-time-zone-option-' + $index">{{ timeZone }}</option> }
                    </select>
                    @if (fieldError('timeZoneId'); as message) { <p id="event-time-zone-error" class="field-error" data-cy="event-time-zone-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-street">
                    <label for="event-street" data-cy="event-label-street">{{ i18n.t('eventCreate.street') }}</label>
                    <input #streetInput id="event-street" data-cy="event-street" formControlName="streetAddress" autocomplete="street-address" [attr.aria-invalid]="fieldError('streetAddress') ? 'true' : null" [attr.aria-describedby]="fieldError('streetAddress') ? 'event-street-error' : null" />
                    @if (fieldError('streetAddress'); as message) { <p id="event-street-error" class="field-error" data-cy="event-street-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-postal-code">
                    <label for="event-postal-code" data-cy="event-label-postal-code">{{ i18n.t('eventCreate.postalCode') }}</label>
                    <input id="event-postal-code" data-cy="event-postal-code" formControlName="postalCode" autocomplete="postal-code" [attr.aria-invalid]="fieldError('postalCode') ? 'true' : null" [attr.aria-describedby]="fieldError('postalCode') ? 'event-postal-code-error' : null" />
                    @if (fieldError('postalCode'); as message) { <p id="event-postal-code-error" class="field-error" data-cy="event-postal-code-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-city">
                    <label for="event-city" data-cy="event-label-city">{{ i18n.t('event.city') }}</label>
                    <input id="event-city" data-cy="event-city" formControlName="city" autocomplete="address-level2" [attr.aria-invalid]="fieldError('city') ? 'true' : null" [attr.aria-describedby]="fieldError('city') ? 'event-city-error' : null" />
                    @if (fieldError('city'); as message) { <p id="event-city-error" class="field-error" data-cy="event-city-error">{{ message }}</p> }
                  </div>
                </div>

                <div class="event-form-row" data-cy="event-row-start">
                  <div class="tournament-create-field" data-cy="event-field-start-date">
                    <label for="event-start-date" data-cy="event-label-start-date">{{ i18n.t('eventCreate.startDate') }}</label>
                    <input id="event-start-date" data-cy="event-start-date" type="date" formControlName="startDate" [attr.aria-invalid]="fieldError('startDate') ? 'true' : null" [attr.aria-describedby]="fieldError('startDate') ? 'event-start-date-error' : null" />
                    @if (fieldError('startDate'); as message) { <p id="event-start-date-error" class="field-error" data-cy="event-start-date-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-start-time">
                    <label for="event-start-time" data-cy="event-label-start-time">{{ i18n.t('eventCreate.startTime') }}</label>
                    <input id="event-start-time" data-cy="event-start-time" type="time" formControlName="startTime" [attr.aria-invalid]="fieldError('startTime') ? 'true' : null" [attr.aria-describedby]="fieldError('startTime') ? 'event-start-time-error' : null" />
                    @if (fieldError('startTime'); as message) { <p id="event-start-time-error" class="field-error" data-cy="event-start-time-error">{{ message }}</p> }
                  </div>
                </div>

                <div class="event-form-row event-form-row--full" data-cy="event-row-description">
                  <div class="tournament-create-field" data-cy="event-field-body">
                    <label for="event-body" data-cy="event-label-body">{{ i18n.t('eventCreate.body') }}</label>
                    <textarea id="event-body" data-cy="event-body" formControlName="bodyMarkdown" rows="7" maxlength="20000" [attr.aria-invalid]="fieldError('bodyMarkdown') ? 'true' : null" [attr.aria-describedby]="fieldError('bodyMarkdown') ? 'event-body-error event-body-help' : 'event-body-help'"></textarea>
                    <p id="event-body-help" class="muted" data-cy="event-body-help">{{ i18n.t('eventCreate.bodyHelp') }}</p>
                    @if (fieldError('bodyMarkdown'); as message) { <p id="event-body-error" class="field-error" data-cy="event-body-error">{{ message }}</p> }
                  </div>
                </div>

                <div class="event-form-row event-form-row--full" data-cy="event-row-images"><gones-event-image-uploader data-cy="event-image-editor" [initialImage]="initialEditorImage()" [blockedMessageKey]="canPublishDirectly() ? 'eventImages.publishBlocked' : 'eventImages.proposalBlocked'" [attr.aria-describedby]="fieldError('imageId') ? 'event-images-error' : null" (imageChange)="onImageChange($event)" (imageInteractionChange)="onImageInteractionChange($event)" (temporaryImageChange)="onTemporaryImageChange($event)" (publishBlockedChange)="imagePublishBlocked.set($event)" />@if (fieldError('imageId'); as message) { <p id="event-images-error" class="field-error" data-cy="event-images-error">{{ message }}</p> }</div>
              </div>
            </fieldset>

            @if (staleEvent(); as latest) {
              <div class="warning stack" role="alert" data-cy="event-stale"><strong data-cy="event-stale-title">{{ i18n.t('eventManage.staleTitle') }}</strong><p data-cy="event-stale-body">{{ i18n.t('eventManage.staleBody', { title: latest.title }) }}</p>@if (staleChanges().length) { <ul data-cy="event-stale-changes">@for (change of staleChanges(); track change) { <li [attr.data-cy]="'event-stale-change-' + $index">{{ change }}</li> }</ul> }<p data-cy="event-stale-preserved">{{ i18n.t('eventManage.draftPreserved') }}</p><button mat-stroked-button type="button" data-cy="event-reload-latest" (click)="reloadLatest()">{{ i18n.t('eventManage.reloadLatest') }}</button></div>
            }
            @if (success()) { <p role="status" class="success" data-cy="event-edit-success">{{ success() }}</p> }
            @if (fieldErrors()['general']; as message) { <p class="field-error" role="alert" data-cy="event-general-error">{{ message }}</p> }
            @if (submitError(); as error) {
              <div class="error tournament-create-recovery" role="alert" data-cy="event-submit-error"><span data-cy="event-submit-error-message">{{ error.message }}</span>@if (error.action === 'reload') { <button mat-stroked-button type="button" data-cy="reload-organizations" (click)="loadReferences()">{{ i18n.t('eventCreate.reloadOrganizations') }}</button> }@if (error.action === 'login') { <a mat-stroked-button [routerLink]="['/login']" [queryParams]="{ returnUrl: '/events/new' }" target="_blank" rel="noopener noreferrer" data-cy="event-submit-error-login">{{ i18n.t('eventCreate.signInAgain') }}</a> }@if (error.action === 'review-calendar') { <a mat-stroked-button routerLink="/events" data-cy="event-review-calendar">{{ i18n.t('eventCreate.reviewCalendar') }}</a> }@if (error.action === 'retry') { <button mat-stroked-button type="submit" data-cy="event-submit-error-retry">{{ i18n.t('common.retry') }}</button> }</div>
            }
            <div class="actions event-create-actions" data-cy="event-create-actions">
              @if (canPublishDirectly()) {
                @if (editMode) {
                  <button #saveButton mat-flat-button class="home-primary-action" type="submit" data-cy="event-save" [disabled]="formPending() || imagePublishBlocked()">{{ saving() ? i18n.t('eventManage.saving') : i18n.t('common.save') }}</button>
                } @else {
                  <span class="event-publish-tooltip" data-cy="event-publish-tooltip" [matTooltip]="publishTooltip()" [matTooltipDisabled]="!publishDisabled()" matTooltipClass="event-publish-tooltip-panel" [attr.tabindex]="publishDisabled() ? 0 : null" [attr.aria-describedby]="publishReasons().length ? 'event-publish-errors' : null">
                    <button mat-flat-button class="home-primary-action create-action-button event-publish-button" type="submit" data-cy="event-publish" [disabled]="publishDisabled()">{{ publishing() ? i18n.t('eventCreate.publishing') : i18n.t('eventCreate.publish') }}</button>
                  </span>
                  @if (publishReasons().length) { <p id="event-publish-errors" class="sr-only event-publish-errors" data-cy="event-publish-errors">{{ publishTooltip() }}</p> }
                }
              } @else {
                <p class="warning" role="status" data-cy="event-approval-notice">{{ i18n.t('eventCreate.approvalNotice') }}</p>
                <button mat-flat-button class="home-primary-action" type="button" data-cy="event-submit-for-approval" [disabled]="proposalPending() || loadingReferences() || !organizationSelected() || imagePublishBlocked()" (click)="submitForApproval()">{{ i18n.t('eventCreate.submitForApproval') }}</button>
                @if (proposalError()) { <p class="error" role="alert" data-cy="event-proposal-error">{{ proposalError() }}</p> }
              }
            </div>
          </form>

          @if (!editMode) {
            <aside class="event-live-preview" aria-labelledby="event-live-preview-title" data-cy="event-live-preview">
              <header class="event-live-preview__header" data-cy="event-live-preview-header">
                <h2 id="event-live-preview-title" class="event-live-preview__title" data-cy="event-live-preview-title">{{ i18n.t('eventCreate.livePreview') }}</h2>
                <button mat-stroked-button type="button" data-cy="event-preview-collapse" aria-controls="event-live-preview" [attr.aria-expanded]="!previewCollapsed()" (click)="togglePreview()">{{ previewCollapsed() ? i18n.t('eventCreate.showPreview') : i18n.t('eventCreate.hidePreview') }}</button>
              </header>
              <div id="event-live-preview" class="event-live-preview__scroll" data-cy="event-live-preview-scroll" [hidden]="previewCollapsed()"><gones-event-detail-view [event]="draftPreview()" [draftPlaceholderMode]="true" [showIcsAction]="false" data-cy="event-live-preview-detail" /></div>
            </aside>
          }
        </div>

        @if (editMode && currentRender(); as rendered) {
          <section class="stack" aria-labelledby="current-event-title" data-cy="event-current-details"><h2 id="current-event-title" data-cy="event-current-details-title">{{ i18n.t('eventManage.currentPublicDetails') }}</h2><gones-event-detail-view [event]="rendered" data-cy="event-current-detail-view" /></section>
        }
      }
    </section>

    <gones-back-button data-cy="organizer-event-create-back-bottom" [label]="i18n.t('nav.backToPrevious')" position="bottom" />
  `
})
export class OrganizerEventCreateComponent implements OnInit, AfterViewInit {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly power = inject(PowerUserSettingsService);
  private readonly proposals = inject(EventProposalService);
  private readonly geo = inject(GeoService);
  private readonly draftStore = inject(EventCreateDraftStore);
  private readonly state = new DirectPublicationState();
  private readonly eventId = this.route.snapshot.paramMap.get('id');
  readonly editMode = Boolean(this.eventId);
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('streetInput') private streetInput?: ElementRef<HTMLInputElement>;
  @ViewChild('saveButton', { read: ElementRef }) private saveButton?: ElementRef<HTMLButtonElement>;
  @ViewChild(EventImageUploaderComponent) private imageUploader?: EventImageUploaderComponent;

  readonly organizations = signal<EventOrganizationOption[]>([]);
  readonly formats = signal<PublicFormatResponse[]>([]);
  readonly countries = signal<GeoOption[]>([]);
  readonly timeZones = signal<string[]>([]);
  readonly loadingReferences = signal(true);
  readonly referenceError = signal('');
  readonly publishing = signal(false);
  readonly saving = signal(false);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly submitError = signal<RecoveryError | null>(null);
  readonly baseEvent = signal<EventManagementResponse | null>(null);
  readonly staleEvent = signal<EventManagementResponse | null>(null);
  readonly staleChanges = signal<string[]>([]);
  readonly currentRender = signal<EventDetailView | null>(null);
  readonly initialEditorImage = computed(() => this.baseEvent()?.image);
  readonly success = signal('');
  readonly canMutateEvent = computed(() => {
    const profile = this.auth.profile();
    return profile?.emailVerified === true
      && canManageArchive(profile.globalRole)
      && ((!this.editMode && profile.globalRole === 'Admin') || this.power.enabled());
  });
  readonly canPublishDirectly = this.canMutateEvent;
  private readonly isAdmin = computed(() => this.auth.profile()?.globalRole === 'Admin');
  readonly proposalPending = signal(false);
  readonly proposalSentCount = signal<number | null>(null);
  readonly proposalError = signal('');
  readonly selectedOrganizationId = signal('');
  readonly imagePublishBlocked = signal(false);
  readonly selectedImage = signal<EventImageSelection | null>(null);
  private readonly imageInteraction = signal<string | null>(null);
  private readonly draftImage = signal<EventImageUploadResponse | null>(null);
  private readonly baseline = signal<EventDirtyShape | null>(null);
  private readonly previewRevision = signal(0);
  private draftWriteTimer?: ReturnType<typeof setTimeout>;
  private defaultOrganizationId = '';
  private readonly draftUserId = signal('');
  private readonly draftContextInitialized = signal(false);
  private editorInitialized = false;
  private createReferencesInitialized = false;
  private createCompleted = false;
  private viewReady = false;
  private pendingRestoredDraft?: RestoredEventCreateDraft;
  private pendingRestoredImage?: EventImageUploadResponse;
  readonly previewCollapsed = signal(readPreviewCollapsed());
  readonly formPending = computed(() => this.publishing() || this.saving());
  readonly organizationSelected = computed(() =>
    this.organizations().some(option => option.id === this.selectedOrganizationId()));
  readonly draftAccountMismatch = computed(() => {
    const draftUserId = this.draftUserId();
    return !this.editMode && this.draftContextInitialized() && this.auth.profile()?.id !== draftUserId;
  });
  readonly dirty = computed(() => {
    this.previewRevision();
    if (this.draftAccountMismatch()) return false;
    const baseline = this.baseline();
    return baseline ? eventDraftIsDirty(baseline, this.dirtyShape()) : false;
  });

  readonly form = new FormGroup({
    organizationId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(160)]
    }),
    summary: new FormControl('', { nonNullable: true, validators: Validators.maxLength(50) }),
    bodyMarkdown: new FormControl('', { nonNullable: true, validators: Validators.maxLength(20000) }),
    streetAddress: new FormControl('', { nonNullable: true, validators: Validators.required }),
    postalCode: new FormControl('', { nonNullable: true, validators: Validators.required }),
    city: new FormControl('', { nonNullable: true, validators: Validators.required }),
    country: new FormControl('', { nonNullable: true, validators: Validators.required }),
    region: new FormControl('', { nonNullable: true, validators: Validators.required }),
    eventType: new FormControl<'' | 'weekly' | 'monthly' | 'major'>('weekly', { nonNullable: true, validators: Validators.required }),
    timeZoneId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    startDate: new FormControl('', { nonNullable: true, validators: Validators.required }),
    startTime: new FormControl('', { nonNullable: true, validators: Validators.required }),
    capacity: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]),
    formatId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    imageId: new FormControl<string | null>(null)
  });

  readonly publishErrors = computed<readonly string[]>(() => {
    this.previewRevision();
    const fields: readonly [keyof typeof this.form.controls, string][] = [
      ['organizationId', this.i18n.t('eventCreate.organization')],
      ['title', this.i18n.t('eventCreate.name')],
      ['summary', this.i18n.t('eventCreate.publishErrorSummary')],
      ['bodyMarkdown', this.i18n.t('eventCreate.publishErrorDescription')],
      ['formatId', this.i18n.t('eventCreate.format')],
      ['eventType', this.i18n.t('event.eventType')],
      ['capacity', this.i18n.t('event.capacity')],
      ['country', this.i18n.t('eventCreate.country')],
      ['region', this.i18n.t('profile.locationRegion')],
      ['streetAddress', this.i18n.t('eventCreate.street')],
      ['postalCode', this.i18n.t('eventCreate.postalCode')],
      ['city', this.i18n.t('event.city')],
      ['startDate', this.i18n.t('eventCreate.startDate')],
      ['startTime', this.i18n.t('eventCreate.startTime')]
    ];
    const errors: string[] = [];
    const seenErrors = new Set<string>();
    const addError = (label: string, message: string) => {
      const labelled = `${label}: ${message}`;
      if (!message || seenErrors.has(labelled)) return;
      seenErrors.add(labelled);
      errors.push(labelled);
    };
    for (const [name, label] of fields) addError(label, this.controlError(name, false));
    addError(
      this.i18n.t('eventCreate.zone'),
      this.controlError('timeZoneId', false));
    addError(
      this.i18n.t('eventCreate.publishErrorImage'),
      this.controlError('imageId', false)
        || (this.imagePublishBlocked() ? this.i18n.t('eventImages.publishBlocked') : ''));
    addError(this.i18n.t('eventCreate.publishErrorGeneral'), this.fieldErrors()['general'] || '');
    return errors;
  });
  readonly publishReasons = computed<readonly string[]>(() => {
    const reasons = [...this.publishErrors()];
    const general = this.i18n.t('eventCreate.publishErrorGeneral');
    if (this.formPending()) reasons.push(`${general}: ${this.i18n.t('eventCreate.publishing')}`);
    if (this.loadingReferences()) reasons.push(`${general}: ${this.i18n.t('eventCreate.loadingReferences')}`);
    if (!this.loadingReferences() && !this.organizations().length) reasons.push(`${general}: ${this.i18n.t('eventCreate.noOrganizations')}`);
    return [...new Set(reasons)];
  });
  readonly publishTooltip = computed(() => this.publishReasons().join('\n'));

  readonly publishDisabled = computed(() => {
    this.previewRevision();
    return this.publishErrors().length > 0
      || this.formPending()
      || this.loadingReferences()
      || !this.organizations().length;
  });

  readonly draftPreview = computed<EventDetailView>(() => {
    this.previewRevision();
    const value = this.form.getRawValue();
    const organization = this.organizations().find(item => item.id === value.organizationId);
    const format = this.formats().find(item => item.id === value.formatId);
    const title = value.title.trim();
    const date = value.startDate;
    const time = value.startTime;
    return {
      id: '',
      title,
      displayTitle: title && format ? `${format.name} — ${title}` : title,
      slug: '',
      summary: value.summary.trim() || undefined,
      bodyHtml: renderEventMarkdown(value.bodyMarkdown),
      liveTournamentUrl: undefined,
      archiveTournamentUrl: undefined,
      venue: {
        streetAddress: value.streetAddress.trim(),
        postalCode: value.postalCode.trim(),
        city: value.city.trim(),
        country: value.country.trim(),
        region: value.region.trim()
      },
      timeZoneId: value.timeZoneId || 'UTC',
      venueStartDate: date,
      venueStartTime: time ? `${time}:00` : '',
      venueEndDate: date,
      venueEndTime: '23:59:59',
      startsAtUtc: date && time ? `${date}T${time}:00Z` : '',
      endsAtUtc: date ? `${date}T23:59:59Z` : '',
      capacity: value.capacity,
      status: 'Published',
      eventType: (value.eventType || undefined) as EventDetailView['eventType'],
      organization: { id: value.organizationId, name: organization?.name ?? '', description: undefined, website: undefined, contactEmail: undefined, organizers: [] },
      formats: format ? [format] : [],
      image: this.selectedImage() ? {
        id: this.selectedImage()!.imageId,
        variants: this.selectedImage()!.response.variants.map(variant => ({ ...variant, url: this.selectedImage()!.previewUrl }))
      } : undefined
    };
  });

  ngOnInit(): void {
    this.initializeCreateDraftContext();
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncSelectedOrganization();
      this.fieldErrors.set({});
      this.submitError.set(null);
      this.success.set('');
      this.state.reset();
      this.previewRevision.update(value => value + 1);
      this.queueDraftWrite();
    });
    this.destroyRef.onDestroy(() => {
      if (!this.editMode && !this.createCompleted) this.flushDraft();
      if (this.draftWriteTimer) clearTimeout(this.draftWriteTimer);
    });
    void this.loadReferences();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.hydrateRestoredImage();
    queueMicrotask(() => this.titleInput?.nativeElement.focus());
  }

  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (!this.editMode && !this.createCompleted) this.flushDraft();
    if (!this.dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  confirmLeave(): boolean | Observable<boolean> {
    if (!this.dirty()) return true;
    return this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.i18n.t('eventCreate.leaveTitle'),
        message: this.i18n.t('eventCreate.leaveBody'),
        confirmLabel: this.i18n.t('eventCreate.leave')
      }
    }).afterClosed().pipe(map(result => result === true));
  }

  togglePreview(): void {
    this.previewCollapsed.update(value => !value);
    sessionStorage.setItem(PreviewCollapsedKey, String(this.previewCollapsed()));
  }

  onImageChange(image: EventImageSelection | null): void {
    if (this.draftAccountMismatch()) return;
    this.selectedImage.set(image);
    const next = image?.imageId ?? null;
    if (this.form.controls.imageId.value === next) {
      this.queueDraftWrite();
      return;
    }
    this.form.controls.imageId.setValue(next);
  }

  onImageInteractionChange(interaction: string | null): void {
    if (this.draftAccountMismatch()) return;
    this.imageInteraction.set(interaction);
    this.previewRevision.update(value => value + 1);
    this.queueDraftWrite();
  }

  onTemporaryImageChange(image: EventImageUploadResponse | null): void {
    if (this.draftAccountMismatch()) return;
    if (!this.editMode) this.draftImage.set(image);
    this.queueDraftWrite();
  }

  async loadReferences(): Promise<void> {
    this.initializeCreateDraftContext();
    this.loadingReferences.set(true);
    this.referenceError.set('');
    this.submitError.set(null);
    try {
      const [formats, countries, timeZoneCatalog] = await Promise.all([
        firstValueFrom(this.client.formatsAll()),
        this.geo.countries(),
        firstValueFrom(this.client.listEventTimeZones())
      ]);
      this.formats.set(formats);
      this.countries.set(countries);
      this.timeZones.set(timeZoneCatalog.ids);
      if (this.editMode) {
        const event = await this.findEvent(this.eventId!);
        this.organizations.set([{ id: event.organizationId, name: event.organizationName }]);
        this.form.controls.organizationId.disable({ emitEvent: false });
        this.applyCanonical(event);
      } else {
        const organizations = await this.loadOrganizationOptions();
        this.organizations.set(organizations);
        if (!organizations.length) this.referenceError.set(this.i18n.t('eventCreate.noOrganizations'));
        this.initializeCreateState();
      }
      this.syncSelectedOrganization();
      this.previewRevision.update(value => value + 1);
    } catch (error) {
      logBoundaryError('event-editor.load-references', error, { editMode: this.editMode });
      this.organizations.set([]);
      this.formats.set([]);
      this.countries.set([]);
      this.timeZones.set([]);
      this.syncSelectedOrganization();
      this.referenceError.set(this.i18n.t('eventCreate.referencesFailed'));
    } finally {
      this.loadingReferences.set(false);
    }
  }

  private syncSelectedOrganization(): void {
    this.selectedOrganizationId.set(this.form.getRawValue().organizationId);
  }

  private async loadOrganizationOptions(): Promise<EventOrganizationOption[]> {
    if (this.isAdmin()) {
      try {
        return await this.loadAdminOrganizations();
      } catch {
        // Fall through to membership list.
      }
    }
    if (this.canPublishDirectly()) {
      return (await firstValueFrom(this.client.organizationsAll())).map(item => ({ id: item.id, name: item.name }));
    }
    return this.loadPublicOrganizations();
  }

  private async loadAdminOrganizations(): Promise<EventOrganizationOption[]> {
    const options: EventOrganizationOption[] = [];
    let read = 0;
    for (let page = 1; page <= MaximumPublicOrganizationPages; page++) {
      const response = await firstValueFrom(this.client.organizationsGET3(undefined, false, page, PublicOrganizationPageSize));
      const items = response.items ?? [];
      read += items.length;
      options.push(...items
        .filter(item => item.isDraft !== true && item.deletedAt == null)
        .map(item => ({ id: item.id, name: item.name })));
      if (!items.length || read >= response.totalCount) break;
    }
    return options.sort((left, right) => left.name.localeCompare(right.name));
  }

  private async loadPublicOrganizations(): Promise<EventOrganizationOption[]> {
    const options: EventOrganizationOption[] = [];
    for (let page = 1; page <= MaximumPublicOrganizationPages; page++) {
      const response = await firstValueFrom(this.client.organizationsGET(undefined, page, PublicOrganizationPageSize));
      options.push(...response.items.map(item => ({ id: item.id, name: item.name })));
      if (!response.items.length || options.length >= response.totalCount) break;
    }
    return options;
  }

  async submitForApproval(): Promise<void> {
    if (this.draftAccountMismatch()) return;
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    if (this.form.invalid || this.proposalPending() || this.imagePublishBlocked()) return;
    const organizationId = this.form.getRawValue().organizationId;
    let approvers;
    try {
      approvers = sortApprovers(await this.proposals.listApprovers(organizationId));
    } catch {
      this.proposalError.set(this.i18n.t('proposal.loadApproversFailed'));
      return;
    }
    if (!approvers.length) {
      this.proposalError.set(this.i18n.t('proposal.noApprovers'));
      return;
    }
    const recipientUserIds = await firstValueFrom(this.dialog.open(ApproverSelectionDialogComponent, {
      data: { approvers }
    }).afterClosed());
    if (!recipientUserIds?.length) return;
    this.proposalPending.set(true);
    this.proposalError.set('');
    try {
      const draft = this.form.getRawValue();
      const response = await this.proposals.submit(eventPayload(draft), recipientUserIds);
      this.completeCreate();
      this.proposalSentCount.set(response.recipientCount);
    } catch (error) {
      this.applyFieldErrors(error);
      this.proposalError.set(this.i18n.t('proposal.submitFailed'));
    } finally {
      this.proposalPending.set(false);
    }
  }

  async publish(): Promise<void> {
    if (!this.canMutateEvent() || this.draftAccountMismatch()) return;
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    this.submitError.set(null);
    if (this.publishDisabled()) return;
    this.publishing.set(true);
    const key = this.state.idempotencyKey(() => globalThis.crypto.randomUUID());
    try {
      const response = await firstValueFrom(this.client.eventsPOST(key, eventPayload(this.form.getRawValue())));
      this.completeCreate();
      await this.router.navigate(['/events', response.slug]);
    } catch (error) {
      this.applyFieldErrors(error);
      this.submitError.set(this.recovery(error));
    } finally {
      this.publishing.set(false);
    }
  }

  async saveEdit(): Promise<void> {
    if (!this.canMutateEvent()) return;
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    this.submitError.set(null);
    this.success.set('');
    const base = this.baseEvent();
    if (!this.eventId || !base || this.form.invalid || this.saving() || this.imagePublishBlocked()) return;
    const draft = this.form.getRawValue();
    const major = majorEventChanges(base, draft, field => this.i18n.t(`eventManage.major.${field}`));
    if (major.length) {
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: this.i18n.t('eventManage.majorTitle'),
          message: this.i18n.t('eventManage.majorBody') + '\n\n' + major.map(change => `• ${change}`).join('\n'),
          confirmLabel: this.i18n.t('eventManage.saveChanges')
        }
      }).afterClosed());
      if (!confirmed) return;
    }

    this.saving.set(true);
    try {
      const response = await firstValueFrom(this.client.updateEventDetails(
        this.eventId,
        base.eTag,
        eventUpdatePayload(draft)
      ));
      this.applyCanonical(response);
      this.staleEvent.set(null);
      this.staleChanges.set([]);
      this.success.set(this.i18n.t('eventManage.saved'));
      setTimeout(() => this.saveButton?.nativeElement.focus());
    } catch (error) {
      this.applyFieldErrors(error);
      if (error instanceof ApiProblemError && error.problem.code === 'image_state_conflict') {
        this.fieldErrors.update(errors => ({ ...errors, imageId: this.i18n.t('eventManage.imageConflict') }));
      }
      if (error instanceof ApiProblemError && error.status === 404 && error.problem.code === 'image_not_found') {
        this.fieldErrors.update(errors => ({ ...errors, imageId: this.i18n.t('eventManage.imageMissing') }));
        await this.loadStaleEvent(base);
      } else if (error instanceof ApiProblemError && error.status === 412) {
        await this.loadStaleEvent(base);
      } else {
        this.submitError.set({ message: this.managementError(error), action: 'retry' });
      }
    } finally {
      this.saving.set(false);
    }
  }

  reloadLatest(): void {
    const latest = this.staleEvent();
    if (!latest) return;
    this.applyCanonical(latest);
    this.staleEvent.set(null);
    this.staleChanges.set([]);
    this.fieldErrors.update(errors => {
      if (!errors['imageId']) return errors;
      const current = { ...errors };
      delete current['imageId'];
      return current;
    });
    this.submitError.set(null);
    this.success.set(this.i18n.t('eventManage.reloaded'));
    queueMicrotask(() => this.streetInput?.nativeElement.focus());
  }

  fieldError(name: keyof typeof this.form.controls): string {
    return this.controlError(name, true);
  }

  private controlError(name: keyof typeof this.form.controls, touchedOnly: boolean): string {
    const serverError = this.fieldErrors()[name];
    if (serverError) return serverError;
    const control = this.form.controls[name];
    if ((touchedOnly && !control.touched) || !control.errors) return '';
    if (control.errors['required'] || (name === 'title' && control.errors['pattern'])) {
      return this.i18n.t('eventCreate.required');
    }
    if (control.errors['maxlength']) {
      if (name === 'title') return this.i18n.t('eventCreate.titleTooLong');
      if (name === 'summary') return this.i18n.t('eventCreate.summaryTooLong');
      if (name === 'bodyMarkdown') return this.i18n.t('eventCreate.bodyTooLong');
      return this.i18n.t('eventCreate.tournamentUrlTooLong');
    }
    return this.i18n.t('eventCreate.invalid');
  }

  private async findEvent(id: string): Promise<EventManagementResponse> {
    let page = 1;
    while (true) {
      const response = await firstValueFrom(this.client.listOrganizerEvents(page, 100));
      const found = response.items.find(item => item.id === id);
      if (found) return found;
      if (page * response.pageSize >= response.totalCount) throw new Error('Event not found.');
      page += 1;
    }
  }

  private applyCanonical(event: EventManagementResponse): void {
    this.baseEvent.set(event);
    this.form.patchValue(managementToDraft(event), { emitEvent: false });
    if (!this.countries().some(country => country.name === event.location.country)) {
      this.countries.update(countries => [...countries, { code: '', name: event.location.country }]);
    }
    if (!this.timeZones().includes(event.timeZoneId)) {
      this.timeZones.update(timeZones => [...timeZones, event.timeZoneId]);
    }
    this.currentRender.set(managementToDetail(event, this.formats()));
    this.imageInteraction.set(event.image?.id ?? null);
    this.previewRevision.update(value => value + 1);
    this.baseline.set(this.dirtyShape());
  }

  private initializeCreateDraftContext(): void {
    if (this.editMode || this.editorInitialized) return;
    const userId = this.auth.profile()?.id;
    if (!userId) return;
    this.draftUserId.set(userId);
    this.draftContextInitialized.set(true);
    this.pendingRestoredDraft = this.draftStore.read(userId) ?? undefined;
    this.editorInitialized = true;
    this.baseline.set(this.dirtyShape());
  }

  private initializeCreateState(): void {
    if (this.editMode || !this.editorInitialized || this.createReferencesInitialized || this.draftAccountMismatch()) return;
    this.createReferencesInitialized = true;
    this.defaultOrganizationId = this.organizations()[0]?.id ?? '';
    const initial = this.baseline() ?? this.dirtyShape();
    const current = this.dirtyShape();
    const restored = this.pendingRestoredDraft;
    this.pendingRestoredDraft = undefined;
    const cleanValue = restored?.value ?? { ...initial.value, organizationId: this.defaultOrganizationId };
    const mergedValue = restored
      ? this.mergeDraftValue(restored.value, initial.value, current.value)
      : this.mergeDraftValue(cleanValue, initial.value, current.value);
    const currentImageChanged = current.imageId !== initial.imageId
      || current.imageInteraction !== initial.imageInteraction
      || this.imagePublishBlocked()
      || this.draftImage() !== null;
    const cleanImageId = restored?.image?.id ?? null;
    const mergedImageId = currentImageChanged ? current.imageId : cleanImageId;
    this.form.patchValue({ ...mergedValue, imageId: mergedImageId }, { emitEvent: false });
    if (restored?.value.country && !this.countries().some(country => country.name === restored.value.country)) {
      this.countries.update(countries => [...countries, { code: '', name: restored.value.country }]);
    }
    if (restored?.value.timeZoneId && !this.timeZones().includes(restored.value.timeZoneId)) {
      this.timeZones.update(timeZones => [...timeZones, restored.value.timeZoneId]);
    }
    if (!currentImageChanged) {
      this.draftImage.set(restored?.image ?? null);
      this.imageInteraction.set(cleanImageId);
      this.pendingRestoredImage = restored?.image;
    }
    this.syncSelectedOrganization();
    this.previewRevision.update(value => value + 1);
    this.baseline.set({ value: normalizeEventDraftValue(cleanValue), imageId: cleanImageId, imageInteraction: cleanImageId });
    this.hydrateRestoredImage();
  }

  private mergeDraftValue(base: EventDraftValueV1, initial: EventDraftValueV1, current: EventDraftValueV1): EventDraftValueV1 {
    const merged = { ...base };
    for (const key of Object.keys(initial) as (keyof EventDraftValueV1)[]) {
      if (current[key] !== initial[key]) Object.assign(merged, { [key]: current[key] });
    }
    return normalizeEventDraftValue(merged);
  }

  private hydrateRestoredImage(): void {
    if (!this.viewReady || !this.pendingRestoredImage || !this.imageUploader) return;
    const image = this.pendingRestoredImage;
    this.pendingRestoredImage = undefined;
    this.imageUploader.restoreTemporaryImage(image);
  }

  private queueDraftWrite(): void {
    if (this.editMode || !this.editorInitialized || this.createCompleted || this.draftAccountMismatch()) return;
    if (this.draftWriteTimer) clearTimeout(this.draftWriteTimer);
    this.draftWriteTimer = setTimeout(() => this.flushDraft(), EventCreateDraftDebounceMs);
  }

  private flushDraft(): void {
    if (this.draftWriteTimer) clearTimeout(this.draftWriteTimer);
    this.draftWriteTimer = undefined;
    if (this.editMode || !this.editorInitialized || this.createCompleted || this.draftAccountMismatch()) return;
    const userId = this.draftUserId();
    if (!userId) return;
    const current = this.draftValue();
    const initial = this.baseline()?.value;
    const value = this.pendingRestoredDraft && initial
      ? this.mergeDraftValue(this.pendingRestoredDraft.value, initial, current)
      : current;
    const image = this.draftImage() ?? this.pendingRestoredDraft?.image;
    if (eventCreateDraftIsEmpty(value, this.defaultOrganizationId) && !image) {
      this.draftStore.remove(userId);
      return;
    }
    this.draftStore.write({
      version: EVENT_CREATE_DRAFT_VERSION,
      userId,
      savedAt: new Date().toISOString(),
      value,
      ...(image ? { image } : {})
    });
  }

  private completeCreate(): void {
    if (this.editMode) return;
    if (this.draftWriteTimer) clearTimeout(this.draftWriteTimer);
    this.draftWriteTimer = undefined;
    const userId = this.draftUserId();
    if (userId && !this.draftAccountMismatch()) this.draftStore.remove(userId);
    this.createCompleted = true;
    this.baseline.set(this.dirtyShape());
  }

  private dirtyShape(): EventDirtyShape {
    return {
      value: this.draftValue(),
      imageId: this.form.controls.imageId.value,
      imageInteraction: this.imageInteraction()
    };
  }

  private draftValue(): EventDraftValueV1 {
    const value = this.form.getRawValue();
    return normalizeEventDraftValue({
      organizationId: value.organizationId,
      title: value.title,
      summary: value.summary,
      bodyMarkdown: value.bodyMarkdown,
      streetAddress: value.streetAddress,
      postalCode: value.postalCode,
      city: value.city,
      country: value.country,
      region: value.region,
      timeZoneId: value.timeZoneId,
      eventType: value.eventType,
      startDate: value.startDate,
      startTime: value.startTime,
      capacity: value.capacity,
      formatId: value.formatId
    });
  }

  private async loadStaleEvent(base: EventManagementResponse): Promise<void> {
    try {
      const latest = await this.findEvent(base.id);
      this.staleEvent.set(latest);
      this.staleChanges.set(changedEventFields(base, latest, field => this.i18n.t('eventManage.serverChanged', { field: this.i18n.t(`eventManage.field.${field}`) })));
    } catch {
      this.submitError.set({ message: this.i18n.t('eventManage.latestLoadFailed'), action: 'retry' });
    }
  }

  private managementError(error: unknown): string {
    if (error instanceof ApiProblemError) {
      if (error.status === 401) return this.i18n.t('eventCreate.unauthorized');
      if (error.status === 403 || error.status === 404) return this.i18n.t('eventManage.forbidden');
      if (error.status === 409) return this.i18n.t('eventManage.cutoffRejected');
      if (error.problem.errors) return this.i18n.t('eventCreate.validationFailed');
    }
    return this.i18n.t('eventManage.actionFailed');
  }

  private applyFieldErrors(error: unknown): void {
    if (!(error instanceof ApiProblemError) || !error.problem.errors) return;
    const mapped: Record<string, string> = {};
    const names: Record<string, keyof typeof this.form.controls> = {
      organizationid: 'organizationId', title: 'title', summary: 'summary', bodymarkdown: 'bodyMarkdown',
      locationstreetaddress: 'streetAddress', locationpostalcode: 'postalCode', locationcity: 'city', locationcountry: 'country',
      locationregion: 'region', locationtimezoneid: 'timeZoneId', eventtype: 'eventType', startsatlocal: 'startDate',
      capacity: 'capacity', formatids: 'formatId', imageid: 'imageId'
    };
    for (const [field, messages] of Object.entries(error.problem.errors)) {
      const normalized = field.replace(/[^a-z]/gi, '').toLowerCase();
      const message = messages[0];
      if (!message) continue;
      if (normalized === 'startsatlocal'
        || (normalized === 'payload' && /daylight-saving|start time/i.test(message))) {
        mapped['startDate'] = message;
        mapped['startTime'] = message;
        continue;
      }
      if (normalized === 'payload') {
        mapped['general'] = message;
        continue;
      }
      const name = normalized === 'imageid' ? 'imageId' : names[normalized];
      if (name) mapped[name] = message;
    }
    this.fieldErrors.set(mapped);
  }

  private recovery(error: unknown): RecoveryError {
    if (error instanceof ApiProblemError) {
      if (error.status === 401) return { message: this.i18n.t('eventCreate.unauthorized'), action: 'login' };
      if (error.status === 403 || error.status === 404) return { message: this.i18n.t('eventCreate.forbidden'), action: 'reload' };
      if (error.status === 409) return { message: this.i18n.t('eventCreate.conflict'), action: 'review-calendar' };
      if (error.problem.errors) return { message: this.i18n.t('eventCreate.validationFailed'), action: 'retry' };
    }
    return { message: this.i18n.t('eventCreate.publishNetwork'), action: 'retry' };
  }
}

function readPreviewCollapsed(): boolean {
  return sessionStorage.getItem(PreviewCollapsedKey) === 'true';
}
