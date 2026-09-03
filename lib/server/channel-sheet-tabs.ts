/**
 * **영업채널 시트의 «뼈대 탭» — 공지사항 · 수수료.**
 *
 * ★사장님 2026-09-03 「공지사항같은거 주면 좋을거 같아 프로모션하는거 알려주고하면 될거 같음」
 *   · 「ys모빌리티 영업채널 정산시트 하나 만들어주라 거기에 공지사항 만들어주고 수수료표 만들어 주고」
 *
 * ★★**왜 여기(공용)인가.** 이 탭을 «세우는 곳»이 둘이다 —
 *   `setup-channel-sheet`(새 채널을 미리 연다) 와 `publish-channel-settlement`(달마다 붙인다).
 *   두 곳에 따로 적으면 한쪽만 고쳐져 채널마다 다른 시트가 된다. 규격은 여기 한 곳이다.
 *
 * ★★★**수수료 탭에는 «지급 요율»만 넣는다.** 공급사에게 청구하는 값(`claim`)은 «절대» 안 들어간다 —
 *   영업채널이 그걸 보면 우리 몫이 그대로 드러나고, 그 자리에서 «우리를 건너뛴 값»이 선다.
 *   (사장님 2026-09-03 「절대 영업자 지급 수수료가 얼만지 공급사시트에는 반영되면 안돼」의 거울.)
 *
 * ⚠ **이미 있으면 손대지 않는다.** 공지사항은 사람이 적는 칸이고, 수수료는 채널과 «합의한» 값이라
 *   매달 돌 때마다 덮으면 적어 둔 것도 고쳐 둔 값도 날아간다.
 */
import { FEE_RULES } from '@/lib/domain/settlement-fee-table';
import { CHANNEL_GUIDE } from '@/lib/domain/channel-guide';
import { CORP } from '@/lib/domain/corporate-ci';

const S = (v: unknown) => String(v ?? '').trim();
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

export const NAVY = { red: 0.06, green: 0.11, blue: 0.21 };
export const TINT = { red: 0.93, green: 0.95, blue: 0.98 };

/**
 * ★**F코드 — 영업채널은 F80번대다**(F01~F05 뼈대 · F50~F70 공급사 재고).
 * ⚠ 번호의 정본은 지도(`aiops/docs/SHEET_MAP.md`)다. 새 채널을 더하면 «둘 다» 고친다.
 */
export const CHANNEL_F_CODE: Record<string, string> = {
  하허호: 'F80', 카핑: 'F81', 렌트야: 'F82', 오토원트: 'F83', SMC: 'F84', YS모빌리티: 'F85',
};
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s()·\-_.]/g, '').replace(/(주식회사|㈜|무심사|모빌리티)/g, '');
export const channelSheetName = (ch: string) => {
  const f = Object.entries(CHANNEL_F_CODE).find(([k]) => key(ch) === key(k))?.[1]
    || Object.entries(CHANNEL_F_CODE).find(([k]) => key(ch).includes(key(k)))?.[1];
  return `[${f || 'F8?'} 사용중] ${ch} 프리패스 정산`;
};

type Tok = () => Promise<string | null | undefined>;
const api = async (tok: Tok, url: string, init?: RequestInit) => fetch(url, {
  ...init, headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });

async function tabs(tok: Tok, bookId: string) {
  const m = await (await api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=sheets.properties(sheetId,title)`)).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  return m.sheets || [];
}

async function addTab(tok: Tok, bookId: string, title: string, index: number, rows: number, cols: number): Promise<number | undefined> {
  const r = await (await api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index, gridProperties: { rowCount: rows, columnCount: cols } } } }] }),
  })).json() as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
  return r.replies?.[0]?.addSheet?.properties?.sheetId;
}

const put = (tok: Tok, bookId: string, range: string, values: (string | number)[][]) =>
  api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values }) });

const format = (tok: Tok, bookId: string, requests: Record<string, unknown>[]) =>
  api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });

/** 제목 띠 + 머리줄 + 열너비 — 두 탭이 같은 짜임을 쓴다. */
const dress = (id: number, cols: number, widths: number[]) => [
  { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols }, mergeType: 'MERGE_ALL' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
    cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
  { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: cols },
    cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' } },
  ...widths.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
  { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
];

/**
 * 「공지사항」 — 맨 왼쪽 탭. **두 부분이다.**
 *
 * ★사장님 2026-09-03 「공지사항에 공지해줄 내용을 정리해보자고」.
 * ```
 * 위   공지 · 프로모션    날짜 | 구분 | 내용 — 그때그때 우리가 적는다(빈 줄을 남겨 둔다)
 * 아래 상시 안내          계약 절차 · 서류 · 접수양식 · 탁송비 — `channel-guide` 가 정본
 * ```
 * ★자주 바뀌는 것이 위다. 채널이 시트를 열면 «새 소식»이 먼저 보여야 알림 노릇을 한다.
 * ⚠ 이미 있으면 손대지 않는다 — 적어 둔 공지가 날아간다.
 */
export async function ensureNoticeTab(tok: Tok, bookId: string): Promise<boolean> {
  const TAB = '공지사항';
  if ((await tabs(tok, bookId)).some((s) => s.properties.title === TAB)) return false;
  const BLANK = 6;                       // 우리가 적을 빈 줄
  const rows: (string | number)[][] = [
    [`${TAB} · 프로모션 — ${CORP.name}`, '', ''],
    ['■ 공지 · 프로모션', '', ''],
    ['날짜', '구분', '내용'],
    ...Array.from({ length: BLANK }, () => ['', '', '']),
    ['', '', ''],
    ...CHANNEL_GUIDE.map(([a, b]) => [a, b, '']),
  ];
  const id = await addTab(tok, bookId, TAB, 0, rows.length + 20, 3);
  if (id === undefined) return false;
  await put(tok, bookId, `'${TAB}'!A1:C${rows.length}`, rows);

  const g0 = 3 + BLANK + 1;              // 상시 안내가 시작하는 줄(0-based)
  /** 「■ …」 로 시작하는 줄은 섹션 머리 — 줄을 통째로 병합해 «칸이 아니라 제목»으로 보이게 한다. */
  const heads = [1, ...CHANNEL_GUIDE.map(([a], i) => (a.startsWith('■') ? g0 + i : -1)).filter((i) => i >= 0)];
  /** 안내 줄은 «내용»이 넓어야 읽힌다 — B:C 를 붙여 한 칸으로 쓴다. */
  const bodies = CHANNEL_GUIDE.map(([a], i) => (a.startsWith('■') ? -1 : g0 + i)).filter((i) => i >= 0);
  await format(tok, bookId, [
    ...dress(id, 3, [180, 90, 730]),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' } },
    ...heads.flatMap((r) => [
      { mergeCells: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
      { repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true, fontSize: 11, foregroundColor: NAVY }, verticalAlignment: 'MIDDLE', padding: { left: 8, right: 8, top: 2, bottom: 2 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
      { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 32 }, fields: 'pixelSize' } },
    ]),
    ...bodies.map((r) => ({ mergeCells: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 3, endRowIndex: rows.length, startColumnIndex: 1, endColumnIndex: 3 },
      cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } },
  ]);
  return true;
}

/** 요율 한 칸을 사람 말로 — 율은 %, 정액은 「건당 N원」, 글로 적힌 것은 그대로. */
const payShow = (v: number | string): string => {
  if (typeof v === 'string') return v;
  if (!v) return '';
  return v >= 1 ? `건당 ${won(v)}` : `${Number((v * 100).toFixed(2))}%`;
};

/**
 * 「수수료」 — **영업채널에 «주는» 요율만.** 공급사별로 한 줄씩.
 *
 * ★빈 표를 주지 않는다 — 지금 쓰는 값(`FEE_RULES.pay`)을 미리 채워 두고 「다르면 고쳐 달라」고 한다.
 *   빈 표를 주면 상대가 자기에게 유리한 값을 새로 적는다(공급사 수수료 탭에서 배운 것).
 * ⚠ `claim`(공급사에게 받는 값)은 이 탭에 «한 칸도» 넣지 않는다.
 */
export async function ensureFeeTab(tok: Tok, bookId: string): Promise<boolean> {
  const TAB = '수수료';
  if ((await tabs(tok, bookId)).some((s) => s.properties.title === TAB)) return false;
  const HEAD = ['공급사', '상품 구분', '계약 기간', '기준', '지급 요율', '언제 드리나', '비고'];
  const WIDTH = [110, 130, 84, 110, 130, 190, 260];
  const body = FEE_RULES.map((r) => [
    r.supplier,
    [r.kind, r.form].filter(Boolean).join(' · '),
    r.term ? `${r.term}개월` : '기간무관',
    r.basis,
    payShow(r.pay),
    r.when,
    [r.auto ? '' : '★사람이 정하는 줄', S(r.note)].filter(Boolean).join(' · '),
  ]);
  const id = await addTab(tok, bookId, TAB, 1, body.length + 12, HEAD.length);
  if (id === undefined) return false;
  await put(tok, bookId, `'${TAB}'!A1:G${body.length + 4}`, [
    [`영업수수료 지급 요율표 — ${CORP.name} 가 드리는 값입니다`, '', '', '', '', '', ''],
    HEAD,
    ...body,
    ['', '', '', '', '', '', ''],
    ['※ 여기 적힌 값으로 매달 정산합니다. 다르면 이 표를 고쳐 주세요 — 고친 값이 다음 정산부터 쓰입니다.', '', '', '', '', '', ''],
  ]);
  const last = body.length + 2;   // 머리줄(2) + 본문
  await format(tok, bookId, [
    ...dress(id, HEAD.length, WIDTH),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: last, startColumnIndex: 0, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: last, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', textFormat: { bold: true } } }, fields: 'userEnteredFormat(horizontalAlignment,textFormat)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: last, startColumnIndex: 1, endColumnIndex: 4 },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    /** ★필터 — 공급사·상품 구분으로 그 자리에서 추린다(정산 탭과 같은 규격). */
    { setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: 1, endRowIndex: last, startColumnIndex: 0, endColumnIndex: HEAD.length } } } },
  ]);
  return true;
}
