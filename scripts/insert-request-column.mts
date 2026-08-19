/**
 * **공급사 시트 재고 탭에 「점검사항」 열을 상태 앞(입고일자 뒤)에 넣는다(옛 이름 「요청사항」은 갈아 준다).** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-19 — 「공급사 시트에 일괄 추가할 거 — 상태 앞에 요청사항 칸 만들어 주고 거기에 뭐 좀 해 달라, 차명 제대로 입력해라 이런 걸 쓸 거야」
 *   · 표준 `TEMPLATE_COLUMNS`(차량번호 · 입고일자 · **요청사항** · 상태 · …)에 맞춘다. 프리패스가 적는 칸(보라 머리) — 값이 있으면 노란 바탕(조건부서식)으로 렌트사 눈에 띄게.
 *   · 열을 **넣기만** 한다(insertDimension) — 표(Table) 안이라 표가 같이 늘어난다(사본 실험 2026-08-19: 다른 열 드롭다운 유지). 값·서식·드롭다운은 옮기지 않는다.
 *   · 이미 있으면 건너뛴다(멱등). 21곳 전부(정제시트 포함 — 규격은 같아야 한다, 사장님 「대여료만 다를 수 있음」).
 *
 *   npx tsx scripts/insert-request-column.mts
 *   npx tsx scripts/insert-request-column.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { REQUEST_COLUMN_NAME, REQUEST_COLUMN_OLD_NAMES, SHEET_NAME_MATCH, TEMPLATE_COLUMNS, buildHeaderOwnerColors, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const NOTE = TEMPLATE_COLUMNS.find((c) => c.name === REQUEST_COLUMN_NAME)?.note || '';
let targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(S(f.name)) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
console.log(`■ 「${REQUEST_COLUMN_NAME}」 열 넣기(상태 앞) ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
let done = 0, skipped = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden,gridProperties(rowCount))`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const hdr = (((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ1`)}`) as { values?: string[][] }).values || [])[0] || []).map(S);
    if (!hdr.some((c) => norm(c) === '차명(트림)') || !hdr.some((c) => norm(c) === '차량번호')) continue;
    if (hdr.some((c) => norm(c) === REQUEST_COLUMN_NAME)) { skipped++; console.log(`  · ${t.name.padEnd(10)} 「${title}」 이미 있음`); continue; }
    // 옛 이름(요청사항)이면 머리글만 갈아 준다(값·서식·표는 그대로)
    const oldAt = hdr.findIndex((c) => REQUEST_COLUMN_OLD_NAMES.some((o) => norm(o) === norm(c)));
    if (oldAt >= 0) {
      console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 ${colA1(oldAt)}열 「${hdr[oldAt]}」 → 「${REQUEST_COLUMN_NAME}」 이름 변경`);
      if (APPLY) {
        await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(oldAt)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[REQUEST_COLUMN_NAME]] }) });
        await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ repeatCell: { range: { sheetId: p.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: oldAt, endColumnIndex: oldAt + 1 }, cell: { note: NOTE }, fields: 'note' } }] }) });
        done++; await sleep(600);
      }
      continue;
    }
    const stateAt = hdr.findIndex((c) => norm(c) === '상태');
    const at = stateAt >= 0 ? stateAt : (hdr.findIndex((c) => norm(c) === '입고일자') + 1 || 2);
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 ${colA1(at)}열에 삽입 → ${[...hdr.slice(0, at), REQUEST_COLUMN_NAME, ...hdr.slice(at, at + 2)].join(' | ')} …`);
    if (!APPLY) continue;
    const gid = p.sheetId; const rows = Number(p.gridProperties?.rowCount) || 500;
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, inheritFromBefore: false } }] }) });
    await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(at)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[REQUEST_COLUMN_NAME]] }) });
    const newHdr = [...hdr.slice(0, at), REQUEST_COLUMN_NAME, ...hdr.slice(at)].map((name) => ({ name }));
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
      ...buildHeaderOwnerColors(gid, newHdr),
      { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: at, endColumnIndex: at + 1 }, cell: { note: NOTE }, fields: 'note' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
      // 값이 있으면 노란 바탕 — 렌트사 눈에 띄게(프리패스 요청)
      { addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: rows, startColumnIndex: at, endColumnIndex: at + 1 }], booleanRule: { condition: { type: 'NOT_BLANK' }, format: { backgroundColor: { red: 1, green: 0.95, blue: 0.6 }, textFormat: { bold: true } } } } } },
    ] }) });
    done++; await sleep(1200);
  }
}
console.log(APPLY ? `  반영 탭 ${done} · 이미 있음 ${skipped}` : `※ dry-run. 반영은 --apply (이미 있음 ${skipped})`);
