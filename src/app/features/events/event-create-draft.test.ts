import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventImageUploadResponse } from '../../api/generated/gones-api';
import {
  EVENT_CREATE_DRAFT_KEY_PREFIX,
  EVENT_CREATE_DRAFT_VERSION,
  EventCreateDraftStore,
  EventDraftValueV1,
  eventCreateDraftIsEmpty,
  eventCreateDraftKey,
  eventDraftIsDirty,
  normalizeEventDraftValue,
  parseEventCreateDraft
} from './event-create-draft';

const value = (patch: Partial<EventDraftValueV1> = {}): EventDraftValueV1 => ({
  organizationId: 'org-1', title: 'Cup', summary: '', bodyMarkdown: '', streetAddress: '1 Rue Test',
  postalCode: '69001', city: 'Lyon', country: 'France', region: 'Rhône', timeZoneId: 'Europe/Paris',
  eventType: 'weekly', startDate: '2027-08-01', startTime: '10:00', capacity: 32, formatId: 'fmt-1',
  ...patch
});

const image = (expiresAt = '2030-01-02T12:00:00Z'): EventImageUploadResponse => ({
  id: 'image-1', state: 'Temporary', width: 960, height: 540, expiresAt,
  variants: [{ width: 320, height: 180, url: '/api/event-images/image-1/variants/320' }]
});

const raw = (userId: string, patch: Record<string, unknown> = {}) => JSON.stringify({
  version: EVENT_CREATE_DRAFT_VERSION,
  userId,
  savedAt: '2020-01-01T00:00:00Z',
  value: value(),
  image: image(),
  ...patch
});

describe('Event create draft codec', () => {
  beforeEach(() => localStorage.clear());

  it('uses one exact account-scoped v1 key and restores old durable manual location data without age expiry', () => {
    expect(eventCreateDraftKey('u1')).toBe(`${EVENT_CREATE_DRAFT_KEY_PREFIX}u1`);

    const restored = parseEventCreateDraft(raw('u1'), 'u1', Date.parse('2029-01-01T00:00:00Z'));

    expect(restored).toEqual({
      version: 1,
      userId: 'u1',
      savedAt: '2020-01-01T00:00:00Z',
      value: value(),
      image: image()
    });
  });

  it('rejects malformed, unknown-version, and owner-mismatched payloads', () => {
    expect(parseEventCreateDraft('{', 'u1', Date.now())).toBeNull();
    expect(parseEventCreateDraft(raw('u1', { version: 2 }), 'u1', Date.now())).toBeNull();
    expect(parseEventCreateDraft(raw('u2'), 'u1', Date.now())).toBeNull();
  });

  it('omits an expired or invalid Temporary image while retaining scalar draft data', () => {
    const now = Date.parse('2030-01-02T12:00:00Z');
    expect(parseEventCreateDraft(raw('u1'), 'u1', now)).toEqual(expect.objectContaining({ value: value() }));
    expect(parseEventCreateDraft(raw('u1'), 'u1', now)?.image).toBeUndefined();
    expect(parseEventCreateDraft(raw('u1', { image: { ...image('2031-01-01T00:00:00Z'), state: 'Owned' } }), 'u1', now)?.image).toBeUndefined();
  });

  it.each([
    ['empty id', { ...image(), id: '' }],
    ['non-positive source width', { ...image(), width: 0 }],
    ['non-finite source height', { ...image(), height: 'NaN' }],
    ['empty variant url', { ...image(), variants: [{ width: 320, height: 180, url: '  ' }] }],
    ['non-positive variant dimension', { ...image(), variants: [{ width: 320, height: -1, url: '/api/event-images/image-1/variants/320' }] }],
    ['variant larger than source', { ...image(), variants: [{ width: 961, height: 541, url: '/api/event-images/image-1/variants/961' }] }],
    ['duplicate variants', { ...image(), variants: [image().variants[0], image().variants[0]] }],
    ['too many variants', { ...image(), variants: [
      { width: 100, height: 50, url: '/api/event-images/image-1/variants/100' },
      { width: 200, height: 100, url: '/api/event-images/image-1/variants/200' },
      { width: 300, height: 150, url: '/api/event-images/image-1/variants/300' },
      { width: 320, height: 180, url: '/api/event-images/image-1/variants/320' }
    ] }],
    ['unexpected variant url', { ...image(), variants: [{ width: 320, height: 180, url: '/api/users/me' }] }]
  ])('omits malformed Temporary image payload (%s) while retaining other draft fields', (_label, malformedImage) => {
    const restored = parseEventCreateDraft(raw('u1', { image: malformedImage }), 'u1', Date.parse('2029-01-01T00:00:00Z'));

    expect(restored?.value).toEqual(value());
    expect(restored?.image).toBeUndefined();
  });

  it('normalizes persisted fields, treats only default organization and weekly type as empty, and compares selected image id', () => {
    const empty = value({
      title: '  ', streetAddress: '', postalCode: '', city: '', country: '', region: '', timeZoneId: '',
      startDate: '', startTime: '', capacity: null, formatId: ''
    });
    expect(eventCreateDraftIsEmpty(empty, 'org-1')).toBe(true);
    expect(eventCreateDraftIsEmpty({ ...empty, title: ' Cup ' }, 'org-1')).toBe(false);

    const baseline = { value: normalizeEventDraftValue(value({ title: ' Cup ' })), imageId: 'image-1' };
    expect(eventDraftIsDirty(baseline, { value: normalizeEventDraftValue(value({ title: 'Cup' })), imageId: 'image-1' })).toBe(false);
    expect(eventDraftIsDirty(baseline, { ...baseline, imageId: null })).toBe(true);
  });

  it('removes and logs malformed account data without exposing another account key', () => {
    localStorage.setItem(eventCreateDraftKey('u1'), raw('u2'));
    localStorage.setItem(eventCreateDraftKey('u2'), raw('u2'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new EventCreateDraftStore();

    expect(store.read('u1')).toBeNull();
    expect(localStorage.getItem(eventCreateDraftKey('u1'))).toBeNull();
    expect(localStorage.getItem(eventCreateDraftKey('u2'))).not.toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('event-create-draft.read'));
    error.mockRestore();
  });

  it('serializes only allowlisted draft and Temporary image fields', () => {
    const store = new EventCreateDraftStore();
    store.write({
      version: 1,
      userId: 'u1',
      savedAt: '2029-01-01T00:00:00Z',
      value: value(),
      image: { ...image(), accessToken: 'must-not-persist', variants: [{ ...image().variants[0], secret: 'must-not-persist' }] }
    });

    const stored = localStorage.getItem(eventCreateDraftKey('u1')) ?? '';
    expect(stored).not.toContain('accessToken');
    expect(stored).not.toContain('secret');
    expect(JSON.parse(stored).image).toEqual(image());
  });

  it('logs denied writes and removals without throwing', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new EventCreateDraftStore();
    expect(() => store.write({ version: 1, userId: 'u1', savedAt: new Date().toISOString(), value: value() })).not.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('event-create-draft.write'));
    set.mockRestore();

    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => store.remove('u1')).not.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('event-create-draft.remove'));
    remove.mockRestore();
    error.mockRestore();
  });
});
