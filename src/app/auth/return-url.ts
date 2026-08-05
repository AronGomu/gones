/**
 * Open-redirect guard for `returnUrl`-style query parameters.
 *
 * Only a same-origin, absolute in-app path is accepted. Everything else — absolute URLs,
 * protocol-relative `//host`, backslash variants browsers normalise to `//`, scheme-ish values, and
 * control characters — falls back to the caller's safe default.
 */
export function safeReturnUrl(candidate: string | null | undefined, fallback: string): string {
  if (typeof candidate !== 'string') return fallback;
  const value = candidate.trim();
  if (value.length === 0 || value.length > 2048) return fallback;
  // Expressed as code-point arithmetic rather than a regex so the intent survives lint rules that
  // forbid literal control characters in patterns.
  if (hasControlCharacter(candidate)) return fallback;
  // Reject backslashes outright: `/\evil.test` and `\\evil.test` are treated as `//` by browsers.
  if (value.includes('\\')) return fallback;
  // Must be an absolute in-app path, and must not be protocol-relative.
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

/** True when the value contains an ASCII control character (C0 range or DEL). */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
