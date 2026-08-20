/**
 * **공급사 시트 머리글 「차명(트림)」 → 「차명(세부모델+트림)」** — 사장님 2026-08-19 「차명(세부모델+트림) 이렇게 해 주고 항목 이름」. 기본 dry-run, --apply 로 반영.
 *   글자만 바꾼다(값·열 위치 그대로). 코드는 새 이름으로 읽는다 — 시트를 안 바꾸면 그 탭이 안 읽힌다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply'); const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
const OLD = '차명(트림)'; const NEW = '차명(세부모델+트림)';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : {}; };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));
let n = 0;
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  for (const p of tabs) {
    const title = S(p.title);
    const v = await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ12`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === norm(OLD) || norm(c) === norm(NEW))); if (hi < 0) continue;
    const ni = rows[hi].findIndex((h) => norm(h) === norm(OLD)); if (ni < 0) { console.log(`   ${b.label.padEnd(8)} 「${title}」 이미 ${NEW}`); continue; }
    console.log(`■ ${b.label.padEnd(8)} 「${title}」 ${colA1(ni)}${hi + 1} 「${OLD}」 → 「${NEW}」${APPLY ? '' : ' (예정)'}`); n++;
    if (APPLY) await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(ni)}${hi + 1}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[NEW]] }) });
  }
}
console.log(`■ ${APPLY ? '반영' : '예정'} ${n}탭`);
