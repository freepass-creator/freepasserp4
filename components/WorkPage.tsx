'use client';
import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { useAppBar } from '@/lib/appbar';
import { useHideTabBar } from '@/lib/tabbar';
import { PaneHead, BottomNav, SearchInput, Btn, Select, C } from '@/components/ui';
import { MobilePageShell, type ListToolsConfig } from '@/components/MobilePageShell';
import { PageStatus, statusIconFor } from '@/components/PageStatus';

/**
 * 업무 페이지 = [목록 | 패널].
 * 상단바 상태 = PageStatus(상품검색과 동일: 아이콘+라벨+건수).
 * 목록 툴 = 모바일 PageToolBar 시트 / 웹 검색행+정렬·필터(동일 listTools).
 */
export type WorkPane = { key: string; title: string; node: ReactNode; width?: number };
export type WorkMobileLayout = 'stack' | 'swap';

export function WorkPage({
  title, statusLabel, statusCount, listCount, list, panes, selected, onBack, search, actions,
  mobileLayout = 'stack', mobileSwapKey, onMobileSwapKeyChange, countSuffix = '건',
  listTools, contextTitle,
  attentionLabel, attentionCount,
}: {
  title: string;
  /** 상단바 라벨(미지정 시 title). 예: 계약진행중 / 출고가능 */
  statusLabel?: string;
  /** 상단바 건수(미지정 시 listCount). 필터와 무관한 KPI */
  statusCount?: number | null;
  listCount?: ReactNode;
  list: ReactNode; panes: WorkPane[]; selected: boolean; onBack: () => void;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  actions?: ReactNode;
  mobileLayout?: WorkMobileLayout;
  mobileSwapKey?: string;
  onMobileSwapKeyChange?: (key: string) => void;
  countSuffix?: string;
  listTools?: ListToolsConfig;
  contextTitle?: ReactNode;
  /** 처리·안읽음 등 보조 건수(상품검색 「검색 M」자리) */
  attentionLabel?: string;
  attentionCount?: number | null;
}) {
  const mobile = useIsMobile();
  useHideTabBar(mobile && selected);
  const [innerSwap, setInnerSwap] = useState(panes[0]?.key || '');
  const paneKeySig = panes.map((p) => p.key).join('|');
  const swapKey = mobileSwapKey ?? innerSwap;
  const setSwapKey = (key: string) => {
    onMobileSwapKeyChange?.(key);
    if (mobileSwapKey == null) setInnerSwap(key);
  };

  const barLabel = statusLabel || title;
  const icon = statusIconFor(title);
  const barCountSrc = statusCount !== undefined ? statusCount : listCount;
  const countNum = barCountSrc == null || barCountSrc === ''
    ? null
    : (typeof barCountSrc === 'number' || typeof barCountSrc === 'string' ? barCountSrc : null);
  const att = attentionCount != null && attentionCount > 0 ? attentionCount : null;

  let barTitle: ReactNode;
  if (selected && contextTitle != null && contextTitle !== '') {
    if (typeof contextTitle === 'string') {
      barTitle = <PageStatus icon={icon} label={title} secondaryLabel={contextTitle} />;
    } else {
      barTitle = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%' }}>
          <div style={{ flex: '0 1 auto', minWidth: 0, maxWidth: '42%' }}>
            <PageStatus icon={icon} label={title} />
          </div>
          <span style={{ color: C.mute, fontWeight: 500, flex: '0 0 auto' }}>·</span>
          <span style={{
            minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 13, fontWeight: 700, color: C.ink,
          }}>{contextTitle}</span>
        </div>
      );
    }
  } else {
    barTitle = (
      <PageStatus
        icon={icon}
        label={barLabel}
        count={countNum}
        unit={countSuffix}
        secondaryLabel={att != null ? (attentionLabel || '확인') : undefined}
        secondaryCount={att}
      />
    );
  }

  useAppBar({ title: barTitle }, [selected, title, barLabel, contextTitle, countNum, att, attentionLabel, countSuffix]);

  useEffect(() => {
    if (!selected) return;
    const first = panes[0]?.key || '';
    if (mobileSwapKey == null) setInnerSwap(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, paneKeySig]);

  const activePane = panes.find((p) => p.key === swapKey) || panes[0];

  const resolvedTools: ListToolsConfig | undefined = listTools ?? (
    search ? { search } : undefined
  );

  const webSearchCfg = resolvedTools?.search || search;
  const webSort = resolvedTools?.sort;
  const webFilter = resolvedTools?.filter;
  const webHasTools = !!(webSearchCfg || webSort || webFilter);
  const webSearchBar = webHasTools ? (
    <div style={{ flex: '0 0 auto', borderBottom: `1px solid ${C.line2}` }}>
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {webSearchCfg ? (
          <SearchInput
            value={webSearchCfg.value}
            onChange={webSearchCfg.onChange}
            placeholder={webSearchCfg.placeholder || '검색'}
            full
            style={{ flex: '1 1 160px', minWidth: 0 }}
          />
        ) : <span style={{ flex: 1, minWidth: 0 }} />}
        {webSort ? (
          <Select
            size="sm"
            value={webSort.value}
            onChange={webSort.onChange}
            placeholder={webSort.placeholder || '정렬'}
            options={[
              { value: '', label: '기본' },
              ...webSort.options.map((o) => ({ value: o.value, label: o.label })),
            ]}
            width={112}
          />
        ) : null}
      </div>
      {webFilter ? (
        <div style={{ padding: '0 12px 10px' }}>
          {webFilter.body}
          {webFilter.count > 0 && webFilter.onClear ? (
            <div style={{ marginTop: 8 }}>
              <Btn size="sm" variant="ghost" onClick={() => { haptic.select(); webFilter.onClear?.(); }}>필터 해제</Btn>
            </div>
          ) : null}
        </div>
      ) : null}
      {resolvedTools?.hints && resolvedTools.hints.length > 0 ? (
        <div style={{
          padding: '0 12px 8px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 12, color: C.mute, minWidth: 0,
        }}>
          <span style={{ flex: '0 0 auto', fontWeight: 700, color: C.faint }}>적용</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {resolvedTools.hints.join(' · ')}
          </span>
          {resolvedTools.onClearHints ? (
            <Btn size="sm" variant="ghost" onClick={() => { haptic.select(); resolvedTools.onClearHints?.(); }}>해제</Btn>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  if (mobile) {
    if (!selected) {
      return (
        <MobilePageShell listTools={resolvedTools} bottomActions={actions}>
          {list}
        </MobilePageShell>
      );
    }

    if (mobileLayout === 'swap') {
      return (
        <div style={{
          position: 'fixed', top: 'var(--topbar-h)', left: 0, right: 0, bottom: 0,
          zIndex: 60, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activePane?.node}
          </div>
          <div style={{
            borderTop: `1px solid ${C.line}`, background: 'var(--bg-card)',
            boxShadow: '0 -3px 14px rgba(15,23,42,0.07)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}>
            <BottomNav
              embedded
              backKind="list"
              onBack={onBack}
              actions={
                <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                  {panes.map((p) => {
                    const on = p.key === swapKey;
                    return (
                      <Btn
                        key={p.key}
                        variant={on ? 'solid' : 'ghost'}
                        onClick={() => { haptic.nav(); setSwapKey(p.key); }}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        {p.title}
                      </Btn>
                    );
                  })}
                </div>
              }
            />
          </div>
        </div>
      );
    }

    return (
      <div style={{
        position: 'fixed', top: 'var(--topbar-h)', left: 0, right: 0, bottom: 0,
        zIndex: 60, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column',
      }}>
        <div className="fp-work-stack" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch' }}>
          {panes.map((p, i) => (
            <section
              key={p.key}
              aria-label={p.title}
              style={{
                borderBottom: i < panes.length - 1 ? `1px solid ${C.line}` : undefined,
                background: 'var(--bg-card)',
                boxSizing: 'border-box',
              }}
            >
              {p.node}
            </section>
          ))}
        </div>
        <div style={{
          borderTop: `1px solid ${C.line}`, background: 'var(--bg-card)',
          boxShadow: '0 -3px 14px rgba(15,23,42,0.07)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          flex: '0 0 auto',
        }}>
          <BottomNav embedded backKind="list" onBack={onBack} actions={actions} />
        </div>
      </div>
    );
  }

  const col = (flex: string, extra?: CSSProperties): CSSProperties => ({
    flex, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
    borderRight: `1px solid ${C.line}`, boxSizing: 'border-box', ...extra,
  });
  return (
    <>
      <div style={{ display: 'flex', height: 'calc(100dvh - var(--topbar-h) - var(--fp-bar-h))', borderTop: `1px solid ${C.line}`, overflowX: 'hidden' }}>
        <div style={col('1 1 0', { minWidth: 0, overflow: 'hidden' })}>
          <PaneHead title={title} count={listCount} />
          {webSearchBar}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>{list}</div>
        </div>
        {panes.map((p, i) => (
          <div key={p.key} style={col(
            p.width ? `0 0 ${p.width}px` : '1 1 0',
            {
              ...(p.width ? { width: p.width, minWidth: p.width, maxWidth: p.width, flexShrink: 0, overflow: 'hidden' } : { minWidth: 0 }),
              ...(i === panes.length - 1 ? { borderRight: 'none' } : {}),
            },
          )}>
            {p.node}
          </div>
        ))}
      </div>
      <BottomNav actions={actions} maxWidth={100000} padX={16} />
    </>
  );
}
