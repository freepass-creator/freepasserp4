'use client';
/**
 * 파인더 상품을 «Firestore products」에서 읽는다 — RTDB 대역폭 컷(비용 절감 3단계).
 *
 * onSnapshot 로 처음 한 번 전량 읽고, 이후엔 «바뀐 문서만」 과금된다(상태·요금 변경분).
 * RTDB 는 노드 전체를 매번 스트리밍해 비쌌다(월 30만원). Firestore 문서단위 구독 = 거의 0원.
 *
 * ★플래그 OFF 가 기본 — 켜기 전엔 운영 무변경. `NEXT_PUBLIC_FINDER_FROM_FIRESTORE=1` 로만 켠다.
 * ★가시성·원가 규칙은 RtdbAdapter.listForFinder 와 «똑같은 함수」로 재적용(드리프트 금지).
 *   문서키가 차번이라 차번중복은 구조적으로 0 — dedupe 는 RTDB 병렬성 유지용으로만 태운다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { getFirebaseApp } from './client';
import { isExcludedProduct, dedupeProductsByVehicle, canSeeProductCost, stripProductCost } from './rtdb-products';

export function finderFromFirestoreEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FINDER_FROM_FIRESTORE === '1';
}

/** Firestore 원자 문서 → 파인더 행. RTDB 병렬 = `_key`는 product_code(없으면 차번). */
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

/**
 * ㉡ 실패 시 «핸들을 완전히 해제»한다 — 안 놓으면 unsub 가 truthy 라 ensureSnapshot 이 재시도를 못 한다
 *   (파인더가 빈 채로 굳던 원인, CLAUDE.md 2026-09-04). 해제 후 에러 구독자에게 알려 ㉢ RTDB 폴백을 태운다.
 */
function releaseOnError(err: unknown) {
  if (unsub) { try { unsub(); } catch { /* */ } unsub = null; }
  cache = null; starting = false;
  for (const e of [...errSubs]) { try { e(err); } catch { /* */ } }
}

async function ensureSnapshot() {
  if (unsub || starting) return;
  starting = true;
  try {
    const { getFirestore, collection, onSnapshot } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    unsub = onSnapshot(
      collection(db, 'products'),
      (snap) => { cache = snap.docs.map((x) => toRow(x.data() as Record<string, unknown>)); for (const s of [...subs]) s(cache); },
      (err) => { console.warn('[finder/firestore] onSnapshot 실패:', err); releaseOnError(err); },
    );
  } catch (e) {
    console.warn('[finder/firestore] 구독 시작 실패:', (e as Error).message);
    releaseOnError(e);
  } finally {
    if (unsub) starting = false;   // 정상 구독됐을 때만 여기서 해제(releaseOnError 가 이미 처리했으면 건드리지 않는다)
  }
}

/**
 * 파인더 상품 구독. 콜백은 스냅샷마다 «가공 전 원자행」을 받는다(공급사명·원가 마스킹은 호출부에서).
 * onError = 구독/스냅샷 실패 알림(호출부가 핸들 해제 + RTDB 폴백에 쓴다). 마지막 구독자가 빠지면 onSnapshot 을 닫아 유휴 과금 제거.
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
