import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderEventMarkdown } from './event-markdown';

interface GoldenCase {
  name: string;
  markdown?: string;
  markdownCodeUnits?: number[];
  html: string;
}

const cases = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'fixtures', 'event-markdown-golden.json'), 'utf8')) as GoldenCase[];

describe('Event Markdown renderer', () => {
  it.each(cases)('$name', ({ markdown, markdownCodeUnits, html }) => {
    expect(renderEventMarkdown(markdown ?? String.fromCharCode(...markdownCodeUnits!))).toBe(html);
  });

  it('never returns executable raw HTML, Markdown images or unsafe link targets', () => {
    const html = renderEventMarkdown('<img src=x onerror=alert(1)>\n\n![x](javascript:alert(2))\n\n[link](javascript:alert(3))');

    expect(html).not.toMatch(/<img|onerror|javascript:/i);
    expect(html).toContain('link');
  });
});
