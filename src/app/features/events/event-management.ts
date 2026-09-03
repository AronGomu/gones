import {
  PublicFormatResponse,
  EventManagementResponse,
  UpdateEventDetailsRequest
} from '../../api/generated/gones-api';
import { EventDraftValue, eventTypeValue, optionalMarkdown } from './organizer-event-create';
import { renderEventMarkdown } from './event-markdown';
import { EventDetailView } from './event-detail-view.component';

export type MajorEventField = 'start' | 'timeZone' | 'streetAddress' | 'postalCode' | 'city' | 'country' | 'region' | 'eventType' | 'capacity' | 'formats';
export type ChangedEventField = 'title' | 'summary' | 'description' | 'liveTournamentUrl' | 'archiveTournamentUrl' | 'streetAddress' | 'postalCode' | 'city' | 'country' | 'region' | 'eventType' | 'timeZone' | 'start' | 'end' | 'capacity' | 'formats' | 'images' | 'status';

const defaultMajorLabels: Record<MajorEventField, string> = {
  start: 'start date/time',
  timeZone: 'time zone',
  streetAddress: 'street address',
  postalCode: 'postal code',
  city: 'city',
  country: 'country',
  region: 'region',
  eventType: 'Event Type',
  capacity: 'capacity',
  formats: 'formats'
};

export function managementToDraft(event: EventManagementResponse): EventDraftValue {
  return {
    organizationId: event.organizationId,
    title: event.title,
    summary: event.summary ?? '',
    bodyMarkdown: event.bodyMarkdown ?? '',
    streetAddress: event.location.streetAddress,
    postalCode: event.location.postalCode,
    city: event.location.city,
    country: event.location.country,
    region: event.location.region,
    eventType: (event.eventType ?? '') as EventDraftValue['eventType'],
    timeZoneId: event.timeZoneId,
    startDate: event.startsAtLocal.slice(0, 10),
    startTime: event.startsAtLocal.slice(11, 16),
    capacity: event.capacity ?? null,
    formatId: event.formatIds[0] ?? '',
    imageId: event.image?.id ?? null
  };
}

export function eventUpdatePayload(value: EventDraftValue): UpdateEventDetailsRequest {
  return {
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

export function majorEventChanges(
  original: EventManagementResponse,
  draft: EventDraftValue,
  label: (field: MajorEventField) => string = field => defaultMajorLabels[field]
): string[] {
  const originalDraft = managementToDraft(original);
  const fields: Array<[MajorEventField, keyof EventDraftValue]> = [
    ['timeZone', 'timeZoneId'], ['streetAddress', 'streetAddress'], ['postalCode', 'postalCode'],
    ['city', 'city'], ['country', 'country'], ['region', 'region'], ['eventType', 'eventType'],
    ['capacity', 'capacity'], ['formats', 'formatId']
  ];
  const changed = fields.filter(([, key]) => !same(originalDraft[key], draft[key])).map(([field]) => label(field));
  if (originalDraft.startDate !== draft.startDate || originalDraft.startTime !== draft.startTime) changed.unshift(label('start'));
  return changed;
}

export function changedEventFields(
  original: EventManagementResponse,
  latest: EventManagementResponse,
  label: (field: ChangedEventField) => string = field => field
): string[] {
  const fields: Array<[ChangedEventField, keyof EventManagementResponse]> = [
    ['title', 'title'], ['summary', 'summary'], ['description', 'bodyMarkdown'], ['liveTournamentUrl', 'liveTournamentUrl'],
    ['archiveTournamentUrl', 'archiveTournamentUrl'], ['eventType', 'eventType'], ['timeZone', 'timeZoneId'],
    ['start', 'startsAtUtc'], ['end', 'endsAtUtc'], ['capacity', 'capacity'], ['formats', 'formatIds'], ['status', 'status']
  ];
  const changed = fields.filter(([, key]) => !same(original[key], latest[key])).map(([field]) => field);
  const locationFields: Array<[ChangedEventField, keyof EventManagementResponse['location']]> = [
    ['streetAddress', 'streetAddress'], ['postalCode', 'postalCode'], ['city', 'city'],
    ['country', 'country'], ['region', 'region']
  ];
  changed.push(...locationFields
    .filter(([, key]) => original.location[key] !== latest.location[key])
    .map(([field]) => field));
  if (!sameImages(original, latest)) changed.push('images');
  return changed.map(label);
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
): EventDetailView {
  const byId = new Map(formats.map(format => [format.id, format]));
  return {
    id: event.id,
    title: event.title,
    displayTitle: event.displayTitle,
    slug: event.slug,
    summary: event.summary,
    bodyHtml: renderEventMarkdown(event.bodyMarkdown ?? ''),
    liveTournamentUrl: event.liveTournamentUrl,
    archiveTournamentUrl: event.archiveTournamentUrl,
    venue: {
      streetAddress: event.location.streetAddress,
      postalCode: event.location.postalCode,
      city: event.location.city,
      country: event.location.country,
      region: event.location.region
    },
    timeZoneId: event.timeZoneId,
    venueStartDate: event.venueStartDate,
    venueStartTime: event.venueStartTime,
    venueEndDate: event.venueEndDate,
    venueEndTime: event.venueEndTime,
    startsAtUtc: event.startsAtUtc,
    endsAtUtc: event.endsAtUtc,
    capacity: event.capacity ?? null,
    status: event.status,
    eventType: event.eventType,
    organization: { id: event.organizationId, name: event.organizationName, description: undefined, website: undefined, contactEmail: undefined, organizers: [] },
    formats: event.formatIds.map(id => byId.get(id) ?? { id, name: id, slug: id, sortOrder: 0 }),
    image: event.image ? {
      id: event.image.id,
      variants: event.image.variants.map(variant => ({ ...variant }))
    } : undefined
  };
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function sameImages(left: EventManagementResponse, right: EventManagementResponse): boolean {
  if (!left.image || !right.image) return left.image === right.image;
  return left.image.id === right.image.id
    && left.image.variants.length === right.image.variants.length
    && left.image.variants.every((variant, index) =>
      variant.width === right.image!.variants[index]?.width
      && variant.height === right.image!.variants[index]?.height);
}

function same(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? [...left].sort().join('\u0000') === [...right].sort().join('\u0000')
    : left === right;
}
