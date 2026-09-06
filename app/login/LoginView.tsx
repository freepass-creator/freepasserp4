'use client';
/**
 * 로그인 — freepasserp3 v3 화면 그대로(똑같이). 실 Firebase Auth(회원 공유).
 *   login / 즉시 이용 가능한 개인 영업자 가입 / 재설정.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type User } from 'firebase/auth';
import { login, signup, logout, resetPassword, writeUserProfile } from '@/lib/firebase/auth';
import { getSession, firebaseReadySafe } from '@/lib/login-helpers';
import { fmtPhone, C, FS, FW, R, CTRL, ICON, ctrlPadX, Btn, Input, Select, Checkbox, Loading } from '@/components/ui';
import { BRAND_MAIN, BRAND_SUB } from '@/lib/brand';
import { FREEPASS, hasBrand, whitelabelVars, type Whitelabel } from '@/lib/whitelabel';
import { LEGAL_VERSION } from '@/lib/legal';
import { toast } from '@/components/Toaster';
/**
 * ★2026-08-30 — 현관도 공용 원자로 선다(`docs/건물도면.md` §4 1순위).
 *   전에는 「v3 CSS 섬(44/48)이 원자 높이(32/40)와 충돌 → raw 유지」였다.
 *   그래서 원자에 `lg`(웹 44 / 모바일 48) 한 단을 더했다 — **이 파일이 쓰던 값 그대로**라
 *   보이는 것은 그대로고, 규격만 `tokens.ts` 한 곳으로 모였다.
 *   사장님 2026-08-30 「원자 규격을 통일해서 그게 달라지면 거길 바꾸면 되니까」
 *   ⚠ 남은 CSS 는 «치수»가 아니라 그릇·워드마크·모바일 흰 바탕뿐이다. 여기에 height 를 다시 적지 말 것.
 */

type Mode = 'login' | 'signup' | 'reset';

// Firebase Auth 에러 → 한글(v3 koreanAuthMsg)
const AUTH_MSG: Record<string, string> = {
  'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다',
  'auth/wrong-password': '비밀번호가 올바르지 않습니다',
  'auth/user-not-found': '등록되지 않은 이메일입니다',
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다',
  'auth/user-disabled': '비활성화된 계정입니다',
  'auth/too-many-requests': '시도가 많습니다. 잠시 후 다시 시도해주세요',
  'auth/network-request-failed': '네트워크 오류 — 연결을 확인해주세요',
  'auth/operation-not-allowed': '해당 로그인 방식이 비활성화되어 있습니다',
  'auth/email-already-in-use': '이미 사용 중인 이메일입니다',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다',
  'auth/missing-email': '이메일을 입력해주세요',
  'auth/missing-password': '비밀번호를 입력해주세요',
};
function koreanAuthMsg(err: unknown, fallback: string): string {
  const code = (err as { code?: string })?.code;
  return (code && AUTH_MSG[code]) || (err as { message?: string })?.message || fallback;
}

/** Firebase에 보내기 전에 공백·대소문자를 정리하고, 명백히 잘못된 주소는 화면에서 막는다. */
function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}
function hasEmailShape(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** 인증 폼 입력칸 공통 — 한 줄로 모아 둬야 열여덟 칸이 따로 놀지 않는다. */
const FIELD = { size: 'lg', full: true } as const;

/** 라벨 위·칸 아래. `<label>` 로 감싸 라벨을 눌러도 칸이 잡힌다(id/htmlFor 짝이 필요 없다). */
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <label className="login-field"><span>{label}</span>{children}</label>;
}

/** 처리 중 덮개 — 카드 위를 덮고 공용 `Loading` 원자를 세운다(스피너 손롤 금지). */
function BusyVeil() {
  return <div className="login-busy" aria-busy><Loading label="처리 중…" /></div>;
}

type Agree = { terms: boolean; privacy: boolean };

