import { describe, expect, it } from 'vitest';
import { adminCacheKey } from './admin-query';

describe('adminCacheKey', () => {
  it('keys by every query parameter', () => {
    expect(adminCacheKey('admin-users', { search: 'a', page: 2, pageSize: 20 }))
      .toBe('admin-users?page=2&pageSize=20&search=a');
  });

  it('is stable under key order', () => {
    const a = adminCacheKey('admin-users', { search: 'a', page: 2, pageSize: 20 });
    const b = adminCacheKey('admin-users', { pageSize: 20, search: 'a', page: 2 });
    expect(a).toBe(b);
  });

  it('drops undefined values', () => {
    expect(adminCacheKey('admin-audit', { action: undefined, page: 1, pageSize: 20 }))
      .toBe('admin-audit?page=1&pageSize=20');
  });

  it('returns just the family when all params are undefined', () => {
    expect(adminCacheKey('admin-users', {})).toBe('admin-users');
  });

  it('includes empty string values', () => {
    expect(adminCacheKey('admin-users', { search: '', page: 1 }))
      .toBe('admin-users?page=1&search=');
  });

  it('includes boolean values', () => {
    expect(adminCacheKey('admin-organizations', { includeDeleted: true, page: 1, pageSize: 20 }))
      .toBe('admin-organizations?includeDeleted=true&page=1&pageSize=20');
  });
});
