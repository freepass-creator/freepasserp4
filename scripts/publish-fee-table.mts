/**
 * **수수료표를 시트에 찍는다.** 옛 탭은 「수수료표 구버전」으로 남긴다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-01 「수수료표를 기존탭 구버전으로 해놓고 수수료표를 새로 만들어주면 돼… 관리하고 보기쉽게」
 *
 * ★정본은 `lib/domain/settlement-fee-table.ts` 다. 이 탭은 «사본»이라 손으로 고치면 다음 발행 때 덮인다.
 *   ⇒ 요율을 바꾸려면 그 파일을 고치고 이 도구를 다시 돌린다.
 * ★옛 탭은 **지우지 않는다** — 태윤 매니저가 적어 둔 원본이라 되짚을 근거다.
 *
 *   npx tsx scripts/publish-fee-table.mts
 *   npx tsx scripts/publish-fee-table.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { FEE_RULES, FEE_TIMING } from '../lib/domain/settlement-fee-table';

const APPLY = process.argv.includes('--apply');
const TAB = '수수료표';
const OLD = '수수료표 구버전';
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

const num = (v: number | string) => (typeof v === 'number' ? v : v);
const HEAD = ['공급사', '갈래', '형태', '계약기간', '셈법', '공급사에서 받을 것', '영업채널에 줄 것', '기계가 낼 수 있나', '청구 시점', '비고'];
const body = FEE_RULES.map((r) => [
  r.supplier, r.kind, r.form || '', r.term || '기간 무관', r.basis,
  num(r.claim), num(r.pay), r.auto ? '예' : '★사람이 정한다', r.when, r.note || '',
]);

console.log(`\n■ 수수료표 — 규칙 ${FEE_RULES.length}줄 · 공급사 ${new Set(FEE_RULES.map((r) => r.supplier)).size}곳 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const byBasis = new Map<string, number>();
for (const r of FEE_RULES) byBasis.set(r.basis, (byBasis.get(r.basis) || 0) + 1);
console.log(`   셈법 — ${[...byBasis].map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.log(`   기계가 낼 수 있는 줄 ${FEE_RULES.filter((r) => r.auto).length} · 사람이 정하는 줄 ${FEE_RULES.filter((r) => !r.auto).length}`);
for (const r of FEE_RULES.filter((x) => !x.auto)) console.log(`      ${r.supplier.padEnd(12)} ${r.kind}${r.term ? ` ${r.term}개월` : ''} ${r.form} — 「${r.claim}」`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. --apply 로 찍는다.\n'); process.exit(0); }

const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
  sheets?: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }[] };
const byTitle = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));

/**
 * ① 옛 탭 이름 바꾸기 — **지우지 않는다.** 태윤 매니저가 적어 둔 원본이라 되짚을 근거다.
 * ⚠ 이름을 바꾸면 「수수료표」는 «없는 탭»이 된다 — 그래서 바꿨으면 반드시 새로 만들어야 한다.
 *   2026-09-01 에 이 순서를 안 지켜 `Unable to parse range: '수수료표'!A1` 로 튕겼다.
 */
const cur = byTitle.get(TAB);
let renamed = false;
if (cur && !byTitle.has(OLD)) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: cur.sheetId, title: OLD }, fields: 'title' } }] }),
  });
  console.log(`   옛 탭 → 「${OLD}」 ${r.status} ${r.ok ? '✓' : (await r.text()).slice(0, 160)}`);
  if (!r.ok) process.exit(1);
  renamed = true;
}

// ② 새 탭 만들기 — 이름을 바꿨으면 「수수료표」는 없으니 반드시 만든다
let prop = renamed ? undefined : byTitle.get(TAB);
if (!prop) {
  const add = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: 1, gridProperties: { rowCount: body.length + 30, columnCount: HEAD.length } } } }] }),
  });
  if (!add.ok) { console.log(`   ✕ 탭 만들기 ${add.status} ${(await add.text()).slice(0, 200)}`); process.exit(1); }
  prop = ((await add.json()) as { replies?: { addSheet?: { properties: NonNullable<typeof prop> } }[] }).replies?.[0]?.addSheet?.properties;
  console.log(`   새 탭 「${TAB}」 만듦`);
}
if (!prop) { console.log('   ✕ 탭을 못 잡았다'); process.exit(1); }

