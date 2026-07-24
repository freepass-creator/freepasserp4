'use client';
import { useEffect } from 'react';
import { logClientError } from '@/lib/observability/log-error';

/**
 * 루트 레이아웃까지 터졌을 때의 최종 방어선 — <html><body> 직접 렌더(globals.css 미적용이라 색상 리터럴).
 * 여기서도 백스크린 대신 최소 UI + 새로고침. 에러는 best-effort 수집.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logClientError(error, 'global.error');
  }, [error]);

  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'Pretendard, system-ui, sans-serif', background: '#F7F5F2', color: '#1A1A1A' }}>
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
        }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 650 }}>일시적인 오류가 발생했습니다</div>
          <div style={{ fontSize: 13, color: '#6B6B6B', maxWidth: 360, lineHeight: 1.6 }}>
            페이지를 새로고침하거나 잠시 후 다시 접속해 주세요.
          </div>
          {error?.digest ? (
            <div style={{ fontSize: 11, color: '#9A9A9A', fontFamily: 'monospace' }}>오류코드 {error.digest}</div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              onClick={() => reset()}
              style={{ padding: '10px 18px', borderRadius: 4, border: 'none', background: '#1B2A4A', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >다시 시도</button>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={{ padding: '10px 18px', borderRadius: 4, border: '1px solid #E2DED8', background: '#fff', color: '#1A1A1A', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >홈으로</button>
          </div>
        </div>
      </body>
    </html>
  );
}
