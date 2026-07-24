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
import { writeUserPrivate } from '../domain/private-fields';

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
            const user_code = String(profile.user_code || '').trim();
            // 채널 폴백: provider=''(회사코드로 스코프), agent=본인 채널→사람키(user_code→uid).
            //  company_code 폴백 제거 — 개인(SP999) 영업자에게 공유 SP999 채널을 줘 교차 테넌트 유출되던 결함 수정.
            const agent_channel_code = role === 'provider'
              ? ''
              : (String(profile.agent_channel_code || '').trim() || user_code || user.uid);
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

/** 사업자번호 → partners 매칭으로 역할·회사·채널 해석(가입·승인 공통).
 *  미매칭 = 영업자·company SP999. 채널은 여기 두지 않음 — 개인은 writeUserProfile/approveUser 가 user_code 로 고유화
 *  (공유 'SP999' 채널 금지: 규칙 게시 시 개인끼리 방/계약/정산 교차열람). */
async function resolveIdentity(bizNo: string): Promise<{ role: string; company_code: string; agent_channel_code: string; matched_partner_code: string | null }> {
  let role = 'agent', company_code = 'SP999', agent_channel_code = '', matched_partner_code: string | null = null;
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
  return { role, company_code, agent_channel_code, matched_partner_code };
}

/** 개인(SP999) 영업자 채널 = 사람키. 매칭 sales 소속은 partner 채널 유지. */
function resolveAgentChannel(role: string, company_code: string, fromIdentity: string, user_code: string, uid: string): string {
  if (role === 'provider') return '';
  if (role === 'agent' && company_code === 'SP999') return String(user_code || uid || '').trim();
  return String(fromIdentity || '').trim();
}

/**
 * 가입 프로필 쓰기 — Path B(승인제): 신원(company/channel)은 자가쓰기 금지 → 관리자 approveUser 가 확정.
 *  본인은 role(non-admin)·status:'pending'·연락처만. 승인 전 앱 게이트(isPending)에 막힘.
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
    // role 힌트만(승인 시 approveUser 가 재매칭으로 확정). company/channel 은 여기 안 씀(자가사칭 차단).
    const { role } = await resolveIdentity(bizNo);
    const safeRole = role === 'admin' ? 'agent' : role; // 자가 admin 승격 금지
    step = '회원번호 채번';
    let user_code = 'U0001';
    try {
      const res = await runTransaction(ref(db, 'counters/user_code_seq'), (cur) => (cur || 0) + 1);
      if (res.committed) user_code = `U${String(res.snapshot.val()).padStart(4, '0')}`;
    } catch (ce) { console.warn('[writeUserProfile] 채번 실패(계속):', (ce as Error)?.message || ce); }
    step = '프로필 저장';
    // 이메일(PII)은 users_private/{uid}(본인 write)로 분리 시도. 성공 시 본노드에서 제외(공개 read 차단).
    //  실패(규칙 미게시·no-db)면 본노드에 그대로 남긴다(유실 방지) — 폴백이 기존 동작 보존.
    //  ※ phone 은 공개 견적 /q 연락 CTA 가 본노드에서 읽으므로 본노드 유지(옵션 A: 샤프한 유출만 차단).
    const emailMoved = await writeUserPrivate(uid, { email: user.email || '' });
    const rec: Record<string, unknown> = {
      uid, name: info.name || '', phone: info.phone || '',
      company_name: info.company_name || '', business_no: bizNo, user_code,
      // Path B: 승인 대기. company_code·agent_channel_code 미기록(규칙 admin-only + 승인 시 배정).
      status: 'pending',
      role: safeRole,
      created_at: Date.now(),
      ...(emailMoved ? {} : { email: user.email || '' }),
    };
    await set(ref(db, `users/${uid}`), rec);
  } catch (e) {
    console.error(`[writeUserProfile] 실패 단계=[${step}]`, e);
    throw new Error(`[${step}] ${(e as Error)?.message || String(e)}`);
  }
}

/**
 * 관리자 가입 승인/해제 — 게이트가 읽는 "최상위" users/{uid} 에 직접 기록(v4 오버레이 아님). 관리자만(규칙 + 화면 게이트).
 *  승인 = 신원 확정: 사업자번호를 partners 로 "재매칭"(사용자 self 필드가 아니라 권한 소스)해 company_code·agent_channel_code 세팅.
 *  개인(SP999) 영업자 채널 = user_code(공유 SP999 금지).
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

/**
 * 관리자 회원 신원 편집 — 게이트가 읽는 "최상위" users/{uid} 에 직접 기록(approveUser 와 동일 노드).
 *  role·company_code·agent_channel_code 는 세션(initAuth)·RLS 규칙이 이 노드에서 읽는다.
 *  회원관리 폼이 v4 오버레이에만 쓰면 강등·재배정이 조용히 무효화(desync)되므로 신원 필드는 최상위로 직접 반영.
 *  status 는 approveUser 전용(여기서 건드리지 않음 — 폼의 구값으로 승인상태를 덮지 않도록).
 *  firebase 미설정(로컬/데모)이면 no-op — 동기화할 최상위 users 노드 자체가 없음.
 */
