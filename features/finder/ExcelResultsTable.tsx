'use client';

import { useMemo, useRef, type CSSProperties, type MouseEvent } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  priceList, creditDisplay, vehicleTone, excelCondSignals, canonProductType, perkEmptyLabel,
} from '@/lib/domain/product';
import { yearDisplay, makerDisplay } from '@/lib/domain/vehicle-master-match';
import { productOptions, OptionChips } from '@/components/product-card-atoms';
import { SignalMark } from '@/components/product-card-badge-view';
import { MetaIcon, benefitIcon, benefitIconColor } from '@/components/product-card-perks';
import {
  C, NUM, FW, FS, CountPill, productTypeStyle, CREDIT_TONE, ICON, type BadgeTone,
  thX, thXR, thXC, tdX, tdXR, tdXC, colLock, colLockChars, colChars, colOpts, clipN, cellClamp2,
  EXCEL_W, EXCEL_MAX,
  excelPriceW, excelPadX, excelPadY, excelColMode,
  excelMakerChars, excelSubChars, excelNameChars, excelColorChars,
} from '@/components/ui';
import { man, wonText } from '@/lib/format';
import { useIsMobile } from '@/lib/use-mobile';
import {
  excelColumnMatches,
  excelMileageDisplay,
  isNumericExcelColumn,
  type ColSort,
} from './excel-columns';
import { ExcelFilterPopover } from './ExcelFilterPopover';
import { isHiddenVehicleAxis } from '@/lib/domain/vehicle-detail-axes';

const DASH = <span style={{ color: C.faint }}>—</span>;

