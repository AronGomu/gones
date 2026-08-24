import { describe, expect, it } from 'vitest';
import { LOCAL_ARCHIVE_ID_PREFIX, isLocalArchiveId, newLocalArchiveId } from './archive-origin';

describe('archive id origin', () => {
  it('the local prefix is exactly local-', () => {
    expect(LOCAL_ARCHIVE_ID_PREFIX).toBe('local-');
  });

  it('a prefixed id is local', () => {
    expect(isLocalArchiveId('local-abc')).toBe(true);
  });

  it('a server id is not local', () => {
    expect(isLocalArchiveId('7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11')).toBe(false);
  });

  it('nullish ids are not local', () => {
    expect(isLocalArchiveId(null)).toBe(false);
    expect(isLocalArchiveId(undefined)).toBe(false);
    expect(isLocalArchiveId('')).toBe(false);
  });

  it('a generated id is local', () => {
    expect(isLocalArchiveId(newLocalArchiveId())).toBe(true);
  });

  it('generated ids are unique', () => {
    expect(new Set(Array.from({ length: 100 }, () => newLocalArchiveId())).size).toBe(100);
  });
});
