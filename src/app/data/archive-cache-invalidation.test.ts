import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ArchiveRepository } from './archive-repository.service';

/**
 * The gap this file closes: invalidation *working* and invalidation *staying wired* are two
 * different properties, and only the first one was ever observable. Nothing at all would have gone
 * red the day a mutating method was added to `ArchiveRepository` without routing through the funnel.
 *
 * So this is deliberately not a list of method names. It reads the class back out of its own source,
 * cross-checks that reading against the runtime prototype so a parse miss cannot pass for a clean
 * sheet, and then holds every member that is not visibly a read to the funnel. A method added
 * tomorrow is guilty until its author either routes it or names it as a read.
 *
 * `ArchiveRepository` is read-only today — the whole `/archive/**` surface reads and never writes —
 * so there is no private mutation wrapper to find. That is why the wrapper is *optional* here rather
 * than mandatory: an uncalled wrapper would be dead code standing in for a guarantee. What is not
 * optional is the coverage rule, and that one bites the moment a mutating method appears.
 */

const dataRoot = dirname(fileURLToPath(import.meta.url));
const repositoryPath = join(dataRoot, 'archive-repository.service.ts');
const repositorySource = readFileSync(repositoryPath, 'utf8');
const shellSource = readFileSync(join(dataRoot, '..', 'app.component.ts'), 'utf8');

const CLASS_HEADER = 'export class ArchiveRepository {';
const FUNNEL = 'invalidateArchiveCaches';

/**
 * Read verbs. A member whose name starts with one of these is a read and is exempt. Everything else
 * is presumed to mutate — that presumption is the whole point, and widening this list is the one way
 * to weaken this file, so widen it only for a member that genuinely reads.
 */
// `export` joins the read verbs for `exportBundle`, which assembles a bundle out of the browser-local
// store and writes nothing. `restoreBundle`, its mutating twin, deliberately does not match any of
// these and so is still held to the funnel.
const READ_PREFIXES = ['list', 'get', 'load', 'read', 'find', 'count', 'has', 'is', 'export'];

interface Member {
  name: string;
  isPrivate: boolean;
  isGetter: boolean;
  body: string;
}

