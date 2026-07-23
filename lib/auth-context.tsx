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
import { getSession, subscribeSession, isGuest, isPending, type Session } from '@/lib/auth-session';
import { isPublicPath, setPublicAccess } from '@/lib/public-access';
import { Btn, C, FS, FW, R } from '@/components/ui';

const Ctx = createContext<{ session: Session | null; ready: boolean }>({ session: null, ready: false });
export function useSession(): Session | null { return useContext(Ctx).session; }
export function useAuthReady(): boolean { return useContext(Ctx).ready; }

function AuthLoading() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: C.taupeBg, color: C.mute, fontSize: FS.title }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${C.line}`, borderTopColor: C.brand, borderRadius: '50%', animation: 'fp-authspin 0.7s linear infinite' }} />
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

  // 유휴 자동 로그아웃 — 로그인 상태에서만 무장(설정 0분이면 모듈 내부에서 끔).
  useEffect(() => {
    if (!active || !session) return;
    let alive = true;
    let stop = () => {};
    import('@/lib/idle-logout').then((m) => { if (alive) { m.startIdleLogout(); stop = m.stopIdleLogout; } });
    return () => { alive = false; stop(); };
  }, [active, session]);

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

  // 가입 승인 대기 — 로그인은 됐지만 아직 관리자 승인 전. 공개면(/q·/catalog·/sign)과 /login 은 통과.
  if (mounted && active && isPending(session) && !onLogin && !publicPage) {
    return <PendingApproval email={session?.email || ''} />;
  }

  return <Ctx.Provider value={{ session, ready }}>{children}</Ctx.Provider>;
}

/** 승인 대기 안내 — 데이터에 접근시키지 않고 여기서 멈춘다. */
function PendingApproval({ email }: { email: string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: C.taupeBg, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: FS.page, fontWeight: FW.head, color: C.brand }}>가입 승인 대기 중입니다</div>
      <div style={{ fontSize: FS.body, color: C.mute, lineHeight: 1.7, maxWidth: 380 }}>
        가입 신청이 접수되었습니다. 관리자가 사업자·소속을 확인한 뒤 승인하면 이용할 수 있습니다.
        <br />승인이 끝나면 다시 로그인해 주세요.
      </div>
      {email && <div style={{ fontSize: FS.sub, color: C.faint }}>{email}</div>}
      <Btn
        variant="ghost"
        onClick={() => { void import('@/lib/firebase/auth').then((m) => m.logout()).then(() => { window.location.href = '/login'; }); }}
        style={{ marginTop: 6, borderRadius: R }}
      >
        로그아웃
      </Btn>
    </div>
  );
}
