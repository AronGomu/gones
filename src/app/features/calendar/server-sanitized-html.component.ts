import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

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
    // API contract guarantees sanitized bodyHtml. Trust stays isolated here; this is not client-side sanitization.
    return this.sanitizer.bypassSecurityTrustHtml(body);
  });
}

export function withSafeExternalLinks(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(href)) continue;
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  return document.body.innerHTML;
}
