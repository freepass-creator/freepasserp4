import type { EntityRecord } from '@/lib/intake/entities';

const text = (value: unknown): string => String(value ?? '').trim();
const isDeleted = (row: EntityRecord): boolean => row._deleted === true
  || !!row.deletedAt
  || text(row.status) === 'deleted';

/**
 * 중복 정리 뒤 예전 상품 URL·로컬 찜 코드가 끊기지 않도록 tombstone의 _merged_into를 따라간다.
 * 순환·과도한 체인은 fail-closed로 null을 반환한다.
 */
export function resolveMergedProduct(
  rows: EntityRecord[],
  requestedKey: string,
  maxHops = 5,
): EntityRecord | null {
  const byKey = new Map<string, EntityRecord>();
  for (const row of rows) {
    const key = text(row._key);
    const code = text(row.product_code);
    if (key) byKey.set(key, row);
    if (code && !byKey.has(code)) byKey.set(code, row);
  }
  let key = text(requestedKey);
  const visited = new Set<string>();
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!key || visited.has(key)) return null;
    visited.add(key);
    const row = byKey.get(key);
    if (!row) return null;
    if (!isDeleted(row)) return row;
    key = text(row._merged_into);
  }
  return null;
}
