'use client';
/**
 * 상단바 탭 = 현재 페이지 새로 온 느낌.
 *   · 스크롤 맨 위
 *   · 상세 선택 해제(목록으로) — 기존 fp:work-list
 *   · fp:page-refresh — 시트 닫기·홈 리셋 등
 */
export function routeKey(path: string): string {
  if (!path || path === '/') return '/';
  if (path.startsWith('/m/')) return '/';
  const roots = [
    '/chat', '/contract', '/inventory', '/settings', '/policy',
    '/settlement', '/members', '/audit', '/data-check', '/dev',
  ];
  for (const r of roots) {
    if (path === r || path.startsWith(`${r}/`)) return r;
  }
  return path;
}

export function scrollPageToTop() {
  if (typeof document === 'undefined') return;
  const sels = [
    '.fp-page-scroll',
    '.fp-finder-body',
    '.fp-work-stack',
    '.fp-main-pad',
    '.fp-pane-scroll',
  ];
  for (const sel of sels) {
    document.querySelectorAll(sel).forEach((el) => {
      try { (el as HTMLElement).scrollTo({ top: 0, behavior: 'smooth' }); }
      catch { (el as HTMLElement).scrollTop = 0; }
    });
  }
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); }
  catch { window.scrollTo(0, 0); }
}

function flashPageFresh() {
  if (typeof document === 'undefined') return;
  const sels = ['.fp-page-scroll', '.fp-finder-body', '.fp-work-stack'];
  for (const sel of sels) {
    document.querySelectorAll(sel).forEach((node) => {
      const el = node as HTMLElement;
      el.classList.remove('fp-page-fresh');
      // reflow so animation restarts
      void el.offsetWidth;
      el.classList.add('fp-page-fresh');
    });
  }
}

/** 상단바·동일탭 재탭 공용 */
export function refreshCurrentPage(pathname?: string) {
  if (typeof window === 'undefined') return;
  const key = routeKey(pathname || window.location.pathname);
  scrollPageToTop();
  flashPageFresh();
  window.dispatchEvent(new CustomEvent('fp:page-refresh', { detail: key }));
  window.dispatchEvent(new CustomEvent('fp:work-list', { detail: key }));
}
