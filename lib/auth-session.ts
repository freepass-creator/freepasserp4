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
}

const CACHE = 'fp4_session';
let _session: Session | null = null;
let _loaded = false;
const subs = new Set<(s: Session | null) => void>();

/** v3 role → v4 3역할. agent/agent_admin/agent_manager=영업자, provider=공급사, admin=관리자. */
export function mapRole(raw: string): V4Role {
  if (raw === 'provider') return 'provider';
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
