import type { Metadata } from 'next';

/**
 * **freepasserp.com 첫 화면 — 로그인 없는 안내 + 상품시트(구글시트) 입장.**
 *
 * ★왜(사장님 2026-08-15 — 「상품시트만 올려놔주고, freepasserp.com 접속하면 구글시트로 보기로
 *   로그인 없이 갈 수 있게끔. 정말 보기 좋고 필요한 기능만 넣어서 오픈하겠다고,
 *   구글시트를 사용해달라고 하자」 · 「딱 그거 배포해놓고 완벽하게 만들어서 내놓을거야」)
 *
 *   ERP 는 개선 작업에 들어간다. 그동안 영업자가 쓰는 것은 상품시트 하나다 —
 *   그 길을 로그인 없이, 헤매지 않고 열어 준다.
 *
 * ★기존 ERP 첫 화면(매물 파인더)은 /finder 로 옮겨 뒀다 — 내부 사용은 그대로 된다.
 * ★시트는 «링크 열람 전용 + 사본 금지»로 열어 뒀다(숨긴 운영 탭은 열람자에게 안 보인다).
 * ⚠ 서버 컴포넌트다 — 인증·JS 없이 뜬다. 여기에 클라이언트 훅을 들이지 마라.
 */

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs/edit';

export const metadata: Metadata = {
  title: '프리패스 상품시트',
  description: '프리패스 렌터카 상품시트 — 구글시트로 바로 보기',
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
        gap: 28,
        padding: '48px 20px',
        background: '#0f1115',
        color: '#e8eaed',
        fontFamily: "'Noto Sans KR', system-ui, sans-serif",
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <div style={{ fontSize: 13, letterSpacing: 6, color: '#8a919c', fontWeight: 600 }}>FREEPASS</div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.35 }}>
          프리패스 상품시트
        </h1>
        <p style={{ fontSize: 15, color: '#aab2bd', margin: 0, lineHeight: 1.7, maxWidth: 420 }}>
          지금은 <b style={{ color: '#e8eaed' }}>구글시트</b>로 상품을 안내해 드리고 있습니다.
          <br />
          아래 버튼을 누르면 로그인 없이 바로 열립니다.
        </p>
      </div>

      <a
        href={SHEET_URL}
        style={{
          display: 'inline-block',
          padding: '16px 34px',
          borderRadius: 12,
          background: '#1a73e8',
          color: '#fff',
          fontSize: 17,
          fontWeight: 700,
          textDecoration: 'none',
          boxShadow: '0 4px 18px rgba(26,115,232,.35)',
        }}
      >
        상품시트 열기 (구글시트)
      </a>

      <p style={{ fontSize: 13.5, color: '#8a919c', lineHeight: 1.8, maxWidth: 440, margin: 0 }}>
        프리패스 ERP는 <b style={{ color: '#c6ccd4' }}>정말 보기 좋고, 꼭 필요한 기능만 담아</b> 새로
        준비하고 있습니다.
        <br />
        준비되는 동안 상품시트를 이용해 주세요. 시트는 매일 갱신됩니다.
      </p>

      <div style={{ marginTop: 8, fontSize: 12.5, color: '#5f6773' }}>
        <a href="/login" style={{ color: '#5f6773', textDecoration: 'underline' }}>
          내부 직원 로그인
        </a>
      </div>
    </main>
  );
}
