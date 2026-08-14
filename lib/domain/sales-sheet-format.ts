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
export const FONT = 'Roboto';
export const SIZE = 10;
/** 기울임 없음(사장님 2026-08-14). 숫자가 기울면 자릿수가 눈으로 안 맞는다. */
export const ITALIC = false;
/** 본문 글자 — 검정. 파랑으로 깔면 표 전체가 링크처럼 보인다. */
export const INK = '000000';
/** 링크 파랑 — 원본 실측값. 사진링크가 걸린 칸에만 쓴다. */
export const LINK = '1155CC';

/** 굵게 나가는 칸 = 월 대여료. 보증금은 굵히지 않는다 — 둘 다 굵으면 어느 게 월 요금인지 흐려진다. */
export const RENT_COLUMNS = [
  '1개월', '6개월', '12개월', '24개월', '36개월', '48개월', '60개월',
  '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형',
  '12개월 인수형', '24개월 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형',
  '36개월(인수형)', '48개월(인수형)', '60개월(인수형)',
];

/** 긴 글이 드는 칸은 왼쪽 — 가운데로 두면 줄마다 시작 위치가 달라 눈이 세로로 못 훑는다. */
export const LEFT_COLUMNS = ['제조사', '모델', '세부모델', '파워트레인', '세부트림', '옵션', '트림', '차종분류'];

/**
 * 숫자 칸은 오른쪽(사장님 2026-08-14 — 「금액 주행거리 숫자 형은 우측 정렬」).
 * 가운데로 두면 자릿수가 세로로 안 맞아 50만과 500만이 한눈에 안 갈린다.
 * ⚠ 「무한/30」·「400/50~100」 같은 보험 칸은 숫자가 아니라 **글**이다 — 가운데로 둔다.
 */
export const RIGHT_COLUMNS = [
  'Km', '주행거리', '배기량', '소비자가격', '차량가격',
  '단기보증', '장기보증', '보증금',
  '1개월', '6개월', '12개월', '24개월', '36개월', '48개월', '60개월',
  '보증금 반납형', '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형',
  '보증금 인수형', '12개월 인수형', '24개월 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형',
  '36개월(인수형)', '48개월(인수형)', '60개월(인수형)',
  '21세', '23세', '1만+',
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
  차량번호: LINK,
  분납: 'FF0000', '21세': 'FF0000', '23세': 'FF0000', '1만+': 'FF0000',
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
 * 구분 — 값마다 글자색이 다르다. 배경은 칠하지 않는다.
 * ★값은 세 가지로만 선다(사장님 2026-08-14 — 「신차렌트 / 중고렌트 / 중고구독」).
 *   캐논은 `lib/intake/entities.PRODUCT_TYPES` 다. 옛 표기(신차·재렌트·재구독)는 옮길 때 갈아 넣는다.
 */
export const GUBUN_INK: [string, string][] = [
  ['신차렌트', 'FF00FF'], ['중고렌트', '34A853'], ['중고구독', 'FF9900'], ['신차구독', 'FF9900'],
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
const NARROW = new Set(['옵션', '비고', '세부모델', '트림']);
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
export function columnWidths(columns: string[], body: string[][]): number[] {
  return columns.map((name, i) => {
    const lens = body.map((r) => wide(r[i] || '')).sort((a, b) => a - b);
    const p90 = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))] : 0;
    const units = Math.max(p90, wide(name) + 1);
    const cap = NARROW.has(name) ? NARROW_PX : MAX_PX;
    // 글자 한 칸을 몇 px 로 볼까 — 10pt 로 키운 만큼 같이 키운다(9pt 때는 6.6이었다).
    // 여백 16px 은 오른쪽정렬 칸이 테두리에 붙지 않게 하는 몫이다.
    return Math.min(cap, Math.max(66, Math.round(units * 7.3) + 16));
  });
}

export type FormatInput = {
  gid: number;
  columns: string[];
  /** 머리행의 0-based 줄 번호. 판매시트는 0(1행)이다. */
  headerAt?: number;
  /** 지금 시트에 실제로 있는 열 수 — 남는 열을 잘라 내는 데 쓴다. */
  columnCountNow?: number;
  /** 지울 옛 줄무늬. */
  bandedRangeIds?: number[];
  /** 지울 옛 조건부서식 개수. */
  conditionalFormatCount?: number;
  widths: number[];
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
  align(CENTER_COLUMNS, 'CENTER');

  // 기간 블록 — 칸 배경. 머리행까지 같이 칠해야 어느 열이 그 블록인지 위에서부터 보인다.
  for (const [name, bg] of Object.entries(COL_BG)) {
    const i = idx(name);
    if (i < 0) continue;
    out.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: H, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: { backgroundColor: rgb(bg) } },
      fields: 'userEnteredFormat.backgroundColor',
    } });
  }

  // 월 대여료는 굵게 — 보증금은 굵히지 않는다. 둘 다 굵으면 어느 게 월 요금인지 흐려진다.
  for (const name of RENT_COLUMNS) {
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
        bold: RENT_COLUMNS.includes(name), foregroundColor: rgb(ink),
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
  byValue('배차상태', STATE_INK);
  byValue('상태', STATE_INK);

  out.push({ clearBasicFilter: { sheetId: gid } });
  out.push({ setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: H, startColumnIndex: 0, endColumnIndex: n } } } });

  out.push({ updateDimensionProperties: {
    range: { sheetId: gid, dimension: 'ROWS', startIndex: 0 },
    // 10pt 라 21px 이면 글자가 위아래로 낀다. 23px 이 «빽빽하되 안 끼는» 자리다.
    properties: { pixelSize: 23 }, fields: 'pixelSize',
  } });
  widths.forEach((px, i) => out.push({ updateDimensionProperties: {
    range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
    properties: { pixelSize: px }, fields: 'pixelSize',
  } }));

  // 표 오른쪽에 남은 빈 열을 잘라 낸다 — 「빈 칸인데 300px」 같은 자리가 생긴다.
  const now = input.columnCountNow || n;
  if (now > n) out.push({ deleteDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: n, endIndex: now } } });

  return out;
}
