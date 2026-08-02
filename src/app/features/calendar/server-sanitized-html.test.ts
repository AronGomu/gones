import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { withSafeExternalLinks } from './server-sanitized-html.component';

describe('server sanitized tournament body', () => {
  it('adds safe attributes to external links without acting as server sanitizer', () => {
    const html = withSafeExternalLinks('<p><a href="https://example.test/info">Info</a> <a href="/calendar">Calendar</a></p>');
    const document = new DOMParser().parseFromString(html, 'text/html');
    const links = document.querySelectorAll('a');

    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1].hasAttribute('target')).toBe(false);
  });
});
