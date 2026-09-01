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
  const normalizedMarkdown = [...markdown].filter(character => {
    const code = character.charCodeAt(0);
    return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  }).join('');
  return withSafeExternalLinks(eventMarkdown.parse(normalizedMarkdown, { async: false }));
}
