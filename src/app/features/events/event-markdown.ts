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
  const normalizedCharacters: string[] = [];
  for (let index = 0; index < markdown.length; index++) {
    const codeUnit = markdown.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = markdown.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        normalizedCharacters.push(markdown.slice(index, index + 2));
        index++;
      }
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) continue;
    if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d
      || (codeUnit >= 0x20 && codeUnit <= 0xd7ff)
      || (codeUnit >= 0xe000 && codeUnit <= 0xfffd)) {
      normalizedCharacters.push(markdown[index]);
    }
  }
  return withSafeExternalLinks(eventMarkdown.parse(normalizedCharacters.join(''), { async: false }));
}
