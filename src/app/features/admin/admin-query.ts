import { ParamMap, Params } from '@angular/router';

export interface PagedQuery {
  search: string;
  page: number;
  pageSize: number;
}

export function readPagedQuery(params: ParamMap, defaults: Partial<PagedQuery> = {}): PagedQuery {
  const page = Number(params.get('page') ?? defaults.page ?? 1);
  const pageSize = Number(params.get('pageSize') ?? defaults.pageSize ?? 20);
  return {
    search: (params.get('search') ?? defaults.search ?? '').trim(),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20
  };
}

export function pagedQueryParams(query: PagedQuery, extra: Params = {}): Params {
  const params: Params = { ...extra };
  if (query.search) params['search'] = query.search;
  if (query.page !== 1) params['page'] = query.page;
  if (query.pageSize !== 20) params['pageSize'] = query.pageSize;
  return params;
}

export function totalPages(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, totalCount) / Math.max(1, pageSize)));
}

export function adminCacheKey(family: string, params: Record<string, string | number | boolean | undefined>): string {
  const qs = Object.keys(params)
    .filter(k => params[k] !== undefined)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return qs ? `${family}?${qs}` : family;
}
