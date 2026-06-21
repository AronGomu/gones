import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { BackButtonComponent } from '../../shared/back-button.component';
import { DeckArchetypeSettingsService, parseAppSettings, normalizeArchetypeName } from '../../shared/deck-archetype-settings.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { logBoundaryError, logBoundaryInfo } from '../../shared/app-logger';
import { saveJsonFile } from '../../shared/save-json-file';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" label="Back to Home" position="top" />
    <section class="info-page settings-page" aria-labelledby="settings-title">
      <div class="info-hero settings-hero">
        <div class="settings-hero-copy">
          <p class="kicker">Settings</p>
          <h1 id="settings-title">Manage app settings.</h1>
          <p>Manage global deck archetype suggestions and local app configuration.</p>
        </div>
        <div class="settings-hero-actions" aria-label="Settings import and export actions">
          <button mat-stroked-button type="button" (click)="exportSettings()" [disabled]="settingsImporting()">Export settings</button>
          <button mat-flat-button type="button" class="home-primary-action" (click)="settingsImportInput.click()" [disabled]="settingsImporting()">{{ settingsImporting() ? 'Importing…' : 'Import settings' }}</button>
          <input #settingsImportInput class="settings-file-input" type="file" accept="application/json,.json" (change)="importSettings($event)" aria-hidden="true" tabindex="-1">
        </div>
        @if (settingsMessage()) { <p class="settings-saved settings-hero-status" role="status">{{ settingsMessage() }}</p> }
      </div>

      <mat-card class="panel settings-panel">
        <mat-card-content>
          <div class="settings-archetype-copy">
            <h2>Deck archetypes</h2>
            <p class="muted">Manage the global suggestions shown in deck archetype fields. Tournament inputs still accept new archetypes.</p>
          </div>

          <form class="settings-archetype-add" (ngSubmit)="addArchetype()">
            <mat-form-field appearance="outline" class="settings-archetype-field">
              <mat-label>New deck archetype</mat-label>
              <input matInput [ngModel]="newArchetype()" name="newArchetype" (ngModelChange)="newArchetype.set($event)">
            </mat-form-field>
            <button mat-stroked-button class="settings-add-archetype-button" type="submit" [disabled]="archetypeSaving() || !canAddNewArchetype()">Add archetype</button>
          </form>

          @if (archetypes().length) {
            <div class="settings-archetype-list" role="list" aria-label="Deck archetypes">
              @for (archetype of archetypes(); track archetype) {
                <div class="settings-archetype-item" role="listitem">
                  <mat-form-field appearance="outline" class="settings-archetype-field">
                    <mat-label>Deck archetype</mat-label>
                    <input matInput [ngModel]="editValue(archetype)" [name]="'archetype-' + $index" (ngModelChange)="setEditValue(archetype, $event)" (blur)="saveArchetypeEdit(archetype)">
                  </mat-form-field>
                  <button mat-stroked-button type="button" (click)="saveArchetypeEdit(archetype)" [disabled]="archetypeSaving() || !canSaveArchetypeEdit(archetype)">Save</button>
                  <button mat-button type="button" class="destructive-menu-item" (click)="removeArchetype(archetype)" [disabled]="archetypeSaving()">Remove</button>
                </div>
              }
            </div>
          } @else {
            <p class="empty">No saved archetypes yet. Add one here or from a Tournament archetype input.</p>
          }
          @if (archetypeMessage()) { <p class="settings-saved" role="status">{{ archetypeMessage() }}</p> }
        </mat-card-content>
      </mat-card>

      <section class="future-strip" aria-labelledby="settings-future-title">
        <h2 id="settings-future-title">Reserved for later</h2>
        <ul>
          <li>Event notification preferences.</li>
          <li>Organizer display options.</li>
          <li>Calendar defaults.</li>
          <li>Import and export preferences.</li>
        </ul>
      </section>
    </section>
    <gones-back-button [link]="['/']" label="Back to Home" position="bottom" />
  `
})
export class SettingsComponent {
  readonly newArchetype = signal('');
  readonly archetypeMessage = signal('');
  readonly settingsMessage = signal('');
  readonly archetypeSaving = signal(false);
  readonly settingsImporting = signal(false);
  readonly archetypeEdits = signal<Record<string, string>>({});
  private readonly deckArchetypes = inject(DeckArchetypeSettingsService);
  private readonly dialog = inject(MatDialog);
  readonly archetypes = this.deckArchetypes.archetypes;

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

  exportSettings(): void {
    const settings = this.deckArchetypes.exportSettings();
    try {
      saveJsonFile(settings, `gones-settings-${new Date().toISOString().slice(0, 10)}.json`);
      this.settingsMessage.set('Settings exported.');
      logBoundaryInfo('settings.export', { deckArchetypes: settings.deckArchetypes.length });
    } catch (error) {
      this.settingsMessage.set('Could not export settings.');
      logBoundaryError('settings.export', error, { deckArchetypes: settings.deckArchetypes.length });
    }
  }

  async importSettings(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.settingsImporting()) return;

    this.settingsImporting.set(true);
    try {
      const parsed = parseAppSettings(JSON.parse(await file.text()));
      if (!parsed) {
        this.settingsMessage.set('Choose a valid Gones settings JSON file.');
        return;
      }

      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Import settings',
          message: `Replace your current settings with ${parsed.deckArchetypes.length} imported deck archetype${parsed.deckArchetypes.length === 1 ? '' : 's'}? This cannot be undone.`,
          confirmLabel: 'Replace settings',
          destructive: true
        }
      }).afterClosed());
      if (!confirmed) {
        this.settingsMessage.set('Settings import canceled.');
        return;
      }

      await this.deckArchetypes.replaceSettings(parsed);
      this.newArchetype.set('');
      this.archetypeEdits.set({});
      this.archetypeMessage.set('');
      this.settingsMessage.set(`Imported ${parsed.deckArchetypes.length} deck archetype${parsed.deckArchetypes.length === 1 ? '' : 's'}.`);
      logBoundaryInfo('settings.import', { fileName: file.name, deckArchetypes: parsed.deckArchetypes.length });
    } catch (error) {
      this.settingsMessage.set('Could not import settings. Use a valid JSON file.');
      logBoundaryError('settings.import', error, { fileName: file.name });
    } finally {
      this.settingsImporting.set(false);
    }
  }
}
