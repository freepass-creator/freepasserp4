'use client';
import { useRef, useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { Page, PaneHead, BottomNav, Btn, C } from '@/components/ui';

// 업무 페이지 공용 껍데기 = [목록 | 작업패널들]. IA 통일: 웹=나란히 / 모바일=목록→작업 좌우 스와이프.
// 각 pane.node는 자체 헤더(PaneHead 또는 ChatThread 헤더)를 포함한다. pane.title = 모바일 탭 라벨.
export type WorkPane = { key: string; title: string; node: ReactNode; width?: number };
export function WorkPage({ title, listCount, listWidth = 300, list, panes, selected, onBack, search, actions }: {
  title: string; listCount?: ReactNode; listWidth?: number;
  list: ReactNode; panes: WorkPane[]; selected: boolean; onBack: () => void;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  actions?: ReactNode;
}) {
  const mobile = useIsMobile();
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const goPage = (i: number) => { const el = pagerRef.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' }); };
  const onScroll = () => { const el = pagerRef.current; if (el) setPage(Math.round(el.scrollLeft / el.clientWidth)); };
  useEffect(() => { if (selected) { setPage(0); const el = pagerRef.current; if (el) el.scrollLeft = 0; } }, [selected]);

  const searchBar = search ? (
    <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
      <input value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder || '검색'} style={{ width: '100%', height: 30, padding: '0 10px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 12.5, boxSizing: 'border-box' }} />
    </div>
  ) : null;

  if (mobile) {
    if (!selected) return <Page title={title} meta={listCount} bottomActions={actions}>{searchBar}{list}</Page>;
    const paneStyle: CSSProperties = { flex: '0 0 100%', scrollSnapAlign: 'start', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 };
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#fff', display: 'flex', flexDirection: 'column' }}>
        <div ref={pagerRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, display: 'flex', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
          {panes.map((p) => <div key={p.key} style={paneStyle}>{p.node}</div>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px calc(7px + env(safe-area-inset-bottom))', borderTop: `1px solid ${C.line}`, background: '#fff' }}>
          <Btn variant="ghost" size="sm" onClick={onBack}>← 이전</Btn>
          <div style={{ flex: 1, display: 'flex', gap: 5 }}>
            {panes.map((p, i) => <button key={p.key} onClick={() => goPage(i)} style={{ flex: 1, height: 34, fontSize: 12, fontWeight: page === i ? 800 : 600, border: `1px solid ${page === i ? C.brand : C.line}`, borderRadius: 4, background: page === i ? C.brand : '#fff', color: page === i ? '#fff' : C.mute, cursor: 'pointer' }}>{p.title}</button>)}
          </div>
        </div>
      </div>
    );
  }

  // 웹 = [목록 | 패널들] 나란히 + 하단바
  const col = (flex: string, extra?: CSSProperties): CSSProperties => ({ flex, display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: `1px solid ${C.line}`, ...extra });
  return (
    <>
      <div style={{ display: 'flex', height: 'calc(100dvh - var(--topbar-h) - 49px)', borderTop: `1px solid ${C.line}`, overflowX: 'auto' }}>
        <div style={col(`0 0 ${listWidth}px`)}>
          <PaneHead title={title} count={listCount} />
          {searchBar}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{list}</div>
        </div>
        {panes.map((p, i) => (
          <div key={p.key} style={col(p.width ? `0 0 ${p.width}px` : '1 1 0', { minWidth: 320, ...(i === panes.length - 1 ? { borderRight: 'none' } : {}) })}>
            {p.node}
          </div>
        ))}
      </div>
      <BottomNav actions={actions} />
    </>
  );
}
