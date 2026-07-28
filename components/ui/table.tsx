'use client';
import React from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, R, NUM, FW, FS } from './tokens';

/* 표 — 기업형 데이터 그리드 SSOT.
 * 스크롤·틀고정 = globals.css `.fp-sheet` / `.fp-sheet--pane`.
 * · th = sticky top (단일 스크롤포트용)
 * · thFlat = 틀분리 헤더(세로 sticky 없음 — 스크롤바는 body만)
 * · thPin / tdPin = sticky left. thPinR / tdPinR·pinRight = sticky right.
 * · colW(px) = 칸 폭. fit(기본)=페이지에 맞춤 · tight=고정.
 */
export const th: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontSize: FS.cap, color: C.mute, fontWeight: FW.strong,
  background: C.head, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 2,
};
/** 틀분리(.fp-sheet--pane) 헤더 — 세로 고정은 레이아웃, sticky top 불필요. */
export const thFlat: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontSize: FS.cap, color: C.mute, fontWeight: FW.strong,
  background: C.head, whiteSpace: 'nowrap',
};
export const thR: React.CSSProperties = { ...th, textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums' };
export const thFlatR: React.CSSProperties = { ...thFlat, textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums' };
export const thPin: React.CSSProperties = { ...th, left: 0, zIndex: 4, boxShadow: `1px 0 0 ${C.line}` };
export const thFlatPin: React.CSSProperties = { ...thFlat, position: 'sticky', left: 0, zIndex: 4, boxShadow: `1px 0 0 ${C.line}` };
export const thPinR: React.CSSProperties = { ...th, right: 0, zIndex: 4 };
export const td: React.CSSProperties = { padding: '5px 10px', fontSize: FS.sub, whiteSpace: 'nowrap', color: C.ink };
export const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: NUM, fontWeight: FW.strong };
export const tdPin: React.CSSProperties = { ...td, position: 'sticky', left: 0, zIndex: 1, boxShadow: `1px 0 0 ${C.line}` };
export const tdPinR: React.CSSProperties = { ...td, position: 'sticky', right: 0, zIndex: 1 };

/** 엑셀 행 높이 SSOT — 옵션 2줄·조건 뱃지 2줄 중 큰 쪽.
 * 필터 열림(조건열 숨김) / 닫힘(조건열 표시) 모두 동일 행고 → 상하간격 점프 금지.
 * td height는 테이블에서 min처럼 늘어나므로 maxHeight+overflow로 잠금. */
const EXCEL_OPT_LINE = 18;
const EXCEL_OPT_GAP = 3;
const EXCEL_OPT_2H = EXCEL_OPT_LINE * 2 + EXCEL_OPT_GAP; // 39
const EXCEL_BADGE_H = 20; // Badge 웹 기본
/** 엑셀 뱃지↔뱃지(조건·칩) — 박스 바깥 간격(텍스트 간격 아님). */
const EXCEL_BADGE_GAP = 5;
const EXCEL_COND_2H = EXCEL_BADGE_H * 2 + EXCEL_BADGE_GAP; // 45
const EXCEL_BODY_H = Math.max(EXCEL_OPT_2H, EXCEL_COND_2H); // 45
const EXCEL_PAD_Y = 5;
const EXCEL_PAD_X = 6;
/** filter(사이드 열림) — 칸 좌우 패딩만 양보(글자수·항목 구성은 유지). */
const EXCEL_PAD_X_FILTER = 4;
const EXCEL_ROW_H = EXCEL_PAD_Y * 2 + EXCEL_BODY_H; // 55

export type ExcelColMode = 'filter' | 'full';
export function excelPadX(mode: ExcelColMode = 'full'): number {
  return mode === 'filter' ? EXCEL_PAD_X_FILTER : EXCEL_PAD_X;
}
export function excelPadY(): number {
  return EXCEL_PAD_Y;
}

/** 엑셀 — 헤더·본문 12. 본문 상하 = 옵션/조건 2줄 기준(고정). */
export const thX: React.CSSProperties = {
  ...thFlat, padding: `${EXCEL_PAD_Y}px ${EXCEL_PAD_X}px`, fontSize: FS.sub,
  position: 'sticky', top: 0, zIndex: 2,
  borderBottom: `1px solid ${C.line}`,
};
export const thXR: React.CSSProperties = { ...thX, textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums' };
export const thXPin: React.CSSProperties = { ...thX, left: 0, zIndex: 5, boxShadow: `1px 0 0 ${C.line}` };
export const tdX: React.CSSProperties = {
  ...td, padding: `${EXCEL_PAD_Y}px ${EXCEL_PAD_X}px`, fontSize: FS.sub,
  verticalAlign: 'middle', height: EXCEL_ROW_H, maxHeight: EXCEL_ROW_H,
  boxSizing: 'border-box', overflow: 'hidden',
};
export const tdXR: React.CSSProperties = { ...tdX, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: NUM, fontWeight: FW.strong };
export const tdXPin: React.CSSProperties = { ...tdX, position: 'sticky', left: 0, zIndex: 1, boxShadow: `1px 0 0 ${C.line}` };

/** 엑셀 OptionChips lines=2 박스 높이. 행 본문칸(EXCEL_BODY_H) 안에 들어감. */
export const EXCEL_OPT_BOX_H = EXCEL_OPT_2H;
export const EXCEL_OPT_CHIP_H = EXCEL_OPT_LINE;
export const EXCEL_OPT_ROW_GAP = EXCEL_OPT_GAP;
/** 엑셀 뱃지·칩 박스↔박스 가로 간격. */
export const EXCEL_BADGE_GAP_X = EXCEL_BADGE_GAP;
/** 엑셀 본문칸 내용 높이(패딩 제외) — 조건 뱃지 2줄 상한. */
export const EXCEL_CELL_BODY_H = EXCEL_BODY_H;

/** colW — fit(기본)=페이지 폭에 늘어남 · tight=고정(핀·뱃지·가격) · loose=상한만 */
export function colW(px: number, mode: 'tight' | 'loose' | 'fit' = 'fit'): React.CSSProperties {
  if (mode === 'loose') return { minWidth: px, maxWidth: Math.round(px * 1.35), boxSizing: 'border-box' };
  const base: React.CSSProperties = { width: px, minWidth: px, boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  if (mode === 'tight') return { ...base, maxWidth: px };
  return base;
}
/** 고정폭 칸 안 최대 2줄 — 옵션 등. 넘치면 … */
export const cellClamp2: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  whiteSpace: 'normal',
  wordBreak: 'keep-all',
  lineHeight: 1.35,
  fontWeight: FW.body,
};
/** 우측 틀고정 — i=0이 블록 왼쪽(선). head면 top도 sticky(본문 스크롤용).
 * colPxOrSample: px 숫자 또는 샘플문자열(sampleW와 동일 폭으로 right 누적).
 * zIndex는 오른쪽(끝)일수록 높게 — 인접 sticky 열이 1px이라도 겹치면 왼쪽 칸(1개월)이
 * 오른쪽 칸에 덮여 “세로 줄/내용 더 있음”처럼 보이는 걸 막는다(사이드바 열림·가로스크롤 시).
 * 구분선 = inset(overflow:hidden에 안 잘림). 바깥 -1px shadow는 fp-excel-price overflow에 잘림. */
export function pinRight(i: number, colPxOrSample: number | string, total: number, head = false): React.CSSProperties {
  const n = total - 1 - i;
  let right: number | string = 0;
  if (n > 0) {
    if (typeof colPxOrSample === 'number') {
      right = n * colPxOrSample;
    } else {
      const inner = sampleW(colPxOrSample).replace(/^calc\((.*)\)$/, '$1');
      right = `calc(${n} * (${inner}))`;
    }
  }
  const edge = i === 0;
  return {
    position: 'sticky',
    right,
    // head 기본 th z=2·좌측핀 z=5 위 · 본문 좌측핀 z=1과 맞춤 후 i로 상승
    zIndex: (head ? 6 : 2) + i,
    ...(head ? { top: 0 } : {}),
    ...(edge ? { boxShadow: `inset 1px 0 0 ${C.line}` } : {}),
  };
}

/**
 * 엑셀 열 모드 SSOT
 *
 *  · filter = 기본보기(사이드 필터 열림): 공급사·심사·조건 숨김 · 제조사 3자 · 패딩 양보(6→4).
 *    폭이 줄면 excelFitPlan으로 열·짧은 대여기간부터 숨김 → 가로스크롤 없음.
 *    차량번호·긴 기간 대여료가 끝까지 생존.
 *  · full = 전체보기(필터 닫힘): 공급사·심사·조건 표시 · 제조사 4자 · 패딩 6.
 *    브라우저 최대화에서도 가로스크롤 없음(넘치면 같은 fit로 맞춤).
 *
 * 공통 열(항상 동일 순서):
 *   차번 · 상태 · 상품 · 제조사 · 모델 · 세부모델 · 파워 · 트림 · 옵션 · 외장 · 내장 · 연식 · 주행 · 연료
 * full만 추가(대여료 직전): 공급사 · 심사 · 조건
 * 맨끝: 표준 대여료(EXCEL_PRICE_W)
 */
export function excelColMode(filterOpen: boolean): ExcelColMode {
  return filterOpen ? 'filter' : 'full';
}
export function excelShowFilterCols(mode: ExcelColMode): boolean {
  return mode === 'full';
}
/** 제조사 — filter 3 / full 4 */
export function excelMakerChars(mode: ExcelColMode): number {
  return mode === 'filter' ? EXCEL_MAX.makerSlim : EXCEL_MAX.maker;
}
/** 세부모델 — 모드 무관 10자(간격 양보로 맞춤). */
export function excelSubChars(_mode: ExcelColMode): number {
  return EXCEL_MAX.sub;
}
/** 파워·트림 — 모드 무관 10자. */
export function excelNameChars(_mode: ExcelColMode): number {
  return EXCEL_MAX.name;
}
/** 외장·내장 — 모드 무관 3자. */
export function excelColorChars(_mode: ExcelColMode): number {
  return EXCEL_MAX.color;
}
/** 연료 — 모드 무관 3자. */
export function excelFuelChars(_mode: ExcelColMode): number {
  return EXCEL_MAX.fuel;
}
/** 모델 — 옵션 있으면 slim. */
export function excelModelWidth(_mode: ExcelColMode, hasOpts: boolean): number | typeof EXCEL_MAX.model {
  return hasOpts ? EXCEL_MAX.modelSlim : EXCEL_MAX.model;
}

/**
 * 엑셀 열 규격 SSOT
 *  · tight = 표시 최대만큼만(절대 안 불어남) → 옵션에 폭 양보.
 *  · name  = 세부모델·파워·트림 10자. 옵션 있으면 tight.
 *  · opts  = 최소 확보 + 남는 폭 흡수(width 100%).
 */
export const EXCEL_MAX = {
  plate: '000가0000',
  maker: 4,
  makerSlim: 3,
  model: '펠리세이드',
  modelSlim: 6,
  sub: 10,
  name: 10,
  mile: '9.9만',
  fuel: 3,
  color: 3,
  provider: 3,
  year: '00년',
} as const;

const cellClip: React.CSSProperties = {
  boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

function sampleW(sample: string, padX: number = EXCEL_PAD_X): string {
  let em = 0;
  let ch = 0;
  for (const c of sample) {
    if (/[0-9A-Za-z.,\s]/.test(c)) ch += 1;
    else em += 1;
  }
  return `calc(${em}em + ${ch}ch + ${padX * 2}px)`;
}

function charsW(n: number, ellipsis = true, padX: number = EXCEL_PAD_X): string {
  return sampleW(`${'가'.repeat(n)}${ellipsis ? '…' : ''}`, padX);
}

/** 필수 고정칸 — 샘플/px 밖으로 안 줄고 안 늘음. 문자열 샘플만 padX 반영(px 뱃지폭은 그대로). */
export function colLock(pxOrSample: number | string, padX: number = EXCEL_PAD_X): React.CSSProperties {
  const w = typeof pxOrSample === 'number' ? pxOrSample : sampleW(pxOrSample, padX);
  return { width: w, minWidth: w, maxWidth: w, ...cellClip };
}

/** 필수 고정칸 — n글자(+…) 폭. */
export function colLockChars(n: number, ellipsis = true, padX: number = EXCEL_PAD_X): React.CSSProperties {
  return colLock(`${'가'.repeat(n)}${ellipsis ? '…' : ''}`, padX);
}

/**
 * 글자 최소칸 — 옵션이 밀어낼 대상(세부모델·파워·트림).
 * squeeze=true: min=max. squeeze=false: 최소만(옵션 없을 때 살짝 늘어날 수 있음).
 */
export function colChars(n: number, squeeze: boolean, ellipsis = true, padX: number = EXCEL_PAD_X): React.CSSProperties {
  const w = charsW(n, ellipsis, padX);
  return {
    width: w,
    minWidth: w,
    ...(squeeze ? { maxWidth: w } : null),
    ...cellClip,
  };
}

/** px 최소칸 — 뱃지 등. 항상 tight(옵션에 양보). */
export function colSoft(px: number, _squeeze?: boolean): React.CSSProperties {
  return colLock(px);
}

/**
 * 가변칸 — min 이하로 안 줄고, prefer로 초폭.
 * max 있으면 그 이상 안 늘어남(짧은 칸이 옵션 자리를 안 뺏음).
 * 옵션처럼 max 없으면 남는 폭을 흡수.
 */
export function colFlex(minPx: number, preferPx?: number, maxPx?: number): React.CSSProperties {
  const w = preferPx ?? minPx;
  return {
    width: w,
    minWidth: minPx,
    ...(maxPx != null ? { maxWidth: maxPx } : null),
    ...cellClip,
  };
}

/** @deprecated colLock 사용 */
export function colFit(sample: string): React.CSSProperties { return colLock(sample); }
/** @deprecated colLockChars 사용 */
export function colFitChars(n: number, ellipsis = false): React.CSSProperties {
  return colLockChars(n, ellipsis);
}

/** 최대 n글자, 넘치면 … */
export function clipN(raw: unknown, n: number): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const chars = [...s];
  if (chars.length <= n) return s;
  return `${chars.slice(0, n).join('')}…`;
}

/** 뱃지·가격 등 px 고정값 — 전부 tight. */
export const EXCEL_W = {
  /** 즉시출고 등 4글자 Badge — 잘림 없이, 옆 상품뱃지와 간격 과하지 않게 */
  status: 66,
  /** 중고렌트 등 4글자 상품 Badge — 58은 좁아 제조사에 붙었음(→ status와 맞춰 여유). */
  ptype: 70,
  /** 조건 — 뱃지 박스 2개 가로(+ gap). 3번째는 다음 줄(옵션칩 lines=2와 동일). 필터 닫힘(full)만 표시. */
  cond: 118,
  /** 소득확인(4글자) Badge — 48이면 칸에서 잘려 조건열로 밀림. status와 동일 여유. */
  credit: 66,
  /** 옵션칸 — 세부모델·파워·트림 10자 고정 양보. min 축소(구 240). */
  opts: { min: 160, prefer: 160, empty: 40 },
} as const;

/**
 * 대여료 열 폭 SSOT — 헤더(60개월)·본문(999만) 중 넓은 쪽에 딱맞춤.
 * filter는 패딩 양보분만 폭에서 차감(글자 샘플 동일).
 */
export const EXCEL_PRICE_MAX = '999만';
export const EXCEL_PRICE_COL = '60개월';
function sampleWPx(sample: string, padX: number = EXCEL_PAD_X): number {
  let em = 0;
  let ch = 0;
  for (const c of sample) {
    if (/[0-9A-Za-z.,\s]/.test(c)) ch += 1;
    else em += 1;
  }
  return Math.round(em * FS.sub + ch * FS.sub * 0.6 + padX * 2);
}
/** 대여료 열 고정폭(px) — full 기준. */
export const EXCEL_PRICE_W = Math.max(sampleWPx(EXCEL_PRICE_COL), sampleWPx(EXCEL_PRICE_MAX));
export function excelPriceW(mode: ExcelColMode): number {
  return Math.max(sampleWPx(EXCEL_PRICE_COL, excelPadX(mode)), sampleWPx(EXCEL_PRICE_MAX, excelPadX(mode)));
}

/** 메타 열 탈락 순서 — 차번·대여료는 여기 없음. full은 공급사·심사·조건부터. */
const EXCEL_FIT_DROP_FILTER: readonly string[] = [
  'options', 'variant', 'trim_name', 'sub_model',
  'ext_color', 'int_color', 'fuel_type', 'year', 'mileage',
  'maker', 'model', 'product_type', 'vehicle_status',
];
const EXCEL_FIT_DROP_FULL: readonly string[] = [
  'cond', 'credit', 'provider_name',
  ...EXCEL_FIT_DROP_FILTER,
];

export type ExcelFitPlan = {
  /** 표시할 메타 필드(차량번호 제외 — 항상 표시) */
  show: Set<string>;
  /** 표시할 대여 개월(오름차순 유지, 짧은 기간부터 탈락) */
  months: number[];
};

function excelMetaColPx(field: string, mode: ExcelColMode, hasOpts: boolean): number {
  const pad = excelPadX(mode);
  switch (field) {
    case 'vehicle_status': return EXCEL_W.status;
    case 'product_type': return EXCEL_W.ptype;
    case 'maker': return sampleWPx(`${'가'.repeat(excelMakerChars(mode))}…`, pad);
    case 'model': {
      const mw = excelModelWidth(mode, hasOpts);
      return typeof mw === 'number' ? sampleWPx(`${'가'.repeat(mw)}…`, pad) : sampleWPx(String(mw), pad);
    }
    case 'sub_model': return sampleWPx(`${'가'.repeat(excelSubChars(mode))}…`, pad);
    case 'variant':
    case 'trim_name': return sampleWPx(`${'가'.repeat(excelNameChars(mode))}…`, pad);
    case 'options': return hasOpts
      ? (mode === 'filter' ? EXCEL_W.opts.empty : EXCEL_W.opts.min)
      : EXCEL_W.opts.empty;
    case 'ext_color':
    case 'int_color': return sampleWPx(`${'가'.repeat(excelColorChars(mode))}…`, pad);
    case 'year': return sampleWPx(EXCEL_MAX.year, pad);
    case 'mileage': return sampleWPx(EXCEL_MAX.mile, pad);
    case 'fuel_type': return sampleWPx(`${'가'.repeat(excelFuelChars(mode))}…`, pad);
    case 'provider_name': return sampleWPx(`${'가'.repeat(EXCEL_MAX.provider)}…`, pad);
    case 'credit': return EXCEL_W.credit;
    case 'cond': return EXCEL_W.cond;
    default: return 40;
  }
}

/**
 * 뷰포트 폭에 맞춰 엑셀 열 축소 계획.
 * · filter(기본보기): 창이 줄면 열·짧은 대여기간부터 숨김.
 * · full(전체보기): 최대화에서도 가로스크롤 없이 맞춤(넘칠 때만 동일 규칙).
 * 차량번호 + 대여료(긴 기간 우선) 유지. availPx≤0이면 전부 표시(측정 전).
 */
export function excelFitPlan(opts: {
  availPx: number;
  mode: ExcelColMode;
  months: number[];
  hasOpts: boolean;
}): ExcelFitPlan {
  const { mode, hasOpts } = opts;
  const allMonths = [...opts.months].sort((a, b) => a - b);
  const baseMeta = [
    'vehicle_status', 'product_type', 'maker', 'model',
    'sub_model', 'variant', 'trim_name', 'options',
    'ext_color', 'int_color', 'year', 'mileage', 'fuel_type',
    ...(mode === 'full' ? ['provider_name', 'credit', 'cond'] : []),
  ];
  let meta = [...baseMeta];
  let months = [...allMonths];
  if (!(opts.availPx > 0)) return { show: new Set(meta), months };

  const pad = excelPadX(mode);
  const platePx = sampleWPx(EXCEL_MAX.plate, pad);
  const pricePx = excelPriceW(mode);
  // sampleWPx ↔ CSS calc 오차·보더·scrollbar-gutter
  const slack = 24;
  const dropOrder = mode === 'full' ? EXCEL_FIT_DROP_FULL : EXCEL_FIT_DROP_FILTER;

  const total = () =>
    platePx
    + meta.reduce((s, f) => s + excelMetaColPx(f, mode, hasOpts), 0)
    + months.length * pricePx
    + slack;

  // 1) 메타 열 탈락(드롭 순서)
  for (const field of dropOrder) {
    if (total() <= opts.availPx) break;
    if (!meta.includes(field)) continue;
    meta = meta.filter((f) => f !== field);
  }
  // 2) 짧은 대여 기간부터 탈락(긴 기간 생존). 최소 1열은 남김.
  while (months.length > 1 && total() > opts.availPx) {
    months = months.slice(1);
  }
  // 3) 그래도 넘치면 메타를 차번만 남기고 재시도(대여 1열 유지)
  if (total() > opts.availPx) {
    meta = [];
    while (months.length > 1 && platePx + months.length * pricePx + slack > opts.availPx) {
      months = months.slice(1);
    }
  }
  return { show: new Set(meta), months };
}

/**
 * 옵션칸 — 있으면 min 확보 + width:100%로 남는 폭 흡수.
 *  · full = 160(EXCEL_W.opts.min)
 *  · filter = empty(40) — 사이드 열림 웹에서 표가 뷰포트에 들어가게(가로스크롤 금지).
 * 없으면 좁게 잠금(다른 칸이 키울 여지).
 */
export function colOpts(hasOpts: boolean, mode: ExcelColMode = 'full'): React.CSSProperties {
  if (hasOpts) {
    const min = mode === 'filter' ? EXCEL_W.opts.empty : EXCEL_W.opts.min;
    return {
      width: '100%',
      minWidth: min,
      ...cellClip,
      overflow: 'hidden',
    };
  }
  const w = EXCEL_W.opts.empty;
  return { width: w, minWidth: w, maxWidth: w, ...cellClip };
}

/** @deprecated colChars / colSoft 사용 */
export function colFlexW(s: { readonly min: number; readonly prefer: number; readonly max?: number }): React.CSSProperties {
  return colFlex(s.min, s.prefer, s.max);
}

export type Col<T> = { key: string; label: string; align?: 'l' | 'r'; pin?: boolean; render: (row: T) => React.ReactNode };
/* 데이터 그리드 — 단일클릭=행 선택, 더블클릭=상세(onRow). 엑셀/ERP 관례. */
export function DataTable<T>({ cols, rows, onRow }: { cols: Col<T>[]; rows: T[]; onRow?: (row: T) => void }) {
  const [sel, setSel] = React.useState(-1);
  const mobile = useIsMobile();
  const bgOf = (i: number) => (sel === i ? C.selected : i % 2 ? C.zebra : C.taupeBg);
  // 좁은 화면 = 같은 객체를 카드로(엑셀 표 대신). 필드 정의(cols)는 동일 SSOT.
  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {rows.map((r, i) => (
          <div key={i} onClick={() => onRow && onRow(r)} tabIndex={onRow ? 0 : -1}
            onKeyDown={(e) => { if (onRow && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRow(r); } }}
            style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '10px 12px', cursor: onRow ? 'pointer' : 'default', outline: 'none' }}>
            <div style={{ fontSize: FS.body, fontWeight: FW.head }}>{cols[0]?.render(r)}</div>
            {cols.slice(1).map((c) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: FS.sub, borderTop: `1px solid ${C.line2}`, marginTop: 3 }}>
                <span style={{ color: C.mute, flex: '0 0 auto' }}>{c.label}</span>
                <span style={{ textAlign: 'right', minWidth: 0, overflow: 'hidden' }}>{c.render(r)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="fp-sheet" style={{ marginTop: 10 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: FS.sub, width: '100%' }}>
        <thead><tr>{cols.map((c) => {
          const base = c.align === 'r' ? thR : th;
          return <th key={c.key} style={c.pin ? { ...base, ...thPin } : base}>{c.label}</th>;
        })}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}
              onClick={() => { setSel(i); if (onRow) onRow(r); }}
              onKeyDown={(e) => { if (onRow && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRow(r); } }}
              tabIndex={onRow ? 0 : -1} role={onRow ? 'button' : undefined}
              style={{ borderTop: `1px solid ${C.line2}`, cursor: onRow ? 'pointer' : 'default', background: bgOf(i), userSelect: 'none', outline: 'none' }}
              onMouseEnter={(e) => { if (sel !== i) e.currentTarget.style.background = C.hover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = bgOf(i); }}>
              {cols.map((c) => {
                const base = c.align === 'r' ? tdR : td;
                return <td key={c.key} style={c.pin ? { ...base, ...tdPin, background: bgOf(i) } : base}>{c.render(r)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
