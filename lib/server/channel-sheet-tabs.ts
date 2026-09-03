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
 * 「공지사항」 — 맨 왼쪽 탭. **공지·프로모션만.**
 *
 * ★사장님 2026-09-03 「공지사항과 영업안내탭을 만들고」 — 둘을 «가른다».
 *   여긴 그때그때 바뀌는 것(프로모션·변경 안내)만 선다. 안 바뀌는 절차는 「영업안내」다.
 *   섞으면 새 소식이 긴 안내문에 묻힌다.
 * ⚠ 이미 있으면 손대지 않는다 — 적어 둔 공지가 날아간다.
 */
export async function ensureNoticeTab(tok: Tok, bookId: string): Promise<boolean> {
  const TAB = '공지사항';
  if ((await tabs(tok, bookId)).some((s) => s.properties.title === TAB)) return false;
  const BLANK = 20;                      // 우리가 적을 빈 줄
  const rows: (string | number)[][] = [
    [`${TAB} · 프로모션 — ${CORP.name}`, '', ''],
    ['날짜', '구분', '내용'],
    ...Array.from({ length: BLANK }, () => ['', '', '']),
  ];
  const id = await addTab(tok, bookId, TAB, 0, rows.length + 40, 3);
  if (id === undefined) return false;
  await put(tok, bookId, `'${TAB}'!A1:C${rows.length}`, rows);
  await format(tok, bookId, [
    ...dress(id, 3, [110, 110, 800]),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, startColumnIndex: 0, endColumnIndex: 2 },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    { setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: 1, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 3 } } } },
  ]);
  return true;
}

/**
 * 「영업안내」 — 계약 절차 · 필요 서류 · 접수 양식 · 탁송비.
 *
 * ★사장님 2026-09-03 「영업절차나 안내 아까 올린거 올려줬으면 좋겠어」 ·
 *   「진행절차랑 좀 잘 정리해서 올리고 싶고」.
 * ★**세 칸으로 읽는다** — 항목 | 내용 | 참고. 조건(얼마·며칠)이 «참고»로 빠져 줄이 안 접힌다.
 * ★내용의 정본은 `lib/domain/channel-guide`. 절차가 바뀌면 «거기»를 고친다 —
 *   그래야 카톡방마다 옛 판이 남는 일이 안 생긴다.
 */
