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

/** 회원 프로필 — user/{uid}(Firestore) 우선, «없으면 RTDB 폴백». 없으면 null.
 *  ★폴백 이유: 아직 가입 쓰기가 RTDB 라, 새 가입자는 Firestore 에 없다 → 폴백 없으면 flip 뒤 새 가입자 로그인 실패.
 *  기존 회원(미러됨)은 Firestore 에서 바로 나와 RTDB 를 안 읽는다(비용 0). RTDB 삭제 전 가입 쓰기 이관 필요. */
export async function readUserProfile(uid: string): Promise<Record<string, unknown> | null> {
  if (isFirestore()) {
    const app = getFirebaseApp();
    if (app) {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(getFirestore(app), 'user', uid));
      if (snap.exists()) return snap.data() as Record<string, unknown>;
      // Firestore 에 없으면(새 가입 등) 아래 RTDB 폴백
    }
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
