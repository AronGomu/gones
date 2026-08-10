import { Component, computed, effect, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { dataAuthority } from '../../config/data-authority';
import { ApiProblemError } from '../../api/api-boundary';
import { AdminDeckArchetypeResponse, Client, MyOrganizationResponse, OrganizationNotificationSettingsResponse, PlayerNameSummary } from '../../api/generated/gones-api';
import { AuthService } from '../../auth/auth.service';
import { leagueCommandError } from '../../data/league-archive-command-ux';
import { LocalLeagueArchiveBackend } from '../../backend/local-league-archive-backend.service';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { playerNameKey, samePlayerName } from '../../domain/rename-player';
import { trimPlayerName } from '../../domain/models';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError, logBoundaryInfo } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { archetypeKey, DeckArchetypeSettingsService, normalizeArchetypeName, parseArchetypeImportList } from '../../shared/deck-archetype-settings.service';
import { saveJsonFile } from '../../shared/save-json-file';
import { localPlayerNames, LocalPlayerSummary } from './local-player-names';
import { settingsCapabilities } from './settings-capabilities';

interface OwnedOrganizationSettings {
  organization: MyOrganizationResponse;
  settings: OrganizationNotificationSettingsResponse;
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatDialogModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatSelectModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="settings-back-button-top" />
    <section class="info-page settings-page" [attr.aria-label]="i18n.t('settings.pageAria')" data-cy="settings-page">
      <mat-card class="panel settings-panel" data-cy="settings-language-card">
        <mat-card-content data-cy="settings-language-card-content">
          <div class="settings-row" data-cy="settings-language-row">
            <div data-cy="settings-language-row-text">
              <h2 data-cy="settings-language-title">{{ i18n.t('settings.language') }}</h2>
              <p class="muted" data-cy="settings-language-help">{{ i18n.t('settings.languageHelp') }}</p>
            </div>
            <mat-form-field appearance="outline" class="settings-language-field" data-cy="settings-language-field">
              <mat-label data-cy="settings-language-field-label">{{ i18n.t('settings.language') }}</mat-label>
              <mat-select data-cy="settings-language-select" [ngModel]="language()" (ngModelChange)="setLanguage($event)">
                <mat-option value="en" data-cy="settings-language-option-en">{{ i18n.t('lang.englishNative') }}</mat-option>
                <mat-option value="fr" data-cy="settings-language-option-fr">{{ i18n.t('lang.frenchNative') }}</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <p class="settings-saved" role="status" data-cy="settings-language-status">{{ i18n.t('settings.currentLanguage', { label: languageLabel() }) }}</p>
        </mat-card-content>
      </mat-card>

      @if (authV1()) {
        <mat-card class="panel settings-panel" data-cy="settings-account-card">
          <mat-card-content data-cy="settings-account-card-content">
            <div class="settings-row" data-cy="settings-account-row">
              <div data-cy="settings-account-row-text">
                <h2 data-cy="settings-account-title">{{ i18n.t('settings.accountTitle') }}</h2>
              </div>
              @if (auth.profile()) {
                <a mat-stroked-button class="secondary-action" routerLink="/settings/account" data-cy="settings-account-link">{{ i18n.t('settings.accountOpen') }}</a>
              } @else {
                <div data-cy="settings-account-signed-out">
                  <p class="muted" data-cy="settings-account-prompt">{{ i18n.t('settings.accountSignInPrompt') }}</p>
                  <a mat-stroked-button class="secondary-action" routerLink="/login" [queryParams]="{ returnUrl: '/settings/account' }" data-cy="settings-account-login-link">{{ i18n.t('auth.signIn') }}</a>
                </div>
              }
            </div>
          </mat-card-content>
        </mat-card>
      }

