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
import { FEE_RULES, type FeeRule } from '@/lib/domain/settlement-fee-table';
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

/**
 * ★**틀고정** — 사장님 2026-09-03 「채널시트에 틀고정 할거 재대로 해주고」.
 * ```
 * 뼈대 탭(공지·안내·수수료·회사정보)   머리 두 줄   제목 띠 + 머리글
 * 달별 정산 탭                       머리 네 줄   제목 + 합계 + 머리글
 * ```
 * ⚠ **행만 얼린다 — 열은 안 얼린다.** 제목 띠가 A:끝으로 병합돼 있어, 열을 얼리면 병합이
 *   얼린 칸을 가로질러 시트가 통째로 거부한다(실측 2026-09-03 그것으로 12곳이 400 났다).
 */
const freezeRows = (id: number, n: number) => ({ updateSheetProperties: {
  properties: { sheetId: id, gridProperties: { frozenRowCount: n, frozenColumnCount: 0 } },
  fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } });

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
  freezeRows(id, 2),
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
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(textFormat,verticalAlignment,horizontalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } },
    /** ★「참고」는 곁다리다 — 흐린 글씨로 두어 «내용»이 먼저 읽히게 한다. */
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { fontSize: 9, foregroundColor: { red: 0.42, green: 0.45, blue: 0.5 } } } },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)' } },
    /** ★섹션 머리는 «맨 나중»에 — 먼저 칠하면 뒤의 칸 서식이 덮어 남색 위 검은 글씨가 된다.*/
    ...heads.flatMap((r) => [
      { mergeCells: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
      { repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
      { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
    ]),
  ]);
  return true;
}

/** 요율 한 칸을 사람 말로 — 율은 %, 정액은 「건당 N원」, 글로 적힌 것은 그대로. */
const payShow = (v: number | string): string => {
  if (typeof v === 'string') return v;
  if (!v) return '';
  return v >= 1 ? `건당 ${won(v)}원` : `${Number((v * 100).toFixed(2))}%`;
};

/**
 * **한 줄을 «파는 사람 말»로 옮긴다.**
 *
 * ⚠ 첫 판은 `FEE_RULES` 를 그대로 쏟아 154줄이 나갔다 — 기준·언제 드리나·비고까지 우리 내부 말이
 *   그대로 실렸고, 그 채널이 팔지도 않는 공급사가 스물둘 다 들어갔다(사장님 2026-09-03
 *   「수수료 탭 뭐여 ㅡㅡ;;; 본거 맞아??」). 안 본 채로 찍은 내 잘못이다.
 *
 * ★채널이 묻는 것은 하나다 — **「이걸 팔면 얼마 받나」**. 그래서 세 칸이면 족하다.
 *   상품 구분 │ 지급 수수료 │ 산출 예시
 */
/** 은/는 — 받침이 있으면 「은」. 「손오공 는」 같은 말이 나가면 그 자리에서 신뢰가 깎인다. */
const eun = (w: string) => {
  const last = w.trim().slice(-1).charCodeAt(0);
  const hangul = last >= 0xac00 && last <= 0xd7a3;
  return `${w}${hangul && (last - 0xac00) % 28 ? '은' : '는'}`;
};
const KIND = (r: FeeRule) => `${r.kind}${r.form ? ` (${r.form})` : ''}${r.term ? ` ${r.term}개월` : ''}`;
const HOWMUCH = (r: FeeRule) => {
  const p = payShow(r.pay).replace('12개월구독료 100%', '12개월 구독료의 100%');
  if (typeof r.pay === 'string') return p;
  if (r.basis === '정액') return p;
  if (r.basis === '차량가액') return `차량가액의 ${p}`;
  if (r.basis === '대여료×기간') return `대여료 × 계약기간 × ${p}`;
  return p;
};
const EXAMPLE = (r: FeeRule) => {
  if (typeof r.pay !== 'number') return r.auto ? '' : '영업자 조율';
  if (r.basis === '정액') return '';
  if (r.basis === '차량가액') return `차량가액 4,000만원이면  ${won(40_000_000 * r.pay)}원`;
  if (r.basis === '대여료×기간' && r.term) return `월 80만원 × ${r.term}개월이면  ${won(800_000 * r.term * r.pay)}원`;
  return '';
};

