/**
 * **영업자 판매시트 서식 — 한 곳에서만 정한다.**
 *
 * ★왜 모듈로 뺐나(2026-08-14)
 *   발행기가 둘(ERP 경유·공급사시트 직행)이 되면서 서식이 갈릴 자리가 생겼다.
 *   영업자는 탭을 오가며 보는데 글꼴·색이 다르면 다른 문서로 읽는다.
 *   ⚠ 색을 새로 «디자인»하지 마라. 아래 값은 영업자가 쓰던 옛 「종합」 탭에서 **잰 것**이다.
 *
 * ★색은 배경이 아니라 **글자**에 준다. 바탕은 전부 흰색, 줄무늬 없음(사장님 확정 2026-08-13).
 * ★서식은 **시트 끝까지** 깐다 — 쓴 범위까지만 씌우면 아래 빈 줄에 손으로 적었을 때 글꼴이 딴판이 된다.
 */

/**
 * 글꼴 — 로보토(사장님 2026-08-14 「로보토?? 이거 가독성 좋은 거 같은데」).
 * ⚠ 로보토엔 한글 자소가 없다 — 한글은 구글이 알아서 대체 글꼴로 그린다.
 *   숫자·영문만 로보토로 나오는데, 표가 온통 숫자라 오히려 자릿수가 또렷해진다.
 */
/**
 * 글꼴 — **Roboto**(사장님 2026-08-18 재확정 — 「모든 구글시트 Roboto 로 통일, 그게 글씨가 제일 잘 보이네」).
 *   공급사 제공시트는 처음부터 Roboto 였고(`supplier-template-sheet.FONT`), 판매시트·원천대장도 같은 글꼴로 맞춘다.
 *   적용 도구 `scripts/apply-font-all-sheets.mts`(글꼴만 바꾸고 크기·굵기·색은 그대로).
 *
 * (아래는 2026-08-14 에 Noto Sans KR 을 골랐던 이유 — 기록으로 남긴다)
 * 글꼴 — Noto Sans KR(사장님 2026-08-14 확정).
 *
 * ★왜 Roboto 를 버렸나 — Roboto 에는 한글 글리프가 없다. 그래서 한글은 기기마다 다른
 *   대체 글꼴로 그려진다(윈도=맑은 고딕 · 아이폰=애플 SD 고딕 · 안드로이드=또 다름).
 *   **보는 사람마다 다른 표**가 되고, 한 줄 안에서 한글과 숫자의 굵기가 안 맞는다.
 *   영업자는 폰으로 많이 본다 — 그때도 사장님 화면과 같아야 한다.
 * ★Noto Sans KR 은 구글이 모든 기기에 실어 주므로 한글·숫자가 한 벌로 나온다.
 * ⚠ 대신 같은 pt 에서 Roboto 보다 **넓고 크다.** 열너비 계수(7.9)와 행높이(24px)를
 *   같이 키워 뒀다. 글꼴만 바꾸고 이 둘을 안 바꾸면 40열이 빽빽해지고 글자가 위아래로 낀다.
 */
import { SALES_NOTES, SALES_HIDDEN_COLUMNS } from './sales-sheet-mapping';
import { COLOR_INK } from './color-master';
import { MASTER_CATEGORY_COLORS } from './category-colors';

export const FONT_DEFAULT = 'Roboto';
export const FONT = FONT_DEFAULT;
export const SIZE = 9;
/** 기울임 없음(사장님 2026-08-14). 숫자가 기울면 자릿수가 눈으로 안 맞는다. */
export const ITALIC = false;
/** 본문 글자 — 검정. 파랑으로 깔면 표 전체가 링크처럼 보인다. */
export const INK = '000000';
/** 링크 파랑 — 원본 실측값. 사진링크가 걸린 칸에만 쓴다. */
export const LINK = '1155CC';