/** From the `open` character at `from` to the character that balances it, inclusive. */
function balancedFrom(source: string, from: number, open: string, close: string): { text: string; end: number } {
  const start = source.indexOf(open, from);
  expect(start, `no "${open}" after index ${from}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === open) depth++;
    else if (source[index] === close && --depth === 0) return { text: source.slice(start, index + 1), end: index };
  }
  throw new Error(`unbalanced "${open}" after index ${from}`);
}

/** From the first `{` at or after `from` to the `}` that balances it. */
function blockAt(source: string, from: number): string {
  return balancedFrom(source, from, '{', '}').text;
}

function classBody(): string {
  const at = repositorySource.indexOf(CLASS_HEADER);
  expect(at, CLASS_HEADER).toBeGreaterThan(-1);
  return blockAt(repositorySource, at);
}

/**
 * Every method declared at class-body indentation. Fields and accessors of the `x = signal()` kind
 * are not methods and are not returned.
 *
 * The parameter list is skipped before the body is taken: `listLeagues(options: { force?: boolean })`
 * opens a brace that is a type, not a body, and reading that as the body would report a method as
 * skipping the funnel for a reason that has nothing to do with the funnel.
 */
function members(): Member[] {
  const body = classBody();
  const header = /\n {2}(?<modifiers>(?:private |protected |public |static |readonly |async |get |set )*)(?<name>[A-Za-z_$][\w$]*)\s*(?:<[^<>]*>)?\(/g;
  const found: Member[] = [];
  for (const match of body.matchAll(header)) {
    const modifiers = match.groups?.['modifiers'] ?? '';
    const name = match.groups?.['name'] ?? '';
    const parameters = balancedFrom(body, (match.index ?? 0) + match[0].length - 1, '(', ')');
    found.push({
      name,
      isPrivate: modifiers.includes('private ') || modifiers.includes('protected '),
      isGetter: modifiers.includes('get '),
      body: blockAt(body, parameters.end)
    });
  }
  return found;
}

function memberNamed(name: string): Member {
  const member = members().find((candidate) => candidate.name === name);
  expect(member, `member ${name}`).toBeDefined();
  return member!;
}

/**
 * The wrapper is discovered, never named: this file must not care what a private mutation helper is
 * called, only that there is at most one of them and that it invalidates after the write.
 */
function wrapperOrNone(): Member | undefined {
  const carriers = members().filter((member) => member.name !== FUNNEL && member.body.includes(`this.${FUNNEL}()`));
  expect(carriers.map((member) => member.name), 'members calling the funnel').not.toHaveLength(2);
  return carriers[0];
}

describe('archive cache invalidation', () => {
  it('the source parse sees every member the prototype has', () => {
    const parsed = new Set(members().map((member) => member.name));
    const runtime = Object.getOwnPropertyNames(ArchiveRepository.prototype).filter((name) => name !== 'constructor');
    expect(runtime.filter((name) => !parsed.has(name))).toEqual([]);
  });

  it('declares no arrow-function member', () => {
    // An arrow property is on the instance, not the prototype, and its header does not match the
    // member scanner — it would be invisible to both halves of this file at once.
    const arrowMember = /\n {2}(?:private |protected |public |readonly |static )*[A-Za-z_$][\w$]*(?:\s*:[^=\n]+)?\s*=\s*(?:async\s*)?\(/;
    expect(classBody()).not.toMatch(arrowMember);
  });

  it('carries at most one private wrapper for the invalidation', () => {
    // Zero today: the repository reads and never writes. One the day a mutation lands and its author
    // routes it through a shared helper. Two would mean two answers to "did this write invalidate?".
    const wrapper = wrapperOrNone();
    if (wrapper) expect(wrapper.isPrivate).toBe(true);
  });

  it('every mutating method reaches the invalidation funnel', () => {
    const wrapper = wrapperOrNone();
    const offenders = members()
      .filter((member) => !member.isPrivate && !member.isGetter)
      .filter((member) => member.name !== FUNNEL && member.name !== wrapper?.name)
      .filter((member) => !READ_PREFIXES.some((prefix) => member.name.startsWith(prefix)))
      .filter((member) => !(wrapper && member.body.includes(`this.${wrapper.name}(`)) && !member.body.includes(`this.${FUNNEL}()`))
      .map((member) => member.name);
    expect(offenders, 'mutating methods that skip the invalidation funnel').toEqual([]);
  });

  it('invalidateArchiveCaches clears the stores before it announces', () => {
    const body = memberNamed(FUNNEL).body;
    expect(body).toContain('this.cache.clearAll()');
    expect(body).toContain('new CustomEvent(ARCHIVE_UPDATED_EVENT)');
    expect(body.indexOf('this.cache.clearAll()')).toBeLessThan(body.indexOf('ARCHIVE_UPDATED_EVENT'));
  });

  it('announces with no payload', () => {
    // Listeners re-read. A payload would invite one of them to trust it and skip the read.
    expect(memberNamed(FUNNEL).body).not.toContain('detail:');
  });

  it('a wrapper, if one exists, invalidates only after the write', () => {
    const wrapper = wrapperOrNone();
    if (!wrapper) return;
    expect(wrapper.body.indexOf('await action()')).toBeGreaterThan(-1);
    expect(wrapper.body.indexOf('await action()')).toBeLessThan(wrapper.body.indexOf(`this.${FUNNEL}()`));
  });

  it('the repository never touches IndexedDB directly', () => {
    // `server-authority-boundary.test.ts` holds an exact allowlist of files that may. This one is
    // not on it, and clearing goes through `archive-cache.service.ts`, which is.
    expect(repositorySource).not.toMatch(/\bindexedDB\b/);
    expect(repositorySource).not.toMatch(/\bIDB[A-Z]\w*/);
  });

  it('the app shell listens for the archive announcement', () => {
    expect(shellSource).toContain('window.addEventListener(ARCHIVE_UPDATED_EVENT');
  });

  it('listens for no retired League announcement', () => {
    // T19 retired the legacy pages that dispatched this, so the shell must not still be listening:
    // a surviving listener would be a second, silent invalidation path with nothing feeding it.
    expect(shellSource).not.toContain('gones-league-updated');
  });
});
