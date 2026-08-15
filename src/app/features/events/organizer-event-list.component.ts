import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, EventManagementResponse, EventMutationResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { MessageKey } from '../../i18n/messages';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { canCancelEvent, canEditEvent } from './event-management';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatDialogModule],
  template: `
    <section class="tournament-management-page stack" data-cy="organizer-events" aria-labelledby="organizer-events-title">
      <header class="page-heading" data-cy="organizer-events-heading">
        <div data-cy="organizer-events-heading-text"><p class="kicker" data-cy="organizer-events-kicker">{{ i18n.t('eventCreate.kicker') }}</p><h1 id="organizer-events-title" data-cy="organizer-events-title">{{ i18n.t('eventManage.title') }}</h1></div>
        @if (power.enabled()) { <a mat-flat-button class="home-primary-action" routerLink="/events/new" data-cy="organizer-events-create">{{ i18n.t('eventManage.create') }}</a> }
      </header>
      <p class="muted" data-cy="organizer-events-scope-help">{{ i18n.t('eventManage.scopeHelp') }}</p>

      @if (loading()) { <p role="status" data-cy="event-management-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) {
        <div class="error stack" role="alert" data-cy="event-management-error"><span data-cy="event-management-error-text">{{ error() }}</span><button mat-stroked-button type="button" data-cy="event-management-retry" (click)="load()">{{ i18n.t('common.retry') }}</button></div>
      } @else if (!items().length) {
        <div class="panel stack tournament-management-empty" data-cy="event-management-empty"><h2 data-cy="event-management-empty-title">{{ i18n.t('eventManage.emptyTitle') }}</h2><p data-cy="event-management-empty-body">{{ i18n.t('eventManage.emptyBody') }}</p></div>
      } @else {
        <div class="tournament-management-list" role="list" data-cy="event-management-list">
          @for (event of items(); track event.id) {
            <mat-card class="panel tournament-management-row" role="listitem" [attr.data-cy]="'event-row-' + event.id">
              <mat-card-content class="stack" [attr.data-cy]="'event-row-content-' + event.id">
                <div class="tournament-management-row-grid" [attr.data-cy]="'event-row-grid-' + event.id">
                  <div [attr.data-cy]="'event-row-summary-' + event.id"><p class="kicker" [attr.data-cy]="'event-row-organization-' + event.id">{{ event.organizationName }}</p><h2 [attr.data-cy]="'event-row-title-' + event.id">{{ event.title }}</h2><p class="muted" [attr.data-cy]="'event-row-when-' + event.id">{{ event.venueStartDate }} · {{ event.venueStartTime.slice(0, 5) }} · {{ event.city }}</p></div>
                  <span [attr.data-cy]="'event-row-status-' + event.id" [class]="'calendar-status calendar-status--' + event.status.toLowerCase()">{{ event.status }}</span>
                  <div class="admin-actions tournament-management-actions" [attr.data-cy]="'event-row-actions-' + event.id">
                    <a mat-stroked-button [attr.data-cy]="'event-row-public-view-' + event.id" [routerLink]="['/events', event.slug]">{{ i18n.t('eventManage.publicView') }}</a>
                    <a mat-stroked-button data-cy="event-participants" [routerLink]="['/organizer/events', event.id, 'participants']">{{ i18n.t('registration.participants') }}</a>
                    @if (canEdit(event)) { <a mat-stroked-button data-cy="event-edit" [routerLink]="['/organizer/events', event.id, 'edit']">{{ i18n.t('common.edit') }}</a> }
                    @if (canCancel(event)) { <button mat-stroked-button type="button" data-cy="event-cancel" [disabled]="!!pendingId()" (click)="cancel(event)">{{ pendingId() === event.id ? i18n.t('eventManage.cancelling') : i18n.t('eventManage.cancel') }}</button> }
                    @if (canEdit(event)) { <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="event-delete" [disabled]="!!pendingId()" (click)="delete(event)">{{ pendingId() === event.id ? i18n.t('common.deleting') : i18n.t('common.delete') }}</button> }
                  </div>
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>
        <nav class="pager" data-cy="organizer-events-pager" [attr.aria-label]="i18n.t('event.pagesAria')"><button mat-stroked-button type="button" data-cy="organizer-events-page-previous" [disabled]="page() <= 1 || !!pendingId()" (click)="goPage(page() - 1)">{{ i18n.t('common.previous') }}</button><span data-cy="organizer-events-page">{{ page() }} / {{ pages() }}</span><button mat-stroked-button type="button" data-cy="organizer-events-page-next" [disabled]="page() >= pages() || !!pendingId()" (click)="goPage(page() + 1)">{{ i18n.t('common.next') }}</button></nav>
      }
      @if (status()) { <p role="status" data-cy="event-management-status">{{ status() }}</p> }
    </section>
  `
})
export class OrganizerEventListComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly power = inject(PowerUserSettingsService);
  readonly items = signal<EventManagementResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly status = signal('');
  readonly pendingId = signal('');
  readonly page = signal(1);
  readonly pageSize = 20;
  readonly totalCount = signal(0);
  readonly pages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));
  private readonly mutationKeys = new Map<string, string>();

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const page = Number(params.get('page') ?? 1);
      this.page.set(Number.isInteger(page) && page > 0 ? page : 1);
      void this.load();
    });
  }

  canEdit(event: EventManagementResponse): boolean { return this.power.enabled() && canEditEvent(event); }
  canCancel(event: EventManagementResponse): boolean { return this.power.enabled() && canCancelEvent(event); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.client.listOrganizerEvents(this.page(), this.pageSize));
      this.items.set(response.items);
      this.totalCount.set(response.totalCount);
    } catch {
      this.items.set([]);
      this.error.set(this.i18n.t('eventManage.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  goPage(page: number): void { void this.router.navigate([], { relativeTo: this.route, queryParams: { page } }); }

  async cancel(event: EventManagementResponse): Promise<void> {
    if (!this.power.enabled()) return;
    const confirmed = await this.confirm(
      'eventManage.cancelTitle',
      'eventManage.cancelBody',
      'eventManage.cancelConfirm',
      true
    );
    if (!confirmed) return;
    await this.mutate(event, 'cancel', () => firstValueFrom(this.client.cancelEvent(event.id, event.eTag, this.mutationKey('cancel', event.id))), response => {
      this.replaceMutation(event.id, response);
      this.status.set(this.i18n.t('eventManage.cancelled'));
    });
  }

  async delete(event: EventManagementResponse): Promise<void> {
    if (!this.power.enabled()) return;
    const confirmed = await this.confirm(
      'eventManage.deleteTitle',
      'eventManage.deleteBody',
      'eventManage.deleteConfirm',
      true
    );
    if (!confirmed) return;
    await this.mutate(event, 'delete', () => firstValueFrom(this.client.deleteEvent(event.id, event.eTag, this.mutationKey('delete', event.id), null)), () => {
      this.items.update(items => items.filter(item => item.id !== event.id));
      this.totalCount.update(count => Math.max(0, count - 1));
      this.status.set(this.i18n.t('eventManage.deleted'));
    });
  }

  private async confirm(title: MessageKey, message: MessageKey, confirmLabel: MessageKey, destructive: boolean): Promise<boolean> {
    return Boolean(await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: { title: this.i18n.t(title), message: this.i18n.t(message), confirmLabel: this.i18n.t(confirmLabel), destructive }
    }).afterClosed()));
  }

  private async mutate(
    event: EventManagementResponse,
    action: 'cancel' | 'delete',
    request: () => Promise<EventMutationResponse>,
    success: (response: EventMutationResponse) => void
  ): Promise<void> {
    if (this.pendingId()) return;
    this.pendingId.set(event.id);
    this.error.set('');
    this.status.set('');
    try {
      success(await request());
      this.mutationKeys.delete(`${action}:${event.id}`);
    } catch (error) {
      if (error instanceof ApiProblemError) this.mutationKeys.delete(`${action}:${event.id}`);
      this.error.set(error instanceof ApiProblemError && error.status === 412
        ? this.i18n.t('eventManage.staleList')
        : error instanceof ApiProblemError && (error.status === 403 || error.status === 404 || error.status === 409)
          ? this.i18n.t('eventManage.serverRejected')
          : this.i18n.t('eventManage.actionFailed'));
      if (error instanceof ApiProblemError && error.status === 412) await this.load();
    } finally {
      this.pendingId.set('');
    }
  }

  private mutationKey(action: 'cancel' | 'delete', id: string): string {
    const key = `${action}:${id}`;
    const existing = this.mutationKeys.get(key);
    if (existing) return existing;
    const created = globalThis.crypto.randomUUID();
    this.mutationKeys.set(key, created);
    return created;
  }

  private replaceMutation(id: string, response: EventMutationResponse): void {
    this.items.update(items => items.map(item => item.id === id
      ? { ...item, status: response.status, version: response.version, eTag: response.eTag }
      : item));
  }
}
