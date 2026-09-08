/**
 * **접수 탭의 «옷»을 되돌린다 — 줄을 이어 붙인 뒤에 반드시 부른다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-08 「접수시트가 왜 갑자기 저렇게 됐지?」 · 「가운데가 왜 확 벌어졌지??」
 *   · 「밑에 있는 거에 아래로 약 100줄 정도 남겨주면 돼」 · 「이거 재발 방지해줘」
 *
 * ★★**무슨 일이 있었나.** `values:append` 로 줄을 이어 붙이면 구글이 **바로 위 줄의 서식을 물려준다.**
 *   그런데 물려받는 것이 반쪽이다 —
 * ```
 * 물려받은 것    바탕색 · 글자 크기
 * 못 받은 것     ★아래 테두리          → 그 줄부터 «표가 벌어져» 보인다
 * 잘못 받은 것   ★청구년·청구월의 날짜 서식 → 청구월 8 이 「00-01-07」 로 찍힌다
 * ```
 *   실측 2026-09-08 — 84~91행 여덟 줄이 그렇게 됐고, 대표님이 화면에서 바로 알아보셨다.
 *
 * ★**아래로 여백을 남긴다.** 값이 있는 마지막 줄에 시트가 딱 끝나 있으면 사람이 손으로 적을 자리가 없다.
 *   ⇒ 100줄을 남기고, 그 줄에도 같은 옷을 입혀 둔다. 적으면 그대로 표가 이어진다.
 *
 * ⚠ **본보기는 «우리가 붙이기 전» 줄을 쓴다.** 방금 붙인 줄을 본보기로 삼으면 틀어진 옷을 그대로 퍼뜨린다.
 *
 * ```
 * npx tsx scripts/heal-intake-format.mts
 * npx tsx scripts/heal-intake-format.mts --apply
 * npx tsx scripts/heal-intake-format.mts --탭=완납실적 --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const S = (v: unknown) => String(v ?? '').trim();
const arg = (n: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const TAB = S(arg('탭')) || '접수';
/** 값이 있는 마지막 줄 아래로 남길 빈 줄 수. */
const SPARE = Number(arg('여백')) || 100;
const APPLY = process.argv.includes('--apply');
const F04 = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
/** 날짜로 물들면 안 되는 «수» 칸 — 여기가 날짜 서식을 받으면 8 이 「00-01-07」 이 된다. */
const PLAIN_INT = ['청구년', '청구월', '계약기간', '납입회차'];
/**
 * ★★**글을 적는 칸** — 옷을 바를 때 체크박스가 묻으면 사람이 적을 길을 잃는다.
 *   사장님 2026-09-08 「가감사유가 왜 박스야?? 가감사유는 입력하는 건데」
 *   ⇒ 옷을 입힌 뒤 이 칸은 데이터 확인을 걷고 왼쪽 정렬로 되돌린다.
 */