/**
 * ★금액 칸 규격 통일(사장님 2026-08-19 — 「대여료·보증금 숫자 같은 거, 금액 같은 거는 우측 정렬…… 두껍게, 그리고 기간별로 나와야 하고」)
 *   · 이름 목록이 아니라 **머리글 모양**으로 판정한다 — 갈래 탭의 「12개월 반납형」·「12개월 3만km」·「보증금 인수형」처럼 새 이름이 와도 같은 규격.
 *   · 기간별 대여료(N개월…)·보증금(…보증…)·차량가격/소비자가격 = 우측 정렬 + 굵게. Km·배기량 같은 숫자는 우측만.
 *   · (예전엔 보증금을 굵히지 않았다 — 「둘 다 굵으면 어느 게 월 요금인지 흐려진다」. 2026-08-19 사장님 지시로 금액은 전부 굵게, 배경색이 기간을 가른다.)
 */
export const isRentColumn = (name: string) => /^\d+개월/.test(String(name ?? '').trim());
/** 보증금 칸 — 「보증금 카드결제」(가능/불가 글자) 같은 정책 칸은 금액이 아니다. */
export const isDepositColumn = (name: string) => /보증/.test(String(name ?? '')) && !/카드|결제|여부|가능|보험/.test(String(name ?? ''));
export const isMoneyColumn = (name: string) => isRentColumn(name) || isDepositColumn(name) || /가격|금액/.test(String(name ?? ''));
/** 굵게 나가는 칸(옛 목록 — 이제 `isMoneyColumn` 이 정본이고 이 목록은 호환용). */
export const RENT_COLUMNS = [
  '1개월', '6개월', '12개월', '24개월', '36개월', '48개월', '60개월',
  '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형',
  '12개월 인수형', '24개월 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형',
  '36개월(인수형)', '48개월(인수형)', '60개월(인수형)',
];

/**
 * **글자 칸은 왼쪽** — 가운데로 두면 줄마다 시작 위치가 달라 눈이 세로로 못 훑는다.
 * ★차명 축 넷(제조사·모델·**세부모델·세부트림**)은 한 덩어리로 읽는 이름이라 반드시 같이 왼쪽이다
 *   (사장님 2026-08-22 「모델 세부모델 세부트림 정렬은 좌측 정렬」 — 새로 세운 두 칸이 기본값 가운데로 떨어져 있었다).
 */
export const LEFT_COLUMNS = ['제조사', '모델', '세부모델', '세부트림', '차명', '차명(원문)', '옵션', '옵션(원문)', '트림', '차종분류', '차종구분', '원산지', '구동'];

/**
 * 숫자 칸은 오른쪽(사장님 2026-08-14 — 「금액 주행거리 숫자 형은 우측 정렬」).
 * 가운데로 두면 자릿수가 세로로 안 맞아 50만과 500만이 한눈에 안 갈린다.
 * ⚠ 「무한/30」·「400/50~100」 같은 보험 칸은 숫자가 아니라 **글**이다 — 가운데로 둔다.
 */
export const RIGHT_COLUMNS = [
  // 배터리용량 = kWh 숫자 — 배기량과 같은 갈래라 같이 오른쪽 정렬(2026-08-23).
  'Km', '주행거리', '배기량', '배터리용량', '소비자가격', '차량가격',
  '단기보증', '장기보증', '보증금',
  '1개월', '6개월', '12개월', '24개월', '36개월', '48개월', '60개월',
  '보증금 반납형', '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형',
  '보증금 인수형', '12개월 인수형', '24개월 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형',
  '36개월(인수형)', '48개월(인수형)', '60개월(인수형)',
  '21세', '23세', '21세+', '23세+', '1만+',
  // 인승은 숫자 — 오른쪽(2026-08-22 신설). 「5」·「9」가 세로로 맞아야 승합차를 눈으로 고른다.
  '인승',
  '배터리용량',
];

/** 날짜는 가운데(사장님 2026-08-14). 바탕 서식이 이미 가운데라 «굳혀 두는» 뜻이다. */
export const CENTER_COLUMNS = ['최초등록', '최초등록일', '입고일자', '등록일'];

