/**
 * **정제칸이 잘못 박히지 않았나 — 21곳 전수 대조(읽기 전용).**
 *
 * ★사장님 2026-08-18 — 「이제 잘못 박힌 차종마스터 없는 거지??」 → 말 대신 대조로 답한다.
 *   팔 수 있는 줄(출고불가 아님)마다:
 *   ① 차종코드가 있으면 — 차종마스터에 있는 코드인가 · 정제칸 이름(제조사(정제)·모델·세부모델·세부트림·연료(정제)·배기량(정제))이 그 코드의 값과 같은가 ·
 *      상품마스터 확정 코드와 같은가.
 *   ② 공급사 근거와 맞는가 — 배기량(±7%) · 연료 · 등록연도↔코드 연식 기간(±1) · 차명 글자의 세대코드(KA4·DN8…)↔세부모델 · 제조사.
 *   ③ 코드는 없고 이름만 있으면 — 그 세부모델이 마스터에 있는가 · 근거(연도·연료·배기량)와 맞는가.
 *   어긋난 줄을 사유별로 센 뒤 목록을 tmp/vehicle-refine-audit.json 에 쓴다.
 *
 *   npx tsx scripts/audit-vehicle-refine.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { MASTER_SHEET_ID, MASTER_TAB, readMasterSheet } from '../lib/domain/vehicle-master-sheet';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { normFuel } from '../lib/domain/vehicle-master-format';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const key = (v: unknown) => norm(v).toLowerCase().replace(/[()（）\-_.·,/]/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string): Promise<Rec> => { for (let n = 0; ; n++) { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } }); const t = await r.text(); if (r.ok) return JSON.parse(t); if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; } throw new Error(`${r.status} ${t.slice(0, 200)}`); } };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const masterValues = (((await call(`${SH}/${MASTER_SHEET_ID}/values/${encodeURIComponent(`'${MASTER_TAB}'`)}`)) as { values?: string[][] }).values || []).map((r) => r.map(S));
const BOOK = readMasterSheet(masterValues);
const PERIOD = new Map<string, { start: number; end: number }>();
{ const h = masterValues[0] || []; const at = (n: string) => h.indexOf(n); const ci = at('트림행키'), ps = at('생산시작'), pe = at('생산종료'), ys = at('연식시작'), ye = at('연식종료');
  const yr = (v: unknown) => Number((S(v).match(/20\d\d|19\d\d/) || [0])[0]) || 0;
  for (const r of masterValues.slice(1)) { const c = S(r[ci]); if (!c) continue; const start = yr(r[ys]) || yr(r[ps]); const end = yr(r[ye]) || yr(r[pe]) || (start ? 2100 : 0); if (start) PERIOD.set(c, { start, end }); } }
const subRows = new Map<string, { fuel: string; cc: number; start: number; end: number }[]>();
for (const row of BOOK.byCode.values()) { const k = `${key(canonMakerDisplay(row.maker))}|${key(row.subModel)}`; const p = PERIOD.get(row.code); subRows.set(k, [...(subRows.get(k) || []), { fuel: normFuel(row.fuel), cc: Number(S(row.cc).replace(/[^\d]/g, '')) || 0, start: p?.start || 0, end: p?.end || 2100 }]); }
const pm = await call(`${SH}/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1:AZ2000`)}`) as { values?: string[][] };
const PM = new Map<string, string>();
{ const rows = ((pm.values || []) as string[][]).map((r) => r.map(S)); const h = rows[0] || []; const pi = h.indexOf('차량번호'), ci = h.indexOf('차종코드'), vi = h.indexOf('검증상태'); for (const r of rows.slice(1)) if (S(r[pi]) && S(r[ci]) && S(r[vi]) === '확정') PM.set(norm(r[pi]), S(r[ci])); }
const GEN = /\b([A-Z]{1,3}\d{1,2}[A-Z]?|[A-Z]{2,4})\b/g;
const GEN_TOKENS = new Set<string>();
for (const row of BOOK.byCode.values()) for (const m of `${row.subModel}`.toUpperCase().matchAll(GEN)) if (m[1].length >= 2) GEN_TOKENS.add(m[1]);
const fuelOf = (v: unknown) => normFuel(v);
const ccOf = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) || 0;

const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
type Issue = { supplier: string; plate: string; kind: string; detail: string };
const issues: Issue[] = [];
let cars = 0, withCode = 0, namesOnly = 0, empty = 0;
for (const f of ((found.files || []) as Rec[]).sort((a, b) => S(a.name).localeCompare(S(b.name), 'ko'))) {
  const supplier = supplierSheetLabel(S(f.name));
  const meta = await call(`${SH}/${f.id}?fields=sheets.properties(title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const t = S(sh.properties.title); if (sh.properties.hidden || isOurNonInventoryTab(t)) continue;
    const v = await call(`${SH}/${f.id}/values/${encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S)); const h = rows[0] || [];
    const at = (n: string) => h.findIndex((x) => norm(x) === norm(n));
    const g = (r: string[], n: string) => { const i = at(n); return i < 0 ? '' : S(r[i]); };
    const pi = at('차량번호'); if (pi < 0) continue;
    for (const r of rows.slice(1)) {
      const plate = norm(r[pi]); if (!plate || /출고불가/.test(g(r, '상태'))) continue;
      cars++;
      const code = g(r, '차종코드'); const sub = g(r, '세부모델'); const rawName = g(r, '차명(세부모델+트림)'); const rawMaker = canonMakerDisplay(g(r, '제조사'));
      const rawFuel = fuelOf(g(r, '연료')); const rawCc = ccOf(g(r, '배기량')); const year = Number((g(r, '연식').match(/20\d\d/) || g(r, '최초등록일').match(/20\d\d/) || [0])[0]) || 0;
      const gens = [...`${rawName}`.toUpperCase().matchAll(GEN)].map((m) => m[1]).filter((x) => GEN_TOKENS.has(x) && !/^(AWD|FWD|RWD|LPI|LPG|GDI|CVT|DCT|SUV|EV|HEV|PHEV|MY|AT|MT|SBW|HUD|II|III|IV|VI|VII|DE|MP|GT|GL|SE|LE|RE|N|X)$/.test(x));
      const push = (kind: string, detail: string) => issues.push({ supplier, plate, kind, detail });
      if (code) {
        withCode++;
        const row = BOOK.byCode.get(code);
        if (!row) { push('코드 없음(마스터)', code); continue; }
        const pmCode = PM.get(plate); if (pmCode && pmCode !== code) push('상품마스터 코드와 다름', `시트 ${code} ↔ 상품마스터 ${pmCode}`);
        const cmp: [string, string, string][] = [['제조사(정제)', canonMakerDisplay(g(r, '제조사(정제)')), canonMakerDisplay(row.maker)], ['모델', g(r, '모델'), row.model], ['세부모델', sub, row.subModel], ['세부트림', g(r, '세부트림'), row.trim]];
        for (const [n, a, b] of cmp) if (key(a) !== key(b)) push('정제칸≠코드값', `${n} 「${a}」 ↔ 코드 「${b}」`);
        const cf = fuelOf(g(r, '연료(정제)')); if (cf && normFuel(row.fuel) && cf !== normFuel(row.fuel)) push('정제칸≠코드값', `연료(정제) 「${g(r, '연료(정제)')}」 ↔ 코드 「${row.fuel}」`);
        // 공급사 근거
        const codeCc = ccOf(row.cc); if (rawCc > 300 && codeCc > 300 && Math.abs(rawCc - codeCc) / rawCc > 0.07) push('배기량 어긋남', `공급사 ${rawCc}cc ↔ 코드 ${codeCc}cc (${row.subModel} ${row.trim})`);
        if (rawFuel && normFuel(row.fuel) && rawFuel !== normFuel(row.fuel) && !/lpg|바이퓨얼/.test(normFuel(row.fuel))) push('연료 어긋남', `공급사 ${g(r, '연료')} ↔ 코드 ${row.fuel}`);
        const p = PERIOD.get(code); if (year && p && (year < p.start - 1 || year > p.end + 1)) push('연도 어긋남', `등록 ${year} ↔ 코드 ${row.subModel} ${p.start}~${p.end === 2100 ? '현재' : p.end}`);
        if (rawMaker && key(rawMaker) !== key(canonMakerDisplay(row.maker))) push('제조사 어긋남', `공급사 ${rawMaker} ↔ 코드 ${canonMakerDisplay(row.maker)}`);
        for (const gcode of gens) if (!key(row.subModel).includes(key(gcode)) && !key(row.code).includes(key(gcode))) push('세대코드 어긋남', `차명 「${rawName.slice(0, 30)}」의 ${gcode} ↔ 코드 세부모델 「${row.subModel}」`);
      } else if (sub) {
        namesOnly++;
        const cands = subRows.get(`${key(canonMakerDisplay(g(r, '제조사(정제)') || rawMaker))}|${key(sub)}`) || [];
        if (!cands.length) { push('이름만·마스터에 없는 세부모델', `「${sub}」`); continue; }
        if (year && !cands.some((c) => year >= c.start - 1 && year <= c.end + 1)) push('이름만·연도 어긋남', `등록 ${year} ↔ 「${sub}」 ${cands[0].start}~${cands[0].end === 2100 ? '현재' : cands[0].end}`);
        if (rawCc > 300 && !cands.some((c) => !c.cc || Math.abs(rawCc - c.cc) / rawCc <= 0.07)) push('이름만·배기량 어긋남', `공급사 ${rawCc}cc ↔ 「${sub}」 ${[...new Set(cands.map((c) => c.cc))].join('/')}cc`);
        for (const gcode of gens) if (!key(sub).includes(key(gcode))) push('이름만·세대코드 어긋남', `차명 ${gcode} ↔ 세부모델 「${sub}」`);
      } else empty++;
    }
    await sleep(300);
  }
}
const byKind = new Map<string, number>(); for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) || 0) + 1);
const plates = new Set(issues.map((i) => `${i.supplier}${i.plate}`));
console.log(`■ 정제칸 전수 대조 — 팔 수 있는 차 ${cars}대 (코드 ${withCode} · 이름만 ${namesOnly} · 빈 ${empty})`);
console.log(`  어긋난 줄 ${plates.size}대 · 사유 ${issues.length}건: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}`);
for (const i of issues.slice(0, 80)) console.log(`   ${i.supplier.padEnd(6)} ${i.plate} ${i.kind} — ${i.detail}`);
if (issues.length > 80) console.log(`   … 모두 ${issues.length}건 (tmp/vehicle-refine-audit.json)`);
writeFileSync('tmp/vehicle-refine-audit.json', JSON.stringify({ cars, withCode, namesOnly, empty, issues }, null, 2));
