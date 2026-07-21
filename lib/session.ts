// 세션 actor — store 감사 훅이 참조. 실 로그인 세션 우선(감사 귀속 정확·위조 방지), 없을 때만 로컬 스텁(둘러보기/데모).
// getSession은 firebase 무의존 경량 리더라 순환의존 없음.
import { getSession } from '@/lib/auth-session';

export function currentActor(): { uid: string; role: string; name: string } {
  const s = getSession();
  if (s) return { uid: s.uid, role: s.role, name: s.name || s.code || s.uid };
  if (typeof window === 'undefined') return { uid: 'system', role: 'agent', name: 'system' };
  const r = localStorage.getItem('fp4_role') || 'agent';
  const A: Record<string, { uid: string; name: string }> = {
    agent: { uid: 'usr_park', name: '박영업' },
    provider: { uid: 'sup_jeil', name: '제일오토렌탈' },
    admin: { uid: 'usr_admin', name: '관리자' },
  };
  const a = A[r] || A.agent;
  return { uid: a.uid, role: r, name: a.name };
}