/**
 * 열별 글자색 — 옛 「종합」 탭 119행에서 열별 다수결로 잰 값이다.
 *
 * ★기간별 대여료는 **단계적으로** 짙어진다(사장님 2026-08-14 — 「기간별 대여료에 단계적으로
 *   색깔 넣어놨잖아」). 한 블록을 한 색으로 칠하면 24와 60이 눈으로 안 갈린다.
 *   단기는 청록 계열, 장기는 파랑 계열 — 블록이 바뀌는 자리는 «색상» 자체가 갈려 한눈에 보인다.
 *   블록 안에서는 기간이 길수록 짙다. 양 끝은 실측값(단기 #5EC1C8 · 장기 #0000FF)에 맞춰 둔다.
 */
export const COL_INK: Record<string, string> = {
  // ★차량번호는 **검정 굵게**(사장님 2026-08-19 — 「사진 링크 있는 것과 없는 게 같은 색이라 … 검정에 진하게」).
  //   사진 링크가 있는 차만 발행기가 글자 서식(run)으로 파랑 밑줄을 건다 — 있고 없고가 눈에 갈린다.
  차량번호: '000000',
  분납: 'FF0000', '21세': 'FF0000', '23세': 'FF0000', '21세+': 'FF0000', '23세+': 'FF0000', '1만+': 'FF0000',
  전용계좌: 'FF0000', 비고: 'FF0000',
};

/**
 * ★기간별 대여료·보증금은 **칸 배경**에 단계로 넣는다(사장님 2026-08-14 — 「칸 배경에」).
 *   글자색으로 가르면 40열 표에서 안 보인다. 색은 «블록이 어디서 어디까지인가»를 말하는 것이지
 *   글자를 꾸미는 게 아니다. 글자색은 값이 달라지는 칸(구분·배차상태·차량번호)에만 쓴다.
 * ★한 블록을 한 색으로 칠하지 않는다 — 24와 60이 눈으로 안 갈린다. 기간이 길수록 짙다.
 * ★블록끼리는 «색상»이 갈린다 — 단기 청록 · 장기 파랑 · 구독 인수형 보라.
 * ⚠ 옅게 유지해라. 짙어지면 검은 글자가 안 읽힌다. 바탕이 있는 칸도 글자는 검정이다.
 */
export const COL_BG: Record<string, string> = {
  // ── 단기(청록) — 짧을수록 옅다
  단기보증: 'EAF7F8', '1개월': 'DCF0F2', '6개월': 'CDE9EC', '12개월': 'BFE2E6',
  // ── 장기(파랑) — 길수록 짙다
  장기보증: 'EDF0FE', '24개월': 'DFE5FD', '36개월': 'D1DAFC', '48개월': 'C3CFFB', '60개월': 'B5C4FA',
  // ── 구독 반납형(파랑 계열)
  '보증금 반납형': 'EDF0FE', '12개월 반납형': 'DFE5FD', '24개월 반납형': 'D1DAFC',
  '36개월 반납형': 'C3CFFB', '48개월 반납형': 'B5C4FA', '60개월 반납형': 'A7B9F9',
  // ── 구독 인수형(보라 계열) — 반납형과 색상이 갈려야 블록이 보인다
  '보증금 인수형': 'F1EBFD', '12개월 인수형': 'E7DDFB', '24개월 인수형': 'DDCFF9',
  '36개월 인수형': 'D3C1F7', '48개월 인수형': 'C9B3F5', '60개월 인수형': 'BFA5F3',
  '36개월(인수형)': 'D3C1F7', '48개월(인수형)': 'C9B3F5', '60개월(인수형)': 'BFA5F3',
};

/**
 * ★기간별 배경 — 이름 목록에 없는 새 칸(「12개월 3만km」·「18개월 2만km」…)도 «몇 개월인가»로 색을 정한다.
 *   단기(1·6·12) 청록 · 장기(24~60) 파랑 · 인수형 보라 · 보증금은 그 블록의 가장 옅은 색. 18개월은 12와 24 사이.
 */
