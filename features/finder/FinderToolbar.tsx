'use client';

import { LayoutGrid, List, SlidersHorizontal, Sheet } from 'lucide-react';
import { InterestTriggers, type InterestTab } from '@/components/InterestRail';
import { Btn, C, CountPill, IconSeg, SearchInput, Select, ICON } from '@/components/ui';
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

  if (props.mobile) {
    /**
     * 모바일 = **검색창 한 줄이 화면 끝까지, 필터는 그 «안» 우측**(사장님 2026-08-22).
     * 박스(IconBtn 테두리·바탕) 없이 아이콘만 — 입력칸이 이미 테두리를 가졌는데 그 안에 또 상자를 두면 겹친다.
     * 필터 칸 = 검색칸과 같은 높이(ctrlH). 글리프는 돋보기·하단탭과 같은 ICON.xl.
     * 조건 개수는 옆 숫자가 아니라 CountPill(탭·메뉴와 같은 자리).
     */
    const on = props.filterSheetOpen || props.filterBadge > 0;
    return (
      <div className="fp-finder-toolbar">
        <SearchInput
          value={props.query}
          onChange={props.onQuery}
          placeholder="예: 21세 그랜저, 무보증 쏘나타"
          ariaLabel="차량과 조건 통합검색"
          full
          style={{ flex: '1 1 auto', minWidth: 0 }}
          trailing={(
            <span style={{ position: 'relative', display: 'inline-flex', width: '100%', height: '100%' }}>
              <Btn
                variant="bare"
                title={props.filterBadge > 0 ? `조건 ${props.filterBadge}개 · 필터` : '필터'}
                aria-label={props.filterBadge > 0 ? `조건 ${props.filterBadge}개 · 필터` : '필터'}
                aria-pressed={props.filterSheetOpen}
                onClick={props.onToggleFilterSheet}
                style={{ width: '100%', height: '100%', color: on ? C.accent : C.mute }}
              >
                <SlidersHorizontal size={ICON.xl} strokeWidth={on ? 2.4 : 2} />
              </Btn>
              {props.filterBadge > 0 ? (
                <span className="fp-icon-count">
                  <CountPill n={props.filterBadge} tone="accent" />
                </span>
              ) : null}
            </span>
          )}
        />
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
