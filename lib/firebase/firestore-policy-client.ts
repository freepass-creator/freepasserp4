'use client';
/**
 * 정책 문서를 «Firestore policy」에서 실시간으로 읽는다 — /spring 상세의 정책 조인용.
 *   products 구독(firestore-products-client)과 같은 생명주기·실패 시 핸들 완전해제 패턴.
 *   55건·준정적이라 첫 1회 뒤 거의 갱신 없음. 키 = policy._key.
 */
import { getFirebaseApp } from './client';

export type PolicyDoc = Record<string, unknown> & { _key?: string };

let cache: PolicyDoc[] | null = null;
let unsub: (() => void) | null = null;
let starting = false;
const subs = new Set<(rows: PolicyDoc[]) => void>();
const errSubs = new Set<(err: unknown) => void>();

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
      collection(db, 'policy'),
      (snap) => { cache = snap.docs.map((x) => x.data() as PolicyDoc); for (const s of [...subs]) s(cache); },
      (err) => { console.warn('[spring/policy] onSnapshot 실패:', err); releaseOnError(err); },
    );
  } catch (e) {
    console.warn('[spring/policy] 구독 시작 실패:', (e as Error).message);
    releaseOnError(e);
  } finally {
    if (unsub) starting = false;
  }
}

/** 정책 구독. 콜백은 스냅샷마다 전체 정책 문서 배열을 받는다(가공 없음). */
export function subscribeFirestorePolicies(onRows: (rows: PolicyDoc[]) => void, onError?: (err: unknown) => void): () => void {
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
