'use client';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BottomNav, SearchInput, CountPill, Btn, ButtonLabel, Select, FilterGroup, C, NUM, FS, ICON } from '@/components/ui';
import { PageToolBar, type PageToolItem } from '@/components/PageToolBar';
import { MobileListDock } from '@/components/MobileListDock';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet';
import { useIsMobile } from '@/lib/use-mobile';
import { isTabRoute, useTabBarHidden } from '@/lib/tabbar';
import { routeKey } from '@/lib/page-refresh';
import { haptic } from '@/lib/haptics';
import { Plus, Search, ArrowUpDown, SlidersHorizontal, type LucideIcon } from 'lucide-react';

/**
 * 모바일 목록 골격 SSOT
 *   TopBar → 툴바(검색창+필터 [+등록]) → 본문 → 하단 액션/AppTabBar
 *   필터 시트 = FilterGroup(정렬) + FilterGroup(조건) · 취소/적용(commit)
 * 페이지는 listTools만. toolbar:'icons' = 구 아이콘행(레거시).
 */
export type ListToolsConfig = {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  sort?: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
    /** 빈 값 대신 실제 정렬값이 기본인 화면. 초기화 시 이 값과 해당 옵션 라벨로 돌아간다. */
    defaultValue?: string;
  };
  filter?: {
    count: number;
    label?: string;
    title?: string;
    onClear?: () => void;
    body: ReactNode;
    /** 드래프트 미리보기 결과 건수(제목 옆). */
    previewCount?: number;
    previewUnit?: string;
    /** 시트 열릴 때 라이브→드래프트 동기 */
    capture?: () => void;
    /** 취소·백드롭 — 드래프트 폐기 */
    restore?: () => void;
    /** 적용 — 드래프트→라이브 */
    commit?: () => void;
    /** 드래프트가 라이브와 다름(취소·적용 표시). 정렬 변경은 셸이 합산. */
    dirty?: boolean;
  };
  action?: { label: string; onClick: () => void; icon?: LucideIcon; disabled?: boolean };
  /** @default 'searchFilter' */
  toolbar?: 'searchFilter' | 'icons';
  /** @deprecated */
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
  /** 필터 시트 안 정렬 드래프트(커밋 전). */
  const [draftSort, setDraftSort] = useState('');
  const sortSnapRef = useRef('');

  const lt = listTools;
  const searchCfg = lt?.search || search;
  const sortCfg = lt?.sort;
  const filterCfg = lt?.filter;
  const sortDefaultLabel = sortCfg?.defaultValue
    ? (sortCfg.options.find((option) => option.value === sortCfg.defaultValue)?.label || '정렬 초기화')
    : '정렬 해제';
  const toolbarMode = lt?.toolbar || (tools ? 'icons' : 'searchFilter');
  const useSearchFilter = toolbarMode === 'searchFilter' && !tools;

  const close = () => setSheet(null);

  const openFilter = () => {
    haptic.select();
    filterCfg?.capture?.();
    const s = sortCfg?.value || '';
    sortSnapRef.current = s;
    setDraftSort(s);
    setSheet('filter');
  };

  const discardFilter = () => {
    filterCfg?.restore?.();
    // 정렬도 연 시점 스냅으로 회귀(드래프트만 버리고 라이브 정렬이 남은 경우 방지)
    if (sortCfg && (sortCfg.value || '') !== sortSnapRef.current) {
      sortCfg.onChange(sortSnapRef.current);
    }
    setDraftSort(sortSnapRef.current);
    setSheet(null);
  };

  const applyFilter = () => {
    if (sortCfg && draftSort !== sortCfg.value) sortCfg.onChange(draftSort);
    filterCfg?.commit?.();
    sortSnapRef.current = draftSort || '';
    setSheet(null);
  };

  const toggleIcon = (k: Exclude<SheetKind, null>) => setSheet((s) => (s === k ? null : k));

  // 상단바/동일탭 재탭 = 시트 닫기(새로 온 느낌)
  useEffect(() => {
    const on = (e: Event) => {
      if (routeKey(path) !== (e as CustomEvent).detail) return;
      if (sheet === 'filter') discardFilter();
      else setSheet(null);
    };
    window.addEventListener('fp:page-refresh', on);
    return () => window.removeEventListener('fp:page-refresh', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, sheet]);

  const builtTools: PageToolItem[] | null = (() => {
    if (!useSearchFilter) {
      if (tools) return tools;
      if (!lt && !searchCfg) return null;
      const out: PageToolItem[] = [];
      if (searchCfg) {
        const on = !!searchCfg.value.trim();
        out.push({
          key: 'search', label: '검색', icon: Search,
          badge: on ? 1 : undefined, active: on, pressed: sheet === 'search',
          onClick: () => toggleIcon('search'),
        });
      }
      if (sortCfg) {
        const on = !!sortCfg.value && sortCfg.value !== (sortCfg.defaultValue || '');
        out.push({
          key: 'sort', label: '정렬', icon: ArrowUpDown,
          badge: on ? 1 : undefined, active: on, pressed: sheet === 'sort',
          onClick: () => toggleIcon('sort'),
        });
      }
      if (filterCfg) {
        const n = filterCfg.count || 0;
        out.push({
          key: 'filter', label: filterCfg.label || '필터', icon: SlidersHorizontal,
          badge: n || undefined, active: n > 0, pressed: sheet === 'filter',
          onClick: () => toggleIcon('filter'),
        });
      }
      if (lt?.action) {
        out.push({
          key: 'action', label: lt.action.label, icon: lt.action.icon || Plus,
          accent: true, onClick: lt.action.onClick,
        });
      }
      return out.length ? out : null;
    }
    return null;
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

  const filterBadge = (filterCfg?.count || 0) + (sortCfg?.value ? 1 : 0);
  const hasListToolbar = useSearchFilter ? !!(searchCfg || filterCfg || lt?.action) : builtTools != null;
  const hasExtraDock = bottom != null || bottomActions != null || (!onTabRoot && hasListToolbar);
  const padBottom = onTabRoot
    ? (hasExtraDock ? 'calc(var(--fp-tabbar-h) + var(--fp-bar-h))' : 'var(--fp-tabbar-h)')
    : 'calc(var(--fp-bar-h) + env(safe-area-inset-bottom))';

  const showInfoBar = !hasListToolbar && (searchCfg != null || toolbarRight != null || (count != null && count !== '') || info != null);

  /**
   * ★**필터는 검색창 «안»에 든다**(사장님 2026-08-28 「모바일 검색창 세부필터 버튼 좌우 크기가 이상함」).
   *
   *   전에는 검색칸 옆에 네모 버튼을 따로 세웠다. 그러면 여백이 세 가지가 된다 —
   *   툴바 왼쪽 16 · 검색칸과 버튼 사이 8 · 툴바 오른쪽 16. 눈에는 그게 «크기가 안 맞는» 걸로 보인다.
   *
   *   `SearchInput` 에는 이걸 위한 `trailing` 슬롯이 **이미 만들어져 있었다**(얇은 세로선까지 —
   *   「검색은 글자, 필터는 조건」이라는 표시). 그런데 아무도 안 쓰고 있었다.
   *   새로 만들지 않고 그걸 쓴다 — 한 칸이 되니 여백 문제가 자리째 사라진다.
   */
  const filterBtn = filterCfg ? (
    <span style={{ position: 'relative', display: 'inline-flex', width: '100%', height: '100%' }}>
      <Btn
        variant="bare"
        title={filterBadge > 0 ? `필터 ${filterBadge}` : (filterCfg.label || '필터')}
        aria-pressed={sheet === 'filter'}
        onClick={() => { if (sheet === 'filter') discardFilter(); else openFilter(); }}
        style={{ width: '100%', height: '100%', color: (sheet === 'filter' || filterBadge > 0) ? C.accent : C.mute }}
      >
        <SlidersHorizontal size={ICON.xl} />
      </Btn>
      {filterBadge > 0 ? (
        <span className="fp-icon-count">
          <CountPill n={filterBadge} tone="accent" />
        </span>
      ) : null}
    </span>
  ) : null;

  const searchFilterBar = useSearchFilter && hasListToolbar ? (
    <div className="fp-page-toolbar" style={{ gap: 8 }}>
      {searchCfg ? (
        <SearchInput
          value={searchCfg.value}
          onChange={searchCfg.onChange}
          placeholder={searchCfg.placeholder || '검색'}
          style={{ flex: '1 1 0', minWidth: 0 }}
          trailing={filterBtn}
        />
      ) : <span style={{ flex: 1, minWidth: 0 }} />}
      {lt?.action ? (
        // 컨트롤 규격: CTA(등록 등)는 결정적 액션 → 모바일도 아이콘+텍스트(라벨 소거 금지).
        <Btn
          size="sm"
          disabled={lt.action.disabled}
          title={lt.action.label}
          onClick={() => { lt.action!.onClick(); }}
        >
          {(() => {
            const ActionIcon = lt.action!.icon || Plus;
            return <ButtonLabel icon={<ActionIcon size={ICON.md} aria-hidden />}>{lt.action!.label}</ButtonLabel>;
          })()}
        </Btn>
      ) : null}
    </div>
  ) : null;

  const toolbar = searchFilterBar
    || (builtTools ? (
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
    ) : null);

  const dock = bottom != null
    ? bottom
    : (bottomActions != null || !onTabRoot)
      ? (hasListToolbar
        ? <MobileListDock actions={bottomActions} />
        : <BottomNav actions={bottomActions} maxWidth={100000} padX={12} />)
      : null;

  const previewN = filterCfg?.previewCount;
  const previewUnit = filterCfg?.previewUnit || countSuffix || '건';
  const filterDirty = !!(filterCfg?.dirty) || !!(sortCfg && draftSort !== (sortCfg.value || ''));

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

      {/* 레거시 icons 모드 전용 검색·정렬 시트 */}
      {!useSearchFilter && searchCfg && (
        <BottomSheet
          open={sheet === 'search'}
          onClose={close}
          title="검색"
          maxHeight="auto"
          pad={false}
          footer="std"
          clearLabel="지우기"
          onClear={searchCfg.value.trim() ? () => { searchCfg.onChange(''); haptic.select(); } : undefined}
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

      {!useSearchFilter && sortCfg && (
        <BottomSheet
          open={sheet === 'sort'}
          onClose={close}
          title={sortCfg.placeholder || '정렬'}
          maxHeight="auto"
          footer="std"
          clearLabel={sortDefaultLabel}
          onClear={sortCfg.value !== (sortCfg.defaultValue || '') ? () => { sortCfg.onChange(sortCfg.defaultValue || ''); haptic.select(); } : undefined}
          pad
        >
          <Select
            full
            value={sortCfg.value || ''}
            onChange={(v) => { sortCfg.onChange(v); haptic.select(); }}
            placeholder={sortCfg.defaultValue ? undefined : (sortCfg.placeholder || '정렬 선택')}
            options={sortCfg.options.map((o) => ({ value: o.value, label: o.label }))}
          />
        </BottomSheet>
      )}

      {filterCfg && (
        <BottomSheet
          open={sheet === 'filter'}
          onClose={discardFilter}
          onCancel={discardFilter}
          onCommit={applyFilter}
          dirty={filterDirty}
          footer="commit"
          fixedHeight
          topInset="calc(var(--topbar-h) + var(--fp-bar-h))"
          title={
            <SheetTitle
              label={filterCfg.title || filterCfg.label || '조건 검색'}
              count={previewN != null ? previewN : (typeof count === 'number' ? count : filterCfg.count)}
              unit={previewUnit}
            />
          }
          maxHeight="min(68vh, 560px)"
          clearLabel="초기화"
          onClear={filterCfg.onClear
            ? () => {
              haptic.select();
              if (sortCfg) setDraftSort(sortCfg.defaultValue || '');
              filterCfg.onClear?.();
            }
            : undefined}
          pad
        >
          {useSearchFilter && sortCfg ? (
            <FilterGroup
              title="정렬"
              count={draftSort && draftSort !== (sortCfg.defaultValue || '') ? 1 : 0}
              defaultOpen
              first
              onClear={() => { setDraftSort(sortCfg.defaultValue || ''); haptic.select(); }}
            >
              <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                <Select
                  full
                  value={draftSort || ''}
                  onChange={(v) => { setDraftSort(v); haptic.select(); }}
                  placeholder={sortCfg.defaultValue ? undefined : (sortCfg.placeholder || '정렬 선택')}
                  options={sortCfg.options.map((o) => ({ value: o.value, label: o.label }))}
                />
              </div>
            </FilterGroup>
          ) : null}
          {filterCfg.body}
        </BottomSheet>
      )}
    </>
  );
}
