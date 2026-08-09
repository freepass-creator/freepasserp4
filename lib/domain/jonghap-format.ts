/**
 * 구버전 종합표 **서식** — 값과 따로 둔다.
 *
 * 값(`jonghap.ts`)은 v3 규격 41열 그대로다. 여기서는 «보기»만 손본다 —
 * 열 순서·내용은 한 글자도 바꾸지 않는다(옛 수식·필터가 그 순서에 걸려 있다).
 *
 * 새 표(`inventory-sheet-export.ts`)와 같은 잣대로 만든다:
 *   머리행 고정 · 틀 고정 · 숫자는 오른쪽 · 상태는 색으로 · 열 너비는 값 길이에 맞춰.
 */
import { JONGHAP_COLUMNS, JONGHAP_COL } from '@/lib/domain/jonghap';

const rgb = (hex: string) => ({
  red: parseInt(hex.slice(0, 2), 16) / 255,
  green: parseInt(hex.slice(2, 4), 16) / 255,
  blue: parseInt(hex.slice(4, 6), 16) / 255,
});

/**
 * 열 너비 — 실제 값 길이에 맞춘다.
 * 넉넉하면 훑을 때 눈이 멀리 가고, 좁으면 잘려서 다시 눌러 봐야 한다.
 */
const WIDTH: Record<string, number> = {
  상태: 72, 입고일자: 82, 구분: 74, 차량번호: 96, 차종분류: 104, 세부모델: 150,
  외장: 62, 내장: 62, 연식: 56, 연료: 66, Km: 74,
  단기보증: 92, 장기보증: 92, '1개월': 84, '12개월': 84, '24개월': 84, '36개월': 84, '48개월': 84, '60개월': 84,
  // 파워트레인은 「전기 롱레인지 84kWh AWD」처럼 길다 — 잘리면 어느 조합인지 못 읽는다.
  파워트레인: 150, 세부트림: 112, 옵션: 190, 최초등록: 88, 소비자가격: 96, 제조사: 70, 배기량: 66, 차고지: 90,
  운전자범위: 150, 연주행: 78, 분납: 66, '21세': 62, '23세': 62, '1만+': 66,
  대인: 96, 대물: 96, 자차: 110, 자손: 96, 무보험: 96, 정비: 84, 전용계좌: 110,
  비고: 200, 공급사코드: 84, 정책코드: 84,
};

/** 새 표와 같은 상태 색 — 두 탭에서 같은 말이 다른 색이면 눈이 헷갈린다. */
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  출고가능: { bg: 'DCFCE7', fg: '166534' },
  즉시출고: { bg: 'DBEAFE', fg: '1E40AF' },
  출고협의: { bg: 'FEF3C7', fg: '92400E' },
  출고불가: { bg: 'FEE2E2', fg: '991B1B' },
  계약중: { bg: 'EDE9FE', fg: '5B21B6' },
};

const box = (gid: number, r0: number, r1: number, c0: number, c1: number) => ({
  sheetId: gid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1,
});

/**
 * 종합표 탭에 입힐 서식 요청들. 값은 이미 쓰여 있다고 본다.
 *
 * @param existing 그 탭에 이미 걸린 것들 — **덮어쓰기 전에 걷어내야 한다.**
 *   줄무늬·조건부서식은 «추가»만 되는 요청이라 두 번째 반영에서
 *   「already has alternating background colors」로 통째로 400 이 난다(실측 2026-08-10).
 */
