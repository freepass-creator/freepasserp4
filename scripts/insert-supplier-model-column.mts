/**
 * 전 공급사 「프리패스 재고」 시트 — 「차명(세부모델+트림)」 앞에 「모델명」 열 삽입.
 * 기본 dry-run, 반영은 --apply. 이미 있으면 건너뜀.
 *
 *   npx tsx scripts/insert-supplier-model-column.mts
 *   npx tsx scripts/insert-supplier-model-column.mts --apply
 *   npx tsx scripts/insert-supplier-model-column.mts --apply --only=웰릭스
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, buildHeaderOwnerColors, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).trim();
const COLUMN = '모델명';
const BEFORE = '차명(세부모델+트림)';
const NOTE = '공급사·프리패스가 적는 모델(예: 아반떼 · 그랜저). 차명(세부모델+트림)은 세부 표기 그대로.';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => {
  let t = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 400)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const files = ((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[];
let targets = files.map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)), full: S(f.name) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
if (ONLY) targets = targets.filter((t) => t.name.includes(ONLY) || t.full.includes(ONLY));

console.log(`■ 전 공급사 「${COLUMN}」 ← 「${BEFORE}」 앞 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
let done = 0, skipped = 0, tabs = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties;
    const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const hdr = (((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ1`)}`)).values || [])[0] || []).map(S);
    if (!hdr.some((c) => norm(c) === norm(BEFORE)) || !hdr.some((c) => norm(c) === '차량번호')) continue;
    tabs++;
    if (hdr.some((c) => norm(c) === norm(COLUMN))) { skipped++; continue; }
    const at = hdr.findIndex((c) => norm(c) === norm(BEFORE));
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(12)} 「${title}」 ${colA1(at)}열 앞`);
    if (!APPLY) { done++; continue; }
    const gid = p.sheetId;
    await call(`${SH}/${t.id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, inheritFromBefore: false } }],
      }),
    });
    await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(at)}1`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [[COLUMN]] }),
    });
    const newHdr = [...hdr.slice(0, at), COLUMN, ...hdr.slice(at)].map((name) => ({ name }));
    await call(`${SH}/${t.id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          ...buildHeaderOwnerColors(gid, newHdr),
          { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: at, endColumnIndex: at + 1 }, cell: { note: NOTE }, fields: 'note' } },
          { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
        ],
      }),
    });
    done++;
    await sleep(900);
  }
}
console.log(APPLY
  ? `  삽입 ${done} · 이미 있음 ${skipped} · 재고탭 ${tabs}`
  : `※ dry-run 예정 삽입 ${done} · 이미 있음 ${skipped} · 재고탭 ${tabs}. 반영은 --apply`);
