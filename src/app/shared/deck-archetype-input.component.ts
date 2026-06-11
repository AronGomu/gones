import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { DeckArchetypeSettingsService, normalizeArchetypeName } from './deck-archetype-settings.service';

let nextDeckArchetypeInputId = 1;

@Component({
  selector: 'gones-deck-archetype-input',
  standalone: true,
  imports: [FormsModule, MatButtonModule],
  template: `
    <div class="deck-archetype-input">
      <input
        [attr.id]="inputId"
        [attr.aria-label]="label"
        [attr.list]="datalistId"
        [disabled]="disabled"
        [ngModel]="value"
        (ngModelChange)="setValue($event)">
      <datalist [id]="datalistId">
        @for (archetype of suggestions(); track archetype) { <option [value]="archetype"></option> }
      </datalist>
      @if (canAddCurrentValue()) {
        <button mat-stroked-button type="button" class="deck-archetype-input__add" [disabled]="adding()" (click)="addCurrentValue()">Add new archetype to settings</button>
      }
    </div>
  `
})
export class DeckArchetypeInputComponent {
  @Input() inputId = `deck-archetype-input-${nextDeckArchetypeInputId++}`;
  @Input() label = 'Deck archetype';
  @Input() value = '';
  @Input() disabled = false;
  @Output() readonly valueChange = new EventEmitter<string>();

  readonly datalistId = `${this.inputId}-suggestions`;
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
