import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { BackButtonComponent } from '../../shared/back-button.component';
import { DeckArchetypeSettingsService, normalizeArchetypeName } from '../../shared/deck-archetype-settings.service';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" label="Back to Home" position="top" />
    <section class="info-page settings-page" aria-label="Settings">
      <mat-card class="panel settings-panel">
        <mat-card-content>
          <div class="settings-row">
            <div>
              <h2>Language</h2>
              <p class="muted">This preference is saved in this browser. Full translations will arrive as the public website grows.</p>
            </div>
            <mat-form-field appearance="outline" class="settings-language-field">
              <mat-label>Language</mat-label>
              <mat-select data-cy="settings-language-select" [ngModel]="language()" (ngModelChange)="setLanguage($event)">
                <mat-option value="en">English</mat-option>
                <mat-option value="fr">Français</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <p class="settings-saved" role="status" data-cy="settings-language-status">Current language: {{ languageLabel() }}</p>
        </mat-card-content>
      </mat-card>

      <mat-card class="panel settings-panel">
        <mat-card-content>
          <div class="settings-archetype-copy">
            <h2>Deck archetypes</h2>
            <p class="muted">Manage the global suggestions shown in deck archetype fields. Tournament inputs still accept new archetypes.</p>
          </div>

          <form class="settings-archetype-add" (ngSubmit)="addArchetype()">
            <mat-form-field appearance="outline" class="settings-archetype-field">
              <mat-label>New deck archetype</mat-label>
              <input matInput data-cy="settings-new-archetype-input" [ngModel]="newArchetype()" name="newArchetype" (ngModelChange)="newArchetype.set($event)">
            </mat-form-field>
            <button mat-stroked-button class="settings-add-archetype-button" type="submit" data-cy="settings-add-archetype-button" [disabled]="archetypeSaving() || !canAddNewArchetype()">Add archetype</button>
          </form>

          @if (archetypes().length) {
            <div class="settings-archetype-list" role="list" aria-label="Deck archetypes">
              @for (archetype of archetypes(); track archetype) {
                <div class="settings-archetype-item" role="listitem" data-cy="settings-archetype-row" [attr.data-archetype]="archetype">
                  <mat-form-field appearance="outline" class="settings-archetype-field">
                    <mat-label>Deck archetype</mat-label>
                    <input matInput data-cy="settings-archetype-input" [ngModel]="editValue(archetype)" [name]="'archetype-' + $index" (ngModelChange)="setEditValue(archetype, $event)" (blur)="saveArchetypeEdit(archetype)">
                  </mat-form-field>
                  <button mat-stroked-button type="button" data-cy="settings-save-archetype-button" (click)="saveArchetypeEdit(archetype)" [disabled]="archetypeSaving() || !canSaveArchetypeEdit(archetype)">Save</button>
                  <button mat-button type="button" class="destructive-menu-item" data-cy="settings-remove-archetype-button" (click)="removeArchetype(archetype)" [disabled]="archetypeSaving()">Remove</button>
                </div>
              }
            </div>
          } @else {
            <p class="empty" data-cy="settings-empty-archetypes">No saved archetypes yet. Add one here or from a Tournament archetype input.</p>
          }
          @if (archetypeMessage()) { <p class="settings-saved" role="status">{{ archetypeMessage() }}</p> }
        </mat-card-content>
      </mat-card>

    </section>
    <gones-back-button [link]="['/']" label="Back to Home" position="bottom" />
  `
})
export class SettingsComponent {
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
    return this.language() === 'fr' ? 'Français' : 'English';
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
        this.archetypeMessage.set(archetype ? `${archetype} already exists.` : 'Enter a deck archetype name first.');
        return;
      }
      this.newArchetype.set('');
      this.archetypeMessage.set(`${archetype} added.`);
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
        this.archetypeMessage.set(`${next} already exists.`);
        return;
      }
      this.archetypeEdits.update((edits) => {
        const { [archetype]: _removed, ...rest } = edits;
        return rest;
      });
      this.archetypeMessage.set(`${archetype} updated to ${next}.`);
    } finally {
      this.archetypeSaving.set(false);
    }
  }

  async removeArchetype(archetype: string): Promise<void> {
    if (this.archetypeSaving()) return;
    this.archetypeSaving.set(true);
    try {
      await this.deckArchetypes.remove(archetype);
      this.archetypeMessage.set(`${archetype} removed.`);
    } finally {
      this.archetypeSaving.set(false);
    }
  }
}
