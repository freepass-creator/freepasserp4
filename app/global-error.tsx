'use client';
import { useEffect } from 'react';
import { logClientError } from '@/lib/observability/log-error';

/**
 * 루트 레이아웃까지 터졌을 때의 최종 방어선 — <html><body> 직접 렌더(globals.css 미적용).
 * 색은 C.* 와 같은 CSS 변수 이름을 로컬로 미러(라이트 = 토큰 hex · 다크 = prefers / .dark).
 * 여기서도 백스크린 대신 최소 UI + 새로고침. 에러는 best-effort 수집.
 */
const TOKEN_CSS = `
:root {
  --bg-page: #fafafa;
  --bg-card: #ffffff;
  --text-main: #18181b;
  --text-sub: #52525b;
  --text-weak: #a1a1aa;
  --text-inverse: #ffffff;
  --border: #e4e4e7;
  --brand: #1B2A4A;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-page: #0f1419;
    --bg-card: #171c22;
    --text-main: #f4f4f5;
    --text-sub: #a1a1aa;
    --text-weak: #71717a;
    --text-inverse: #18181b;
    --border: #2a3340;
    --brand: #9EC5F3;
  }
}
html.dark, html[data-theme="dark"] {
  --bg-page: #0f1419;
  --bg-card: #171c22;
  --text-main: #f4f4f5;
  --text-sub: #a1a1aa;
  --text-weak: #71717a;
  --text-inverse: #18181b;
  --border: #2a3340;
  --brand: #9EC5F3;
}
`;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logClientError(error, 'global.error');
  }, [error]);

  return (
    <html lang="ko">
      <head>
        <style dangerouslySetInnerHTML={{ __html: TOKEN_CSS }} />
      </head>
      <body style={{ margin: 0, fontFamily: 'Pretendard, system-ui, sans-serif', background: 'var(--bg-page)', color: 'var(--text-main)' }}>
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
        }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 650 }}>일시적인 오류가 발생했습니다</div>
          <div style={{ fontSize: 13, color: 'var(--text-sub)', maxWidth: 360, lineHeight: 1.6 }}>
            페이지를 새로고침하거나 잠시 후 다시 접속해 주세요.
          </div>
          {error?.digest ? (
            <div style={{ fontSize: 11, color: 'var(--text-weak)', fontFamily: 'monospace' }}>오류코드 {error.digest}</div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              onClick={() => reset()}
              style={{ padding: '10px 18px', borderRadius: 4, border: 'none', background: 'var(--brand)', color: 'var(--text-inverse)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >다시 시도</button>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={{ padding: '10px 18px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-main)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >홈으로</button>
          </div>
        </div>
      </body>
    </html>
  );
}
