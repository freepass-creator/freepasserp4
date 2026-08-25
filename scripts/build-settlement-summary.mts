/**
 * **정산원장 「월별 요약」 — 접수 기준 실적과 청구 기준 금액을 한 줄에 나란히.** 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「접수기준이 그달 실적이고 청구는 좀 다른거지」
 *   「계약 접수월과 실적 청구월이 갈리는거지 · 그걸 보기 편하게 해줘야하고 ·
 *    이번달 실적과 청구금액은 다를수 있는거고」
 *
 * ```
 * 왼쪽 — 접수 기준.  그 달에 «받은» 계약. 실적이다
 * 오른쪽 — 청구 기준. 그 달에 «청구한» 돈. 인도가 정한다
 * ```
 * ★**두 축은 같은 줄에 있어도 같은 계약이 아니다.** 8월에 받아 9월에 인도하면
 *   8월 접수 1건 · 9월 청구 1건으로 갈린다. 그래서 두 축을 더하지 마라.
 *
 * ★**옛 「월별 요약」을 갈아엎는다.** 2026-08-21에 옛 도구가 만든 것이라
 *   말이 「정산월」이고(지금은 「청구월」) 지금 원장 427줄과 수가 안 맞았다.
 *
 * ★돈은 **판매수수료(공급사 청구) · 출고수수료(영업자 지급) · 그 차액(우리 몫)**이다.
 *   환수 줄은 그 둘이 비어 있고 부가세 포함 총액만 있어 역산한다(`build-settlement-billing` 과 같은 규칙).
 *
 *   npx tsx scripts/build-settlement-summary.mts
 *   npx tsx scripts/build-settlement-summary.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const TAB = '월별 요약';
const SRC = ['접수', '취소', '분납실적', '완료실적'];
const VAT = 0.1;
const OUT = ['월', '접수', '인도', '인도 전', '취소', '인도율',
  '청구 건수', '청구액', '지급액', '우리몫', '환수 건수'] as const;

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const p2 = (n: number) => String(n).padStart(2, '0');
const SERIAL0 = Date.UTC(1899, 11, 30);
/** ★구글 날짜는 숫자로 온다 — `45301` 을 그냥 `new Date` 에 넣으면 45301년이 된다. */
const d = (v: string) => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : x;
};
/** ★연·월이 칸으로 나뉘었다 — 이어 붙여 「2026-08」 열쇠를 만든다. */
const ymKey = (y: unknown, m: unknown) => (S(y) && S(m) ? `${S(y)}-${String(Number(S(m))).padStart(2, '0')}` : '');
const ym = (v: string) => { const t = S(v); if (/^\d{4}-\d{2}$/.test(t)) return t; const x = d(t); return x ? `${x.getFullYear()}-${p2(x.getMonth() + 1)}` : ''; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

type Row = { head: string[]; r: string[]; tab: string };
const rows: Row[] = [];
for (const tab of SRC) {
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  // ★머리글은 «「차량번호」가 있는 줄»이다 — 1행에는 탭 설명이 붙어 있다.
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) { console.log(`   ${tab} — 머리글을 못 찾았다`); continue; }
  const head = all[hi];
  const body = all.slice(hi + 1).filter((r) => S(r[head.indexOf('차량번호')]));
  for (const r of body) rows.push({ head, r, tab });
  console.log(`   ${tab.padEnd(6)} ${String(body.length).padStart(4)}줄`);
}
if (!rows.length) { console.log('⛔ 읽을 줄이 없다.'); process.exit(1); }
const get = (x: Row, n: string) => { const i = x.head.indexOf(n); return i >= 0 ? S(x.r[i]) : ''; };
/**
 * ★**취소는 «체크»가 말한다**(2026-08-25 개편). 옛 상태 글자 「계약 불가(취소)」는
 *   「계약취소」 체크로 옮겨 담고 비웠다 — 글자만 보면 취소가 0으로 세어진다(실측).
 */
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const isCancel = (x: Row) => ON(get(x, '계약취소')) || /취소|계약\s*불가/.test(get(x, '상태'));

type Cell = { 접수: number; 인도: number; 인도전: number; 취소: number; 청구: number; 청구액: number; 지급액: number; 환수: number };
const zero = (): Cell => ({ 접수: 0, 인도: 0, 인도전: 0, 취소: 0, 청구: 0, 청구액: 0, 지급액: 0, 환수: 0 });
const by = new Map<string, Cell>();
const cell = (m: string) => { if (!by.has(m)) by.set(m, zero()); return by.get(m)!; };

