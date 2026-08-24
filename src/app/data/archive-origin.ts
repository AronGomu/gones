/** A record authored in this browser carries this prefix; it is the whole routing rule (ADR 0028). */
export const LOCAL_ARCHIVE_ID_PREFIX = 'local-';

export function isLocalArchiveId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_ARCHIVE_ID_PREFIX);
}

export function newLocalArchiveId(uuid = crypto.randomUUID()): string {
  return `${LOCAL_ARCHIVE_ID_PREFIX}${uuid}`;
}
