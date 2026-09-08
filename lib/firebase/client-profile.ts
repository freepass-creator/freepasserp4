'use client';
/**
 * 클라이언트 로그인 데이터 — RTDB 폐기(사장님 2026-09-08 「완전 버리자」).
 *
 * ★서버 심(firestore-ref-shim)은 클라에 없다. 그래서 클라 로그인이 읽는 «회원 프로필·공급사»를
 *   단일 플래그(`NEXT_PUBLIC_DATA_BACKEND`)로 갈리게 여기 한 곳에 둔다.
 *   backend=firestore → Firestore `user/{uid}`·`partner` (문서 id=uid·공급사코드, 미러 확인).
 *   그 밖 → 기존 RTDB `users/{uid}`·`partners` (운영 무변경).
 */
import { getFirebaseApp, getRtdb } from './client';
import { ref, get } from 'firebase/database';

const isFirestore = () => String(process.env.NEXT_PUBLIC_DATA_BACKEND || '').trim() === 'firestore';

/** 회원 프로필 — users/{uid}(RTDB) 또는 user/{uid}(Firestore). 없으면 null. */
export async function readUserProfile(uid: string): Promise<Record<string, unknown> | null> {
  if (isFirestore()) {
    const app = getFirebaseApp();
    if (!app) return null;
    const { getFirestore, doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(getFirestore(app), 'user', uid));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  }
  const db = getRtdb();
  if (!db) return null;
  return ((await get(ref(db, `users/${uid}`))).val() as Record<string, unknown> | null) || null;
}

/** 공급사 맵 { code → partner } — partners(RTDB) 또는 partner 컬렉션(Firestore). */
export async function readPartnersMap(): Promise<Record<string, Record<string, unknown>>> {
  if (isFirestore()) {
    const app = getFirebaseApp();
    if (!app) return {};
    const { getFirestore, collection, getDocs } = await import('firebase/firestore');
    const snap = await getDocs(collection(getFirestore(app), 'partner'));
    const out: Record<string, Record<string, unknown>> = {};
    snap.forEach((d) => { out[d.id] = d.data() as Record<string, unknown>; });
    return out;
  }
  const db = getRtdb();
  if (!db) return {};
  return ((await get(ref(db, 'partners'))).val() as Record<string, Record<string, unknown>> | null) || {};
}
