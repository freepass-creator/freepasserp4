/**
 * **정제칸 하나를 제자리로 옮긴다** — 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-22 「인승은 정제가 아니고 있는 거 하는 거니까 차종크기 앞으로 보내주면 되는데 ·
 *   차종크기 앞에 그냥 모을 수 있는 정보를 모으는 거야」)
 *   `add-supplier-ai-columns` 는 새 칸을 **표 맨 뒤에** 붙인다. 그래서 인승이 「차명(정제)」 뒤에 가 있었다.
 *   정제칸은 «이름 축 → 제원 축 → 분류 축» 차례라 제원(구동방식·인승)은 차종크기 앞에 모여야 읽힌다.
 *
 * ⚠ 값과 함께 옮긴다(열 통째 이동). 표(Table) 범위 안에서 움직이므로 정렬·필터가 깨지지 않는다.
 *
 *   npx tsx scripts/move-ai-column.mts --col=인승 --before=차종크기
 *   npx tsx scripts/move-ai-column.mts --col=인승 --before=차종크기 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
const arg = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};
const COL = arg('col');
const BEFORE = arg('before');
if (!COL || !BEFORE) { console.error('--col=<옮길 열> --before=<이 열 앞으로> 가 필요하다'); process.exit(1); }

const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const call = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { console.log(`       … ${r.status} — ${5 * 2 ** n}초 쉬고 다시`); await sleep(5000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const sheets = (found.files || []).map((f: any) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)) }));

console.log(`■ 정제칸 「${COL}」을 「${BEFORE}」 앞으로 ${APPLY ? '이동' : '미리보기'} — ${sheets.length}곳\n`);
let moved = 0; let already = 0; let absent = 0;

for (const t of sheets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(title,hidden,sheetId)`);
  for (const sh of (meta.sheets || [])) {
    const title = S(sh.properties.title);
    if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
    const gid = Number(sh.properties.sheetId);
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ3`)}`);
    const rows: string[][] = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
    const head = rows.find((r) => r.includes('차량번호'));
    if (!head) continue;
    const from = head.indexOf(COL);
    const to = head.indexOf(BEFORE);
    if (from < 0 || to < 0) { absent++; continue; }
    if (from === to - 1) { already++; continue; }
    console.log(`  → ${t.name} 「${title}」 — ${from + 1}번 → ${to + 1}번 앞`);
    if (!APPLY) continue;
    /**
     * Google Sheets moveDimension 은 «옮긴 뒤의 자리»를 destinationIndex 로 받는다.
     * 왼쪽으로 옮길 때는 그대로, 오른쪽으로 옮길 때는 자기 자신이 빠진 만큼 +1 을 더해야 제자리에 선다.
     */
    const destination = from < to ? to : to;
    await call(`${SH}/${t.id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ moveDimension: {
        source: { sheetId: gid, dimension: 'COLUMNS', startIndex: from, endIndex: from + 1 },
        destinationIndex: destination,
      } }] }),
    });
    moved++;
    await sleep(250);
  }
}
console.log(`\n  옮김 ${moved} · 이미 제자리 ${already} · 열 없음 ${absent}`);
if (!APPLY) console.log('※ dry-run. 반영은 --apply');
