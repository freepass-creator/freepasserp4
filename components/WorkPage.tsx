'use client';
import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { useKeyboardOpen } from '@/lib/use-keyboard';
import { haptic } from '@/lib/haptics';
import { useAppBar } from '@/lib/appbar';
import { useHideTabBar } from '@/lib/tabbar';
import { PaneHead, BottomNav, Btn, IconSeg, C, FS, FW, SH } from '@/components/ui';
import { MobilePageShell, type ListToolsConfig } from '@/components/MobilePageShell';
import { PageStatus, statusIconFor } from '@/components/PageStatus';
import { WebListTools } from '@/components/WebListTools';

/**
 * 업무 페이지 = [목록 | 패널].
 * 상단바 상태 = PageStatus(상품검색과 동일: 아이콘+라벨+건수).
 * 목록 툴 = 모바일 PageToolBar 시트 / 웹 검색행+정렬·필터(동일 listTools).
 */
export type WorkPane = { key: string; title: string; node: ReactNode; width?: number; icon?: LucideIcon };
export type WorkMobileLayout = 'stack' | 'swap';

export function WorkPage({
  title, statusLabel, statusCount, listCount, list, listHeader, panes, selected, onBack, search, actions,
  headerActions,
  mobileLayout = 'stack', mobileSwapKey, onMobileSwapKeyChange, countSuffix = '건', hideDock,
  listTools, contextTitle,
  attentionLabel, attentionCount,
}: {
  title: string;
  /** 상단바 라벨(미지정 시 title). 예: 계약진행중 / 출고가능 */
  statusLabel?: string;
  /** 상단바 건수(미지정 시 listCount). 필터와 무관한 KPI */
  statusCount?: number | null;
  listCount?: ReactNode;
  list: ReactNode;
  /** 목록 종류 전환처럼 검색·필터보다 상위인 제어. */
  listHeader?: ReactNode;
  panes: WorkPane[]; selected: boolean; onBack: () => void;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  /** 하단 독 액션(수정·저장 등). */
  actions?: ReactNode;
  /** 상단바 우측(erp3 headerRight). 선택 상세에서만 노출. */
  headerActions?: ReactNode;
  mobileLayout?: WorkMobileLayout;
  /** 모바일 상세에서 하단독 일시 숨김(채팅 입력 중 작성 공간 확보). 해제되면 다시 나타남. */
  hideDock?: boolean;
  mobileSwapKey?: string;
  onMobileSwapKeyChange?: (key: string) => void;
  /** 건수 단위. 상단바와 목록 헤더가 같은 단위를 쓰도록 여기서 한 번만 붙인다('0' vs '0건' 혼재 방지). */
  countSuffix?: string;
  listTools?: ListToolsConfig;
  contextTitle?: ReactNode;
  /** 처리·안읽음 등 보조 건수(상품검색 「검색 M」자리) */
  attentionLabel?: string;
  attentionCount?: number | null;
}) {
  const mobile = useIsMobile();
  // 키보드가 올라오면 하단독을 접는다 — 입력칸 바로 위에 독이 겹쳐 앉는 걸 막는다.
  //  focus 가 아니라 시각 뷰포트로 재는 이유는 use-keyboard.ts 참고(뒤로가기로 키보드만 내리면
  //  입력칸은 계속 focus 라 독이 안 돌아온다). 호출부의 hideDock 과 OR 로 합친다.
  const kb = useKeyboardOpen();
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
          <span style={{ color: C.mute, fontWeight: FW.meta, flex: '0 0 auto' }}>·</span>
          <span style={{
            minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: FS.body, fontWeight: FW.head, color: C.ink,
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

  useAppBar(
    { title: barTitle, actions: selected ? headerActions : undefined },
    [selected, title, barLabel, contextTitle, countNum, att, attentionLabel, countSuffix, headerActions],
  );

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

  if (mobile) {
    if (!selected) {
      return (
        <MobilePageShell listTools={resolvedTools} bottomActions={actions}>
          {listHeader}
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
            boxShadow: SH.dock,
            paddingBottom: 'env(safe-area-inset-bottom)',
            flex: '0 0 auto',
            ...(hideDock || kb.open ? { display: 'none' } : null),
          }}>
            <BottomNav
              embedded
              backKind="list"
              backShowLabel
              onBack={onBack}
              actions={
                <IconSeg
                  showLabel
                  value={swapKey}
                  onChange={(key) => { haptic.nav(); setSwapKey(key); }}
                  options={panes.map((p) => {
                    const PaneIcon = p.icon;
                    return {
                      key: p.key,
                      label: p.title,
                      icon: PaneIcon ? <PaneIcon size={16} /> : <span>{p.title.slice(0, 1)}</span>,
                    };
                  })}
                />
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
          boxShadow: SH.dock,
          paddingBottom: 'env(safe-area-inset-bottom)',
          flex: '0 0 auto',
          ...(hideDock || kb.open ? { display: 'none' } : null),
        }}>
          <BottomNav embedded backKind="list" backShowLabel onBack={onBack} actions={actions} />
        </div>
      </div>
    );
  }

  const col = (flex: string, extra?: CSSProperties): CSSProperties => ({
    flex, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
    borderRight: `1px solid ${C.line}`, boxSizing: 'border-box',
    background: C.taupeBg, // 목록·패널 = 흰 서피스(페이지 회색 #fafafa 비침 방지 → 목록다움)
    ...extra,
  });
  return (
    <>
      <div style={{ display: 'flex', height: 'calc(100dvh - var(--topbar-h) - var(--fp-bar-h))', borderTop: `1px solid ${C.line}`, overflowX: 'hidden', background: C.bg }}>
        <div style={col('1 1 0', { minWidth: 0, overflow: 'hidden' })}>
          <PaneHead title={title} count={listCount == null || listCount === '' ? undefined : `${listCount}${countSuffix}`} right={resolvedTools?.action ? (
            <Btn size="sm" disabled={resolvedTools.action.disabled} onClick={resolvedTools.action.onClick}>{resolvedTools.action.label}</Btn>
          ) : undefined} />
          {listHeader}
          <WebListTools tools={resolvedTools} />
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, background: C.taupeBg }}>{list}</div>
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
