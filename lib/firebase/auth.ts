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

/** 인증 상태 감시 → 프로필 로드 → 세션 반영. resolve = 최초 1회(로그인 여부 확정). */
let _inited = false;
export function initAuth(): Promise<void> {
  if (!firebaseReady()) return Promise.resolve();
  if (_inited) return Promise.resolve();
  _inited = true;
  const auth = getAuthClient();
  const db = getRtdb();
  if (!auth) return Promise.resolve();
  return new Promise((resolve) => {
    let resolved = false; let lastUid: string | null = null;
    setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 8000); // 무응답 8s 방어
    onAuthStateChanged(auth, async (user) => {
      const uid = user?.uid || null;
      if (uid === lastUid && uid !== null) { if (!resolved) { resolved = true; resolve(); } return; }
      lastUid = uid;
      if (user && db) {
        // 첫 로그인 직후 토큰 attach race — role 없으면 1회 재시도
        let profile: Record<string, unknown> = (await get(ref(db, `users/${user.uid}`))).val() || {};
        if (!profile.role) { await new Promise((r) => setTimeout(r, 300)); profile = (await get(ref(db, `users/${user.uid}`))).val() || profile; }
        const rawRole = profile.role === 'agent_manager' ? 'agent_admin' : String(profile.role || '');
        const role = mapRole(rawRole);
        const company_code = String(profile.company_code || '');
        const agent_channel_code = String(profile.agent_channel_code || '') || company_code;
        const code = role === 'provider' ? company_code : agent_channel_code;
        setGuest(false);
        setSession({
          uid: user.uid, email: user.email || '', role, rawRole,
          name: String(profile.name || user.email || ''), code,
          company_code, agent_channel_code, user_code: String(profile.user_code || ''),
        });
      } else if (user && !db) {
        // db 미연결 — 인증만. 최소 세션(역할 미상=영업자 기본).
        setSession({ uid: user.uid, email: user.email || '', role: 'agent', rawRole: '', name: user.email || '', code: '', company_code: '', agent_channel_code: '', user_code: '' });
      } else {
        setSession(null);
      }
      if (!resolved) { resolved = true; resolve(); }
    });
  });
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
  await set(ref(db, `users/${user.uid}`), {
    uid: user.uid, email: user.email || '', name: info.name || '', phone: info.phone || '',
    company_name: info.company_name || '', business_no: bizNo, user_code,
    role, company_code, agent_channel_code, matched_partner_code, status: 'active', created_at: Date.now(),
  });
}
