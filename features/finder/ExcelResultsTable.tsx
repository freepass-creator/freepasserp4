'use client';

import { useMemo, type CSSProperties, type MouseEvent } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  priceList, creditDisplay, vehicleTone, excelCondSignals, canonProductType,
} from '@/lib/domain/product';
import { fuelDisplay, yearDisplay, makerDisplay } from '@/lib/domain/vehicle-master-match';
import { productOptions, OptionChips } from '@/components/product-card-atoms';
import {
  C, NUM, FW, FS, Badge, CountPill, productTypeStyle, CREDIT_TONE,
  thX, thXR, tdX, tdXR, colLock, colLockChars, colChars, colOpts, clipN,
  EXCEL_W, EXCEL_MAX, EXCEL_CELL_BODY_H, EXCEL_BADGE_GAP_X,
  excelPriceW, excelPadX, excelPadY, excelColMode, excelShowFilterCols,
  excelMakerChars, excelSubChars, excelNameChars, excelColorChars, excelFuelChars,
  excelModelWidth,
} from '@/components/ui';
import type { BadgeTone } from '@/components/ui/badges';
import { man, kmDisplay } from '@/lib/format';
import { useIsMobile } from '@/lib/use-mobile';
import {
  excelColumnMatches,
  isNumericExcelColumn,
  type ColSort,
} from './excel-columns';
import { ExcelFilterPopover } from './ExcelFilterPopover';

const DASH = <span style={{ color: C.faint }}>—</span>;

export type ExcelOpenCol = { field: string; x: number; y: number } | null;

type Props = {
  /** 사이드 필터 적용 후 · 엑셀 헤더 필터·정렬까지 반영된 행 */
  rows: EntityRecord[];
  /** 팝오버 후보 집계용 — 사이드 matchProduct 결과(헤더 필터 전) */
  list: EntityRecord[];
  months: number[];
  filterOpen: boolean;
  colFilter: Record<string, Set<string>>;
  setColFilter: (filter: Record<string, Set<string>>) => void;
  colSort: ColSort;
  setColSort: (sort: ColSort) => void;
  openCol: ExcelOpenCol;
  setOpenCol: (col: ExcelOpenCol) => void;
  onRowClick: (product: EntityRecord) => void;
  onRowContextMenu: (e: MouseEvent, product: EntityRecord) => void;
};

