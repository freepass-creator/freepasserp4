/**
 * **공급사 시트(제공·정제 21곳) 재고 탭 서식을 표준으로 다시 입힌다 — 값은 안 건드린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「글꼴 좀 맞추자 — 이렇잖아」 · 「칸 좀 제대로, 상태랑 이런 거 좀 — 왜 드롭다운도 없냐고」
 *   열을 옮기고(unify) 지우고(drop-supplier-column) 미러가 줄을 붙이는 동안 표(Table)·칩·글꼴이 탭마다 조금씩 갈렸다.
 *   그래서 **한 생성기**(create-supplier-sheet 와 같은 buildBaseFont·buildTemplateFormat·buildChipColors·buildNumberFormats·
 *   buildRowHeights·buildTableRequest·buildSectionBanding·COL_BG)를 모든 재고 탭에 다시 돌린다 — 머리행 그대로, 값 그대로.
 *   같은 생성기라 «표준이 둘» 이 되지 않는다(format-sonogong-subscription-tab·rebuild-mirror-tab-layout 과 같은 길).
 * ★탭의 머리행(차명(세부모델+트림)이 있는 줄)이 1행이 아닌 탭은 건너뛰고 화면에 남긴다(생성기가 1행 머리를 전제한다).
 * ⚠⚠ **`deleteTable` 은 표 안의 값까지 지운다**(실측 2026-08-18 17:52 — 22개 재고 탭이 통째로 비어 revision 에서 되살렸다,
 *   `restore-stock-tabs-from-revision`). 그래서 지우기 전에 탭 값을 통째로 읽어 두고, 서식을 다 입힌 뒤 **값을 그대로 다시 쓴다**
 *   (UNFORMATTED_VALUE 로 읽어 숫자·날짜 원자를 지키고 USER_ENTERED 로 쓴다). 되쓴 값 수가 읽은 값 수와 다르면 멈춘다.
 * ⚠ 표에 딸린 줄무늬는 표를 지운 뒤 다시 읽어 지운다(한 배치에 넣으면 실패).
 * ⚠ 쓰기 쿼터 — 탭 사이에 잠깐 쉰다.
 *
 *   npx tsx scripts/reformat-supplier-stock-tabs.mts
 *   npx tsx scripts/reformat-supplier-stock-tabs.mts --apply
 *   npx tsx scripts/reformat-supplier-stock-tabs.mts --apply --sheet=<ID>
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import {
  AI_TAIL_COLUMNS, SHEET_NAME_MATCH, TEMPLATE_COLUMNS, buildBaseFont, buildChipColors, buildNumberFormats, buildRowHeights,
  buildSectionBanding, buildTableRequest, buildTemplateFormat, columnWidth, isOurNonInventoryTab, periodColumnNote, resetSheetRequests,
  supplierSheetLabel, tableWidth, yearOptions,
} from '../lib/domain/supplier-template-sheet';
import { COL_BG, rgb } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const ROWS = 500;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const noteOf = (name: string) => {
  const t = TEMPLATE_COLUMNS.find((c) => c.name === name) || AI_TAIL_COLUMNS.find((c) => c.name === name);
  if (t) return t.note;
  const m = /^(\d+)개월(\d+만)?/.exec(norm(name));
  if (m) return periodColumnNote(m[2] ? `${m[1]}_${m[2]}` : m[1]);
  return /보증/.test(name) ? '보증금(원, 숫자만) — 오른쪽 기간을 관할한다' : '';
};
const bgOf = (name: string) => {
  if (COL_BG[name]) return COL_BG[name];
  const m = /^(\d+)개월/.exec(norm(name));
  if (m) return COL_BG[`${m[1]}개월`] || (m[1] === '18' ? 'B0DBE0' : m[1] === '6' ? 'CDE9EC' : m[1] === '72' ? 'A7B9F9' : m[1] === '84' ? '99AEF8' : '');
  return '';
};

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
const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(S(f.name)) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
const TARGETS_FILTERED = excludeMirrorSheets([...targets]); targets.length = 0; targets.push(...TARGETS_FILTERED);   // 복사본(--include-mirror 때 같은 배열이 비워지는 버그, 2026-08-19)
console.log(`■ 재고 탭 서식 표준화 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳\n`);
const extras = { 제조사: HANDLED_MAKER_OPTIONS, 연식: yearOptions(new Date().getFullYear()) };
let done = 0; const skipped: string[] = []; const failed: string[] = [];
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets(properties(sheetId,title,hidden),tables.tableId,bandedRanges.bandedRangeId)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ6`)}`) as { values?: string[][] };
    const grid = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = grid.findIndex((r) => r.some((c) => norm(c) === '차명(세부모델+트림)'));
    if (hi < 0) continue;
    if (hi !== 0) { skipped.push(`${t.name}「${title}」 머리행 ${hi + 1}행`); continue; }
    const header = grid[0];
    const cols = header.map((name) => ({ name, note: noteOf(name), required: TEMPLATE_COLUMNS.find((c) => c.name === name)?.required }));
    while (cols.length && !cols[cols.length - 1].name) cols.pop();
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 ${cols.length}열 · 표 ${(sh.tables || []).length} · 줄무늬 ${(sh.bandedRanges || []).length}`);
    if (!APPLY) continue;
    try {
      const gid = p.sheetId;
      // ★값 보전 — deleteTable 이 값을 지우므로 먼저 통째로 읽어 둔다.
      const snap = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ${ROWS + 100}`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`) as { values?: unknown[][] };
      const snapRows = (snap.values || []) as unknown[][];
      const snapCells = snapRows.reduce((n, r) => n + r.filter((c) => c !== '' && c != null).length, 0);
      if ((sh.tables || []).length) await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: (sh.tables as Rec[]).map((x) => ({ deleteTable: { tableId: x.tableId } })) }) });
      const again = await call(`${SH}/${t.id}?fields=sheets(properties(sheetId),bandedRanges.bandedRangeId)`);
      const bands = ((again.sheets || []).find((s: Rec) => s.properties.sheetId === gid)?.bandedRanges || []) as Rec[];
      await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [...bands.map((b) => ({ deleteBanding: { bandedRangeId: b.bandedRangeId } })), ...resetSheetRequests(gid)] }) });
      await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
        ...buildBaseFont(gid, cols.length, ROWS),
        ...buildTemplateFormat(gid, cols, extras, { asTable: true }),
        ...buildChipColors(gid, cols, HANDLED_MAKER_OPTIONS, ROWS),
        ...buildNumberFormats(gid, cols, ROWS),
        ...buildRowHeights(gid, ROWS),
        ...cols.map((c, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: columnWidth(c.name) || 118 }, fields: 'pixelSize' } })),
      ] }) });
      let tableOk = true;
      try { await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [buildTableRequest(gid, cols, extras, ROWS, title)] }) }); }
      catch (e) { tableOk = false; failed.push(`${t.name}「${title}」 표: ${String((e as Error).message).slice(0, 100)}`); }
      try { await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: buildSectionBanding(gid, cols, ROWS, tableWidth(cols)) }) }); }
      catch (e) { failed.push(`${t.name}「${title}」 줄무늬: ${String((e as Error).message).slice(0, 100)}`); }
      const bg: Rec[] = [];
      cols.forEach((c, i) => { const hex = bgOf(c.name); if (hex) bg.push({ repeatCell: { range: { sheetId: gid, startRowIndex: 0, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(hex) } }, fields: 'userEnteredFormat.backgroundColor' } }); });
      if (bg.length) await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: bg }) });
      // ★값 되쓰기 — 지운 표 안의 값을 그대로 돌려놓는다. 되쓴 값 수가 읽은 값 수와 다르면 멈춘다.
      if (snapRows.length) {
        await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values: snapRows.map((r) => r.map((c) => (c == null ? '' : c))) }) });
        const back = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ${ROWS + 100}`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`) as { values?: unknown[][] };
        const backCells = ((back.values || []) as unknown[][]).reduce((n, r) => n + r.filter((c) => c !== '' && c != null).length, 0);
        if (backCells !== snapCells) throw new Error(`값 되쓰기 불일치 — 읽은 ${snapCells}칸 ↔ 되쓴 ${backCells}칸 (revision 에서 되살릴 것)`);
        console.log(`     값 ${snapCells}칸 보전 ✓`);
      }
      done++;
      console.log(`     표 ${tableOk ? '✓' : '✗'} · 대여료 배경 ${bg.length}열`);
      await sleep(2500);
    } catch (e) { failed.push(`${t.name}「${title}」: ${String((e as Error).message).slice(0, 140)}`); }
  }
}
console.log(`\n  ${APPLY ? '반영' : '대상'} 탭 ${done}${skipped.length ? `\n  건너뜀 ${skipped.length}: ${skipped.join(' · ')}` : ''}${failed.length ? `\n  ✗ 실패 ${failed.length}:\n     ${failed.join('\n     ')}` : ''}`);
if (failed.length) process.exitCode = 1;