export async function ensureGuideTab(tok: Tok, bookId: string): Promise<boolean> {
  const TAB = '영업안내';
  if ((await tabs(tok, bookId)).some((s) => s.properties.title === TAB)) return false;
  const rows: (string | number)[][] = [
    [`영업안내 — ${CORP.name}`, '', ''],
    ['항목', '내용', '참고'],
    ...CHANNEL_GUIDE.map(([a, b, c]) => [a, b, c]),
  ];
  const id = await addTab(tok, bookId, TAB, 1, rows.length + 20, 3);
  if (id === undefined) return false;
  await put(tok, bookId, `'${TAB}'!A1:C${rows.length}`, rows);

  const g0 = 2;                          // 안내가 시작하는 줄(0-based)
  /** 「■ …」 는 섹션 머리 — 줄을 통째로 병합해 «칸이 아니라 제목»으로 보이게 한다. */
  const heads = CHANNEL_GUIDE.map(([a], i) => (a.startsWith('■') ? g0 + i : -1)).filter((i) => i >= 0);
  await format(tok, bookId, [
    ...dress(id, 3, [170, 560, 330]),
    ...heads.flatMap((r) => [
      { mergeCells: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
      { repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
      { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
    ]),
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(textFormat,verticalAlignment,horizontalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } },
    /** ★「참고」는 곁다리다 — 흐린 글씨로 두어 «내용»이 먼저 읽히게 한다. */
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { fontSize: 9, foregroundColor: { red: 0.42, green: 0.45, blue: 0.5 } } } },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)' } },
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
  /** ★수수료는 셋째 — 공지사항 · 영업안내 다음이다. 그 뒤로 달별 정산 탭이 쌓인다. */
  const id = await addTab(tok, bookId, TAB, 2, body.length + 12, HEAD.length);
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

/**
 * 「회사정보」 — **채널이 «한 번만» 적는 칸.**
 *
 * ★사장님 2026-09-03 「영업채널별 정산시트에 여기도 회사정보 있어야겟네」.
 *   공급사 재고 시트의 「회사정보」와 «같은 짜임»이다 — 다만 축이 뒤집힌다.
 * ```
 * 공급사 회사정보   대여료·보증금을 «받을» 계좌      우리가 그 회사에 준다
 * 채널 회사정보     정산금을 «받을» 계좌 · 세금계산서  우리가 그 회사에 준다
 * ```
 *   ⇒ 정산서의 「지급처」 칸과 지급 계좌가 여기서 채워진다. 지금은 우리가 카톡으로 물어
 *     받아 적고 있어 달마다 다시 묻는다 — 시트에 두면 «한 번 적으면 끝»이다.
 *
 * ★노란 칸(B열)에 값만 적게 한다 — 어디에 적어야 하나를 묻지 않게.
 * ⚠ 이미 있으면 손대지 않는다 — 적어 둔 값이 날아간다.
 */
export async function ensureCompanyTab(tok: Tok, bookId: string): Promise<boolean> {
  const TAB = '회사정보';
  if ((await tabs(tok, bookId)).some((s) => s.properties.title === TAB)) return false;
  /** [항목, 설명] — 항목이 「①②③」로 시작하면 섹션 머리. */
  const FIELDS: [string, string][] = [
    ['① 사업자등록증 정보', '사업자등록증에 적힌 대로 적어 주세요. 정산서 「지급처」 칸에 그대로 실립니다.'],
    ['상호(법인명)', '예: 주식회사 하허호'],
    ['사업자등록번호', '숫자와 - 만 · 예: 110-81-83379'],
    ['대표자', '예: 홍길동'],
    ['사업장 주소', '도로명 주소'],
    ['업태 · 종목', '참고 · 예: 서비스 · 자동차임대중개'],
    ['② 연락처', '정산 자료를 보낼 곳입니다.'],
    ['담당자 이름', '프리패스가 연락할 사람'],
    ['담당자 연락처', '휴대전화 · 예: 010-0000-0000'],
    ['정산서 받을 이메일', '매달 정산서가 이 주소로 갑니다'],
    ['세금계산서 담당 이메일', '위와 같으면 「위와 같음」이라고 적어 주세요'],
    ['③ 정산금 받을 계좌', '수수료가 들어갈 계좌입니다. 예금주는 상호와 같아야 합니다.'],
    ['은행', '예: 신한'],
    ['계좌번호', '숫자와 - 만'],
    ['예금주', '상호와 다르면 사유를 「설명」 칸에 적어 주세요'],
  ];
  const rows: (string | number)[][] = [
    [`회사정보 — ${CORP.name} 정산용`, '', ''],
    ['항목', '입력 (여기에 적어 주세요)', '설명'],
    ...FIELDS.map(([a, b]) => [a, '', b]),
  ];
  const id = await addTab(tok, bookId, TAB, 3, rows.length + 10, 3);
  if (id === undefined) return false;
  await put(tok, bookId, `'${TAB}'!A1:C${rows.length}`, rows);

  const g0 = 2;
  const heads = FIELDS.map(([a], i) => (/^[①②③]/.test(a) ? g0 + i : -1)).filter((i) => i >= 0);
  const inputs = FIELDS.map(([a], i) => (/^[①②③]/.test(a) ? -1 : g0 + i)).filter((i) => i >= 0);
  await format(tok, bookId, [
    ...dress(id, 3, [190, 320, 460]),
    ...heads.flatMap((r) => [
      { repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
      { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
    ]),
    /** ★적을 칸은 «노랗게» — 어디에 적어야 하나를 묻지 않게 한다. */
    ...inputs.map((r) => ({ repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.98, blue: 0.82 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } })),
    ...inputs.map((r) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { fontSize: 9, foregroundColor: { red: 0.42, green: 0.45, blue: 0.5 } } } },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)' } },
  ]);
  return true;
}