const FREE_TEXT = ['가감사유', '비고', '계약번호', '환수사유'];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (u: string, m?: string, b?: unknown) => {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${F04}${u}`, { method: m || 'GET',
    headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  if (!r.ok) { console.log(`\n  ✕ ${r.status} — ${(await r.text()).slice(0, 180)}\n`); process.exit(1); }
  return r.json() as Promise<Record<string, unknown>>;
};

const meta = (await api('?fields=sheets.properties(title,sheetId,gridProperties)')) as {
  sheets?: { properties: { title: string; sheetId: number; gridProperties: { rowCount: number; columnCount: number } } }[] };
const sh = (meta.sheets || []).find((s) => s.properties.title === TAB)?.properties;
if (!sh) { console.log(`\n  ✕ 「${TAB}」 탭이 없습니다\n`); process.exit(1); }
const { rowCount: rc, columnCount: cc } = sh.gridProperties;

const g = (((await api(`/values/${encodeURIComponent(`'${TAB}'!A1:BB${rc}`)}`)) as { values?: unknown[][] }).values) || [];
const head = (g.find((r) => (r || []).some((c) => S(c) === '차량번호')) || []).map(S);
let last = 0; g.forEach((r, i) => { if ((r || []).map(S).some(Boolean)) last = i + 1; });
if (!last) { console.log('\n  ✕ 값이 있는 줄을 못 찾았습니다\n'); process.exit(1); }

/**
 * ★**옷 본보기 = 「우리가 붙이기 전」 줄.** 아래 테두리가 살아 있는 마지막 줄을 찾는다.
 *   못 찾으면 표의 첫 줄을 쓴다 — 그게 원래 옷이다.
 */
const fmt = (await api(`?ranges=${encodeURIComponent(`'${TAB}'!A1:B${last}`)}&fields=sheets(data(rowData(values(effectiveFormat.borders))))&includeGridData=true`)) as {
  sheets?: { data?: { rowData?: { values?: { effectiveFormat?: { borders?: Record<string, unknown> } }[] }[] }[] }[] };
const rowsFmt = fmt.sheets?.[0]?.data?.[0]?.rowData || [];
const hasBorder = (i: number) => !!(rowsFmt[i]?.values || [])[1]?.effectiveFormat?.borders;
let src = 0;
for (let i = last - 1; i >= 2; i--) { if (hasBorder(i)) { src = i + 1; break; } }
if (!src) src = 3;
/** 본보기 아래 «옷이 없는» 첫 줄부터 고친다. */
let from = src + 1;
while (from <= last && hasBorder(from - 1)) from++;
const to = last + SPARE;

console.log(`\n■ 「${TAB}」 — ${rc}행 · 값이 있는 마지막 줄 ${last}행`);
console.log(`   옷 본보기 ${src}행 · 입힐 범위 ${from}~${to}행 · 줄 늘리기 ${rc} → ${Math.max(rc, to)}행 (여백 ${SPARE}줄)`);
if (from > to) { console.log('\n  ✓ 고칠 것이 없습니다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 바꿨습니다. --apply 로 되돌립니다.\n'); process.exit(0); }

const reqs: Record<string, unknown>[] = [];
if (to > rc) reqs.push({ appendDimension: { sheetId: sh.sheetId, dimension: 'ROWS', length: to - rc } });
reqs.push({ copyPaste: {
  source: { sheetId: sh.sheetId, startRowIndex: src - 1, endRowIndex: src, startColumnIndex: 0, endColumnIndex: cc },
  destination: { sheetId: sh.sheetId, startRowIndex: from - 1, endRowIndex: to, startColumnIndex: 0, endColumnIndex: cc },
  pasteType: 'PASTE_FORMAT' } });
/** ★수 칸은 옷을 입힌 «뒤에» 되돌린다 — 본보기에 날짜 서식이 섞여 있으면 같이 퍼진다. */
for (const n of PLAIN_INT) {
  const c = head.indexOf(n); if (c < 0) continue;
  reqs.push({ repeatCell: { range: { sheetId: sh.sheetId, startRowIndex: 2, endRowIndex: to, startColumnIndex: c, endColumnIndex: c + 1 },
    cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0' }, horizontalAlignment: 'CENTER' } },
    fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } });
}
/** ★글 칸은 체크박스를 걷고 왼쪽 정렬로 — 옷을 바른 뒤에 한다. */
for (const n of FREE_TEXT) {
  const c = head.indexOf(n); if (c < 0) continue;
  const range = { sheetId: sh.sheetId, startRowIndex: 2, endRowIndex: to, startColumnIndex: c, endColumnIndex: c + 1 };
  reqs.push({ setDataValidation: { range } });
  reqs.push({ repeatCell: { range, cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat.horizontalAlignment' } });
}
await api(':batchUpdate', 'POST', { requests: reqs });
/**
 * ★★★**옷만 입히고 «값은 비운다».**
 *   PASTE_FORMAT 은 체크박스(데이터 확인) 까지 같이 바른다. 그러면 빈 줄마다
 *   FALSE 가 «값»으로 생겨, 값 있는 마지막 줄이 191행으로 잎힌다 —
 *   줄을 이어 붙이는 도구가 그 아래부터 쓰게 되고, 세는 것마다 100줄이 더 셀어진다.
 *   ⇒ 옷을 입힌 뒤 «여백 줄»의 값을 비운다. 체크박스는 빈 채로 남아 적기 좋다.
 */
if (to > last) {
  const rr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${F04}/values/${encodeURIComponent(`'${TAB}'!A${last + 1}:BB${to}`)}:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!rr.ok) { console.log(`
  ✕ 여백 줄을 못 비웠습니다 ${rr.status}
`); process.exit(1); }
  console.log(`   · 여백 ${last + 1}~${to}행의 값을 비웠습니다(체크박스가 FALSE 로 남지 않게).`);
}
console.log(`\n  ✓ ${from}~${to}행에 옷을 입히고 ${PLAIN_INT.length}개 수 칸을 정수로 되돌렸습니다.\n`);
process.exit(0);
