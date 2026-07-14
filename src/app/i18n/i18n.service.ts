import { Injectable, computed, effect, inject } from '@angular/core';
import { DeckArchetypeSettingsService, SettingsLanguage } from '../shared/deck-archetype-settings.service';
import { MessageKey, MessageParams, translate } from './messages';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly settings = inject(DeckArchetypeSettingsService);
  readonly language = this.settings.language;
  readonly locale = computed(() => this.language() === 'fr' ? 'fr-FR' : 'en-US');

  constructor() {
    effect(() => {
      const language = this.language();
      if (typeof document !== 'undefined') document.documentElement.lang = language;
    });
  }

  t(key: MessageKey, params?: MessageParams): string {
    return translate(this.language(), key, params);
  }

  languageLabel(language: SettingsLanguage = this.language()): string {
    return language === 'fr' ? this.t('lang.frenchNative') : this.t('lang.englishNative');
  }

  languageWord(language: SettingsLanguage): string {
    return language === 'fr' ? this.t('lang.french') : this.t('lang.english');
  }

  plural(count: number, oneKey: MessageKey, manyKey: MessageKey, params?: MessageParams): string {
    return this.t(count === 1 ? oneKey : manyKey, { count, ...params });
  }

  formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
    const date = typeof value === 'string' ? parseDateInput(value) ?? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
    return new Intl.DateTimeFormat(this.locale(), options).format(date);
  }

  checkpointLabel(label: string): string {
    const pairing = /^Pairing (\d+)$/.exec(label);
    if (pairing) return this.t('live.checkpointPairing', { n: pairing[1] });
    const standing = /^Standing (\d+)$/.exec(label);
    if (standing) return this.t('live.checkpointStanding', { n: standing[1] });
    return label;
  }
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