/**
 * 「수수료」 — **영업채널에 «주는» 요율만.**
 *
 * ★★**표준을 한 번만 적는다.** 공급사 스물둘 가운데 열여섯 곳이 «똑같은 사다리»를 쓴다.
 *   그걸 스물두 번 되풀이하면 표가 아니라 벽이 된다. 표준을 한 덩이로 세우고,
 *   «다른 곳»만 아래에 따로 적는다. 그러면 한 화면에 든다.
 * ⚠ `claim`(공급사에게 받는 값)은 이 탭에 «한 칸도» 넣지 않는다.
 */
export async function ensureFeeTab(tok: Tok, bookId: string): Promise<boolean> {
  const TAB = '수수료';
  if ((await tabs(tok, bookId)).some((s) => s.properties.title === TAB)) return false;

  /** 공급사별 «규칙 묶음»을 지문으로 만든다 — 지문이 같으면 같은 조건이다. */
  const sig = (r: FeeRule) => `${KIND(r)}\u0001${HOWMUCH(r)}`;
  /**
   * ★**판매하지 않는 곳은 표에서 버린다** — 사장님 2026-09-03 「스위치는 판매 안하니까 그냥 빼」.
   *   수수료표에는 남아 있지만 영업채널이 팔 수 없는 곳이다. 보이면 「이건 왜 있나」가 된다.
   */
  const NOT_SOLD = ['스위치'];
  const bySup = new Map<string, FeeRule[]>();
  for (const r of FEE_RULES) {
    if (NOT_SOLD.some((n) => r.supplier.includes(n))) continue;
    bySup.set(r.supplier, [...(bySup.get(r.supplier) || []), r]);
  }
  const finger = new Map<string, string>();
  for (const [sup, rs] of bySup) finger.set(sup, rs.map(sig).sort().join('\u0002'));
  const groups = new Map<string, string[]>();
  for (const [sup, f] of finger) groups.set(f, [...(groups.get(f) || []), sup]);
  const [stdFinger, stdSups] = [...groups].sort((a, b) => b[1].length - a[1].length)[0];
  const stdRules = bySup.get(stdSups[0]) || [];
  const others = [...bySup.keys()].filter((s) => finger.get(s) !== stdFinger);

  /**
   * ★**머리는 «이름», 본문은 «문장»** — 사장님 2026-09-03 「무엇을 팔면 / 이렇게 드립니다 … 오글거린다」.
   *   표 머리에 말을 붙이면 느끼하다. 머리글은 라벨이지 인사말이 아니다.
   */
  const HEAD = ['상품 구분', '지급 수수료', '산출 예시'];
  const rows: (string | number)[][] = [
    [`영업수수료 지급 기준 — ${CORP.name}   ·   요율은 모두 «부가세 별도»입니다`, '', ''],
    HEAD,
    [`■ 프리패스 표준 수수료 정책 — ${stdSups.length}개사 공통`, '', ''],
    ['해당 공급사', stdSups.join(' · '), ''],
    ...stdRules.map((r) => [KIND(r), HOWMUCH(r), EXAMPLE(r)]),
  ];
  /**
   * ★★**표준과 «같은 줄»은 다시 적지 않는다.**
   *   손오공은 표준 사다리에 구독 다섯 줄이 «더해진» 것뿐인데,
   *   통째로 다시 찍으면 같은 사다리가 스물두 번 나온다 — 그게 바로 첫 판이 벽이 된 까닭이다.
   *   ⇒ «다른 줄»만 적고, 나머지는 「위와 같습니다」 한 줄로 말한다.
   */
  const stdSet = new Set(stdRules.map(sig));
  for (const sup of others) {
    const rs = bySup.get(sup) || [];
    const diff = rs.filter((r) => !stdSet.has(sig(r)));
    const same = rs.length - diff.length;
    /**
     * ★★**「따로 정합니다」는 쓰지 않는다** — 사장님 2026-09-03 「손오공은 따로 정합니다 이거 뭐냐??」
     *   그 말은 «값을 그때그때 협의한다»로 읽힌다. 받는 사람은 「내 수수료가 고정이 아니구나」 한다.
     *   뜻은 그게 아니다 — «표준과 다른 줄이 있다»일 뿐이고, 그 값도 이미 정해져 있다.
     * ★손오공은 «구독만» 다르고 재렌트·신차는 표준과 같다. 그것까지 머리줄에 적는다 —
     *   안 적으면 구독 다섯 줄만 보고 「재렌트는 어떻게 되나」를 되묻는다.
     */
    const only = [...new Set(diff.map((r) => r.kind))].join('·');
    rows.push([`■ ${sup} — 예외 조건${same ? '   (그 외는 프리패스 표준 수수료 정책과 동일)' : ''}`, '', '']);
    for (const r of (diff.length ? diff : rs)) rows.push([KIND(r), HOWMUCH(r), EXAMPLE(r)]);
  }
  rows.push(['', '', '']);
  rows.push(['※ 위 요율은 부가세 별도입니다 — 정산할 때 부가세 10%를 더해 드립니다.', '', '']);
  rows.push(['※ 「VAT 포함」이라 적힌 줄은 그 값이 이미 부가세를 담고 있는 것입니다.', '', '']);
  rows.push(['※ 이 기준으로 매달 정산합니다. 다른 부분이 있으면 알려 주세요.', '', '']);

  const id = await addTab(tok, bookId, TAB, 2, rows.length + 10, 3);
  if (id === undefined) return false;
  await put(tok, bookId, `'${TAB}'!A1:C${rows.length}`, rows);

  const heads = rows.map((r, i) => (String(r[0]).startsWith('■') ? i : -1)).filter((i) => i > 0);
  await format(tok, bookId, [
    ...dress(id, 3, [230, 300, 330]),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 2 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { bold: true } } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)' } },
    /** ★「예를 들면」은 곁다리 — 흐리게 두어 «얼마»가 먼저 읽히게 한다. */
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: rows.length, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { fontSize: 9, bold: false, foregroundColor: { red: 0.42, green: 0.45, blue: 0.5 } } } },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)' } },
    /**
     * ★★★**섹션 머리는 «맨 나중»에 칠한다.**
     *   먼저 칠하면 뒤에 오는 «칸 서식»(굵은 검은 글씨 · 흐린 작은 글씨)이 그 줄까지 덮어
     *   남색 바탕에 검은 글씨가 된다 — 그냥 «안 보인다»(실측 2026-09-03 사장님 화면).
     *   정산탭에서 「차량번호」가 남색 위 남색이 됐던 것과 «같은 실수»다. 순서가 곧 규칙이다.
     * ★글은 A칸에만 두고 A:C 를 병합한다 — 길어도 접히지 않고 끝까지 넘어간다.
     */
    ...heads.flatMap((r) => [
      { mergeCells: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
      { repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT', wrapStrategy: 'OVERFLOW_CELL', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment,wrapStrategy,padding)' } },
      { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
    ]),
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
    ['상호(법인명)', '예: 주식회사 ○○모빌리티'],
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
    /** ★적을 칸은 «노랗게» — 어디에 적어야 하나를 묻지 않게 한다. */
    ...inputs.map((r) => ({ repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.98, blue: 0.82 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } })),
    ...inputs.map((r) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: g0, endRowIndex: rows.length, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { fontSize: 9, foregroundColor: { red: 0.42, green: 0.45, blue: 0.5 } } } },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)' } },
    /** ★섹션 머리는 «맨 나중»에 — 먼저 칠하면 뒤의 칸 서식이 덮어 남색 위 검은 글씨가 된다.*/
    ...heads.flatMap((r) => [
      { repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
      { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
    ]),
  ]);
  return true;
}