/**
 * 가입 동의 — 이용약관·개인정보 수집·이용 둘 다 필수.
 * 링크는 새 창으로 연다: 작성 중인 가입 폼을 잃지 않고 본문을 읽을 수 있어야 동의가 의미를 갖는다.
 */
function ConsentBox({ agree, setAgree }: { agree: Agree; setAgree: (a: Agree) => void }) {
  const all = agree.terms && agree.privacy;
  // 기본 체크박스는 13px라 손가락으로 누르기 어렵다. 상자를 키우고 행 자체를 눌러도 켜지게 한다.
  // 높이는 숫자로 적지 않는다 — 터치 타깃은 CTRL.lg(44)가 정본이다.
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: CTRL.lg.web, fontSize: FS.sub, color: C.ink, lineHeight: 1.5, cursor: 'pointer' };
  const box: React.CSSProperties = { width: ICON.lg, height: ICON.lg, flex: '0 0 auto', accentColor: C.brand, cursor: 'pointer' };
  // 링크는 글자 높이뿐이라 위아래로 여백을 줘 실제로 누를 수 있게 만든다.
  const link: React.CSSProperties = { color: C.accent, textDecoration: 'underline', textUnderlineOffset: 2, minHeight: CTRL.lg.web, padding: '0 2px', display: 'inline-flex', alignItems: 'center' };
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, padding: `10px ${ctrlPadX(true)}px`, margin: '0 0 10px', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
      <label style={{ ...row, fontWeight: FW.strong, paddingBottom: 8, borderBottom: `1px solid ${C.line}` }}>
        <Checkbox style={box} checked={all} ariaLabel="전체 동의" onChange={(checked) => setAgree({ terms: checked, privacy: checked })} />
        전체 동의
      </label>
      <label style={row}>
        <Checkbox style={box} checked={agree.terms} ariaLabel="이용약관 동의(필수)" onChange={(checked) => setAgree({ ...agree, terms: checked })} />
        <span>[필수] <a href="/terms" target="_blank" rel="noopener noreferrer" style={link} onClick={(e) => e.stopPropagation()}>이용약관</a>에 동의합니다</span>
      </label>
      <label style={row}>
        <Checkbox style={box} checked={agree.privacy} ariaLabel="개인정보 수집·이용 동의(필수)" onChange={(checked) => setAgree({ ...agree, privacy: checked })} />
        <span>[필수] <a href="/privacy" target="_blank" rel="noopener noreferrer" style={link} onClick={(e) => e.stopPropagation()}>개인정보 수집·이용</a>에 동의합니다</span>
      </label>
      <p style={{ margin: 0, fontSize: FS.cap, color: C.faint, lineHeight: 1.5 }}>
        수집 항목: 이메일·이름(필수), 연락처·소속 회사명·사업자등록번호(선택) · 목적: 회원 식별과 서비스 제공 · 보유: 이용계약 종료 시까지(관계 법령이 정한 기간은 그에 따름)
      </p>
    </div>
  );
}

// 로그인 후 세션 확정 대기 — onAuthStateChanged 프로필 로드까지.
function waitForSession(ms = 5000): Promise<void> {
  if (getSession()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener('fp:session', h); clearTimeout(t); resolve(); };
    const h = (e: Event) => { if ((e as CustomEvent).detail) done(); };
    const t = setTimeout(done, ms);
    window.addEventListener('fp:session', h);
  });
}

function loginDestination(): string {
  if (typeof window === 'undefined') return '/finder';
  const next = new URLSearchParams(window.location.search).get('next') || '';
  // 같은 앱의 절대 경로만 허용해 외부 주소로 빠지는 오픈 리다이렉트를 막는다.
  return next.startsWith('/') && !next.startsWith('//') ? next : '/finder';
}

