import type { Metadata } from 'next';
import { BRAND, BRAND_MAIN, BRAND_SUB, BRAND_TAGLINE } from '@/lib/brand';
import { C, FS, FW, R, SH } from '@/components/ui/tokens';

/**
 * **freepasserp.com 첫 화면 — 점검 안내 + 상품시트(구글시트) 입장. 로그인 불필요.**
 *
 * ★왜(사장님 2026-08-15 — 「상품시트만 올려놔주고, freepasserp.com 접속하면 구글시트로 보기로
 *   로그인 없이 갈 수 있게끔」 · 「ERP 를 점검 중이라고 하자」 · 「CI 센터 확인해서 CI 제대로 넣어야지」
 *   · 「문의 010-6384-9260 담당자 연락처 적어놔」 · 「영업지원 매니저라고 해서」)
 *
 * ★CI — C:\dev\ci_center 가 정본이다(명함 teamjpk_명함제작.html · index.html).
 *   워드마크 = Exo 2 · freepass(600 · main #1B2A4A) + erp.com(300 · sub) · 소문자 · letter-spacing -0.04em
 *   3색 = main #1B2A4A · accent #9EC5F3 · base #7F93B3.  앱 토큰(--brand·--text-sub)이 이 값과 같다.
 *   로그인 화면(app/login/page.tsx .login-brand)과 **같은 방식**으로 그린다 — 두 화면이 갈리면 안 된다.
 * ★기존 ERP 첫 화면(매물 파인더)은 /finder 로 옮겨 뒀다.
 * ★시트는 «링크 열람 전용 + 사본 금지»(숨긴 운영 탭은 열람자에게 안 보인다).
 * ⚠ 서버 컴포넌트 — 인증·JS 없이 뜬다. 클라이언트 훅 금지.
 * ⚠ 한국어 문장은 keep-all. <br/>는 뜻이 갈리는 자리에만.
 */

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs/edit';
/** 문의 — 영업지원 매니저. 전화·문자 링크가 되게 숫자만 따로 둔다. */
const CONTACT_LABEL = '영업지원 매니저';
const CONTACT_PHONE = '010-6384-9260';
const CONTACT_TEL = CONTACT_PHONE.replace(/-/g, '');
/** CI 워드마크 서체 — 명함과 동일. layout.tsx 가 Exo 2 300/600 을 이미 불러온다. */
const WORDMARK_FONT = "'Exo 2', 'Pretendard', sans-serif";

export const metadata: Metadata = {
  title: '시스템 점검 안내',
  description: `${BRAND} 점검 안내 — 점검 중에는 상품시트(구글시트)로 상품을 안내드립니다. 문의 ${CONTACT_LABEL} ${CONTACT_PHONE}`,
};

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 26,
        padding: '48px 24px',
        background: C.bg,
        color: C.ink,
        textAlign: 'center',
      }}
    >
      {/* ── CI 워드마크 — 명함 규격(Exo 2 · 600/300 · 소문자 · -0.04em) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <div
          aria-label={BRAND}
          style={{
            fontFamily: WORDMARK_FONT,
            fontSize: 34,
            lineHeight: 1,
            letterSpacing: '-0.04em',
            textTransform: 'lowercase',
            display: 'flex',
            alignItems: 'baseline',
          }}
        >
          <span style={{ fontWeight: 600, color: C.brand }}>{BRAND_MAIN}</span>
          <span style={{ fontWeight: 300, color: C.sub }}>{BRAND_SUB}</span>
        </div>
        <div style={{ fontSize: FS.body, color: C.faint, letterSpacing: '0.02em' }}>{BRAND_TAGLINE}</div>
      </div>

      {/* ── 점검 배지 */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 14px',
          borderRadius: 999,
          border: `1px solid ${C.line}`,
          background: C.taupeBg,
          color: C.sub,
          fontSize: FS.body,
          fontWeight: FW.strong,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.brand, display: 'inline-block' }} />
        시스템 점검 중
      </div>

      <p style={{ fontSize: FS.title, color: C.sub, margin: 0, lineHeight: 1.8, maxWidth: 460, wordBreak: 'keep-all' }}>
        프리패스 ERP는 더 편하고 보기 좋은 모습으로 단장하기 위해 잠시 점검 중입니다.
        <br />
        점검 동안에는 <b style={{ color: C.ink }}>상품시트</b>로 상품을 안내드립니다.
      </p>

      <a
        href={SHEET_URL}
        style={{
          display: 'inline-block',
          padding: '16px 40px',
          borderRadius: R,
          background: C.brand,
          color: C.inverse,
          fontSize: FS.title,
          fontWeight: FW.head,
          textDecoration: 'none',
          boxShadow: SH.cardHover,
          whiteSpace: 'nowrap',
        }}
      >
        상품시트 바로 열기
      </a>

      <p style={{ fontSize: FS.body, color: C.faint, margin: 0, lineHeight: 1.8, wordBreak: 'keep-all' }}>
        로그인 없이 열립니다 · 시트는 매일 갱신됩니다
      </p>

      {/* ── 문의 — 영업지원 매니저. 폰에서 누르면 바로 전화. */}
      <div
        style={{
          marginTop: 4,
          padding: '14px 22px',
          borderRadius: R,
          border: `1px solid ${C.line}`,
          background: C.taupeBg,
          fontSize: FS.body,
          color: C.sub,
          lineHeight: 1.7,
          wordBreak: 'keep-all',
        }}
      >
        <div style={{ fontSize: FS.sub, color: C.faint, letterSpacing: '0.06em', marginBottom: 2 }}>문의</div>
        <div>
          <span style={{ fontWeight: FW.strong, color: C.ink }}>{CONTACT_LABEL}</span>
          <span style={{ margin: '0 8px', color: C.faint }}>·</span>
          <a href={`tel:${CONTACT_TEL}`} style={{ color: C.brand, fontWeight: FW.strong, textDecoration: 'none', letterSpacing: '0.02em' }}>
            {CONTACT_PHONE}
          </a>
        </div>
      </div>

      <div style={{ marginTop: 2, fontSize: FS.sub }}>
        <a href="/login" style={{ color: C.faint, textDecoration: 'underline' }}>
          내부 직원 로그인
        </a>
      </div>
    </main>
  );
}
