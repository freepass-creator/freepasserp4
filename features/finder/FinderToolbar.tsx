'use client';

import { LayoutGrid, List, SlidersHorizontal, Sheet } from 'lucide-react';
import { InterestTriggers, type InterestTab } from '@/components/InterestRail';
import { C, CountPill, IconBtn, IconSeg, SearchInput, Select, ICON } from '@/components/ui';
import { FINDER_SORTS } from './filter-state';

const VIEWS = [
  { key: 'card', label: '간단', Icon: LayoutGrid },
  { key: 'list', label: '상세', Icon: List },
  /**
   * 「시트」 = 판매시트 그대로 보기(features/finder/SheetView.tsx).
   * 예전 「엑셀」(우리가 그리던 표)을 **대체**한다 — 상품리스트의 정본이 시트라 우리가 흉내 낼 이유가 없다.
   * 키는 `excel` 그대로 둔다: 저장된 세션·즐겨찾기 링크가 그 값을 들고 있어서 바꾸면 뷰가 초기화된다.
   */
  { key: 'excel', label: '시트', Icon: Sheet },
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
      ariaLabel="차량과 조건 통합검색"
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
            <SlidersHorizontal size={ICON.md} />
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
