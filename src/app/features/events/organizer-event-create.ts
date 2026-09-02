import type { EventPayloadRequest, EventPreviewResponse } from '../../api/generated/gones-api';

export interface EventDraftValue {
  organizationId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  region: string;
  locationToken: string;
  latitude: number | null;
  longitude: number | null;
  eventType: '' | 'weekly' | 'monthly' | 'major';
  timeZoneId: string;
  startsAtLocal: string;
  endsAtLocal: string;
  capacity: number | null;
  formatId: string;
  liveTournamentUrl: string;
  archiveTournamentUrl: string;
}

export function eventPayload(value: EventDraftValue): EventPayloadRequest {
  return {
    organizationId: value.organizationId,
    title: value.title.trim(),
    summary: optional(value.summary),
    bodyMarkdown: optionalMarkdown(value.bodyMarkdown),
    streetAddress: value.streetAddress.trim(),
    postalCode: optional(value.postalCode),
    city: value.city.trim(),
    country: value.country.trim(),
    region: value.region.trim(),
    eventType: eventTypeValue(value.eventType),
    timeZoneId: value.timeZoneId.trim(),
    startsAtLocal: value.startsAtLocal,
    endsAtLocal: value.endsAtLocal || undefined,
    capacity: value.capacity ?? undefined,
    formatIds: [value.formatId],
    liveTournamentUrl: optional(value.liveTournamentUrl),
    archiveTournamentUrl: optional(value.archiveTournamentUrl)
  };
}

export function eventTypeValue(value: EventDraftValue['eventType']): Exclude<EventDraftValue['eventType'], ''> {
  if (!value) throw new Error('Event Type is required.');
  return value;
}

export class PreviewPublicationState {
  preview?: EventPreviewResponse;
  private publishKey?: string;

  accept(preview: EventPreviewResponse): void {
    this.preview = preview;
    this.publishKey = undefined;
  }

  invalidate(): void {
    this.preview = undefined;
    this.publishKey = undefined;
  }

  idempotencyKey(create: () => string): string {
    this.publishKey ??= create();
    return this.publishKey;
  }
}

export function optionalMarkdown(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}
