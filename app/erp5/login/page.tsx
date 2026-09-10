'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { login, resetPassword } from '@/lib/firebase/auth';
import { firebaseReadySafe, getSession } from '@/lib/login-helpers';
import { BRAND_FONT, BRAND_MAIN, BRAND_SUB, BRAND_TAGLINE, BRAND_WEIGHT } from '@/lib/brand';

/**
 * **신관 현관 — 새 판의 로그인.**
 *
 * 사장님 2026-09-10 「기존거는 아예 **박물관**으로 가고 이제 **완전 새로운 페이지**로 갈 거야.
 * 밑에 **로그인페이지부터 ui ux 싹 다 바꿀** 거임…. **기존거랑 물리는 거는 없어.**
 * 이제 이게 **메인으로 갈아타는** 거임」 · 「**새 주소에 지었다가 갈아탄다**」.
 *
 * ## 왜 여기(신관)인가
 *
 * 건물도면이 이미 `erp5` 를 **「신관 — 공사 중인 새 동, 완공 전까지 규격 유예」**로 두고 있다.
 * 새 판의 몸통(매물 선택·비교·제안·전자계약)이 거기 있으니 **현관도 같은 동**에 선다.
 *
 * ## 무엇을 «새로» 하고 무엇을 «그대로» 두나
 *
 * | | 어떻게 |
 * |---|---|
 * | 얼굴(UI·UX) | **새로 짓는다.** 업무동 컨트롤 규격(md 32/40·lg 44/48)에 안 묶인다 — 신관은 규격 유예다 |
 * | 인증(로그인·세션·비밀번호 재설정) | **그대로 쓴다.** `lib/firebase/auth` — 그건 «얼굴»이 아니라 «기반»이다 |
 *
 * ⚠ 인증을 새로 만들면 계정이 두 갈래가 되고, 한쪽만 고쳐지는 순간 「로그인이 되는데 안 되는」
 *   상태가 생긴다. 사장님 「기존거랑 물리는 거 없어」는 **화면·규격** 이야기다.
 *
 * ★기존 `/login` 은 **살려 둔다**(박물관). 다 되면 그때 갈아탄다 —
 *   지으면서 갈아엎으면 만드는 동안 아무도 업무 화면에 못 들어온다.
 * ★로그인 뒤에는 **신관**(`/erp5`)으로 보낸다. 옛 목적지(`loginDestination`)를 쓰지 않는다 —
 *   새 현관으로 들어온 사람은 새 판을 보러 온 것이다.
 */

/** 서비스 브랜드(BI) 는 로그인 자리의 «맞는 이름»이다 — 법인 CI 는 대외 문서 몫(`corporate-ci` 머리말). */
const MSG: Record<string, string> = {
  'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다',
  'auth/wrong-password': '비밀번호가 올바르지 않습니다',
  'auth/user-not-found': '등록되지 않은 이메일입니다',
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다',
  'auth/user-disabled': '비활성화된 계정입니다',
  'auth/too-many-requests': '시도가 많습니다. 잠시 후 다시 시도해 주세요',
  'auth/network-request-failed': '네트워크 오류 — 연결을 확인해 주세요',
  'auth/missing-email': '이메일을 입력해 주세요',
};
const errText = (e: unknown) => {
  const code = String((e as { code?: string })?.code || '');
  return MSG[code] || '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요';
};

