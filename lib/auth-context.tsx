'use client';
/**
 * AuthProvider — 실인증 부팅 + 인증 게이트. firebaseReady 일 때만 활성.
 *   · initAuth() 1회 → onAuthStateChanged 로 세션 채움.
 *   · 비로그인 + 비둘러보기 → /login 리다이렉트. /login 은 항상 통과.
 *   · firebase 미설정(로컬 전용)이면 게이트 비활성 → 기존처럼 그냥 진입.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { firebaseReady } from '@/lib/firebase/client';
import { getSession, subscribeSession, isGuest, type Session } from '@/lib/auth-session';

const Ctx = createContext<{ session: Session | null; ready: boolean }>({ session: null, ready: false });
export function useSession(): Session | null { return useContext(Ctx).session; }
export function useAuthReady(): boolean { return useContext(Ctx).ready; }

function AuthLoading() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#fff', color: '#495057', fontSize: 14 }}>
      <div style={{ width: 32, height: 32, border: '3px solid #d5d8dc', borderTopColor: '#1B2A4A', borderRadius: '50%', animation: 'fp-authspin 0.7s linear infinite' }} />
      <span>인증 중…</span>
      <style>{'@keyframes fp-authspin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const active = firebaseReady();
  const [session, setSess] = useState<Session | null>(() => (active ? getSession() : null));
  const [ready, setReady] = useState(!active);

  useEffect(() => {
    if (!active) return;
    const unsub = subscribeSession(setSess);
    let alive = true;
    import('@/lib/firebase/auth').then(({ initAuth }) => initAuth()).then(() => { if (alive) setReady(true); });
    return () => { alive = false; unsub(); };
  }, [active]);

  const authed = !!session || isGuest();
  const onLogin = pathname === '/login';

  useEffect(() => {
    if (!active || !ready) return;
    if (!authed && !onLogin) router.replace('/login');
  }, [active, ready, authed, onLogin, router]);

  // 로그인 화면은 즉시 통과. 그 외엔 인증 확정 전/미인증 시 로딩(콘텐츠 플래시 방지).
  if (active && !onLogin && (!ready || !authed)) return <AuthLoading />;

  return <Ctx.Provider value={{ session, ready }}>{children}</Ctx.Provider>;
}
