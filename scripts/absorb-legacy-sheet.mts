/**
 * **구버전(옛 우리 시트) → [제공] 시트 흡수 — 새 시트가 정본, 옛 값은 빈 칸만 채우고 없는 차만 더한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「기존 시트 이제 안 쓸 거니까 기존에 참조했던 시트 확실하게 반영해 주고」 · 「자기 시트 쓰는 곳은 4곳뿐, 나머지는 버전의 차이」
 *   손오공·리더스·스타·렌트존·우리캐피탈·SA 는 문패가 옛 우리 시트(구버전)를 읽다가 오늘 [제공] 시트로 넘어갔다.
 *   옛 시트에만 있는 값이 있으면 여기서 건져 온다 — 단 **새 시트에 이미 값이 있는 칸은 절대 덮지 않는다**
 *   (손오공·리더스·스타·SA 는 새 시트 쪽 편집이 더 최근이다). 둘 다 값이 있는데 다르면 목록으로 보여 사람이 본다.
 * ★열은 이름으로 맞춘다(mirror-sheet-mapping 별칭 — 배차상태→상태, Km→주행거리, 월렌트→1개월…). 옛 시트의 숨긴 줄은 «안 파는 차»라 안 가져온다(수만 센다).
 * ★옛 시트에만 있는 차는 새 시트 맨 아래에 더한다(정제칸·정책코드는 비워 둔다 → 정제칸 채우기가 뒤따른다).
 *
 *   npx tsx scripts/absorb-legacy-sheet.mts --from=<옛ID> --to=<새ID> --code=RP012
 *   npx tsx scripts/absorb-legacy-sheet.mts --from=… --to=… --code=… --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { columnOwner, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { projectSourceRow, unmappedSourceColumns } from '../lib/domain/mirror-sheet-mapping';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const FROM = arg('from'); const TO = arg('to'); const CODE = arg('code', 'RP000');
/**
 * ★`--prefer-old-tabs=렌트재고` — 그 탭은 옛 값이 이긴다(공급사 칸만, 우리 칸 제외).
 *   실측 2026-08-18: 손오공 새 시트 「렌트재고」 15줄은 만들 때 자리가 밀린 흔적(쏘나타 133,000km·4,834만원·24개월 191만원)이고,
 *   옛 「손오공 상품화 시트」 렌트 탭은 공급사가 8/13까지 손보던 것이라 옛 값이 맞다. 구독재고는 새 시트가 최신(kst 08-14)이라 그대로.
 * ★새 시트 값이 「#ERROR!·#REF!·#N/A」면 빈 칸으로 본다(구독재고 연식 #ERROR! 실측).
 */
