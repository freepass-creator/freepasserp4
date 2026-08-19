/**
 * **공급사 시트 재고 탭의 표(Table)를 끝 열까지 넓힌다** — 표에서 정렬/필터해도 줄 «전체»(대여료·정제칸까지)가 같이 움직이게. 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-19 실측 — 사장님 「공급사 시트를 댕겨오기 쉽게 만들어 놓고 매뉴얼화」)
 *   표가 A~K(차량번호…연식)만 감싸고 있어 표에서 정렬하면 그 11칸만 줄이 바뀌고 주행거리·대여료·정제칸은 제자리 → 차량번호와 어긋난다(스펙·옵션 제보의 뿌리 중 하나).
 * ★방법(사본 실험 2026-08-19): ① 표 밖 우리 줄무늬(bandedRange)를 지운다(표 자체 줄무늬 A~K 는 남긴다 — 지우면 표가 사라진다)
 *   ② 확장 범위의 배경을 비운다(표는 「교차 배경」이 이미 있는 범위로는 못 넓힌다) ③ updateTable 로 범위를 머리행 끝 열까지 ④ 머리 색(남색/보라)·구분선을 되칠한다.
 *   대여료 열 배경은 뒤이어 `paint-supplier-period-columns --include-mirror --apply` 로 다시 칠한다(run-daily 밖, 이 도구 끝에서 안내).
 * ★드롭다운(상태·분류·제조사·색상·연식)은 그대로. 값은 건드리지 않는다. 이미 끝 열까지면 건너뛴다(멱등). deleteTable 은 쓰지 않는다(값이 지워진다).
 *
 *   npx tsx scripts/extend-supplier-table.mts
 *   npx tsx scripts/extend-supplier-table.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, buildDividerFormat, buildHeaderOwnerColors, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
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
let targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(S(f.name)) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
console.log(`■ 재고 탭 표(Table) 끝 열까지 넓히기 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
let done = 0, already = 0, noTable = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets(properties(sheetId,title,hidden,gridProperties(rowCount)),tables(tableId,range,columnProperties(columnName)),bandedRanges(bandedRangeId,range))`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const hdr = (((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ1`)}`) as { values?: string[][] }).values || [])[0] || []).map(S);
    if (!hdr.some((c) => c.replace(/\s/g, '') === '차명(트림)') || !hdr.includes('차량번호')) continue;
    const width = hdr.length;
    const table = ((sh.tables || []) as Rec[])[0];
    if (!table) { noTable++; console.log(`  · ${t.name.padEnd(10)} 「${title}」 표 없음(그대로)`); continue; }
    const cur = Number(table.range?.endColumnIndex || 0);
    if (cur >= width) { already++; console.log(`  · ${t.name.padEnd(10)} 「${title}」 이미 끝 열까지(${cur})`); continue; }
    const bandIds = ((sh.bandedRanges || []) as Rec[]).filter((b) => Number(b.range?.startColumnIndex) >= cur).map((b) => b.bandedRangeId);
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 표 ${cur}열 → ${width}열 (우리 줄무늬 ${bandIds.length}개 걷음)`);
    if (!APPLY) continue;
    const gid = p.sheetId; const rowCount = Number(table.range?.endRowIndex || p.gridProperties?.rowCount || 500);
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
      ...bandIds.map((id: number) => ({ deleteBanding: { bandedRangeId: id } })),
      { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: cur, endColumnIndex: width }, cell: { userEnteredFormat: { backgroundColor: null } }, fields: 'userEnteredFormat.backgroundColor' } },
      { updateTable: { table: { tableId: table.tableId, range: { sheetId: gid, startRowIndex: Number(table.range.startRowIndex || 0), endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: width } }, fields: 'range' } },
    ] }) });
    // 머리 색(렌트사 남색은 표 머리 스타일이 이미, 우리 칸 보라)·구분선 되칠하기
    const cols = hdr.map((name) => ({ name }));
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [...buildHeaderOwnerColors(gid, cols), ...buildDividerFormat(gid, cols, rowCount)] }) });
    done++; await sleep(1200);
  }
}
console.log(APPLY ? `  넓힘 ${done} · 이미 ${already} · 표 없음 ${noTable} — 다음: npx tsx scripts/paint-supplier-period-columns.mts --include-mirror --apply (대여료 배경 되칠하기)` : `※ dry-run. 반영은 --apply (이미 ${already} · 표 없음 ${noTable})`);
