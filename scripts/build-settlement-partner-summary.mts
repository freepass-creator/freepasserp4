/**
 * **정산원장 「청구요약」 — 공급사별 청구 − 영업자별 지급 = 수익.** 반영은 `--apply`.
 *
 * ★사장님 2026-08-25
 *   「청구는 월별로 업체별로 필터해서 청구할거니까 공급사에 청구하고」 「공급사 청구용이고」
 *   「공급사별청구 - 영업자별지급 = 수익 이렇게 되어야해」
 *
 * ★**한 표에 세 갈래를 담는다.** 갈래마다 표를 따로 만들면 월을 맞춰 보느라 눈이 왔다 갔다 한다.
 * ```
 * 공급사청구   그 달에 «어느 공급사에 얼마 청구하나». 세금계산서 끊을 단위다
 * 영업자지급   그 달에 «어느 영업자에게 얼마 주나»
 * 수익        그 달 청구 − 지급 − 환수. 상대 칸은 비어 있다
 * ```
 * ★**원천은 「청구」 탭이다.** 거기가 이미 «분납실적 + 완납실적»을 접어 놓은 표라,
 *   여기서 또 원장을 읽으면 두 길이 갈린다.
 * ★환수는 **청구에서 뺀다** — 되돌린 돈이니 그 공급사에 그만큼 덜 청구한다.
 *
 *   npx tsx scripts/build-settlement-partner-summary.mts
 *   npx tsx scripts/build-settlement-partner-summary.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const TAB = '청구요약';
const SRC = '청구';
const VAT = 0.1;
const OUT = ['청구월', '구분', '상대', '건수', '공급가', '부가세', '합계'] as const;
const KIND = { sup: '공급사청구', ag: '영업자지급', profit: '수익' } as const;

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const p2 = (n: number) => String(n).padStart(2, '0');
const SERIAL0 = Date.UTC(1899, 11, 30);
/** ★연·월이 칸으로 나뉘었다 — 이어 붙여 「2026-08」 열쇠를 만든다. */
const ymKey = (y: unknown, m: unknown) => (S(y) && S(m) ? `${S(y)}-${String(Number(S(m))).padStart(2, '0')}` : '');
const ym = (v: string) => {
  const t = S(v);
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) { const u = new Date(SERIAL0 + Math.round(n) * 86_400_000); return `${u.getUTCFullYear()}-${p2(u.getUTCMonth() + 1)}`; }
  return '';
};

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

/**
 * ★**원천은 월별 청구 탭 전부**(`26년08월` 꼴). 청구가 한 장에서 월별 탭으로 갈렸다.
 *   이름 모양으로 찾는다 — 달이 늘어도 도구를 안 고친다.
 */
const meta0 = await api(`${SH}/${LEDGER}?fields=sheets.properties(title)`);
const srcTabs = ((meta0.sheets || []) as any[]).map((x) => S(x.properties.title))
  .filter((t) => /^\d{2}년\d{2}월$/.test(t) || t === SRC).sort();
let head: string[] = [];
const body: string[][] = [];
for (const tb of srcTabs) {
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tb)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  if (!head.length) head = all[hi];
  const ip = all[hi].indexOf('차량번호');
  for (const r of all.slice(hi + 1)) if (S(r[ip])) body.push(r);
}
if (!head.length) { console.log('⛔ 월별 청구 탭을 못 찾았다.'); process.exit(1); }
const at = (n: string) => head.indexOf(n);
console.log(`
   월별 청구 탭 ${srcTabs.length}개 · ${body.length}줄`);

type Cell = { n: number; net: number };
const sup = new Map<string, Cell>();   // 월|공급사
const ag = new Map<string, Cell>();    // 월|영업자
const add = (m: Map<string, Cell>, k: string, net: number) => { const c = m.get(k) || { n: 0, net: 0 }; c.n++; c.net += net; m.set(k, c); };

const [iM, iM2, iSup, iAg, iClaim, iPay, iClaw, iClawAmt] =
  ['청구년', '청구월', '공급사', '영업담당자', '청구액', '지급액', '환수', '환수금액'].map(at);
for (const r of body) {
  const m = ymKey(S(r[iM]), S(r[iM2]));
  if (!m) continue;                                   // 청구월이 없으면 그 달 합계에 못 넣는다
  // ★환수는 청구에서 뺀다 — 되돌린 돈이니 그만큼 덜 청구한다.
  const claw = ON(r[iClaw]) ? N(r[iClawAmt]) : 0;
  add(sup, `${m}|${S(r[iSup]) || '(빈칸)'}`, N(r[iClaim]) - claw);
  add(ag, `${m}|${S(r[iAg]) || '(빈칸)'}`, N(r[iPay]));
}

