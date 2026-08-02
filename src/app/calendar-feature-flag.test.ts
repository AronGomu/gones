import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { calendarRoutes } from './app.routes';

describe('calendarV1 feature routes', () => {
  it('keeps legacy routes off and switches detail plus cutover redirect on', () => {
    expect(calendarRoutes(false).map(route => [route.path, Boolean(route.redirectTo)])).toEqual([
      ['calendar', false],
      ['events/:slug', false]
    ]);
    expect(calendarRoutes(true).map(route => [route.path, Boolean(route.redirectTo)])).toEqual([
      ['calendar', false],
      ['calendar/tournaments/:slug', false],
      ['events/:slug', true]
    ]);
  });
});
