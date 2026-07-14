import { Component, computed, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { LeagueRepository } from '../../data/league-repository.service';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { collectKnownPlayerNames } from '../../domain/player-stats';
import { playerNameKey, renamePlayerInLeague, renamePlayerInLiveTournament, samePlayerName } from '../../domain/rename-player';
import { trimPlayerName } from '../../domain/models';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { archetypeKey, DeckArchetypeSettingsService, normalizeArchetypeName } from '../../shared/deck-archetype-settings.service';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatDialogModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatSelectModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />
    <section class="info-page settings-page" [attr.aria-label]="i18n.t('settings.pageAria')">
      <mat-card class="panel settings-panel">
        <mat-card-content>
          <div class="settings-row">
            <div>
              <h2>{{ i18n.t('settings.language') }}</h2>
              <p class="muted">{{ i18n.t('settings.languageHelp') }}</p>
            </div>
            <mat-form-field appearance="outline" class="settings-language-field">
              <mat-label>{{ i18n.t('settings.language') }}</mat-label>
              <mat-select data-cy="settings-language-select" [ngModel]="language()" (ngModelChange)="setLanguage($event)">
                <mat-option value="en">{{ i18n.t('lang.englishNative') }}</mat-option>
                <mat-option value="fr">{{ i18n.t('lang.frenchNative') }}</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <p class="settings-saved" role="status" data-cy="settings-language-status">{{ i18n.t('settings.currentLanguage', { label: languageLabel() }) }}</p>
        </mat-card-content>
      </mat-card>

      <mat-card class="panel settings-panel settings-archetype-panel-card">
        <mat-card-content>
          <mat-expansion-panel class="settings-collapsible-panel settings-archetype-panel" data-cy="settings-archetype-panel" [expanded]="false">
            <mat-expansion-panel-header (click)="blurExpansionHeader($event)">
              <mat-panel-title>{{ i18n.t('settings.deckArchetypes') }}</mat-panel-title>
              <mat-panel-description>{{ filteredArchetypes().length }} / {{ archetypes().length }}</mat-panel-description>
            </mat-expansion-panel-header>

            <p class="muted settings-archetype-copy">{{ i18n.t('settings.deckArchetypesHelp') }}</p>

            <form class="settings-archetype-add" (ngSubmit)="addArchetype()">
              <mat-form-field appearance="outline" class="settings-archetype-field">
                <mat-label>{{ i18n.t('settings.newArchetype') }}</mat-label>
                <input matInput data-cy="settings-new-archetype-input" [ngModel]="newArchetype()" name="newArchetype" (ngModelChange)="newArchetype.set($event)">
              </mat-form-field>
              <button mat-stroked-button class="settings-add-archetype-button" type="submit" data-cy="settings-add-archetype-button" [disabled]="archetypeSaving() || !canAddNewArchetype()">{{ i18n.t('settings.addArchetype') }}</button>
            </form>

            <mat-form-field appearance="outline" class="settings-archetype-field settings-archetype-filter">
              <mat-label>{{ i18n.t('settings.filterArchetypes') }}</mat-label>
              <input matInput data-cy="settings-archetype-filter" [ngModel]="archetypeFilter()" name="archetypeFilter" (ngModelChange)="archetypeFilter.set($event)" [attr.aria-label]="i18n.t('settings.filterArchetypes')">
            </mat-form-field>

            @if (filteredArchetypes().length) {
              <div class="settings-archetype-list" role="list" [attr.aria-label]="i18n.t('settings.deckArchetypes')">
                @for (archetype of filteredArchetypes(); track archetype; let odd = $odd) {
                  <div
                    class="settings-archetype-item"
                    role="listitem"
                    data-cy="settings-archetype-row"
                    [class.settings-archetype-item--odd]="odd"
                    [class.settings-archetype-item--even]="!odd"
                    [class.settings-archetype-item--editing]="editingArchetype() === archetype"
                    [attr.data-archetype]="archetype"
                  >
                    @if (editingArchetype() === archetype) {
                      <mat-form-field appearance="outline" class="settings-archetype-field" subscriptSizing="dynamic">
                        <mat-label>{{ i18n.t('settings.deckArchetype') }}</mat-label>
                        <input
                          matInput
                          data-cy="settings-archetype-input"
                          [ngModel]="editValue(archetype)"
                          [name]="'archetype-' + archetype"
                          (ngModelChange)="setEditValue(archetype, $event)"
                        >
                      </mat-form-field>
                      <button
                        mat-stroked-button
                        type="button"
                        class="settings-archetype-row-action settings-archetype-save-button"
                        data-cy="settings-save-archetype-button"
                        (click)="saveArchetypeEdit(archetype)"
                        [disabled]="archetypeSaving() || !canSaveArchetypeEdit(archetype)"
                      >{{ i18n.t('common.save') }}</button>
                    } @else {
                      <span class="settings-archetype-name" data-cy="settings-archetype-name">{{ archetype }}</span>
                      <button
                        mat-stroked-button
                        type="button"
                        class="settings-archetype-row-action success-ghost-action"
                        data-cy="settings-update-archetype-button"
                        (click)="startEdit(archetype)"
                        [disabled]="archetypeSaving()"
                      >{{ i18n.t('common.update') }}</button>
                    }
                    <button
                      mat-button
                      type="button"
                      class="destructive-menu-item"
                      data-cy="settings-remove-archetype-button"
                      (click)="removeArchetype(archetype)"
                      [disabled]="archetypeSaving()"
                    >{{ i18n.t('common.delete') }}</button>
                  </div>
                }
              </div>
            } @else if (archetypes().length) {
              <p class="empty" data-cy="settings-empty-archetype-filter">{{ i18n.t('settings.noFilterMatches') }}</p>
            } @else {
              <p class="empty" data-cy="settings-empty-archetypes">{{ i18n.t('settings.emptyArchetypes') }}</p>
            }
            @if (archetypeMessage()) { <p class="settings-saved" role="status">{{ archetypeMessage() }}</p> }
          </mat-expansion-panel>
        </mat-card-content>
      </mat-card>

      <mat-card class="panel settings-panel settings-archetype-panel-card">
        <mat-card-content>
          <mat-expansion-panel class="settings-collapsible-panel settings-archetype-panel" data-cy="settings-players-panel" [expanded]="false">
            <mat-expansion-panel-header (click)="blurExpansionHeader($event)">
              <mat-panel-title>{{ i18n.t('settings.players') }}</mat-panel-title>
              <mat-panel-description>{{ filteredPlayers().length }} / {{ players().length }}</mat-panel-description>
            </mat-expansion-panel-header>

            <p class="muted settings-archetype-copy">{{ i18n.t('settings.playersHelp') }}</p>

            <mat-form-field appearance="outline" class="settings-archetype-field settings-archetype-filter">
              <mat-label>{{ i18n.t('settings.filterPlayers') }}</mat-label>
              <input matInput data-cy="settings-player-filter" [ngModel]="playerFilter()" name="playerFilter" (ngModelChange)="playerFilter.set($event)" [attr.aria-label]="i18n.t('settings.filterPlayers')">
            </mat-form-field>

            @if (filteredPlayers().length) {
              <div class="settings-archetype-list" role="list" [attr.aria-label]="i18n.t('settings.players')">
                @for (player of filteredPlayers(); track player; let odd = $odd) {
                  <div
                    class="settings-archetype-item"
                    role="listitem"
                    data-cy="settings-player-row"
                    [class.settings-archetype-item--odd]="odd"
                    [class.settings-archetype-item--even]="!odd"
                    [class.settings-archetype-item--editing]="editingPlayer() === player"
                    [attr.data-player]="player"
                  >
                    @if (editingPlayer() === player) {
                      <mat-form-field appearance="outline" class="settings-archetype-field" subscriptSizing="dynamic">
                        <mat-label>{{ i18n.t('settings.playerName') }}</mat-label>
                        <input
                          matInput
                          data-cy="settings-player-input"
                          [ngModel]="playerEditValue(player)"
                          [name]="'player-' + player"
                          (ngModelChange)="setPlayerEditValue(player, $event)"
                        >
                      </mat-form-field>
                      <button
                        mat-stroked-button
                        type="button"
                        class="settings-archetype-row-action settings-archetype-save-button"
                        data-cy="settings-save-player-button"
                        (click)="savePlayerEdit(player)"
                        [disabled]="playerSaving() || !canSavePlayerEdit(player)"
                      >{{ i18n.t('common.save') }}</button>
                    } @else {
                      <span class="settings-archetype-name" data-cy="settings-player-name">{{ player }}</span>
                      <button
                        mat-stroked-button
                        type="button"
                        class="settings-archetype-row-action success-ghost-action"
                        data-cy="settings-update-player-button"
                        (click)="startPlayerEdit(player)"
                        [disabled]="playerSaving()"
                      >{{ i18n.t('common.update') }}</button>
                    }
                  </div>
                }
              </div>
            } @else if (players().length) {
              <p class="empty" data-cy="settings-empty-player-filter">{{ i18n.t('settings.noPlayerFilterMatches') }}</p>
            } @else {
              <p class="empty" data-cy="settings-empty-players">{{ i18n.t('settings.emptyPlayers') }}</p>
            }
            @if (playerMessage()) { <p class="settings-saved" role="status">{{ playerMessage() }}</p> }
          </mat-expansion-panel>
        </mat-card-content>
      </mat-card>

    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class SettingsComponent {
  readonly i18n = inject(I18nService);
  private readonly deckArchetypes = inject(DeckArchetypeSettingsService);
  private readonly leagueRepo = inject(LeagueRepository);
  private readonly liveRepo = inject(LiveTournamentRepository);
  private readonly dialog = inject(MatDialog);
  readonly language = this.deckArchetypes.language;
  readonly newArchetype = signal('');
  readonly archetypeFilter = signal('');
  readonly archetypeMessage = signal('');
  readonly archetypeSaving = signal(false);
  readonly editingArchetype = signal<string | null>(null);
  readonly archetypeEdits = signal<Record<string, string>>({});
  readonly archetypes = this.deckArchetypes.archetypes;
  readonly filteredArchetypes = computed(() => {
    const filter = archetypeKey(this.archetypeFilter());
    const list = this.archetypes();
    if (!filter) return list;
    return list.filter((archetype) => archetypeKey(archetype).includes(filter));
  });

  readonly players = signal<string[]>([]);
  readonly playerFilter = signal('');
  readonly playerMessage = signal('');
  readonly playerSaving = signal(false);
  readonly editingPlayer = signal<string | null>(null);
  readonly playerEdits = signal<Record<string, string>>({});
  readonly filteredPlayers = computed(() => {
    const filter = playerNameKey(this.playerFilter());
    const list = this.players();
    if (!filter) return list;
    return list.filter((player) => playerNameKey(player).includes(filter));
  });

  constructor() {
    // Ensure baseline presets land even if this tab kept an old empty service state.
    this.deckArchetypes.bootstrapFromStorage();
    void this.loadPlayers();
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

  async addArchetype(): Promise<void> {
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

  startEdit(archetype: string): void {
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

  editValue(archetype: string): string {
    return this.archetypeEdits()[archetype] ?? archetype;
  }

  setEditValue(archetype: string, value: string): void {
    this.archetypeEdits.update((edits) => ({ ...edits, [archetype]: value }));
    this.archetypeMessage.set('');
  }

  canSaveArchetypeEdit(archetype: string): boolean {
    const next = normalizeArchetypeName(this.editValue(archetype));
    return !!next && next !== archetype && (!this.deckArchetypes.has(next) || next.toLocaleLowerCase() === archetype.toLocaleLowerCase());
  }

  async saveArchetypeEdit(archetype: string): Promise<void> {
    if (this.archetypeSaving()) return;
    const next = normalizeArchetypeName(this.editValue(archetype));
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

  async removeArchetype(archetype: string): Promise<void> {
    if (this.archetypeSaving()) return;
    this.archetypeSaving.set(true);
    try {
      await this.deckArchetypes.remove(archetype);
      if (this.editingArchetype() === archetype) this.clearEditState(archetype);
      this.archetypeMessage.set(this.i18n.t('settings.archetypeRemoved', { name: archetype }));
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  async loadPlayers(): Promise<void> {
    try {
      const leagues = await this.leagueRepo.listLeagues();
      this.players.set(collectKnownPlayerNames(leagues));
    } catch (error) {
      logBoundaryError('settings.loadPlayers', error);
      this.players.set([]);
    }
  }

  startPlayerEdit(player: string): void {
    const previous = this.editingPlayer();
    if (previous && previous !== player) this.clearPlayerEditState(previous);
    if (this.editingArchetype()) this.cancelEdit();
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

  async savePlayerEdit(player: string): Promise<void> {
    if (this.playerSaving()) return;
    const next = trimPlayerName(this.playerEditValue(player));
    if (!next) {
      this.playerMessage.set(this.i18n.t('settings.playerEnterName'));
      return;
    }
    if (next === player) {
      this.clearPlayerEditState(player);
      return;
    }

    const merge = this.players().some((name) => samePlayerName(name, next) && name !== player);
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: merge
        ? {
            title: this.i18n.t('settings.mergePlayerTitle'),
            message: this.i18n.t('settings.mergePlayerMessage', { from: player, to: next }),
            confirmLabel: this.i18n.t('settings.mergePlayerTitle'),
            destructive: true
          }
        : {
            title: this.i18n.t('settings.renamePlayerTitle'),
            message: this.i18n.t('settings.renamePlayerMessage', { from: player, to: next }),
            confirmLabel: this.i18n.t('settings.renamePlayerTitle'),
            destructive: false
          }
    }).afterClosed());
    if (!confirmed) return;

    this.playerSaving.set(true);
    try {
      const canonicalTarget = this.players().find((name) => samePlayerName(name, next)) ?? next;
      const targetName = merge ? canonicalTarget : next;
      await this.renamePlayerEverywhere(player, targetName);
      this.clearPlayerEditState(player);
      await this.loadPlayers();
      this.playerMessage.set(merge
        ? this.i18n.t('settings.playerMerged', { from: player, to: targetName })
        : this.i18n.t('settings.playerRenamed', { from: player, to: targetName }));
    } catch (error) {
      logBoundaryError('settings.renamePlayer', error, { from: player, to: next });
      this.playerMessage.set(this.i18n.t('settings.playerRenameFailed'));
    } finally {
      this.playerSaving.set(false);
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (this.editingArchetype()) {
      if (
        !target.closest('.settings-archetype-item--editing .settings-archetype-field')
        && !target.closest('.settings-archetype-item--editing [data-cy="settings-save-archetype-button"]')
        && !target.closest('.settings-archetype-item--editing [data-cy="settings-remove-archetype-button"]')
      ) this.cancelEdit();
    }

    if (this.editingPlayer()) {
      if (
        !target.closest('[data-cy="settings-player-row"].settings-archetype-item--editing .settings-archetype-field')
        && !target.closest('[data-cy="settings-player-row"].settings-archetype-item--editing [data-cy="settings-save-player-button"]')
        && !target.closest('mat-dialog-container')
      ) this.cancelPlayerEdit();
    }
  }

  private async renamePlayerEverywhere(from: string, to: string): Promise<void> {
    const leagues = await this.leagueRepo.listLeagues();
    for (const league of leagues) {
      const nextLeague = renamePlayerInLeague(league, from, to);
      if (nextLeague === league) continue;
      const changed = JSON.stringify(nextLeague.tournaments) !== JSON.stringify(league.tournaments);
      if (!changed) continue;
      await this.leagueRepo.saveLeague(nextLeague, league.documentVersion);
    }

    const lives = await this.liveRepo.list();
    for (const live of lives) {
      const nextLive = renamePlayerInLiveTournament(live, from, to);
      if (JSON.stringify(nextLive.players) === JSON.stringify(live.players) && JSON.stringify(nextLive.rounds) === JSON.stringify(live.rounds)) continue;
      await this.liveRepo.save(nextLive);
    }
  }

  private clearEditState(archetype: string): void {
    this.archetypeEdits.update((edits) => {
      const { [archetype]: _removed, ...rest } = edits;
      return rest;
    });
    if (this.editingArchetype() === archetype) this.editingArchetype.set(null);
  }

  private clearPlayerEditState(player: string): void {
    this.playerEdits.update((edits) => {
      const { [player]: _removed, ...rest } = edits;
      return rest;
    });
    if (this.editingPlayer() === player) this.editingPlayer.set(null);
  }
}
