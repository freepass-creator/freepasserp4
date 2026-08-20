/**
 * **차명(세부모델+트림) 중복 정리** — 공급사가 「쏘나타 쏘나타 DN8」·「카니발 카니발」·「그랜저 / 그랜저 IG」·「… RS RS」처럼 적은 것을 「쏘나타 DN8」·「카니발」·「그랜저 IG」·「… RS」로.
 *   사장님 2026-08-19 「정제시트에 차명 중복으로 들어가거나 한 거 있나 — 공급사가 올리더라도 쏘나타 쏘나타 DN8 이런 거는 쏘나타 DN8로 바로 할 수 있잖아」.
 *   규칙(글자만 정리, 정보는 안 버림):
 *     ① 「X / X …」 → 「X …」   ② 붙어 있는 같은 토큰 「A A」 → 「A」(대소문자·구두점 무시, 어디서든)
 *     ③ 첫 토큰이 뒤에 다시 나오면 첫 토큰을 뺀다(「그랜저 더 뉴 그랜저 IG」→「더 뉴 그랜저 IG」)   ④ 앞뒤 공백·겹공백 정리
 *   기본 dry-run(전부 목록), --apply 로 반영. --who=손오공 한 곳만.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply'); const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => { for (let n = 0; ; n++) { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (r.ok) return t ? JSON.parse(t) : {}; if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 4_000 * 2 ** n)); continue; } throw new Error(`${r.status} ${t.slice(0, 300)}`); } };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const key = (t: string) => t.toLowerCase().replace(/[\s\-_./()（）·,]/g, '');

export function tidyVehicleName(raw: string): string {
  let v = S(raw).replace(/\s+/g, ' ');
  if (!v) return '';
  // ① 「X / X …」
  const slash = /^(.+?)\s*\/\s*(.+)$/.exec(v);
  if (slash && key(slash[2]).startsWith(key(slash[1]))) v = slash[2].trim();
  let toks = v.split(' ').filter(Boolean);
  // ② 같은 말이 통째로 두 번(「A B C A B C」 · 「쿠퍼 c 5도어 쿠퍼 C 5도어」) → 앞 한 벌만
  if (toks.length >= 2 && toks.length % 2 === 0) {
    const half = toks.length / 2;
    if (key(toks.slice(0, half).join(' ')) === key(toks.slice(half).join(' '))) toks = toks.slice(0, half);
  }
  // ③ 붙어 있는 같은 토큰 「A A」 → 「A」
  for (let i = 0; i < toks.length - 1;) { if (key(toks[i]) && key(toks[i]) === key(toks[i + 1])) toks.splice(i, 1); else i++; }
  // ④ 첫 토큰(모델 말)이 뒤에 다시 나오면 첫 토큰을 뺀다 — 「그랜저 더 뉴 그랜저 IG」. 숫자·배기량 토큰(2.5·1.6T)은 건드리지 않는다.
  if (toks.length > 2 && key(toks[0]).length >= 2 && !/\d/.test(toks[0]) && toks.slice(1).some((t) => key(t) === key(toks[0]))) toks = toks.slice(1);
  return toks.join(' ').trim();
}

if (process.argv.includes('--test')) {
  for (const t of ['쏘나타 쏘나타 DN8', '카니발 카니발', '그랜저 / 그랜저 IG 자가용', '트랙스 크로스오버 1.2 가솔린 터보 RS RS', '그랜저 더 뉴 그랜저 IG HEV', '쿠퍼 c 5도어 쿠퍼 C 5도어', 'EV6 롱 레인지 2WD 에어', 'X1(2세대) 20i xDrive', '캐스퍼 캐스퍼', 'K8 HEV', '벤츠E250 E250']) console.log(t.padEnd(36), '→', tidyVehicleName(t));
  process.exit(0);
}

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));
const log: Rec[] = []; let total = 0;
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  const data: { range: string; values: string[][] }[] = []; const lines: string[] = [];
  for (const p of tabs) {
    const title = S(p.title);
    const v = await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (hi < 0) continue;
    const hdr = rows[hi]; const pi = hdr.findIndex((h) => norm(h) === '차량번호'); const ni = hdr.findIndex((h) => norm(h) === '차명(세부모델+트림)');
    rows.slice(hi + 1).forEach((r, k) => {
      const plate = S(r[pi]); if (!plate) return; const cur = S(r[ni]); const next = tidyVehicleName(cur);
      if (next && next !== cur) { data.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(ni)}${hi + 2 + k}`, values: [[next]] }); lines.push(`   ${plate.padEnd(10)} 「${cur}」 → 「${next}」`); log.push({ sheet: b.label, tab: title, plate, before: cur, after: next }); }
    });
  }
  if (lines.length) { console.log(`■ ${b.label} ${lines.length}건`); console.log(lines.slice(0, 12).join('\n')); if (lines.length > 12) console.log(`   … 외 ${lines.length - 12}`); }
  total += data.length;
  if (APPLY && data.length) { await call(`${SH}/${b.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }); console.log(`   ✓ 반영 ${data.length}`); }
}
writeFileSync('tmp/tidy-vehicle-names-log.json', JSON.stringify({ at: new Date().toISOString(), apply: APPLY, changes: log }, null, 1));
console.log(`■ 합계 ${total}건 ${APPLY ? '반영' : '(dry-run — --apply 로 반영)'}`);
