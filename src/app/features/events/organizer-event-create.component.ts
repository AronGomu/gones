import { AfterViewInit, Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { catchError, distinctUntilChanged, firstValueFrom, map, merge, of, Subject, switchMap, timer } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, EventLocationSuggestionResponse, PublicFormatResponse, EventManagementResponse, EventPreviewRenderResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService } from '../../auth/auth.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { EventDetailViewComponent } from './event-detail-view.component';
import { ApproverSelectionDialogComponent } from './approver-selection-dialog.component';
import { PreviewPublicationState, eventPayload } from './organizer-event-create';
import { EventProposalService, sortApprovers } from './event-proposal.service';
import { changedEventFields, majorEventChanges, managementToDetail, managementToDraft, eventUpdatePayload } from './event-management';
import { canManageArchive } from '../../data/archive-command-ux';
import { canUsePowerMutation, PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { BackButtonComponent } from '../../shared/back-button.component';

type RecoveryAction = 'reload' | 'login' | 'review-calendar' | 'refresh-preview' | 'retry';
interface RecoveryError { message: string; action: RecoveryAction; }

/**
 * The picker needs an id and a label and nothing else, which lets the two lists behind it — the
 * caller's own memberships and the anonymous public catalogue — feed the same `<select>`.
 */
export interface EventOrganizationOption { id: string; name: string; }

/**
 * Neither the public catalogue nor the admin catalogue is paginated in the picker, so both are
 * pulled page by page at the endpoint's cap, under the same ceiling.
 */
const PublicOrganizationPageSize = 100;
const MaximumPublicOrganizationPages = 20;
const MinimumLocationSearchLength = 3;
const LocationAutocompleteDelayMilliseconds = 300;
const MaximumLocationSuggestions = 5;

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatDialogModule, EventDetailViewComponent, BackButtonComponent],
  template: `
    <gones-back-button data-cy="organizer-event-create-back-top" [label]="i18n.t('nav.backToPrevious')" position="top" />

    <section class="organizer-tournament-create stack" [attr.data-cy]="editMode ? 'organizer-event-edit' : 'organizer-event-create'" aria-labelledby="organizer-event-title">
      <header class="page-heading" data-cy="event-create-header">
        <div data-cy="event-create-heading-group"><h1 id="organizer-event-title" data-cy="event-create-title">{{ editMode ? i18n.t('eventManage.editTitle') : editing() ? i18n.t('eventCreate.title') : i18n.t('eventCreate.previewTitle') }}</h1></div>
        @if (editMode) { <a mat-stroked-button routerLink="/organizer/events" data-cy="event-create-back-to-list">{{ i18n.t('eventManage.backToList') }}</a> }
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
      } @else if (editing()) {
        <form class="panel tournament-create-form" data-cy="event-create-form" [formGroup]="form" (ngSubmit)="editMode ? saveEdit() : requestPreview()" novalidate [attr.aria-busy]="formPending()">
          <p class="muted tournament-create-help" data-cy="event-create-zone-note">{{ i18n.t('eventCreate.zoneHelp') }}</p>
          <fieldset class="tournament-form-lock" data-cy="event-fieldset" [disabled]="formPending()">
          <div class="tournament-create-grid" data-cy="event-create-grid">
            <div class="tournament-create-field tournament-create-wide" data-cy="event-field-title">
              <label for="event-title-input" data-cy="event-label-title">{{ i18n.t('eventCreate.name') }}</label>
              <input #titleInput id="event-title-input" data-cy="event-title" formControlName="title" autocomplete="off" [attr.aria-invalid]="fieldError('title') ? 'true' : null" [attr.aria-describedby]="fieldError('title') ? 'event-title-error' : null" />
              @if (fieldError('title'); as message) { <p id="event-title-error" class="field-error" data-cy="event-title-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-organization">
              <label for="event-organization" data-cy="event-label-organization">{{ i18n.t('eventCreate.organization') }}</label>
              <select id="event-organization" data-cy="event-organization" formControlName="organizationId" [attr.aria-invalid]="fieldError('organizationId') ? 'true' : null" [attr.aria-describedby]="fieldError('organizationId') ? 'event-organization-error' : null">
                @for (organization of organizations(); track organization.id) { <option [value]="organization.id" [attr.data-cy]="'event-organization-option-' + organization.id">{{ organization.name }}</option> }
              </select>
              @if (fieldError('organizationId'); as message) { <p id="event-organization-error" class="field-error" data-cy="event-organization-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double" data-cy="event-field-summary">
              <label for="event-summary" data-cy="event-label-summary">{{ i18n.t('eventCreate.summary') }}</label>
              <input id="event-summary" data-cy="event-summary" formControlName="summary" maxlength="50" [attr.aria-invalid]="fieldError('summary') ? 'true' : null" [attr.aria-describedby]="fieldError('summary') ? 'event-summary-error' : null" />
              @if (fieldError('summary'); as message) { <p id="event-summary-error" class="field-error" data-cy="event-summary-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-wide" data-cy="event-field-body">
              <label for="event-body" data-cy="event-label-body">{{ i18n.t('eventCreate.body') }}</label>
              <textarea id="event-body" data-cy="event-body" formControlName="bodyHtml" rows="7" [attr.aria-invalid]="fieldError('bodyHtml') ? 'true' : null" [attr.aria-describedby]="fieldError('bodyHtml') ? 'event-body-error event-body-help' : 'event-body-help'"></textarea>
              <p id="event-body-help" class="muted" data-cy="event-body-help">{{ i18n.t('eventCreate.bodyHelp') }}</p>
              @if (fieldError('bodyHtml'); as message) { <p id="event-body-error" class="field-error" data-cy="event-body-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double" data-cy="event-field-street">
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
                    <li role="none" [attr.data-cy]="'event-location-suggestion-item-' + $index">
                      <button type="button" role="option" aria-selected="false" [attr.data-cy]="'event-location-suggestion-' + $index" [disabled]="locationResolving()" (click)="resolveLocation(suggestion)">
                        <span [attr.data-cy]="'event-location-suggestion-primary-' + $index">{{ suggestion.primaryText }}</span>
                        <span [attr.data-cy]="'event-location-suggestion-secondary-' + $index">{{ suggestion.secondaryText }}</span>
                      </button>
                    </li>
                  }
                </ul>
              }
              @if (locationSearchComplete() && !locationSuggestions().length) { <p role="status" data-cy="event-location-empty">{{ i18n.t('eventCreate.locationEmpty') }}</p> }
              @if (locationResolving()) { <p role="status" data-cy="event-location-resolving">{{ i18n.t('eventCreate.locationResolving') }}</p> }
              @if (locationError()) {
                <div class="error" role="alert" data-cy="event-location-error">
                  <span data-cy="event-location-error-message">{{ locationError() }}</span>
                  @if (canRetryLocation()) { <button mat-stroked-button type="button" data-cy="event-location-retry" (click)="retryLocationResolution()">{{ i18n.t('common.retry') }}</button> }
                </div>
              }
              @if (fieldError('streetAddress'); as message) { <p id="event-street-error" class="field-error" data-cy="event-street-error">{{ message }}</p> }
              @if (fieldError('locationToken'); as message) { <p id="event-location-token-error" class="field-error" data-cy="event-location-token-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-postal-code">
              <label for="event-postal-code" data-cy="event-label-postal-code">{{ i18n.t('eventCreate.postalCode') }}</label>
              <input id="event-postal-code" data-cy="event-postal-code" formControlName="postalCode" autocomplete="postal-code" />
            </div>
            <div class="tournament-create-field" data-cy="event-field-city">
              <label for="event-city" data-cy="event-label-city">{{ i18n.t('event.city') }}</label>
              <input id="event-city" data-cy="event-city" formControlName="city" autocomplete="address-level2" [attr.aria-invalid]="fieldError('city') ? 'true' : null" [attr.aria-describedby]="fieldError('city') ? 'event-city-error' : null" />
              @if (fieldError('city'); as message) { <p id="event-city-error" class="field-error" data-cy="event-city-error">{{ message }}</p> }
            </div>
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
            <div class="tournament-create-field" data-cy="event-field-start">
              <label for="event-start" data-cy="event-label-start">{{ i18n.t('eventCreate.start') }}</label>
              <input id="event-start" data-cy="event-start" type="datetime-local" formControlName="startsAtLocal" [attr.aria-invalid]="fieldError('startsAtLocal') ? 'true' : null" [attr.aria-describedby]="fieldError('startsAtLocal') ? 'event-start-error' : null" />
              @if (fieldError('startsAtLocal'); as message) { <p id="event-start-error" class="field-error" data-cy="event-start-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-end">
              <label for="event-end" data-cy="event-label-end">{{ i18n.t('eventCreate.end') }}</label>
              <input id="event-end" data-cy="event-end" type="datetime-local" formControlName="endsAtLocal" [attr.aria-invalid]="fieldError('endsAtLocal') ? 'true' : null" [attr.aria-describedby]="fieldError('endsAtLocal') ? 'event-end-error' : null" />
              @if (fieldError('endsAtLocal'); as message) { <p id="event-end-error" class="field-error" data-cy="event-end-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-capacity">
              <label for="event-capacity" data-cy="event-label-capacity">{{ i18n.t('event.capacity') }}</label>
              <input id="event-capacity" data-cy="event-capacity" type="number" min="1" step="1" formControlName="capacity" [attr.aria-invalid]="fieldError('capacity') ? 'true' : null" [attr.aria-describedby]="fieldError('capacity') ? 'event-capacity-error' : null" />
              @if (fieldError('capacity'); as message) { <p id="event-capacity-error" class="field-error" data-cy="event-capacity-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-type">
              <label for="event-type" data-cy="event-label-type">{{ i18n.t('event.eventType') }}</label>
              <select id="event-type" data-cy="event-type" formControlName="eventType" [attr.aria-invalid]="fieldError('eventType') ? 'true' : null" [attr.aria-describedby]="fieldError('eventType') ? 'event-type-error' : null"><option value="" disabled data-cy="event-type-empty">{{ i18n.t('eventCreate.selectEventType') }}</option><option value="weekly" data-cy="event-type-weekly">{{ i18n.t('event.type.weekly') }}</option><option value="monthly" data-cy="event-type-monthly">{{ i18n.t('event.type.monthly') }}</option><option value="major" data-cy="event-type-major">{{ i18n.t('event.type.major') }}</option></select>
              @if (fieldError('eventType'); as message) { <p id="event-type-error" class="field-error" data-cy="event-type-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double" data-cy="event-field-format">
              <label for="event-format" data-cy="event-label-format">{{ i18n.t('eventCreate.format') }}</label>
              <select id="event-format" data-cy="event-format" formControlName="formatId" [attr.aria-invalid]="fieldError('formatId') ? 'true' : null" [attr.aria-describedby]="fieldError('formatId') ? 'event-format-error event-format-help' : 'event-format-help'">
                @for (format of formats(); track format.id) { <option [value]="format.id" [attr.data-cy]="'event-format-option-' + format.id">{{ format.name }}</option> }
              </select>
              <p id="event-format-help" class="muted" data-cy="event-format-help">{{ i18n.t('eventCreate.formatHelp') }}</p>
              @if (fieldError('formatId'); as message) { <p id="event-format-error" class="field-error" data-cy="event-format-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double" data-cy="event-field-live-tournament-url">
              <label for="event-live-tournament-url" data-cy="event-label-live-tournament-url">{{ i18n.t('eventCreate.liveTournamentUrl') }}</label>
              <input id="event-live-tournament-url" data-cy="event-live-tournament-url" type="url" formControlName="liveTournamentUrl" maxlength="2048" [attr.aria-invalid]="fieldError('liveTournamentUrl') ? 'true' : null" [attr.aria-describedby]="fieldError('liveTournamentUrl') ? 'event-live-tournament-url-error' : null" />
              @if (fieldError('liveTournamentUrl'); as message) { <p id="event-live-tournament-url-error" class="field-error" data-cy="event-live-tournament-url-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double" data-cy="event-field-archive-tournament-url">
              <label for="event-archive-tournament-url" data-cy="event-label-archive-tournament-url">{{ i18n.t('eventCreate.archiveTournamentUrl') }}</label>
              <input id="event-archive-tournament-url" data-cy="event-archive-tournament-url" type="url" formControlName="archiveTournamentUrl" maxlength="2048" [attr.aria-invalid]="fieldError('archiveTournamentUrl') ? 'true' : null" [attr.aria-describedby]="fieldError('archiveTournamentUrl') ? 'event-archive-tournament-url-error' : null" />
              @if (fieldError('archiveTournamentUrl'); as message) { <p id="event-archive-tournament-url-error" class="field-error" data-cy="event-archive-tournament-url-error">{{ message }}</p> }
            </div>
          </div>
          </fieldset>
          @if (staleEvent(); as latest) {
            <div class="warning stack" role="alert" data-cy="event-stale">
              <strong data-cy="event-stale-title">{{ i18n.t('eventManage.staleTitle') }}</strong>
              <p data-cy="event-stale-body">{{ i18n.t('eventManage.staleBody', { title: latest.title }) }}</p>
              @if (staleChanges().length) { <ul data-cy="event-stale-changes">@for (change of staleChanges(); track change) { <li [attr.data-cy]="'event-stale-change-' + $index">{{ change }}</li> }</ul> }
              <p data-cy="event-stale-preserved">{{ i18n.t('eventManage.draftPreserved') }}</p>
              <button mat-stroked-button type="button" data-cy="event-reload-latest" (click)="reloadLatest()">{{ i18n.t('eventManage.reloadLatest') }}</button>
            </div>
          }
          @if (success()) { <p role="status" class="success" data-cy="event-edit-success">{{ success() }}</p> }
          @if (submitError(); as error) {
            <div class="error tournament-create-recovery" role="alert" data-cy="event-submit-error">
              <span data-cy="event-submit-error-message">{{ error.message }}</span>
              @if (error.action === 'reload') { <button mat-stroked-button type="button" data-cy="reload-organizations" (click)="loadReferences()">{{ i18n.t('eventCreate.reloadOrganizations') }}</button> }
              @if (error.action === 'login') { <a mat-stroked-button [routerLink]="['/login']" [queryParams]="{ returnUrl: '/events/new' }" target="_blank" rel="noopener noreferrer" data-cy="event-submit-error-login">{{ i18n.t('eventCreate.signInAgain') }}</a> }
              @if (error.action === 'retry') { <button mat-stroked-button type="submit" data-cy="event-submit-error-retry">{{ i18n.t('common.retry') }}</button> }
            </div>
          }
          <div class="actions" data-cy="event-create-actions">
            @if (canPublishDirectly()) {
              <button #saveButton mat-flat-button class="home-primary-action" type="submit" [attr.data-cy]="editMode ? 'event-save' : 'event-preview-submit'" [disabled]="formPending() || loadingReferences() || !organizations().length">{{ editMode ? (saving() ? i18n.t('eventManage.saving') : i18n.t('common.save')) : (previewing() ? i18n.t('eventCreate.previewing') : i18n.t('eventCreate.preview')) }}</button>
            } @else {
              <p class="warning" role="status" data-cy="event-approval-notice">{{ i18n.t('eventCreate.approvalNotice') }}</p>
              <button mat-flat-button class="home-primary-action" type="button" data-cy="event-submit-for-approval" [disabled]="proposalPending() || loadingReferences() || !organizationSelected()" (click)="submitForApproval()">{{ i18n.t('eventCreate.submitForApproval') }}</button>
              @if (proposalError()) { <p class="error" role="alert" data-cy="event-proposal-error">{{ proposalError() }}</p> }
            }
          </div>
        </form>
        @if (editMode && currentRender(); as rendered) {
          <section class="stack" aria-labelledby="current-event-title" data-cy="event-current-details"><h2 id="current-event-title" data-cy="event-current-details-title">{{ i18n.t('eventManage.currentPublicDetails') }}</h2><gones-event-detail-view [event]="rendered" data-cy="event-current-detail-view" /></section>
        }
      } @else if (preview(); as currentPreview) {
        <p class="warning" role="status" data-cy="event-preview-notice">{{ i18n.t('eventCreate.previewNotice') }}</p>
        <gones-event-detail-view [event]="currentPreview" data-cy="event-preview-detail-view" />
        @if (publishError(); as error) {
          <div class="error tournament-create-recovery" role="alert" data-cy="event-publish-error">
            <span data-cy="event-publish-error-message">{{ error.message }}</span>
            @if (error.action === 'login') { <a mat-stroked-button [routerLink]="['/login']" [queryParams]="{ returnUrl: '/events/new' }" target="_blank" rel="noopener noreferrer" data-cy="event-publish-error-login">{{ i18n.t('eventCreate.signInAgain') }}</a> }
            @if (error.action === 'reload') { <button mat-stroked-button type="button" data-cy="event-publish-error-reload" (click)="reloadOrganizationAccess()">{{ i18n.t('eventCreate.reloadOrganizations') }}</button> }
            @if (error.action === 'review-calendar') { <a mat-stroked-button routerLink="/events" data-cy="event-review-calendar">{{ i18n.t('eventCreate.reviewCalendar') }}</a> }
            @if (error.action === 'refresh-preview') { <button mat-stroked-button type="button" data-cy="event-refresh-preview" (click)="refreshPreview()">{{ i18n.t('eventCreate.refreshPreview') }}</button> }
          </div>
        }
        <div class="actions tournament-preview-actions" data-cy="event-preview-actions">
          <button mat-stroked-button type="button" data-cy="event-back-edit" [disabled]="publishing()" (click)="backToEdit()">{{ i18n.t('eventCreate.backEdit') }}</button>
          <button mat-flat-button class="home-primary-action" type="button" data-cy="event-publish" [disabled]="publishing()" (click)="publish()">{{ publishing() ? i18n.t('eventCreate.publishing') : i18n.t('eventCreate.publish') }}</button>
        </div>
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
  private readonly state = new PreviewPublicationState();
  private readonly eventId = this.route.snapshot.paramMap.get('id');
  readonly editMode = Boolean(this.eventId);
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('streetInput') private streetInput?: ElementRef<HTMLInputElement>;
  @ViewChild('saveButton') private saveButton?: ElementRef<HTMLButtonElement>;

  readonly organizations = signal<EventOrganizationOption[]>([]);
  readonly formats = signal<PublicFormatResponse[]>([]);
  readonly loadingReferences = signal(true);
  readonly referenceError = signal('');
  readonly editing = signal(true);
  readonly preview = signal<EventPreviewRenderResponse | null>(null);
  readonly previewing = signal(false);
  readonly publishing = signal(false);
  readonly saving = signal(false);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly submitError = signal<RecoveryError | null>(null);
  readonly publishError = signal<RecoveryError | null>(null);
  readonly baseEvent = signal<EventManagementResponse | null>(null);
  readonly staleEvent = signal<EventManagementResponse | null>(null);
  readonly staleChanges = signal<string[]>([]);
  readonly currentRender = signal<EventPreviewRenderResponse | null>(null);
  readonly success = signal('');
  readonly formPending = computed(() => this.previewing() || this.saving());
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
  private readonly retryLocation = signal<EventLocationSuggestionResponse | null>(null);
  private readonly retryLocationSearch = signal<string | null>(null);
  private readonly locationSearchRetries = new Subject<string>();
  private locationRevision = 0;
  readonly canRetryLocation = computed(() => Boolean(this.locationError() && (this.retryLocation() || this.retryLocationSearch())) && !this.locationResolving());
  private readonly locationSessionToken = globalThis.crypto.randomUUID();
  /** Mirrors the form control so the template can react to it; a `FormControl` value is not a signal. */
  readonly selectedOrganizationId = signal('');
  /**
   * T26: the approval button used to stay clickable with an empty picker, so it ran, found the form
   * invalid and returned in silence. Nothing can be proposed without an organization to propose it
   * for, so say so in the control rather than in a dead click.
   */
  readonly organizationSelected = computed(() =>
    this.organizations().some(option => option.id === this.selectedOrganizationId()));

  readonly form = new FormGroup({
    organizationId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    title: new FormControl('', { nonNullable: true, validators: Validators.required }),
    summary: new FormControl('', { nonNullable: true, validators: Validators.maxLength(50) }),
    bodyHtml: new FormControl('', { nonNullable: true }),
    streetAddress: new FormControl('', { nonNullable: true, validators: Validators.required }),
    postalCode: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true, validators: Validators.required }),
    country: new FormControl('', { nonNullable: true, validators: Validators.required }),
    region: new FormControl('', { nonNullable: true, validators: Validators.required }),
    locationToken: new FormControl('', { nonNullable: true, validators: Validators.required }),
    latitude: new FormControl<number | null>(null),
    longitude: new FormControl<number | null>(null),
    eventType: new FormControl<'' | 'weekly' | 'monthly' | 'major'>('weekly', { nonNullable: true, validators: Validators.required }),
    timeZoneId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    startsAtLocal: new FormControl('', { nonNullable: true, validators: Validators.required }),
    endsAtLocal: new FormControl('', { nonNullable: true }),
    capacity: new FormControl<number | null>(null, [Validators.min(1), Validators.pattern(/^\d+$/)]),
    formatId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    liveTournamentUrl: new FormControl('', { nonNullable: true, validators: Validators.maxLength(2048) }),
    archiveTournamentUrl: new FormControl('', { nonNullable: true, validators: Validators.maxLength(2048) })
  });

  ngOnInit(): void {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncSelectedOrganization();
      this.fieldErrors.set({});
      this.submitError.set(null);
      this.success.set('');
      if (this.state.preview) {
        this.state.invalidate();
        this.preview.set(null);
        this.publishError.set(null);
      }
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
    } catch {
      this.organizations.set([]);
      this.formats.set([]);
      this.syncSelectedOrganization();
      this.referenceError.set(this.editMode ? this.i18n.t('eventManage.loadFailed') : this.i18n.t('eventCreate.referencesFailed'));
    } finally {
      this.loadingReferences.set(false);
    }
  }

  /**
   * The picked organization drives both the submit button's disabled state and the approver
   * request, so it is mirrored into a signal wherever the control can move: user edits, and the
   * default selection loading the references applies.
   */
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
      this.locationSuggestions.set([]);
      this.locationError.set('');
      this.retryLocation.set(null);
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
  }

  private locationErrorMessage(error: unknown): string {
    if (error instanceof ApiProblemError && error.problem.code === 'location_provider_unavailable') {
      return this.i18n.t('eventCreate.locationProviderUnavailable');
    }
    return this.i18n.t('eventCreate.locationResolveFailed');
  }

  /**
   * T26. Two different questions, two different lists. Publishing directly is gated on the caller's
   * own membership, so an organizer is only offered organizations they belong to — anything else
   * would only earn a refusal at publish time. Proposing is the opposite case: the submitter is by
   * definition not a member of the organization they are proposing for, so the picker reads the
   * anonymous public catalogue. Offering it costs nothing, because the approver on the other end
   * must represent that organization before anything is published.
   *
   * T14 adds the third question. The server treats an admin as a member of every organization, so
   * an admin's own memberships — usually none — are the wrong list: they read the admin catalogue
   * instead. When that admin-only call is what failed, the picker falls back to the organizer path
   * rather than showing an admin nothing at all.
   */
  private async loadOrganizationOptions(): Promise<EventOrganizationOption[]> {
    if (this.isAdmin()) {
      try {
        return await this.loadAdminOrganizations();
      } catch {
        // Fall through to the membership list below.
      }
    }
    if (this.canPublishDirectly()) {
      return (await firstValueFrom(this.client.organizationsAll())).map(item => ({ id: item.id, name: item.name }));
    }
    return this.loadPublicOrganizations();
  }

  /**
   * The admin catalogue lists every organization, including the two kinds publishing still refuses:
   * a soft-deleted one, and a Draft — an organization nobody staffs yet, which answers
   * `organization_is_draft` (T11). Offering either would only produce a refusal at publish time, so
   * they are left out here. Pages are counted by rows read, not rows kept, so filtering cannot make
   * the loop believe the list is unfinished.
   */
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

  /**
   * Pages are pulled at the endpoint's maximum size until the reported total is covered, so an
   * organization never becomes unproposable just because its name sorts past the first page. The
   * page ceiling is a stop, not a limit: it bounds a loop against a server that keeps claiming a
   * total it never delivers.
   */
  private async loadPublicOrganizations(): Promise<EventOrganizationOption[]> {
    const options: EventOrganizationOption[] = [];
    for (let page = 1; page <= MaximumPublicOrganizationPages; page++) {
      const response = await firstValueFrom(this.client.organizationsGET(undefined, page, PublicOrganizationPageSize));
      options.push(...response.items.map(item => ({ id: item.id, name: item.name })));
      if (!response.items.length || options.length >= response.totalCount) break;
    }
    return options;
  }

  async requestPreview(): Promise<void> {
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    this.submitError.set(null);
    if (this.form.invalid || this.previewing()) return;
    this.previewing.set(true);
    try {
      const response = await firstValueFrom(this.client.preview(eventPayload(this.form.getRawValue())));
      this.state.accept(response);
      this.preview.set(response.render);
      this.editing.set(false);
      this.publishError.set(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      this.applyFieldErrors(error);
      this.submitError.set(this.recovery(error, 'preview'));
    } finally {
      this.previewing.set(false);
    }
  }

  async submitForApproval(): Promise<void> {
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    if (this.form.invalid || this.proposalPending()) return;
    // T26: the chosen organization decides who may review, so it travels with the request that
    // fills the dialog. The dialog then only ever shows people who represent it.
    const organizationId = this.form.getRawValue().organizationId;
    let approvers;
    try {
      approvers = sortApprovers(await this.proposals.listApprovers(organizationId));
    } catch {
      this.proposalError.set(this.i18n.t('proposal.loadApproversFailed'));
      return;
    }
    // Global Admins back every organization, so an empty list means something is wrong rather than
    // that nobody is entitled. An empty checkbox dialog would be a dead end; say it instead.
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
      const response = await this.proposals.submit(eventPayload(this.form.getRawValue()), recipientUserIds);
      this.proposalSentCount.set(response.recipientCount);
    } catch (error) {
      this.applyFieldErrors(error);
      this.proposalError.set(this.i18n.t('proposal.submitFailed'));
    } finally {
      this.proposalPending.set(false);
    }
  }

  backToEdit(): void {
    this.editing.set(true);
    queueMicrotask(() => this.titleInput?.nativeElement.focus());
  }

  refreshPreview(): void {
    this.state.invalidate();
    this.preview.set(null);
    this.publishError.set(null);
    this.editing.set(true);
    queueMicrotask(() => this.titleInput?.nativeElement.focus());
  }

  reloadOrganizationAccess(): void {
    this.refreshPreview();
    void this.loadReferences();
  }

  async publish(): Promise<void> {
    if (!this.canMutateEvent()) return;
    if (!this.state.preview || this.publishing()) return;
    this.publishing.set(true);
    this.publishError.set(null);
    const key = this.state.idempotencyKey(() => globalThis.crypto.randomUUID());
    try {
      const response = await firstValueFrom(this.client.eventsPOST(key, {
        previewTicket: this.state.preview.previewTicket,
        payload: eventPayload(this.form.getRawValue())
      }));
      await this.router.navigate(['/events', response.slug]);
    } catch (error) {
      this.publishError.set(this.recovery(error, 'publish'));
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
    if (!this.eventId || !base || this.form.invalid || this.saving()) return;
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
      if (error instanceof ApiProblemError && error.status === 412) {
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
    this.submitError.set(null);
    this.success.set(this.i18n.t('eventManage.reloaded'));
    queueMicrotask(() => this.streetInput?.nativeElement.focus());
  }

  fieldError(name: keyof typeof this.form.controls): string {
    const serverError = this.fieldErrors()[name];
    if (serverError) return serverError;
    const control = this.form.controls[name];
    if (!control.touched || !control.errors) return '';
    if (control.errors['required']) {
      return this.i18n.t(name === 'locationToken' ? 'eventCreate.locationRequired' : 'eventCreate.required');
    }
    if (control.errors['maxlength']) {
      return this.i18n.t(name === 'summary' ? 'eventCreate.summaryTooLong' : 'eventCreate.tournamentUrlTooLong');
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
    this.currentRender.set(managementToDetail(event, this.formats()));
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
      organizationid: 'organizationId', title: 'title', summary: 'summary', bodyhtml: 'bodyHtml', streetaddress: 'streetAddress',
      postalcode: 'postalCode', city: 'city', country: 'country', region: 'region', locationtoken: 'locationToken', locationlocationtoken: 'locationToken', eventtype: 'eventType', timezoneid: 'timeZoneId', startsatlocal: 'startsAtLocal',
      endsatlocal: 'endsAtLocal', capacity: 'capacity', formatids: 'formatId', livetournamenturl: 'liveTournamentUrl',
      archivetournamenturl: 'archiveTournamentUrl', payload: 'title'
    };
    for (const [field, messages] of Object.entries(error.problem.errors)) {
      const name = names[field.replace(/[^a-z]/gi, '').toLowerCase()];
      if (name && messages[0]) mapped[name] = messages[0];
    }
    this.fieldErrors.set(mapped);
  }

  private recovery(error: unknown, phase: 'preview' | 'publish'): RecoveryError {
    if (error instanceof ApiProblemError) {
      if (error.status === 401) return { message: this.i18n.t('eventCreate.unauthorized'), action: 'login' };
      if (error.status === 403 || error.status === 404) return { message: this.i18n.t('eventCreate.forbidden'), action: 'reload' };
      if (error.status === 409) return { message: this.i18n.t('eventCreate.conflict'), action: 'review-calendar' };
      if (error.problem.code === 'invalid_preview_ticket') return { message: this.i18n.t('eventCreate.expiredPreview'), action: 'refresh-preview' };
      if (error.problem.errors) return { message: this.i18n.t('eventCreate.validationFailed'), action: 'retry' };
    }
    return { message: phase === 'publish' ? this.i18n.t('eventCreate.publishNetwork') : this.i18n.t('eventCreate.previewNetwork'), action: 'retry' };
  }
}