      @if (capabilities().adminCatalog) {
        <mat-card class="panel settings-panel settings-archetype-panel-card" data-cy="settings-archetype-card">
          <mat-card-content data-cy="settings-archetype-card-content">
            <mat-expansion-panel class="settings-collapsible-panel settings-archetype-panel" data-cy="settings-archetype-panel" [expanded]="false">
              <mat-expansion-panel-header (click)="blurExpansionHeader($event)" data-cy="settings-archetype-panel-header">
                <mat-panel-title data-cy="settings-archetype-panel-title">{{ i18n.t('settings.deckArchetypes') }}</mat-panel-title>
                <mat-panel-description data-cy="settings-archetype-panel-description">{{ filteredServerArchetypes().length }} / {{ serverArchetypes().length }}</mat-panel-description>
              </mat-expansion-panel-header>

              <p class="muted settings-archetype-copy" data-cy="settings-archetype-copy">{{ i18n.t('settings.adminCatalogHelp') }}</p>

              <div class="settings-archetype-io" data-cy="settings-archetype-io">
                <button mat-stroked-button type="button" class="settings-add-archetype-button" data-cy="settings-import-archetypes-button" [disabled]="archetypeSaving() || archetypeImporting()" (click)="openArchetypeImportPicker()">{{ archetypeImporting() ? i18n.t('common.importing') : i18n.t('settings.importArchetypes') }}</button>
                <input #archetypeImportInput class="toolbar-import-input" data-cy="settings-import-archetypes-input" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" [disabled]="archetypeImporting()" (change)="importServerArchetypes($event)">
              </div>

              <form class="settings-archetype-add" (ngSubmit)="addServerArchetype()" data-cy="settings-add-archetype-form">
                <mat-form-field appearance="outline" class="settings-archetype-field" data-cy="settings-new-archetype-field">
                  <mat-label data-cy="settings-new-archetype-field-label">{{ i18n.t('settings.newArchetype') }}</mat-label>
                  <input matInput data-cy="settings-new-archetype-input" [ngModel]="newArchetype()" name="newArchetype" (ngModelChange)="newArchetype.set($event)">
                </mat-form-field>
                <button mat-stroked-button class="settings-add-archetype-button" type="submit" data-cy="settings-add-archetype-button" [disabled]="archetypeSaving() || !canAddNewServerArchetype()">{{ i18n.t('settings.addArchetype') }}</button>
              </form>

              <mat-form-field appearance="outline" class="settings-archetype-field settings-archetype-filter" data-cy="settings-archetype-filter-field">
                <mat-label data-cy="settings-archetype-filter-field-label">{{ i18n.t('settings.filterArchetypes') }}</mat-label>
                <input matInput data-cy="settings-archetype-filter" [ngModel]="archetypeFilter()" name="archetypeFilter" (ngModelChange)="archetypeFilter.set($event)" [attr.aria-label]="i18n.t('settings.filterArchetypes')">
              </mat-form-field>

              @if (filteredServerArchetypes().length) {
                <div class="settings-archetype-list" role="list" data-cy="settings-archetype-list" [attr.aria-label]="i18n.t('settings.deckArchetypes')">
                  @for (archetype of filteredServerArchetypes(); track archetype.id; let odd = $odd) {
                    <div
                      class="settings-archetype-item"
                      role="listitem"
                      data-cy="settings-archetype-row"
                      [class.settings-archetype-item--odd]="odd"
                      [class.settings-archetype-item--even]="!odd"
                      [class.settings-archetype-item--editing]="editingServerArchetype() === archetype.id"
                      [attr.data-archetype]="archetype.name"
                    >
                      @if (editingServerArchetype() === archetype.id) {
                        <mat-form-field appearance="outline" class="settings-archetype-field" subscriptSizing="dynamic" data-cy="settings-archetype-edit-field">
                          <mat-label data-cy="settings-archetype-edit-field-label">{{ i18n.t('settings.deckArchetype') }}</mat-label>
                          <input
                            matInput
                            data-cy="settings-archetype-input"
                            [ngModel]="serverEditValue(archetype)"
                            [name]="'archetype-' + archetype.id"
                            (ngModelChange)="setServerEditValue(archetype.id, $event)"
                          >
                        </mat-form-field>
                        <button
                          mat-stroked-button
                          type="button"
                          class="settings-archetype-row-action settings-archetype-save-button"
                          data-cy="settings-save-archetype-button"
                          (click)="saveServerArchetypeEdit(archetype)"
                          [disabled]="archetypeSaving() || !canSaveServerArchetypeEdit(archetype)"
                        >{{ i18n.t('common.save') }}</button>
                      } @else {
                        <span class="settings-archetype-name" data-cy="settings-archetype-name">
                          {{ archetype.name }}
                          @if (archetype.deletedAt) { <span class="muted" data-cy="settings-archetype-deleted">({{ i18n.t('settings.archetypeDeleted') }})</span> }
                        </span>
                        @if (!archetype.deletedAt) {
                          <button
                            mat-stroked-button
                            type="button"
                            class="settings-archetype-row-action success-ghost-action"
                            data-cy="settings-update-archetype-button"
                            (click)="startServerEdit(archetype)"
                            [disabled]="archetypeSaving()"
                          >{{ i18n.t('common.update') }}</button>
                        }
                      }
                      @if (archetype.deletedAt) {
                        <button
                          mat-stroked-button
                          type="button"
                          class="settings-archetype-row-action success-ghost-action"
                          data-cy="settings-restore-archetype-button"
                          (click)="restoreServerArchetype(archetype)"
                          [disabled]="archetypeSaving()"
                        >{{ i18n.t('admin.restore') }}</button>
                      } @else {
                        <button
                          mat-button
                          type="button"
                          class="destructive-menu-item"
                          data-cy="settings-remove-archetype-button"
                          (click)="removeServerArchetype(archetype)"
                          [disabled]="archetypeSaving()"
                        >{{ i18n.t('common.delete') }}</button>
                      }
                    </div>
                  }
                </div>
              } @else {
                <p class="empty" data-cy="settings-empty-archetypes">{{ i18n.t('settings.emptyArchetypes') }}</p>
              }
              @if (archetypeMessage()) { <p class="settings-saved" role="status" data-cy="settings-archetype-message">{{ archetypeMessage() }}</p> }
            </mat-expansion-panel>
          </mat-card-content>
        </mat-card>
      }

      @if (capabilities().localCatalog) {
        <mat-card class="panel settings-panel settings-archetype-panel-card" data-cy="settings-local-archetype-card">
          <mat-card-content data-cy="settings-local-archetype-card-content">
            <mat-expansion-panel class="settings-collapsible-panel settings-archetype-panel" data-cy="settings-local-archetype-panel" [expanded]="false">
              <mat-expansion-panel-header (click)="blurExpansionHeader($event)" data-cy="settings-local-archetype-panel-header">
                <mat-panel-title data-cy="settings-local-archetype-panel-title">{{ i18n.t('settings.deckArchetypes') }}</mat-panel-title>
                <mat-panel-description data-cy="settings-local-archetype-panel-description">{{ filteredArchetypes().length }} / {{ archetypes().length }}</mat-panel-description>
              </mat-expansion-panel-header>

              <p class="muted settings-archetype-copy" data-cy="settings-local-archetype-copy">{{ i18n.t('settings.localCatalogHelp') }}</p>

              <form class="settings-archetype-add" (ngSubmit)="addLocalArchetype()" data-cy="settings-add-local-archetype-form">
                <mat-form-field appearance="outline" class="settings-archetype-field" data-cy="settings-new-local-archetype-field">
                  <mat-label data-cy="settings-new-local-archetype-field-label">{{ i18n.t('settings.newArchetype') }}</mat-label>
                  <input matInput data-cy="settings-new-local-archetype-input" [ngModel]="newArchetype()" name="newLocalArchetype" (ngModelChange)="newArchetype.set($event)">
                </mat-form-field>
                <button mat-stroked-button class="settings-add-archetype-button" type="submit" data-cy="settings-add-local-archetype-button" [disabled]="!normalizeArchetypeName(newArchetype()) || archetypeSaving()">{{ i18n.t('settings.addArchetype') }}</button>
              </form>

              <mat-form-field appearance="outline" class="settings-archetype-field settings-archetype-filter" data-cy="settings-local-archetype-filter-field">
                <mat-label data-cy="settings-local-archetype-filter-field-label">{{ i18n.t('settings.filterArchetypes') }}</mat-label>
                <input matInput data-cy="settings-local-archetype-filter" [ngModel]="archetypeFilter()" name="localArchetypeFilter" (ngModelChange)="archetypeFilter.set($event)" [attr.aria-label]="i18n.t('settings.filterArchetypes')">
              </mat-form-field>

              @if (filteredArchetypes().length) {
                <div class="settings-archetype-list" role="list" data-cy="settings-local-archetype-list" [attr.aria-label]="i18n.t('settings.deckArchetypes')">
                  @for (archetype of filteredArchetypes(); track archetype; let odd = $odd) {
                    <div
                      class="settings-archetype-item"
                      role="listitem"
                      data-cy="settings-local-archetype-row"
                      [class.settings-archetype-item--odd]="odd"
                      [class.settings-archetype-item--even]="!odd"
                      [class.settings-archetype-item--editing]="editingArchetype() === archetype"
                      [attr.data-archetype]="archetype"
                    >
                      @if (editingArchetype() === archetype) {
                        <mat-form-field appearance="outline" class="settings-archetype-field" subscriptSizing="dynamic" data-cy="settings-local-archetype-edit-field">
                          <mat-label data-cy="settings-local-archetype-edit-field-label">{{ i18n.t('settings.deckArchetype') }}</mat-label>
                          <input
                            matInput
                            data-cy="settings-local-archetype-input"
                            [ngModel]="localEditValue(archetype)"
                            [name]="'local-archetype-' + archetype"
                            (ngModelChange)="setLocalEditValue(archetype, $event)"
                          >
                        </mat-form-field>
                        <button
                          mat-stroked-button
                          type="button"
                          class="settings-archetype-row-action settings-archetype-save-button"
                          data-cy="settings-save-local-archetype-button"
                          (click)="saveLocalArchetypeEdit(archetype)"
                          [disabled]="archetypeSaving() || !canSaveLocalArchetypeEdit(archetype)"
                        >{{ i18n.t('common.save') }}</button>
                      } @else {
                        <span class="settings-archetype-name" data-cy="settings-local-archetype-name">{{ archetype }}</span>
                        <button
                          mat-stroked-button
                          type="button"
                          class="settings-archetype-row-action success-ghost-action"
                          data-cy="settings-update-local-archetype-button"
                          (click)="startLocalEdit(archetype)"
                          [disabled]="archetypeSaving()"
                        >{{ i18n.t('common.update') }}</button>
                      }
                      <button
                        mat-button
                        type="button"
                        class="destructive-menu-item"
                        data-cy="settings-remove-local-archetype-button"
                        (click)="removeLocalArchetype(archetype)"
                        [disabled]="archetypeSaving()"
                      >{{ i18n.t('common.delete') }}</button>
                    </div>
                  }
                </div>
              } @else {
                <p class="empty" data-cy="settings-empty-local-archetypes">{{ i18n.t('settings.emptyArchetypes') }}</p>
              }
              @if (archetypeMessage()) { <p class="settings-saved" role="status" data-cy="settings-local-archetype-message">{{ archetypeMessage() }}</p> }
            </mat-expansion-panel>
          </mat-card-content>
        </mat-card>
      }

