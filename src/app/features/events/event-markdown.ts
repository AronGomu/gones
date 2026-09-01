import { Marked } from 'marked';
import { withSafeExternalLinks } from './server-sanitized-html.component';

const renderer = {
  heading(this: { parser: { parseInline(tokens: unknown[]): string } }, token: { tokens: unknown[]; depth: number }): string {
    const depth = Math.min(4, token.depth + 1);
    return `<h${depth}>${this.parser.parseInline(token.tokens)}</h${depth}>`;
  },
  html(): string {
    return '';
  },
  image(): string {
    return '';
  }
};

const eventMarkdown = new Marked({
  gfm: true,
  breaks: false,
  pedantic: false,
  renderer
});

export function renderEventMarkdown(markdown: string): string {
  if (!markdown.trim()) return '';
  return withSafeExternalLinks(eventMarkdown.parse(markdown, { async: false }));
}
