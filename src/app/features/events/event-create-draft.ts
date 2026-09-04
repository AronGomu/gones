import { Injectable } from '@angular/core';
import { EventImageUploadResponse } from '../../api/generated/gones-api';
import { logBoundaryError } from '../../shared/app-logger';

export const EVENT_CREATE_DRAFT_KEY_PREFIX = 'gones.event-create.draft.';
export const EVENT_CREATE_DRAFT_VERSION = 1;

export interface EventDraftValueV1 {
  organizationId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  region: string;
  timeZoneId: string;
  eventType: '' | 'weekly' | 'monthly' | 'major';
  startDate: string;
  startTime: string;
  capacity: number | null;
  formatId: string;
}

export interface StoredEventCreateDraftV1 {
  version: 1;
  userId: string;
  savedAt: string;
  value: EventDraftValueV1;
  image?: EventImageUploadResponse;
}

export type RestoredEventCreateDraft = StoredEventCreateDraftV1;

export interface EventDirtyShape {
  value: EventDraftValueV1;
  imageId: string | null;
  imageInteraction: string | null;
}

const eventTypes = new Set<EventDraftValueV1['eventType']>(['', 'weekly', 'monthly', 'major']);
const MaximumImagePixels = 25_000_000;
const StandardImageVariantWidths = [320, 960, 1600] as const;
const CanonicalGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EmptyGuid = '00000000-0000-0000-0000-000000000000';
export function eventCreateDraftKey(userId: string): string {
  return `${EVENT_CREATE_DRAFT_KEY_PREFIX}${userId}`;
}

export function normalizeEventDraftValue(value: EventDraftValueV1): EventDraftValueV1 {
  return {
    organizationId: value.organizationId.trim(),
    title: value.title.trim(),
    summary: value.summary.trim(),
    bodyMarkdown: value.bodyMarkdown.trim() ? value.bodyMarkdown : '',
    streetAddress: value.streetAddress.trim(),
    postalCode: value.postalCode.trim(),
    city: value.city.trim(),
    country: value.country.trim(),
    region: value.region.trim(),
    timeZoneId: value.timeZoneId.trim(),
    eventType: value.eventType,
    startDate: value.startDate.trim(),
    startTime: value.startTime.trim(),
    capacity: value.capacity,
    formatId: value.formatId.trim()
  };
}

export function parseEventCreateDraft(raw: string | null, userId: string, nowMs: number): RestoredEventCreateDraft | null {
  if (raw === null) return null;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!isRecord(candidate)
      || candidate['version'] !== EVENT_CREATE_DRAFT_VERSION
      || candidate['userId'] !== userId
      || typeof candidate['savedAt'] !== 'string'
      || !Number.isFinite(Date.parse(candidate['savedAt']))
      || !isDraftValue(candidate['value'])) return null;
    const restored: RestoredEventCreateDraft = {
      version: EVENT_CREATE_DRAFT_VERSION,
      userId,
      savedAt: candidate['savedAt'],
      value: normalizeEventDraftValue(candidate['value'])
    };
    const image = temporaryImage(candidate['image'], nowMs);
    if (image) restored.image = image;
    return restored;
  } catch {
    return null;
  }
}

export function eventDraftIsDirty(baseline: EventDirtyShape, current: EventDirtyShape): boolean {
  return baseline.imageId !== current.imageId
    || baseline.imageInteraction !== current.imageInteraction
    || JSON.stringify(normalizeEventDraftValue(baseline.value)) !== JSON.stringify(normalizeEventDraftValue(current.value));
}

export function eventCreateDraftIsEmpty(value: EventDraftValueV1, defaultOrganizationId: string): boolean {
  const normalized = normalizeEventDraftValue(value);
  return (normalized.organizationId === '' || normalized.organizationId === defaultOrganizationId)
    && normalized.title === ''
    && normalized.summary === ''
    && normalized.bodyMarkdown === ''
    && normalized.streetAddress === ''
    && normalized.postalCode === ''
    && normalized.city === ''
    && normalized.country === ''
    && normalized.region === ''
    && normalized.timeZoneId === ''
    && (normalized.eventType === '' || normalized.eventType === 'weekly')
    && normalized.startDate === ''
    && normalized.startTime === ''
    && normalized.capacity === null
    && normalized.formatId === '';
}