      @if (capabilities().organizerMaintenance) {
        <mat-card class="panel settings-panel settings-archetype-panel-card" data-cy="settings-players-card">
          <mat-card-content data-cy="settings-players-card-content">
            <mat-expansion-panel class="settings-collapsible-panel settings-archetype-panel" data-cy="settings-players-panel" [expanded]="false">
              <mat-expansion-panel-header (click)="blurExpansionHeader($event)" data-cy="settings-players-panel-header">
                <mat-panel-title data-cy="settings-players-panel-title">{{ i18n.t('settings.players') }}</mat-panel-title>
                <mat-panel-description data-cy="settings-players-panel-description">{{ filteredServerPlayers().length }} / {{ serverPlayers().length }}</mat-panel-description>
              </mat-expansion-panel-header>

              <p class="muted settings-archetype-copy" data-cy="settings-players-copy">{{ i18n.t('settings.maintenanceHelp') }}</p>

              <mat-form-field appearance="outline" class="settings-archetype-field settings-archetype-filter" data-cy="settings-player-filter-field">
                <mat-label data-cy="settings-player-filter-field-label">{{ i18n.t('settings.filterPlayers') }}</mat-label>
                <input matInput data-cy="settings-player-filter" [ngModel]="playerFilter()" name="playerFilter" (ngModelChange)="playerFilter.set($event)" [attr.aria-label]="i18n.t('settings.filterPlayers')">
              </mat-form-field>

              @if (filteredServerPlayers().length) {
                <div class="settings-archetype-list" role="list" data-cy="settings-player-list" [attr.aria-label]="i18n.t('settings.players')">
                  @for (player of filteredServerPlayers(); track player.name; let odd = $odd) {
                    <div
                      class="settings-archetype-item"
                      role="listitem"
                      data-cy="settings-player-row"
                      [class.settings-archetype-item--odd]="odd"
                      [class.settings-archetype-item--even]="!odd"
                      [class.settings-archetype-item--editing]="editingPlayer() === player.name"
                      [attr.data-player]="player.name"
                    >
                      @if (editingPlayer() === player.name) {
                        <mat-form-field appearance="outline" class="settings-archetype-field" subscriptSizing="dynamic" data-cy="settings-player-edit-field">
                          <mat-label data-cy="settings-player-edit-field-label">{{ i18n.t('settings.playerName') }}</mat-label>
                          <input
                            matInput
                            data-cy="settings-player-input"
                            [ngModel]="playerEditValue(player.name)"
                            [name]="'player-' + player.name"
                            (ngModelChange)="setPlayerEditValue(player.name, $event)"
                          >
                        </mat-form-field>
                        <button
                          mat-stroked-button
                          type="button"
                          class="settings-archetype-row-action settings-archetype-save-button"
                          data-cy="settings-save-player-button"
                          (click)="saveServerPlayerEdit(player)"
                          [disabled]="playerSaving() || !canSavePlayerEdit(player.name)"
                        >{{ i18n.t('common.save') }}</button>
                      } @else {
                        <span class="settings-archetype-name" data-cy="settings-player-name">{{ player.name }}</span>
                        <span class="muted" data-cy="settings-player-usage">{{ i18n.t('settings.playerUsage', { occurrences: player.occurrenceCount, leagues: player.leagueCount }) }}</span>
                        <button
                          mat-stroked-button
                          type="button"
                          class="settings-archetype-row-action success-ghost-action"
                          data-cy="settings-update-player-button"
                          (click)="startPlayerEdit(player.name)"
                          [disabled]="playerSaving()"
                        >{{ i18n.t('common.update') }}</button>
                      }
                    </div>
                  }
                </div>
              } @else if (serverPlayers().length) {
                <p class="empty" data-cy="settings-empty-player-filter">{{ i18n.t('settings.noPlayerFilterMatches') }}</p>
              } @else {
                <p class="empty" data-cy="settings-empty-players">{{ i18n.t('settings.emptyPlayers') }}</p>
              }
              @if (playerMessage()) { <p class="settings-saved" role="status" data-cy="settings-player-message">{{ playerMessage() }}</p> }
            </mat-expansion-panel>
          </mat-card-content>
        </mat-card>
      }

