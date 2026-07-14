import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { DeckArchetypeSettingsService, normalizeArchetypeName } from '../../shared/deck-archetype-settings.service';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, BackButtonComponent],
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

      <mat-card class="panel settings-panel">
        <mat-card-content>
          <div class="settings-archetype-copy">
            <h2>{{ i18n.t('settings.deckArchetypes') }}</h2>
            <p class="muted">{{ i18n.t('settings.deckArchetypesHelp') }}</p>
          </div>

          <form class="settings-archetype-add" (ngSubmit)="addArchetype()">
            <mat-form-field appearance="outline" class="settings-archetype-field">
              <mat-label>{{ i18n.t('settings.newArchetype') }}</mat-label>
              <input matInput data-cy="settings-new-archetype-input" [ngModel]="newArchetype()" name="newArchetype" (ngModelChange)="newArchetype.set($event)">
            </mat-form-field>
            <button mat-stroked-button class="settings-add-archetype-button" type="submit" data-cy="settings-add-archetype-button" [disabled]="archetypeSaving() || !canAddNewArchetype()">{{ i18n.t('settings.addArchetype') }}</button>
          </form>

          @if (archetypes().length) {
            <div class="settings-archetype-list" role="list" [attr.aria-label]="i18n.t('settings.deckArchetypes')">
              @for (archetype of archetypes(); track archetype) {
                <div class="settings-archetype-item" role="listitem" data-cy="settings-archetype-row" [attr.data-archetype]="archetype">
                  <mat-form-field appearance="outline" class="settings-archetype-field">
                    <mat-label>{{ i18n.t('settings.deckArchetype') }}</mat-label>
                    <input matInput data-cy="settings-archetype-input" [ngModel]="editValue(archetype)" [name]="'archetype-' + $index" (ngModelChange)="setEditValue(archetype, $event)" (blur)="saveArchetypeEdit(archetype)">
                  </mat-form-field>
                  <button mat-stroked-button type="button" data-cy="settings-save-archetype-button" (click)="saveArchetypeEdit(archetype)" [disabled]="archetypeSaving() || !canSaveArchetypeEdit(archetype)">{{ i18n.t('common.save') }}</button>
                  <button mat-button type="button" class="destructive-menu-item" data-cy="settings-remove-archetype-button" (click)="removeArchetype(archetype)" [disabled]="archetypeSaving()">{{ i18n.t('common.remove') }}</button>
                </div>
              }
            </div>
          } @else {
            <p class="empty" data-cy="settings-empty-archetypes">{{ i18n.t('settings.emptyArchetypes') }}</p>
          }
          @if (archetypeMessage()) { <p class="settings-saved" role="status">{{ archetypeMessage() }}</p> }
        </mat-card-content>
      </mat-card>

    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class SettingsComponent {
  readonly i18n = inject(I18nService);
  private readonly deckArchetypes = inject(DeckArchetypeSettingsService);
  readonly language = this.deckArchetypes.language;
  readonly newArchetype = signal('');
  readonly archetypeMessage = signal('');
  readonly archetypeSaving = signal(false);
  readonly archetypeEdits = signal<Record<string, string>>({});
  readonly archetypes = this.deckArchetypes.archetypes;

  async setLanguage(value: string): Promise<void> {
    await this.deckArchetypes.setLanguage(value);
  }

  languageLabel(): string {
    return this.i18n.languageLabel();
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
    if (!next || next === archetype) return;
    this.archetypeSaving.set(true);
    try {
      if (!await this.deckArchetypes.update(archetype, next)) {
        this.archetypeMessage.set(this.i18n.t('settings.archetypeExists', { name: next }));
        return;
      }
      this.archetypeEdits.update((edits) => {
        const { [archetype]: _removed, ...rest } = edits;
        return rest;
      });
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
      this.archetypeMessage.set(this.i18n.t('settings.archetypeRemoved', { name: archetype }));
    } finally {
      this.archetypeSaving.set(false);
    }
  }
}
