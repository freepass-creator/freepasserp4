'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LayoutGrid, List, Sheet, SlidersHorizontal } from 'lucide-react';
import { Btn, CountPill, IconSeg, SearchInput, ICON } from '@/components/ui';
import { FinderFilterPanel, type FinderFilterPanelModel } from './FinderFilterPanel';

const VIEWS = [
  { key: 'card', label: '간단', Icon: LayoutGrid },
  { key: 'list', label: '상세', Icon: List },
  { key: 'excel', label: '엑셀', Icon: Sheet },
];

type Props = {
  mobile: boolean;
  query: string;
  onQuery: (value: string) => void;
  filterOpen: boolean;
  onToggleFilter: () => void;
  onCloseFilter: () => void;
  sidebarActiveCount: number;
  detailPanel: FinderFilterPanelModel;
  view: string;
  onView: (value: string) => void;
  quickFilters: ReactNode;
};

/** 웹 검색줄 = 세부필터 → 검색 → 퀵필터 → 보기. 최근·관심과 독립 정렬 Select는 두지 않는다. */
export function FinderToolbar(props: Props) {
  // 엑셀 보기는 시트 헤더가 열별 필터·정렬의 단일 진입점이다. 같은 조건을 상단에
  // 다시 세우면 카드 보기와 서로 다른 결과를 만들 수 있으므로 웹 퀵/세부필터를 숨긴다.
  const useSheetHeaderFilters = props.view === 'excel';
  const root = useRef<HTMLDivElement>(null);
  const detailAnchor = useRef<HTMLSpanElement>(null);
  const [detailBox, setDetailBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const placeDetail = useCallback(() => {
    const el = detailAnchor.current;
    if (!el || !props.filterOpen) { setDetailBox(null); return; }
    const rect = el.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - 12 - width);
    setDetailBox({ top: Math.round(rect.bottom + 4), left: Math.round(left), width });
  }, [props.filterOpen]);
  useEffect(() => {
    placeDetail();
    if (!props.filterOpen) return;
    const on = () => placeDetail();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); };
  }, [props.filterOpen, placeDetail]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) props.onCloseFilter();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [props.onCloseFilter]);

  if (props.mobile) return null;
  return (
    <div className={`fp-finder-toolbar fp-finder-toolbar--primary${useSheetHeaderFilters ? ' is-sheet' : ''}`} ref={root}>
      <div className="fp-finder-toolbar-main">
        <div className="fp-finder-search-group">
          {!useSheetHeaderFilters ? <span className="fp-finder-detail-trigger" ref={detailAnchor}>
            <Btn size="sm" variant={props.filterOpen || props.sidebarActiveCount > 0 ? 'solid' : 'ghost'} aria-pressed={props.filterOpen}
              title={props.filterOpen ? '세부필터 닫기' : (props.sidebarActiveCount ? `조건 ${props.sidebarActiveCount}개 · 세부필터` : '세부필터')}
              onClick={props.onToggleFilter}><SlidersHorizontal size={ICON.sm} aria-hidden />세부필터</Btn>
            {props.sidebarActiveCount > 0 ? <span className="fp-quick-filter-count"><CountPill n={props.sidebarActiveCount} /></span> : null}
            {props.filterOpen && detailBox ? (
              <div className="fp-quick-filter-detail" role="dialog" aria-label="세부 조건" style={{ top: detailBox.top, left: detailBox.left, width: detailBox.width }}>
                <FinderFilterPanel model={props.detailPanel} />
              </div>
            ) : null}
          </span> : null}
          <SearchInput value={props.query} onChange={props.onQuery} placeholder="예: 21세 그랜저, 무보증 쏘나타" ariaLabel="차량과 조건 통합검색" style={{ flex: '1 1 0', minWidth: 0 }} />
        </div>
        {!useSheetHeaderFilters ? <div className="fp-finder-quick-inline">{props.quickFilters}</div> : null}
        <div className="fp-finder-view-group">
          <span className="fp-finder-view-switch" role="group" aria-label="상품 보기 방식">
            <IconSeg showLabel value={props.view} onChange={props.onView} options={VIEWS.map(({ key, label, Icon }) => ({ key, label, icon: <Icon size={ICON.md} /> }))} />
          </span>
        </div>
      </div>
    </div>
  );
}
