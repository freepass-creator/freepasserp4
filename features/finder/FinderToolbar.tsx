'use client';

import { Download, LayoutGrid, List, SlidersHorizontal, Table } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { downloadProductsExcel } from '@/lib/excel-export';
import { InterestTriggers, type InterestTab } from '@/components/InterestRail';
import { C, FS, CountPill, IconBtn, IconSeg, SearchInput, Select } from '@/components/ui';

const SORTS = [
  { k: 'asc', label: '대여료 낮은순' },
  { k: 'desc', label: '대여료 높은순' },
  { k: 'dep_asc', label: '보증금 낮은순' },
  { k: 'dep_desc', label: '보증금 높은순' },
  { k: 'mile_asc', label: '주행 짧은순' },
  { k: 'mile_desc', label: '주행 많은순' },
  { k: 'new', label: '연식 최신순' },
  { k: 'old', label: '연식 오래된순' },
];

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
        <span style={{ fontSize: FS.sub, color: C.mute, whiteSpace: 'nowrap' }}>
          상품 <b style={{ color: C.ink }}>{props.resultCount.toLocaleString()}</b>대
        </span>
        <Select value={props.sort} onChange={props.onSort} placeholder="정렬" width={118} options={SORTS.map((item) => ({ value: item.k, label: item.label }))} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 0', minWidth: 0, maxWidth: 360 }}>
          {search}
          <InterestTriggers recentN={props.recentCount} favN={props.favoriteCount} tab={props.interestTab} onTab={props.onInterestTab} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flex: '0 0 auto' }}>
          {props.view === 'excel' && (
            <IconBtn title="엑셀 다운로드" onClick={() => downloadProductsExcel(props.excelRows, new Date().toISOString().slice(0, 10))}>
              <Download size={16} />
            </IconBtn>
          )}
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
            value={props.view}
            onChange={props.onView}
            options={VIEWS.map(({ key, label, Icon }) => ({ key, label, icon: <Icon size={16} /> }))}
          />
        </div>
      </div>
    </div>
  );
}