      @if (capabilities().localMaintenance) {
        <mat-card class="panel settings-panel settings-archetype-panel-card" data-cy="settings-local-players-card">
          <mat-card-content data-cy="settings-local-players-card-content">
            <mat-expansion-panel class="settings-collapsible-panel settings-archetype-panel" data-cy="settings-local-players-panel" [expanded]="false">
              <mat-expansion-panel-header (click)="blurExpansionHeader($event)" data-cy="settings-local-players-panel-header">
                <mat-panel-title data-cy="settings-local-players-panel-title">{{ i18n.t('settings.players') }}</mat-panel-title>
                <mat-panel-description data-cy="settings-local-players-panel-description">{{ filteredLocalPlayers().length }} / {{ localPlayers().length }}</mat-panel-description>
              </mat-expansion-panel-header>

              <p class="muted settings-archetype-copy" data-cy="settings-local-players-copy">{{ i18n.t('settings.localMaintenanceHelp') }}</p>

              <mat-form-field appearance="outline" class="settings-archetype-field settings-archetype-filter" data-cy="settings-local-player-filter-field">
                <mat-label data-cy="settings-local-player-filter-field-label">{{ i18n.t('settings.filterPlayers') }}</mat-label>
                <input matInput data-cy="settings-local-player-filter" [ngModel]="playerFilter()" name="localPlayerFilter" (ngModelChange)="playerFilter.set($event)" [attr.aria-label]="i18n.t('settings.filterPlayers')">
              </mat-form-field>

              @if (filteredLocalPlayers().length) {
                <div class="settings-archetype-list" role="list" data-cy="settings-local-player-list" [attr.aria-label]="i18n.t('settings.players')">
                  @for (player of filteredLocalPlayers(); track player.name; let odd = $odd) {
                    <div
                      class="settings-archetype-item"
                      role="listitem"
                      data-cy="settings-local-player-row"
                      [class.settings-archetype-item--odd]="odd"
                      [class.settings-archetype-item--even]="!odd"
                      [class.settings-archetype-item--editing]="editingPlayer() === player.name"
                      [attr.data-player]="player.name"
                    >
                      @if (editingPlayer() === player.name) {
                        <mat-form-field appearance="outline" class="settings-archetype-field" subscriptSizing="dynamic" data-cy="settings-local-player-edit-field">
                          <mat-label data-cy="settings-local-player-edit-field-label">{{ i18n.t('settings.playerName') }}</mat-label>
                          <input
                            matInput
                            data-cy="settings-local-player-input"
                            [ngModel]="playerEditValue(player.name)"
                            [name]="'local-player-' + player.name"
                            (ngModelChange)="setPlayerEditValue(player.name, $event)"
                          >
                        </mat-form-field>
                        <button
                          mat-stroked-button
                          type="button"
                          class="settings-archetype-row-action settings-archetype-save-button"
                          data-cy="settings-save-local-player-button"
                          (click)="saveLocalPlayerEdit(player)"
                          [disabled]="playerSaving() || !canSavePlayerEdit(player.name)"
                        >{{ i18n.t('common.save') }}</button>
                      } @else {
                        <span class="settings-archetype-name" data-cy="settings-local-player-name">{{ player.name }}</span>
                        <span class="muted" data-cy="settings-local-player-usage">{{ i18n.t('settings.playerUsage', { occurrences: player.occurrenceCount, leagues: player.leagueCount }) }}</span>
                        <button
                          mat-stroked-button
                          type="button"
                          class="settings-archetype-row-action success-ghost-action"
                          data-cy="settings-update-local-player-button"
                          (click)="startPlayerEdit(player.name)"
                          [disabled]="playerSaving()"
                        >{{ i18n.t('common.update') }}</button>
                      }
                    </div>
                  }
                </div>
              } @else if (localPlayers().length) {
                <p class="empty" data-cy="settings-empty-local-player-filter">{{ i18n.t('settings.noPlayerFilterMatches') }}</p>
              } @else {
                <p class="empty" data-cy="settings-empty-local-players">{{ i18n.t('settings.emptyPlayers') }}</p>
              }
              @if (playerMessage()) { <p class="settings-saved" role="status" data-cy="settings-local-player-message">{{ playerMessage() }}</p> }
            </mat-expansion-panel>
          </mat-card-content>
        </mat-card>
      }

