import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { withSafeExternalLinks } from './server-sanitized-html.component';

function parse(html: string): Document {
  return new DOMParser().parseFromString(withSafeExternalLinks(html), 'text/html');
}

describe('server sanitized tournament body', () => {
  it('adds safe attributes to external links without acting as server sanitizer', () => {
    const document = parse('<p><a href="https://example.test/info">Info</a> <a href="/calendar">Calendar</a></p>');
    const links = document.querySelectorAll('a');

    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1].hasAttribute('target')).toBe(false);
  });

  it('keeps the allowlisted formatting the server may emit', () => {
    const html = withSafeExternalLinks('<p>Hello <strong>world</strong> <em>now</em></p><h2>Rules</h2><ul><li>One</li></ul>');

    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<h2>Rules</h2>');
    expect(html).toContain('<li>One</li>');
  });

  it.each([
    ['<script>window.__pwned = true;</script>', 'script element'],
    ['<img src=x onerror="window.__pwned = true">', 'image with error handler'],
    ['<iframe src="https://evil.test"></iframe>', 'iframe'],
    ['<object data="evil.swf"></object>', 'object'],
    ['<svg onload="window.__pwned = true"></svg>', 'svg with load handler'],
    ['<style>body{display:none}</style>', 'style element'],
    ['<form action="https://evil.test"><input name="a"></form>', 'form']
  ])('drops %s (%s) even when the API is compromised', (payload) => {
    const html = withSafeExternalLinks(`<p>Before</p>${payload}<p>After</p>`);

    expect(html).toContain('<p>Before</p>');
    expect(html).toContain('<p>After</p>');
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('<iframe');
    expect(html.toLowerCase()).not.toContain('<svg');
    expect(html.toLowerCase()).not.toContain('<style');
    expect(html.toLowerCase()).not.toContain('<form');
    expect(html.toLowerCase()).not.toContain('onerror');
    expect(html.toLowerCase()).not.toContain('onload');
  });

  it('strips event handlers and styling from otherwise allowed elements', () => {
    const html = withSafeExternalLinks('<p onclick="window.__pwned = true" style="color:red" class="x">Text</p>');

    expect(html).toBe('<p>Text</p>');
  });

  it('strips javascript: and data: hrefs while keeping safe ones', () => {
    const dangerous = parse('<p><a href="javascript:alert(1)">Bad</a><a href="data:text/html,<script>x</script>">Worse</a></p>');
    const safe = parse('<p><a href="https://example.test">Good</a></p>');

    expect(dangerous.querySelectorAll('a[href]')).toHaveLength(0);
    expect(dangerous.body.textContent).toContain('Bad');
    expect(safe.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
  });

  it('sanitizes nested payloads, not just top-level ones', () => {
    const html = withSafeExternalLinks('<ul><li><a href="https://example.test" onmouseover="window.__pwned = true">Link</a><img src=x onerror="alert(1)"></li></ul>');

    expect(html.toLowerCase()).not.toContain('onmouseover');
    expect(html.toLowerCase()).not.toContain('onerror');
    expect(html.toLowerCase()).not.toContain('<img');
    expect(html).toContain('href="https://example.test"');
  });
});
