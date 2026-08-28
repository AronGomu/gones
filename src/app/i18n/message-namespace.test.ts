import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { catalogs } from './messages';

const en = catalogs.en;
const fr = catalogs.fr;

const CATALOG_PATH = 'src/app/i18n/messages.ts';
/**
 * Allowlist for keys no literal reference can ever prove used, because the key is composed at
 * runtime. Both families come from `organizer-event-create.component.ts`: `eventManage.major.*`
 * via `` this.i18n.t(`eventManage.major.${field}`) `` and `eventManage.field.*` via
 * `` this.i18n.t(`eventManage.field.${field}`) ``. Nothing else in the repo composes a message
 * key, so nothing else belongs here — add an entry only alongside a new composing call site.
 */
const DYNAMIC_KEY_PREFIXES = [/^eventManage\.major\./, /^eventManage\.field\./];

/**
 * Every quote-delimited token in `blob`, collected in one pass. The lookahead leaves the closing
 * quote unconsumed so it also opens the next token, which splits a run like `'a'b'` into `a` and
 * `b` — exactly the occurrences a per-key `['"`]key['"`]` search would find. Same answer as one
 * regex scan per key, without scanning the 18 MB blob 1168 times.
 */
function quotedTokens(blob: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of blob.matchAll(/['"`]([^'"`]*)(?=['"`])/g)) {
    tokens.add(match[1]);
  }
  return tokens;
}

function orphanMessageKeys(): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(file => file && file !== CATALOG_PATH);
  const blob = files
    .map(file => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
  const referenced = quotedTokens(blob);
  return Object.keys(en)
    .filter(key => !DYNAMIC_KEY_PREFIXES.some(prefix => prefix.test(key)))
    .filter(key => !referenced.has(key))
    .sort();
}

describe('message namespace', () => {
  it('has no calendar namespace', () => {
    for (const key of Object.keys(en)) {
      expect(key).not.toMatch(/^calendar\./);
    }
    for (const key of Object.keys(fr)) {
      expect(key).not.toMatch(/^calendar\./);
    }
  });

  it('en and fr have identical key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });

  it('keeps both load-failure messages', () => {
    expect((en as Record<string, string>)['event.loadFailed']).toBeDefined();
    expect((en as Record<string, string>)['event.listLoadFailed']).toBeDefined();
    expect((en as Record<string, string>)['event.loadFailed']).not.toEqual(
      (en as Record<string, string>)['event.listLoadFailed'],
    );
  });

  // Reads every tracked file, so it is I/O bound and slows down with the machine, not with the
  // code under test. The default 5s timeout made it flake on a loaded runner; this is headroom,
  // not an expected duration.
  it('every key is referenced outside the catalog', () => {
    expect(orphanMessageKeys()).toEqual([]);
  }, 30_000);
});
