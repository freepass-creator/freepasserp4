/**
 * 입고일자 = 그 차량번호가 우리 쪽에 처음 올라온 날(사장님 2026-08-19 「입고일자를 차량번호 처음 쓴 날짜로 반영」). 기본 dry-run, --apply 로 반영. --who=손오공 한 곳만.
 *   근거 셋 중 가장 이른 날:
 *     A. 원자(Firestore `products`)의 `erp_first_seen_date` — 그 차번을 우리 쪽에서 «처음 본 날»
 *        ⚠ 2026-09-10 까지 이 값을 **RTDB `v4/products`의 createdAt** 에서 매번 읽었다. 그건 대조가 아니라
 *          «역사»라 한 번 옮겨 담으면 끝난다 — `scripts/capture-erp-first-seen.mts`(실측 1,393대).
 *          그래서 이 스크립트는 이제 **RTDB 를 열지 않는다**(사장님 「RTDB 를 왜 못 지우는지」).
 *     B. 이 시트 버전기록에서 그 차량번호가 처음 보인 날(하루 단위: 날짜별 마지막 버전의 재고 탭 CSV)
 *     C. 지금 칸에 적힌 날짜(있으면)
 *   셋 다 없으면 안 쓴다(지어내지 않음). 날짜 아닌 글자(이안카 「재고확인」)는 날짜로 덮는다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const P = (v: unknown) => S(v).replace(/\s/g, ''); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply'); const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const tokenOf = async () => (await jwt.getAccessToken()).token as string;
const call = async (u: string, init?: RequestInit): Promise<Rec> => { for (let n = 0; ; n++) { const tok = await tokenOf(); const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (r.ok) return t ? JSON.parse(t) : {}; if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 4_000 * 2 ** n)); continue; } throw new Error(`${r.status} ${t.slice(0, 300)}`); } };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const asDate = (v: string): string => { const s = S(v); let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = /^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(s); if (m) return `20${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; return ''; };

// A. «처음 본 날» — 원자(Firestore)에서 읽는다. RTDB 를 안 연다.
if (!getApps().length) initializeApp({ credential: cert(sa) });
const erpFirst = new Map<string, string>();
for (const d of (await getFirestore().collection('products').get()).docs) {
  const v = d.data() as Rec;
  const plate = P(v.car_number); const day = S(v.erp_first_seen_date);
  if (!plate || !day) continue;
  const prev = erpFirst.get(plate);
  if (!prev || day < prev) erpFirst.set(plate, day);
}
console.log(`A. 원자에 «처음 본 날»이 있는 차량번호 ${erpFirst.size}`);

// CSV parse (따옴표 포함)
const parseCsv = (text: string): string[][] => { const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch === '\r') { /* skip */ } else cell += ch; } if (cell || row.length) { row.push(cell); rows.push(row); } return rows; };

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)), created: S(f.createdTime) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));
const cacheFile = 'tmp/intake-revision-cache.json';
const cache: Record<string, Record<string, string>> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
const summary: Rec[] = [];
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  // B. 버전기록 — 날짜별 마지막 버전
  let firstSeen: Record<string, string> = cache[b.id] || {};
  if (!cache[b.id]) {
    const revs = ((await call(`https://www.googleapis.com/drive/v3/files/${b.id}/revisions?fields=revisions(id,modifiedTime)&pageSize=1000`)).revisions || []) as Rec[];
    const byDay = new Map<string, Rec>(); for (const r of revs) byDay.set(kstDate(S(r.modifiedTime)), r);
    const days = [...byDay.keys()].sort();
    for (const day of days) {
      const rev = byDay.get(day)!;
      for (const p of tabs) {
        const tok = await tokenOf();
        const resp = await fetch(`https://docs.google.com/spreadsheets/export?id=${b.id}&revision=${rev.id}&exportFormat=csv&gid=${p.sheetId}`, { headers: { Authorization: `Bearer ${tok}` } });
        if (!resp.ok) continue;
        const rows = parseCsv(await resp.text()).map((r) => r.map(S));
        const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (hi < 0) continue;
        const pi = rows[hi].findIndex((c) => norm(c) === '차량번호');
        for (const r of rows.slice(hi + 1)) { const plate = P(r[pi]); if (plate && !firstSeen[plate]) firstSeen[plate] = day; }
        await sleep(150);
      }
    }
    cache[b.id] = firstSeen; writeFileSync(cacheFile, JSON.stringify(cache));
    console.log(`  ${b.label}: 버전 ${revs.length}개 · 날 ${days.length}일 · 차번 ${Object.keys(firstSeen).length}`);
  }
  // 시트 현재값 → 결정
  const data: { range: string; values: string[][] }[] = []; let nWrite = 0, nSame = 0, nNone = 0; const srcCount: Rec = { ERP: 0, 버전기록: 0, 기존값: 0 }; const ex: string[] = [];
  for (const p of tabs) {
    const title = S(p.title);
    const v = await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (hi < 0) continue;
    const hdr = rows[hi]; const pi = hdr.findIndex((h) => norm(h) === '차량번호'); const ii = hdr.findIndex((h) => norm(h) === '입고일자'); if (ii < 0) { console.log(`  ! ${b.label}/${title} 입고일자 열 없음`); continue; }
    rows.slice(hi + 1).forEach((r, k) => {
      const plate = P(r[pi]); if (!plate) return; const rn = hi + 2 + k;
      const cands: [string, string][] = []; const a = erpFirst.get(plate); if (a) cands.push([a, 'ERP']); const bb = firstSeen[plate]; if (bb) cands.push([bb, '버전기록']); const c = asDate(r[ii]); if (c) cands.push([c, '기존값']);
      if (!cands.length) { nNone++; return; }
      cands.sort((x, y) => x[0].localeCompare(y[0])); const [best, src] = cands[0];
      if (S(r[ii]) === best) { nSame++; return; }
      srcCount[src]++; nWrite++; data.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(ii)}${rn}`, values: [[best]] });
      if (ex.length < 4) ex.push(`${plate} 「${S(r[ii]) || '(빈칸)'}」→「${best}」(${src})`);
    });
  }
  console.log(`■ ${b.label.padEnd(8)} 쓸 칸 ${nWrite} · 같음 ${nSame} · 근거 없음 ${nNone} · 출처 ${JSON.stringify(srcCount)} · 예 ${ex.join(' / ')}`);
  summary.push({ sheet: b.label, write: nWrite, same: nSame, none: nNone, src: srcCount });
  if (APPLY && data.length) { for (let i = 0; i < data.length; i += 400) await call(`${SH}/${b.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 400) }) }); console.log(`   ✓ 반영 ${data.length}칸`); }
}
writeFileSync('tmp/fill-intake-date-report.json', JSON.stringify({ at: new Date().toISOString(), apply: APPLY, summary }, null, 1));
console.log(APPLY ? '■ 반영 끝' : '※ dry-run — --apply 로 반영');
process.exit(0);
