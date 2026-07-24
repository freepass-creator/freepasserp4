'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { C, FS, FW, R } from '@/components/ui/tokens';
import { logClientError } from '@/lib/observability/log-error';

/** 페이지 렌더 에러 바운더리 — 백스크린 대신 친절 UI + 다시시도. 에러는 관측 로거로 수집. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logClientError(error, 'route.error');
  }, [error]);

  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>문제가 발생했습니다</div>
      <div style={{ fontSize: FS.sub, color: C.mute, maxWidth: 360, lineHeight: 1.6 }}>
        일시적인 오류일 수 있습니다. 다시 시도하거나 잠시 후 접속해 주세요.
      </div>
      {error?.digest ? (
        <div style={{ fontSize: FS.cap, color: C.faint, fontFamily: 'monospace' }}>오류코드 {error.digest}</div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          onClick={() => reset()}
          style={{
            padding: '10px 18px', borderRadius: R, border: 'none',
            background: C.brand, color: '#fff', fontSize: FS.body, fontWeight: FW.strong, cursor: 'pointer',
          }}
        >다시 시도</button>
        <Link
          href="/"
          style={{
            padding: '10px 18px', borderRadius: R, border: `1px solid ${C.line}`,
            background: C.taupeBg, color: C.ink, fontSize: FS.body, fontWeight: FW.meta, textDecoration: 'none',
          }}
        >홈으로</Link>
      </div>
    </div>
  );
}