/**
 * ★★현관도 «채널 이름»으로 선다(사장님 2026-09-05 「손님 페이지는 로그인이 필요 없지, 그냥 유니오토
 *   이름으로 나가잖아. 근데 거기서 로그인을 할 수 있어요. 그러니까 **로그인 페이지부터 다른 거야**」).
 *
 *   유니오토 주소로 들어온 사람이 로그인하려는 순간 `freepasserp.com` 워드마크가 뜨면,
 *   앞에서 감춘 것이 거기서 다 새어 나간다. 손님 화면과 «같은 호스트»인데 현관만 우리 이름인 것이다.
 *   브랜드는 서버 껍데기(`page.tsx`)가 호스트를 보고 정해서 넘긴다 — 목록·상세와 같은 규칙이다.
 */
export default function LoginView({ wl = FREEPASS }: { wl?: Whitelabel }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'muted' | 'ok' | 'err' }>({ text: '', tone: 'muted' });
  // 필드
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [su, setSu] = useState({ email: '', pw: '', pw2: '', name: '', phone: '', company: '', bizNo: '', type: '' });
  // 필수 동의 — 둘 다 받아야 가입. 동의 시각·버전은 프로필에 남긴다(무엇에 동의했는지 증명).
  const [agree, setAgree] = useState({ terms: false, privacy: false });
  const [bizMatch, setBizMatch] = useState<{ text: string; cls: '' | 'ok' | 'miss' }>({ text: '', cls: '' });
  const [rpEmail, setRpEmail] = useState('');
  const bizTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (text: string, tone: 'muted' | 'ok' | 'err' = 'muted') => setMsg({ text, tone });
  const switchMode = (m: Mode) => { setMode(m); say(''); };

  // 이미 로그인한 계정만 홈으로 보낸다. 비로그인 ERP 게스트 진입은 제공하지 않는다.
  // 로그인 뒤 도착지는 /finder — '/' 는 공개 안내 페이지가 됐다(2026-08-15).
  useEffect(() => { if (firebaseReadySafe() && getSession()) router.replace(loginDestination()); }, [router]);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    const loginEmail = normalizedEmail(email);
    if (!hasEmailShape(loginEmail)) { say('이메일 형식을 확인해주세요. 예: name@company.com', 'err'); return; }
    if (!pw) { say('비밀번호를 입력해주세요.', 'err'); return; }
    setBusy(true); say('');
    try { await login(loginEmail, pw); await waitForSession(); router.replace(loginDestination()); }
    catch (err) { console.error('[login]', err); say(koreanAuthMsg(err, '로그인 실패'), 'err'); setBusy(false); }
  };

  // 사업자번호 포맷 + 실시간 partners 매칭(읽기)
  const onBizNo = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 10);
    let f = d;
    if (d.length > 5) f = `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    else if (d.length > 3) f = `${d.slice(0, 3)}-${d.slice(3)}`;
    setSu((s) => ({ ...s, bizNo: f }));
    if (bizTimer.current) clearTimeout(bizTimer.current);
    if (d.length < 10) { setBizMatch({ text: '', cls: '' }); return; }
    bizTimer.current = setTimeout(async () => {
      try {
        const { matchBizNo } = await import('@/lib/login-helpers');
        const r = await matchBizNo(d);
        if (!r) setBizMatch({ text: '등록된 소속 없음 — 가입 후에도 바로 이용할 수 있습니다', cls: 'miss' });
        else setBizMatch({ text: `소속 후보: ${r.name}${r.type ? ` · ${r.type}` : ''} — 가입 후 관리자가 연결합니다`, cls: 'ok' });
      } catch { setBizMatch({ text: '', cls: '' }); }
    }, 200);
  };

  const doSignup = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    const signupEmail = normalizedEmail(su.email);
    if (!hasEmailShape(signupEmail) || !su.pw || su.pw.length < 6) { say('이메일 형식과 비밀번호(6자 이상)를 확인해주세요', 'err'); return; }
    if (su.pw !== su.pw2) { say('비밀번호가 일치하지 않습니다', 'err'); return; }
    if (!su.name.trim()) { say('이름을 입력해주세요', 'err'); return; }
    if (!agree.terms || !agree.privacy) { say('이용약관·개인정보 수집·이용에 모두 동의해야 가입할 수 있습니다', 'err'); return; }
    setBusy(true); say('');
    let authUser: User;
    try { authUser = await signup(signupEmail, su.pw); }
    catch (authErr) {
      const m = (authErr as { code?: string })?.code === 'auth/email-already-in-use'
        ? '이미 가입된 이메일입니다. 로그인해주세요.'
        : koreanAuthMsg(authErr, '가입 실패');
      console.error('[signup]', authErr); say(m, 'err');
      toast(`가입 실패: ${m}`, 'error');
      setBusy(false); return;
    }
    try {
      // 프로필 저장 — 실패 시 Auth 계정 삭제(같은 이메일 재가입 가능)
      await writeUserProfile(authUser, {
        name: su.name.trim(), phone: su.phone.trim(), company_name: su.company.trim(),
        business_no: su.bizNo.trim(), requested_type: su.type,
        // 동의 사실은 프로필 저장과 같은 트랜잭션에 들어가야 한다 — 실패하면 계정도 지워지므로 어긋나지 않는다.
        consent: { terms: agree.terms, privacy: agree.privacy, version: LEGAL_VERSION },
      });
    } catch (err) {
      await authUser.delete().catch(() => {});
      const m = koreanAuthMsg(err, '가입 실패');
      console.error('[signup profile]', err); say(m, 'err');
      toast(`가입 실패: ${m}`, 'error');
      setBusy(false); return;
    }
    // 프로필까지 저장된 뒤 새로 부팅해 active 개인 영업자 세션으로 진입한다.
    say('가입 완료. 바로 이용할 수 있습니다.', 'ok');
    if (typeof window !== 'undefined') window.location.assign('/');
  };

  const doReset = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    const resetEmail = normalizedEmail(rpEmail);
    if (!hasEmailShape(resetEmail)) { say('이메일 형식을 확인해주세요. 예: name@company.com', 'err'); return; }
    setBusy(true); say('전송 중…', 'muted');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 진 쪽 타이머를 안 끄면 15초 뒤 처리되지 않은 reject 가 남는다.
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('요청 시간 초과 — 잠시 후 다시 시도해주세요')), 15000); });
      await Promise.race([resetPassword(resetEmail), timeout]);
      say('재설정 메일 전송됨. 이메일(스팸함 포함)을 확인하세요. 안 오면 몇 분 뒤 다시 보내주세요.', 'ok');
    } catch (err) { console.error('[reset]', err); say(koreanAuthMsg(err, '전송 실패'), 'err'); }
    finally {
      // 성공 시에도 반드시 풀 것 — 안 그러면 폼이 잠긴 채 남아 재전송이 막힌다(메일이 스팸으로 갔을 때 탈출구가 없음).
      if (timer) clearTimeout(timer);
      setBusy(false);
    }
  };

  const msgColor = msg.tone === 'ok' ? C.ok : msg.tone === 'err' ? C.danger : C.faint;

  const branded = hasBrand(wl);

  return (
    /*
     * 채널 주소면 `.fp-wl` 로 «토큰만» 뒤집는다 — 로그인 버튼·링크·포커스링이 전부 채널색을 따라온다.
     * 원자에 색을 칠하지 않는 그 규칙 그대로다(globals.css `.fp-wl`).
     */
    <div className={branded ? 'fp-login fp-wl' : 'fp-login'}
      style={branded ? (whitelabelVars(wl) as React.CSSProperties) : undefined}>
      <div className="login-page">
        {branded ? (
          /*
           * 채널 워드마크 — `.login-brand` 클래스를 안 쓴다. 그 규격은 우리 CI 전용이라
           * `text-transform: lowercase` 와 Exo 2 가 걸려 있어 「UNI AUTO PLAN」이 「uni auto plan」이 된다.
           * 남의 회사 이름을 우리 서체 규칙으로 눕히면 그건 그 회사 이름이 아니다.
           * 손님 머리띠(`WhitelabelFrame`)와 «같은 짜임»으로 세운다 — 같은 주소에서 두 얼굴이 되면 안 된다.
           */
          <div aria-label={wl.name} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 9 }}>
            <span style={{ fontSize: 26, fontWeight: FW.head, letterSpacing: '-0.03em', color: C.brand }}>
              {wl.wordmark.main}
            </span>
            <span style={{ fontSize: 15, fontWeight: FW.meta, letterSpacing: '0.15em', color: C.ink }}>
              {wl.wordmark.sub}
            </span>
          </div>
        ) : (
          <div className="login-brand" aria-label={`${BRAND_MAIN}${BRAND_SUB}`}>
            <span className="login-brand-main">{BRAND_MAIN}</span>
            <span className="login-brand-sub">{BRAND_SUB}</span>
          </div>
        )}

        {mode === 'login' && (
          <form className="login-card" onSubmit={doLogin} noValidate>
            {busy && <BusyVeil />}
            <header className="login-head"><h2 className="login-title">로그인</h2><p className="login-sub">이메일과 비밀번호를 입력해주세요.</p></header>
            <div className="login-form">
              <Field label="이메일"><Input type="email" placeholder="name@company.com" autoComplete="username" value={email} onChange={setEmail} {...FIELD} /></Field>
              <Field label="비밀번호"><Input type="password" placeholder="비밀번호 입력" autoComplete="current-password" value={pw} onChange={setPw} {...FIELD} /></Field>
              <Btn type="submit" size="lg" full disabled={busy} style={{ marginTop: 4 }}>로그인</Btn>
            </div>
            <div className="login-links">
              <a href="#" onClick={(e) => { e.preventDefault(); switchMode('signup'); }}>계정 만들기</a>
              <span className="login-links-sep">·</span>
              <a href="#" onClick={(e) => { e.preventDefault(); switchMode('reset'); }}>비밀번호 재설정</a>
            </div>
            {msg.text && <p className="login-msg" style={{ color: msgColor }} aria-live="polite">{msg.text}</p>}
          </form>
        )}

        {mode === 'signup' && (
          <form className="login-card" onSubmit={doSignup} noValidate>
            {busy && <BusyVeil />}
            <header className="login-head"><h2 className="login-title">계정 만들기</h2><p className="login-sub">가입 후 상품찾기와 계약 업무를 이용할 수 있습니다.</p></header>
            {msg.text && <p className="login-msg" style={{ margin: 0, color: msgColor, textAlign: 'center', fontWeight: FW.strong }} aria-live="polite">{msg.text}</p>}
            <div className="login-form">
              <Field label="이메일 (필수)"><Input type="email" placeholder="name@company.com" autoComplete="username" value={su.email} onChange={(v) => setSu({ ...su, email: v })} {...FIELD} /></Field>
              <Field label="비밀번호"><Input type="password" placeholder="6자 이상" autoComplete="new-password" value={su.pw} onChange={(v) => setSu({ ...su, pw: v })} {...FIELD} /></Field>
              <Field label="비밀번호 확인">
                <Input type="password" placeholder="비밀번호 재입력" autoComplete="new-password" value={su.pw2} onChange={(v) => setSu({ ...su, pw2: v })} {...FIELD} />
                {su.pw2 && su.pw !== su.pw2 && <p className="biz-no-match is-miss">비밀번호가 일치하지 않습니다</p>}
              </Field>
              <Field label="이름"><Input placeholder="홍길동" value={su.name} onChange={(v) => setSu({ ...su, name: v })} {...FIELD} /></Field>
              <Field label="연락처"><Input type="tel" inputMode="tel" placeholder="010-0000-0000" value={su.phone} onChange={(v) => setSu({ ...su, phone: fmtPhone(v) })} {...FIELD} /></Field>
              <Field label="소속 회사명 (선택)"><Input placeholder="나중에 입력해도 됩니다" value={su.company} onChange={(v) => setSu({ ...su, company: v })} {...FIELD} /></Field>
              <Field label="활동 유형 (선택)">
                <Select value={su.type} onChange={(v) => setSu({ ...su, type: v })} size="lg" full ariaLabel="활동 유형"
                  options={[{ value: '', label: '나중에 지정' }, { value: '공급', label: '공급사' }, { value: '영업', label: '영업(소속)' }, { value: '개인', label: '개인영업' }]} />
              </Field>
              <Field label="소속 사업자번호 (선택)">
                <Input inputMode="numeric" placeholder="나중에 입력해도 됩니다" noAutofill value={su.bizNo} onChange={onBizNo} {...FIELD} />
                {bizMatch.text && <p className={`biz-no-match${bizMatch.cls ? ` is-${bizMatch.cls}` : ''}`}>{bizMatch.text}</p>}
              </Field>
              <p className="login-msg" style={{ margin: '4px 0 8px', color: C.mute, fontSize: FS.sub, lineHeight: 1.4, textAlign: 'left' }}>처음에는 개인 영업자로 시작합니다. 실제 회사·채널 소속은 관리자 확인 후 연결됩니다.</p>
              <ConsentBox agree={agree} setAgree={setAgree} />
              <Btn type="submit" size="lg" full disabled={busy || !agree.terms || !agree.privacy} style={{ marginTop: 4 }}>계정 만들기</Btn>
            </div>
            <div className="login-links"><a href="#" onClick={(e) => { e.preventDefault(); switchMode('login'); }}>로그인으로 돌아가기</a></div>
            {msg.text && <p className="login-msg" style={{ color: msgColor }} aria-live="polite">{msg.text}</p>}
          </form>
        )}

        {mode === 'reset' && (
          <form className="login-card" onSubmit={doReset} noValidate>
            {busy && <BusyVeil />}
            <header className="login-head"><h2 className="login-title">비밀번호 재설정</h2><p className="login-sub">가입한 이메일로 재설정 링크를 보내드립니다.</p></header>
            <div className="login-form">
              <Field label="이메일"><Input type="email" placeholder="name@company.com" autoComplete="username" value={rpEmail} onChange={setRpEmail} {...FIELD} /></Field>
              <Btn type="submit" size="lg" full disabled={busy} style={{ marginTop: 4 }}>재설정 메일 전송</Btn>
            </div>
            <div className="login-links"><a href="#" onClick={(e) => { e.preventDefault(); switchMode('login'); }}>로그인으로 돌아가기</a></div>
            {msg.text && <p className="login-msg" style={{ color: msgColor }} aria-live="polite">{msg.text}</p>}
          </form>
        )}
      </div>
      <style>{LOGIN_CSS}</style>
    </div>
  );
}

// v3 desktop.css 로그인 규격 이식(스코프 .fp-login). 팔레트는 globals 토큰 변수로 미러.
const LOGIN_CSS = `
.fp-login{position:fixed;inset:0;z-index:9999;background:var(--bg-page);overflow:auto;}
.fp-login .login-page{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:40px 16px;padding-top:max(40px,env(safe-area-inset-top));padding-bottom:max(32px,env(safe-area-inset-bottom));background:var(--bg-page);-webkit-user-select:none;user-select:none;font-size:13px;line-height:1.5;}
.fp-login .login-page,.fp-login .login-page *{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
.fp-login .login-page input{-webkit-user-select:text;user-select:text;}
/* 워드마크 = 명함 CI(Exo 2): freepass(600·brand) + erp.com(300·sub).
   .login-page * Pretendard 덮어쓰기보다 specificity 높게 — 자식에도 Exo 2 강제 */
.fp-login .login-brand,.fp-login .login-brand span{font-size:25px;letter-spacing:-0.04em;text-transform:lowercase;font-family:'Exo 2','Pretendard',sans-serif;line-height:1;}
.fp-login .login-brand{display:flex;align-items:baseline;justify-content:center;}
.fp-login .login-brand-main{font-weight:600;color:var(--brand);}
.fp-login .login-brand-sub{font-weight:300;color:var(--text-sub);}
.fp-login .login-card{position:relative;width:100%;max-width:400px;background:var(--bg-card);border:none;border-radius:2px;padding:40px 32px;box-shadow:var(--shadow-md);display:grid;gap:24px;overflow:hidden;margin:0;}
/* ★처리 중 덮개 — 스피너를 CSS 로 손롤하지 않는다. 공용 Loading 원자가 그린다. */
.fp-login .login-busy{position:absolute;inset:0;z-index:10;display:grid;place-items:center;background:color-mix(in srgb, var(--bg-card) 85%, transparent);}
.fp-login .login-head{display:grid;gap:8px;}
.fp-login .login-title{margin:0;font-size:20px;font-weight:600;color:var(--text-main);line-height:1.3;letter-spacing:-0.02em;}
.fp-login .login-sub{margin:0;font-size:13px;color:var(--text-sub);line-height:1.5;}
.fp-login .login-form{display:grid;gap:16px;}
/* ★칸의 «치수»는 여기 없다 — Input/Select/Btn 원자(size=lg)가 정한다. 높이를 다시 적지 말 것. */
.fp-login .login-field{display:grid;gap:6px;}
.fp-login .login-field>span{font-size:12px;font-weight:500;color:var(--text-sub);line-height:1.4;}
.fp-login .login-links{display:flex;align-items:center;justify-content:center;gap:8px;font-size:11px;color:var(--text-weak);}
.fp-login .login-links a{color:var(--brand);font-weight:500;text-decoration:none;padding:8px 4px;display:inline-block;}
.fp-login .login-links a:hover{color:var(--brand-h);}
.fp-login .login-links-sep{color:var(--text-muted);}
.fp-login .login-msg{margin:0;font-size:11px;color:var(--text-weak);text-align:center;}
.fp-login .biz-no-match{margin:2px 0 0;font-size:11px;line-height:1.4;color:var(--text-weak);letter-spacing:-0.01em;}
.fp-login .biz-no-match.is-ok{color:var(--green-text);}
.fp-login .biz-no-match.is-miss{color:var(--red-text);}
@media (max-width:768px){
.fp-login .login-page{align-items:stretch;padding:max(24px,env(safe-area-inset-top)) 0 max(24px,env(safe-area-inset-bottom));gap:20px;}
.fp-login .login-brand,.fp-login .login-brand span{font-size:22px;text-align:center;}
.fp-login .login-brand{padding:0 24px;}
/* ★모바일 로그인은 **한 면이 흰 바탕**이다(사장님 2026-08-23 「모바일 로그인 화면에 배경하고 로그인 박스랑 좀 다르고」).
   카드에서 테두리·그림자·모서리를 걷어 전체폭으로 폈는데 **배경만 흰색(--bg-card)으로 남아**,
   회색 페이지(--bg-page) 위에 경계 없는 흰 띠가 떠 보였다(실측 412px: 페이지 234,237,242 / 카드 255,255,255).
   카드 배경을 투명으로 두고 **바탕을 흰색으로** 올린다 — 부팅 중 html.fp-pending-m 도 흰색이라 깜빡임도 사라진다. */
.fp-login,.fp-login .login-page{background:var(--bg-card);}
.fp-login .login-card{box-shadow:none;border:0;border-radius:0;padding:0 24px;gap:20px;max-width:none;background:transparent;}
.fp-login .login-field>span{font-size:13px;}
.fp-login .login-links{font-size:13px;gap:12px;}
}
`;
