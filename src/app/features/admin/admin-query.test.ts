import { ParamMap } from '@angular/router';
import { pagedQueryParams, readPagedQuery, totalPages } from './admin-query';

function params(values: Record<string, string>): ParamMap {
  return {
    keys: Object.keys(values),
    has: (name: string) => Object.prototype.hasOwnProperty.call(values, name),
    get: (name: string) => values[name] ?? null,
    getAll: (name: string) => values[name] ? [values[name]] : []
  };
}

describe('admin query helpers', () => {
  it('reads paged filters from URL params', () => {
    expect(readPagedQuery(params({ search: ' ada ', page: '2', pageSize: '50' }))).toEqual({
      search: 'ada',
      page: 2,
      pageSize: 50
    });
  });

  it('omits default page values from query params', () => {
    expect(pagedQueryParams({ search: '', page: 1, pageSize: 20 })).toEqual({});
    expect(pagedQueryParams({ search: 'x', page: 3, pageSize: 20 }, { action: 'login' })).toEqual({
      action: 'login',
      search: 'x',
      page: 3
    });
  });

  it('computes total pages', () => {
    expect(totalPages(0, 20)).toBe(1);
    expect(totalPages(21, 20)).toBe(2);
  });
});