const MONTH_BG: Record<number, string> = { 1: 'DCF0F2', 6: 'CDE9EC', 12: 'BFE2E6', 18: 'E6EAFE', 24: 'DFE5FD', 36: 'D1DAFC', 48: 'C3CFFB', 60: 'B5C4FA', 72: 'A7B9F9', 84: '99AEF8' };
const MONTH_BG_ACQ: Record<number, string> = { 12: 'E7DDFB', 24: 'DDCFF9', 36: 'D3C1F7', 48: 'C9B3F5', 60: 'BFA5F3' };
export function colBgFor(name: string): string | undefined {
  if (COL_BG[name]) return COL_BG[name];
  const n = String(name ?? '').trim();
  const acq = /인수형/.test(n);
  const m = /^(\d+)개월/.exec(n);
  if (m) { const mo = Number(m[1]); return (acq ? MONTH_BG_ACQ[mo] : MONTH_BG[mo]) || (acq ? 'D3C1F7' : (mo >= 24 ? 'D1DAFC' : 'BFE2E6')); }
  if (isDepositColumn(n)) return acq ? 'F1EBFD' : (/단기/.test(n) ? 'EAF7F8' : 'EDF0FE');
  return undefined;
}

/** 탭 색 — 상품리스트와 갈래 탭(손오공구독·오플구독)이 한눈에 갈리게(사장님 2026-08-19 「탭 색깔 약간 다르게」). */
export const SALES_TAB_COLORS: Record<string, string> = { 상품리스트: '4A86E8', 손오공구독: '8E7CC3', 오플구독: '6AA84F' };
export const salesTabColorFor = (tabTitle: string): string | undefined => {
  const t = String(tabTitle ?? '').trim();
  const key = Object.keys(SALES_TAB_COLORS).find((k) => t.startsWith(k));
  return key ? SALES_TAB_COLORS[key] : undefined;
};

/**
 * 구분 — 값마다 글자색이 다르다. 배경은 칠하지 않는다.
 * ★값은 세 가지로만 선다(사장님 2026-08-14 — 「신차렌트 / 중고렌트 / 중고구독」).
 *   캐논은 `lib/intake/entities.PRODUCT_TYPES` 다. 옛 표기(신차·재렌트·재구독)는 옮길 때 갈아 넣는다.
 */
// ★구분 색은 배차상태 색(파랑·주황·회색)과 겹치면 안 된다(사장님 2026-08-18 — 「출고협의 주황 옆에 중고구독 주황 — 이렇게 색깔이 비슷하면 안 되지」).
//   구독은 보라·청록으로 갈랐다. 배차상태는 STATE_INK 그대로.
export const GUBUN_INK: [string, string][] = [
  ['신차렌트', 'FF00FF'], ['중고렌트', '34A853'], ['중고구독', '7B3FE4'], ['신차구독', '0F9D9D'],
];

/**
 * 배차상태 — 값마다 글자색(사장님 2026-08-14 — 「배차 상태 상품구분 이 부분」).
 * 파는 것과 못 파는 것이 색으로 갈려야 한다. 값은 `entities.VEHICLE_STATES`.
 */
export const STATE_INK: [string, string][] = [
  ['즉시출고', '0000FF'], ['출고가능', '0000FF'],
  ['상품화중', 'FF9900'], ['출고협의', 'FF9900'],
  ['계약중', '999999'], ['출고불가', '999999'],
];

/** 자유텍스트라 상한을 더 낮게 묶는 칸. */
// 원문 두 칸(2026-08-23 「2중 보관」)은 글이 길어 좁게 잡는다 — 넓히면 표가 원문에 먹힌다.
const NARROW = new Set(['옵션', '옵션(원문)', '비고', '차명', '차명(원문)', '트림']);
const MAX_PX = 300;
const NARROW_PX = 240;

export const rgb = (hex: string) => ({
  red: parseInt(hex.slice(0, 2), 16) / 255,
  green: parseInt(hex.slice(2, 4), 16) / 255,
  blue: parseInt(hex.slice(4, 6), 16) / 255,
});

/** 한글은 반각 두 칸을 먹는다. 여러 줄짜리 칸은 가장 긴 줄로 잰다. */
const wide = (s: string) => [...String(s ?? '').split('\n').reduce((a, b) => (b.length > a.length ? b : a), '')]
  .reduce((n, ch) => n + (/[ᄀ-ᇿ　-鿿가-힯＀-｠]/.test(ch) ? 2 : 1), 0);

