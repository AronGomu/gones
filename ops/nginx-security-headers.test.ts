import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F24 — nginx `add_header` inheritance is level-scoped: a location that sets any header inherits
 * none from the server level. Every location that sets its own headers must therefore restate the
 * full security set, and no location may type its body by appending a Content-Type header.
 */
const root = join(__dirname, '..');
const template = readFileSync(join(root, 'deploy/nginx/default.conf.template'), 'utf8');

const securityHeaders = [
  'add_header X-Content-Type-Options nosniff always;',
  'add_header X-Frame-Options DENY always;',
  'add_header Referrer-Policy no-referrer always;',
  'add_header Cross-Origin-Opener-Policy same-origin always;',
  'add_header Cross-Origin-Resource-Policy same-origin always;',
  `add_header Permissions-Policy "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()" always;`,
  'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;',
  `add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' \${GONES_API_ORIGIN}; worker-src 'self'; manifest-src 'self'; object-src 'none'; media-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;`,
];

// Both anchors match a brace or keyword at the start of an indented line, never a bare substring: the
// server-level `Permissions-Policy` value contains `geolocation=()` and every CSP line contains
// `${GONES_API_ORIGIN}`, so `indexOf('location')` and `indexOf('}')` would both land inside a header value.
const locationBlock = (matcher: string): string => {
  const start = template.indexOf(matcher);
  expect(start).toBeGreaterThan(-1);
  const end = template.indexOf('\n  }', start);
  expect(end).toBeGreaterThan(start);
  return template.slice(start, end + 4);
};

describe('nginx security headers', () => {
  it('the server level sets the full security header set', () => {
    const serverLevel = template.slice(0, template.indexOf('\n  location'));
    for (const header of securityHeaders) expect(serverLevel).toContain(header);
  });

  it('the runtime-config location restates every server-level security header', () => {
    const block = locationBlock('location = /runtime-config.json {');
    for (const header of securityHeaders) expect(block).toContain(header);
    expect(block).toContain('add_header Cache-Control "no-store" always;');
    expect(block).toContain('default_type application/json;');
  });

  it('the health location restates every server-level security header', () => {
    const block = locationBlock('location = /health {');
    for (const header of securityHeaders) expect(block).toContain(header);
    expect(block).toContain('access_log off;');
    expect(block).toContain('default_type text/plain;');
    expect(block).toContain("return 200 'live';");
  });

  it('allows Blob-backed Event image previews only through img-src', () => {
    const policies = template.match(/add_header Content-Security-Policy "[^"]+" always;/g) ?? [];
    expect(policies).toHaveLength(3);
    for (const policy of policies) {
      expect(policy).toContain("img-src 'self' data: blob:");
      expect(policy.replace("img-src 'self' data: blob:", '')).not.toContain('blob:');
    }
  });

  it('no location sets Content-Type by appending a header', () => {
    expect(template).not.toMatch(/add_header\s+Content-Type/);
    for (const header of securityHeaders) {
      const name = header.split(' ')[1];
      const occurrences = template.match(new RegExp(`add_header ${name} `, 'g')) ?? [];
      expect(occurrences).toHaveLength(3);
    }
  });
});