/**
 * **달별 정산 탭의 «머리글» — 여기가 정본이다.**
 *
 * ★`publish-channel-settlement`(값을 채운다)와 `ensureMonthTab`(빈 탭을 미리 세운다)이
 *   «같은 칸»을 써야 한다. 따로 적으면 미리 세운 탭과 나중에 채운 탭의 칸이 어긋난다.
 */
export const SETTLE_BASIS = ['수수료 산정 기준'];
export const SETTLE_NOTE = ['확인', '메모'];
export const CHANNEL_SETTLE_HEAD = ['No.', '차량번호', '접수일', '인도일', '공급사', '모델명', '임차인',
  '상품 구분', '계약 기간', '렌탈료', ...SETTLE_BASIS, '공급가액', '부가세', '합계', '지급 예정일', ...SETTLE_NOTE];
export const CHANNEL_SETTLE_WIDTH = [40, 92, 84, 84, 92, 150, 76, 112, 76, 92, 250, 100, 88, 108, 96, 56, 260];
export const settleTabOf = (m: string) => `${m.slice(2, 4)}년${m.slice(5)}월 정산`;

/**
 * 「26년09월 정산」 같은 **빈 달 탭을 미리 세운다.**
 *
 * ★사장님 2026-09-03 「회사정보 옆으로는 9월 탭 미리 만들어놔」.
 *   ⇒ 달이 바뀌자마자 «둘 곳»이 이미 있어야 한다. 그 달 마감 뒤 `publish-channel-settlement`
 *     가 이 탭을 그대로 찾아 채운다(있으면 새로 만들지 않고 고쳐 쓴다).
 * ★빈 표를 그냥 두지 않고 «언제 채워지는지»를 적어 둔다 — 안 그러면 「왜 비어 있냐」가 된다.
 */
