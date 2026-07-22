'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Search, ArrowUpDown, SlidersHorizontal } from 'lucide-react';
import { BottomNav, SearchInput, Btn, FilterChips, C, NUM, FS } from '@/components/ui';
import { PageToolBar, type PageToolItem } from '@/components/PageToolBar';
import { MobileListDock } from '@/components/MobileListDock';
import { BottomSheet } from '@/components/BottomSheet';
import { useIsMobile } from '@/lib/use-mobile';
import { isTabRoute, useTabBarHidden } from '@/lib/tabbar';
import { routeKey } from '@/lib/page-refresh';
import { haptic } from '@/lib/haptics';

/**
 * 모바일 목록 골격 SSOT
 *   TopBar → PageToolBar(고정) → 본문(스크롤) → 하단 액션/AppTabBar
 * 툴바는 스크롤에 안 사라짐. 시트 = BottomSheet. 페이지는 listTools만.
 */
export type ListToolsConfig = {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  sort?: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
  };
  /** 필터 본문까지 셸이 시트에 그림 — 페이지가 FilterSheet 직접 열지 말 것 */
  filter?: {
    count: number;
    label?: string;
    title?: string;
    onClear?: () => void;
    body: ReactNode;
  };
  /** @deprecated 목록 등록·삭제는 bottomActions(PageActions) — 툴바는 검색·정렬·필터만 */
  extra?: PageToolItem[];
  hints?: string[];
  onClearHints?: () => void;
};

type SheetKind = 'search' | 'sort' | 'filter' | null;

