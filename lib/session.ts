// 세션 actor(로컬 스텁) — store 감사 훅이 참조. deal.ts와 같은 소스지만 store 순환의존 회피용 경량 리더.
// 실인증(Firebase Auth) 도입 시 여기만 교체.
export function currentActor(): { uid: string; role: string; name: string } {
  if (typeof window === 'undefined') return { uid: 'system', role: 'agent', name: 'system' };
  const r = localStorage.getItem('fp4_role') || 'agent';
  const A: Record<string, { uid: string; name: string }> = {
    agent: { uid: 'u-777', name: '박영업' },
    provider: { uid: 'pv-01', name: '제일오토렌탈' },
    admin: { uid: 'admin', name: '관리자' },
  };
  const a = A[r] || A.agent;
  return { uid: a.uid, role: r, name: a.name };
}