/** 표 칸 안 아이콘+글자 — 가운데 정렬 · 한 줄 고정(칸 폭은 EXCEL_W 가 잡는다). */
const excelMarkCell: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: '100%', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden',
};

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
  // 옵션열 유무·열폭은 페이지네이션된 rows(shown)가 아니라 전체 결과(list) 기준 — 더보기 눌러도 열 구성·폭 안 바뀜.
  const hasOpts = useMemo(() => list.some((p) => productOptions(p).length > 0), [list]);
  const exMode = excelColMode(filterOpen);
  const makerChars = excelMakerChars(exMode);
  const subChars = excelSubChars(exMode);
  const nameChars = excelNameChars(exMode);
  const colorChars = excelColorChars(exMode);
  const priceW = excelPriceW(exMode);
  const padX = excelPadX(exMode);
  const cellPad = { padding: `${excelPadY()}px ${padX}px` } as const;
  const nameSqueeze = hasOpts;

  // 측정은 페인트 후(useEffect) — layout effect로 앞당기면 열폭↔시트폭이 동기 되먹임(RO 재측정)으로
  // 진동하며 화면이 얼어붙는다. 진입 시 한 프레임 열 잔상은 감수(프리즈보다 나음).
  // 판매시트 정제 축과 같은 순서. 파워트레인은 폐지 축이라 화면에서도 쓰지 않는다.
  const show = (field: string) => !isHiddenVehicleAxis(field);
  const visMonths = [...months].sort((a, b) => a - b);
  // 공급사는 필터 패널을 연 상태에서도 상품 식별에 필요한 핵심 열이다.
  const showProv = show('provider_name');
  const showCredit = true;
  const showCond = true;

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
          {hdrTh('car_number', '차량번호', { ...thXC, ...cellPad, ...colLock(EXCEL_MAX.plate, padX) })}
          {show('vehicle_status') && hdrTh('vehicle_status', '상태', { ...thXC, ...cellPad, ...colLock(EXCEL_W.status) })}
          {show('product_type') && hdrTh('product_type', '상품', { ...thXC, ...cellPad, ...colLock(EXCEL_W.ptype) })}
          {show('maker') && hdrTh('maker', '제조사', { ...thX, ...cellPad, ...colLockChars(makerChars, true, padX) })}
          {show('model') && hdrTh('model', '모델', { ...thX, ...cellPad, ...colLockChars(makerChars, true, padX) })}
          {show('sub_model') && hdrTh('sub_model', '세부모델', { ...thX, ...cellPad, ...colChars(subChars, nameSqueeze, true, padX) })}
          {show('trim_name') && hdrTh('trim_name', '세부트림', { ...thX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) })}
          {show('ext_color') && hdrTh('ext_color', '외장', { ...thX, ...cellPad, ...colLockChars(colorChars, true, padX) })}
          {show('int_color') && hdrTh('int_color', '내장', { ...thX, ...cellPad, ...colLockChars(colorChars, true, padX) })}
          {show('year') && hdrTh('year', '연식', { ...thXC, ...cellPad, ...colLock(EXCEL_MAX.year, padX) })}
          {show('mileage') && hdrTh('mileage', '주행', { ...thXR, ...cellPad, ...colLock(EXCEL_MAX.mile, padX) })}
          {show('fuel_type') && hdrTh('fuel_type', '연료', { ...thX, ...cellPad, ...colLockChars(EXCEL_MAX.fuel, true, padX) })}
          {show('engine_cc') && hdrTh('engine_cc', '배기량', { ...thXR, ...cellPad, ...colLock('9,999cc', padX) })}
          {show('vehicle_class') && hdrTh('vehicle_class', '차종구분', { ...thX, ...cellPad, ...colLockChars(6, true, padX) })}
          {show('options') && hdrTh('options', '옵션', { ...thX, ...cellPad, ...colOpts(hasOpts, exMode) })}
          {showProv && hdrTh('provider_name', '공급사', { ...thX, ...cellPad, ...colLockChars(EXCEL_MAX.provider, true, padX) })}
          {showCredit && hdrTh('credit', '심사', { ...thXC, ...cellPad, ...colLock(EXCEL_W.credit) })}
          {showCond && hdrTh('cond', '조건', { ...thX, ...cellPad, ...colLock(EXCEL_W.cond) })}
          {visMonths.map((m) => (
            hdrTh(`price:${m}`, `${m}개월`, { ...thXR, ...cellPad, ...colLock(priceW) }, 'fp-excel-price')
          ))}
        </tr></thead>
        <tbody>{rows.map((p, i) => {
          const pl = priceList(p); const bg = i % 2 ? C.zebra : C.taupeBg;
          const st = String(p.vehicle_status || ''); const pt = String(p.product_type || '');
          const opts = productOptions(p);
          const conds = excelCondSignals(p);
          const clipMax = (v: unknown, n: number) => {
            const full = String(v || '').trim();
            if (!full) return DASH;
            const shown = clipN(full, n);
            return <span title={full !== shown ? full : undefined}>{shown}</span>;
          };
          const clamp2 = (v: unknown) => {
            const full = String(v || '').trim();
            return full ? <span style={cellClamp2} title={full}>{full}</span> : DASH;
          };
          return (
          <tr
            key={String(p.product_code || p._key || i)}
            className="fp-sheet-row"
            role="link"
            tabIndex={0}
            aria-label={`${String(p.car_number || '')} ${String(p.sub_model || p.model || '')} 상품 상세`}
            onClick={() => onRowClick(p)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onRowClick(p);
              }
            }}
            onContextMenu={(e) => onRowContextMenu(e, p)}
            style={{ cursor: 'pointer', background: bg }}
          >
            <td style={{ ...tdXC, ...cellPad, ...colLock(EXCEL_MAX.plate, padX), background: bg, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong }} title={String(p.car_number || '') || undefined}>{String(p.car_number || '') || DASH}</td>
            {/* ★차량상태·상품구분·심사 = 상자 아님. 카드·상세와 같은 아이콘+글자(사장님 2026-08-28 「모든 곳에서」).
                표라고 상자를 남기면 같은 값이 화면마다 두 문법으로 서서 눈이 매번 다시 맞춘다. */}
            {show('vehicle_status') && <td style={{ ...tdXC, ...cellPad, ...colLock(EXCEL_W.status) }}><span style={excelMarkCell}>{st ? <SignalMark signalKey="st" label={st} tone={vehicleTone(st) as BadgeTone} /> : DASH}</span></td>}
            {show('product_type') && <td style={{ ...tdXC, ...cellPad, ...colLock(EXCEL_W.ptype) }}><span style={excelMarkCell}>{pt ? (() => { const c = canonProductType(pt) || pt; return <SignalMark signalKey="pt" label={c} tone={productTypeStyle(c).tone} />; })() : DASH}</span></td>}
            {show('maker') && <td style={{ ...tdX, ...cellPad, ...colLockChars(makerChars, true, padX) }}>{clipMax(makerDisplay(p.maker) || p.maker, makerChars)}</td>}
            {show('model') && <td style={{ ...tdX, ...cellPad, ...colLockChars(makerChars, true, padX) }}>{clipMax(p.model, makerChars)}</td>}
            {show('sub_model') && <td style={{ ...tdX, ...cellPad, ...colChars(subChars, nameSqueeze, true, padX) }}>{clamp2(p.sub_model)}</td>}
            {show('trim_name') && <td style={{ ...tdX, ...cellPad, ...colChars(nameChars, nameSqueeze, true, padX) }}>{clamp2(p.trim_name)}</td>}
            {show('ext_color') && <td style={{ ...tdX, ...cellPad, ...colLockChars(colorChars, true, padX) }}>{clipMax(p.ext_color, colorChars)}</td>}
            {show('int_color') && <td style={{ ...tdX, ...cellPad, ...colLockChars(colorChars, true, padX) }}>{clipMax(p.int_color, colorChars)}</td>}
            {show('year') && <td style={{ ...tdXC, ...cellPad, ...colLock(EXCEL_MAX.year, padX), fontVariantNumeric: 'tabular-nums' }}>{yearDisplay(p.year) || DASH}</td>}
            {show('mileage') && <td style={{ ...tdXR, ...cellPad, ...colLock(EXCEL_MAX.mile, padX), fontVariantNumeric: 'tabular-nums' }}>{excelMileageDisplay(p.mileage) || DASH}</td>}
            {show('fuel_type') && <td style={{ ...tdX, ...cellPad, ...colLockChars(EXCEL_MAX.fuel, true, padX) }}>{clipMax(p.fuel_type, EXCEL_MAX.fuel)}</td>}
            {show('engine_cc') && <td style={{ ...tdXR, ...cellPad, ...colLock('9,999cc', padX), fontVariantNumeric: 'tabular-nums' }}>{clipMax(p.engine_cc, 7)}</td>}
            {show('vehicle_class') && <td style={{ ...tdX, ...cellPad, ...colLockChars(6, true, padX) }}>{clipMax(p.vehicle_class, 6)}</td>}
            {show('options') && (
              <td style={{ ...tdX, ...cellPad, ...colOpts(hasOpts, exMode), whiteSpace: 'normal', verticalAlign: 'middle', overflow: 'hidden' }} title={opts.join(' · ') || undefined}>
                {opts.length ? <OptionChips p={p} lines={2} /> : DASH}
              </td>
            )}
            {showProv && <td style={{ ...tdX, ...cellPad, ...colLockChars(EXCEL_MAX.provider, true, padX) }}>{clipMax(p.provider_name || p.provider_company_code, EXCEL_MAX.provider)}</td>}
            {showCredit && <td style={{ ...tdXC, ...cellPad, ...colLock(EXCEL_W.credit) }}><span style={excelMarkCell}>{(() => { const c = creditDisplay(p); return c ? <SignalMark signalKey="cd" label={c} tone={CREDIT_TONE(c)} /> : DASH; })()}</span></td>}
            {showCond && (
            <td style={{ ...tdX, ...cellPad, ...colLock(EXCEL_W.cond), whiteSpace: 'normal', overflow: 'hidden' }}>
              {/* 우대조건도 카드와 같은 손 — 아이콘에만 색, 글자는 먹색. 2줄까지. */}
              {conds.length ? (
                <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 8px', maxHeight: 40, overflow: 'hidden' }} title={conds.map((c) => c.label).join(' · ')}>
                  {conds.map((c) => (
                    <MetaIcon key={c.key} icon={benefitIcon(c.key)} text={c.label} size={ICON.sm} strong iconColor={benefitIconColor(c.key, c.label)} />
                  ))}
                </span>
              ) : (
                <span style={{ color: C.faint, fontSize: FS.sub }}>{perkEmptyLabel(p)}</span>
              )}
            </td>
            )}
            {visMonths.map((m) => { const e = pl.find((x) => x.m === m); return (
              <td key={m} className="fp-excel-price" style={{ ...tdXR, ...cellPad, ...colLock(priceW), background: bg, lineHeight: 1.2, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>
                    {/* 빈 칸도 값 칸과 같은 2줄 골격으로 — DASH만 홀로 놓으면 세로 가운데로 내려앉아
                        열을 세로로 훑을 때 첫 줄 기준선이 어긋난다. */}
                    {e
                      ? <><div style={{ color: C.brand, fontWeight: FW.head, whiteSpace: 'nowrap' }}>{wonText(e.rent)}</div><div style={{ color: C.faint, fontWeight: FW.body, whiteSpace: 'nowrap' }}>{man(e.deposit)}</div></>
                      : <><div style={{ color: C.faint, whiteSpace: 'nowrap' }}>{DASH}</div><div aria-hidden>&nbsp;</div></>}
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
