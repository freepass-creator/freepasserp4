import type { Metadata } from 'next';
import { BRAND, BRAND_MAIN, BRAND_SUB, BRAND_TAGLINE } from '@/lib/brand';
import { C, FS, FW, R, SH } from '@/components/ui/tokens';

/**
 * **freepasserp.com 첫 화면 — 점검 안내 + 상품시트(구글시트) 입장. 로그인 불필요.**
 *
 * ★왜(사장님 2026-08-15 — 「상품시트만 올려놔주고, freepasserp.com 접속하면 구글시트로 보기로
 *   로그인 없이 갈 수 있게끔」 · 「구글시트로만 보여준다고 하지 말고 **ERP 를 점검 중**이라고 하자」
 *   · 「freepasserp.com 이 브랜드니까 **CI 잘 참고해서** 활용하고」)
 *
 * ★CI — 워드마크는 freepass(600) + erp.com(300) 이분이다(lib/brand.ts · ci_center 명함 기준).
 *   색·글꼴·모서리·그림자는 전부 디자인 토큰(C·FS·FW·R·SH)에서 온다. 여기서 값을 박지 마라.
 * ★기존 ERP 첫 화면(매물 파인더)은 /finder 로 옮겨 뒀다 — 내부 사용은 그대로다.
 * ★시트는 «링크 열람 전용 + 사본 금지»로 열어 뒀다(숨긴 운영 탭은 열람자에게 안 보인다).
 * ⚠ 서버 컴포넌트다 — 인증·JS 없이 뜬다. 클라이언트 훅을 들이지 마라.
 * ⚠ 한국어 문장은 keep-all — 단어 사이에서만 줄이 바뀐다. <br/>는 뜻이 갈리는 자리에만.
 */

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs/edit';

export const metadata: Metadata = {
  title: '시스템 점검 안내',
  description: `${BRAND} 점검 안내 — 점검 중에는 상품시트(구글시트)로 상품을 안내드립니다.`,
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
      {/* ── 브랜드 — 로고 + 이분 워드마크 + 태그라인 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 정적 CI 로고 한 장, 최적화 불필요 */}
        <img src="/icon.svg" alt="" width={52} height={52} style={{ display: 'block' }} />
        <div style={{ fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em' }}>
          <span style={{ fontWeight: 600, color: C.ink }}>{BRAND_MAIN}</span>
          <span style={{ fontWeight: 300, color: C.sub }}>{BRAND_SUB}</span>
        </div>
        <div style={{ fontSize: FS.body, color: C.faint }}>{BRAND_TAGLINE}</div>
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
        <span style={{ width: 8, height: 8, borderRadius: 999, background: C.brand, display: 'inline-block' }} />
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

      <div style={{ marginTop: 6, fontSize: FS.sub }}>
        <a href="/login" style={{ color: C.faint, textDecoration: 'underline' }}>
          내부 직원 로그인
        </a>
      </div>
    </main>
  );
}
