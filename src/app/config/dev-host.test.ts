import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { canonicalDevHostUrl } from './dev-host';

describe('canonicalDevHostUrl', () => {
  it('moves a localhost page to the API loopback host so the refresh cookie is sent', () => {
    expect(canonicalDevHostUrl('http://localhost:4200/events?view=list#today', 'http://127.0.0.1:5080', false))
      .toBe('http://127.0.0.1:4200/events?view=list#today');
  });

  it('leaves a page already on the API host alone', () => {
    expect(canonicalDevHostUrl('http://127.0.0.1:4200/events', 'http://127.0.0.1:5080', false)).toBeUndefined();
  });

  it('never redirects a production build', () => {
    expect(canonicalDevHostUrl('http://localhost:4200/', 'http://127.0.0.1:5080', true)).toBeUndefined();
  });

  it('never redirects away from a non-loopback host', () => {
    expect(canonicalDevHostUrl('https://gones.example/', 'http://127.0.0.1:5080', false)).toBeUndefined();
    expect(canonicalDevHostUrl('http://localhost:4200/', 'https://api.gones.example', false)).toBeUndefined();
  });

  it('ignores an API base URL it cannot parse', () => {
    expect(canonicalDevHostUrl('http://localhost:4200/', '/api', false)).toBeUndefined();
  });
});
