/**
 * v3 라이브 매물(products) → v4 오버레이(v4/products) 1회 일괄복사.
 *  목적: 카탈로그 소스를 v4 전용으로 전환하기 전, v3에만 있는 매물을 v4로 옮겨 유실 방지.
 *   · v4에 이미 있는 키는 건너뜀(오버레이 편집본 보존). v3 원본을 그대로 복사(읽기 때 toV4 정규화).
 *   · RTDB 금지문자(. # $ / [ ]) 키·빈 키는 건너뜀(경로 안전). v3 내부 동일 product_code 중복도 1건만.
 *   · 배치 500건씩 멀티로케이션 update. v3 라이브(products)는 절대 변경하지 않음(쓰기 대상은 v4/ 만).
 */
import { ref, get, update } from 'firebase/database';
import { getRtdb } from './client';

export type MigrateProductsResult = {
  v3Total: number;       // v3 products 총 노드 수
  v4Before: number;      // 복사 전 v4/products 수
  copied: number;        // 복사(예정) 건수
  skippedExists: number; // v4에 이미 있어 건너뜀(편집본 보존)
  skippedUnsafe: number; // 금지문자·빈 키·비객체로 건너뜀
  v4After: number;       // 복사 후 v4/products 수(dry-run이면 v4Before)
  dryRun: boolean;
};

const FORBIDDEN_KEY = /[.#$/[\]]/; // RTDB 경로 금지문자

export async function migrateV3ProductsToV4(dryRun = false): Promise<MigrateProductsResult> {
  const db = getRtdb();
  if (!db) throw new Error('DB가 설정되지 않았습니다');
  const [v3snap, v4snap] = await Promise.all([
    get(ref(db, 'products')),
    get(ref(db, 'v4/products')),
  ]);
  const v3 = (v3snap.val() as Record<string, Record<string, unknown>> | null) || {};
  const v4 = (v4snap.val() as Record<string, unknown> | null) || {};
  const v4Before = Object.keys(v4).length;
  const v3Total = Object.keys(v3).length;
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

  const updates: Record<string, unknown> = {};
  let copied = 0, skippedExists = 0, skippedUnsafe = 0;
  for (const [childKey, rec] of Object.entries(v3)) {
    if (!rec || typeof rec !== 'object') { skippedUnsafe++; continue; }
    const key = String((rec as Record<string, unknown>).product_code || childKey).trim();
    if (!key || FORBIDDEN_KEY.test(key)) { skippedUnsafe++; continue; }
    const path = 'v4/products/' + key;
    if (has(v4, key) || has(updates, path)) { skippedExists++; continue; } // v4 편집본·v3 내부중복 보존
    updates[path] = rec; // v3 원본 그대로
    copied++;
  }

  if (!dryRun && copied > 0) {
    const entries = Object.entries(updates);
    const BATCH = 500;
    for (let i = 0; i < entries.length; i += BATCH) {
      await update(ref(db), Object.fromEntries(entries.slice(i, i + BATCH)));
    }
  }

  return {
    v3Total, v4Before, copied, skippedExists, skippedUnsafe,
    v4After: dryRun ? v4Before : v4Before + copied,
    dryRun,
  };
}
