'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  priceList, creditDisplay, vehicleTone, excelCondSignals, canonProductType,
} from '@/lib/domain/product';
import { fuelDisplay, yearDisplay, makerDisplay } from '@/lib/domain/vehicle-master-match';
import { productOptions, OptionChips } from '@/components/product-card-atoms';
import {
  C, NUM, FW, FS, Badge, CountPill, productTypeStyle, CREDIT_TONE,
  thX, thXR, tdX, tdXR, colLock, colLockChars, colChars, colOpts, clipN,
  EXCEL_W, EXCEL_MAX, EXCEL_CELL_BODY_H, EXCEL_BADGE_GAP_X, EXCEL_OPT_ROW_GAP,
  excelPriceW, excelPadX, excelPadY, excelColMode, excelShowFilterCols,
  excelMakerChars, excelSubChars, excelNameChars, excelColorChars, excelFuelChars,
  excelModelWidth, excelFitPlan,
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
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetW, setSheetW] = useState(0);
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

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width || 0;
      setSheetW((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    });
    ro.observe(el);
    setSheetW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(
    () => excelFitPlan({ availPx: sheetW, mode: exMode, months, hasOpts }),
    [sheetW, exMode, months, hasOpts],
  );
  const show = (field: string) => fit.show.has(field);
  const visMonths = fit.months;
  const showProv = exFilterCols && show('provider_name');
  const showCredit = exFilterCols && show('credit');
  const showCond = exFilterCols && show('cond');

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
          ...(filtered ? { overflow: 'visible' } : null),
        }}
        title={n > 0 ? `${label} 필터 · ${n}개` : `${label} 필터`}
      >
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
    <div ref={sheetRef} className={`fp-excel-sheet${!mobile ? ' is-fit' : ''}`}>
      {/* 웹: 기본(필터열림)·전체(필터닫힘) 모두 is-fit. 열·짧은 대여기간 축소로 가로스크롤 없음. */}
      <table className={`fp-excel-table is-${exMode}${hasOpts ? ' has-opts' : ' no-opts'}`} data-excel-mode={exMode}>
        <thead><tr>
          {hdrTh('car_number', '차량번호', { ...thX, ...cellPad, ...colLock(EXCEL_MAX.plate, padX) })}
          {show('vehicle_status') && hdrTh('vehicle_status', '상태', { ...thX, ...cellPad, ...colLock(EXCEL_W.status) })}
          {show('product_type') && hdrTh('product_type', '상품', { ...thX, ...cellPad, ...colLock(EXCEL_W.ptype) })}
          {show('maker') && hdrTh('maker', '제조사', { ...thX, ...cellPad, ...colLockChars(makerChars, true, padX) })}
          {show('model') && hdrTh('model', '모델', { ...thX, ...cellPad, ...(typeof modelW === 'number' ? colLockChars(modelW, true, padX) : colLock(modelW, padX)) })}
          {show('sub_model') && hdrTh('sub_model', '세부모델', { ...thX, ...cellPad, ...colChars(subChars, nameSqueeze, true, padX) })}
          {show('variant') && hdrTh('variant', '파워', { ...thX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) })}
          {show('trim_name') && hdrTh('trim_name', '트림', { ...thX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) })}
          {show('options') && hdrTh('options', '옵션', { ...thX, ...cellPad, ...colOpts(hasOpts, exMode) })}
          {show('ext_color') && hdrTh('ext_color', '외장', { ...thX, ...cellPad, ...colLockChars(colorChars, true, padX) })}
          {show('int_color') && hdrTh('int_color', '내장', { ...thX, ...cellPad, ...colLockChars(colorChars, true, padX) })}
          {show('year') && hdrTh('year', '연식', { ...thX, ...cellPad, ...colLock(EXCEL_MAX.year, padX) })}
          {show('mileage') && hdrTh('mileage', '주행', { ...thXR, ...cellPad, ...colLock(EXCEL_MAX.mile, padX) })}
          {show('fuel_type') && hdrTh('fuel_type', '연료', { ...thX, ...cellPad, ...colLockChars(fuelChars, true, padX) })}
          {showProv && hdrTh('provider_name', '공급사', { ...thX, ...cellPad, ...colLockChars(EXCEL_MAX.provider, true, padX) })}
          {showCredit && hdrTh('credit', '심사', { ...thX, ...cellPad, ...colLock(EXCEL_W.credit) })}
          {showCond && hdrTh('cond', '조건', { ...thX, ...cellPad, ...colLock(EXCEL_W.cond) })}
          {visMonths.map((m) => (
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
            {show('vehicle_status') && <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.status) }}>{st ? <Badge tone={vehicleTone(st)} variant={st === '계약중' ? 'solid' : 'line'} pulse={st === '계약중'}>{st}</Badge> : DASH}</td>}
            {show('product_type') && <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.ptype) }}>{pt ? (() => { const c = canonProductType(pt) || pt; const s = productTypeStyle(c); return <Badge tone={s.tone} variant={s.variant}>{c}</Badge>; })() : DASH}</td>}
            {show('maker') && <td style={{ ...tdX, ...cellPad, ...colLockChars(makerChars, true, padX) }}>{clipMax(makerDisplay(p.maker) || p.maker, makerChars)}</td>}
            {show('model') && <td style={{ ...tdX, ...cellPad, ...(typeof modelW === 'number' ? colLockChars(modelW, true, padX) : colLock(modelW, padX)) }}>{typeof modelW === 'number' ? clipMax(p.model, modelW) : clip(p.model)}</td>}
            {show('sub_model') && <td style={{ ...tdX, ...cellPad, ...colChars(subChars, nameSqueeze, true, padX) }}>{clipMax(p.sub_model, subChars)}</td>}
            {show('variant') && <td style={{ ...tdX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) }}>{clipMax(p.variant, nameChars)}</td>}
            {show('trim_name') && <td style={{ ...tdX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) }}>{clipMax(p.trim_name, nameChars)}</td>}
            {show('options') && (
              <td style={{ ...tdX, ...cellPad, ...colOpts(hasOpts, exMode), whiteSpace: 'normal', verticalAlign: 'middle', overflow: 'hidden' }} title={opts.join(' · ') || undefined}>
                {opts.length ? <OptionChips p={p} lines={2} /> : DASH}
              </td>
            )}
            {show('ext_color') && <td style={{ ...tdX, ...cellPad, ...colLockChars(colorChars, true, padX) }}>{clipMax(p.ext_color, colorChars)}</td>}
            {show('int_color') && <td style={{ ...tdX, ...cellPad, ...colLockChars(colorChars, true, padX) }}>{clipMax(p.int_color, colorChars)}</td>}
            {show('year') && <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_MAX.year, padX) }}>{yearDisplay(p.year) || DASH}</td>}
            {show('mileage') && <td style={{ ...tdXR, ...cellPad, ...colLock(EXCEL_MAX.mile, padX) }}>{kmDisplay(p.mileage) || DASH}</td>}
            {show('fuel_type') && <td style={{ ...tdX, ...cellPad, ...colLockChars(fuelChars, true, padX) }}>{fuel ? clipMax(fuel, fuelChars) : DASH}</td>}
            {showProv && <td style={{ ...tdX, ...cellPad, ...colLockChars(EXCEL_MAX.provider, true, padX) }}>{clipMax(p.provider_name || p.provider_company_code, EXCEL_MAX.provider)}</td>}
            {showCredit && <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.credit) }}>{(() => { const c = creditDisplay(p); return c ? <Badge tone={CREDIT_TONE(c)}>{c}</Badge> : DASH; })()}</td>}
            {showCond && (
            <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.cond), whiteSpace: 'normal', overflow: 'hidden' }}>
              {conds.length ? (
                <span style={{
                  display: 'flex', flexWrap: 'wrap',
                  columnGap: EXCEL_BADGE_GAP_X, rowGap: EXCEL_OPT_ROW_GAP,
                  alignItems: 'center', alignContent: 'flex-start',
                  width: '100%', minWidth: 0,
                  maxHeight: EXCEL_CELL_BODY_H, overflow: 'hidden',
                }}>
                  {conds.map((c) => {
                    const tone: BadgeTone = c.key === 'age' ? 'blue' : 'purple';
                    return (
                      <span key={c.key} style={{ flex: '0 0 auto', display: 'inline-flex', maxWidth: '100%' }}>
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
            {visMonths.map((m) => { const e = pl.find((x) => x.m === m); return (
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