export function jonghapFormatRequests(
  gid: number,
  rowCount: number,
  existing: { bandedRangeIds?: number[]; conditionalCount?: number } = {},
): Record<string, unknown>[] {
  const lastRow = rowCount + 1;                     // 머리행 1줄 + 본문
  const nCols = JONGHAP_COLUMNS.length;
  const req: Record<string, unknown>[] = [];

  /**
   * ★먼저 걷어낸다 — 줄무늬·조건부서식은 «추가»만 되는 요청이다.
   * 안 걷으면 두 번째 반영부터 통째로 400 이 나고, 그때 서식이 하나도 안 입혀진다.
   * 뒤에서 앞으로 지운다(조건부서식은 index 가 지울 때마다 당겨진다).
   */
  for (const id of existing.bandedRangeIds || []) req.push({ deleteBanding: { bandedRangeId: id } });
  for (let i = (existing.conditionalCount || 0) - 1; i >= 0; i--) {
    req.push({ deleteConditionalFormatRule: { sheetId: gid, index: i } });
  }

  // 머리행 — 진하게, 배경, 가운데. 훑을 때 여기가 경계다.
  req.push({
    repeatCell: {
      range: box(gid, 0, 1, 0, nCols),
      cell: {
        userEnteredFormat: {
          backgroundColor: rgb('1F2937'),
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          textFormat: { bold: true, fontSize: 10, foregroundColor: rgb('FFFFFF') },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
    },
  });

  // 본문 — 기본 왼쪽 정렬 · 한 줄로 자름(줄바꿈되면 행 높이가 들쭉날쭉해 훑기 어렵다)
  req.push({
    repeatCell: {
      range: box(gid, 1, lastRow, 0, nCols),
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP', textFormat: { fontSize: 10 } } },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)',
    },
  });

  /**
   * 숫자 칸 — 오른쪽 정렬 + 천단위. 금액은 자릿수를 눈으로 맞춰야 크기가 읽힌다.
   * 0 은 빈칸으로 둔다(`;;""`) — 「0원」이 값처럼 보이면 안 판다고 오해한다.
   */
  for (const name of ['단기보증', '장기보증', '1개월', '12개월', '24개월', '36개월', '48개월', '60개월', '소비자가격']) {
    const c = JONGHAP_COL(name);
    if (c < 0) continue;
    req.push({
      repeatCell: {
        range: box(gid, 1, lastRow, c, c + 1),
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', numberFormat: { type: 'NUMBER', pattern: '#,##0;;""' } } },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
      },
    });
  }
  for (const name of ['Km', '배기량']) {
    const c = JONGHAP_COL(name);
    if (c < 0) continue;
    req.push({
      repeatCell: {
        range: box(gid, 1, lastRow, c, c + 1),
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', numberFormat: { type: 'NUMBER', pattern: '#,##0;;""' } } },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
      },
    });
  }
  // 짧은 값은 가운데 — 왼쪽에 붙으면 칸이 비어 보인다.
  for (const name of ['상태', '구분', '연식', '연료', '외장', '내장', '최초등록', '분납', '21세', '23세', '1만+']) {
    const c = JONGHAP_COL(name);
    if (c < 0) continue;
    req.push({
      repeatCell: {
        range: box(gid, 1, lastRow, c, c + 1),
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(horizontalAlignment)',
      },
    });
  }

  // 열 너비
  JONGHAP_COLUMNS.forEach((name, i) => {
    req.push({
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: WIDTH[name] ?? 90 },
        fields: 'pixelSize',
      },
    });
  });

  /**
   * 틀 고정 — 머리행 1줄과 **차량번호까지** 왼쪽을 얼어붙인다.
   * 오른쪽으로 41열을 훑는 동안 «어느 차 줄인지»가 안 보이면 값을 잘못 읽는다.
   */
  req.push({
    updateSheetProperties: {
      properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: JONGHAP_COL('차량번호') + 1 } },
      fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    },
  });

  // 머리행 필터 — 영업자가 「출고가능만」·「기아만」을 바로 고른다.
  req.push({ setBasicFilter: { filter: { range: box(gid, 0, lastRow, 0, nCols) } } });

  // 줄무늬 — 41열을 가로로 따라갈 때 줄을 잃지 않는다.
  req.push({
    addBanding: {
      bandedRange: {
        range: box(gid, 0, lastRow, 0, nCols),
        rowProperties: {
          headerColor: rgb('1F2937'),
          firstBandColor: rgb('FFFFFF'),
          secondBandColor: rgb('F8FAFC'),
        },
      },
    },
  });

  // 상태 색 — 새 표와 같은 색이라 두 탭을 오가도 같은 뜻으로 읽힌다.
  const statusCol = JONGHAP_COL('상태');
  let index = 0;
  if (statusCol >= 0) {
    for (const [label, tone] of Object.entries(STATUS_TONE)) {
      req.push({
        addConditionalFormatRule: {
          index: index++,
          rule: {
            ranges: [box(gid, 1, lastRow, statusCol, statusCol + 1)],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: label }] },
              format: { backgroundColor: rgb(tone.bg), textFormat: { foregroundColor: rgb(tone.fg), bold: true } },
            },
          },
        },
      });
    }
  }
  return req;
}
