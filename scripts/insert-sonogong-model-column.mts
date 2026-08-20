/**
 * 손오공 제공시트만 — 「차명(세부모델+트림)」 앞에 「모델명」 열 1칸 삽입.
 * 기본 dry-run, 반영은 --apply.
 *
 *   npx tsx scripts/insert-sonogong-model-column.mts
 *   npx tsx scripts/insert-sonogong-model-column.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { buildHeaderOwnerColors, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const SHEET_ID = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA'; // 손오공 제공시트
const COLUMN = '모델명';
const BEFORE = '차명(세부모델+트림)';
const NOTE = '공급사가 적는 모델(예: 아반떼 · 그랜저). 차명(세부모델+트림)은 세부 표기 그대로.';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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

console.log(`■ 손오공 「${COLUMN}」 ← 「${BEFORE}」 앞 ${APPLY ? '반영' : '미리보기'}`);
const meta = await call(`${SH}/${SHEET_ID}?fields=sheets.properties(sheetId,title,hidden,gridProperties(rowCount))`);
let done = 0, skipped = 0;
for (const sh of (meta.sheets || []) as Rec[]) {
  const p = sh.properties;
  const title = S(p.title);
  if (p.hidden || isOurNonInventoryTab(title)) continue;
  const hdr = (((await call(`${SH}/${SHEET_ID}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ3`)}`)).values || []) as string[][])
    .find((row) => row.some((c) => norm(c) === norm(BEFORE)) && row.some((c) => norm(c) === '차량번호'))
    ?.map(S) || [];
  if (!hdr.length) { console.log(`  · 「${title}」 재고 머리행 아님 — 건너뜀`); continue; }
  if (hdr.some((c) => norm(c) === norm(COLUMN))) { skipped++; console.log(`  · 「${title}」 이미 「${COLUMN}」 있음`); continue; }
  const at = hdr.findIndex((c) => norm(c) === norm(BEFORE));
  if (at < 0) { console.log(`  △ 「${title}」 「${BEFORE}」 없음`); continue; }
  console.log(`  ${APPLY ? '✓' : '→'} 「${title}」 ${colA1(at)}열 앞 삽입 → … | ${hdr[at - 1] || '(시작)'} | 【${COLUMN}】 | ${BEFORE} | …`);
  if (!APPLY) continue;
  const gid = p.sheetId;
  await call(`${SH}/${SHEET_ID}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, inheritFromBefore: false } }],
    }),
  });
  await call(`${SH}/${SHEET_ID}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(at)}1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[COLUMN]] }),
  });
  const newHdr = [...hdr.slice(0, at), COLUMN, ...hdr.slice(at)].map((name) => ({ name }));
  await call(`${SH}/${SHEET_ID}:batchUpdate`, {
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
  await sleep(800);
}
console.log(APPLY ? `  반영 ${done} · 이미 있음 ${skipped}` : `※ dry-run. 반영은 --apply (이미 있음 ${skipped})`);