const PREFER_OLD = new Set(arg('prefer-old-tabs').split(',').map(S).filter(Boolean));
const isErr = (v: string) => /^#(ERROR|REF|N\/A|VALUE|DIV\/0|NAME)/i.test(v);
if (!FROM || !TO) throw new Error('--from=<옛ID> --to=<새ID> 가 필요하다');
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const sameNumber = (a: string, b: string) => { const n = (v: string) => (/^[\d,\s]+$/.test(v) && /\d/.test(v) ? v.replace(/[,\s]/g, '') : null); const x = n(a), y = n(b); return x !== null && y !== null && x === y; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

// ① 옛 시트(보이는 줄만) → 차번 → 우리 열이름 → 값
const grid = await call(`${SH}/${FROM}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS + ',properties.title')}`);
const read = readSupplierSheet(grid as never, { partner_code: CODE } as EntityRecord);
const src = new Map<string, Map<string, string>>();
let hiddenRows = 0; const srcHeaders = new Set<string>();
for (const t of read.tabs) {
  hiddenRows += t.hiddenRows || 0;
  const hdr = (t.table[0] || []).map(S);
  hdr.forEach((h) => { if (h) srcHeaders.add(h); });
  const pi = hdr.findIndex((h) => /^차량번호$|^차번$/.test(norm(h)));
  if (pi < 0) continue;
  for (const r of t.table.slice(1)) {
    const plate = norm(r[pi]); if (!plate || src.has(plate)) continue;
    const raw = new Map<string, string>(); hdr.forEach((h, i) => { if (S(h)) raw.set(norm(h), S(r[i])); });
    const m = projectSourceRow(raw);
    const photo = S((t as Rec).photoByPlate?.[plate] || (t as Rec).photoByPlate?.[S(r[pi])]);
    if (photo && !m.get('사진링크')) m.set('사진링크', photo);
    src.set(plate, m);
  }
}
console.log(`■ 흡수 ${APPLY ? '반영' : '미리보기'} — 옛 「${S(grid.properties?.title)}」 ${read.tabs.length}탭 · 보이는 차 ${src.size}대 · 숨긴 줄 ${hiddenRows}(안 가져옴)${read.failures.length ? ` · 못 읽은 탭 ${read.failures.length}` : ''}`);

// ② 새 시트 재고 탭(하나) — 손오공은 렌트재고·구독재고 둘 → 옛 탭 이름으로 가른다(구독 상품 현황 → 구독재고)
const meta = await call(`${SH}/${TO}?fields=properties.title,sheets.properties(sheetId,title,hidden)`);
const stockTabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
type Tab = { title: string; hdr: string[]; rows: string[][]; plateRow: Map<string, number>; pi: number };
const tabs: Tab[] = [];
for (const p of stockTabs) {
  const title = S(p.title);
  const v = await call(`${SH}/${TO}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
  const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차명(트림)'));
  if (hi !== 0) continue;
  const hdr = rows[0]; const pi = hdr.findIndex((h) => norm(h) === '차량번호'); if (pi < 0) continue;
  const plateRow = new Map<string, number>(); rows.slice(1).forEach((r, k) => { const pl = norm(r[pi]); if (pl && !plateRow.has(pl)) plateRow.set(pl, k + 1); });
  tabs.push({ title, hdr, rows, plateRow, pi });
}
if (!tabs.length) throw new Error('새 시트에서 재고 탭을 못 찾았다');
console.log(`  새 「${S(meta.properties?.title)}」 ${tabs.map((t) => `「${t.title}」 ${t.plateRow.size}대`).join(' · ')}`);
const lost = unmappedSourceColumns([...srcHeaders], tabs.flatMap((t) => t.hdr));
if (lost.length) console.log(`  ▲ 새 규격에 자리가 없어 안 옮기는 옛 열: ${lost.join(' · ')} (정책 성격은 「정책」 탭)`);

// ③ 채우기 — 빈 칸만. 다르면 목록.
const writes: { range: string; values: string[][] }[] = [];
const differs: string[] = []; const appended: string[] = [];
let filled = 0; let overwritten = 0;
const findTab = (plate: string) => tabs.find((t) => t.plateRow.has(plate));
// 옛 탭이 구독이면 새 시트 구독재고로, 아니면 첫 재고 탭으로
const tabForNew = (m: Map<string, string>) => {
  const isSub = /구독/.test(m.get('분류') || '') || [...m.keys()].some((k) => /인수형|반납형/.test(k));
  return tabs.find((t) => (isSub ? /구독/.test(t.title) : !/구독/.test(t.title))) || tabs[0];
};
const appendRows = new Map<string, string[][]>();
for (const [plate, m] of src) {
  const t = findTab(plate);
  if (t) {
    const ri = t.plateRow.get(plate)!; const row = t.rows[ri] || [];
    t.hdr.forEach((name, ci) => {
      if (!S(name)) return;
      const nv = m.get(norm(name)); if (!nv) return;
      // 돈 칸에 문장을 넣지 않는다(우리캐피탈 1개월 조건문 — 장기보증 메모로 옮긴 것). sync-mirror-sheet 와 같은 규칙.
      if (/개월|보증/.test(name) && columnOwner(name) === 'live' && nv.length > 12 && !/^[\d,.\s원~-]+$/.test(nv)) return;
      const cur = S(row[ci]);
      if (!cur || isErr(cur)) { writes.push({ range: `'${t.title}'!${colA1(ci)}${ri + 1}`, values: [[nv]] }); filled++; return; }
      if (cur !== nv && !sameNumber(cur, nv) && columnOwner(name) !== 'ours') {
        if (PREFER_OLD.has(t.title)) { writes.push({ range: `'${t.title}'!${colA1(ci)}${ri + 1}`, values: [[nv]] }); overwritten++; return; }
        differs.push(`${t.title} ${S(row[t.pi])} ${name}: 새「${cur}」 ↔ 옛「${nv}」`);
      }
    });
  } else {
    const nt = tabForNew(m);
    const rowVals = nt.hdr.map((name) => (columnOwner(name) === 'ours' ? '' : (m.get(norm(name)) || '')));
    if (!appendRows.has(nt.title)) appendRows.set(nt.title, []);
    appendRows.get(nt.title)!.push(rowVals);
    appended.push(`${nt.title} ${m.get('차량번호') || plate}`);
  }
}
console.log(`  빈 칸 채움 ${filled}${overwritten ? ` · 옛 값으로 덮음(${[...PREFER_OLD].join(',')}) ${overwritten}` : ''} · 새 시트에 없던 차 ${appended.length}대 더함 · 둘 다 값인데 다른 칸 ${differs.length}`);
if (differs.length) { console.log('  ▲ 다른 값(새 시트 것을 둔다 — 사람이 본다):'); for (const d of differs.slice(0, 400)) console.log(`     ${d}`); if (differs.length > 40) console.log(`     … 모두 ${differs.length}`); }
if (appended.length) console.log(`  + 더하는 차: ${appended.slice(0, 30).join(' · ')}${appended.length > 30 ? ` … 모두 ${appended.length}` : ''}`);
if (!APPLY) { console.log('※ dry-run. 반영은 --apply'); process.exit(0); }
for (let i = 0; i < writes.length; i += 500) await call(`${SH}/${TO}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes.slice(i, i + 500) }) });
for (const [title, rows] of appendRows) {
  const t = tabs.find((x) => x.title === title)!;
  let last = 0; t.rows.forEach((r, k) => { if (r.some((c) => S(c))) last = k; });
  await call(`${SH}/${TO}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A${last + 2}`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values: rows }) });
}
console.log(`  ✓ 반영 — 채움 ${filled}칸${overwritten ? ` · 덮음 ${overwritten}칸` : ''} · 더한 차 ${appended.length}대`);
