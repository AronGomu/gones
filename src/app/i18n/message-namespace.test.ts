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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  return Object.keys(en)
    .filter(key => !DYNAMIC_KEY_PREFIXES.some(prefix => prefix.test(key)))
    .filter(key => !new RegExp(`['"\`]${escapeRegExp(key)}['"\`]`).test(blob))
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

  it('every key is referenced outside the catalog', () => {
    expect(orphanMessageKeys()).toEqual([]);
  });
});
