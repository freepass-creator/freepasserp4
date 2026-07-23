/**
 * Firebase Auth — freepasserp3 프로젝트 공유(회원 그대로). v3 src/firebase/auth.js 이식.
 *   · 이메일/비번 로그인 + 가입(사업자번호→회사·역할 자동) + 재설정.
 *   · onAuthStateChanged → users/{uid} 프로필 로드 → auth-session 에 v4 3역할로 투영.
 */
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence, type User,
} from 'firebase/auth';
import { ref, get, set, update, runTransaction } from 'firebase/database';
import { getAuthClient, getRtdb, firebaseReady } from './client';
import { setSession, getSession, mapRole, setGuest } from '../auth-session';

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

/** 사업자번호 → partners 매칭으로 역할·회사·채널 해석(가입·승인 공통). 미매칭=영업자·SP999(채널=회사코드). */
async function resolveIdentity(bizNo: string): Promise<{ role: string; company_code: string; agent_channel_code: string; matched_partner_code: string | null }> {
  let role = 'agent', company_code = 'SP999', agent_channel_code = 'SP999', matched_partner_code: string | null = null;
  const db = getRtdb();
  if (bizNo && db) {
    try {
      const partners = (await get(ref(db, 'partners'))).val() || {};
      for (const [k, p] of Object.entries<Record<string, unknown>>(partners)) {
        if (!p || p._deleted) continue;
        const pn = String(p.business_number || '').replace(/\D/g, '');
        if (pn && pn === bizNo) {
          matched_partner_code = String(p.partner_code || k);
          const pt = String(p.partner_type || '');
          if (/영업|sales/i.test(pt)) { role = 'agent'; company_code = matched_partner_code; agent_channel_code = matched_partner_code; }
          else if (/공급|provider/i.test(pt)) { role = 'provider'; company_code = matched_partner_code; agent_channel_code = ''; }
          break;
        }
      }
    } catch { /* noop */ }
  }
  // 세션 게이트(auth.ts)도 agent_channel 빈값이면 company_code 로 보정함 — DB와 어긋나면
  //  v4/settlements·quote 등 채널 소유 write 가 permission_denied (계약완료→정산생성 실패).
  if (role === 'agent' && !agent_channel_code) agent_channel_code = company_code;
  return { role, company_code, agent_channel_code, matched_partner_code };
}

/**
 * 가입 프로필 쓰기 — 사업자번호 매칭으로 역할·회사·채널 자동 부여.
 *  현재는 **자동승인**(status 미기록 → 게이트가 'pending'만 막으므로 통과): 공급사 사업자면 공급사 직원, 영업 사업자면 영업자,
 *  미매칭이면 영업자·임시소속(SP999)으로 즉시 이용.
 *  ※ TODO(security): 관리자 승인 게이트 + 신원 서버배정(자가쓰기 위조 차단)은 추후 재도입.
 *    재도입 시 company_code/agent_channel_code 규칙을 admin-only 로 되돌리고 여기서 미기록,
 *    approveUser 가 사업자 재매칭으로 확정한다.
 */
