import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/** Server renderer remains authority; client repeats exact allowlist before trusting derived HTML. */
const ALLOWED_ELEMENTS = new Set([
  'p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a', 'blockquote',
  'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'input'
]);
const ALLOWED_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'target', 'rel']),
  input: new Set(['type', 'disabled', 'checked'])
};

@Component({
  selector: 'gones-server-sanitized-html',
  standalone: true,
  template: `<div class="rich-content" data-cy="server-sanitized-html" [innerHTML]="trustedHtml()"></div>`
})
export class ServerSanitizedHtmlComponent {
  readonly html = input.required<string>();
  private readonly sanitizer = inject(DomSanitizer);

  readonly trustedHtml = computed<SafeHtml>(() => {
    const body = withSafeExternalLinks(this.html());
    return this.sanitizer.bypassSecurityTrustHtml(body);
  });
}

export function withSafeExternalLinks(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  scrub(document.body, document);
  for (const anchor of Array.from(document.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href') ?? '';
    anchor.removeAttribute('target');
    anchor.removeAttribute('rel');
    if (!isAllowedHref(href)) {
      anchor.removeAttribute('href');
      continue;
    }
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return document.body.innerHTML;
}

function scrub(root: Element, document: Document): void {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (/^[\t\r\n ]+$/.test(node.textContent ?? '') && /[\r\n]/.test(node.textContent ?? '') && !['pre', 'code'].includes(root.tagName.toLowerCase())) {
        node.remove();
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      continue;
    }
    const element = node as Element;
    const name = element.tagName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name)) {
      element.replaceWith(document.createTextNode(element.textContent ?? ''));
      continue;
    }
    const allowed = ALLOWED_ATTRIBUTES[name] ?? new Set<string>();
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      if (!allowed.has(attributeName)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (attributeName === 'href' && !isAllowedHref(attribute.value)) element.removeAttribute(attribute.name);
    }
    if (name === 'input' && !normalizeCheckbox(element)) {
      element.remove();
      continue;
    }
    scrub(element, document);
  }
}

function normalizeCheckbox(element: Element): boolean {
  const isCheckbox = element.getAttribute('type')?.toLowerCase() === 'checkbox';
  const disabled = element.hasAttribute('disabled');
  const checked = element.hasAttribute('checked');
  if (!isCheckbox || !disabled) return false;
  for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  element.setAttribute('type', 'checkbox');
  element.setAttribute('disabled', '');
  if (checked) element.setAttribute('checked', '');
  return true;
}

function isAllowedHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith('/');
}