export async function ensureMonthTab(tok: Tok, bookId: string, month: string): Promise<boolean> {
  const TAB = settleTabOf(month);
  if ((await tabs(tok, bookId)).some((s) => s.properties.title === TAB)) return false;
  const H = CHANNEL_SETTLE_HEAD;
  const rows: (string | number)[][] = [
    [`${month.slice(0, 4)}년 ${Number(month.slice(5))}월 정산서    ·    ${CORP.name} 발행`, ...H.slice(1).map(() => '')],
    [...H.slice(0, H.length - 3).map(() => ''), '공급가액', '부가세', '지급 금액'],
    [...H.slice(0, H.length - 3).map(() => ''), '', '', ''],
    H,
    [`${Number(month.slice(5))}월이 마감되면 이 탭에 채워 드립니다.`, ...H.slice(1).map(() => '')],
  ];
  const id = await addTab(tok, bookId, TAB, (await tabs(tok, bookId)).length, 60, H.length);
  if (id === undefined) return false;
  await put(tok, bookId, `'${TAB}'!A1:${String.fromCharCode(64 + H.length)}${rows.length}`, rows);
  await format(tok, bookId, [
    { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: H.length }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: H.length },
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    ...[1, 3].map((r) => ({ repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: H.length },
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: r === 1 ? 'RIGHT' : 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } })),
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: H.length },
      cell: { userEnteredFormat: { backgroundColor: TINT } }, fields: 'userEnteredFormat.backgroundColor' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: H.length },
      cell: { userEnteredFormat: { textFormat: { fontSize: 10, italic: true, foregroundColor: { red: 0.42, green: 0.45, blue: 0.5 } } } }, fields: 'userEnteredFormat.textFormat' } },
    ...CHANNEL_SETTLE_WIDTH.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
    freezeRows(id, 4),
  ]);
  return true;
}
