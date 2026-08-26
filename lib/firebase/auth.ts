/**
 * Firebase Auth — freepasserp3 프로젝트 공유(회원 그대로). v3 src/firebase/auth.js 이식.
 *   · 이메일/비번 로그인 + 가입(사업자번호→회사·역할 자동) + 재설정.
 *   · onAuthStateChanged → users/{uid} 프로필 로드 → auth-session 에 v4 3역할로 투영.
 */
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence, type User,
} from 'firebase/auth';
import { ref, get, set, update } from 'firebase/database';
import { getAuthClient, getRtdb, firebaseReady } from './client';
import { setSession, getSession, mapRole, clearLegacyGuestState } from '../auth-session';
import { buildAuditEntry } from '@/lib/domain/audit';
import { currentActor } from '@/lib/session';
import { getCompanyId } from '@/lib/tenant';
import { patchListCache } from '@/lib/store';
import type { EntityRecord } from '@/lib/intake/entities';
import { businessRegistrationNumberOf, normalizeBusinessRegistrationNumber } from '@/lib/domain/business-identity';
import { partnerTypeLabel } from '@/lib/domain/partner';
import { PERSONAL_AGENT_COMPANY, PERSONAL_AGENT_NAME } from '@/features/members/member-filter';
import { LEGAL_VERSION } from '@/lib/legal';
import { selfServeActivationDecision } from '@/lib/domain/self-serve-activation';
import { newId } from '@/lib/domain/ids';

/** 관리자 신원 조작(승인·역할재배정·채널백필) 감사기록 — store를 안 거치는 top-level users 쓰기라 별도 기록.
 *  best-effort(감사 실패가 원 작업을 막지 않음). audit_logs 규칙: actor_uid === auth.uid(=현재 관리자). */
async function writeIdentityAudit(uid: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, summary: string): Promise<void> {
  const db = getRtdb();
  if (!db) return;
  try {
    const entry = buildAuditEntry('user', getCompanyId(), uid, action, (before as EntityRecord | null), (after as EntityRecord | null), currentActor(), { summary });
    if (entry) await update(ref(db, `v4/audit_logs/${String(entry._key)}`), entry as Record<string, unknown>);
  } catch { /* best-effort */ }
}
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

async function clearScopedStoreCache(): Promise<void> {
  try {
    const { clearStoreCache } = await import('@/lib/store');
    clearStoreCache();
  } catch {
    // 캐시 초기화 실패가 인증 자체를 막아서는 안 된다.
  }
}

/**
 * pending 을 서버 검증을 거쳐 즉시 활성화한다 — 두 갈래다.
 *   ① 구 승인제에서 pending 으로 남은 미배정 자가가입자
 *   ② **우리 워크스페이스 직원**(사장님 2026-08-26 「우리 워크스페이스 직원들은 자동으로 통과되게」)
 */