export async function adminUpdateUserIdentity(
  uid: string,
  fields: { role?: string; company_code?: string; agent_channel_code?: string; status?: string },
): Promise<void> {
  const db = getRtdb();
  if (!db) return; // 로컬/데모: 최상위 users 없음 → 스킵(정상)
  if (!uid) throw new Error('uid 없음');
  const patch: Record<string, unknown> = {};
  if (fields.role != null) patch.role = String(fields.role);
  if (fields.company_code != null) patch.company_code = String(fields.company_code);
  if (fields.agent_channel_code != null) patch.agent_channel_code = String(fields.agent_channel_code);
  if (fields.status != null) patch.status = String(fields.status);
  if (!Object.keys(patch).length) return;
  await update(ref(db, `users/${uid}`), patch);
}

export async function approveUser(uid: string, active = true): Promise<void> {
  const db = getRtdb(); if (!db) throw new Error('DB가 설정되지 않았습니다');
  if (!uid) throw new Error('uid 없음');
  if (!active) { await set(ref(db, `users/${uid}/status`), 'pending'); return; }
  const u = (await get(ref(db, `users/${uid}`))).val() as Record<string, unknown> | null;
  const bizNo = String((u && u.business_no) || '').replace(/\D/g, '');
  const user_code = String((u && u.user_code) || uid).trim();
  const { role, company_code, agent_channel_code, matched_partner_code } = await resolveIdentity(bizNo);
  const channel = resolveAgentChannel(role, company_code, agent_channel_code, user_code, uid);
  const patch: Record<string, unknown> = {
    status: 'active', role, company_code, agent_channel_code: channel,
  };
  if (matched_partner_code) patch.matched_partner_code = matched_partner_code;
  else patch.matched_partner_code = null;
  await update(ref(db, `users/${uid}`), patch);
}

/**
 * 개인 영업자 채널 백필 — company SP999 이고 채널이 ''|SP999 인 유저를 user_code 로 고유화.
 *  관리자 세션에서 실행(규칙: agent_channel_code 변경 = admin). 규칙 게시 전 1회.
 *  dryRun=true 면 목록만 반환.
 */
export async function backfillPersonalAgentChannels(opts?: { dryRun?: boolean }): Promise<{
  scanned: number; updated: { uid: string; from: string; to: string }[]; skipped: number;
}> {
  const db = getRtdb(); if (!db) throw new Error('DB가 설정되지 않았습니다');
  const dry = !!opts?.dryRun;
  const snap = (await get(ref(db, 'users'))).val() as Record<string, Record<string, unknown>> | null;
  const updated: { uid: string; from: string; to: string }[] = [];
  let scanned = 0; let skipped = 0;
  if (!snap) return { scanned: 0, updated, skipped: 0 };
  for (const [uid, u] of Object.entries(snap)) {
    if (!u || typeof u !== 'object') continue;
    scanned++;
    const role = String(u.role || '');
    const company = String(u.company_code || '');
    const ch = String(u.agent_channel_code || '');
    const isAgent = role === 'agent' || role === 'agent_admin' || role === 'agent_manager' || (!role && company === 'SP999');
    if (!isAgent || company !== 'SP999') { skipped++; continue; }
    if (ch && ch !== 'SP999') { skipped++; continue; } // 이미 고유 채널
    const to = String(u.user_code || uid).trim();
    if (!to || to === ch) { skipped++; continue; }
    updated.push({ uid, from: ch || '(empty)', to });
    if (!dry) await update(ref(db, `users/${uid}`), { agent_channel_code: to });
  }
  return { scanned, updated, skipped };
}
