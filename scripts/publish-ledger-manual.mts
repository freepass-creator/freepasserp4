/**
 * **정산원장에 「AI 운영 매뉴얼」 탭을 찍는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「이거 매뉴얼 만들어줘 탭에도 하나 만들어주고 ai가 매뉴얼 읽고 어떻게 움직이는지」.
 *
 * ★**정본은 리포**(`lib/domain/settlement-manual.ts`)이고 이 탭은 사본이다.
 *   규칙이 바뀌면 그 파일을 고치고 이 도구를 다시 돌린다 — 시트에서 손으로 고치면 다음 발행 때 덮인다.
 * ★같은 내용을 `docs/정산원장-매뉴얼.md` 로도 남긴다. 새 세션이 시트를 못 열어도 읽을 수 있게.
 *
 *   npx tsx scripts/publish-ledger-manual.mts
 *   npx tsx scripts/publish-ledger-manual.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { SETTLEMENT_MANUAL } from '../lib/domain/settlement-manual';

const TAB = 'AI 운영 매뉴얼';
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(15_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 160)}`);
  }
};

const HEAD = ['묶음', '항목', '내용'];
const rows = SETTLEMENT_MANUAL.map((r) => [...r]);
const groups = [...new Set(rows.map((r) => r[0]).filter(Boolean))];
console.log(`\n■ 「${TAB}」 — ${rows.length}줄 · 묶음 ${groups.length}개 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
for (const g of groups) console.log(`   ${g.padEnd(24)} ${rows.filter((r) => r[0] === g).length}줄`);

// 리포에도 남긴다 — 시트를 못 열어도 읽을 수 있게.
const md = ['# 정산원장 — AI 운영 매뉴얼', '',
  '> 정본은 `lib/domain/settlement-manual.ts` 다. 이 파일과 원장 「AI 운영 매뉴얼」 탭은 사본이다.',
  '> 규칙이 바뀌면 정본을 고치고 `npx tsx scripts/publish-ledger-manual.mts --apply` 를 돌린다.', ''];
let cur = '';
for (const [g, k, v] of rows) {
  if (g && g !== cur) { cur = g; md.push('', `## ${g}`, ''); }
  md.push(`- **${k}** — ${v}`);
}
if (APPLY) { writeFileSync('docs/정산원장-매뉴얼.md', md.join('\n') + '\n'); console.log('\n   ✓ docs/정산원장-매뉴얼.md'); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }

const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
let gid = ((meta.sheets || []) as any[]).map((s) => s.properties).find((p: any) => S(p.title) === TAB)?.sheetId;
if (gid === undefined) {
  const made = await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
    addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 12, columnCount: 3, frozenRowCount: 2 } } },
  }] }) });
  gid = made.replies[0].addSheet.properties.sheetId;
}
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1:F300`)}:clear`, { method: 'POST', body: '{}' });
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { unmergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 } } },
] }) });
const ABOUT = 'AI 운영 매뉴얼 — 이 원장을 만지기 전에 읽는 것입니다. 사람이 하는 일, 기계가 도는 순서, 절대 규칙, 겪은 함정이 여기 다 있습니다. '
  + '⚠ 정본은 리포 lib/domain/settlement-manual.ts 이고 이 탭은 사본입니다 — 여기서 고치면 다음 발행 때 덮입니다.';
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: [[TAB, ABOUT, ''], HEAD, ...rows] }),
});

const FONT = 'Noto Sans KR';
const last = rows.length + 2;
// 묶음이 바뀌는 자리에 굵은 선 — 눈으로 단락이 갈린다.
const seps = rows.flatMap((r, i) => (i > 0 && r[0] && r[0] !== rows[i - 1][0]
  ? [{ updateBorders: { range: { sheetId: Number(gid), startRowIndex: i + 2, endRowIndex: i + 3, startColumnIndex: 0, endColumnIndex: 3 }, top: { style: 'SOLID_MEDIUM', color: { red: 0.35, green: 0.4, blue: 0.5 } } } }]
  : []));
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId: Number(gid) }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 }, verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)' } },
  { mergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ROWS' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, foregroundColor: { red: 0.25, green: 0.29, blue: 0.35 } }, backgroundColor: { red: 0.97, green: 0.98, blue: 1 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 11, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  { updateDimensionProperties: { range: { sheetId: Number(gid), dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 62 }, fields: 'pixelSize' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
  { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: 0, endColumnIndex: 2 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  { updateDimensionProperties: { range: { sheetId: Number(gid), dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } },
  { updateDimensionProperties: { range: { sheetId: Number(gid), dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
  { updateDimensionProperties: { range: { sheetId: Number(gid), dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 880 }, fields: 'pixelSize' } },
  { updateSheetProperties: { properties: { sheetId: Number(gid), gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 }, tabColor: { red: 0.45, green: 0.35, blue: 0.6 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount),tabColor' } },
  ...seps,
] }) });
console.log(`   ✓ ${TAB} ${rows.length}줄`);
console.log(`\n■ 끝\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
