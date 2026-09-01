'use client';

import { LayoutGrid, List, Sheet } from 'lucide-react';
import { InterestTriggers, type InterestTab } from '@/components/InterestRail';
import { IconSeg, SearchInput, Select, ICON } from '@/components/ui';
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
  view: string;
  onView: (value: string) => void;
  recentCount: number;
  favoriteCount: number;
  interestTab: InterestTab | null;
  onInterestTab: (tab: InterestTab | null) => void;
  sort: string;
  onSort: (value: string) => void;
};

export function FinderToolbar(props: Props) {
  const search = (
    <SearchInput
      value={props.query}
      onChange={props.onQuery}
      placeholder="예: 21세 그랜저, 무보증 쏘나타"
      ariaLabel="차량과 조건 통합검색"
      style={{ flex: '1 1 0', minWidth: 0 }}
      /* 선택색(파랑) 배경은 305caf4f 가 넣은 것 — 원래의 흰 바탕+얇은 테두리로 되돌림(사장님 2026-08-22 「원래 느낌이 아니잖아, 딱 깔끔하게」). */
    />
  );

  /**
   * ★모바일 = **툴바가 없다**(사장님 2026-08-30 「검색 창을 없애는 게 나을 거 같고, 검색 버튼을 누르면
   * 검색과 필터가 나오는 그런 형태로 — 당근이랑 아주 동일하게」).
   *
   *   전에는 검색창 한 줄이 목록 위를 가로질렀다(2026-08-22 규격). 그 한 줄은 폰에서 카드 반 장 값이고,
   *   실제로 매번 치는 것도 아니다. 검색어·조건은 **상단 돋보기 하나 뒤**로 같이 들어갔다 —
   *   자리는 `lib/appbar` search 슬롯, 내용은 finder 의 「검색·조건」 시트다.
   *   그래서 목록은 이제 **첫 줄부터 상품**이다.
   */
  if (props.mobile) return null;

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
