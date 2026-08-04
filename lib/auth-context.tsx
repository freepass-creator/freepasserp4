'use client';
/**
 * AuthProvider — 실인증 부팅 + 인증 게이트. firebaseReady 일 때만 활성.
 *   · initAuth() 1회 → onAuthStateChanged 로 세션 채움.
 *   · 비로그인 → /login. /login · /q · /catalog · /sign 은 공개 통과.
 *   · firebase 미설정(로컬 전용)이면 게이트 비활성 → 기존처럼 그냥 진입.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle2, LogOut, ShieldCheck } from 'lucide-react';
import { firebaseReady } from '@/lib/firebase/client';
import { getSession, subscribeSession, isGuest, isBlocked, blockReason, needsLegalReconsent, type Session } from '@/lib/auth-session';
import { isPublicPath, setPublicAccess } from '@/lib/public-access';
import { LEGAL_VERSION } from '@/lib/legal';
import { Btn, ButtonLabel, C, FS, FW, ICON, R, SH } from '@/components/ui';

const REQUIRE_LEGAL_RECONSENT = process.env.NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT === 'true';

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

  // 비허용 = 자식(설정 데모 플래시 등) 그리지 않음. ready 전이든 로그아웃 직후든 동일.
  if (mounted && active && !allowed) return <AuthLoading />;

  // 사용 차단 — 승인 대기 + **비활성·삭제·반려**. 로그인은 됐어도 데이터에 접근시키지 않는다.
  //  예전엔 'pending'만 봐서 관리자가 끈 계정(퇴사자 등)이 그대로 이용했다(QA AUTH-6).
  //  공개면(/q·/catalog·/sign)과 /login 은 통과.
  if (mounted && active && isBlocked(session) && !onLogin && !publicPage) {
    return <PendingApproval email={session?.email || ''} reason={blockReason(session) || 'pending'} />;
  }

  // 기존 회원 재동의는 운영자 정보 확정·Preview 검증 후 환경변수로 켠다. 캐시 세션만 보고
  // 오판하지 않도록 Firebase 프로필 로드가 끝난 ready 상태에서만 게이트한다.
  if (mounted && active && ready && REQUIRE_LEGAL_RECONSENT && session && !isGuest()
    && !onLogin && !publicPage && needsLegalReconsent(session, LEGAL_VERSION)) {
    return <LegalReconsent email={session.email} />;
  }

  return <Ctx.Provider value={{ session, ready }}>{children}</Ctx.Provider>;
}

function LegalReconsent({ email }: { email: string }) {
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canSubmit = terms && privacy && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const { recordCurrentLegalConsent } = await import('@/lib/firebase/auth');
      await recordCurrentLegalConsent();
    } catch (e) {
      setError((e as Error)?.message || '동의 기록을 저장하지 못했습니다. 다시 시도해 주세요.');
      setBusy(false);
    }
  };

  const consentRow = (checked: boolean, setChecked: (value: boolean) => void, href: string, label: string) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, border: `1px solid ${C.line}`, borderRadius: R, cursor: 'pointer', color: C.ink, fontSize: FS.body, lineHeight: 1.5 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => setChecked(event.target.checked)}
        style={{ marginTop: 3, accentColor: C.brand }}
      />
      <span style={{ flex: 1 }}>
        <strong style={{ fontWeight: FW.strong }}>[필수] {label}에 동의합니다.</strong>
        {' '}
        <a href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} style={{ color: C.accent }}>
          내용 보기
        </a>
      </span>
    </label>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 16, padding: 24, background: C.taupeBg, border: `1px solid ${C.line}`, borderRadius: R, boxShadow: SH.modal }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.brand }}>
          <ShieldCheck size={ICON.xl} aria-hidden />
          <h1 style={{ margin: 0, fontSize: FS.page, fontWeight: FW.head }}>약관 확인이 필요합니다</h1>
        </div>
        <p style={{ margin: 0, color: C.mute, fontSize: FS.body, lineHeight: 1.7 }}>
          서비스 이용을 계속하려면 현재 이용약관과 개인정보 처리방침을 확인하고 동의해 주세요.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {consentRow(terms, setTerms, '/terms', '이용약관')}
          {consentRow(privacy, setPrivacy, '/privacy', '개인정보 처리방침')}
        </div>
        {error && <div role="alert" style={{ color: C.danger, fontSize: FS.sub }}>{error}</div>}
        <Btn full disabled={!canSubmit} onClick={() => { void submit(); }} haptic="success">
          <ButtonLabel icon={<CheckCircle2 size={ICON.md} aria-hidden />}>
            {busy ? '저장 중…' : '동의하고 계속하기'}
          </ButtonLabel>
        </Btn>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: C.faint, fontSize: FS.cap }}>{email}</span>
          <Btn
            size="sm"
            variant="bare"
            onClick={() => { void import('@/lib/firebase/auth').then((m) => m.logout()).then(() => { window.location.href = '/login'; }); }}
          >
            <ButtonLabel icon={<LogOut size={ICON.sm} aria-hidden />}>로그아웃</ButtonLabel>
          </Btn>
        </div>
      </div>
    </div>
  );
}

/** 사용 차단 안내 — 데이터에 접근시키지 않고 여기서 멈춘다. */
function PendingApproval({ email, reason }: { email: string; reason: 'pending' | 'inactive' | 'unassigned' }) {
  const inactive = reason === 'inactive';
  const unassigned = reason === 'unassigned';
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: C.taupeBg, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: FS.page, fontWeight: FW.head, color: C.brand }}>
        {unassigned ? '역할 지정이 필요한 계정입니다' : inactive ? '이용이 중지된 계정입니다' : '가입 승인 대기 중입니다'}
      </div>
      <div style={{ fontSize: FS.body, color: C.mute, lineHeight: 1.7, maxWidth: 380 }}>
        {unassigned ? (
          <>관리자가 영업자·공급사·운영자 역할을 지정해야 이용할 수 있습니다.<br />담당자에게 역할 지정을 요청해 주세요.</>
        ) : inactive ? (
          <>이 계정은 관리자가 이용을 중지했습니다.<br />문의가 필요하면 담당자에게 연락해 주세요.</>
        ) : (
          <>가입 신청이 접수되었습니다. 관리자가 사업자·소속을 확인한 뒤 승인하면 이용할 수 있습니다.<br />승인이 끝나면 다시 로그인해 주세요.</>
        )}
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
