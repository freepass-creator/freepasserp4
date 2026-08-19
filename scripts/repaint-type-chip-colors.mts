/**
 * **재고 탭 「분류」 칩 글자색을 상태 색과 안 겹치게 다시 칠한다**(조건부서식만, 값·표는 안 건드림). 기본 dry-run, 반영은 `--apply`.
 * ★사장님 2026-08-18 — 「출고협의 주황 옆에 중고구독 주황 — 색깔이 비슷하면 안 되지」 → TYPE_TONE(신차렌트 마젠타·중고렌트 청록·중고구독 보라·신차구독 회색).
 * ★정제시트도 규격 같아야 하므로 기본 포함(--only-supplied 로 제공만).
 *   npx tsx scripts/repaint-type-chip-colors.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, buildTypeChipColorRules, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => { for (let n = 0; ; n++) { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (r.ok) return t ? JSON.parse(t) : {}; if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; } throw new Error(`${r.status} ${t.slice(0, 300)}`); } };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const targets = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
console.log(`■ 분류 칩 색 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
let n = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden,gridProperties(rowCount))`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const hdr = ((((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ1`)}`) as { values?: string[][] }).values || [])[0]) || []).map(S);
    if (!hdr.some((c) => norm(c) === '차명(트림)')) continue;
    const reqs = buildTypeChipColorRules(p.sheetId, hdr.map((name) => ({ name })), Number(p.gridProperties?.rowCount) || 500);
    if (!reqs.length) continue;
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 규칙 ${reqs.length}`);
    if (!APPLY) continue;
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
    n++; await sleep(1000);
  }
}
console.log(APPLY ? `  반영 탭 ${n}` : '※ dry-run. 반영은 --apply');
