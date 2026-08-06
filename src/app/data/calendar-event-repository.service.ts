import { inject, Injectable } from '@angular/core';
import { ApplicationBackend, LEGACY_BROWSER_BACKEND, requireLegacyBrowserStore } from '../backend/application-backend';
import { CalendarEventDocument, createCalendarEvent, normalizeCalendarEvent, normalizeCalendarEvents, normalizeSlug } from '../domain/models';

/**
 * Legacy browser CalendarEvent documents. Server mode owns the Calendar through Scheduled
 * Tournaments instead, so the store is not injected there and every call fails closed rather than
 * writing a second, browser-local authority (ADR 0019).
 */
@Injectable({ providedIn: 'root' })
export class CalendarEventRepository {
  private readonly legacyBrowserStore: ApplicationBackend | null = inject(LEGACY_BROWSER_BACKEND);

  /** True only under the legacy browser authority. */
  get available(): boolean { return this.legacyBrowserStore !== null; }

  async list(): Promise<CalendarEventDocument[]> {
    return normalizeCalendarEvents(await this.backend().listCalendarEvents());
  }

  async create(): Promise<CalendarEventDocument> {
    const event = createCalendarEvent();
    return this.save(event);
  }

  async save(event: CalendarEventDocument): Promise<CalendarEventDocument> {
    const normalized = await this.withUniqueSlug(normalizeCalendarEvent(event));
    return normalizeCalendarEvent(await this.backend().saveCalendarEvent(normalized));
  }

  async delete(id: string): Promise<void> {
    await this.backend().deleteCalendarEvent(id);
  }

  private backend(): ApplicationBackend {
    return requireLegacyBrowserStore(this.legacyBrowserStore, 'calendarEventStoreDisabled');
  }

  private async withUniqueSlug(event: CalendarEventDocument): Promise<CalendarEventDocument> {
    const existing = (await this.list()).filter((item) => item.id !== event.id);
    const used = new Set(existing.map((item) => item.slug));
    const base = normalizeSlug(event.slug || event.title);
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) slug = `${base}-${suffix++}`;
    return { ...event, slug };
  }
}