export function MobilePageShell({
  title,
  count,
  countSuffix = '건',
  info,
  search,
  toolbarRight,
  tools,
  listTools,
  bottomActions,
  bottom,
  children,
}: {
  title?: string;
  count?: ReactNode;
  countSuffix?: string;
  info?: ReactNode;
  /** @deprecated listTools.search */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  toolbarRight?: ReactNode;
  tools?: PageToolItem[];
  listTools?: ListToolsConfig;
  bottomActions?: ReactNode;
  bottom?: ReactNode;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  const path = usePathname();
  const tabHidden = useTabBarHidden();
  const onTabRoot = mobile && isTabRoute(path) && !tabHidden;
  const [sheet, setSheet] = useState<SheetKind>(null);

  const lt = listTools;
  const searchCfg = lt?.search || search;
  const sortCfg = lt?.sort;
  const filterCfg = lt?.filter;

  const toggle = (k: Exclude<SheetKind, null>) => setSheet((s) => (s === k ? null : k));
  const close = () => setSheet(null);

  // 상단바/동일탭 재탭 = 시트 닫기(새로 온 느낌)
  useEffect(() => {
    const on = (e: Event) => {
      if (routeKey(path) !== (e as CustomEvent).detail) return;
      setSheet(null);
    };
    window.addEventListener('fp:page-refresh', on);
    return () => window.removeEventListener('fp:page-refresh', on);
  }, [path]);

  const builtTools: PageToolItem[] | null = (() => {
    if (tools) return tools;
    if (!lt && !searchCfg) return null;
    const out: PageToolItem[] = [];
    if (searchCfg) {
      const on = !!searchCfg.value.trim();
      out.push({
        key: 'search', label: '검색', icon: Search,
        badge: on ? 1 : undefined, active: on, pressed: sheet === 'search',
        onClick: () => toggle('search'),
      });
    }
    if (sortCfg) {
      const on = !!sortCfg.value;
      out.push({
        key: 'sort', label: '정렬', icon: ArrowUpDown,
        badge: on ? 1 : undefined, active: on, pressed: sheet === 'sort',
        onClick: () => toggle('sort'),
      });
    }
    if (filterCfg) {
      const n = filterCfg.count || 0;
      out.push({
        key: 'filter', label: filterCfg.label || '필터', icon: SlidersHorizontal,
        badge: n || undefined, active: n > 0, pressed: sheet === 'filter',
        onClick: () => toggle('filter'),
      });
    }
    return out.length ? out : null;
  })();

  const infoEl = info ?? (
    <span style={{ fontSize: FS.body, color: C.mute, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
      {title || ''}
      {count != null && count !== '' ? (
        <>
          {' '}
          <b style={{ color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{count}</b>
          {countSuffix}
        </>
      ) : null}
    </span>
  );

  const hasExtraDock = bottom != null || bottomActions != null || (!onTabRoot && builtTools != null);
  const padBottom = onTabRoot
    ? (hasExtraDock ? 'calc(var(--fp-tabbar-h) + var(--fp-bar-h))' : 'var(--fp-tabbar-h)')
    : 'calc(var(--fp-bar-h) + env(safe-area-inset-bottom))';

  // 목록툴 없으면 건수·검색 툴바. 제목만 있고 건수·검색·우측 없으면 툴바 생략(설정 등).
  const showInfoBar = !builtTools && (searchCfg != null || toolbarRight != null || (count != null && count !== '') || info != null);
  const toolbar = builtTools ? (
    <PageToolBar tools={builtTools} hints={lt?.hints} onClearHints={lt?.onClearHints} />
  ) : showInfoBar ? (
    <div className="fp-page-toolbar" style={{ gap: 8 }}>
      {infoEl}
      {searchCfg ? (
        <SearchInput
          value={searchCfg.value}
          onChange={searchCfg.onChange}
          placeholder={searchCfg.placeholder || '검색'}
          style={{ flex: '1 1 0', minWidth: 0 }}
        />
      ) : <span style={{ flex: 1, minWidth: 0 }} />}
      {toolbarRight}
    </div>
  ) : null;

  const dock = bottom != null
    ? bottom
    : (bottomActions != null || !onTabRoot)
      ? (builtTools
        ? <MobileListDock actions={bottomActions} />
        : <BottomNav actions={bottomActions} maxWidth={100000} padX={12} />)
      : null;

  return (
    <>
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: 'calc(100dvh - var(--topbar-h))',
        background: 'var(--bg-card)',
      }}>
        {toolbar}
        <div className="fp-page-scroll" style={{
          flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          paddingBottom: padBottom,
        }}>
          {children}
        </div>
      </div>
      {dock}

      {searchCfg && (
        <BottomSheet open={sheet === 'search'} onClose={close} title="검색" maxHeight="auto" pad={false}
          footer={
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="ghost" style={{ flex: 1 }} onClick={() => { searchCfg.onChange(''); haptic.select(); }}>지우기</Btn>
              <Btn style={{ flex: 1 }} onClick={() => { haptic.nav(); close(); }}>
                {count != null ? `${count}${countSuffix}` : '닫기'}
              </Btn>
            </div>
          }
        >
          <div style={{ padding: '4px 16px 8px' }}>
            <SearchInput
              value={searchCfg.value}
              onChange={searchCfg.onChange}
              placeholder={searchCfg.placeholder || '검색'}
              full
            />
          </div>
        </BottomSheet>
      )}

      {sortCfg && (
        <BottomSheet open={sheet === 'sort'} onClose={close} title={sortCfg.placeholder || '정렬'} maxHeight="auto"
          footer={<Btn style={{ width: '100%' }} onClick={() => { haptic.nav(); close(); }}>적용</Btn>}
        >
          <FilterChips
            value={sortCfg.value || ''}
            onChange={(v) => { sortCfg.onChange(v); haptic.select(); }}
            options={[{ key: '', label: '기본' }, ...sortCfg.options.map((o) => ({ key: o.value, label: o.label }))]}
          />
        </BottomSheet>
      )}

      {filterCfg && (
        <BottomSheet
          open={sheet === 'filter'}
          onClose={close}
          title={filterCfg.title || filterCfg.label || '필터'}
          maxHeight="min(68vh, 560px)"
          footer="filter"
          onClear={filterCfg.onClear}
        >
          {filterCfg.body}
        </BottomSheet>
      )}
    </>
  );
}