for (const x of rows) {
  const st = S(get(x, '상태'));
  const recv = ym(get(x, '접수일')) || ymKey(get(x, '접수년'), get(x, '접수월'));
  const bill = ymKey(get(x, '청구년'), get(x, '청구월'));
  const back = /환수/.test(st);
  // ── 왼쪽: 접수 기준 실적
  if (recv) {
    const c = cell(recv);
    c.접수++;
    if (isCancel(x)) c.취소++;
    else if (bill) c.인도++;
    else c.인도전++;
  }
  // ── 오른쪽: 청구 기준 금액. 취소는 청구가 없다.
  if (!bill || isCancel(x)) continue;
  const c = cell(bill);
  const claimTot = N(get(x, '청구금액')), payTot = N(get(x, '지급액'));
  // ★환수 줄에는 수수료 칸이 없고 부가세 포함 총액만 있다 — 역산한다.
  const claim = N(get(x, '판매수수료')) || (claimTot ? Math.round(claimTot / (1 + VAT)) : 0);
  const pay = N(get(x, '출고수수료')) || (payTot ? Math.round(payTot / (1 + VAT)) : 0);
  const sign = back ? -1 : 1;
  if (back) c.환수++; else c.청구++;
  c.청구액 += sign * claim;
  c.지급액 += sign * pay;
}

const months = [...by.keys()].filter(Boolean).sort().reverse();
const body = months.map((m) => {
  const c = by.get(m)!;
  const rate = c.접수 - c.취소 > 0 ? c.인도 / (c.접수 - c.취소) : 0;
  // ★원 미만은 버린다 — 원본 수수료에 소수가 섞여 있어 합계에 그대로 딸려 온다.
  const won = (n: number) => Math.round(n);
  return [m, c.접수, c.인도, c.인도전, c.취소, rate, c.청구, won(c.청구액), won(c.지급액), won(c.청구액 - c.지급액), c.환수].map(String);
});
const sum = (k: keyof Cell) => [...by.values()].reduce((a, c) => a + c[k], 0);

