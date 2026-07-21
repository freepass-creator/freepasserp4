'use client';
/**
 * AuthProvider — 실인증 부팅 + 인증 게이트. firebaseReady 일 때만 활성.
 *   · initAuth() 1회 → onAuthStateChanged 로 세션 채움.
 *   · 비로그인 → /login. /login · /q · /catalog · /sign 은 공개 통과.
 *   · firebase 미설정(로컬 전용)이면 게이트 비활성 → 기존처럼 그냥 진입.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { firebaseReady } from '@/lib/firebase/client';
import { getSession, subscribeSession, isGuest, type Session } from '@/lib/auth-session';
import { isPublicPath, setPublicAccess } from '@/lib/public-access';

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
  const [mounted, setMounted] = useState(false);
  const [session, setSess] = useState<Session | null>(null);
  const [ready, setReady] = useState(!active);
  const publicPage = isPublicPath(pathname);

  useEffect(() => { setPublicAccess(publicPage); }, [publicPage]);

  useEffect(() => {
    setMounted(true);
    if (!active) return;
    const cached = getSession();
    if (cached) setSess(cached);
    const unsub = subscribeSession(setSess);
    let alive = true;
    const done = () => { if (alive) setReady(true); };
    const t = setTimeout(done, 6000);
    import('@/lib/firebase/auth')
      .then(({ initAuth }) => initAuth())
      .then(done)
      .catch((e) => { console.warn('[auth] initAuth 실패 — 로컬 진행:', e?.message || e); done(); });
    return () => { alive = false; clearTimeout(t); unsub(); };
  }, [active]);

  useEffect(() => {
    const h = (e: PromiseRejectionEvent) => {
      const msg = String((e?.reason as { message?: string })?.message || e?.reason || '');
      if (/permission_denied|permission denied/i.test(msg)) { console.warn('[firebase] 권한거부 무시(로컬 진행):', msg); e.preventDefault(); }
    };
    window.addEventListener('unhandledrejection', h);
    return () => window.removeEventListener('unhandledrejection', h);
  }, []);

  // ready 전엔 캐시 세션·게스트로 통과 — persistence 복원 race에 /login 튕김 방지.
  const authed = !!session || isGuest() || (!ready && !!getSession());
  const onLogin = pathname === '/login';
  // 손님 공개면(/q·/catalog·/sign)은 로그인 없이 통과.
  const allowed = authed || onLogin || publicPage;

  useEffect(() => {
    if (!active || !ready) return;
    if (!allowed) router.replace('/login');
  }, [active, ready, allowed, router]);

  if (mounted && active && !allowed && !ready) return <AuthLoading />;

  return <Ctx.Provider value={{ session, ready }}>{children}</Ctx.Provider>;
}