      @if (capabilities().orgNotifications && ownedOrganizations().length) {
        <mat-card class="panel settings-panel" data-cy="settings-org-card">
          <mat-card-content data-cy="settings-org-card-content">
            <h2 data-cy="settings-org-title">{{ i18n.t('settings.orgNotifications') }}</h2>
            <p class="muted" data-cy="settings-org-help">{{ i18n.t('settings.orgNotificationsHelp') }}</p>
            @for (owned of ownedOrganizations(); track owned.organization.id) {
              <form class="auth-form" data-cy="settings-org-row" [attr.data-org]="owned.organization.name" (ngSubmit)="saveOrganizationSettings(owned)">
                <h3 data-cy="settings-org-name">{{ owned.organization.name }}</h3>
                <label data-cy="settings-org-notify-registration-label"><input type="checkbox" data-cy="settings-org-notify-registration" [name]="'reg-' + owned.organization.id" [(ngModel)]="owned.settings.notifyOnRegistration" /> {{ i18n.t('org.notifyRegistration') }}</label>
                <label data-cy="settings-org-notify-unregistration-label"><input type="checkbox" data-cy="settings-org-notify-unregistration" [name]="'unreg-' + owned.organization.id" [(ngModel)]="owned.settings.notifyOnUnregistration" /> {{ i18n.t('org.notifyUnregistration') }}</label>
                <button mat-flat-button type="submit" data-cy="settings-org-save" [disabled]="orgSaving()">{{ i18n.t('common.save') }}</button>
              </form>
            }
            @if (orgMessage()) { <p class="settings-saved" role="status" data-cy="settings-org-status">{{ orgMessage() }}</p> }
          </mat-card-content>
        </mat-card>
      }

    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" data-cy="settings-back-button-bottom" />
  `
})
export class SettingsComponent {
  readonly i18n = inject(I18nService);
  private readonly deckArchetypes = inject(DeckArchetypeSettingsService);
  readonly leagueRepo = inject(LeagueArchiveRepository);
  readonly auth = inject(AuthService);
  private readonly liveRepo = inject(LiveTournamentRepository);
  private readonly localBackend = inject(LocalLeagueArchiveBackend);
  private readonly client = inject(Client);
  private readonly dialog = inject(MatDialog);
  readonly language = this.deckArchetypes.language;
  /** Exposed for the local add form, which enables itself on the normalized name. */
  readonly normalizeArchetypeName = normalizeArchetypeName;
  private readonly archetypeImportInput = viewChild<ElementRef<HTMLInputElement>>('archetypeImportInput');
  readonly authV1 = computed(() => dataAuthority().authV1);
  readonly capabilities = computed(() => settingsCapabilities({
    authV1: dataAuthority().authV1,
    adminV1: dataAuthority().adminV1
  }, this.auth.profile()?.globalRole ?? null));

  readonly newArchetype = signal('');
  readonly archetypeFilter = signal('');
  readonly archetypeMessage = signal('');
  readonly archetypeSaving = signal(false);
  readonly archetypeImporting = signal(false);
  readonly editingArchetype = signal<string | null>(null);
  readonly archetypeEdits = signal<Record<string, string>>({});
  readonly archetypes = this.deckArchetypes.archetypes;
  readonly filteredArchetypes = computed(() => {
    const filter = archetypeKey(this.archetypeFilter());
    const list = this.archetypes();
    if (!filter) return list;
    return list.filter((archetype) => archetypeKey(archetype).includes(filter));
  });

  readonly serverArchetypes = signal<AdminDeckArchetypeResponse[]>([]);
  readonly editingServerArchetype = signal<string | null>(null);
  readonly serverArchetypeEdits = signal<Record<string, string>>({});
  readonly filteredServerArchetypes = computed(() => {
    const filter = archetypeKey(this.archetypeFilter());
    const list = this.serverArchetypes();
    if (!filter) return list;
    return list.filter((archetype) => archetypeKey(archetype.name).includes(filter));
  });

  readonly playerFilter = signal('');
  readonly playerMessage = signal('');
  readonly playerSaving = signal(false);
  readonly editingPlayer = signal<string | null>(null);
  readonly playerEdits = signal<Record<string, string>>({});
  readonly serverPlayers = signal<PlayerNameSummary[]>([]);
  readonly filteredServerPlayers = computed(() => {
    const filter = playerNameKey(this.playerFilter());
    const list = this.serverPlayers();
    if (!filter) return list;
    return list.filter((player) => playerNameKey(player.name).includes(filter));
  });

  readonly localPlayers = signal<LocalPlayerSummary[]>([]);
  readonly filteredLocalPlayers = computed(() => {
    const filter = playerNameKey(this.playerFilter());
    const list = this.localPlayers();
    if (!filter) return list;
    return list.filter((player) => playerNameKey(player.name).includes(filter));
  });

  readonly ownedOrganizations = signal<OwnedOrganizationSettings[]>([]);
  readonly orgSaving = signal(false);
  readonly orgMessage = signal('');


  private serverCatalogLoaded = false;
  private serverPlayersLoaded = false;
  private localPlayersLoaded = false;
  private ownedOrganizationsLoaded = false;

  constructor() {
    // Ensure baseline presets land even if this tab kept an old empty service state.
    this.deckArchetypes.bootstrapFromStorage();
    effect(() => {
      const capabilities = this.capabilities();
      if (capabilities.adminCatalog && !this.serverCatalogLoaded) {
        this.serverCatalogLoaded = true;
        void this.loadServerArchetypes();
      }
      if (capabilities.organizerMaintenance && !this.serverPlayersLoaded) {
        this.serverPlayersLoaded = true;
        void this.loadServerPlayers();
      }
      if (capabilities.localMaintenance && !this.localPlayersLoaded) {
        this.localPlayersLoaded = true;
        void this.loadLocalPlayers();
      }
      if (capabilities.orgNotifications && !this.ownedOrganizationsLoaded) {
        this.ownedOrganizationsLoaded = true;
        void this.loadOwnedOrganizations();
      }
    });
  }

  async setLanguage(value: string): Promise<void> {
    await this.deckArchetypes.setLanguage(value);
  }

  languageLabel(): string {
    return this.i18n.languageLabel();
  }

  /** Drop focus after pointer toggle so hover style does not stick. Keyboard focus kept. */
  blurExpansionHeader(event: Event): void {
    // detail === 0 is typically keyboard-synthesized click — keep focus for a11y.
    if (event instanceof MouseEvent && event.detail === 0) return;
    if (!(event instanceof MouseEvent) && !(event instanceof PointerEvent)) return;
    const header = event.currentTarget;
    if (!(header instanceof HTMLElement)) return;
    queueMicrotask(() => header.blur());
  }

  canAddNewArchetype(): boolean {
    const archetype = normalizeArchetypeName(this.newArchetype());
    return !!archetype && !this.deckArchetypes.has(archetype);
  }

  exportArchetypes(): void {
    const deckArchetypes = [...this.archetypes()];
    try {
      saveJsonFile({ deckArchetypes }, `gones-deck-archetypes-${new Date().toISOString().slice(0, 10)}.json`);
      this.archetypeMessage.set(this.i18n.t('settings.archetypesExported', {
        count: deckArchetypes.length,
        plural: deckArchetypes.length === 1 ? '' : 's'
      }));
      logBoundaryInfo('settings.exportArchetypes', { count: deckArchetypes.length });
    } catch (error) {
      logBoundaryError('settings.exportArchetypes', error, { count: deckArchetypes.length });
      this.archetypeMessage.set(this.i18n.t('settings.archetypesExportFailed'));
    }
  }

  openArchetypeImportPicker(): void {
    if (this.archetypeImporting()) return;
    this.archetypeImportInput()?.nativeElement.click();
  }

  async importArchetypes(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.archetypeImporting()) return;

    this.archetypeImporting.set(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        this.archetypeMessage.set(this.i18n.t('settings.archetypesImportBadJson'));
        return;
      }

      const result = await this.deckArchetypes.mergeArchetypes(parsed);
      if (!result) {
        this.archetypeMessage.set(this.i18n.t('settings.archetypesImportInvalid'));
        return;
      }

      const plural = result.added === 1 ? '' : 's';
      const pluralSkip = result.skipped === 1 ? '' : 's';
      this.archetypeMessage.set(
        result.added > 0
          ? this.i18n.t('settings.archetypesImported', { added: result.added, skipped: result.skipped, plural, pluralSkip })
          : this.i18n.t('settings.archetypesImportedNone', { skipped: result.skipped, pluralSkip })
      );
      logBoundaryInfo('settings.importArchetypes', { fileName: file.name, ...result });
    } catch (error) {
      logBoundaryError('settings.importArchetypes', error, { fileName: file.name });
      this.archetypeMessage.set(this.i18n.t('settings.archetypesImportFailed'));
    } finally {
      this.archetypeImporting.set(false);
      input.value = '';
    }
  }

  async addLocalArchetype(): Promise<void> {
    if (this.archetypeSaving()) return;
    const archetype = normalizeArchetypeName(this.newArchetype());
    this.archetypeSaving.set(true);
    try {
      if (!await this.deckArchetypes.add(archetype)) {
        this.archetypeMessage.set(archetype ? this.i18n.t('settings.archetypeExists', { name: archetype }) : this.i18n.t('settings.archetypeEnterName'));
        return;
      }
      this.newArchetype.set('');
      this.archetypeMessage.set(this.i18n.t('settings.archetypeAdded', { name: archetype }));
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  startLocalEdit(archetype: string): void {
    const previous = this.editingArchetype();
    if (previous && previous !== archetype) this.clearEditState(previous);
    this.editingArchetype.set(archetype);
    this.archetypeEdits.update((edits) => ({ ...edits, [archetype]: archetype }));
    this.archetypeMessage.set('');
  }

  cancelEdit(): void {
    const editing = this.editingArchetype();
    if (!editing) return;
    this.clearEditState(editing);
  }

  localEditValue(archetype: string): string {
    return this.archetypeEdits()[archetype] ?? archetype;
  }

  setLocalEditValue(archetype: string, value: string): void {
    this.archetypeEdits.update((edits) => ({ ...edits, [archetype]: value }));
    this.archetypeMessage.set('');
  }

  canSaveLocalArchetypeEdit(archetype: string): boolean {
    const next = normalizeArchetypeName(this.localEditValue(archetype));
    return !!next && next !== archetype && (!this.deckArchetypes.has(next) || next.toLocaleLowerCase() === archetype.toLocaleLowerCase());
  }

  async saveLocalArchetypeEdit(archetype: string): Promise<void> {
    if (this.archetypeSaving()) return;
    const next = normalizeArchetypeName(this.localEditValue(archetype));
    if (!next || next === archetype) {
      this.clearEditState(archetype);
      return;
    }
    this.archetypeSaving.set(true);
    try {
      if (!await this.deckArchetypes.update(archetype, next)) {
        this.archetypeMessage.set(this.i18n.t('settings.archetypeExists', { name: next }));
        return;
      }
      this.clearEditState(archetype);
      this.archetypeMessage.set(this.i18n.t('settings.archetypeUpdated', { from: archetype, to: next }));
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  async removeLocalArchetype(archetype: string): Promise<void> {
    if (this.archetypeSaving()) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.i18n.t('settings.removeArchetypeTitle', { name: archetype }),
        message: this.i18n.t('settings.removeArchetypeMessage'),
        confirmLabel: this.i18n.t('common.delete'),
        destructive: true
      }
    }).afterClosed());
    if (!confirmed) return;
    this.archetypeSaving.set(true);
    try {
      await this.deckArchetypes.remove(archetype);
      if (this.editingArchetype() === archetype) this.clearEditState(archetype);
      this.archetypeMessage.set(this.i18n.t('settings.archetypeRemoved', { name: archetype }));
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  async loadServerArchetypes(): Promise<void> {
    try {
      this.serverArchetypes.set(await firstValueFrom(this.client.listAdminDeckArchetypes()));
    } catch (error) {
      logBoundaryError('settings.loadServerArchetypes', error);
      this.archetypeMessage.set(this.i18n.t('settings.loadFailed'));
    }
  }

  canAddNewServerArchetype(): boolean {
    const archetype = normalizeArchetypeName(this.newArchetype());
    return !!archetype && !this.serverArchetypes().some((item) => archetypeKey(item.name) === archetypeKey(archetype));
  }

  async addServerArchetype(): Promise<void> {
    if (this.archetypeSaving()) return;
    const archetype = normalizeArchetypeName(this.newArchetype());
    if (!archetype) {
      this.archetypeMessage.set(this.i18n.t('settings.archetypeEnterName'));
      return;
    }
    this.archetypeSaving.set(true);
    try {
      await firstValueFrom(this.client.createDeckArchetype({ name: archetype }));
      this.newArchetype.set('');
      await this.loadServerArchetypes();
      this.archetypeMessage.set(this.i18n.t('settings.archetypeAdded', { name: archetype }));
    } catch (error) {
      logBoundaryError('settings.addServerArchetype', error, { name: archetype });
      this.archetypeMessage.set(error instanceof ApiProblemError && error.status === 409
        ? this.i18n.t('settings.archetypeExists', { name: archetype })
        : this.i18n.t('settings.archetypeSaveFailed'));
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  startServerEdit(archetype: AdminDeckArchetypeResponse): void {
    const previous = this.editingServerArchetype();
    if (previous && previous !== archetype.id) this.clearServerEditState(previous);
    this.editingServerArchetype.set(archetype.id);
    this.serverArchetypeEdits.update((edits) => ({ ...edits, [archetype.id]: archetype.name }));
    this.archetypeMessage.set('');
  }

  cancelServerEdit(): void {
    const editing = this.editingServerArchetype();
    if (!editing) return;
    this.clearServerEditState(editing);
  }

  serverEditValue(archetype: AdminDeckArchetypeResponse): string {
    return this.serverArchetypeEdits()[archetype.id] ?? archetype.name;
  }

  setServerEditValue(archetypeId: string, value: string): void {
    this.serverArchetypeEdits.update((edits) => ({ ...edits, [archetypeId]: value }));
    this.archetypeMessage.set('');
  }

  canSaveServerArchetypeEdit(archetype: AdminDeckArchetypeResponse): boolean {
    const next = normalizeArchetypeName(this.serverEditValue(archetype));
    if (!next || next === archetype.name) return false;
    return !this.serverArchetypes().some((item) => item.id !== archetype.id && archetypeKey(item.name) === archetypeKey(next));
  }

  async saveServerArchetypeEdit(archetype: AdminDeckArchetypeResponse): Promise<void> {
    if (this.archetypeSaving()) return;
    const next = normalizeArchetypeName(this.serverEditValue(archetype));
    if (!next || next === archetype.name) {
      this.clearServerEditState(archetype.id);
      return;
    }
    this.archetypeSaving.set(true);
    try {
      await firstValueFrom(this.client.renameDeckArchetype(archetype.id, { name: next }));
      this.clearServerEditState(archetype.id);
      await this.loadServerArchetypes();
      this.archetypeMessage.set(this.i18n.t('settings.archetypeUpdated', { from: archetype.name, to: next }));
    } catch (error) {
      logBoundaryError('settings.saveServerArchetypeEdit', error, { from: archetype.name, to: next });
      this.archetypeMessage.set(this.i18n.t('settings.archetypeSaveFailed'));
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  async removeServerArchetype(archetype: AdminDeckArchetypeResponse): Promise<void> {
    if (this.archetypeSaving()) return;
    this.archetypeSaving.set(true);
    try {
      await firstValueFrom(this.client.deleteDeckArchetype(archetype.id));
      if (this.editingServerArchetype() === archetype.id) this.clearServerEditState(archetype.id);
      await this.loadServerArchetypes();
      this.archetypeMessage.set(this.i18n.t('settings.archetypeRemoved', { name: archetype.name }));
    } catch (error) {
      logBoundaryError('settings.removeServerArchetype', error, { name: archetype.name });
      this.archetypeMessage.set(this.i18n.t('settings.archetypeSaveFailed'));
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  async restoreServerArchetype(archetype: AdminDeckArchetypeResponse): Promise<void> {
    if (this.archetypeSaving()) return;
    this.archetypeSaving.set(true);
    try {
      await firstValueFrom(this.client.restoreDeckArchetype(archetype.id));
      await this.loadServerArchetypes();
      this.archetypeMessage.set(this.i18n.t('settings.archetypeRestored', { name: archetype.name }));
    } catch (error) {
      logBoundaryError('settings.restoreServerArchetype', error, { name: archetype.name });
      this.archetypeMessage.set(this.i18n.t('settings.archetypeSaveFailed'));
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  async importServerArchetypes(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.archetypeImporting()) return;

    this.archetypeImporting.set(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        this.archetypeMessage.set(this.i18n.t('settings.archetypesImportBadJson'));
        return;
      }

      const names = parseArchetypeImportList(parsed);
      if (!names || !names.length) {
        this.archetypeMessage.set(this.i18n.t('settings.archetypesImportInvalid'));
        return;
      }

      const result = await firstValueFrom(this.client.importDeckArchetypes({ names }));
      await this.loadServerArchetypes();
      this.archetypeMessage.set(this.i18n.t('settings.archetypesImportedServer', {
        added: result.added,
        restored: result.restored,
        skipped: result.skipped
      }));
      logBoundaryInfo('settings.importServerArchetypes', { fileName: file.name, added: result.added, restored: result.restored, skipped: result.skipped });
    } catch (error) {
      logBoundaryError('settings.importServerArchetypes', error, { fileName: file.name });
      this.archetypeMessage.set(this.i18n.t('settings.archetypesImportFailed'));
    } finally {
      this.archetypeImporting.set(false);
      input.value = '';
    }
  }

  async loadServerPlayers(): Promise<void> {
    try {
      const response = await firstValueFrom(this.client.listMaintenancePlayerNames(undefined));
      this.serverPlayers.set(response.items);
    } catch (error) {
      logBoundaryError('settings.loadServerPlayers', error);
      this.playerMessage.set(this.i18n.t('settings.loadFailed'));
    }
  }

  startPlayerEdit(player: string): void {
    const previous = this.editingPlayer();
    if (previous && previous !== player) this.clearPlayerEditState(previous);
    if (this.editingArchetype()) this.cancelEdit();
    if (this.editingServerArchetype()) this.cancelServerEdit();
    this.editingPlayer.set(player);
    this.playerEdits.update((edits) => ({ ...edits, [player]: player }));
    this.playerMessage.set('');
  }

  cancelPlayerEdit(): void {
    const editing = this.editingPlayer();
    if (!editing) return;
    this.clearPlayerEditState(editing);
  }

  playerEditValue(player: string): string {
    return this.playerEdits()[player] ?? player;
  }

  setPlayerEditValue(player: string, value: string): void {
    this.playerEdits.update((edits) => ({ ...edits, [player]: value }));
    this.playerMessage.set('');
  }

  canSavePlayerEdit(player: string): boolean {
    const next = trimPlayerName(this.playerEditValue(player));
    return !!next && next !== player;
  }

  /** Server rename: exact case-sensitive source, preview affected count before commit. */
  async saveServerPlayerEdit(player: PlayerNameSummary): Promise<void> {
    if (this.playerSaving()) return;
    const next = trimPlayerName(this.playerEditValue(player.name));
    if (!next) {
      this.playerMessage.set(this.i18n.t('settings.playerEnterName'));
      return;
    }
    if (next === player.name) {
      this.clearPlayerEditState(player.name);
      return;
    }

    this.playerSaving.set(true);
    try {
      const preview = await firstValueFrom(this.client.previewMaintenancePlayerRename({ fromName: player.name, toName: next }));
      this.playerSaving.set(false);
      const merge = preview.mergesWithExistingPlayer;
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: merge ? this.i18n.t('settings.mergePlayerTitle') : this.i18n.t('settings.renamePlayerTitle'),
          message: merge
            ? this.i18n.t('settings.mergePreviewMessage', { from: player.name, to: next, count: preview.affectedOccurrenceCount, leagues: preview.affectedLeagueCount })
            : this.i18n.t('settings.renamePreviewMessage', { from: player.name, to: next, count: preview.affectedOccurrenceCount, leagues: preview.affectedLeagueCount }),
          confirmLabel: merge ? this.i18n.t('settings.mergePlayerTitle') : this.i18n.t('settings.renamePlayerTitle'),
          destructive: merge
        }
      }).afterClosed());
      if (!confirmed) return;

      this.playerSaving.set(true);
      await firstValueFrom(this.client.commitMaintenancePlayerRename({ fromName: player.name, toName: next }));
      this.clearPlayerEditState(player.name);
      await this.loadServerPlayers();
      this.playerMessage.set(merge
        ? this.i18n.t('settings.playerMerged', { from: player.name, to: next })
        : this.i18n.t('settings.playerRenamed', { from: player.name, to: next }));
    } catch (error) {
      logBoundaryError('settings.renameServerPlayer', error, { from: player.name, to: next });
      this.playerMessage.set(leagueCommandError(error) === 'forbidden' ? this.i18n.t('leagues.forbidden') : this.i18n.t('settings.playerRenameFailed'));
    } finally {
      this.playerSaving.set(false);
    }
  }

  /** Derived from the browser League store (ADR 0032) — there is no local player table to read. */
  async loadLocalPlayers(preserveMessage = false): Promise<void> {
    try {
      this.localPlayers.set(localPlayerNames(await this.localBackend.listLeagueArchives()));
    } catch (error) {
      logBoundaryError('settings.loadLocalPlayers', error);
      if (!preserveMessage) this.playerMessage.set(this.i18n.t('settings.loadFailed'));
    }
  }

  /**
   * Rename the player in every browser-local league that names them, one guarded command per
   * league, carrying each returned `documentVersion` forward. Nothing leaves the browser.
   */
  async saveLocalPlayerEdit(player: LocalPlayerSummary): Promise<void> {
    if (this.playerSaving()) return;
    const next = trimPlayerName(this.playerEditValue(player.name));
    if (!next) {
      this.playerMessage.set(this.i18n.t('settings.playerEnterName'));
      return;
    }
    if (next === player.name) {
      this.clearPlayerEditState(player.name);
      return;
    }

    this.playerSaving.set(true);
    let partialRename = false;
    try {
      for (const league of await this.localBackend.listLeagueArchives()) {
        if (!localPlayerNames([league]).some((item) => samePlayerName(item.name, player.name))) continue;
        // One guarded command per league. The returned document carries the next expected version,
        // and each league is written exactly once, so no stale version can be replayed.
        await this.localBackend.renameLeagueArchivePlayerName(league.id, league.documentVersion, player.name, next);
      }
      this.clearPlayerEditState(player.name);
      this.playerMessage.set(this.i18n.t('settings.playerRenamed', { from: player.name, to: next }));
    } catch (error) {
      logBoundaryError('settings.renameLocalPlayer', error, { from: player.name, to: next });
      partialRename = true;
      this.playerMessage.set(this.i18n.t('settings.localPlayerRenamePartial'));
    } finally {
      await this.loadLocalPlayers(partialRename);
      this.playerSaving.set(false);
    }
  }

  async loadOwnedOrganizations(): Promise<void> {
    try {
      const organizations = await firstValueFrom(this.client.organizationsAll());
      const owned = organizations.filter((organization) => organization.role === 'Owner');
      const withSettings: OwnedOrganizationSettings[] = [];
      for (const organization of owned) {
        try {
          withSettings.push({ organization, settings: await firstValueFrom(this.client.notificationSettingsGET(organization.id)) });
        } catch (error) {
          logBoundaryError('settings.loadOrganizationSettings', error, { organizationId: organization.id });
        }
      }
      this.ownedOrganizations.set(withSettings);
    } catch (error) {
      logBoundaryError('settings.loadOwnedOrganizations', error);
      this.ownedOrganizations.set([]);
    }
  }

  async saveOrganizationSettings(owned: OwnedOrganizationSettings): Promise<void> {
    if (this.orgSaving()) return;
    this.orgSaving.set(true);
    try {
      const updated = await firstValueFrom(this.client.notificationSettingsPUT(owned.organization.id, {
        notifyOnRegistration: owned.settings.notifyOnRegistration,
        notifyOnUnregistration: owned.settings.notifyOnUnregistration
      }));
      owned.settings.notifyOnRegistration = updated.notifyOnRegistration;
      owned.settings.notifyOnUnregistration = updated.notifyOnUnregistration;
      this.orgMessage.set(this.i18n.t('settings.orgSaved', { name: owned.organization.name }));
    } catch (error) {
      logBoundaryError('settings.saveOrganizationSettings', error, { organizationId: owned.organization.id });
      this.orgMessage.set(this.i18n.t('settings.orgSaveFailed', { name: owned.organization.name }));
    } finally {
      this.orgSaving.set(false);
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (this.editingArchetype() || this.editingServerArchetype()) {
      if (
        !target.closest('.settings-archetype-item--editing .settings-archetype-field')
        && !target.closest('.settings-archetype-item--editing [data-cy="settings-save-archetype-button"]')
        && !target.closest('.settings-archetype-item--editing [data-cy="settings-remove-archetype-button"]')
        && !target.closest('.settings-archetype-item--editing [data-cy="settings-save-local-archetype-button"]')
        && !target.closest('.settings-archetype-item--editing [data-cy="settings-remove-local-archetype-button"]')
      ) {
        this.cancelEdit();
        this.cancelServerEdit();
      }
    }

    if (this.editingPlayer()) {
      if (
        !target.closest('[data-cy="settings-player-row"].settings-archetype-item--editing .settings-archetype-field')
        && !target.closest('[data-cy="settings-player-row"].settings-archetype-item--editing [data-cy="settings-save-player-button"]')
        && !target.closest('[data-cy="settings-local-player-row"].settings-archetype-item--editing .settings-archetype-field')
        && !target.closest('[data-cy="settings-local-player-row"].settings-archetype-item--editing [data-cy="settings-save-local-player-button"]')
        && !target.closest('mat-dialog-container')
      ) this.cancelPlayerEdit();
    }
  }

  private clearEditState(archetype: string): void {
    this.archetypeEdits.update((edits) => {
      const { [archetype]: _removed, ...rest } = edits;
      return rest;
    });
    if (this.editingArchetype() === archetype) this.editingArchetype.set(null);
  }

  private clearServerEditState(archetypeId: string): void {
    this.serverArchetypeEdits.update((edits) => {
      const { [archetypeId]: _removed, ...rest } = edits;
      return rest;
    });
    if (this.editingServerArchetype() === archetypeId) this.editingServerArchetype.set(null);
  }

  private clearPlayerEditState(player: string): void {
    this.playerEdits.update((edits) => {
      const { [player]: _removed, ...rest } = edits;
      return rest;
    });
    if (this.editingPlayer() === player) this.editingPlayer.set(null);
  }
}
