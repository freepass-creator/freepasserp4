/**
 * **하허호 전용 상품시트(F86) «레트로 스킨»** — 옛 「프리패스 공급사 상품리스트」 「종합」 탭의 서식을 «잰 값».
 *
 * ★사장님 2026-09-15 「하허호한테 만들어졌던 그 F86 을 원래 레트로 감성인 그 폰트하고 … 동일하게 맞춰주면 돼」
 *   · 「폰트하고 규격 뭐 이런 것만 하고, 대여료 구간은 우리 기존 그거대로 그냥 똑같이」 · 「종합 시트는 안 만들어도 돼」
 * ★원본 = 문서 1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg(freepassmobility@gmail.com) 「종합」 탭, 2026-09-15 API 로 실측.
 *   맑은 고딕 9pt 기울임 · 굵은 칸 없음 · 전부 가운데 · 줄 21px · 여백 2/3 · 기간 머리 색 · 칸별 글자색 · 분납·연령 노란 바탕.
 *
 * ⚠ **칸 구성·이름·값은 안 건드린다** — 그건 F01 이 정한다(매뉴얼 F86 규칙 1). 칸 «자리»만 옛 차례로 옮긴다(`retroColumnOrder`, 규칙 2 의 2026-09-15 바뀜).
 * ⚠ **공용 서식기(`sales-sheet-format`)는 안 고친다** — F01 모양이 같이 바뀐다. 그 서식 요청 «뒤»에 덮어 쓴다.
 * ⚠ 값별 색(구분·배차상태·제조사·연료·색상)은 살린다 — 옛 시트에 없던 «뜻»이라. 굵기만 옛 시트처럼 뺀다.
 */
import { isMoneyColumn } from './sales-sheet-format';

type Req = Record<string, any>;

/**
 * ★★**칸 차례도 옛 「종합」을 따른다** — 사장님 2026-09-15 「이건 새로운 구현이라고 보면 돼, 과거 형태에 맞추는 거로」.
 *   ⚠ 규칙 1·2(「F86 열 차례 = F01」)를 이 날 바꿨다 — 발행기와 감사기(`audit-sheet-vs-atom`)가 «이 함수 하나»로 차례를 정한다.
 * ★이름은 «우리 칸 이름»을 쓴다 — 값 대조(F01 ↔ F86)가 이름으로 맞춰 보기 때문이다. 옛 이름은 옆 주석.
 * ★「@요금」 자리에 그 회사가 쓰는 요금 칸이 F01 차례대로 들어간다(대여료 구간은 «우리 기존 그대로»).
 * ★옛 시트에 없던 우리 칸(모델·연식·원산지·카드결제·중도해지…)은 뒤에 F01 차례로 붙는다 — 빼면 채널이 보던 정보가 사라진다.
 *   옛 시트에만 있던 「차량상태·입고일자·정책코드」는 원자에 값이 없거나 내부 코드라 안 만든다.
 */
export const RETRO_COLUMN_ORDER = [
  '배차상태', '구분', '차량번호', '모델' /* 차종분류 — 옛 시트는 이 칸에 «모델명»(K5·그랜저·카니발)을 담았다. 차급 칸이 아니다(사장님 2026-09-15 「차종구분이 왜 있지, 원래 그거 없었는데」) */, '세부모델', '연료', '외장', '내장', 'Km',
  '@요금',
  '세부트림' /* 트림 */, '옵션(원문)' /* 옵션 */, '최초등록', '소비자가격', '제조사', '배기량', '차고지', '운전자범위', '연주행',
  '분납', '21세+' /* 21세 */, '23세+' /* 23세 */, '1만+', '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌', '비고',
  '공급사' /* 공급사코드 */,
] as const;

const 요금칸 = (c: string) => isMoneyColumn(c) && !/가격/.test(c);

/** 한 탭의 칸(F01 차례) → 옛 「종합」 차례. 칸을 더하거나 빼지 않는다 — 자리만 바꾼다. */
export function retroColumnOrder(cols: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of RETRO_COLUMN_ORDER) {
    if (k === '@요금') { for (const c of cols) if (요금칸(c) && !out.includes(c)) out.push(c); continue; }
    if (cols.includes(k) && !out.includes(k)) out.push(k);
  }
  for (const c of cols) if (!out.includes(c)) out.push(c);
  return out;
}

export const RETRO_FONT = 'Malgun Gothic';
export const RETRO_SIZE = 9;
export const RETRO_ROW_PX = 21;

