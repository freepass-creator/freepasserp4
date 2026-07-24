/**
 * 클라이언트 에러 관측 최소치 — Sentry 없이 Firebase 스택에 맞춘 best-effort 수집.
 *   · 항상 console.error (개발자 도구)
 *   · 로그인 상태면 RTDB `v4/_client_errors`에 best-effort push(실패해도 앱 무영향)
 *   · PII/토큰 미포함 — 메시지·스택·경로(쿼리 제거)·UA·빌드만. 세션당 상한·중복억제로 플러딩 방지.
 * 관리자는 Firebase 콘솔이나 별도 뷰에서 이 노드를 watch → "터진 걸 아는" 최소 신호.
 */
import { getRtdb } from '@/lib/firebase/client';
import { ref, push, serverTimestamp } from 'firebase/database';
import { BUILD, VERSION } from '@/lib/brand';

const CAP = 20; // 세션당 전송 상한(플러딩·과금 방지)
let sent = 0;
const seen = new Set<string>();
let currentUid = '';

/** 리포터가 세션 바뀔 때 호출 — 에러에 uid 상관용(선택). */
export function setErrorUser(uid: string | undefined): void {
  currentUid = uid || '';
}

/** URL에서 쿼리·해시 제거(토큰 유출 방지). */
function safePath(u: string): string {
  try {
    const url = new URL(u);
    return url.origin + url.pathname;
  } catch {
    return String(u || '').slice(0, 200);
  }
}

export function logClientError(err: unknown, context?: string): void {
  try {
    const e = err as { message?: unknown; stack?: unknown } | null;
    const msg = String(e?.message ?? err ?? 'unknown').slice(0, 500);
    const key = `${context || ''}|${msg}`;
    if (seen.has(key)) return; // 동일 에러 반복 억제
    seen.add(key);

    // 콘솔은 항상(로컬·프로덕션 devtools)
    console.error('[fp4]', context || '', err);

    if (sent >= CAP || typeof window === 'undefined') return;
    const db = getRtdb();
    if (!db) return;
    sent++;
    push(ref(db, 'v4/_client_errors'), {
      msg,
      stack: String(e?.stack ?? '').slice(0, 1500),
      ctx: context || '',
      url: safePath(window.location.href),
      ua: navigator.userAgent.slice(0, 200),
      build: BUILD || '',
      ver: VERSION,
      uid: currentUid,
      ts: serverTimestamp(),
    }).catch(() => { /* 규칙 미허용·오프라인 등 실패 무시(관측은 best-effort) */ });
  } catch {
    /* 로거 자체 실패는 삼킴 — 앱에 절대 영향 주지 않음 */
  }
}

/** 청크 로드 실패(배포 후 구버전 HTML이 삭제된 chunk 참조) 감지 — 1회 강제 새로고침으로 복구. */
export function isChunkLoadError(err: unknown): boolean {
  const s = String((err as { message?: unknown })?.message ?? err ?? '');
  return /Loading chunk|ChunkLoadError|dynamically imported module|Importing a module script failed|Loading CSS chunk/i.test(s);
}
