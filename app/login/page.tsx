'use client';
/**
 * 로그인 — freepasserp3 v3 화면 그대로(똑같이). 실 Firebase Auth(회원 공유).
 *   login / 가입(사업자번호→회사·역할) / 재설정 / 로그인 없이 둘러보기.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Store } from 'lucide-react';
import { type User } from 'firebase/auth';
import { login, signup, logout, resetPassword, writeUserProfile } from '@/lib/firebase/auth';
import { setGuest, getSession, firebaseReadySafe } from '@/lib/login-helpers';
import { fmtPhone, C } from '@/components/ui';
import { BRAND_MAIN, BRAND_SUB } from '@/lib/brand';
/** 로그인은 v3 CSS 섬(44/48·브랜드 hex). Input/Btn 원자 높이(32/40)와 충돌 → raw 유지. */

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

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'muted' | 'ok' | 'err' }>({ text: '', tone: 'muted' });
  // 필드
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [su, setSu] = useState({ email: '', pw: '', pw2: '', name: '', phone: '', company: '', bizNo: '' });
  const [bizMatch, setBizMatch] = useState<{ text: string; cls: '' | 'ok' | 'miss' }>({ text: '', cls: '' });
  const [rpEmail, setRpEmail] = useState('');
  const bizTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (text: string, tone: 'muted' | 'ok' | 'err' = 'muted') => setMsg({ text, tone });
  const switchMode = (m: Mode) => { setMode(m); say(''); };

  // 이미 로그인/설정 없음 → 홈으로
  useEffect(() => { if (!firebaseReadySafe()) { /* 로컬 전용: 둘러보기로 진입 */ } else if (getSession()) router.replace('/'); }, [router]);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    setBusy(true); say('');
    try { await login(email.trim(), pw); await waitForSession(); router.replace('/'); }
    catch (err) { console.error('[login]', err); say(koreanAuthMsg(err, '로그인 실패'), 'err'); setBusy(false); }
  };

  const doGuest = () => { setGuest(true); router.replace('/'); };

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
        if (!r) setBizMatch({ text: '일치하는 회사 없음 — 임시소속(SP999)으로 등록됩니다', cls: 'miss' });
        else setBizMatch({ text: `✓ 매칭: ${r.name} (${r.code})${r.type ? ` — ${r.type}` : ''}`, cls: 'ok' });
      } catch { setBizMatch({ text: '', cls: '' }); }
    }, 200);
  };

  const doSignup = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    if (!su.email.trim() || !su.pw || su.pw.length < 6) { say('이메일·비밀번호(6자 이상) 필수', 'err'); return; }
    if (su.pw !== su.pw2) { say('비밀번호가 일치하지 않습니다', 'err'); return; }
    setBusy(true); say('');
    let authUser: User;
    try { authUser = await signup(su.email.trim(), su.pw); }
    catch (authErr) {
      const m = (authErr as { code?: string })?.code === 'auth/email-already-in-use'
        ? '이미 가입된 이메일입니다. 로그인해주세요.'
        : koreanAuthMsg(authErr, '가입 실패');
      console.error('[signup]', authErr); say(m, 'err');
      if (typeof window !== 'undefined') window.alert(`가입 실패\n${m}`);
      setBusy(false); return;
    }
    try {
      // 프로필 저장 — 실패 시 Auth 계정 삭제(같은 이메일 재가입 가능)
      await writeUserProfile(authUser, { name: su.name.trim(), phone: su.phone.trim(), company_name: su.company.trim(), business_no: su.bizNo.trim() });
    } catch (err) {
      await authUser.delete().catch(() => {});
      const m = koreanAuthMsg(err, '가입 실패');
      console.error('[signup profile]', err); say(m, 'err');
      if (typeof window !== 'undefined') window.alert(`가입 실패\n${m}`);
      setBusy(false); return;
    }
    // Path B 승인제 — 가입 직후 status=pending → PendingApproval. 세션 갱신 위해 홈으로.
    say('가입 신청 완료. 관리자 승인 후 이용할 수 있습니다.', 'ok');
    if (typeof window !== 'undefined') window.location.assign('/');
  };

  const doReset = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    if (!rpEmail.trim()) { say('이메일을 입력해주세요', 'err'); return; }
    setBusy(true); say('전송 중…', 'muted');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 진 쪽 타이머를 안 끄면 15초 뒤 처리되지 않은 reject 가 남는다.
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('요청 시간 초과 — 잠시 후 다시 시도해주세요')), 15000); });
      await Promise.race([resetPassword(rpEmail.trim()), timeout]);
      say('재설정 메일 전송됨. 이메일(스팸함 포함)을 확인하세요. 안 오면 몇 분 뒤 다시 보내주세요.', 'ok');
    } catch (err) { console.error('[reset]', err); say(koreanAuthMsg(err, '전송 실패'), 'err'); }
    finally {
      // 성공 시에도 반드시 풀 것 — 안 그러면 폼이 잠긴 채 남아 재전송이 막힌다(메일이 스팸으로 갔을 때 탈출구가 없음).
      if (timer) clearTimeout(timer);
      setBusy(false);
    }
  };

  const msgColor = msg.tone === 'ok' ? C.ok : msg.tone === 'err' ? C.danger : C.faint;

  return (
    <div className="fp-login">
      <div className="login-page">
        <div className="login-brand" aria-label={`${BRAND_MAIN}${BRAND_SUB}`}>
          <span className="login-brand-main">{BRAND_MAIN}</span>
          <span className="login-brand-sub">{BRAND_SUB}</span>
        </div>

        {mode === 'login' && (
          <form className={`login-card${busy ? ' is-loading' : ''}`} onSubmit={doLogin} noValidate>
            <header className="login-head"><h2 className="login-title">로그인</h2><p className="login-sub">이메일과 비밀번호를 입력해주세요.</p></header>
            <div className="login-form">
              <div className="login-field"><label htmlFor="loginEmail">이메일</label><input id="loginEmail" type="email" placeholder="name@company.com" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <div className="login-field"><label htmlFor="loginPw">비밀번호</label><input id="loginPw" type="password" placeholder="비밀번호 입력" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
              <button type="submit" className="login-submit" disabled={busy}>로그인</button>
              <button type="button" className="login-guest" onClick={doGuest}><Store size={16} /> 로그인 없이 둘러보기</button>
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
          <form className={`login-card${busy ? ' is-loading' : ''}`} onSubmit={doSignup} noValidate>
            <header className="login-head"><h2 className="login-title">계정 만들기</h2><p className="login-sub">사업자번호로 소속을 확인한 뒤 관리자 승인으로 이용합니다.</p></header>
            {msg.text && <p className="login-msg" style={{ margin: 0, color: msgColor, textAlign: 'center', fontWeight: 600 }} aria-live="polite">{msg.text}</p>}
            <div className="login-form">
              <div className="login-field"><label htmlFor="suEmail">이메일 (필수)</label><input id="suEmail" type="email" placeholder="name@company.com" autoComplete="username" value={su.email} onChange={(e) => setSu({ ...su, email: e.target.value })} required /></div>
              <div className="login-field"><label htmlFor="suPw">비밀번호</label><input id="suPw" type="password" placeholder="6자 이상" autoComplete="new-password" value={su.pw} onChange={(e) => setSu({ ...su, pw: e.target.value })} required /></div>
              <div className="login-field"><label htmlFor="suPw2">비밀번호 확인</label><input id="suPw2" type="password" placeholder="비밀번호 재입력" autoComplete="new-password" value={su.pw2} onChange={(e) => setSu({ ...su, pw2: e.target.value })} required />{su.pw2 && su.pw !== su.pw2 && <p className="biz-no-match is-miss">비밀번호가 일치하지 않습니다</p>}</div>
              <div className="login-field"><label htmlFor="suName">이름</label><input id="suName" placeholder="홍길동" value={su.name} onChange={(e) => setSu({ ...su, name: e.target.value })} required /></div>
              <div className="login-field"><label htmlFor="suPhone">연락처</label><input id="suPhone" type="tel" placeholder="010-0000-0000" value={su.phone} onChange={(e) => setSu({ ...su, phone: fmtPhone(e.target.value) })} /></div>
              <div className="login-field"><label htmlFor="suCompany">소속 회사명 (참고)</label><input id="suCompany" placeholder="회사명" value={su.company} onChange={(e) => setSu({ ...su, company: e.target.value })} /></div>
              <div className="login-field"><label htmlFor="suBizNo">소속 사업자번호</label><input id="suBizNo" inputMode="numeric" placeholder="000-00-00000" autoComplete="off" value={su.bizNo} onChange={(e) => onBizNo(e.target.value)} />{bizMatch.text && <p className={`biz-no-match${bizMatch.cls ? ` is-${bizMatch.cls}` : ''}`}>{bizMatch.text}</p>}</div>
              <p className="login-msg" style={{ margin: '4px 0 8px', color: '#5f6368', fontSize: 12, lineHeight: 1.4, textAlign: 'left' }}>가입 신청 후 관리자 승인이 필요합니다. 승인되면 사업자번호에 맞는 회사·역할이 부여됩니다.</p>
              <button type="submit" className="login-submit" disabled={busy}>계정 만들기</button>
            </div>
            <div className="login-links"><a href="#" onClick={(e) => { e.preventDefault(); switchMode('login'); }}>로그인으로 돌아가기</a></div>
            {msg.text && <p className="login-msg" style={{ color: msgColor }} aria-live="polite">{msg.text}</p>}
          </form>
        )}

        {mode === 'reset' && (
          <form className={`login-card${busy ? ' is-loading' : ''}`} onSubmit={doReset} noValidate>
            <header className="login-head"><h2 className="login-title">비밀번호 재설정</h2><p className="login-sub">가입한 이메일로 재설정 링크를 보내드립니다.</p></header>
            <div className="login-form">
              <div className="login-field"><label htmlFor="rpEmail">이메일</label><input id="rpEmail" type="email" placeholder="name@company.com" autoComplete="username" value={rpEmail} onChange={(e) => setRpEmail(e.target.value)} required /></div>
              <button type="submit" className="login-submit" disabled={busy}>재설정 메일 전송</button>
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

// v3 desktop.css 로그인 규격 그대로 이식(스코프 .fp-login).
const LOGIN_CSS = `
.fp-login{position:fixed;inset:0;z-index:9999;background:#fff;overflow:auto;}
.fp-login .login-page{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:40px 16px;padding-top:max(40px,env(safe-area-inset-top));padding-bottom:max(32px,env(safe-area-inset-bottom));background:#fff;-webkit-user-select:none;user-select:none;font-size:13px;line-height:1.5;}
.fp-login .login-page,.fp-login .login-page *{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
.fp-login .login-page input{-webkit-user-select:text;user-select:text;}
/* 워드마크 = 명함 CI(Exo 2): freepass(600·#1B2A4A) + erp.com(300·#555).
   .login-page * Pretendard 덮어쓰기보다 specificity 높게 — 자식에도 Exo 2 강제 */
.fp-login .login-brand,.fp-login .login-brand span{font-size:25px;letter-spacing:-0.04em;text-transform:lowercase;font-family:'Exo 2','Pretendard',sans-serif;line-height:1;}
.fp-login .login-brand{display:flex;align-items:baseline;justify-content:center;}
.fp-login .login-brand-main{font-weight:600;color:#1B2A4A;}
.fp-login .login-brand-sub{font-weight:300;color:#555555;}
.fp-login .login-card{position:relative;width:100%;max-width:400px;background:#fff;border:none;border-radius:2px;padding:40px 32px;box-shadow:0 2px 10px rgba(0,0,0,.04),0 10px 30px rgba(0,0,0,.06);display:grid;gap:24px;overflow:hidden;margin:0;}
.fp-login .login-card.is-loading::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,.85);z-index:10;}
.fp-login .login-card.is-loading::before{content:'';position:absolute;top:50%;left:50%;width:32px;height:32px;margin:-16px 0 0 -16px;border:3px solid #d5d8dc;border-top-color:#1B2A4A;border-radius:50%;animation:fp-login-spin .6s linear infinite;z-index:11;}
@keyframes fp-login-spin{to{transform:rotate(360deg)}}
.fp-login .login-head{display:grid;gap:8px;}
.fp-login .login-title{margin:0;font-size:20px;font-weight:600;color:#1f1f1f;line-height:1.3;letter-spacing:-0.02em;}
.fp-login .login-sub{margin:0;font-size:13px;color:#5f6368;line-height:1.5;}
.fp-login .login-form{display:grid;gap:16px;}
.fp-login .login-field{display:grid;gap:6px;}
.fp-login .login-field label{font-size:12px;font-weight:500;color:#5f6368;line-height:1.4;}
.fp-login .login-field input{width:100%;height:44px;padding:0 12px;border:1px solid #dadce0;border-radius:2px;background:#fff;font-size:13px;color:#1f1f1f;outline:none;box-sizing:border-box;letter-spacing:-0.01em;transition:border-color 100ms;}
.fp-login .login-field input::placeholder{color:#80868b;}
.fp-login .login-field input:hover{border-color:#c4c7cc;}
.fp-login .login-field input:focus{border-color:#1b2a4a;}
.fp-login .login-submit{width:100%;height:44px;margin-top:4px;padding:0 12px;border:0;border-radius:2px;background:#1b2a4a;color:#fff;font-size:13px;font-weight:600;cursor:pointer;letter-spacing:-0.01em;transition:background-color 100ms,box-shadow 100ms;}
.fp-login .login-submit:hover{background:#142038;box-shadow:0 1px 3px rgba(27,42,74,.4);}
.fp-login .login-submit:active{background:#0f1a2e;}
.fp-login .login-submit:disabled{background:#c4c7cc;cursor:default;box-shadow:none;}
.fp-login .login-guest{width:100%;height:42px;margin-top:8px;padding:0 12px;border:1px solid #d4d7dc;border-radius:2px;background:transparent;color:#45506a;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background-color 100ms,border-color 100ms;}
.fp-login .login-guest:hover{background:#f3f5f8;border-color:#1b2a4a;color:#1b2a4a;}
.fp-login .login-links{display:flex;align-items:center;justify-content:center;gap:8px;font-size:11px;color:#868e96;}
.fp-login .login-links a{color:#1B2A4A;font-weight:500;text-decoration:none;}
.fp-login .login-links a:hover{color:#0F1B35;}
.fp-login .login-links-sep{color:#adb5bd;}
.fp-login .login-msg{margin:0;min-height:16px;font-size:11px;color:#868e96;text-align:center;}
.fp-login .biz-no-match{margin:2px 0 0;min-height:14px;font-size:11px;line-height:1.4;color:#80868b;letter-spacing:-0.01em;}
.fp-login .biz-no-match.is-ok{color:#137333;}
.fp-login .biz-no-match.is-miss{color:#d93025;}
@media (max-width:768px){
.fp-login .login-page{align-items:stretch;padding:max(24px,env(safe-area-inset-top)) 0 max(24px,env(safe-area-inset-bottom));gap:20px;}
.fp-login .login-brand,.fp-login .login-brand span{font-size:22px;text-align:center;}
.fp-login .login-brand{padding:0 24px;}
.fp-login .login-card{box-shadow:none;border:0;border-radius:0;padding:0 24px;gap:20px;max-width:none;}
.fp-login .login-field input{height:48px;font-size:16px;border-radius:4px;padding:0 16px;}
.fp-login .login-field label{font-size:13px;}
.fp-login .login-submit{height:48px;font-size:15px;border-radius:4px;}
.fp-login .login-links{font-size:13px;gap:12px;}
}
`;