export async function writeUserProfile(user: User, info: { name: string; phone: string; company_name: string; business_no: string }): Promise<void> {
  const db = getRtdb(); if (!db) throw new Error('DB가 설정되지 않았습니다');
  const bizNo = String(info.business_no || '').replace(/\D/g, '');
  let step = '초기화'; // 실패 단계 표기(가입 오류 위치 추적)
  try {
    step = 'uid 확인';
    const uid = String(user?.uid || '');
    if (!uid) throw new Error('auth uid 없음');
    step = '사업자 매칭';
    const { role, company_code, agent_channel_code, matched_partner_code } = await resolveIdentity(bizNo);
    step = '회원번호 채번';
    let user_code = 'U0001';
    try {
      const res = await runTransaction(ref(db, 'counters/user_code_seq'), (cur) => (cur || 0) + 1);
      if (res.committed) user_code = `U${String(res.snapshot.val()).padStart(4, '0')}`;
    } catch (ce) { console.warn('[writeUserProfile] 채번 실패(계속):', (ce as Error)?.message || ce); }
    step = '프로필 저장';
    const rec: Record<string, unknown> = {
      uid, email: user.email || '', name: info.name || '', phone: info.phone || '',
      company_name: info.company_name || '', business_no: bizNo, user_code,
      // status 미기록 = 자동승인. 규칙상 본인은 'active' 못 씀(자가활성 차단)이고, 앱 게이트는
      //  'pending' 만 막으므로(블랙리스트, auth-session isPending) status 없음 = 통과. (승인흐름
      //  재도입 시 여기서 status:'pending' 저장 + approveUser 가 활성으로.)
      role, company_code, agent_channel_code, created_at: Date.now(),
    };
    if (matched_partner_code) rec.matched_partner_code = matched_partner_code; // null 은 set 에 넣지 않음
    await set(ref(db, `users/${uid}`), rec);
  } catch (e) {
    console.error(`[writeUserProfile] 실패 단계=[${step}]`, e);
    throw new Error(`[${step}] ${(e as Error)?.message || String(e)}`);
  }
}

/**
 * 관리자 가입 승인/해제 — 게이트가 읽는 "최상위" users/{uid} 에 직접 기록(v4 오버레이 아님). 관리자만(규칙 + 화면 게이트).
 *  승인 = 신원 확정: 사업자번호를 partners 로 "재매칭"(사용자 self 필드가 아니라 권한 소스)해 company_code·agent_channel_code 세팅.
 *  ※ 관리자가 사업자 진위를 확인하고 승인한다는 전제(사람 KYC) — 규칙은 이 필드를 관리자만 쓰게 강제한다.
 */
/** 내 프로필 조회 — 설정 프로필 편집용(최상위 users/{uid}). */
export async function loadMyProfile(): Promise<Record<string, unknown> | null> {
  const db = getRtdb(); const auth = getAuthClient();
  const uid = auth?.currentUser?.uid;
  if (!db || !uid) return null;
  return ((await get(ref(db, `users/${uid}`))).val() as Record<string, unknown> | null) || null;
}

/** 내 프로필 수정 — 이름·연락처 등 "자기 필드"만. 역할·회사코드 등 신원은 건드리지 않음(규칙상 관리자 전용). 세션 즉시 반영. */
export async function updateMyProfile(fields: { name?: string; phone?: string; company_name?: string }): Promise<void> {
  const db = getRtdb(); const auth = getAuthClient();
  const uid = auth?.currentUser?.uid;
  if (!db || !uid) throw new Error('로그인이 필요합니다');
  const patch: Record<string, unknown> = {};
  if (fields.name != null) patch.name = String(fields.name);
  if (fields.phone != null) patch.phone = String(fields.phone);
  if (fields.company_name != null) patch.company_name = String(fields.company_name);
  if (!Object.keys(patch).length) return;
  await update(ref(db, `users/${uid}`), patch);
  const s = getSession(); // 상단바·설정에 이름 즉시 반영
  if (s && patch.name != null) setSession({ ...s, name: String(patch.name) });
}

export async function approveUser(uid: string, active = true): Promise<void> {
  const db = getRtdb(); if (!db) throw new Error('DB가 설정되지 않았습니다');
  if (!uid) throw new Error('uid 없음');
  if (!active) { await set(ref(db, `users/${uid}/status`), 'pending'); return; }
  const u = (await get(ref(db, `users/${uid}`))).val() as Record<string, unknown> | null;
  const bizNo = String((u && u.business_no) || '').replace(/\D/g, '');
  const { role, company_code, agent_channel_code, matched_partner_code } = await resolveIdentity(bizNo);
  await update(ref(db, `users/${uid}`), { status: 'active', role, company_code, agent_channel_code, matched_partner_code });
}
