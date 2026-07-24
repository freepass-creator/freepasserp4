'use client';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-context';
import { logClientError, isChunkLoadError, setErrorUser } from '@/lib/observability/log-error';

/**
 * 전역 클라이언트 에러 관측 — 레이아웃에 1회 마운트.
 *   · window error / unhandledrejection → logClientError
 *   · 청크 로드 실패(배포 후 stale HTML) → 1회 강제 새로고침으로 자동 복구
 *   · 세션 uid를 로거에 동기화(상관용)
 * UI 없음(null 렌더).
 */
export default function ClientErrorReporter() {
  const session = useSession();

  useEffect(() => {
    setErrorUser(session?.uid);
  }, [session?.uid]);

  useEffect(() => {
    const RELOAD_KEY = 'fp4_chunk_reload';

    const handleChunk = (err: unknown): boolean => {
      if (!isChunkLoadError(err)) return false;
      try {
        // 새로고침 루프 방지 — 세션당 1회만.
        if (sessionStorage.getItem(RELOAD_KEY)) return false;
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
      } catch { /* noop */ }
      return true;
    };

    const onError = (e: ErrorEvent) => {
      const err = e.error ?? e.message;
      if (handleChunk(err)) return;
      logClientError(err, 'window.error');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (handleChunk(e.reason)) return;
      logClientError(e.reason, 'unhandledrejection');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
