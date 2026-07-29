'use client';

import type { Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import type { ColSort } from './excel-columns';
import { ProductCard } from '@/components/ProductCard';
import { ProductRowCard } from '@/components/ProductRowCard';
import { Btn, C, CenterNote, FS } from '@/components/ui';
import { isGuest } from '@/lib/auth-session';
import { ExcelResultsTable } from './ExcelResultsTable';

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
};

export function FinderResults(props: Props) {
  return (
    <div
      ref={props.bodyRef}
      className={`fp-finder-body ${props.view === 'excel' ? 'is-excel' : ''}`}
      style={props.pending ? { opacity: 0.55, transition: 'opacity .15s ease', pointerEvents: 'none' } : { transition: 'opacity .15s ease' }}
    >
      {props.list.length === 0 ? (
        <CenterNote>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>{(props.rows?.length ?? 0) === 0 ? '표시할 상품이 없습니다' : '조건에 맞는 상품이 없습니다'}</span>
            {props.narrowed && <Btn title="조건 해제" size="sm" variant="ghost" onClick={props.onReset}>조건 해제</Btn>}
            {(props.rows?.length ?? 0) === 0 && isGuest() && <Btn title="로그인" size="sm" href="/login">로그인</Btn>}
          </div>
        </CenterNote>
      ) : props.view === 'card' ? (
        props.mobile ? (
          <div style={{ background: C.taupeBg, borderTop: `1px solid ${C.line2}` }}>
            {props.shown.map((product) => <ProductRowCard key={String(product.product_code || product._key)} p={product} focusMonth={props.focusMonth} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {props.shown.map((product) => (
              <div key={String(product.product_code || product._key)} onContextMenu={(event) => props.onProductContext(event, product)}>
                <ProductCard p={product} focusMonth={props.focusMonth} />
              </div>
            ))}
          </div>
        )
      ) : props.view === 'list' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 520px), 1fr))', gap: 6 }}>
          {props.shown.map((product) => (
            <div key={String(product.product_code || product._key)} onContextMenu={(event) => props.onProductContext(event, product)}>
              <ProductRowCard p={product} focusMonth={props.focusMonth} />
            </div>
          ))}
        </div>
      ) : (
        <ExcelResultsTable
          rows={props.shown}
          list={props.list}
          months={props.months}
          filterOpen={props.filterOpen}
          colFilter={props.colFilter}
          setColFilter={props.setColFilter}
          colSort={props.colSort}
          setColSort={props.setColSort}
          openCol={props.openCol}
          setOpenCol={props.setOpenCol}
          onRowClick={props.onOpenProduct}
          onRowContextMenu={props.onProductContext}
        />
      )}
      {props.moreCount > 0 && (
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
