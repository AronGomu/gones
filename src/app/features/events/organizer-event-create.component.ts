import { AfterViewInit, Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { catchError, distinctUntilChanged, firstValueFrom, map, merge, of, Subject, switchMap, timer } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, EventImageInput, EventLocationSuggestionResponse, EventManagementResponse, PublicFormatResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService } from '../../auth/auth.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { EventDetailView, EventDetailViewComponent } from './event-detail-view.component';
import { ApproverSelectionDialogComponent } from './approver-selection-dialog.component';
import { DirectPublicationState, eventPayload } from './organizer-event-create';
import { EventProposalService, sortApprovers } from './event-proposal.service';
import { changedEventFields, majorEventChanges, managementToDetail, managementToDraft, eventUpdatePayload } from './event-management';
import { canManageArchive } from '../../data/archive-command-ux';
import { canUsePowerMutation, PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { EventImageSelection, EventImageUploaderComponent } from './event-image-uploader.component';
import { renderEventMarkdown } from './event-markdown';

type RecoveryAction = 'reload' | 'login' | 'review-calendar' | 'retry';
interface RecoveryError { message: string; action: RecoveryAction; }

export interface EventOrganizationOption { id: string; name: string; }

const PublicOrganizationPageSize = 100;
const MaximumPublicOrganizationPages = 20;
const MinimumLocationSearchLength = 3;
const LocationAutocompleteDelayMilliseconds = 300;
const MaximumLocationSuggestions = 5;
const PreviewCollapsedKey = 'gones.event-editor.preview-collapsed';

@Component({
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatDialogModule,
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
        } @else {
          <button mat-stroked-button type="button" data-cy="event-preview-collapse" aria-controls="event-live-preview" [attr.aria-expanded]="!previewCollapsed()" (click)="togglePreview()">{{ previewCollapsed() ? i18n.t('eventCreate.showPreview') : i18n.t('eventCreate.hidePreview') }}</button>
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
                    <input id="event-country" data-cy="event-country" formControlName="country" autocomplete="country-name" [attr.aria-invalid]="fieldError('country') ? 'true' : null" [attr.aria-describedby]="fieldError('country') ? 'event-country-error' : null" />
                    @if (fieldError('country'); as message) { <p id="event-country-error" class="field-error" data-cy="event-country-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-region">
                    <label for="event-region" data-cy="event-label-region">{{ i18n.t('profile.locationRegion') }}</label>
                    <input id="event-region" data-cy="event-region" formControlName="region" autocomplete="address-level1" [attr.aria-invalid]="fieldError('region') ? 'true' : null" [attr.aria-describedby]="fieldError('region') ? 'event-region-error' : null" />
                    @if (fieldError('region'); as message) { <p id="event-region-error" class="field-error" data-cy="event-region-error">{{ message }}</p> }
                  </div>
                  <div class="tournament-create-field" data-cy="event-field-street">
                    <label for="event-street" data-cy="event-label-street">{{ i18n.t('eventCreate.street') }}</label>
                    <input #streetInput id="event-street" data-cy="event-street" formControlName="streetAddress" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="event-location-suggestions" [attr.aria-expanded]="locationSuggestions().length ? 'true' : 'false'" [attr.aria-invalid]="fieldError('streetAddress') || fieldError('locationToken') ? 'true' : null" [attr.aria-describedby]="fieldError('streetAddress') ? 'event-street-error' : fieldError('locationToken') ? 'event-location-token-error' : null" />
                    <input type="hidden" data-cy="event-location-token" formControlName="locationToken" />
                    <input type="hidden" data-cy="event-location-time-zone" formControlName="timeZoneId" />
                    <input type="hidden" data-cy="event-location-latitude" formControlName="latitude" />
                    <input type="hidden" data-cy="event-location-longitude" formControlName="longitude" />
                    @if (locationLoading()) { <p role="status" data-cy="event-location-loading">{{ i18n.t('eventCreate.locationSearching') }}</p> }
                    @if (locationSuggestions().length) {
                      <ul id="event-location-suggestions" class="stack" role="listbox" data-cy="event-location-suggestions">
                        @for (suggestion of locationSuggestions(); track suggestion.placeId) {
                          <li role="none" [attr.data-cy]="'event-location-suggestion-item-' + $index"><button type="button" role="option" aria-selected="false" [attr.data-cy]="'event-location-suggestion-' + $index" [disabled]="locationResolving()" (click)="resolveLocation(suggestion)"><span [attr.data-cy]="'event-location-suggestion-primary-' + $index">{{ suggestion.primaryText }}</span><span [attr.data-cy]="'event-location-suggestion-secondary-' + $index">{{ suggestion.secondaryText }}</span></button></li>
                        }
                      </ul>
                    }
                    @if (locationSearchComplete() && !locationSuggestions().length) { <p role="status" data-cy="event-location-empty">{{ i18n.t('eventCreate.locationEmpty') }}</p> }
                    @if (locationResolving()) { <p role="status" data-cy="event-location-resolving">{{ i18n.t('eventCreate.locationResolving') }}</p> }
                    @if (locationError()) { <div class="error" role="alert" data-cy="event-location-error"><span data-cy="event-location-error-message">{{ locationError() }}</span>@if (canRetryLocation()) { <button mat-stroked-button type="button" data-cy="event-location-retry" (click)="retryLocationResolution()">{{ i18n.t('common.retry') }}</button> }</div> }
                    @if (fieldError('streetAddress'); as message) { <p id="event-street-error" class="field-error" data-cy="event-street-error">{{ message }}</p> }
                    @if (fieldError('locationToken'); as message) { <p id="event-location-token-error" class="field-error" data-cy="event-location-token-error">{{ message }}</p> }
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

                @if (!editMode) {
                  <div class="event-form-row event-form-row--full" data-cy="event-row-images"><gones-event-image-uploader data-cy="event-image-editor" [blockedMessageKey]="canPublishDirectly() ? 'eventImages.publishBlocked' : 'eventImages.proposalBlocked'" [attr.aria-describedby]="fieldError('images') ? 'event-images-error' : null" (imagesChange)="onImagesChange($event)" (publishBlockedChange)="imagePublishBlocked.set($event)" />@if (fieldError('images'); as message) { <p id="event-images-error" class="field-error" data-cy="event-images-error">{{ message }}</p> }</div>
                }

                @if (editMode) {
                  <div class="event-form-row event-form-row--full" data-cy="event-row-images"><gones-event-image-uploader data-cy="event-image-editor" [initialImages]="initialEditorImages()" [attr.aria-describedby]="fieldError('images') ? 'event-images-error' : null" (imagesChange)="onImagesChange($event)" (publishBlockedChange)="imagePublishBlocked.set($event)" />@if (fieldError('images'); as message) { <p id="event-images-error" class="field-error" data-cy="event-images-error">{{ message }}</p> }</div>
                }
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
            <div class="actions" data-cy="event-create-actions">
              @if (canPublishDirectly()) {
                @if (editMode) {
                  <button #saveButton mat-flat-button class="home-primary-action" type="submit" data-cy="event-save" [disabled]="formPending() || locationExpired() || imagePublishBlocked()">{{ saving() ? i18n.t('eventManage.saving') : i18n.t('common.save') }}</button>
                } @else {
                  <button mat-flat-button class="home-primary-action" type="submit" data-cy="event-publish" [disabled]="publishDisabled()">{{ publishing() ? i18n.t('eventCreate.publishing') : i18n.t('eventCreate.publish') }}</button>
                }
              } @else {
                <p class="warning" role="status" data-cy="event-approval-notice">{{ i18n.t('eventCreate.approvalNotice') }}</p>
                <button mat-flat-button class="home-primary-action" type="button" data-cy="event-submit-for-approval" [disabled]="proposalPending() || loadingReferences() || !organizationSelected() || imagePublishBlocked()" (click)="submitForApproval()">{{ i18n.t('eventCreate.submitForApproval') }}</button>
                @if (proposalError()) { <p class="error" role="alert" data-cy="event-proposal-error">{{ proposalError() }}</p> }
              }
            </div>
          </form>

          @if (!editMode) {
            <aside id="event-live-preview" class="event-live-preview" aria-labelledby="event-live-preview-title" data-cy="event-live-preview" [hidden]="previewCollapsed()"><h2 id="event-live-preview-title" data-cy="event-live-preview-title">{{ i18n.t('eventCreate.livePreview') }}</h2><gones-event-detail-view [event]="draftPreview()" [draftPlaceholderMode]="true" [showIcsAction]="false" data-cy="event-live-preview-detail" /></aside>
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
  private readonly state = new DirectPublicationState();
  private readonly eventId = this.route.snapshot.paramMap.get('id');
  readonly editMode = Boolean(this.eventId);
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('streetInput') private streetInput?: ElementRef<HTMLInputElement>;
  @ViewChild('saveButton') private saveButton?: ElementRef<HTMLButtonElement>;

  readonly organizations = signal<EventOrganizationOption[]>([]);
  readonly formats = signal<PublicFormatResponse[]>([]);
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
  readonly initialEditorImages = computed(() => this.baseEvent()?.images ?? []);
  readonly success = signal('');
  readonly canMutateEvent = computed(() => canUsePowerMutation(
    this.power.enabled(),
    canManageArchive(this.auth.profile()?.globalRole) && this.auth.profile()?.emailVerified === true
  ));
  readonly canPublishDirectly = this.canMutateEvent;
  private readonly isAdmin = computed(() => this.auth.profile()?.globalRole === 'Admin');
  readonly proposalPending = signal(false);
  readonly proposalSentCount = signal<number | null>(null);
  readonly proposalError = signal('');
  readonly locationSuggestions = signal<EventLocationSuggestionResponse[]>([]);
  readonly locationLoading = signal(false);
  readonly locationSearchComplete = signal(false);
  readonly locationResolving = signal(false);
  readonly locationError = signal('');
  readonly locationExpired = signal(false);
  private readonly locationExpiresAt = signal('');
  private readonly retryLocation = signal<EventLocationSuggestionResponse | null>(null);
  private readonly retryLocationSearch = signal<string | null>(null);
  private readonly locationSearchRetries = new Subject<string>();
  private locationRevision = 0;
  readonly canRetryLocation = computed(() => Boolean(this.locationError() && (this.retryLocation() || this.retryLocationSearch())) && !this.locationResolving());
  private readonly locationSessionToken = globalThis.crypto.randomUUID();
  readonly selectedOrganizationId = signal('');
  readonly imagePublishBlocked = signal(false);
  readonly selectedImages = signal<readonly EventImageSelection[]>([]);
  private readonly previewRevision = signal(0);
  readonly previewCollapsed = signal(readPreviewCollapsed());
  readonly formPending = computed(() => this.publishing() || this.saving());
  readonly organizationSelected = computed(() =>
    this.organizations().some(option => option.id === this.selectedOrganizationId()));

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
    locationToken: new FormControl('', { nonNullable: true, validators: Validators.required }),
    latitude: new FormControl<number | null>(null),
    longitude: new FormControl<number | null>(null),
    eventType: new FormControl<'' | 'weekly' | 'monthly' | 'major'>('weekly', { nonNullable: true, validators: Validators.required }),
    timeZoneId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    startDate: new FormControl('', { nonNullable: true, validators: Validators.required }),
    startTime: new FormControl('', { nonNullable: true, validators: Validators.required }),
    capacity: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]),
    formatId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    images: new FormControl<EventImageInput[]>([], { nonNullable: true })
  });

  readonly publishDisabled = computed(() => {
    this.previewRevision();
    return this.form.invalid
      || this.formPending()
      || this.loadingReferences()
      || !this.organizations().length
      || this.locationResolving()
      || this.locationExpired()
      || this.imagePublishBlocked();
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
      displayTitle: title && format ? `${format.name} — ${title}` : '',
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
      images: this.selectedImages().map(image => ({
        id: image.imageId,
        altText: image.altText ?? undefined,
        variants: image.response.variants.map(variant => ({ ...variant, url: image.previewUrl }))
      }))
    };
  });

  ngOnInit(): void {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncSelectedOrganization();
      this.fieldErrors.set({});
      this.submitError.set(null);
      this.success.set('');
      this.state.reset();
      this.previewRevision.update(value => value + 1);
    });
    merge(
      this.form.controls.streetAddress.valueChanges,
      this.form.controls.postalCode.valueChanges,
      this.form.controls.city.valueChanges,
      this.form.controls.country.valueChanges,
      this.form.controls.region.valueChanges
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.invalidateResolvedLocation());
    merge(
      this.form.controls.streetAddress.valueChanges.pipe(
        map(value => {
          this.locationSearchComplete.set(false);
          return value.trim();
        }),
        distinctUntilChanged(),
        switchMap(value => value.length < MinimumLocationSearchLength
          ? of(value)
          : timer(LocationAutocompleteDelayMilliseconds).pipe(map(() => value)))
      ),
      this.locationSearchRetries
    ).pipe(
      switchMap(value => {
        if (value.length < MinimumLocationSearchLength) {
          this.locationSuggestions.set([]);
          this.locationLoading.set(false);
          this.locationError.set('');
          this.retryLocationSearch.set(null);
          return of([] as EventLocationSuggestionResponse[]);
        }
        this.locationLoading.set(true);
        this.locationSearchComplete.set(false);
        this.locationError.set('');
        this.retryLocationSearch.set(null);
        return this.client.autocompleteEventLocations(value, this.locationSessionToken, this.i18n.language()).pipe(
          map(response => {
            this.locationSearchComplete.set(true);
            return response.suggestions.slice(0, MaximumLocationSuggestions);
          }),
          catchError(error => {
            this.locationLoading.set(false);
            this.locationSearchComplete.set(false);
            this.locationSuggestions.set([]);
            this.locationError.set(this.locationErrorMessage(error));
            this.retryLocationSearch.set(value);
            return of([] as EventLocationSuggestionResponse[]);
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(suggestions => {
      this.locationSuggestions.set(suggestions);
      this.locationLoading.set(false);
    });
    void this.loadReferences();
  }

  ngAfterViewInit(): void { queueMicrotask(() => this.titleInput?.nativeElement.focus()); }

  togglePreview(): void {
    this.previewCollapsed.update(value => !value);
    sessionStorage.setItem(PreviewCollapsedKey, String(this.previewCollapsed()));
  }

  onImagesChange(images: readonly EventImageSelection[]): void {
    this.selectedImages.set(images);
    this.form.controls.images.setValue(images.map(image => ({ imageId: image.imageId, altText: image.altText ?? undefined })));
  }

  async loadReferences(): Promise<void> {
    this.loadingReferences.set(true);
    this.referenceError.set('');
    this.submitError.set(null);
    try {
      const formats = await firstValueFrom(this.client.formatsAll());
      this.formats.set(formats);
      if (this.editMode) {
        const event = await this.findEvent(this.eventId!);
        this.organizations.set([{ id: event.organizationId, name: event.organizationName }]);
        this.form.controls.organizationId.disable({ emitEvent: false });
        this.applyCanonical(event);
      } else {
        const organizations = await this.loadOrganizationOptions();
        this.organizations.set(organizations);
        if (!organizations.some(item => item.id === this.form.controls.organizationId.value)) {
          this.form.controls.organizationId.setValue(organizations[0]?.id ?? '');
        }
        if (!organizations.length) this.referenceError.set(this.i18n.t('eventCreate.noOrganizations'));
      }
      this.syncSelectedOrganization();
      this.previewRevision.update(value => value + 1);
    } catch {
      this.organizations.set([]);
      this.formats.set([]);
      this.syncSelectedOrganization();
      this.referenceError.set(this.editMode ? this.i18n.t('eventManage.loadFailed') : this.i18n.t('eventCreate.referencesFailed'));
    } finally {
      this.loadingReferences.set(false);
    }
  }

  private syncSelectedOrganization(): void {
    this.selectedOrganizationId.set(this.form.getRawValue().organizationId);
  }

  async resolveLocation(suggestion: EventLocationSuggestionResponse): Promise<void> {
    if (this.locationResolving()) return;
    const revision = this.locationRevision;
    this.retryLocation.set(suggestion);
    this.locationSearchComplete.set(false);
    this.locationResolving.set(true);
    this.locationError.set('');
    try {
      const resolved = await firstValueFrom(this.client.resolveEventLocation({
        placeId: suggestion.placeId,
        sessionToken: this.locationSessionToken,
        language: this.i18n.language()
      }).pipe(takeUntilDestroyed(this.destroyRef)));
      if (revision !== this.locationRevision) return;
      this.form.patchValue({
        streetAddress: resolved.streetAddress,
        postalCode: resolved.postalCode,
        city: resolved.city,
        country: resolved.country,
        region: resolved.region,
        locationToken: resolved.locationToken,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        timeZoneId: resolved.timeZoneId
      }, { emitEvent: false });
      this.trackLocationExpiry(resolved.expiresAt);
      this.locationSuggestions.set([]);
      this.locationError.set('');
      this.retryLocation.set(null);
      this.previewRevision.update(value => value + 1);
    } catch (error) {
      if (!this.destroyRef.destroyed && revision === this.locationRevision) this.locationError.set(this.locationErrorMessage(error));
    } finally {
      if (!this.destroyRef.destroyed) this.locationResolving.set(false);
    }
  }

  async retryLocationResolution(): Promise<void> {
    const suggestion = this.retryLocation();
    if (suggestion) {
      await this.resolveLocation(suggestion);
      return;
    }
    const search = this.retryLocationSearch();
    if (search) this.locationSearchRetries.next(search);
  }

  private invalidateResolvedLocation(): void {
    this.locationRevision += 1;
    this.retryLocation.set(null);
    if (!this.form.controls.locationToken.value
      && !this.form.controls.timeZoneId.value
      && this.form.controls.latitude.value === null
      && this.form.controls.longitude.value === null)
    {
      return;
    }
    this.form.patchValue({
      locationToken: '',
      timeZoneId: '',
      latitude: null,
      longitude: null
    }, { emitEvent: false });
    this.locationExpiresAt.set('');
    this.locationExpired.set(false);
  }

  private locationErrorMessage(error: unknown): string {
    if (error instanceof ApiProblemError && error.problem.code === 'location_provider_unavailable') {
      return this.i18n.t('eventCreate.locationProviderUnavailable');
    }
    return this.i18n.t('eventCreate.locationResolveFailed');
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
      this.proposalSentCount.set(response.recipientCount);
    } catch (error) {
      this.applyFieldErrors(error);
      this.proposalError.set(this.i18n.t('proposal.submitFailed'));
    } finally {
      this.proposalPending.set(false);
    }
  }

  async publish(): Promise<void> {
    if (!this.canMutateEvent()) return;
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    this.submitError.set(null);
    if (this.publishDisabled()) return;
    this.publishing.set(true);
    const key = this.state.idempotencyKey(() => globalThis.crypto.randomUUID());
    try {
      const response = await firstValueFrom(this.client.eventsPOST(key, eventPayload(this.form.getRawValue())));
      await this.router.navigate(['/events', response.slug]);
    } catch (error) {
      this.applyFieldErrors(error);
      if (error instanceof ApiProblemError
        && (error.problem.code === 'location_token_invalid' || error.problem.code === 'location_token_expired'))
      {
        this.locationExpired.set(true);
        this.fieldErrors.update(errors => ({ ...errors, locationToken: this.i18n.t('eventCreate.locationRequired') }));
      }
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
    if (this.locationExpired()) {
      this.fieldErrors.set({ locationToken: this.i18n.t('eventManage.locationExpired') });
      return;
    }
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
      queueMicrotask(() => this.saveButton?.nativeElement.focus());
    } catch (error) {
      this.applyFieldErrors(error);
      if (error instanceof ApiProblemError && error.problem.code === 'image_state_conflict') {
        this.fieldErrors.update(errors => ({ ...errors, images: this.i18n.t('eventManage.imageConflict') }));
      }
      if (error instanceof ApiProblemError && error.status === 404 && error.problem.code === 'image_not_found') {
        this.fieldErrors.update(errors => ({ ...errors, images: this.i18n.t('eventManage.imageMissing') }));
        await this.loadStaleEvent(base);
      } else if (error instanceof ApiProblemError && error.status === 412) {
        await this.loadStaleEvent(base);
      } else if (error instanceof ApiProblemError
        && (error.problem.code === 'location_token_invalid' || error.problem.code === 'location_token_expired'))
      {
        this.locationExpired.set(true);
        this.fieldErrors.update(errors => ({ ...errors, locationToken: this.i18n.t('eventManage.locationExpired') }));
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
      if (!errors['images']) return errors;
      const current = { ...errors };
      delete current['images'];
      return current;
    });
    this.submitError.set(null);
    this.success.set(this.i18n.t('eventManage.reloaded'));
    queueMicrotask(() => this.streetInput?.nativeElement.focus());
  }

  fieldError(name: keyof typeof this.form.controls): string {
    if (name === 'locationToken' && this.locationExpired()) return this.i18n.t('eventManage.locationExpired');
    const serverError = this.fieldErrors()[name];
    if (serverError) return serverError;
    const control = this.form.controls[name];
    if (!control.touched || !control.errors) return '';
    if (control.errors['required'] || (name === 'title' && control.errors['pattern'])) {
      return this.i18n.t(name === 'locationToken' ? 'eventCreate.locationRequired' : 'eventCreate.required');
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
    this.trackLocationExpiry(event.locationTokenExpiresAt);
    this.currentRender.set(managementToDetail(event, this.formats()));
  }

  private trackLocationExpiry(expiresAt: string): void {
    this.locationExpiresAt.set(expiresAt);
    const expiry = Date.parse(expiresAt);
    this.locationExpired.set(!Number.isFinite(expiry) || Date.now() >= expiry);
    if (!Number.isFinite(expiry) || Date.now() >= expiry) return;
    const delay = Math.min(2_147_483_647, expiry - Date.now());
    timer(delay).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.locationExpiresAt() === expiresAt) this.locationExpired.set(Date.now() >= expiry);
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
      locationregion: 'region', locationlocationtoken: 'locationToken', eventtype: 'eventType', startsatlocal: 'startDate',
      capacity: 'capacity', formatids: 'formatId', images: 'images'
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
      const name = normalized.startsWith('images') ? 'images' : names[normalized];
      if (name) mapped[name] = message;
    }
    this.fieldErrors.set(mapped);
  }

  private recovery(error: unknown): RecoveryError {
    if (error instanceof ApiProblemError) {
      if (error.status === 401) return { message: this.i18n.t('eventCreate.unauthorized'), action: 'login' };
      if (error.status === 403 || error.status === 404) return { message: this.i18n.t('eventCreate.forbidden'), action: 'reload' };
      if (error.status === 409) return { message: this.i18n.t('eventCreate.conflict'), action: 'review-calendar' };
      if (error.problem.errors || error.problem.code === 'location_token_invalid' || error.problem.code === 'location_token_expired') {
        return { message: this.i18n.t('eventCreate.validationFailed'), action: 'retry' };
      }
    }
    return { message: this.i18n.t('eventCreate.publishNetwork'), action: 'retry' };
  }
}

function readPreviewCollapsed(): boolean {
  return sessionStorage.getItem(PreviewCollapsedKey) === 'true';
}