/** 세션이 실제로 붙을 때까지 기다린다 — 붙기 전에 옮기면 새 화면이 다시 현관으로 튕긴다. */
async function waitForSession(ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (getSession()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
}

export default function Erp5LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  /* 이미 들어와 있으면 현관에 세워 두지 않는다 — 바로 신관으로 보낸다. */
  useEffect(() => {
    if (firebaseReadySafe() && getSession()) router.replace('/erp5');
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(''); setNote(''); setBusy(true);
    try {
      await login(email.trim(), pw);
      await waitForSession();
      router.replace('/erp5');
    } catch (e2) {
      setErr(errText(e2));
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!email.trim()) { setErr('이메일을 먼저 입력해 주세요'); return; }
    setErr(''); setNote('');
    try {
      await resetPassword(email.trim());
      setNote('재설정 메일을 보냈습니다. 메일함을 확인해 주세요');
    } catch (e2) { setErr(errText(e2)); }
  };

  /*
   * ★★**두 칸이다 — 왼쪽은 «어디에 왔나», 오른쪽은 «들어가기».**
   *   옛 현관은 한가운데 카드 하나였다. 그건 「무엇이든 될 수 있는」 화면이라 이 판이 무엇인지
   *   말해 주지 않는다. 왼쪽이 그 말을 맡고, 오른쪽은 할 일 하나만 든다.
   * ★폰은 한 단으로 쌓는다 — 왼쪽 판을 위에 얇게 얹고 폼이 화면을 갖는다.
   */
  return (
    <main style={{
      minHeight: '100dvh', display: 'grid', background: '#0B1220', color: '#E8EDF7',
      gridTemplateColumns: 'minmax(0, 1fr)',
    }}>
      <div style={{
        display: 'grid', gap: 0, width: '100%', minHeight: '100dvh',
        gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)',
      }} className="erp5-login-grid">
        {/* ── 왼쪽 — 어디에 왔나 ─────────────────────────────────────── */}
        <section style={{
          padding: 'clamp(28px, 6vw, 72px)', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', gap: 32,
          /* 조용한 결 — 면 하나에 아주 옅은 빛. 그림을 쓰지 않는다(무게가 늘고 배율마다 갈린다). */
          backgroundImage: 'radial-gradient(120% 80% at 0% 0%, rgba(90,140,255,.20), transparent 60%)',
        }}>
          <div style={{ fontFamily: BRAND_FONT, fontSize: 'clamp(26px, 3vw, 34px)', letterSpacing: '-0.03em', lineHeight: 1 }}>
            <span style={{ fontWeight: BRAND_WEIGHT.main }}>{BRAND_MAIN}</span>
            <span style={{ fontWeight: BRAND_WEIGHT.sub, opacity: 0.72 }}>{BRAND_SUB}</span>
          </div>
          <div>
            <h1 style={{
              margin: 0, fontSize: 'clamp(28px, 4.2vw, 46px)', lineHeight: 1.15,
              letterSpacing: '-0.04em', fontWeight: 800,
            }}>
              찾고 · 담고 · 보내는 일을<br />한 화면에서
            </h1>
            <p style={{ margin: '18px 0 0', fontSize: 'clamp(14px, 1.4vw, 16px)', lineHeight: 1.7, color: 'rgba(232,237,247,.66)' }}>
              {BRAND_TAGLINE}
            </p>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(232,237,247,.42)' }}>
            담당자 계정으로 들어옵니다. 계정이 없으면 관리자에게 요청해 주세요.
          </p>
        </section>

        {/* ── 오른쪽 — 들어가기 ─────────────────────────────────────── */}
        <section style={{
          background: '#F7F9FC', color: '#111827',
          padding: 'clamp(28px, 5vw, 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, display: 'grid', gap: 18 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em' }}>로그인</div>
              <div style={{ marginTop: 6, fontSize: 14, color: '#6B7280' }}>이메일과 비밀번호를 입력해 주세요.</div>
            </div>

            <label style={{ display: 'grid', gap: 7 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>이메일</span>
              <input
                type="email" value={email} autoComplete="username" inputMode="email"
                onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
                style={FIELD}
              />
            </label>

            <label style={{ display: 'grid', gap: 7 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>비밀번호</span>
              <input
                type="password" value={pw} autoComplete="current-password"
                onChange={(e) => setPw(e.target.value)} placeholder="비밀번호 입력"
                style={FIELD}
              />
            </label>

            {/* ★알림은 «폼 안»에 둔다 — 위로 띄우면 눈이 폼을 떠나고, 다시 어디를 고칠지 찾는다. */}
            {err ? <div style={{ ...NOTE, background: '#FEF2F2', color: '#B42318' }}>{err}</div> : null}
            {note ? <div style={{ ...NOTE, background: '#ECFDF3', color: '#067647' }}>{note}</div> : null}

            <button type="submit" disabled={busy} style={{
              height: 52, borderRadius: 12, border: 'none', cursor: busy ? 'default' : 'pointer',
              background: busy ? '#94A3B8' : '#0B1220', color: '#fff',
              fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {busy ? <Loader2 size={18} className="fp-spin" aria-hidden /> : null}
              {busy ? '들어가는 중' : '로그인'}
              {busy ? null : <ArrowRight size={18} aria-hidden />}
            </button>

            <button type="button" onClick={forgot} style={{
              justifySelf: 'center', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 13, color: '#6B7280', fontFamily: 'inherit', padding: 6,
            }}>
              비밀번호를 잊으셨나요?
            </button>
          </form>
        </section>
      </div>

      {/*
        ★폰에서는 한 단으로 쌓는다 — 왼쪽 판이 위에 얇게 얹히고 폼이 화면을 갖는다.
        ⚠ 신관은 규격 유예라 여기서 제 CSS 를 쓴다(업무동 토큰에 안 묶인다).
      */}
      <style>{`
        @media (max-width: 860px) {
          .erp5-login-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .erp5-login-grid > section:first-child { min-height: 42dvh; }
        }
        .fp-spin { animation: erp5spin 1s linear infinite; }
        @keyframes erp5spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}

const FIELD: React.CSSProperties = {
  height: 52, borderRadius: 12, border: '1px solid #D6DBE4', background: '#fff',
  padding: '0 14px', fontSize: 16, color: '#111827', outline: 'none', fontFamily: 'inherit',
};
const NOTE: React.CSSProperties = {
  borderRadius: 10, padding: '11px 13px', fontSize: 13.5, lineHeight: 1.5, fontWeight: 600,
};
