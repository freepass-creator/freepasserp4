/**
 * 전 공급사 「프리패스 재고」에서 사본·안내 탭 삭제.
 *   · 「차종마스터」 · 「상품시트」 · 「이 시트는」
 * 기본 dry-run, 반영은 --apply.
 *
 *   npx tsx scripts/delete-supplier-copy-tabs.mts
 *   npx tsx scripts/delete-supplier-copy-tabs.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  SHEET_IDENTITY_TAB,
  SHEET_NAME_MATCH,
  SUPPLIER_PREVIEW_TAB,
  VEHICLE_MASTER_COPY_TAB,
  supplierSheetLabel,
} from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DROP = new Set([VEHICLE_MASTER_COPY_TAB, SUPPLIER_PREVIEW_TAB, SHEET_IDENTITY_TAB]); // 차종마스터 · 상품시트 · 이 시트는
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).trim();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
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
let targets = files
  .map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)), full: S(f.name) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
if (ONLY) targets = targets.filter((t) => t.name.includes(ONLY) || t.full.includes(ONLY));

console.log(`■ 「${[...DROP].join('」·「')}」 탭 삭제 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
let deleted = 0, skipped = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title)`);
  const hits = ((meta.sheets || []) as Rec[])
    .map((s) => s.properties)
    .filter((p) => DROP.has(S(p.title)));
  if (!hits.length) { skipped++; continue; }
  console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(14)} ${hits.map((p) => `「${S(p.title)}」`).join(' ')}`);
  if (!APPLY) { deleted += hits.length; continue; }
  await call(`${SH}/${t.id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: hits.map((p) => ({ deleteSheet: { sheetId: p.sheetId } })) }),
  });
  deleted += hits.length;
  await sleep(600);
}
console.log(APPLY
  ? `  삭제 ${deleted}탭 · 해당없음 ${skipped}곳`
  : `※ dry-run 예정 삭제 ${deleted}탭 · 해당없음 ${skipped}곳. 반영은 --apply`);
