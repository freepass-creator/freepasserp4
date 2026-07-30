/**
 * 인증 세션 — firebase 무의존(순수 상태). auth.ts 가 여기에 프로필을 쓰고,
 * deal.ts/페이지/컴포넌트가 여기서 역할·귀속코드를 읽는다(순환 import 방지).
 * v3 users/{uid} 프로필(role·company_code·agent_channel_code·name)을 v4 3역할로 투영.
 */
export type V4Role = 'agent' | 'provider' | 'admin';

export interface Session {
  uid: string;
  email: string;
  role: V4Role;
  rawRole: string;        // v3 원본(agent_admin 등) — 세부 권한 후속용
  name: string;
  /** 목록·방·계약 귀속키. 공급사=company_code, 영업자=user_code(사람), 관리자=user_code|uid */
  code: string;
  company_code: string;
  agent_channel_code: string; // 채널(팀) — 필터·요율용. 방키/계약 agent_code 와 분리
  user_code: string;          // 사람키 — /q?a= · CH_{매물}_{user_code}
  /** 가입 승인 상태. 'pending' = 관리자 승인 대기(앱 사용 차단). 값 없음 = 이 필드 이전 회원 → 정상. */
  status?: string;
  /** 관리자가 끈 계정. '아니오'/false = 비활성 — 로그인은 되지만 앱 사용은 막아야 한다. */
  is_active?: string;
}

/** 승인 대기 여부 — 'pending' 만. 값이 없는 기존 회원을 잠그지 않기 위해 블랙리스트. */
export function isPending(s: Session | null): boolean {
  return String(s?.status || '') === 'pending';
}

/**
 * 앱 사용 차단 여부 — 승인대기 + **비활성·삭제·반려**.
 * 예전엔 isPending('pending')만 봐서 관리자가 회원을 비활성/삭제해도 그 계정이 그대로
 * 로그인해 데이터를 봤다(QA AUTH-6). 퇴사자·차단 대상이 계속 접근하는 구멍.
 * 비활성은 문자열('아니오')·불리언(false) 양쪽으로 저장돼 있어 둘 다 본다.
 */
export function isBlocked(s: Session | null): boolean {
  if (!s) return false;
  const st = String(s.status || '');
  if (st === 'pending' || st === 'deleted' || st === 'rejected') return true;
  const act = String(s.is_active ?? '');
  return act === '아니오' || act === 'false';
}

/** 차단 사유 — 화면 문구 분기용. */
export function blockReason(s: Session | null): 'pending' | 'inactive' | null {
  if (!isBlocked(s)) return null;
  return String(s?.status || '') === 'pending' ? 'pending' : 'inactive';
}

const CACHE = 'fp4_session';
let _session: Session | null = null;
let _loaded = false;
const subs = new Set<(s: Session | null) => void>();

/** 세부 조직 역할 → 기존 화면용 3역할. 세부 권한 판정은 rawRole을 보존해 authorization.ts가 담당한다. */
export function mapRole(raw: string): V4Role {
  if (raw === 'provider' || raw === 'provider_admin') return 'provider';
  if (raw === 'admin') return 'admin';
  return 'agent';
}

export function getSession(): Session | null {
  if (_loaded) return _session;
  if (typeof window === 'undefined') return null;
  try { const raw = localStorage.getItem(CACHE); if (raw) _session = JSON.parse(raw) as Session; } catch { /* noop */ }
  _loaded = true;
  return _session;
}

export function setSession(s: Session | null): void {
  _session = s; _loaded = true;
  if (typeof window !== 'undefined') {
    if (s) localStorage.setItem(CACHE, JSON.stringify(s)); else localStorage.removeItem(CACHE);
    window.dispatchEvent(new CustomEvent('fp:session', { detail: s }));
    // 메뉴·페이지 역할 게이트가 fp:role 만 듣는 경우 — 세션 역할도 같이 전파
    if (s?.role) window.dispatchEvent(new CustomEvent('fp:role', { detail: s.role }));
  }
  subs.forEach((cb) => cb(s));
}

export function subscribeSession(cb: (s: Session | null) => void): () => void {
  subs.add(cb); return () => { subs.delete(cb); };
}

/** 둘러보기(비로그인 체험) 플래그 — v3 enterDemo 대응. */
const GUEST = 'fp4_guest';
export function isGuest(): boolean { return typeof window !== 'undefined' && localStorage.getItem(GUEST) === '1'; }
export function setGuest(on: boolean): void { if (typeof window !== 'undefined') { if (on) localStorage.setItem(GUEST, '1'); else localStorage.removeItem(GUEST); } }
