import type { EventPayloadRequest } from '../../api/generated/gones-api';

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
  eventType: '' | 'weekly' | 'monthly' | 'major';
  timeZoneId: string;
  startDate: string;
  startTime: string;
  capacity: number | null;
  formatId: string;
  imageId: string | null;
}

export function eventPayload(value: EventDraftValue): EventPayloadRequest {
  return {
    organizationId: value.organizationId,
    title: value.title.trim(),
    summary: optional(value.summary),
    bodyMarkdown: optionalMarkdown(value.bodyMarkdown),
    location: {
      streetAddress: value.streetAddress.trim(),
      postalCode: value.postalCode.trim(),
      city: value.city.trim(),
      country: value.country.trim(),
      region: value.region.trim(),
      timeZoneId: value.timeZoneId.trim()
    },
    eventType: eventTypeValue(value.eventType),
    startsAtLocal: `${value.startDate}T${value.startTime}`,
    capacity: value.capacity ?? 0,
    formatIds: [value.formatId],
    imageId: value.imageId ?? undefined
  };
}

export function eventTypeValue(value: EventDraftValue['eventType']): Exclude<EventDraftValue['eventType'], ''> {
  if (!value) throw new Error('Event Type is required.');
  return value;
}

export class DirectPublicationState {
  private publishKey?: string;

  reset(): void {
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