const months = [...new Set([...sup.keys(), ...ag.keys()].map((k) => k.split('|')[0]))].sort().reverse();
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const rows: string[][] = [];
for (const m of months) {
  const mine = (mp: Map<string, Cell>) => [...mp].filter(([k]) => k.startsWith(`${m}|`)).sort((a, b) => b[1].net - a[1].net);
  const S1 = mine(sup), A1 = mine(ag);
  const tS = S1.reduce((a, [, c]) => a + c.net, 0), tA = A1.reduce((a, [, c]) => a + c.net, 0);
  // ★수익 줄이 맨 위 — 그 달을 열면 제일 먼저 보여야 하는 숫자다.
  rows.push([m, KIND.profit, '', String(S1.reduce((a, [, c]) => a + c.n, 0)), String(Math.round(tS - tA)), '', String(Math.round(tS - tA))]);
  for (const [k, c] of S1) rows.push([m, KIND.sup, k.split('|')[1], String(c.n), String(Math.round(c.net)), String(Math.round(c.net * VAT)), String(Math.round(c.net * (1 + VAT)))]);
  for (const [k, c] of A1) rows.push([m, KIND.ag, k.split('|')[1], String(c.n), String(Math.round(c.net)), String(Math.round(c.net * VAT)), String(Math.round(c.net * (1 + VAT)))]);
}

