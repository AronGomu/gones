import { inject, Injectable } from '@angular/core';
import { APP_BACKEND, ApplicationBackend } from '../backend/application-backend';
import { CalendarEventDocument, createCalendarEvent, normalizeCalendarEvent } from '../domain/models';

@Injectable({ providedIn: 'root' })
export class CalendarEventRepository {
  private readonly backend: ApplicationBackend = inject(APP_BACKEND);

  async list(): Promise<CalendarEventDocument[]> {
    return this.backend.listCalendarEvents();
  }

  async create(): Promise<CalendarEventDocument> {
    const event = createCalendarEvent();
    return this.save(event);
  }

  async save(event: CalendarEventDocument): Promise<CalendarEventDocument> {
    return this.backend.saveCalendarEvent(normalizeCalendarEvent(event));
  }

  async delete(id: string): Promise<void> {
    await this.backend.deleteCalendarEvent(id);
  }
}
