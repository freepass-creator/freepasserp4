/**
 * **정제시트의 정제칸(차종코드~차종분류 11열)을 지운다** — 사장님 2026-08-19 「정제시트에 일단 정제된 칸들 다 날리자 · 차종마스터 넣으려고 했던 거 다 날려」.
 *   지우기 전 그 칸 값을 tmp/ai-cols-snapshot-<공급사>.json 에 남긴다. 기본 dry-run, --apply 로 실행. --who=이안카 필수(한 번에 한 곳).
 *   「│」 구분선·「정책코드」는 남긴다. 정제칸이 연속이 아니면 멈춘다(사람 확인).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { AI_TAIL_COLUMNS, SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply'); const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
if (!WHO) throw new Error('--who=<공급사> 가 필요하다(한 번에 한 곳)');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : {}; };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).filter((b) => b.label.includes(WHO));
if (books.length !== 1) throw new Error(`대상 시트가 ${books.length}개: ${books.map((b) => b.label).join(',')}`);
const b = books[0];
const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
const aiNames = AI_TAIL_COLUMNS.map((c) => norm(c.name));
for (const p of tabs) {
  const title = S(p.title);
  const v = await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
  const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (hi < 0) continue;
  const hdr = rows[hi]; const idxs = hdr.map((h, i) => (aiNames.includes(norm(h)) ? i : -1)).filter((i) => i >= 0);
  if (!idxs.length) { console.log(`   ${b.label} 「${title}」 정제칸 없음`); continue; }
  const lo = Math.min(...idxs), hi2 = Math.max(...idxs);
  if (hi2 - lo + 1 !== idxs.length) throw new Error(`「${title}」 정제칸이 연속이 아님 — 사람이 확인`);
  const snap = { taken_at: new Date().toISOString(), sheet: b.label, tab: title, cols: idxs.map((i) => hdr[i]), rows: rows.slice(hi + 1).filter((r) => S(r[0])).map((r) => ({ plate: r[0], vals: idxs.map((i) => r[i] || '') })) };
  writeFileSync(`tmp/ai-cols-snapshot-${b.label}-${title}.json`, JSON.stringify(snap));
  console.log(`■ ${b.label} 「${title}」 정제칸 ${idxs.length}열(${hdr[lo]}~${hdr[hi2]}, 열 ${lo + 1}~${hi2 + 1}) ${APPLY ? '삭제' : '삭제 예정'} · 스냅샷 ${snap.rows.length}줄`);
  if (!APPLY) continue;
  await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: lo, endIndex: hi2 + 1 } } }] }) });
  console.log('   ✓ 삭제');
}
if (!APPLY) console.log('※ dry-run — --apply 로 실행');