const won = (n: number) => n.toLocaleString('ko-KR');
console.log(`\n■ 월별 요약 — ${months.length}달 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`   ${'월'.padEnd(9)}${'접수'.padStart(5)}${'인도'.padStart(5)}${'인도전'.padStart(6)}${'취소'.padStart(5)}   ${'청구'.padStart(4)}${'청구액'.padStart(13)}${'지급액'.padStart(13)}${'우리몫'.padStart(12)}${'환수'.padStart(5)}`);
for (const r of body.slice(0, 14)) {
  console.log(`   ${r[0].padEnd(9)}${r[1].padStart(5)}${r[2].padStart(5)}${r[3].padStart(6)}${r[4].padStart(5)}   ${r[6].padStart(4)}${won(N(r[7])).padStart(13)}${won(N(r[8])).padStart(13)}${won(N(r[9])).padStart(12)}${r[10].padStart(5)}`);
}
if (body.length > 14) console.log(`   … 외 ${body.length - 14}달`);
console.log(`\n   합계   접수 ${sum('접수')} (인도 ${sum('인도')} · 인도 전 ${sum('인도전')} · 취소 ${sum('취소')})`);
console.log(`          청구 ${sum('청구')}건 ${won(sum('청구액'))} · 지급 ${won(sum('지급액'))} · 우리몫 ${won(sum('청구액') - sum('지급액'))} · 환수 ${sum('환수')}건`);
console.log(`   ⚠ 접수와 청구는 **다른 축**이다. 같은 줄에 있어도 같은 계약이 아니라 더하면 안 된다.`);

writeFileSync('tmp/settlement-summary.json', JSON.stringify({ months: months.length, rows: rows.length }, null, 2));
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }

const ABOUT = '월별 요약 — 왼쪽은 «그 달에 받은 계약»(접수 기준 실적), 오른쪽은 «그 달에 청구한 돈»(청구 기준)입니다. '
  + '두 축은 같은 줄에 있어도 같은 계약이 아닙니다 — 8월에 받아 9월에 인도하면 8월 접수 1건 · 9월 청구 1건으로 갈립니다. 더하지 마세요. '
  + '기계가 채웁니다(scripts/build-settlement-summary.mts) — 손으로 고치지 마세요.';

const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
let gid = ((meta.sheets || []) as any[]).map((s) => s.properties).find((p: any) => S(p.title) === TAB)?.sheetId;
if (gid === undefined) {
  const made = await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
    addSheet: { properties: { title: TAB, gridProperties: { rowCount: body.length + 12, columnCount: OUT.length, frozenRowCount: 2 } } },
  }] }) });
  gid = made.replies[0].addSheet.properties.sheetId;
}
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1:Z400`)}:clear`, { method: 'POST', body: '{}' });
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { updateSheetProperties: { properties: { sheetId: Number(gid), gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  { unmergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: OUT.length } } },
] }) });
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1`)}?valueInputOption=USER_ENTERED`, {
  method: 'PUT', body: JSON.stringify({ values: [[TAB, ABOUT], [...OUT], ...body] }),
});
// ★월 칸은 RAW 로 — USER_ENTERED 는 "2026-08" 을 날짜로 바꿔 버린다.
if (body.length) {
  await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A3:A${body.length + 2}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: body.map((r) => [r[0]]) }),
  });
}

const FONT = 'Noto Sans KR';
const col = (n: (typeof OUT)[number]) => OUT.indexOf(n);
const money = (['청구액', '지급액', '우리몫'] as const).map(col);
const count = (['접수', '인도', '인도 전', '취소', '청구 건수', '환수 건수'] as const).map(col);
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId: Number(gid) }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(fontFamily,fontSize)' } },
  // 1행 — 설명 (A1 은 탭 이름, B1 부터 합친다)
  { mergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: OUT.length }, mergeType: 'MERGE_ROWS' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, foregroundColor: { red: 0.25, green: 0.29, blue: 0.35 } }, backgroundColor: { red: 0.97, green: 0.98, blue: 1 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 11, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  { updateDimensionProperties: { range: { sheetId: Number(gid), dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 46 }, fields: 'pixelSize' } },
  // 2행 — 머리글. 접수 축은 초록 띠, 청구 축은 남색 띠로 갈라 놓는다.
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 1, endRowIndex: 2, startColumnIndex: col('접수'), endColumnIndex: col('인도율') + 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.9, green: 0.96, blue: 0.9 } } }, fields: 'userEnteredFormat.backgroundColor' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 1, endRowIndex: 2, startColumnIndex: col('청구 건수'), endColumnIndex: OUT.length }, cell: { userEnteredFormat: { backgroundColor: { red: 0.9, green: 0.91, blue: 0.98 } } }, fields: 'userEnteredFormat.backgroundColor' } },
  ...money.map((c) => ({ repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0;[Red]-#,##0;""' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } })),
  ...count.map((c) => ({ repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0;;""' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } })),
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, startColumnIndex: col('인도율'), endColumnIndex: col('인도율') + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%;;""' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } },
  { setBasicFilter: { filter: { range: { sheetId: Number(gid), startRowIndex: 1, startColumnIndex: 0, endColumnIndex: OUT.length } } } },
  ...OUT.map((h, i) => ({ updateDimensionProperties: {
    range: { sheetId: Number(gid), dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
    properties: { pixelSize: /액$|몫$/.test(h) ? 110 : h === '월' ? 78 : 66 }, fields: 'pixelSize',
  } })),
] }) });
console.log(`   ✓ ${TAB} ${body.length}달`);

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const h0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n';
const entry = `\n## ${when} · 「${TAB}」 다시 세움 — ${body.length}달\n\n도구 \`scripts/build-settlement-summary.mts --apply\`\n왼쪽은 **접수 기준 실적**(그 달에 받은 계약), 오른쪽은 **청구 기준 금액**(그 달에 청구한 돈)이다.\n두 축은 같은 줄에 있어도 같은 계약이 아니다 — 더하면 틀린다.\n옛 표는 2026-08-21에 옛 도구가 만든 것이라 말이 「정산월」이었고 지금 원장 ${rows.length}줄과 수가 안 맞았다.\n`;
const marker = '> 기계가 정산원장 구조를';
const cut = h0.indexOf(marker);
const insertAt = cut >= 0 ? h0.indexOf('\n', cut) + 1 : h0.length;
writeFileSync(LOG, h0.slice(0, insertAt) + entry + h0.slice(insertAt));

console.log(`\n■ 끝\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