async function activateLegacySelfSignup(
  user: User,
  profile: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // ★여기 판정은 «미리 걸러 보는 것»일 뿐이다. 진짜 판정은 서버가 토큰으로 다시 한다.
  if (!selfServeActivationDecision(profile, user.uid, { email: user.email || '', emailVerified: user.emailVerified }).eligible) return profile;
  try {
    const response = await fetch('/api/auth/self-activate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      console.warn('[auth] 기존 가입자 자동 활성화 거절:', response.status);
      return profile;
    }
    const db = getRtdb();
    if (!db) return profile;
    return (await get(ref(db, `users/${user.uid}`))).val() || profile;
  } catch (error) {
    console.warn('[auth] 기존 가입자 자동 활성화 실패:', (error as Error)?.message || error);
    return profile;
  }
}

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
        await clearScopedStoreCache();
        if (user && db) {
          try {
            let profile: Record<string, unknown> = (await get(ref(db, `users/${user.uid}`))).val() || {};
            if (!profile.role) { await new Promise((r) => setTimeout(r, 300)); profile = (await get(ref(db, `users/${user.uid}`))).val() || profile; }
            profile = await activateLegacySelfSignup(user, profile);
            const rawRole = String(profile.role || '');
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
            clearLegacyGuestState();
            setSession({
              uid: user.uid, email: user.email || '', role, rawRole,
              name: String(profile.name || user.email || ''), phone: String(profile.phone || ''), code,
              company_code, agent_channel_code, user_code: user_code || user.uid,
              status: String(profile.status || ''),
              // 관리자가 끈 계정을 앱 게이트가 판정할 수 있게 세션에 싣는다(예전엔 status만 실려
              // 비활성·삭제 계정이 그대로 사용됐다 — QA AUTH-6)
              is_active: profile.is_active == null ? '' : String(profile.is_active),
              terms_agreed_at: Number(profile.terms_agreed_at || 0),
              privacy_agreed_at: Number(profile.privacy_agreed_at || 0),
              legal_version: String(profile.legal_version || ''),
            });
          } catch (e) {
            console.warn('[auth] users 프로필 읽기 실패 — 최소 세션 진행:', (e as Error)?.message || e);
            clearLegacyGuestState();
            // 귀속키 최소=uid. 빈 code면 actor가 usr_park 폴백 → 타 영업 방/계약에 붙는 사고 방지.
            setSession({
              uid: user.uid, email: user.email || '', role: 'agent', rawRole: '',
              name: user.email || '', phone: '', code: user.uid, company_code: '',
              agent_channel_code: '', user_code: user.uid,
            });
          }
        } else if (user && !db) {
          setSession({
            uid: user.uid, email: user.email || '', role: 'agent', rawRole: '',
            name: user.email || '', phone: '', code: user.uid, company_code: '',
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
 *  미매칭 = 개인영업자(agent · company SP999). 채널은 여기 두지 않음 — 개인은 writeUserProfile/approveUser 가 user_code 로 고유화
 *  (공유 'SP999' 채널 금지: 규칙 게시 시 개인끼리 방/계약/정산 교차열람).
 *  회원관리에서 만든 파트너는 v4 오버레이에 있으므로 v3∪v4 를 본다. */
async function readPartnersForMatch(): Promise<Record<string, Record<string, unknown>>> {
  const db = getRtdb();
  if (!db) return {};
  const [live, overlay] = await Promise.all([
    get(ref(db, 'partners')).then((snap) => (snap.val() || {}) as Record<string, Record<string, unknown>>).catch(() => ({})),
    get(ref(db, 'v4/partners')).then((snap) => (snap.val() || {}) as Record<string, Record<string, unknown>>).catch(() => ({})),
  ]);
  const merged: Record<string, Record<string, unknown>> = { ...live };
  for (const [key, row] of Object.entries(overlay)) {
    if (!row || typeof row !== 'object') continue;
    merged[key] = { ...(merged[key] || {}), ...row };
  }
  return merged;
}

async function resolveIdentity(bizNo: string): Promise<{ role: string; company_code: string; agent_channel_code: string; matched_partner_code: string | null }> {
  let role = 'agent', company_code = 'SP999', agent_channel_code = '', matched_partner_code: string | null = null;
  if (bizNo) {
    try {
      const partners = await readPartnersForMatch();
      for (const [k, p] of Object.entries(partners)) {
        if (!p || p._deleted) continue;
        const pn = businessRegistrationNumberOf(p, 'partner');
        if (pn && pn === bizNo) {
          matched_partner_code = String(p.partner_code || k);
          const type = partnerTypeLabel(p.partner_type, p.partner_code || k);
          if (type === '영업채널') { role = 'agent'; company_code = matched_partner_code; agent_channel_code = matched_partner_code; }
          else if (type === '공급사') { role = 'provider'; company_code = matched_partner_code; agent_channel_code = ''; }
          break;
        }
      }
    } catch { /* noop — 미매칭 폴백(개인영업자) */ }
  }
  return { role, company_code, agent_channel_code, matched_partner_code };
}

async function writeApprovedUser(uid: string, patch: Record<string, unknown>): Promise<void> {
  const db = getRtdb();
  if (!db) return;
  await update(ref(db, `users/${uid}`), patch);
  // 회원관리 목록은 v3∪v4 병합이라 오버레이에 옛 pending/빈 소속이 있으면 승인이 안 보임.
  await update(ref(db, `v4/users/${uid}`), patch);
  patchListCache('user', getCompanyId(), uid, { ...patch, _key: uid, uid });
}

/** 개인(SP999) 영업자 채널 = 사람키. 매칭 sales 소속은 partner 채널 유지. */
function resolveAgentChannel(role: string, company_code: string, fromIdentity: string, user_code: string, uid: string): string {
  if (role === 'provider') return '';
  if (role === 'agent' && company_code === 'SP999') return String(user_code || uid || '').trim();
  return String(fromIdentity || '').trim();
}

/**
 * 가입 프로필 쓰기 — 소속 없는 개인 영업자로 즉시 시작한다.
 *  role·status·user_code만 최소 안전값으로 만들고 회사·채널은 비워 둔다. 이후 관리자가 실제
 *  소속을 확인해 재배정하며, 가입자가 회사·채널 신원을 스스로 주장할 수는 없다.
 */
export async function writeUserProfile(user: User, info: {
  name: string; phone: string; company_name: string; business_no: string; requested_type?: string;
  /** 가입 필수 동의(약관·개인정보). 없으면 개인정보 수집 근거가 없다(QA AUTH-7). */
  consent?: { terms: boolean; privacy: boolean; version: string };
}): Promise<void> {
  const db = getRtdb(); if (!db) throw new Error('DB가 설정되지 않았습니다');
  const bizNo = normalizeBusinessRegistrationNumber(info.business_no);
  let step = '초기화'; // 실패 단계 표기(가입 오류 위치 추적)
  try {
    step = 'uid 확인';
    const uid = String(user?.uid || '');
    if (!uid) throw new Error('auth uid 없음');
    // Firebase uid는 인증키로만 보존하고 ERP5 업무관계는 별도 불변코드로 연결한다.
    // uid를 user_code로 복제하면 외부 인증체계와 내부 코드체계를 다시 분리할 수 없게 된다.
    const user_code = newId('user');
    step = '프로필 저장';
    // 이메일(PII)은 users_private/{uid}(본인 write)로 분리 시도. 성공 시 본노드에서 제외(공개 read 차단).
    //  실패(규칙 미게시·no-db)면 본노드에 그대로 남긴다(유실 방지) — 폴백이 기존 동작 보존.
    //  ※ phone 은 공개 견적 /q 연락 CTA 가 본노드에서 읽으므로 본노드 유지(옵션 A: 샤프한 유출만 차단).
    const emailMoved = await writeUserPrivate(uid, { email: user.email || '' });
    const rec: Record<string, unknown> = {
      uid, name: info.name || '', phone: info.phone || '',
      company_name: info.company_name || '', business_no: bizNo, user_code,
      // 가입 신청 유형(공급/영업/개인)은 이후 소속 매칭용 참고값일 뿐 권한이 아니다.
      requested_type: String(info.requested_type || ''),
      // 즉시 상품찾기·상담 가능. 회사·채널은 미기록하고 개인 UID 범위에서만 활동한다.
      status: 'active',
      role: 'agent',
      created_at: Date.now(),
      ...(emailMoved ? {} : { email: user.email || '' }),
      // 동의 기록 — "언제·어느 버전에" 동의했는지가 남아야 증명이 된다. 버전만 있고 시각이 없으면 소용없다.
      ...(info.consent?.terms ? { terms_agreed_at: Date.now() } : {}),
      ...(info.consent?.privacy ? { privacy_agreed_at: Date.now() } : {}),
      ...(info.consent ? { legal_version: String(info.consent.version || '') } : {}),
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
  if (s && (patch.name != null || patch.phone != null)) {
    setSession({ ...s, ...(patch.name != null ? { name: String(patch.name) } : {}), ...(patch.phone != null ? { phone: String(patch.phone) } : {}) });
  }
}

/** 현재 버전 약관·개인정보 처리방침 재동의 증적을 본인 프로필에 기록한다. */
export async function recordCurrentLegalConsent(): Promise<void> {
  const db = getRtdb(); const auth = getAuthClient();
  const uid = auth?.currentUser?.uid;
  if (!db || !uid) throw new Error('로그인이 필요합니다.');
  const agreedAt = Date.now();
  const consent = {
    terms_agreed_at: agreedAt,
    privacy_agreed_at: agreedAt,
    legal_version: LEGAL_VERSION,
  };
  await update(ref(db, `users/${uid}`), consent);
  const s = getSession();
  if (s?.uid === uid) setSession({ ...s, ...consent });
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
  fields: {
    role?: string;
    company_code?: string;
    agent_channel_code?: string;
    status?: string;
    name?: string;
    company_name?: string;
    user_code?: string;
    agent_payout_rate?: string | number;
    is_team_manager?: string;
    is_active?: string;
  },
): Promise<void> {
  const db = getRtdb();
  if (!db) return; // 로컬/데모: 최상위 users 없음 → 스킵(정상)
  if (!uid) throw new Error('uid 없음');
  const patch: Record<string, unknown> = {};
  if (fields.role != null) patch.role = String(fields.role);
  if (fields.company_code != null) patch.company_code = String(fields.company_code);
  if (fields.agent_channel_code != null) patch.agent_channel_code = String(fields.agent_channel_code);
  if (fields.status != null) patch.status = String(fields.status);
  if (fields.name != null) patch.name = String(fields.name);
  if (fields.company_name != null) patch.company_name = String(fields.company_name);
  if (fields.user_code != null) patch.user_code = String(fields.user_code);
  if (fields.agent_payout_rate != null && fields.agent_payout_rate !== '') {
    patch.agent_payout_rate = Number(fields.agent_payout_rate);
  }
  if (fields.is_team_manager != null) patch.is_team_manager = String(fields.is_team_manager);
  if (fields.is_active != null) patch.is_active = String(fields.is_active);
  if (!Object.keys(patch).length) return;
  const before = (await get(ref(db, `users/${uid}`))).val() as Record<string, unknown> | null;
  await update(ref(db, `users/${uid}`), patch);
  await writeIdentityAudit(uid, 'update', before, { ...(before || {}), ...patch }, '회원 신원·운영 프로필 수정');
}

/** 관리자 회원 사용상태 변경 — Auth 로그인 차단과 운영 프로필을 서버에서 함께 갱신한다. */
export async function adminSetUserActive(uid: string, active: boolean): Promise<void> {
  const auth = getAuthClient();
  const current = auth?.currentUser;
  if (!current) throw new Error('관리자 로그인이 필요합니다');
  if (!uid) throw new Error('uid 없음');
  const token = await current.getIdToken();
  const response = await fetch(`/api/admin/members/${encodeURIComponent(uid)}/active`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ active }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `회원 상태 변경 실패 (${response.status})`);
}

export type ApproveUserResult = {
  status: 'active' | 'pending';
  role?: string;
  company_code?: string;
  matched: boolean;
};

/**
 * 가입 승인 — status=active 로 전환.
 *  H1 결정(지정보존): 최초 승인만 bizNo로 신원 파생·배정. 이미 신원이 있는(=이전 승인 또는 관리자 수동지정)
 *  유저의 재승인/활성토글은 신원을 보존하고 활성화만 한다 — 관리자 지정이 조용히 리셋되던 결함 차단.
 *  미등록 사업자번호 = 개인영업자(agent/SP999). 신청 유형이 공급/영업이어도 소속이 없으면 개인으로 승인한다.
 *  opts.rematch=true 면 신원이 있어도 강제 재파생(파트너 디렉토리 갱신 후 명시적 재매칭용 이스케이프 해치).
 */
export async function approveUser(uid: string, active = true, opts?: { rematch?: boolean }): Promise<ApproveUserResult> {
  const db = getRtdb(); if (!db) throw new Error('DB가 설정되지 않았습니다');
  if (!uid) throw new Error('uid 없음');
  if (!active) {
    const patch = { status: 'pending' };
    await writeApprovedUser(uid, patch);
    await writeIdentityAudit(uid, 'approve', null, patch, '가입 승인취소(대기로 되돌림)');
    return { status: 'pending', matched: false };
  }
  const u = (await get(ref(db, `users/${uid}`))).val() as Record<string, unknown> | null;
  const existingCompany = String((u && u.company_code) || '').trim();
  const hasRealAffiliation = !!existingCompany && existingCompany !== PERSONAL_AGENT_COMPANY;
  let patch: Record<string, unknown>;
  let summary: string;
  let matched = hasRealAffiliation;
  if (hasRealAffiliation && !opts?.rematch) {
    patch = { status: 'active', is_active: '예' };
    summary = '가입 승인(기존 신원 보존)';
  } else if (opts?.rematch) {
    const bizNo = businessRegistrationNumberOf(u, 'user');
    const user_code = String((u && u.user_code) || uid).trim();
    const { role, company_code, agent_channel_code, matched_partner_code } = await resolveIdentity(bizNo);
    const channel = resolveAgentChannel(role, company_code, agent_channel_code, user_code, uid);
    matched = !!matched_partner_code;
    patch = {
      status: 'active', is_active: '예', role, company_code, agent_channel_code: channel,
      company_name: matched ? String((u && u.company_name) || '') : PERSONAL_AGENT_NAME,
      matched_partner_code: matched_partner_code || null,
    };
    summary = matched
      ? `가입 승인 · ${role}/${company_code} (파트너 ${matched_partner_code}) [재매칭]`
      : `가입 승인 · 개인영업자(${company_code}) [재매칭]`;
  } else {
    // 바로 승인 = 개인영업자. 소속 회사 연결은 이후 회원관리에서 한다.
    const user_code = String((u && u.user_code) || uid).trim();
    patch = {
      status: 'active',
      is_active: '예',
      role: 'agent',
      company_code: PERSONAL_AGENT_COMPANY,
      company_name: PERSONAL_AGENT_NAME,
      agent_channel_code: user_code || uid,
      matched_partner_code: null,
    };
    matched = false;
    summary = `가입 승인 · 개인영업자(${PERSONAL_AGENT_COMPANY})`;
  }
  await writeApprovedUser(uid, patch);
  await writeIdentityAudit(uid, 'approve', u, { ...(u || {}), ...patch }, summary);
  return {
    status: 'active',
    role: String(patch.role ?? u?.role ?? ''),
    company_code: String(patch.company_code ?? u?.company_code ?? ''),
    matched,
  };
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
    if (!dry) { await update(ref(db, `users/${uid}`), { agent_channel_code: to }); await writeIdentityAudit(uid, 'update', { agent_channel_code: ch }, { agent_channel_code: to }, `개인채널 백필 ${ch || '(빈)'}→${to}`); }
  }
  return { scanned, updated, skipped };
}
