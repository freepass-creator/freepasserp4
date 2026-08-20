/**
 * **공급사 시트 재고 탭에 「모델명」 열을 보장한다** — 제조사 바로 뒤. 없을 때만 넣는다(있으면 아무것도 안 함). 기본 dry-run, --apply 로 반영. --who=손오공 한 곳만 · --skip=아이언,손오공 건너뜀.
 *   사장님 2026-08-19 공통 항목: 차량번호 입고일자 점검사항 상태 분류 제조사 **모델명** 차명(세부모델+트림) 옵션 외부색상 내부색상 연식 주행거리 연료 배기량 차량가격
 *   · 모델명 = 검색되는 모델 이름(제조사 말·연료 꼬리 뗀 것, 차종마스터가 알면 그 이름) — 값 채움은 별도(fill-from-saeop / sync-mirror-sheet / fill-model-names).
 *   · 열만 넣고 값은 비워 둔다(표(Table)·서식은 앞 열(제조사)을 따른다: inheritFromBefore).
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply'); const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
const SKIP = ((process.argv.find((a) => a.startsWith('--skip=')) || '').slice(7)).split(',').map(S).filter(Boolean);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => { for (let n = 0; ; n++) { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (r.ok) return t ? JSON.parse(t) : {}; if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 4_000 * 2 ** n)); continue; } throw new Error(`${r.status} ${t.slice(0, 300)}`); } };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));
if (SKIP.length) books = books.filter((b) => !SKIP.some((s) => b.label.includes(s)));
let added = 0, already = 0;
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  for (const p of tabs) {
    const title = S(p.title);
    const v = await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ12`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (hi < 0) continue;
    const hdr = rows[hi]; const mi = hdr.findIndex((h) => norm(h) === '모델명'); const mk = hdr.findIndex((h) => norm(h) === '제조사');
    if (mi >= 0) { already++; console.log(`   ${b.label.padEnd(8)} 「${title}」 모델명 열 있음(${colA1(mi)})`); continue; }
    if (mk < 0) { console.log(`   ! ${b.label} 「${title}」 제조사 열 없음 — 건너뜀`); continue; }
    console.log(`■ ${b.label.padEnd(8)} 「${title}」 모델명 열 없음 → 제조사(${colA1(mk)}) 뒤 ${colA1(mk + 1)} 에 ${APPLY ? '추가' : '추가 예정'}`);
    added++;
    if (!APPLY) continue;
    await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: mk + 1, endIndex: mk + 2 }, inheritFromBefore: true } }] }) });
    await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(mk + 1)}${hi + 1}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [['모델명']] }) });
    await sleep(300);
  }
}
console.log(`■ 모델명 열 ${APPLY ? '추가' : '추가 예정'} ${added} · 이미 있음 ${already}${APPLY ? '' : ' (dry-run)'}`);
