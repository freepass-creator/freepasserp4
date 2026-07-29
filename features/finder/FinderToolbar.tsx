'use client';

import { Download, LayoutGrid, List, SlidersHorizontal, Table } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { downloadProductsExcel } from '@/lib/excel-export';
import { InterestTriggers, type InterestTab } from '@/components/InterestRail';
import { C, FS, NUM, CountPill, IconBtn, IconSeg, SearchInput, Select } from '@/components/ui';
import { FINDER_SORTS } from './filter-state';

const VIEWS = [
  { key: 'card', label: '간단', Icon: LayoutGrid },
  { key: 'list', label: '상세', Icon: List },
  { key: 'excel', label: '엑셀', Icon: Table },
];

type Props = {
  mobile: boolean;
  query: string;
  onQuery: (value: string) => void;
  filterBadge: number;
  filterSheetOpen: boolean;
  onToggleFilterSheet: () => void;
  filterOpen: boolean;
  onToggleFilter: () => void;
  sidebarActiveCount: number;
  resultCount: number;
  sort: string;
  onSort: (value: string) => void;
  view: string;
  onView: (value: string) => void;
  excelRows: EntityRecord[];
  recentCount: number;
  favoriteCount: number;
  interestTab: InterestTab | null;
  onInterestTab: (tab: InterestTab | null) => void;
};

export function FinderToolbar(props: Props) {
  const search = (
    <SearchInput
      value={props.query}
      onChange={props.onQuery}
      placeholder="차번·차명·옵션·코드·공급사…"
      style={props.mobile
        ? { flex: '1 1 0', minWidth: 0 }
        : { flex: '1 1 0', minWidth: 200, maxWidth: 420 }}
    />
  );

  if (props.mobile) {
    return (
      <div className="fp-finder-toolbar">
        {search}
        <span style={{ position: 'relative', display: 'inline-flex', flex: '0 0 auto' }}>
          <IconBtn
            title={props.filterBadge > 0 ? `조건 ${props.filterBadge}개 · 필터` : '필터'}
            active={props.filterSheetOpen}
            onClick={props.onToggleFilterSheet}
          >
            <SlidersHorizontal size={16} />
          </IconBtn>
          {props.filterBadge > 0 && <span className="fp-icon-count"><CountPill n={props.filterBadge} tone="accent" /></span>}
        </span>
      </div>
    );
  }

  return (
    <div className="fp-finder-toolbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, flexWrap: 'nowrap' }}>
        <span style={{ fontSize: FS.sub, color: C.mute, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
          상품 <b style={{ color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{props.resultCount.toLocaleString()}</b>대
        </span>
        <Select value={props.sort} onChange={props.onSort} placeholder="정렬" width={118} options={FINDER_SORTS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 0', minWidth: 0, maxWidth: 360 }}>
          {search}
          <InterestTriggers recentN={props.recentCount} favN={props.favoriteCount} tab={props.interestTab} onTab={props.onInterestTab} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flex: '0 0 auto' }}>
          {/* 다운로드 자리 상시 예약 — 뷰 전환 시 우측 그룹 폭이 변해 검색창이 점프하는 것 방지. */}
          <span style={{ display: 'inline-flex', visibility: props.view === 'excel' ? undefined : 'hidden' }} aria-hidden={props.view !== 'excel'}>
            <IconBtn title="엑셀 다운로드" onClick={() => { if (props.view === 'excel') downloadProductsExcel(props.excelRows, new Date().toISOString().slice(0, 10)); }}>
              <Download size={16} />
            </IconBtn>
          </span>
          <span style={{ position: 'relative', display: 'inline-flex', flex: '0 0 auto' }}>
            <IconBtn
              title={props.filterOpen ? '필터 숨기기' : (props.sidebarActiveCount ? `조건 ${props.sidebarActiveCount}개 · 필터 보기` : '필터 보기')}
              active={props.filterOpen}
              onClick={props.onToggleFilter}
            >
              <SlidersHorizontal size={16} />
            </IconBtn>
            {props.sidebarActiveCount > 0 && <span className="fp-icon-count"><CountPill n={props.sidebarActiveCount} tone="accent" /></span>}
          </span>
          <IconSeg
            showLabel
            value={props.view}
            onChange={props.onView}
            options={VIEWS.map(({ key, label, Icon }) => ({ key, label, icon: <Icon size={16} /> }))}
          />
        </div>
      </div>
    </div>
  );
}