/**
 * 열너비 — 칸 하나가 유난히 길다고 열 전체를 넓히지 않는다. **90% 지점**으로 잰다.
 * 최댓값으로 재면 「퀼팅 라이트 브라운 나파 인조가죽 시트」 한 줄 때문에 내장 열이 130px 로 벌어진다.
 * ⚠ 머리글은 잘리면 안 된다 — 무슨 칸인지 모르게 된다. 그래서 머리글 길이는 하한으로 둔다.
 */
/**
 * 글자 한 칸이 몇 px 인가 — **글꼴과 크기를 따라 같이 움직인다.**
 * ⚠ 여기를 손으로 박아 두면 크기를 바꿀 때마다 열너비가 어긋난다(그래서 계산으로 뺐다).
 *   Noto Sans KR 은 같은 pt 에서 Roboto 보다 넓다.
 */
export const unitPx = (font = FONT, size = SIZE) => (/Noto Sans KR/i.test(font) ? 0.79 : 0.73) * size;

/** 행높이 — 크기를 따라 간다. 좁으면 글자가 위아래로 낀다. */
export const rowPx = (size = SIZE) => Math.round(size * 2.4);

export function columnWidths(columns: string[], body: string[][], font = FONT): number[] {
  const per = unitPx(font);
  return columns.map((name, i) => {
    const lens = body.map((r) => wide(r[i] || '')).sort((a, b) => a - b);
    const p90 = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))] : 0;
    const units = Math.max(p90, wide(name) + 1);
    const cap = NARROW.has(name) ? NARROW_PX : MAX_PX;
    // 여백 16px 은 오른쪽정렬 칸이 테두리에 붙지 않게 하는 몫이다.
    return Math.min(cap, Math.max(62, Math.round(units * per) + 16));
  });
}

export type FormatInput = {
  gid: number;
  columns: string[];
  /**
   * 이 탭만 다른 글꼴로 볼 때. 안 주면 `FONT`.
   * ★글꼴을 «고르는» 자리가 아니다 — 눈으로 견주려고 한 탭만 갈아 보는 손잡이다.
   *   정하고 나면 `FONT` 를 바꾸고 이 인자는 안 쓴다. 탭마다 글꼴이 다르면 한 문서로 안 읽힌다.
   */
  font?: string;
  /** 머리행의 0-based 줄 번호. 판매시트는 0(1행)이다. */
  headerAt?: number;
  /** 지금 시트에 실제로 있는 열 수 — 남는 열을 잘라 내는 데 쓴다. */
  columnCountNow?: number;
  /** 지울 옛 줄무늬. */
  bandedRangeIds?: number[];
  /** 지울 옛 조건부서식 개수. */
  conditionalFormatCount?: number;
  widths: number[];
  /** 탭 이름(색을 정하는 데 쓴다 — 상품리스트/손오공구독/오플구독). */
  tabTitle?: string;
  /** 머리글 메모 추가분(SALES_NOTES 에 없는 칸 — 갈래 탭 원본 요금 칸 등). */
  extraNotes?: Record<string, string>;
  /**
   * 찍은 본문 줄(머리행 아래). **차량번호 셀에 사진 링크를 거는 데 쓴다.**
   * 안 주면 링크를 안 건다 — 값은 그대로다.
   */
  body?: string[][];
};

/**
 * 서식 요청 한 벌. **차례가 중요하다.**
 *   ① 옛 줄무늬·조건부서식을 걷어낸다 — 안 지우면 옛 색이 밑에 남는다
 *   ② 시트 전체 바탕 → ③ 머리행 → ④ 정렬(왼·오른·가운데) → ⑤ 열별 색+굵기
 *   → ⑥ 값별 색(구분·배차상태) → ⑦ 크기
 * ⚠ ④와 ⑤를 뒤집지 마라. ⑤는 `textFormat` 만 건드리므로 ④의 정렬을 안 지운다.
 * ⚠ 색과 굵기를 **따로** 주지 마라 — 뒤엣것이 앞엣것을 덮어 대여료가 통째로 검정으로 나간다.
 */