console.log(`\n■ 청구요약 — ${months.length}달 · ${rows.length}줄 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
for (const m of months.slice(0, 3)) {
  const p = rows.find((r) => r[0] === m && r[1] === KIND.profit)!;
  const s1 = rows.filter((r) => r[0] === m && r[1] === KIND.sup);
  const a2 = rows.filter((r) => r[0] === m && r[1] === KIND.ag);
  console.log(`   ${m}  수익 ${won(N(p[4])).padStart(12)}   공급사 ${s1.length}곳 ${won(s1.reduce((x, r) => x + N(r[4]), 0)).padStart(12)}   영업자 ${a2.length}명 ${won(a2.reduce((x, r) => x + N(r[4]), 0)).padStart(12)}`);
  for (const r of s1.slice(0, 4)) console.log(`        공급사 ${r[2].padEnd(10)} ${String(r[3]).padStart(3)}건 ${won(N(r[4])).padStart(12)}`);
  if (s1.length > 4) console.log(`        … 외 ${s1.length - 4}곳`);
}

writeFileSync('tmp/partner-summary.json', JSON.stringify({ months: months.length, rows: rows.length }, null, 2));
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }

const ABOUT = '청구요약 — 그 달에 «어느 공급사에 얼마 청구하고», «어느 영업자에게 얼마 주고», 「수익」이 얼마인지. '
  + '월과 구분으로 걸러 보세요 — 공급사 한 곳만 걸면 그게 그 달 그 공급사에 끊을 계산서입니다. '
  + '수익 = 공급사청구 − 영업자지급이고, 환수는 청구에서 이미 빼 두었습니다. 기계가 채우니 손대지 마세요.';

const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
let gid = ((meta.sheets || []) as any[]).map((s) => s.properties).find((p: any) => S(p.title) === TAB)?.sheetId;
if (gid === undefined) {
  const made = await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
    addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 12, columnCount: OUT.length, frozenRowCount: 2 } } },
  }] }) });
  gid = made.replies[0].addSheet.properties.sheetId;
}
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1:Z4000`)}:clear`, { method: 'POST', body: '{}' });
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { updateSheetProperties: { properties: { sheetId: Number(gid), gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 }, tabColor: { red: 0.2, green: 0.5, blue: 0.45 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount),tabColor' } },
  { unmergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 } } },
] }) });
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1`)}?valueInputOption=USER_ENTERED`, {
  method: 'PUT', body: JSON.stringify({ values: [[TAB, ABOUT], [...OUT], ...rows] }),
});
// ★월 칸은 RAW 로 — USER_ENTERED 는 "2026-08" 을 날짜로 바꿔 버린다.
if (rows.length) {
  await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A3:A${rows.length + 2}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: rows.map((r) => [r[0]]) }),
  });
}

const FONT = 'Noto Sans KR';
/**
 * ★**너비는 손으로 정한다. `autoResizeDimensions` 를 쓰면 안 된다.**
 *   1행 설명이 B열부터 병합돼 있어서, 자동 맞춤이 그 긴 글에 맞춰 **B열을 화면 절반까지 늘린다**
 *   (실측 2026-08-25 · 사장님 「이렇게 칸 벌어지는거좀 막고」).
 */
const widthOf = (h: string) => (
  /년$/.test(h) ? 56 : /월$/.test(h) ? 46
  : /일$|만료$/.test(h) ? 80
  : /요율$/.test(h) ? 72
  : /금액$|액$|료$|보증금|차량가액|부가세|합계|우리몫|순액/.test(h) ? 98
  : /^환수$|^계약서$|^인도완료$|^계약취소$/.test(h) ? 62
  : /^비고$/.test(h) ? 170
  : /^차량번호$/.test(h) ? 90
  : /^계약기간$|^건수$/.test(h) ? 54
  : 86);

const col = (n: (typeof OUT)[number]) => OUT.indexOf(n);
const last = Math.max(rows.length + 2, 3);
// 옛 조건부 서식을 지우고 다시 건다 — 안 그러면 쌓인다.
{
  const cur0 = await api(`${SH}/${LEDGER}?fields=sheets(properties(sheetId),conditionalFormats)`);
  const cnt = ((cur0.sheets || []) as any[]).find((x) => Number(x.properties?.sheetId) === Number(gid))?.conditionalFormats?.length || 0;
  if (cnt) await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: Array.from({ length: cnt }, (_, i) => ({ deleteConditionalFormatRule: { sheetId: Number(gid), index: cnt - 1 - i } })) }) });
}
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId: Number(gid) }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment)' } },
  { mergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: OUT.length }, mergeType: 'MERGE_ROWS' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, foregroundColor: { red: 0.25, green: 0.29, blue: 0.35 } }, backgroundColor: { red: 0.97, green: 0.98, blue: 1 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy,horizontalAlignment)' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 11, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  { updateDimensionProperties: { range: { sheetId: Number(gid), dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 62 }, fields: 'pixelSize' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
  ...([col('공급가'), col('부가세'), col('합계')].map((c) => ({ repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0;[Red]-#,##0;""' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } }))),
  // 수익 줄은 굵고 옅은 노랑 — 그 달을 열면 제일 먼저 보여야 한다
  { addConditionalFormatRule: { rule: {
    ranges: [{ sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: 0, endColumnIndex: OUT.length }],
    booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$B3="${KIND.profit}"` }] }, format: { backgroundColor: { red: 1, green: 0.97, blue: 0.85 }, textFormat: { bold: true } } },
  }, index: 0 } },
  // 영업자지급은 옅은 주황 — 나가는 돈
  { addConditionalFormatRule: { rule: {
    ranges: [{ sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: 0, endColumnIndex: OUT.length }],
    booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$B3="${KIND.ag}"` }] }, format: { backgroundColor: { red: 1, green: 0.95, blue: 0.92 } } },
  }, index: 1 } },
  { setBasicFilter: { filter: { range: { sheetId: Number(gid), startRowIndex: 1, startColumnIndex: 0, endColumnIndex: OUT.length } } } },
  ...OUT.map((h, i) => ({ updateDimensionProperties: {
    range: { sheetId: Number(gid), dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
    properties: { pixelSize: h === '상대' ? 120 : widthOf(h) }, fields: 'pixelSize',
  } })),
] }) });
console.log(`   ✓ ${TAB} ${rows.length}줄`);

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const h0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n';
const entry = `\n## ${when} · 「${TAB}」 신설 — ${rows.length}줄 / ${months.length}달\n\n도구 \`scripts/build-settlement-partner-summary.mts --apply\`\n사장님 「공급사별청구 - 영업자별지급 = 수익 이렇게 되어야해」 「청구는 월별로 업체별로 필터해서 청구할거니까」.\n한 표에 세 갈래(공급사청구·영업자지급·수익)를 담고 월·구분·상대로 거른다. 환수는 청구에서 이미 뺐다.\n`;
const marker = '> 기계가 정산원장 구조를';
const cut = h0.indexOf(marker);
const insertAt = cut >= 0 ? h0.indexOf('\n', cut) + 1 : h0.length;
writeFileSync(LOG, h0.slice(0, insertAt) + entry + h0.slice(insertAt));

console.log(`\n■ 끝\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
