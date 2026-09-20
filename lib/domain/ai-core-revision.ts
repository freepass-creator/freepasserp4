/**
 * AI Core optimistic-concurrency bridge for ERP4 Firestore resources.
 *
 * Core treats resource revision as an opaque token. ERP4 keeps Firestore as
 * runtime authority, so the token is derived from the document updateTime
 * instead of inventing a second version counter.
 */
export function firestoreResourceRevision(seconds: number, nanoseconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 0) throw new Error('revision seconds must be a non-negative integer');
  if (!Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1_000_000_000) {
    throw new Error('revision nanoseconds must be an integer in [0, 1_000_000_000)');
  }
  return `firestore:${seconds}:${nanoseconds}`;
}

export function expectedRevisionMatches(expectedRevision: unknown, actualRevision: string): boolean {
  const expected = String(expectedRevision ?? '').trim();
  return expected === '' || expected === actualRevision;
}