/** 기간 머리 바탕 — 단기(초록·파랑) · 장기(짙어지는 빨강). 몸 칸은 흰 바탕이다. */
const HEAD_BG: Record<string, string> = {
  단기보증: 'B7E1CD', '1개월': 'A4C2F4', '6개월': '6D9EEB', '12개월': '3C78D8',
  장기보증: 'E6B8AF', '24개월': 'DD7E6B', '36개월': 'CC4125', '48개월': 'A61C00', '60개월': '85200C',
};
/** 몸 칸 글자색 — 옛 시트 칸별. 이름이 같은 칸에만 건다(없는 칸을 만들지 않는다). */
const BODY_INK: Record<string, string> = {
  차량상태: '0000FF', 배차상태: '0000FF', 입고일자: '1155CC', 차량번호: '1155CC', 구분: 'FF00FF',
  단기보증: 'FF0000', '1개월': '46BDC6', '6개월': '5EC1C8', '12개월': '5EC1C8',
  장기보증: '0000FF', '24개월': '0000FF', '36개월': '0000FF', '48개월': '0000FF', '60개월': '0000FF',
  차고지: '1F1F1F', 분납: 'FF0000', '21세': 'FF0000', '23세': 'FF0000', '21세+': 'FF0000', '23세+': 'FF0000',
  '1만+': 'FF0000', 전용계좌: 'FF0000', 비고: 'FF0000',
};
/** 몸 칸 바탕 — 분납·연령·주행 추가요금은 노란 바탕(옛 시트). */
const BODY_BG: Record<string, string> = { 분납: 'FFFF00', '21세': 'FFFF00', '23세': 'FFFF00', '21세+': 'FFFF00', '23세+': 'FFFF00', '1만+': 'FFFF00' };
/** 열 폭 — 옛 시트 칸 이름이 같은 것만. 나머지(우리만 있는 칸)는 원래 폭을 둔다. */
const WIDTH: Record<string, number> = {
  차량상태: 143, 배차상태: 143, 입고일자: 75, 구분: 55, 차량번호: 75, 차종분류: 75, 모델: 75, 세부모델: 228, 연료: 107,
  외장: 132, 내장: 85, Km: 49, 단기보증: 75, '1개월': 63, '6개월': 58, '12개월': 65, 장기보증: 115,
  '24개월': 85, '36개월': 85, '48개월': 103, '60개월': 116, 트림: 342, 옵션: 857, 최초등록: 75, 소비자가격: 87,
  제조사: 63, 배기량: 63, 차고지: 132, 운전자범위: 101, 연주행: 63, 분납: 51, '21세': 53, '23세': 53, '1만+': 55,
  대인: 51, 대물: 51, 자차: 84, 자손: 62, 무보험: 63, 정비: 70, 전용계좌: 273, 비고: 51,
};

const rgb = (h: string) => ({
  red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255,
});

/**
 * 한 탭의 서식 요청(`buildSalesFormatRequests` 결과) 뒤에 레트로 겉을 덮는다.
 * @param linkReqs 차번 셀 링크 요청(값을 쓴 뒤 따로 보내는 것) — 링크 글자에도 글꼴이 박혀 있어 같이 바꾼다.
 */
export function applyRetroSkin(reqs: Req[], linkReqs: Req[], p: { gid: number; columns: string[]; headerAt?: number }): Req[] {
  const { gid, columns } = p;
  const H = p.headerAt ?? 0;

  // ① 값별 색 조건부서식 — 굵기만 뺀다(옛 시트는 굵은 칸이 없다). 색은 그대로.
  for (const r of reqs) {
    const tf = r?.addConditionalFormatRule?.rule?.booleanRule?.format?.textFormat;
    if (tf && tf.bold) tf.bold = false;
  }
  // ② 차번 링크 글자 — run 에 로보토가 박혀 있으면 차번만 딴 글꼴로 선다.
  for (const r of linkReqs) {
    for (const row of r?.updateCells?.rows || []) {
      for (const v of row.values || []) {
        for (const run of v.textFormatRuns || []) {
          if (run.format) Object.assign(run.format, { fontFamily: RETRO_FONT, fontSize: RETRO_SIZE, italic: true });
        }
      }
    }
  }

  const out = [...reqs];
  // ③ 탭 전체 — 글꼴·크기·기울임·굵기 없음·가운데·여백. 글자색은 안 건드린다(앞 규칙의 색을 살린다).
  out.push({ repeatCell: {
    range: { sheetId: gid },
    cell: { userEnteredFormat: {
      textFormat: { fontFamily: RETRO_FONT, fontSize: RETRO_SIZE, italic: true, bold: false },
      horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', padding: { top: 2, right: 3, bottom: 2, left: 3 },
    } },
    fields: [
      'userEnteredFormat.textFormat.fontFamily', 'userEnteredFormat.textFormat.fontSize',
      'userEnteredFormat.textFormat.italic', 'userEnteredFormat.textFormat.bold',
      'userEnteredFormat.horizontalAlignment', 'userEnteredFormat.verticalAlignment', 'userEnteredFormat.padding',
    ].join(','),
  } });
  // ④ 칸별 — 이름이 옛 시트와 같은 칸만.
  columns.forEach((name, i) => {
    const col = { sheetId: gid, startColumnIndex: i, endColumnIndex: i + 1 };
    if (HEAD_BG[name]) {
      out.push({ repeatCell: { range: { ...col, startRowIndex: H, endRowIndex: H + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(HEAD_BG[name]) } }, fields: 'userEnteredFormat.backgroundColor' } });
      out.push({ repeatCell: { range: { ...col, startRowIndex: H + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb('FFFFFF') } }, fields: 'userEnteredFormat.backgroundColor' } });
    }
    if (BODY_BG[name]) {
      out.push({ repeatCell: { range: { ...col, startRowIndex: H + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(BODY_BG[name]) } }, fields: 'userEnteredFormat.backgroundColor' } });
    }
    if (BODY_INK[name]) {
      out.push({ repeatCell: { range: { ...col, startRowIndex: H + 1 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: rgb(BODY_INK[name]) } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } });
    }
    if (WIDTH[name]) {
      out.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: WIDTH[name] }, fields: 'pixelSize' } });
    }
  });
  // ⑤ 줄 높이
  out.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 0 }, properties: { pixelSize: RETRO_ROW_PX }, fields: 'pixelSize' } });
  return out;
}