export function ExcelResultsTable({
  rows, list, months, filterOpen,
  colFilter, setColFilter, colSort, setColSort,
  openCol, setOpenCol, onRowClick, onRowContextMenu,
}: Props) {
  const mobile = useIsMobile();
  const hasOpts = useMemo(() => rows.some((p) => productOptions(p).length > 0), [rows]);
  const exMode = excelColMode(filterOpen);
  const exFilterCols = excelShowFilterCols(exMode);
  const makerChars = excelMakerChars(exMode);
  const subChars = excelSubChars(exMode);
  const nameChars = excelNameChars(exMode);
  const colorChars = excelColorChars(exMode);
  const fuelChars = excelFuelChars(exMode);
  const modelW = excelModelWidth(exMode, hasOpts);
  const priceW = excelPriceW(exMode);
  const padX = excelPadX(exMode);
  const cellPad = { padding: `${excelPadY()}px ${padX}px` } as const;
  const nameSqueeze = hasOpts;

  /** 엑셀 헤더 칸 전체 클릭 = 필터 팝(텍스트만이 아니라 th 영역). */
  const hdrTh = (field: string, label: string, style: CSSProperties, className?: string) => {
    const n = colFilter[field]?.size || 0;
    const filtered = n > 0;
    const sorted = !!colSort && colSort.field === field && isNumericExcelColumn(field);
    const on = filtered || sorted;
    const cls = [className, filtered ? 'fp-excel-hdr-on' : ''].filter(Boolean).join(' ') || undefined;
    return (
      <th
        key={field}
        className={cls}
        onClick={(e) => {
          e.stopPropagation();
          const rc = e.currentTarget.getBoundingClientRect();
          setOpenCol(openCol?.field === field ? null : { field, x: rc.left, y: rc.bottom });
        }}
        style={{
          ...style,
          cursor: 'pointer',
          color: on ? C.brand : style.color,
          userSelect: 'none',
          // colLock overflow:hidden 이 뱃지를 잘라먹음 → 필터 활성 시 풀어줌
          ...(filtered ? { overflow: 'visible' } : null),
        }}
        title={n > 0 ? `${label} 필터 · ${n}개` : `${label} 필터`}
      >
        {/* 뱃지 = 라벨 끝 우측 상단에 살짝만 걸침(텍스트 침범 최소) */}
        <span style={{ position: 'relative', display: 'inline-block', fontWeight: FW.strong }}>
          {label}
          {sorted && <span style={{ fontSize: FS.micro }}>{colSort!.dir === 'asc' ? '↑' : '↓'}</span>}
          {n > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -6,
                left: '100%',
                marginLeft: -3,
                pointerEvents: 'none',
                zIndex: 2,
                lineHeight: 0,
              }}
            >
              <CountPill n={n} tone="accent" />
            </span>
          )}
        </span>
      </th>
    );
  };

  return (
    <div className={`fp-excel-sheet${exMode === 'filter' && !mobile ? ' is-fit' : ''}`}>
      {/* 엑셀 전용 스크롤포트 — 헤더 sticky · 가로·세로 시트가 담당. 웹+filter=가로맞춤(is-fit). */}
      <table className={`fp-excel-table is-${exMode}${hasOpts ? ' has-opts' : ' no-opts'}`} data-excel-mode={exMode}>
        <thead><tr>
          {/* 공통 열 — 모드와 무관 동일 순서·폭(연식·주행·연료가 필터 토글에 안 밀림). 칸 전체 클릭=필터. */}
          {hdrTh('car_number', '차량번호', { ...thX, ...cellPad, ...colLock(EXCEL_MAX.plate, padX) })}
          {hdrTh('vehicle_status', '상태', { ...thX, ...cellPad, ...colLock(EXCEL_W.status) })}
          {hdrTh('product_type', '상품', { ...thX, ...cellPad, ...colLock(EXCEL_W.ptype) })}
          {hdrTh('maker', '제조사', { ...thX, ...cellPad, ...colLockChars(makerChars, true, padX) })}
          {hdrTh('model', '모델', { ...thX, ...cellPad, ...(typeof modelW === 'number' ? colLockChars(modelW, true, padX) : colLock(modelW, padX)) })}
          {hdrTh('sub_model', '세부모델', { ...thX, ...cellPad, ...colChars(subChars, nameSqueeze, true, padX) })}
          {hdrTh('variant', '파워', { ...thX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) })}
          {hdrTh('trim_name', '트림', { ...thX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) })}
          {hdrTh('options', '옵션', { ...thX, ...cellPad, ...colOpts(hasOpts, exMode) })}
          {hdrTh('ext_color', '외장', { ...thX, ...cellPad, ...colLockChars(colorChars, true, padX) })}
          {hdrTh('int_color', '내장', { ...thX, ...cellPad, ...colLockChars(colorChars, true, padX) })}
          {hdrTh('year', '연식', { ...thX, ...cellPad, ...colLock(EXCEL_MAX.year, padX) })}
          {hdrTh('mileage', '주행', { ...thXR, ...cellPad, ...colLock(EXCEL_MAX.mile, padX) })}
          {hdrTh('fuel_type', '연료', { ...thX, ...cellPad, ...colLockChars(fuelChars, true, padX) })}
          {/* full만 — 대여료 직전. 필터 열림 시 숨김(사이드에서 선택). */}
          {exFilterCols && hdrTh('provider_name', '공급사', { ...thX, ...cellPad, ...colLockChars(EXCEL_MAX.provider, true, padX) })}
          {exFilterCols && hdrTh('credit', '심사', { ...thX, ...cellPad, ...colLock(EXCEL_W.credit) })}
          {exFilterCols && hdrTh('cond', '조건', { ...thX, ...cellPad, ...colLock(EXCEL_W.cond) })}
          {months.map((m) => (
            hdrTh(`price:${m}`, `${m}개월`, { ...thXR, ...cellPad, ...colLock(priceW) }, 'fp-excel-price')
          ))}
        </tr></thead>
        <tbody>{rows.map((p, i) => {
          const pl = priceList(p); const bg = i % 2 ? C.zebra : C.taupeBg;
          const st = String(p.vehicle_status || ''); const pt = String(p.product_type || '');
          const opts = productOptions(p);
          const fuel = fuelDisplay(p.fuel_type);
          const conds = excelCondSignals(p);
          const clip = (v: unknown) => {
            const s = String(v || '');
            if (!s) return DASH;
            return <span title={s} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>;
          };
          const clipMax = (v: unknown, n: number) => {
            const full = String(v || '').trim();
            if (!full) return DASH;
            const shown = clipN(full, n);
            return <span title={full !== shown ? full : undefined}>{shown}</span>;
          };
          return (
          <tr key={String(p.product_code || p._key || i)} className="fp-sheet-row" onClick={() => onRowClick(p)} onContextMenu={(e) => onRowContextMenu(e, p)} style={{ cursor: 'pointer', background: bg }}>
            <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_MAX.plate, padX), background: bg, fontFamily: NUM, fontWeight: FW.strong }} title={String(p.car_number || '') || undefined}>{String(p.car_number || '') || DASH}</td>
            <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.status) }}>{st ? <Badge tone={vehicleTone(st)} variant={st === '계약중' ? 'solid' : 'line'} pulse={st === '계약중'}>{st}</Badge> : DASH}</td>
            <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.ptype) }}>{pt ? (() => { const c = canonProductType(pt) || pt; const s = productTypeStyle(c); return <Badge tone={s.tone} variant={s.variant}>{c}</Badge>; })() : DASH}</td>
            <td style={{ ...tdX, ...cellPad, ...colLockChars(makerChars, true, padX) }}>{clipMax(makerDisplay(p.maker) || p.maker, makerChars)}</td>
            <td style={{ ...tdX, ...cellPad, ...(typeof modelW === 'number' ? colLockChars(modelW, true, padX) : colLock(modelW, padX)) }}>{typeof modelW === 'number' ? clipMax(p.model, modelW) : clip(p.model)}</td>
            <td style={{ ...tdX, ...cellPad, ...colChars(subChars, nameSqueeze, true, padX) }}>{clipMax(p.sub_model, subChars)}</td>
            <td style={{ ...tdX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) }}>{clipMax(p.variant, nameChars)}</td>
            <td style={{ ...tdX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) }}>{clipMax(p.trim_name, nameChars)}</td>
            <td style={{ ...tdX, ...cellPad, ...colOpts(hasOpts, exMode), whiteSpace: 'normal', verticalAlign: 'middle', overflow: 'hidden' }} title={opts.join(' · ') || undefined}>
              {opts.length ? <OptionChips p={p} lines={2} /> : DASH}
            </td>
            <td style={{ ...tdX, ...cellPad, ...colLockChars(colorChars, true, padX) }}>{clipMax(p.ext_color, colorChars)}</td>
            <td style={{ ...tdX, ...cellPad, ...colLockChars(colorChars, true, padX) }}>{clipMax(p.int_color, colorChars)}</td>
            <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_MAX.year, padX) }}>{yearDisplay(p.year) || DASH}</td>
            <td style={{ ...tdXR, ...cellPad, ...colLock(EXCEL_MAX.mile, padX) }}>{kmDisplay(p.mileage) || DASH}</td>
            <td style={{ ...tdX, ...cellPad, ...colLockChars(fuelChars, true, padX) }}>{fuel ? clipMax(fuel, fuelChars) : DASH}</td>
            {exFilterCols && <td style={{ ...tdX, ...cellPad, ...colLockChars(EXCEL_MAX.provider, true, padX) }}>{clipMax(p.provider_name || p.provider_company_code, EXCEL_MAX.provider)}</td>}
            {exFilterCols && <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.credit) }}>{(() => { const c = creditDisplay(p); return c ? <Badge tone={CREDIT_TONE(c)}>{c}</Badge> : DASH; })()}</td>}
            {exFilterCols && (
            <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.cond), whiteSpace: 'normal' }}>
              {conds.length ? (
                <span style={{
                  display: 'flex', flexWrap: 'wrap',
                  gap: EXCEL_BADGE_GAP_X, alignItems: 'center', alignContent: 'flex-start',
                  maxHeight: EXCEL_CELL_BODY_H, overflow: 'hidden',
                }}>
                  {conds.map((c) => {
                    const tone: BadgeTone = c.key === 'age' ? 'blue' : 'purple';
                    // 박스 단위 — shrink 금지(텍스트끼리 붙어 보이지 않게).
                    return (
                      <span key={c.key} style={{ flex: '0 0 auto', display: 'inline-flex' }}>
                        <Badge tone={tone} variant="line">{c.label}</Badge>
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span style={{ color: C.faint, fontSize: FS.sub }}>조건없음</span>
              )}
            </td>
            )}
            {months.map((m) => { const e = pl.find((x) => x.m === m); return (
              <td key={m} className="fp-excel-price" style={{ ...tdXR, ...cellPad, ...colLock(priceW), background: bg, lineHeight: 1.2 }}>
                    {e ? <><div style={{ color: C.brand, fontWeight: FW.head, whiteSpace: 'nowrap' }}>{man(e.rent)}</div><div style={{ color: C.faint, fontWeight: FW.body, whiteSpace: 'nowrap' }}>{e.deposit ? man(e.deposit) : '0'}</div></> : DASH}
              </td>
            ); })}
          </tr>
        ); })}</tbody>
      </table>
      {openCol && (() => {
        const f = openCol.field;
        const popRows = list.filter((p) =>
          Object.entries(colFilter).every(([k, set]) => k === f || excelColumnMatches(p, k, set)),
        );
        return (
          <ExcelFilterPopover
            field={f}
            x={openCol.x}
            y={openCol.y}
            rows={popRows}
            colFilter={colFilter}
            setColFilter={setColFilter}
            colSort={colSort}
            setColSort={setColSort}
            onClose={() => setOpenCol(null)}
          />
        );
      })()}
    </div>
  );
}
