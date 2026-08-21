'use client';

import type { CSSProperties, Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import type { ColSort } from './excel-columns';
import { ProductCard } from '@/components/ProductCard';
import { ProductRowCard } from '@/components/ProductRowCard';
import { Btn, C, CenterNote, EXCEL_ROW_H, FS, R, SH, Skeleton, ctrlH } from '@/components/ui';
import { SheetView } from './SheetView';

// 뷰 컨테이너 스타일 SSOT — 실제 렌더와 로딩 스켈레톤이 같은 상수를 공유(재타이핑 드리프트=레이아웃 점프 방지).
const CARD_GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 };
// 상세(list): 브라우저 폭에 맞춰 1~3열. 카드 최소 약 400px, 4열은 정보 과밀이라 상한 3.
// (100%-12px)/3 = gap 6×2 보정. max(400px, …) 로 좁은 화면은 1~2열.
const LIST_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(max(400px, calc((100% - 12px) / 3)), 1fr))',
  gap: 6,
};
const MOBILE_FEED_WRAP: CSSProperties = { background: C.taupeBg, borderTop: `1px solid ${C.line2}` };

type Props = {
  bodyRef: RefObject<HTMLDivElement>;
  rows: EntityRecord[] | null;
  list: EntityRecord[];
  shown: EntityRecord[];
  excelRows: EntityRecord[];
  months: number[];
  view: string;
  mobile: boolean;
  focusMonth?: number;
  filterOpen: boolean;
  narrowed: boolean;
  onReset: () => void;
  onOpenProduct: (product: EntityRecord) => void;
  onProductContext: (event: MouseEvent, product: EntityRecord) => void;
  colFilter: Record<string, Set<string>>;
  setColFilter: Dispatch<SetStateAction<Record<string, Set<string>>>>;
  colSort: ColSort;
  setColSort: Dispatch<SetStateAction<ColSort>>;
  openCol: { field: string; x: number; y: number } | null;
  setOpenCol: Dispatch<SetStateAction<{ field: string; x: number; y: number } | null>>;
  moreCount: number;
  onMore: () => void;
  onShowAll: () => void;
  /** 보기 전환(startTransition) 중 — 프리즈 체감 완화용 dim */
  pending?: boolean;
  /** 판매시트에 같은 ERP 검색·필터 결과를 적용하기 위한 서버 확정 상세 주소 목록. */
  sheetFinderFilterActive?: boolean;
  sheetFinderFilterReady?: boolean;
  sheetFinderAllowedDetailHrefs?: string[];
  sheetFinderSortActive?: boolean;
  onSheetVisibleCountChange?: (count: number | null) => void;
};

export function FinderResults(props: Props) {
  const loading = props.rows == null;
  // 로딩 중 is-excel 금지 — 엑셀 flex/overflow 레이아웃에 리스트 스켈레톤이 끼면
  // 중간 공백·아래쪽 떠 있는 행(잔상)이 생긴다.
  /* 시트 본문 = flex + 자체 스크롤. 기본 본문은 블록이라 SheetView 의 flex:1 이 높이를 못 받아 0으로 접힌다. */
  const excelBody = props.view === 'excel';
  return (
    <div
      ref={props.bodyRef}
      className={`fp-finder-body${excelBody ? ' is-excel' : ''}`}
      style={props.pending ? { opacity: 0.55, transition: 'opacity .15s ease', pointerEvents: 'none' } : undefined}
    >
      {/* 시트 값은 서버에서 직접 읽되, ERP 검색·필터 결과는 서버 확정 상세 주소로만 안전하게 교집합한다. */}
      {props.view === 'excel' ? (
        <SheetView
          mobile={props.mobile}
          finderFilterActive={props.sheetFinderFilterActive}
          finderFilterReady={props.sheetFinderFilterReady}
          finderAllowedDetailHrefs={props.sheetFinderAllowedDetailHrefs}
          finderSortActive={props.sheetFinderSortActive}
          sheetProducts={props.rows || []}
          onVisibleCountChange={props.onSheetVisibleCountChange}
        />
      ) : loading ? (
        <FinderSkeleton view={props.view} mobile={props.mobile} />
      ) : props.list.length === 0 ? (
        <CenterNote>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>{(props.rows?.length ?? 0) === 0 ? '표시할 상품이 없습니다' : '조건에 맞는 상품이 없습니다'}</span>
            {props.narrowed && <Btn title="조건 해제" size="sm" variant="ghost" onClick={props.onReset}>조건 해제</Btn>}
          </div>
        </CenterNote>
      ) : props.view === 'card' ? (
        props.mobile ? (
          <div style={MOBILE_FEED_WRAP}>
            {props.shown.map((product) => <ProductRowCard key={String(product.product_code || product._key)} p={product} focusMonth={props.focusMonth} />)}
          </div>
        ) : (
          <div style={CARD_GRID}>
            {props.shown.map((product) => (
              <div key={String(product.product_code || product._key)} onContextMenu={(event) => props.onProductContext(event, product)}>
                <ProductCard p={product} focusMonth={props.focusMonth} />
              </div>
            ))}
          </div>
        )
      ) : props.view === 'list' ? (
        <div style={LIST_GRID}>
          {props.shown.map((product) => (
            <div key={String(product.product_code || product._key)} onContextMenu={(event) => props.onProductContext(event, product)}>
              <ProductRowCard p={product} focusMonth={props.focusMonth} />
            </div>
          ))}
        </div>
      ) : null}
      {props.view !== 'excel' && !loading && props.moreCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap',
          ...(props.mobile ? { padding: '10px 12px', borderTop: `1px solid ${C.line2}` } : { marginTop: 14 }),
        }}>
          <span style={{ fontSize: props.mobile ? FS.body : FS.sub, color: C.mute }}>
            {props.shown.length.toLocaleString()} / {(props.shown.length + props.moreCount).toLocaleString()}대
          </span>
          <Btn title={`더보기 ${Math.min(100, props.moreCount)}대`} variant="ghost" onClick={props.onMore}>더보기 · {Math.min(100, props.moreCount).toLocaleString()}대</Btn>
          <Btn title={`전체 ${props.shown.length + props.moreCount}대 보기`} variant="ghost" onClick={props.onShowAll}>전체 보기</Btn>
        </div>
      )}
    </div>
  );
}

