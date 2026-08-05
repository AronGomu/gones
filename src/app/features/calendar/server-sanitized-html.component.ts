import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Mirror of the server allowlist in `TournamentContentSanitizer` (C# `ScheduledTournament.cs`).
 * The server is the sanitizer of record; this list exists so a compromised or mis-deployed API
 * cannot turn `bypassSecurityTrustHtml` into stored XSS.
 */
const ALLOWED_ELEMENTS = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h2', 'h3', 'a']);
const ALLOWED_ATTRIBUTES: Record<string, ReadonlySet<string>> = { a: new Set(['href', 'target', 'rel']) };

@Component({
  selector: 'gones-server-sanitized-html',
  standalone: true,
  template: `<div class="rich-content" [innerHTML]="trustedHtml()"></div>`
})
export class ServerSanitizedHtmlComponent {
  readonly html = input.required<string>();
  private readonly sanitizer = inject(DomSanitizer);

  readonly trustedHtml = computed<SafeHtml>(() => {
    const body = withSafeExternalLinks(this.html());
    // API contract guarantees sanitized bodyHtml; `withSafeExternalLinks` enforces the same
    // allowlist client-side as defense in depth. Trust stays isolated to this component.
    return this.sanitizer.bypassSecurityTrustHtml(body);
  });
}

/**
 * Enforces the server allowlist and marks external links safe. Anything outside the allowlist is
 * unwrapped to its text content, and every event handler / unexpected attribute is dropped.
 */
export function withSafeExternalLinks(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  scrub(document.body, document);
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(href)) continue;
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  return document.body.innerHTML;
}

function scrub(root: Element, document: Document): void {
  for (const element of Array.from(root.children)) {
    const name = element.tagName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name)) {
      // Drop the element but keep its readable text so content is never silently lost.
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
      if (attributeName === 'href' && !/^https?:\/\//i.test(attribute.value) && !attribute.value.startsWith('/')) {
        element.removeAttribute(attribute.name);
      }
    }
    scrub(element, document);
  }
}
