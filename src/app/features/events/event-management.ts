import {
  PublicFormatResponse,
  EventManagementResponse,
  EventPreviewRenderResponse,
  UpdateEventDetailsRequest
} from '../../api/generated/gones-api';
import { EventDraftValue } from './organizer-event-create';

export type MajorEventField = 'start' | 'end' | 'timeZone' | 'streetAddress' | 'postalCode' | 'city' | 'country' | 'capacity' | 'formats';
export type ChangedEventField = 'title' | 'summary' | 'description' | 'liveTournamentUrl' | 'archiveTournamentUrl' | 'streetAddress' | 'postalCode' | 'city' | 'country' | 'timeZone' | 'start' | 'end' | 'capacity' | 'formats' | 'status';

const defaultMajorLabels: Record<MajorEventField, string> = {
  start: 'start date/time',
  end: 'end date/time',
  timeZone: 'time zone',
  streetAddress: 'street address',
  postalCode: 'postal code',
  city: 'city',
  country: 'country',
  capacity: 'capacity',
  formats: 'formats'
};

export function managementToDraft(event: EventManagementResponse): EventDraftValue {
  return {
    organizationId: event.organizationId,
    title: event.title,
    summary: event.summary ?? '',
    bodyHtml: event.bodyHtml ?? '',
    streetAddress: event.streetAddress,
    postalCode: event.postalCode ?? '',
    city: event.city,
    country: event.country,
    timeZoneId: event.timeZoneId,
    startsAtLocal: localDateTime(event.venueStartDate, event.venueStartTime),
    endsAtLocal: localDateTime(event.venueEndDate, event.venueEndTime),
    capacity: event.capacity ?? null,
    formatId: event.formatIds[0] ?? '',
    liveTournamentUrl: event.liveTournamentUrl ?? '',
    archiveTournamentUrl: event.archiveTournamentUrl ?? ''
  };
}

export function eventUpdatePayload(value: EventDraftValue): UpdateEventDetailsRequest {
  return {
    title: value.title.trim(),
    summary: optional(value.summary),
    bodyHtml: optional(value.bodyHtml),
    streetAddress: value.streetAddress.trim(),
    postalCode: optional(value.postalCode),
    city: value.city.trim(),
    country: value.country.trim(),
    timeZoneId: value.timeZoneId.trim(),
    startsAtLocal: value.startsAtLocal,
    endsAtLocal: value.endsAtLocal || undefined,
    capacity: value.capacity ?? undefined,
    formatIds: [value.formatId],
    liveTournamentUrl: optional(value.liveTournamentUrl),
    archiveTournamentUrl: optional(value.archiveTournamentUrl)
  };
}

export function majorEventChanges(
  original: EventManagementResponse,
  draft: EventDraftValue,
  label: (field: MajorEventField) => string = field => defaultMajorLabels[field]
): string[] {
  const originalDraft = managementToDraft(original);
  const fields: Array<[MajorEventField, keyof EventDraftValue]> = [
    ['start', 'startsAtLocal'], ['end', 'endsAtLocal'], ['timeZone', 'timeZoneId'], ['streetAddress', 'streetAddress'],
    ['postalCode', 'postalCode'], ['city', 'city'], ['country', 'country'], ['capacity', 'capacity'], ['formats', 'formatId']
  ];
  return fields.filter(([, key]) => !same(originalDraft[key], draft[key])).map(([field]) => label(field));
}

export function changedEventFields(
  original: EventManagementResponse,
  latest: EventManagementResponse,
  label: (field: ChangedEventField) => string = field => field
): string[] {
  const fields: Array<[ChangedEventField, keyof EventManagementResponse]> = [
    ['title', 'title'], ['summary', 'summary'], ['description', 'bodyHtml'], ['liveTournamentUrl', 'liveTournamentUrl'],
    ['archiveTournamentUrl', 'archiveTournamentUrl'], ['streetAddress', 'streetAddress'],
    ['postalCode', 'postalCode'], ['city', 'city'], ['country', 'country'], ['timeZone', 'timeZoneId'],
    ['start', 'startsAtUtc'], ['end', 'endsAtUtc'], ['capacity', 'capacity'], ['formats', 'formatIds'], ['status', 'status']
  ];
  return fields.filter(([, key]) => !same(original[key], latest[key])).map(([field]) => label(field));
}

export function canEditEvent(event: EventManagementResponse, now = new Date()): boolean {
  return !event.deletedAt && event.status === 'Published' && now.getTime() < new Date(String(event.startsAtUtc)).getTime();
}

export function canCancelEvent(event: EventManagementResponse): boolean {
  return !event.deletedAt && event.status !== 'Cancelled';
}

export function managementToDetail(
  event: EventManagementResponse,
  formats: readonly PublicFormatResponse[]
): EventPreviewRenderResponse {
  const byId = new Map(formats.map(format => [format.id, format]));
  return {
    title: event.title,
    displayTitle: event.displayTitle,
    slug: event.slug,
    summary: event.summary,
    bodyHtml: event.bodyHtml,
    liveTournamentUrl: event.liveTournamentUrl,
    archiveTournamentUrl: event.archiveTournamentUrl,
    venue: {
      streetAddress: event.streetAddress,
      postalCode: event.postalCode,
      city: event.city,
      country: event.country
    },
    timeZoneId: event.timeZoneId,
    venueStartDate: event.venueStartDate,
    venueStartTime: event.venueStartTime,
    venueEndDate: event.venueEndDate,
    venueEndTime: event.venueEndTime,
    startsAtUtc: event.startsAtUtc,
    endsAtUtc: event.endsAtUtc,
    capacity: event.capacity,
    status: event.status,
    organization: { id: event.organizationId, name: event.organizationName, description: undefined, website: undefined, contactEmail: undefined, organizers: [] },
    formats: event.formatIds.map(id => byId.get(id) ?? { id, name: id, slug: id, sortOrder: 0 })
  };
}

function localDateTime(date: string, time: string): string {
  return `${date}T${time.slice(0, 5)}`;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function same(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? [...left].sort().join('\u0000') === [...right].sort().join('\u0000')
    : left === right;
}
