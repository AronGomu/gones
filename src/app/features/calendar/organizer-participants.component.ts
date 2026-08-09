import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import {
  Client,
  OrganizationBlockedUserResponse,
  OrganizationNotificationSettingsResponse,
  OrganizationUserLookupResponse,
  PrivateTournamentParticipantResponse,
  TournamentManagementResponse
} from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { blockPayload, lookupQuery, ParticipantLookupKind, participantErrorKey } from './participant-management';

interface ParticipantBlockDialogData {
  title: string;
  scope: string;
  reasonLabel: string;
  expiryLabel: string;
  expiryHelp: string;
  confirmLabel: string;
}

interface ParticipantBlockDialogResult { reason: string; expiresLocal: string; }

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title data-cy="block-dialog-title">{{ data.title }}</h2>
    <mat-dialog-content class="stack" data-cy="block-dialog-content">
      <p data-cy="block-dialog-scope">{{ data.scope }}</p>
      <label for="participant-block-reason" data-cy="block-reason-label">{{ data.reasonLabel }}</label>
      <input id="participant-block-reason" data-cy="block-reason" [(ngModel)]="reason" maxlength="500" />
      <label for="participant-block-expiry" data-cy="block-expiry-label">{{ data.expiryLabel }}</label>
      <input id="participant-block-expiry" data-cy="block-expiry" type="datetime-local" [(ngModel)]="expiresLocal" />
      <p class="muted" data-cy="block-dialog-expiry-help">{{ data.expiryHelp }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end" data-cy="block-dialog-actions">
      <button mat-button mat-dialog-close data-cy="block-cancel">{{ i18n.t('participants.dialogCancel') }}</button>
      <button mat-flat-button color="warn" data-cy="block-confirm" [disabled]="!reason.trim()" cdkFocusInitial (click)="confirm()">{{ data.confirmLabel }}</button>
    </mat-dialog-actions>
  `
})
export class ParticipantBlockDialogComponent {
  readonly data = inject<ParticipantBlockDialogData>(MAT_DIALOG_DATA);
  readonly i18n = inject(I18nService);
  private readonly ref = inject<MatDialogRef<ParticipantBlockDialogComponent, ParticipantBlockDialogResult>>(MatDialogRef);
  reason = '';
  expiresLocal = '';
  confirm(): void { this.ref.close({ reason: this.reason.trim(), expiresLocal: this.expiresLocal }); }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatDialogModule],
  template: `
    <section class="participant-management-page stack" data-cy="organizer-participants" aria-labelledby="participant-management-title">
      <a mat-stroked-button class="back-button" routerLink="/organizer/tournaments" data-cy="participant-back">{{ i18n.t('participants.back') }}</a>
      @if (loading()) {
        <p role="status" aria-busy="true" data-cy="participant-loading">{{ i18n.t('participants.loading') }}</p>
      } @else if (error()) {
        <div class="error stack" role="alert" data-cy="participant-error">
          <span data-cy="participant-error-text">{{ error() }}</span>
          <button mat-stroked-button type="button" data-cy="participant-error-retry" (click)="load()">{{ i18n.t('participants.retry') }}</button>
        </div>
      } @else if (tournament(); as managedTournament) {
        <header class="page-heading" data-cy="participant-heading">
          <div data-cy="participant-heading-text"><p class="kicker" data-cy="participant-kicker">{{ i18n.t('participants.kicker') }}</p><h1 id="participant-management-title" data-cy="participant-title">{{ i18n.t('participants.title', { tournament: managedTournament.title }) }}</h1></div>
          <button mat-flat-button type="button" data-cy="participant-export" [disabled]="!!pending()" (click)="exportCsv()">{{ pending() === 'export' ? i18n.t('participants.exporting') : i18n.t('participants.export') }}</button>
        </header>
        <p class="muted" data-cy="participant-scope-help">{{ i18n.t('participants.scopeHelp', { organization: managedTournament.organizationName }) }}</p>

        <mat-card class="panel" data-cy="participant-add-card"><mat-card-content class="stack" data-cy="participant-add-card-content">
          <h2 data-cy="participant-add-title">{{ i18n.t('participants.addTitle') }}</h2>
          <p class="muted" data-cy="participant-lookup-help">{{ i18n.t('participants.lookupHelp') }}</p>
          <form class="auth-form participant-lookup-form" data-cy="participant-lookup-form" (ngSubmit)="lookupUser()">
            <fieldset data-cy="participant-lookup-fieldset" [disabled]="!!pending()">
              <label for="participant-lookup-kind" data-cy="participant-lookup-kind-label">{{ i18n.t('participants.lookupKind') }}</label>
              <select id="participant-lookup-kind" data-cy="participant-lookup-kind" name="lookupKind" [(ngModel)]="lookupKind">
                <option value="username" data-cy="participant-lookup-kind-username">{{ i18n.t('participants.lookupUsername') }}</option>
                <option value="email" data-cy="participant-lookup-kind-email">{{ i18n.t('participants.lookupEmail') }}</option>
              </select>
              <label for="participant-lookup-input" data-cy="participant-lookup-input-label">{{ lookupKind === 'username' ? i18n.t('participants.lookupUsername') : i18n.t('participants.lookupEmail') }}</label>
              <input id="participant-lookup-input" data-cy="participant-lookup-input" name="lookupValue" [(ngModel)]="lookupValue" autocomplete="off" />
              <button mat-stroked-button type="submit" data-cy="participant-lookup-submit">{{ pending() === 'lookup' ? i18n.t('participants.lookupPending') : i18n.t('participants.lookup') }}</button>
            </fieldset>
          </form>
          @if (lookupError()) { <p class="error" role="alert" data-cy="participant-lookup-error">{{ lookupError() }}</p> }
          @if (selectedUser(); as user) {
            <div class="participant-selection" data-cy="participant-selection">
              <div data-cy="participant-selection-summary"><strong data-cy="participant-selection-username">{{ user.username }}</strong><span data-cy="participant-selection-legal-name">{{ user.firstName }} {{ user.lastName }}</span><span data-cy="participant-selection-email">{{ user.email }}</span></div>
              <button mat-flat-button type="button" data-cy="participant-add" [disabled]="!!pending()" (click)="addParticipant(user)">{{ pending() === 'add' ? i18n.t('participants.adding') : i18n.t('participants.add') }}</button>
            </div>
          }
        </mat-card-content></mat-card>

        <section class="stack" data-cy="participant-active-section" aria-labelledby="active-participants-title">
          <h2 id="active-participants-title" data-cy="participant-active-title">{{ i18n.t('registration.participants') }}</h2>
          @if (!participants().length) { <p class="panel participant-empty" data-cy="participant-empty">{{ i18n.t('participants.empty') }}</p> }
          @else {
            <div class="table-wrap participant-table-wrap" data-cy="participant-table">
              <table class="participant-table" data-cy="participant-table-element" aria-labelledby="active-participants-title">
                <thead data-cy="participant-table-head"><tr data-cy="participant-table-head-row"><th data-cy="participant-column-username">{{ i18n.t('participants.username') }}</th><th data-cy="participant-column-legal-name">{{ i18n.t('participants.legalName') }}</th><th data-cy="participant-column-email">{{ i18n.t('participants.email') }}</th><th data-cy="participant-column-registered-at">{{ i18n.t('participants.registeredAt') }}</th><th data-cy="participant-column-status">{{ i18n.t('participants.status') }}</th><th data-cy="participant-column-actions">{{ i18n.t('participants.actions') }}</th></tr></thead>
                <tbody data-cy="participant-table-body">@for (participant of participants(); track participant.attemptId) {
                  <tr data-cy="participant-row"><td [attr.data-cy]="'participant-cell-username-' + participant.attemptId"><strong [attr.data-cy]="'participant-username-' + participant.attemptId">{{ participant.username }}</strong></td><td [attr.data-cy]="'participant-cell-legal-name-' + participant.attemptId">{{ participant.firstName }} {{ participant.lastName }}</td><td [attr.data-cy]="'participant-cell-email-' + participant.attemptId">{{ participant.email }}</td><td [attr.data-cy]="'participant-cell-registered-at-' + participant.attemptId">{{ formatDate(participant.registeredAt) }}</td><td [attr.data-cy]="'participant-cell-status-' + participant.attemptId">{{ i18n.t('participants.active') }}</td><td [attr.data-cy]="'participant-cell-actions-' + participant.attemptId"><div class="admin-actions participant-actions" [attr.data-cy]="'participant-row-actions-' + participant.attemptId"><button mat-stroked-button type="button" data-cy="participant-remove" [disabled]="!!pending()" (click)="remove(participant)">{{ i18n.t('participants.remove') }}</button><button mat-stroked-button type="button" data-cy="participant-block" [disabled]="!!pending()" (click)="block(participant, false)">{{ i18n.t('participants.block') }}</button><button mat-stroked-button class="danger-ghost-action" type="button" data-cy="participant-remove-block" [disabled]="!!pending()" (click)="block(participant, true)">{{ i18n.t('participants.removeAndBlock') }}</button></div></td></tr>
                }</tbody>
              </table>
            </div>
            <div class="participant-card-list" role="list" data-cy="participant-card-list">
              @for (participant of participants(); track participant.attemptId) {
                <mat-card class="panel participant-card" role="listitem" data-cy="participant-card"><mat-card-content class="stack" [attr.data-cy]="'participant-card-content-' + participant.attemptId">
                  <div [attr.data-cy]="'participant-card-summary-' + participant.attemptId"><strong [attr.data-cy]="'participant-card-username-' + participant.attemptId">{{ participant.username }}</strong><p [attr.data-cy]="'participant-card-legal-name-' + participant.attemptId">{{ participant.firstName }} {{ participant.lastName }}</p><p [attr.data-cy]="'participant-card-email-' + participant.attemptId">{{ participant.email }}</p></div>
                  <dl [attr.data-cy]="'participant-card-facts-' + participant.attemptId"><div [attr.data-cy]="'participant-card-registered-at-' + participant.attemptId"><dt [attr.data-cy]="'participant-card-registered-at-term-' + participant.attemptId">{{ i18n.t('participants.registeredAt') }}</dt><dd [attr.data-cy]="'participant-card-registered-at-value-' + participant.attemptId">{{ formatDate(participant.registeredAt) }}</dd></div><div [attr.data-cy]="'participant-card-status-' + participant.attemptId"><dt [attr.data-cy]="'participant-card-status-term-' + participant.attemptId">{{ i18n.t('participants.status') }}</dt><dd [attr.data-cy]="'participant-card-status-value-' + participant.attemptId">{{ i18n.t('participants.active') }}</dd></div></dl>
                  <div class="participant-actions" [attr.data-cy]="'participant-card-actions-' + participant.attemptId"><button mat-stroked-button type="button" [attr.data-cy]="'participant-remove'" [disabled]="!!pending()" (click)="remove(participant)">{{ i18n.t('participants.remove') }}</button><button mat-stroked-button type="button" [attr.data-cy]="'participant-block'" [disabled]="!!pending()" (click)="block(participant, false)">{{ i18n.t('participants.block') }}</button><button mat-stroked-button class="danger-ghost-action" type="button" [attr.data-cy]="'participant-remove-block'" [disabled]="!!pending()" (click)="block(participant, true)">{{ i18n.t('participants.removeAndBlock') }}</button></div>
                </mat-card-content></mat-card>
              }
            </div>
            <nav class="pager" data-cy="participant-pager" [attr.aria-label]="i18n.t('calendar.pagesAria')"><button mat-stroked-button type="button" data-cy="participant-page-previous" [disabled]="participantPage() <= 1 || !!pending()" (click)="goPage(participantPage() - 1)">{{ i18n.t('common.previous') }}</button><span data-cy="participant-page">{{ i18n.t('participants.page', { page: participantPage(), pages: participantPages() }) }}</span><button mat-stroked-button type="button" data-cy="participant-page-next" [disabled]="participantPage() >= participantPages() || !!pending()" (click)="goPage(participantPage() + 1)">{{ i18n.t('common.next') }}</button></nav>
          }
        </section>

        <mat-card class="panel" data-cy="participant-blocked-card"><mat-card-content class="stack" data-cy="participant-blocked-card-content">
          <div class="section-header" data-cy="participant-blocked-header"><div data-cy="participant-blocked-header-text"><h2 data-cy="participant-blocked-title">{{ i18n.t('participants.blockedTitle') }}</h2><p class="muted" data-cy="participant-blocked-help">{{ i18n.t('participants.blockedHelp') }}</p></div><button mat-stroked-button type="button" data-cy="blocked-refresh" [disabled]="!!pending()" (click)="loadBlocks()">{{ i18n.t('participants.refreshBlocks') }}</button></div>
          @if (!blockedUsers().length) { <p data-cy="participant-blocked-empty">{{ i18n.t('participants.noBlocks') }}</p> }
          @else { <div class="participant-block-list" role="list" data-cy="participant-block-list">@for (blocked of blockedUsers(); track blocked.blockId) {
            <div class="participant-block-row" role="listitem" data-cy="blocked-user"><div [attr.data-cy]="'blocked-user-summary-' + blocked.blockId"><strong [attr.data-cy]="'blocked-user-username-' + blocked.blockId">{{ blocked.username }}</strong><p [attr.data-cy]="'blocked-user-reason-' + blocked.blockId">{{ i18n.t('participants.reason') }}: {{ blocked.reason }}</p><p [attr.data-cy]="'blocked-user-expires-' + blocked.blockId">{{ i18n.t('participants.expires') }}: {{ blocked.expiresAt ? formatDate(blocked.expiresAt) : i18n.t('participants.neverExpires') }}</p></div><button mat-stroked-button type="button" data-cy="participant-unblock" [disabled]="!!pending()" (click)="unblock(blocked)">{{ i18n.t('participants.unblock') }}</button></div>
          }</div> }
        </mat-card-content></mat-card>

        @if (notificationSettings(); as settings) {
          <mat-card class="panel" data-cy="participant-notifications-card"><mat-card-content data-cy="participant-notifications-card-content">
            <form class="auth-form" data-cy="participant-notification-settings" (ngSubmit)="saveNotifications(settings)">
              <h2 data-cy="participant-notifications-title">{{ i18n.t('participants.notificationsTitle') }}</h2><p class="muted" data-cy="participant-notifications-help">{{ i18n.t('participants.notificationsHelp') }}</p>
              <label class="check-row" data-cy="notify-registration-label"><input type="checkbox" data-cy="notify-registration" name="notifyOnRegistration" [(ngModel)]="settings.notifyOnRegistration" /> {{ i18n.t('participants.notifyRegistration') }}</label>
              <label class="check-row" data-cy="notify-unregistration-label"><input type="checkbox" data-cy="notify-unregistration" name="notifyOnUnregistration" [(ngModel)]="settings.notifyOnUnregistration" /> {{ i18n.t('participants.notifyUnregistration') }}</label>
              <button mat-flat-button type="submit" data-cy="notification-save" [disabled]="!!pending()">{{ pending() === 'notifications' ? i18n.t('common.saving') : i18n.t('participants.notificationsSave') }}</button>
            </form>
          </mat-card-content></mat-card>
        }
        @if (actionError()) { <p class="error" role="alert" [attr.data-cy]="'participant-error'">{{ actionError() }}</p> }
        @if (status()) { <p #statusMessage class="registration-live-status" role="status" tabindex="-1" data-cy="participant-status">{{ status() }}</p> }
      }
    </section>
  `
})
export class OrganizerParticipantsComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @ViewChild('statusMessage') private statusMessage?: ElementRef<HTMLElement>;

  readonly tournament = signal<TournamentManagementResponse | null>(null);
  readonly participants = signal<PrivateTournamentParticipantResponse[]>([]);
  readonly blockedUsers = signal<OrganizationBlockedUserResponse[]>([]);
  readonly notificationSettings = signal<OrganizationNotificationSettingsResponse | null>(null);
  readonly selectedUser = signal<OrganizationUserLookupResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly actionError = signal('');
  readonly lookupError = signal('');
  readonly status = signal('');
  readonly pending = signal('');
  readonly participantPage = signal(1);
  readonly participantTotal = signal(0);
  readonly pageSize = 20;
  lookupKind: ParticipantLookupKind = 'username';
  lookupValue = '';
  private tournamentId = '';

  constructor() {
    this.route.paramMap.subscribe(params => {
      this.tournamentId = params.get('id') ?? '';
      this.participantPage.set(this.pageFromRoute());
      void this.load();
    });
    this.route.queryParamMap.subscribe(() => {
      const page = this.pageFromRoute();
      if (page !== this.participantPage()) { this.participantPage.set(page); void this.loadParticipants(); }
    });
  }

  participantPages(): number { return Math.max(1, Math.ceil(this.participantTotal() / this.pageSize)); }
  formatDate(value: unknown): string { return this.i18n.formatDateTime(String(value)); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.actionError.set('');
    try {
      const tournament = await this.findManagedTournament();
      if (!tournament) { this.error.set(this.i18n.t('participants.accessDenied')); return; }
      this.tournament.set(tournament);
      await Promise.all([this.loadParticipants(), this.loadBlocks()]);
      await this.loadNotifications();
    } catch (error) {
      this.tournament.set(null);
      this.error.set(this.errorMessage(error, 'participants.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  async loadParticipants(): Promise<void> {
    if (!this.tournamentId) return;
    const response = await firstValueFrom(this.client.listPrivateTournamentParticipants(this.tournamentId, this.participantPage(), this.pageSize));
    this.participants.set(response.items);
    this.participantTotal.set(response.totalCount);
  }

  async loadBlocks(): Promise<void> {
    const tournament = this.tournament();
    if (!tournament) return;
    try {
      const response = await firstValueFrom(this.client.listOrganizationBlockedUsers(tournament.organizationId, 1, 100));
      this.blockedUsers.set(response.items);
    } catch (error) {
      this.actionError.set(this.errorMessage(error));
    }
  }

  async lookupUser(): Promise<void> {
    const tournament = this.tournament();
    if (!tournament || this.pending()) return;
    this.lookupError.set('');
    this.selectedUser.set(null);
    let query: ReturnType<typeof lookupQuery>;
    try { query = lookupQuery(this.lookupKind, this.lookupValue); }
    catch { this.lookupError.set(this.i18n.t('participants.lookupRequired')); return; }
    this.pending.set('lookup');
    try {
      this.selectedUser.set(await firstValueFrom(this.client.lookupOrganizationUser(tournament.organizationId, query.username, query.email)));
    } catch {
      this.lookupError.set(this.i18n.t('participants.lookupFailed'));
    } finally {
      this.pending.set('');
    }
  }

  async addParticipant(user: OrganizationUserLookupResponse): Promise<void> {
    if (this.pending()) return;
    await this.runMutation('add', async () => {
      await firstValueFrom(this.client.registerTournamentParticipantByOrganizer(this.tournamentId, { userId: user.userId }));
      await this.loadParticipants();
      this.selectedUser.set(null);
      this.lookupValue = '';
      this.announce(this.i18n.t('participants.added', { username: user.username }));
    });
  }

  async remove(participant: PrivateTournamentParticipantResponse): Promise<void> {
    const tournament = this.tournament();
    if (!tournament || this.pending()) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: {
      title: this.i18n.t('participants.removeTitle', { username: participant.username }),
      message: this.i18n.t('participants.removeScope', { tournament: tournament.title, organization: tournament.organizationName }),
      confirmLabel: this.i18n.t('participants.removeConfirm'), destructive: true
    } }).afterClosed());
    if (!confirmed) return;
    await this.runMutation('remove', async () => {
      await this.removeCommand(participant);
      this.announce(this.i18n.t('participants.removed', { username: participant.username }));
    });
  }

  async block(participant: PrivateTournamentParticipantResponse, removeFirst: boolean): Promise<void> {
    const tournament = this.tournament();
    if (!tournament || this.pending()) return;
    const result = await firstValueFrom(this.dialog.open(ParticipantBlockDialogComponent, { data: {
      title: this.i18n.t(removeFirst ? 'participants.removeBlockTitle' : 'participants.blockTitle', { username: participant.username }),
      scope: this.i18n.t(removeFirst ? 'participants.removeBlockScope' : 'participants.blockScope', { tournament: tournament.title, organization: tournament.organizationName }),
      reasonLabel: this.i18n.t('participants.blockReason'), expiryLabel: this.i18n.t('participants.blockExpiry'),
      expiryHelp: this.i18n.t('participants.blockNoExpiry'), confirmLabel: this.i18n.t('participants.blockConfirm')
    } }).afterClosed());
    if (!result) return;
    this.pending.set(removeFirst ? 'remove-block' : 'block');
    this.clearMessages();
    let removed = false;
    try {
      if (removeFirst) { await this.removeCommand(participant); removed = true; }
      await firstValueFrom(this.client.blockOrganizationUser(tournament.organizationId, blockPayload(participant.userId, result.reason, result.expiresLocal)));
      await this.loadBlocks();
      this.announce(this.i18n.t(removeFirst ? 'participants.removedBlocked' : 'participants.blocked', { username: participant.username, organization: tournament.organizationName }));
    } catch (error) {
      this.actionError.set(removed
        ? this.i18n.t('participants.partialRemoveBlock', { username: participant.username })
        : this.errorMessage(error));
    } finally {
      this.pending.set('');
    }
  }

  async unblock(blocked: OrganizationBlockedUserResponse): Promise<void> {
    const tournament = this.tournament();
    if (!tournament || this.pending()) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: {
      title: this.i18n.t('participants.unblockTitle', { username: blocked.username }),
      message: this.i18n.t('participants.unblockScope', { organization: tournament.organizationName }),
      confirmLabel: this.i18n.t('participants.unblockConfirm')
    } }).afterClosed());
    if (!confirmed) return;
    await this.runMutation('unblock', async () => {
      await firstValueFrom(this.client.unblockOrganizationUser(tournament.organizationId, blocked.userId));
      await this.loadBlocks();
      this.announce(this.i18n.t('participants.unblocked', { username: blocked.username }));
    });
  }

  async exportCsv(): Promise<void> {
    if (this.pending()) return;
    await this.runMutation('export', async () => {
      const response = await firstValueFrom(this.client.exportTournamentParticipants(this.tournamentId));
      const filename = response.fileName || 'participants.csv';
      const contentType = response.data.type || String(response.headers?.['content-type'] ?? 'text/csv');
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      this.announce(this.i18n.t('participants.exported', { filename, contentType }));
    });
  }

  async saveNotifications(settings: OrganizationNotificationSettingsResponse): Promise<void> {
    const tournament = this.tournament();
    if (!tournament || this.pending()) return;
    this.pending.set('notifications');
    this.clearMessages();
    try {
      this.notificationSettings.set(await firstValueFrom(this.client.notificationSettingsPUT(tournament.organizationId, {
        notifyOnRegistration: settings.notifyOnRegistration,
        notifyOnUnregistration: settings.notifyOnUnregistration
      })));
      this.announce(this.i18n.t('participants.notificationsSaved'));
    } catch (error) {
      this.actionError.set(this.errorMessage(error));
      await this.loadNotifications();
    } finally {
      this.pending.set('');
    }
  }

  goPage(page: number): void { void this.router.navigate([], { relativeTo: this.route, queryParams: { page }, queryParamsHandling: 'merge' }); }

  private async findManagedTournament(): Promise<TournamentManagementResponse | undefined> {
    const pageSize = 100;
    for (let page = 1; ; page += 1) {
      const response = await firstValueFrom(this.client.listOrganizerTournaments(page, pageSize));
      const tournament = response.items.find(item => item.id === this.tournamentId);
      if (tournament) return tournament;
      if (page * pageSize >= response.totalCount) return undefined;
    }
  }

  private async loadNotifications(): Promise<void> {
    const tournament = this.tournament();
    if (!tournament) return;
    try { this.notificationSettings.set(await firstValueFrom(this.client.notificationSettingsGET(tournament.organizationId))); }
    catch { this.notificationSettings.set(null); }
  }

  private async removeCommand(participant: PrivateTournamentParticipantResponse): Promise<void> {
    await firstValueFrom(this.client.removeTournamentParticipantByOrganizer(this.tournamentId, participant.attemptId));
    await this.loadParticipants();
  }

  private async runMutation(key: string, action: () => Promise<void>): Promise<void> {
    if (this.pending()) return;
    this.pending.set(key);
    this.clearMessages();
    try { await action(); }
    catch (error) {
      this.actionError.set(this.errorMessage(error));
      if (key !== 'export' && this.tournament()) await Promise.allSettled([this.loadParticipants(), this.loadBlocks()]);
    } finally { this.pending.set(''); }
  }

  private errorMessage(error: unknown, fallback: 'participants.loadFailed' | 'participants.actionFailed' = 'participants.actionFailed'): string {
    if (error instanceof ApiProblemError) return this.i18n.t(participantErrorKey(error.status, error.problem.code));
    return this.i18n.t(fallback);
  }

  private clearMessages(): void { this.actionError.set(''); this.status.set(''); }
  private announce(message: string): void {
    this.status.set(message);
    queueMicrotask(() => this.statusMessage?.nativeElement.focus());
  }
  private pageFromRoute(): number {
    const page = Number(this.route.snapshot.queryParamMap.get('page') ?? 1);
    return Number.isInteger(page) && page > 0 ? page : 1;
  }
}