@Injectable({ providedIn: 'root' })
export class EventCreateDraftStore {
  read(userId: string): RestoredEventCreateDraft | null {
    let raw: string | null;
    try {
      raw = globalThis.localStorage.getItem(eventCreateDraftKey(userId));
    } catch (error) {
      logBoundaryError('event-create-draft.read', error, { userId });
      return null;
    }
    const restored = parseEventCreateDraft(raw, userId, Date.now());
    if (raw !== null && !restored) {
      logBoundaryError('event-create-draft.read', new Error('invalidEventCreateDraft'), { userId });
      this.remove(userId);
    }
    return restored;
  }

  write(draft: StoredEventCreateDraftV1): void {
    try {
      const image = temporaryImage(draft.image, Date.now());
      globalThis.localStorage.setItem(eventCreateDraftKey(draft.userId), JSON.stringify({
        version: EVENT_CREATE_DRAFT_VERSION,
        userId: draft.userId,
        savedAt: draft.savedAt,
        value: normalizeEventDraftValue(draft.value),
        ...(image ? { image } : {})
      }));
    } catch (error) {
      logBoundaryError('event-create-draft.write', error, { userId: draft.userId });
    }
  }

  remove(userId: string): void {
    try {
      globalThis.localStorage.removeItem(eventCreateDraftKey(userId));
    } catch (error) {
      logBoundaryError('event-create-draft.remove', error, { userId });
    }
  }
}

function isDraftValue(value: unknown): value is EventDraftValueV1 {
  if (!isRecord(value)) return false;
  for (const field of [
    'organizationId', 'title', 'summary', 'bodyMarkdown', 'streetAddress', 'postalCode', 'city',
    'country', 'region', 'timeZoneId', 'startDate', 'startTime', 'formatId'
  ]) if (typeof value[field] !== 'string') return false;
  return eventTypes.has(value['eventType'] as EventDraftValueV1['eventType'])
    && (value['capacity'] === null || (typeof value['capacity'] === 'number' && Number.isFinite(value['capacity'])));
}

function temporaryImage(value: unknown, nowMs: number): EventImageUploadResponse | null {
  if (!isRecord(value)
    || typeof value['id'] !== 'string'
    || !CanonicalGuid.test(value['id'])
    || value['id'] === EmptyGuid
    || value['state'] !== 'Temporary'
    || !isPositiveInteger(value['width'])
    || !isPositiveInteger(value['height'])
    || value['width'] * value['height'] > MaximumImagePixels
    || typeof value['expiresAt'] !== 'string'
    || !Array.isArray(value['variants'])
    || !Number.isFinite(Date.parse(value['expiresAt']))
    || nowMs >= Date.parse(value['expiresAt'])) return null;
  const sourceWidth = value['width'];
  const expectedWidths = sourceWidth < StandardImageVariantWidths[0]
    ? [sourceWidth]
    : StandardImageVariantWidths.filter(width => width <= sourceWidth);
  if (value['variants'].length !== expectedWidths.length) return null;
  const variants: EventImageUploadResponse['variants'] = [];
  for (let index = 0; index < expectedWidths.length; index++) {
    const variant = value['variants'][index];
    if (!isImageVariant(variant, value['id'], expectedWidths[index], value['height'])) return null;
    variants.push({ width: variant.width, height: variant.height, url: variant.url });
  }
  return {
    id: value['id'],
    state: 'Temporary',
    width: value['width'],
    height: value['height'],
    expiresAt: value['expiresAt'],
    variants
  };
}

function isImageVariant(value: unknown, imageId: string, expectedWidth: number, sourceHeight: number): value is EventImageUploadResponse['variants'][number] {
  return isRecord(value)
    && value['width'] === expectedWidth
    && isPositiveInteger(value['height'])
    && value['height'] <= sourceHeight
    && value['url'] === `/api/event-images/${imageId}/variants/${expectedWidth}`;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
