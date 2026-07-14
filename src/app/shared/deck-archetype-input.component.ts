import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../i18n/i18n.service';
import { DeckArchetypeSettingsService, fuzzyMatchIndices, normalizeArchetypeName } from './deck-archetype-settings.service';

let nextDeckArchetypeInputId = 1;

@Component({
  selector: 'gones-deck-archetype-input',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatButtonModule],
  template: `
    <div class="deck-archetype-input">
      <input
        [attr.id]="inputId"
        [attr.aria-label]="label || i18n.t('archetype.label')"
        autocomplete="off"
        spellcheck="false"
        [disabled]="disabled"
        [matAutocomplete]="archetypeAutocomplete"
        [ngModel]="value"
        (ngModelChange)="setValue($event)">
      <mat-autocomplete #archetypeAutocomplete="matAutocomplete" class="deck-archetype-input__panel" [autoActiveFirstOption]="suggestions().length > 0" (optionSelected)="selectSuggestion($event)">
        @for (archetype of suggestions(); track archetype) {
          <mat-option [value]="archetype">
            <span class="deck-archetype-input__option">
              @for (segment of highlightedSegments(archetype); track $index) {
                @if (segment.highlighted) { <strong>{{ segment.text }}</strong> }
                @else { <span>{{ segment.text }}</span> }
              }
            </span>
          </mat-option>
        }
      </mat-autocomplete>
      @if (allowAdd && canAddCurrentValue()) {
        <button mat-flat-button type="button" class="deck-archetype-input__add create-action-button" data-cy="deck-archetype-save-button" [disabled]="adding()" [attr.aria-label]="i18n.t('archetype.addAria', { value })" (click)="addCurrentValue()">{{ i18n.t('archetype.add') }}</button>
      }
    </div>
  `
})
export class DeckArchetypeInputComponent {
  readonly i18n = inject(I18nService);
  @Input() inputId = `deck-archetype-input-${nextDeckArchetypeInputId++}`;
  @Input() label = '';
  @Input() value = '';
  @Input() disabled = false;
  /** When false, hide save/add-to-catalog button (link-only mode). */
  @Input() allowAdd = true;
  @Output() readonly valueChange = new EventEmitter<string>();

  readonly adding = signal(false);

  constructor(readonly deckArchetypes: DeckArchetypeSettingsService) {}

  suggestions(): string[] {
    return this.deckArchetypes.suggestions(this.value);
  }

  canAddCurrentValue(): boolean {
    const archetype = normalizeArchetypeName(this.value);
    return !this.adding() && !!archetype && !this.deckArchetypes.has(archetype);
  }

  setValue(value: string): void {
    this.value = value;
    this.valueChange.emit(value);
  }

  selectSuggestion(event: MatAutocompleteSelectedEvent): void {
    this.setValue(String(event.option.value ?? ''));
  }

  highlightedSegments(archetype: string): { text: string; highlighted: boolean }[] {
    const highlightedIndices = new Set(fuzzyMatchIndices(archetype, this.value));
    if (!highlightedIndices.size) return [{ text: archetype, highlighted: false }];

    const segments: { text: string; highlighted: boolean }[] = [];
    let currentText = '';
    let currentHighlighted = highlightedIndices.has(0);
    for (let index = 0; index < archetype.length; index++) {
      const highlighted = highlightedIndices.has(index);
      if (highlighted !== currentHighlighted && currentText) {
        segments.push({ text: currentText, highlighted: currentHighlighted });
        currentText = '';
        currentHighlighted = highlighted;
      }
      currentText += archetype[index];
    }
    if (currentText) segments.push({ text: currentText, highlighted: currentHighlighted });
    return segments;
  }

  async addCurrentValue(): Promise<void> {
    if (this.adding()) return;
    const archetype = normalizeArchetypeName(this.value);
    this.adding.set(true);
    try {
      if (!await this.deckArchetypes.add(archetype)) return;
      this.setValue(archetype);
    } finally {
      this.adding.set(false);
    }
  }
}