export function buildSalesFormatRequests(input: FormatInput): Record<string, unknown>[] {
  const { gid, columns, widths } = input;
  const FONT = input.font || FONT_DEFAULT;
  const H = input.headerAt ?? 0;
  const n = columns.length;
  const idx = (name: string) => columns.indexOf(name);
  const out: Record<string, unknown>[] = [];

  for (const id of input.bandedRangeIds || []) out.push({ deleteBanding: { bandedRangeId: id } });
  for (let i = 0; i < (input.conditionalFormatCount || 0); i++) out.push({ deleteConditionalFormatRule: { sheetId: gid, index: 0 } });

  out.push({ updateSheetProperties: {
    properties: { sheetId: gid, gridProperties: { frozenRowCount: H + 1, frozenColumnCount: 0 } },
    fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
  } });

  // 시트 전체 — 범위에 경계를 주지 않으면 앞으로 칠 칸까지 걸린다.
  out.push({ repeatCell: {
    range: { sheetId: gid },
    cell: { userEnteredFormat: {
      backgroundColor: rgb('FFFFFF'),
      textFormat: { fontFamily: FONT, fontSize: SIZE, italic: ITALIC, bold: false, foregroundColor: rgb(INK) },
      horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
      padding: { top: 0, bottom: 0, left: 5, right: 5 },
    } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)',
  } });

  // 머리행 — 굵게. 40열짜리 표에서 어디가 제목 줄인지 눈이 먼저 잡아야 한다.
  out.push({ repeatCell: {
    range: { sheetId: gid, startRowIndex: H, endRowIndex: H + 1, startColumnIndex: 0, endColumnIndex: n },
    cell: { userEnteredFormat: {
      backgroundColor: rgb('FFFFFF'),
      textFormat: { fontFamily: FONT, fontSize: SIZE, bold: true, italic: ITALIC, foregroundColor: rgb('000000') },
      horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
      padding: { top: 0, bottom: 0, left: 5, right: 5 },
    } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)',
  } });

  const align = (names: readonly string[], how: string) => {
    for (const name of names) {
      const i = idx(name);
      if (i < 0) continue;
      out.push({ repeatCell: {
        range: { sheetId: gid, startRowIndex: H + 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { horizontalAlignment: how } },
        fields: 'userEnteredFormat.horizontalAlignment',
      } });
    }
  };
  align(LEFT_COLUMNS, 'LEFT');
  align(RIGHT_COLUMNS, 'RIGHT');
  align(columns.filter((c) => isMoneyColumn(c) && !RIGHT_COLUMNS.includes(c)), 'RIGHT');   // 갈래 탭의 새 금액 칸도 우측
  align(CENTER_COLUMNS, 'CENTER');

  // 기간 블록 — 칸 배경. 머리행까지 같이 칠해야 어느 열이 그 블록인지 위에서부터 보인다.
  columns.forEach((name, i) => {
    const bg = colBgFor(name);
    if (!bg) return;
    out.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: H, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: { backgroundColor: rgb(bg) } },
      fields: 'userEnteredFormat.backgroundColor',
    } });
  });

  // 금액(기간별 대여료·보증금·차량가격)은 굵게 — 2026-08-19 규격 통일. 기간은 배경색이 가른다.
  for (const name of columns.filter((c) => isMoneyColumn(c))) {
    const i = idx(name);
    if (i < 0) continue;
    out.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: H + 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: SIZE, italic: ITALIC, bold: true, foregroundColor: rgb(INK) } } },
      fields: 'userEnteredFormat.textFormat',
    } });
  }

  for (const [name, ink] of Object.entries(COL_INK)) {
    const i = idx(name);
    if (i < 0) continue;
    out.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: H + 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: { textFormat: {
        fontFamily: FONT, fontSize: SIZE, italic: ITALIC,
        bold: isMoneyColumn(name) || name === '차량번호', foregroundColor: rgb(ink),
      } } },
      fields: 'userEnteredFormat.textFormat',
    } });
  }

  /** 값마다 색이 갈리는 칸 — 열 전체를 한 색으로 칠할 수 없으니 조건부서식으로 건다. */
  const byValue = (column: string, pairs: [string, string][]) => {
    const i = idx(column);
    if (i < 0) return;
    for (const [word, ink] of pairs) {
      out.push({ addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: H + 1, startColumnIndex: i, endColumnIndex: i + 1 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: word }] },
            format: { textFormat: { foregroundColor: rgb(ink), bold: true } },
          },
        },
      } });
    }
  };
  byValue('구분', GUBUN_INK);
  // 손오공 구독과 T카 픽업구독은 같은 공급사여도 서로 다른 매물 갈래다.
  // 상태 색(green·amber·blue·orange·red)과 겹치지 않게 보라/자홍으로 가른다.
  byValue('분류', [['중고구독', '7E57C2'], ['픽업구독', 'C2185B']]);
  byValue('배차상태', STATE_INK);
  byValue('상태', STATE_INK);
  // ★구분되는 값은 눈에 확 오게(사장님 2026-08-19 「제조사 색깔 넣기로 했었고 · 세단 SUV 색깔 다르게 · 차량 색상 텍스트에 색깔」)
  //   제조사·차체형태 색은 원천대장 규격검토와 같은 표(vehicle-master-sheet-format.MASTER_CATEGORY_COLORS) — 한 문서로 읽히게.
  const byContains = (column: string, pairs: [string, string][]) => {
    const i = idx(column);
    if (i < 0) return;
    for (const [word, ink] of pairs) {
      out.push({ addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: H + 1, startColumnIndex: i, endColumnIndex: i + 1 }],
          booleanRule: {
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: word }] },
            format: { textFormat: { foregroundColor: rgb(ink), bold: true } },
          },
        },
      } });
    }
  };
  const hexOf = (v: string) => v.replace('#', '').toUpperCase();
  byValue('제조사', Object.entries({ ...MASTER_CATEGORY_COLORS['제조사'], 르노: MASTER_CATEGORY_COLORS['제조사']['르노코리아'], KGM: MASTER_CATEGORY_COLORS['제조사']['KG모빌리티'] }).map(([k, v]) => [k, hexOf(v)] as [string, string]));
  // 차종구분은 색 없음(사장님 2026-08-19 「과하네」). 연료는 색(「연료는 색깔 구분해 주시고」) — 규격검토와 같은 표.
  void byContains;
  byValue('연료', Object.entries(MASTER_CATEGORY_COLORS['연료']).map(([k, v]) => [k, hexOf(v)] as [string, string]));
  const colorPairs = Object.entries(COLOR_INK) as [string, string][];
  byValue('외장', colorPairs);
  byValue('내장', colorPairs);
  byValue('외장색상', colorPairs);
  byValue('내장색상', colorPairs);

  /**
   * ★머리글 메모 — 「이 칸이 뭐지」를 그 자리에서 답한다(사장님 2026-08-14 —
   *   「니가 할 때는 항목을 잘 써줘봐」). 이름은 손에 익은 대로 두고 뜻만 메모로 단다.
   * ⚠ 행을 안 먹는다. 60열짜리 표에 설명 줄을 하나 더 얹을 수는 없다.
   */
  for (const [name, note] of Object.entries({ ...SALES_NOTES, ...(input.extraNotes || {}) })) {
    const i = idx(name);
    if (i < 0) continue;
    out.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: H, endRowIndex: H + 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { note }, fields: 'note',
    } });
  }
  // 탭 색 — 상품리스트/손오공구독/오플구독이 한눈에 갈리게.
  const tabColor = input.tabTitle ? salesTabColorFor(input.tabTitle) : undefined;
  if (tabColor) out.push({ updateSheetProperties: { properties: { sheetId: gid, tabColor: rgb(tabColor) }, fields: 'tabColor' } });

  out.push({ clearBasicFilter: { sheetId: gid } });
  out.push({ setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: H, startColumnIndex: 0, endColumnIndex: n } } } });

  out.push({ updateDimensionProperties: {
    range: { sheetId: gid, dimension: 'ROWS', startIndex: 0 },
    properties: { pixelSize: rowPx() }, fields: 'pixelSize',
  } });
  widths.forEach((px, i) => out.push({ updateDimensionProperties: {
    range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
    properties: { pixelSize: px }, fields: 'pixelSize',
  } }));

  /**
   * ★**영업자 눈에서 치우는 열** — 값은 그대로 두고 열만 접는다(`SALES_HIDDEN_COLUMNS`).
   *   「사진」은 차번 링크를 만드는 재료라 지우면 링크가 같이 죽는다.
   */
  for (const name of SALES_HIDDEN_COLUMNS) {
    const i = idx(name);
    if (i < 0) continue;
    out.push({ updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { hiddenByUser: true }, fields: 'hiddenByUser',
    } });
  }

  // 표 오른쪽에 남은 빈 열을 잘라 낸다 — 「빈 칸인데 300px」 같은 자리가 생긴다.
  const now = input.columnCountNow || n;
  if (now > n) out.push({ deleteDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: n, endIndex: now } } });

  /**
   * ★**차량번호를 누르면 사진 폴더로 간다** — 세 탭이 같은 규칙을 쓴다.
   *   사장님 2026-08-24 「손오공하고 오플은 들어가 있는데 상품리스트에는 링크가 없다고 사진링크가」.
   *   사장님이 «사진링크»라고 부르시는 것은 「사진」 칸의 주소 «글자»가 아니라 **차번 셀의 파란 링크**다 —
   *   원본 오토플러스 시트가 「★★★ 차량번호 클릭 후 차량이미지 다운로드 가능합니다 ★★★」라고
   *   가르쳐 놓았다. 갈래 탭 발행기만 이 일을 하고 상품리스트 발행기는 안 해서 갈렸다
   *   (「같은 건데 왜 몇 개만 저러냐」). 그래서 발행기가 아니라 **여기 한 곳**에 둔다.
   *
   * ⚠ **판단하지 않는다.** 「사진」 칸에 있는 주소를 그대로 건다. 그 주소가 그 차 것인지는
   *   **공급사 시트에 넣을 때** 문지기(`photo-link-guard`)가 이미 봤다. 나르는 길에서 또 고르면
   *   빠지는 차가 생긴다(「니가 빼면 안 되고 있는 걸 그대로 갖고 오는 거잖아」).
   * ⚠ **맨 끝이어야 한다.** 뒤에 `repeatCell` 이 오면 링크가 통째로 지워진다.
   * ⚠ 사진이 빠진 차는 옛 링크를 걷어낸다 — 안 지우면 지난번 주소가 남아 남의 차로 간다.
   */
  const ipl = idx('차량번호');
  const iph = idx('사진');
  if (ipl >= 0 && iph >= 0 && input.body) {
    out.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: H + 1, startColumnIndex: ipl, endColumnIndex: ipl + 1 },
      cell: { userEnteredFormat: { textFormat: {} } },
      fields: 'userEnteredFormat.textFormat.link',
    } });
    input.body.forEach((r, i) => {
      // 「사진」 칸이 여러 장(콤마·줄바꿈)이면 차번 셀 링크는 «첫 장»만 건다 — 전체를 href로 넣으면 깨진 링크가 된다.
      const uri = String(r[iph] ?? '').split(/\s*[\n,]\s*/)[0].trim();
      const plate = String(r[ipl] ?? '').trim();
      if (!plate || !/^https?:\/\//i.test(uri)) return;
      out.push({ updateCells: {
        range: {
          sheetId: gid, startRowIndex: H + 1 + i, endRowIndex: H + 2 + i,
          startColumnIndex: ipl, endColumnIndex: ipl + 1,
        },
        rows: [{ values: [{
          userEnteredValue: { stringValue: plate },
          textFormatRuns: [{ startIndex: 0, format: {
            link: { uri }, foregroundColor: rgb(LINK), underline: true,
            italic: ITALIC, fontFamily: FONT, fontSize: SIZE,
          } }],
        }] }],
        fields: 'userEnteredValue,textFormatRuns',
      } });
    });
  }

  return out;
}