const about = '수수료표 — 이 탭은 «사본»입니다. 정본은 리포 `lib/domain/settlement-fee-table.ts` 이고, 여기서 손으로 고치면 다음 발행 때 덮입니다. '
  + '내용은 박태윤 매니저가 정한 것을 «한 줄 = 한 규칙»으로 편 것입니다(옛 표는 한 칸에 공급사 15곳이 몰려 있었습니다). '
  + '★「기계가 낼 수 있나」가 「사람이 정한다」인 줄은 «최대 9%»·«한 달 렌탈료»처럼 한 값으로 안 떨어지는 것입니다 — 틀린 게 아니라 사람이 넣는 자리입니다. '
  + '옛 표는 「수수료표 구버전」 탭에 그대로 남겨 뒀습니다.';
const timing = [[], ['★ 청구·지급 시점 — 요율과 «따로» 도는 규칙'], ['누가', '어떤 건', '어떻게', '부러지면'],
  ...FEE_TIMING.map((t) => [t.who, t.case, t.how, t.broken])];

await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1:Z400`)}:clear`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: '{}' });
const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, {
  method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ values: [[TAB, about], HEAD, ...body, ...timing] }),
});
console.log(`   쓰기 ${w.status} ${w.ok ? '✓' : (await w.text()).slice(0, 200)}`);
if (!w.ok) process.exit(1);

const id = prop.sheetId; const last = body.length + 2;
const iClaim = HEAD.indexOf('공급사에서 받을 것'); const iPay = HEAD.indexOf('영업채널에 줄 것');
const reqs: Record<string, unknown>[] = [
  { unmergeCells: { range: { sheetId: id } } },
  { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ALL' } },
  { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 56 }, fields: 'pixelSize' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.24, blue: 0.38 }, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: HEAD.length }, cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 }, textFormat: { fontSize: 9, foregroundColor: { red: 0.25, green: 0.28, blue: 0.33 } }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', padding: { left: 8, right: 8, top: 2, bottom: 2 } } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: { red: 1.0, green: 0.95, blue: 0.80 }, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
  { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  // 금액·율은 우측, 나머지 가운데 · 비고는 좌측
  ...HEAD.map((h, j) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: last, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { horizontalAlignment: /받을|줄 것/.test(h) ? 'RIGHT' : /비고|청구 시점/.test(h) ? 'LEFT' : 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)' } })),
  // ★율은 %, 정액은 #,##0 — 한 칸에 섞여 있어 «셀 단위»로 나눈다
  ...FEE_RULES.flatMap((r, i) => [iClaim, iPay].map((j) => {
    const v = j === iClaim ? r.claim : r.pay;
    if (typeof v !== 'number') return null;
    return { repeatCell: { range: { sheetId: id, startRowIndex: i + 2, endRowIndex: i + 3, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { numberFormat: v < 1 ? { type: 'PERCENT', pattern: '0.00%' } : { type: 'NUMBER', pattern: '#,##0"원"' } } }, fields: 'userEnteredFormat.numberFormat' } };
  }).filter(Boolean) as Record<string, unknown>[]),
  // ★사람이 정하는 줄은 흐린 주황 — 「기계가 못 낸다」가 한눈에 보여야 한다
  ...FEE_RULES.map((r, i) => (r.auto ? null : { repeatCell: { range: { sheetId: id, startRowIndex: i + 2, endRowIndex: i + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 1.0, green: 0.93, blue: 0.84 } } }, fields: 'userEnteredFormat.backgroundColor' } })).filter(Boolean) as Record<string, unknown>[],
  { repeatCell: { range: { sheetId: id, startRowIndex: last + 1, endRowIndex: last + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.90, green: 0.94, blue: 0.90 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  { autoResizeDimensions: { dimensions: { sheetId: id, dimension: 'COLUMNS', startIndex: 0, endIndex: HEAD.length } } },
];
const b = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: reqs }) });
console.log(`   서식 ${b.status} ${b.ok ? '✓' : (await b.text()).slice(0, 300)}`);
console.log(`\n   ✓ 끝. https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
process.exit(0);
