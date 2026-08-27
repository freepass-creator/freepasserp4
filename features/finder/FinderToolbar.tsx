'use client';

import { LayoutGrid, List, SlidersHorizontal, Sheet } from 'lucide-react';
import { InterestTriggers, type InterestTab } from '@/components/InterestRail';
import { Btn, C, FS, FW, IconSeg, NUM, SearchInput, ICON } from '@/components/ui';

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
     * 켜짐(시트 열림)·조건 개수는 색(accent)과 옆 숫자로 말한다 — 좁은 슬롯에 뱃지를 겹치면 테두리에 잘린다.
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
            <Btn
              variant="bare"
              title={props.filterBadge > 0 ? `조건 ${props.filterBadge}개 · 필터` : '필터'}
              aria-label={props.filterBadge > 0 ? `조건 ${props.filterBadge}개 · 필터` : '필터'}
              aria-pressed={props.filterSheetOpen}
              onClick={props.onToggleFilterSheet}
              style={{ color: on ? C.accent : C.mute, gap: 3 }}
            >
              <SlidersHorizontal size={ICON.md} strokeWidth={on ? 2.4 : 2} />
              {props.filterBadge > 0 ? (
                <span style={{ fontSize: FS.cap, fontWeight: FW.title, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{props.filterBadge}</span>
              ) : null}
            </Btn>
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
