'use client';

import { useEffect } from 'react';

/**
 * **배포 자동 반영** — 열려 있는 화면(폰 탭·카톡 인앱·홈화면 앱)이 옛 번들로 계속 돌지 않게,
 * 서버의 배포 도장(/api/version)과 자기 번들 도장을 견줘 다르면 스스로 새로고침한다.
 * ★사장님 2026-08-22 「캐시를 무력화하면서 개선해야지, 아직 그대론데」 — HTML 은 no-store 라 문제가 아니고,
 *   «살아 있는 탭»이 배포를 모르는 게 문제였다. 확인 시점: 화면에 돌아올 때(visible/focus/online) + 90초 간격.
 * ⚠ 입력 중(포커스가 입력칸)일 때는 새로고침하지 않고 다음 기회로 미룬다 — 쓰던 글이 날아가면 안 된다.
 * ⚠ 같은 도장으로는 한 번만 새로고침(sessionStorage 가드) — 무한 리로드 방지.
 */
const MINE = process.env.NEXT_PUBLIC_BUILD_STAMP || '';

export function VersionWatcher() {
  useEffect(() => {
    if (!MINE) return;
    let stop = false;
    const typing = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
    };
    const check = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const { stamp } = await r.json() as { stamp?: string };
        if (!stamp || stamp === MINE) return;
        const key = `fp:reloaded:${stamp}`;
        if (sessionStorage.getItem(key)) return;
        if (typing()) return;   // 쓰는 중 — 다음 확인 때
        sessionStorage.setItem(key, '1');
        location.reload();
      } catch { /* 오프라인 등 — 다음 기회 */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    const id = window.setInterval(() => { void check(); }, 90_000);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => { stop = true; window.clearInterval(id); window.removeEventListener('focus', onVisible); window.removeEventListener('online', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return null;
}
