/**
 * 정제칸을 AI_TAIL_COLUMNS 차례로 맞춘다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-23 — 정제시트 정제칸 읽는 차례:
 *   원산지 · 제조사 · 모델 · 세부모델 · 세부트림 · 외장 · 내장 · 연식 · 주행거리 ·
 *   연료 · 배기량 · 구동 · 인승 · 차종구분 · 배터리.
 *   연식·주행거리는 **정제시트만** 정제칸 옆으로 옮긴다. 제공시트 왼쪽 입력칸은 그대로 둔다.
 *
 *   npx tsx scripts/reorder-ai-columns.mts
 *   npx tsx scripts/reorder-ai-columns.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isLegacySheetId } from '../lib/domain/legacy-sheets';
import { isMirrorSheet } from '../lib/domain/mirror-sources';
import { AI_TAIL_COLUMNS, LEGACY_SHEET_PREFIX, SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
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
    if ((r.status === 429 || r.status >= 500) && n < 5) {
      console.log(`       … ${r.status} — ${5 * 2 ** n}초 쉬고 다시`);
      await sleep(5000 * 2 ** n);
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const desiredOf = (head: string[], mirror: boolean) => {
  const names = AI_TAIL_COLUMNS.map((c) => c.name);
  if (mirror && head.includes('연식') && head.includes('주행거리')) {
    const i = names.indexOf('내장색상');
    if (i >= 0) names.splice(i + 1, 0, '연식', '주행거리');
  }
  return names.filter((n) => head.includes(n));
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const sheets = (found.files || [])
  .map((f: any) => ({ id: S(f.id), name: S(f.name) }))
  .filter((t: { id: string; name: string }) =>
    !isLegacySheetId(t.id) && !t.name.startsWith(LEGACY_SHEET_PREFIX) && !/구버전/.test(t.name))
  .map((t: { id: string; name: string }) => ({ id: t.id, name: supplierSheetLabel(t.name) }));

console.log(`■ 정제칸 차례 맞추기 ${APPLY ? '반영' : '미리보기'} — ${sheets.length}곳 (정제시트 포함)\n`);

let moved = 0;
let already = 0;
let tabs = 0;

for (const t of sheets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(title,hidden,sheetId)`);
  const mirror = isMirrorSheet(t.id);
  for (const sh of (meta.sheets || [])) {
    const title = S(sh.properties.title);
    if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
    const gid = Number(sh.properties.sheetId);
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ3`)}`);
    const rows: string[][] = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
    const head = rows.find((r) => r.includes('차량번호'));
    if (!head) continue;
    tabs++;
    const desired = desiredOf(head, mirror);
    if (desired.length < 2) continue;
    const startName = desired.find((n) => AI_TAIL_COLUMNS.some((c) => c.name === n)) || desired[0];
    const start = head.indexOf(startName);
    if (start < 0) continue;
    const slice = head.slice(start, start + desired.length);
    if (desired.every((n, i) => slice[i] === n)) { already++; continue; }

    console.log(`  → ${t.name}${mirror ? '(정제)' : ''} 「${title}」`);
    const live = [...head];
    for (let i = 0; i < desired.length; i++) {
      const name = desired[i];
      const from = live.indexOf(name);
      const startNow = live.indexOf(startName);
      const dest = startNow + i;
      if (from < 0 || startNow < 0 || from === dest) continue;
      console.log(`     ${from + 1}번 「${name}」 → ${dest + 1}번`);
      if (APPLY) {
        const destinationIndex = from < dest ? dest + 1 : dest;
        await call(`${SH}/${t.id}:batchUpdate`, {
          method: 'POST',
          body: JSON.stringify({ requests: [{ moveDimension: {
            source: { sheetId: gid, dimension: 'COLUMNS', startIndex: from, endIndex: from + 1 },
            destinationIndex,
          } }] }),
        });
        await sleep(200);
      }
      const [x] = live.splice(from, 1);
      live.splice(dest, 0, x);
      moved++;
    }
  }
}

console.log(`\n  탭 ${tabs} · 옮긴 열 ${moved} · 이미 제자리 ${already}`);
if (!APPLY) console.log('※ dry-run. 반영은 --apply');
