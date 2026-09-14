'use client';
/**
 * 파인더 상품을 ERP5 활성 상품 버전에서 읽는다.
 *
 * ERP3 Auth 토큰은 ERP4 API 인증에만 쓰고 서버가 별도 ERP5 Firebase에서 읽어 투영한다.
 * ERP5 절체 여부는 서버의 `ERP5_PRODUCT_READ_ENABLED`가 결정한다. 브라우저 경로는
 * 기존 UI 호환을 위해 유지하며 `NEXT_PUBLIC_FINDER_FROM_FIRESTORE=0`일 때만 사용하지 않는다.
 * 가시성·원가 규칙은 기존 파인더와 같은 함수로 재적용한다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { getAuthClient } from './client';
import { isExcludedProduct, dedupeProductsByVehicle, canSeeProductCost, stripProductCost } from './rtdb-products';

export function finderFromFirestoreEnabled(): boolean {
  /** 기본 켬 — «0» 을 명시했을 때만 옛 RTDB 길로 돌아간다. */
  return process.env.NEXT_PUBLIC_FINDER_FROM_FIRESTORE !== '0';
}

/** ERP4 API 상품 문서 → 파인더 행. `_key`는 product_code(없으면 차번). */
function toRow(d: Record<string, unknown>): EntityRecord {
  return {
    ...d,
    _key: String(d.product_code || d.car_number || ''),
    companyId: String(d.provider_company_code || ''),
  } as EntityRecord;
}

/** listForFinder 와 동일 가공: KASHUNG 제외 → 차량 dedupe → 역할별 원가 마스킹. */
export function shapeFinderRows(rows: EntityRecord[]): EntityRecord[] {
  const shown = dedupeProductsByVehicle(rows.filter((r) => !isExcludedProduct(r as Record<string, unknown>)));
  return shown.map((r) => (canSeeProductCost(r) ? r : stripProductCost(r)));
}

let cache: EntityRecord[] | null = null;
let unsub: (() => void) | null = null;
let starting = false;
const subs = new Set<(rows: EntityRecord[]) => void>();
const errSubs = new Set<(err: unknown) => void>();

/** 실패 시 polling 핸들을 완전히 해제하고 상위 재시도 경계에 알린다. */
function releaseOnError(err: unknown) {
  if (unsub) { try { unsub(); } catch { /* */ } unsub = null; }
  cache = null; starting = false;
  for (const e of [...errSubs]) { try { e(err); } catch { /* */ } }
}

async function ensureSnapshot() {
  if (unsub || starting) return;
  starting = true;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  unsub = () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  try {
    const poll = async () => {
      try {
        const auth = getAuthClient()?.currentUser;
        if (!auth) throw new Error('ERP5 상품 조회 인증 없음');
        const token = await auth.getIdToken();
        const response = await fetch('/api/products', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) throw new Error(`ERP5 상품 조회 HTTP ${response.status}`);
        const value = await response.json() as Record<string, Record<string, unknown>>;
        cache = Object.values(value || {}).map(toRow);
        for (const subscriber of [...subs]) subscriber(cache);
      } catch (error) {
        console.warn('[finder/erp5] 활성 상품 조회 실패:', error);
        if (!cache) { releaseOnError(error); return; }
      }
      if (!cancelled) timer = setTimeout(() => { void poll(); }, 30_000);
    };
    await poll();
  } catch (e) {
    console.warn('[finder/erp5] 조회 시작 실패:', (e as Error).message);
    releaseOnError(e);
  } finally {
    starting = false;
  }
}

/**
 * ERP3 Firestore를 직접 열지 않고 인증 API를 통해 ERP5 활성 버전을 30초마다 갱신한다.
 * 마지막 구독자가 빠지면 polling을 닫는다.
 */
export function subscribeFirestoreProducts(onRows: (rows: EntityRecord[]) => void, onError?: (err: unknown) => void): () => void {
  subs.add(onRows);
  if (onError) errSubs.add(onError);
  if (cache) onRows(cache);
  void ensureSnapshot();
  return () => {
    subs.delete(onRows);
    if (onError) errSubs.delete(onError);
    if (!subs.size && unsub) { try { unsub(); } catch { /* */ } unsub = null; cache = null; }
  };
}
