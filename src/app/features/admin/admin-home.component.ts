import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { dataAuthority } from '../../config/data-authority';
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="admin-home" aria-labelledby="admin-title">
      <header class="page-heading" data-cy="admin-home-heading"><div data-cy="admin-home-heading-text"><p class="kicker" data-cy="admin-home-kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="admin-title" data-cy="admin-home-title">{{ i18n.t('admin.title') }}</h1></div></header>
      @if (!enabled) {
        <p class="error" role="alert" data-cy="admin-home-disabled">{{ i18n.t('admin.disabled') }}</p>
      } @else {
        <nav class="home-destinations admin-destinations" data-cy="admin-home-nav" [attr.aria-label]="i18n.t('admin.navAria')">
          <a class="home-destination home-destination--settings" routerLink="/admin/users" data-cy="admin-card-users">
            <strong data-cy="admin-card-users-title">{{ i18n.t('admin.users') }}</strong>
            <p data-cy="admin-card-users-desc">{{ i18n.t('admin.usersDesc') }}</p>
          </a>
          <a class="home-destination home-destination--settings" routerLink="/admin/organizations" data-cy="admin-card-organizations">
            <strong data-cy="admin-card-organizations-title">{{ i18n.t('admin.organizations') }}</strong>
            <p data-cy="admin-card-organizations-desc">{{ i18n.t('admin.organizationsDesc') }}</p>
          </a>
          <a class="home-destination home-destination--settings" routerLink="/admin/audit" data-cy="admin-card-audit">
            <strong data-cy="admin-card-audit-title">{{ i18n.t('admin.audit') }}</strong>
            <p data-cy="admin-card-audit-desc">{{ i18n.t('admin.auditDesc') }}</p>
          </a>
          <a class="home-destination home-destination--settings" routerLink="/admin/notifications/history" data-cy="admin-card-notification-history">
            <strong data-cy="admin-card-notification-history-title">{{ i18n.t('admin.notificationHistory') }}</strong>
            <p data-cy="admin-card-notification-history-desc">{{ i18n.t('admin.notificationHistoryDesc') }}</p>
          </a>
          <a class="home-destination home-destination--settings" routerLink="/admin/notifications/dead-letters" data-cy="admin-card-notification-dead-letters">
            <strong data-cy="admin-card-notification-dead-letters-title">{{ i18n.t('admin.notificationDeadLetters') }}</strong>
            <p data-cy="admin-card-notification-dead-letters-desc">{{ i18n.t('admin.notificationDeadLettersDesc') }}</p>
          </a>
          <a class="home-destination home-destination--settings" routerLink="/admin/events/deleted" data-cy="admin-card-deleted-events">
            <strong data-cy="admin-card-deleted-events-title">{{ i18n.t('eventManage.deletedTitle') }}</strong>
            <p data-cy="admin-card-deleted-events-desc">{{ i18n.t('admin.deletedEventsDesc') }}</p>
          </a>
        </nav>
      }
    </section>
  `
})
export class AdminHomeComponent {
  readonly i18n = inject(I18nService);
  readonly enabled = dataAuthority().adminV1;
}