/**
 * 뷰별 로딩 스켈레톤 — 각 뷰의 실제 컨테이너 dims를 그대로 미러링해 데이터 도착 시 레이아웃 shift 0.
 * (엑셀=표행 리듬 / 간단=카드타일 그리드 / 상세=가로카드 그리드 / 모바일=행피드)
 */
function FinderSkeleton({ view, mobile }: { view: string; mobile: boolean }) {
  if (view === 'excel') return <ExcelSkeleton count={mobile ? 9 : 14} />;
  if (mobile) return <MobileFeedSkeleton count={8} />; // 모바일 effView=card 고정
  if (view === 'list') return <RowListSkeleton count={7} />;
  return <CardGridSkeleton count={9} />; // 간단(card) 데스크톱
}

// 엑셀 — 표행 높이 EXCEL_ROW_H(=55) + sticky 헤더 리듬 + 지브라. 카드 스켈레톤과의 이질감 제거.
const EXCEL_COLS = [70, 54, 54, 96, 130, 56, 64];
const EXCEL_PRICE_COLS = [64, 64, 64];
function ExcelSkeleton({ count }: { count: number }) {
  return (
    <div role="status" aria-label="불러오는 중" style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: ctrlH(false, 'sm'), padding: '0 6px', boxSizing: 'border-box', background: C.head, borderBottom: `1px solid ${C.line}` }}>
        {EXCEL_COLS.map((w, i) => <Skeleton key={i} width={w} height={12} />)}
        <div style={{ flex: 1 }} />
        {EXCEL_PRICE_COLS.map((w, i) => <Skeleton key={`p${i}`} width={w} height={12} />)}
      </div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', height: EXCEL_ROW_H, padding: '0 6px', boxSizing: 'border-box', background: i % 2 ? C.zebra : C.taupeBg, borderBottom: `1px solid ${C.line2}` }}>
          {EXCEL_COLS.map((w, j) => <Skeleton key={j} width={w} height={13} />)}
          <div style={{ flex: 1 }} />
          {EXCEL_PRICE_COLS.map((w, j) => <Skeleton key={`p${j}`} width={w} height={13} />)}
        </div>
      ))}
    </div>
  );
}

// 간단(card) 데스크톱 — 실제 그리드 minmax(240)/gap14 + 이미지 2:1(paddingTop 50%).
function CardGridSkeleton({ count }: { count: number }) {
  return (
    <div role="status" aria-label="불러오는 중" style={CARD_GRID}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg }}>
          <div style={{ position: 'relative', width: '100%', paddingTop: '50%', background: C.placeholder }}>
            <span className="fp-skeleton" style={{ position: 'absolute', inset: 0, display: 'block', borderRadius: 0 }} />
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="90%" height={14} />
            <Skeleton width="60%" height={11} />
            <Skeleton width="70%" height={11} />
            <Skeleton width="50%" height={16} />
          </div>
        </div>
      ))}
    </div>
  );
}

// 상세(list) 데스크톱 — LIST_GRID(1~3열) + WebRow(88썸네일·fp-card).
function RowListSkeleton({ count }: { count: number }) {
  return (
    <div role="status" aria-label="불러오는 중" style={LIST_GRID}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'stretch', borderRadius: R, padding: '10px 12px', border: `1px solid ${C.line}`, boxShadow: SH.cardRest, background: C.taupeBg }}>
          <Skeleton width={88} height={88} radius={R} style={{ flex: '0 0 88px' }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            <Skeleton width="70%" height={15} />
            <Skeleton width="52%" height={12} />
            <Skeleton width="60%" height={12} />
            <Skeleton width="44%" height={15} />
          </div>
        </div>
      ))}
    </div>
  );
}

// 모바일 피드 — MobileRow(56썸네일·fp-card-row·하단선) + taupeBg/상단선 컨테이너.
function MobileFeedSkeleton({ count }: { count: number }) {
  return (
    <div role="status" aria-label="불러오는 중" style={MOBILE_FEED_WRAP}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'stretch', padding: '10px 12px', borderBottom: `1px solid ${C.line2}` }}>
          <Skeleton width={56} height={56} radius={R} style={{ flex: '0 0 56px' }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, justifyContent: 'center' }}>
            <Skeleton width="80%" height={14} />
            <Skeleton width="55%" height={11} />
            <Skeleton width="68%" height={13} />
            <Skeleton width="40%" height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}
