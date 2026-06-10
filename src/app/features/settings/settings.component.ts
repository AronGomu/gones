import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { BackButtonComponent } from '../../shared/back-button.component';

const LANGUAGE_KEY = 'gones.settings.language';

@Component({
  standalone: true,
  imports: [FormsModule, MatCardModule, MatFormFieldModule, MatSelectModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" label="Back to Home" position="top" />
    <section class="info-page settings-page" aria-labelledby="settings-title">
      <div class="info-hero settings-hero">
        <p class="kicker">Settings</p>
        <h1 id="settings-title">Set the app language.</h1>
        <p>Choose the language Gones should prefer as more public pages and organizer tools are added.</p>
      </div>

      <mat-card class="panel settings-panel">
        <mat-card-content>
          <div class="settings-row">
            <div>
              <h2>Language</h2>
              <p class="muted">This preference is saved in this browser. Full translations will arrive as the public website grows.</p>
            </div>
            <mat-form-field appearance="outline" class="settings-language-field">
              <mat-label>Language</mat-label>
              <mat-select [ngModel]="language()" (ngModelChange)="setLanguage($event)">
                <mat-option value="en">English</mat-option>
                <mat-option value="fr">Français</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <p class="settings-saved" role="status">Current language: {{ languageLabel() }}</p>
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
  readonly language = signal(localStorage.getItem(LANGUAGE_KEY) || 'en');

  setLanguage(value: string): void {
    this.language.set(value);
    localStorage.setItem(LANGUAGE_KEY, value);
  }

  languageLabel(): string {
    return this.language() === 'fr' ? 'Français' : 'English';
  }
}
