import { inject, Injectable } from '@angular/core';
import { APP_BACKEND, ApplicationBackend } from '../backend/application-backend';
import { CalendarEventDocument, createCalendarEvent, normalizeCalendarEvent, normalizeCalendarEvents, normalizeSlug } from '../domain/models';

@Injectable({ providedIn: 'root' })
export class CalendarEventRepository {
  private readonly backend: ApplicationBackend = inject(APP_BACKEND);

  async list(): Promise<CalendarEventDocument[]> {
    return normalizeCalendarEvents(await this.backend.listCalendarEvents());
  }

  async create(): Promise<CalendarEventDocument> {
    const event = createCalendarEvent();
    return this.save(event);
  }

  async save(event: CalendarEventDocument): Promise<CalendarEventDocument> {
    const normalized = await this.withUniqueSlug(normalizeCalendarEvent(event));
    return normalizeCalendarEvent(await this.backend.saveCalendarEvent(normalized));
  }

  async delete(id: string): Promise<void> {
    await this.backend.deleteCalendarEvent(id);
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
