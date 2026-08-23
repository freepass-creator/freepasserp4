/**
 * 공급사 파일의 「상품시트」 탭과 판매시트 사이에서 함께 쓰는 순수 규칙.
 * 발행기와 감사기가 공급사 별칭·블록 배치를 따로 복제하면 같은 차를 서로 다른 공급사로
 * 판정할 수 있으므로 한 곳에서만 관리한다.
 */

export type SupplierPreviewBlock = {
  prefix: string;
  header: string[];
  rows: string[][];
};

/** 판매시트 「공급사」 표기 → 공급사 파일 이름에서 뽑은 라벨. */
export const SUPPLIER_SALES_LABEL_ALIASES: Readonly<Record<string, string>> = {
  SA: '에스에이',
  'J&J': '제이앤제이렌트카',
  에코: '에코렌트카',
  경진: '경진카',
  경진렌트카: '경진카',
  오토플러스: '오토플러스',
};

export const supplierSalesLabel = (salesName: unknown): string => {
  const value = String(salesName ?? '').trim();
  return SUPPLIER_SALES_LABEL_ALIASES[value] || value;
};

/**
 * 판매시트 블록을 공급사 「상품시트」 탭에 쓰는 행렬로 만든다.
 * 첫 블록은 바로 시작하고, 두 번째 블록부터 빈 줄 하나 뒤 새 머리행을 둔다.
 */
export function buildSupplierPreviewValues(blocks: SupplierPreviewBlock[]): string[][] {
  if (!blocks.length) {
    return [['공급사', '차량번호', '(발행된 판매시트에 이 공급사 줄이 없습니다 — 출고불가만 있거나 아직 발행 전)']];
  }
  const values: string[][] = [];
  blocks.forEach((block, index) => {
    if (index > 0) values.push([]);
    values.push(block.header);
    values.push(...block.rows);
  });
  return values;
}

export const normalizeSupplierLabel = (value: unknown): string =>
  String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();

/** API가 생략하는 행·열 끝 빈칸을 제거해 값 행렬만 비교한다. */
export function trimSheetMatrix(input: unknown[][]): string[][] {
  const rows = input.map((row) => row.map((cell) => String(cell ?? '').trim()));
  while (rows.length && rows[rows.length - 1].every((cell) => !cell)) rows.pop();
  let width = 0;
  for (const row of rows) {
    for (let i = row.length - 1; i >= 0; i--) {
      if (row[i]) { width = Math.max(width, i + 1); break; }
    }
  }
  return rows.map((row) => Array.from({ length: width }, (_, i) => row[i] || ''));
}

export type MatrixDiff = { mismatchedCells: number; expectedRows: number; actualRows: number };

export function compareSheetMatrices(expectedInput: unknown[][], actualInput: unknown[][]): MatrixDiff {
  const expected = trimSheetMatrix(expectedInput);
  const actual = trimSheetMatrix(actualInput);
  const rows = Math.max(expected.length, actual.length);
  const cols = Math.max(expected[0]?.length || 0, actual[0]?.length || 0);
  let mismatchedCells = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((expected[r]?.[c] || '') !== (actual[r]?.[c] || '')) mismatchedCells++;
    }
  }
  return { mismatchedCells, expectedRows: expected.length, actualRows: actual.length };
}
