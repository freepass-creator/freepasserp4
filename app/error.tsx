'use client';
import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Btn, C, FS, FW } from '@/components/ui';
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
      <div style={{ color: C.warn, display: 'flex', lineHeight: 1 }}><AlertTriangle size={40} aria-hidden /></div>
      <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>문제가 발생했습니다</div>
      <div style={{ fontSize: FS.sub, color: C.mute, maxWidth: 360, lineHeight: 1.6 }}>
        일시적인 오류일 수 있습니다. 다시 시도하거나 잠시 후 접속해 주세요.
      </div>
      {error?.digest ? (
        <div style={{ fontSize: FS.cap, color: C.faint, fontFamily: 'monospace' }}>오류코드 {error.digest}</div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <Btn onClick={() => reset()}>다시 시도</Btn>
        <Btn href="/" variant="ghost">홈으로</Btn>
      </div>
    </div>
  );
}
