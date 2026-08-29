'use client';

import { FileSpreadsheet, LayoutGrid, List, SlidersHorizontal, Table } from 'lucide-react';
import { PRODUCT_SHEET_URL } from '@/lib/product-sheet';
import { InterestTriggers, type InterestTab } from '@/components/InterestRail';
import { C, CountPill, IconBtn, IconSeg, SearchInput, Select, ICON } from '@/components/ui';
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
  sort: string;
  onSort: (value: string) => void;
  view: string;
  onView: (value: string) => void;
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
      placeholder="예: 21세 그랜저, 무보증 쏘나타"
      aria-label="차량과 조건 통합검색"
      style={{ flex: '1 1 0', minWidth: 0 }}
      inputStyle={{ background: C.selected }}
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
            <SlidersHorizontal size={ICON.xl} />
          </IconBtn>
          {props.filterBadge > 0 && <span className="fp-icon-count"><CountPill n={props.filterBadge} tone="accent" /></span>}
        </span>
      </div>
    );
  }

  return (
    <div className="fp-finder-toolbar fp-finder-toolbar--primary">
      <div className="fp-finder-toolbar-main">
        <div className="fp-finder-search-group">
          {search}
          <span className="fp-finder-sort">
            <Select value={props.sort} onChange={props.onSort} placeholder="정렬" width={132} options={FINDER_SORTS} />
          </span>
        </div>
        <div className="fp-finder-interest-group">
          <InterestTriggers recentN={props.recentCount} favN={props.favoriteCount} tab={props.interestTab} onTab={props.onInterestTab} />
        </div>
        <div className="fp-finder-view-group">
          {/* 자리 상시 예약 — 뷰 전환 시 우측 그룹 폭이 변해 검색창이 점프하는 것 방지. */}
          {/* 엑셀 다운로드를 없애고 구글시트로 보낸다. 시트가 상품리스트의 배포처이고,
              엑셀 받기·필터·공유가 거기서 다 된다 — 우리가 파일을 만들어 줄 이유가 없다. */}
          <span className="fp-finder-sheet-slot">
            <a href={PRODUCT_SHEET_URL} target="_blank" rel="noopener noreferrer" title="상품 구글시트를 새 탭에서 엽니다">
              <FileSpreadsheet size={ICON.md} aria-hidden />
              <span>구글시트 열기</span>
            </a>
          </span>
          <span className="fp-finder-view-switch" role="group" aria-label="상품 보기 방식">
            <IconSeg
              showLabel
              value={props.view}
              onChange={props.onView}
              options={VIEWS.map(({ key, label, Icon }) => ({ key, label, icon: <Icon size={ICON.md} /> }))}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
