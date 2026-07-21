/**
 * Firebase Auth — freepasserp3 프로젝트 공유(회원 그대로). v3 src/firebase/auth.js 이식.
 *   · 이메일/비번 로그인 + 가입(사업자번호→회사·역할 자동) + 재설정.
 *   · onAuthStateChanged → users/{uid} 프로필 로드 → auth-session 에 v4 3역할로 투영.
 */
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence, type User,
} from 'firebase/auth';
import { ref, get, set, runTransaction } from 'firebase/database';
import { getAuthClient, getRtdb, firebaseReady } from './client';
import { setSession, mapRole, setGuest } from '../auth-session';

const _persistenceReady = (() => {
  const auth = getAuthClient();
  if (!auth) return Promise.resolve();
  return Promise.race([
    setPersistence(auth, browserLocalPersistence).catch((e) => console.warn('[auth] setPersistence 실패:', e?.message || e)),
    new Promise<void>((r) => setTimeout(r, 1000)),
  ]);
})();

/** HMR에도 유지 — 리스너 중복 등록·세션 날림 방지. */
type AuthBoot = { promise?: Promise<void>; lastUid: string | null };
const boot = (globalThis as unknown as { __fp4AuthBoot?: AuthBoot }).__fp4AuthBoot
  ?? ((globalThis as unknown as { __fp4AuthBoot: AuthBoot }).__fp4AuthBoot = { lastUid: null });

/** 인증 상태 감시 → 프로필 로드 → 세션 반영. resolve = 최초 1회(로그인 여부 확정). */
export function initAuth(): Promise<void> {
  if (!firebaseReady()) return Promise.resolve();
  if (boot.promise) return boot.promise;
  const auth = getAuthClient();
  const db = getRtdb();
  if (!auth) return Promise.resolve();

  boot.promise = (async () => {
    // persistence 적용 전에 listener 붙이면 null → setSession(null) → 매 수정/HMR마다 재로그인.
    await _persistenceReady;
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      setTimeout(done, 8000);
      onAuthStateChanged(auth, async (user) => {
        const uid = user?.uid || null;
        if (uid === boot.lastUid && uid !== null) { done(); return; }
        boot.lastUid = uid;
        if (user && db) {
          try {
            let profile: Record<string, unknown> = (await get(ref(db, `users/${user.uid}`))).val() || {};
            if (!profile.role) { await new Promise((r) => setTimeout(r, 300)); profile = (await get(ref(db, `users/${user.uid}`))).val() || profile; }
            const rawRole = profile.role === 'agent_manager' ? 'agent_admin' : String(profile.role || '');
            const role = mapRole(rawRole);
            const company_code = String(profile.company_code || '');
            const agent_channel_code = String(profile.agent_channel_code || '') || company_code;
            const user_code = String(profile.user_code || '').trim();
            // 귀속키 SSOT: 공급사=회사코드, 영업자=사람키(user_code→uid). 채널코드로 방/계약을 묶지 않음(동채널 충돌·/q?a= 불일치 방지).
            const code = role === 'provider'
              ? company_code
              : (user_code || user.uid);
            setGuest(false);
            setSession({
              uid: user.uid, email: user.email || '', role, rawRole,
              name: String(profile.name || user.email || ''), code,
              company_code, agent_channel_code, user_code: user_code || user.uid,
              status: String(profile.status || ''),
            });
          } catch (e) {
            console.warn('[auth] users 프로필 읽기 실패 — 최소 세션 진행:', (e as Error)?.message || e);
            setGuest(false);
            // 귀속키 최소=uid. 빈 code면 actor가 usr_park 폴백 → 타 영업 방/계약에 붙는 사고 방지.
            setSession({
              uid: user.uid, email: user.email || '', role: 'agent', rawRole: '',
              name: user.email || '', code: user.uid, company_code: '',
              agent_channel_code: '', user_code: user.uid,
            });
          }
        } else if (user && !db) {
          setSession({
            uid: user.uid, email: user.email || '', role: 'agent', rawRole: '',
            name: user.email || '', code: user.uid, company_code: '',
            agent_channel_code: '', user_code: user.uid,
          });
        } else {
          // 진짜 비로그인만 지움. auth.currentUser 가 있으면(복원 직후 race) 캐시 세션 유지.
          if (!auth.currentUser) setSession(null);
        }
        done();
      });
    });
  })();
  return boot.promise;
}

export async function login(email: string, password: string): Promise<User> {
  await _persistenceReady;
  const auth = getAuthClient(); if (!auth) throw new Error('인증이 설정되지 않았습니다');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signup(email: string, password: string): Promise<User> {
  await _persistenceReady;
  const auth = getAuthClient(); if (!auth) throw new Error('인증이 설정되지 않았습니다');
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logout(): Promise<void> {
  const auth = getAuthClient(); if (auth) await signOut(auth);
  boot.lastUid = null;
  setSession(null);
}

export async function resetPassword(email: string): Promise<void> {
  const auth = getAuthClient(); if (!auth) throw new Error('인증이 설정되지 않았습니다');
  await sendPasswordResetEmail(auth, email);
}

/** 가입 프로필 쓰기 — v3 _writeUserProfile 그대로. 사업자번호→partners 매칭으로 회사·역할 자동 부여. */
export async function writeUserProfile(user: User, info: { name: string; phone: string; company_name: string; business_no: string }): Promise<void> {
  const db = getRtdb(); if (!db) throw new Error('DB가 설정되지 않았습니다');
  const bizNo = String(info.business_no || '').replace(/\D/g, '');
  let role = 'agent', company_code = 'SP999', agent_channel_code = '', matched_partner_code: string | null = null;
  if (bizNo) {
    try {
      const partners = (await get(ref(db, 'partners'))).val() || {};
      for (const [k, p] of Object.entries<Record<string, unknown>>(partners)) {
        if (!p || p._deleted) continue;
        const pn = String(p.business_number || '').replace(/\D/g, '');
        if (pn && pn === bizNo) {
          matched_partner_code = String(p.partner_code || k);
          const pt = String(p.partner_type || '');
          if (/영업|sales/i.test(pt)) { role = 'agent'; company_code = matched_partner_code; agent_channel_code = matched_partner_code; }
          else if (/공급|provider/i.test(pt)) { role = 'provider'; company_code = matched_partner_code; }
          break;
        }
      }
    } catch { /* noop */ }
  }
  let user_code = 'U0001';
  try {
    const res = await runTransaction(ref(db, 'counters/user_code_seq'), (cur) => (cur || 0) + 1);
    if (res.committed) user_code = `U${String(res.snapshot.val()).padStart(4, '0')}`;
  } catch { /* noop */ }
  // 가입 승인 — 사업자번호가 partners 에 매칭되면 즉시 활성(실 거래처는 흐름 그대로),
  // 매칭 실패는 pending 으로 두고 관리자 승인을 받는다(불특정 가입자가 곧바로 데이터에 붙는 것을 막는다).
  const status = matched_partner_code ? 'active' : 'pending';
  await set(ref(db, `users/${user.uid}`), {
    uid: user.uid, email: user.email || '', name: info.name || '', phone: info.phone || '',
    company_name: info.company_name || '', business_no: bizNo, user_code,
    role, company_code, agent_channel_code, matched_partner_code, status, created_at: Date.now(),
  });
}
