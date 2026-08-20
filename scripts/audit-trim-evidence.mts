/**
 * **트림 근거 감사** — 상품마스터 확정 차종코드의 «트림»이 공급사 원문에 근거가 있는가. 읽기 전용(기본). `--demote --apply` 로 근거 없는 트림을 비운다.
 *
 * ★사장님 2026-08-19 — 제보(125호1238 K8 트렌디인데 프레스티지) 뒤 「이런 상황 예방해 보자 · 트림 없는 거는 그냥 트림 비우는 거로 했잖아」.
 *   원인 유형 = 공급사 원문에 트림 글자가 없는데(「K8 GL3 21-」) 그 변형(같은 세대·연료·배기량 v)의 **첫 트림 t01** 이 코드로 박힘.
 *   판정(코드 확정 차마다):
 *     근거 있음   — 원문(상품마스터 「공급사 입력 차명」·「공급사 원문보존」 + 지금 공급사 시트 차명(세부모델+트림)/옵션)에 코드 트림 이름 또는 트림별칭이 있다.
 *     유일 트림   — 원문에 트림 글자가 없지만 그 변형에 트림이 하나뿐이다(고를 여지가 없음 → 그대로).
 *     다른 트림   — 원문에 **다른** 트림 글자가 있다(불일치 → 사람 확인, 결정 파일 CODE 로 바로잡을 후보).
 *     근거 없음   — 원문에 트림 글자가 없고 변형에 트림이 여럿이다 → ★트림을 비운다(--demote): 상품마스터 차종코드·적용값 비움 + 검증상태 「검수필요」 + 검수사유,
 *                   결정 파일에 PARTIAL(제조사·모델·세부모델까지) 추가, 공급사 시트 정제칸 「세부트림」 비움(차종코드는 fill 이 정본대로 비운다).
 *   결과는 원천대장 「트림 근거 대조」 탭(--apply 때)과 tmp/trim-evidence-report.json 에 남긴다.
 *
 *   npx tsx scripts/audit-trim-evidence.mts                       # 감사만(콘솔 + tmp)
 *   npx tsx scripts/audit-trim-evidence.mts --apply               # + 원천대장 「트림 근거 대조」 탭
 *   npx tsx scripts/audit-trim-evidence.mts --demote --apply      # + 근거 없음 트림 비움(상품마스터·결정 파일·정제칸)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_./()（）·]/g, '');
const plateOf = (v: unknown) => S(v).replace(/\s/g, '');
const APPLY = process.argv.includes('--apply');
const DEMOTE = process.argv.includes('--demote');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const M = DEFAULT_PRODUCT_MASTER_SHEET_ID;
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

// ── 차종마스터 artifact: 코드 → 트림/별칭, 변형(master_id::vNN) → 트림 목록
const art = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Rec[] };
const byKey = new Map<string, Rec>(); const variantTrims = new Map<string, Rec[]>();
for (const r of art.records) {
  const key = S(r.trim_row_key); byKey.set(key, r);
  const vk = key.replace(/::t\d+$/, ''); const list = variantTrims.get(vk) || []; list.push(r); variantTrims.set(vk, list);
}
const trimWords = (r: Rec): string[] => [S(r.trim), ...String(r.trim_aliases || '').split(/[,|;/]/).map(S)].filter((w) => w && w !== '-').map(norm).filter((w) => w.length >= 2);

// ── 상품마스터
const pmv = await call(`${SH}/${M}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1:AZ2000`)}`) as { values?: string[][] };
const pm = ((pmv.values || []) as string[][]).map((r) => r.map(S)); const ph = pm[0]; const at = (n: string) => ph.indexOf(n);
for (const n of ['차량번호', '공급사코드', '차종코드', '검증상태', '차량상태']) if (at(n) < 0) throw new Error(`상품마스터 머리행에 「${n}」 없음`);
// ★근거로 삼는 원문 = 상품마스터 「공급사 입력 차명」·「공급사 원문보존」(공급사가 적은 그대로) — 「차종마스터 적용값」은 우리가 박은 값이라 근거가 아니다.
//   지금 공급사 시트 차명(세부모델+트림)은 --sheet-text 를 줄 때만 본다: 우리가 옛 ERP 값으로 미리 채운 시트(예: 리더스 「K8 GL3 LPG 3.5 2WD 프레스티지」)가 있어 순환 근거가 된다.
const rawCols = ['공급사 입력 차명', '공급사 원문보존'].filter((c) => at(c) >= 0);
const USE_SHEET_TEXT = process.argv.includes('--sheet-text');

// ── 21곳 공급사 시트 — 차번별 차명(세부모델+트림)·옵션(지금 값)
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const suppliers = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)) }));
const sheetText = new Map<string, string>(); const sheetTrimCell = new Map<string, { id: string; tab: string; row: number; col: number; value: string }>();
for (const t of suppliers) {
  const m = await call(`${SH}/${t.id}?fields=sheets.properties(title,hidden)`);
  for (const sh of (m.sheets || []) as Rec[]) {
    const title = S(sh.properties?.title); if (sh.properties?.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => c.replace(/\s/g, '') === '차명(세부모델+트림)')); if (hi < 0) continue;
    const h = rows[hi]; const pi = h.indexOf('차량번호'); const ni = h.findIndex((c) => c.replace(/\s/g, '') === '차명(세부모델+트림)'); const oi = h.indexOf('옵션'); const ti = h.indexOf('세부트림');
    rows.slice(hi + 1).forEach((r, k) => { const p = plateOf(r[pi]); if (!p) return; sheetText.set(p, `${sheetText.get(p) || ''} ${S(r[ni])} ${oi >= 0 ? S(r[oi]) : ''}`); if (ti >= 0 && !sheetTrimCell.has(p)) sheetTrimCell.set(p, { id: t.id, tab: title, row: hi + 1 + k + 1, col: ti, value: S(r[ti]) }); });
  }
}

// ── 사람 검토 결정(CODE) — 결정 파일에 그 코드가 사람 근거로 박힌 차는 «근거 있음(결정)» (제보·검토를 거친 것, 예: 08주6722 S350d=S350 BlueTEC · 125호1238 트렌디)
const decisions = (JSON.parse(readFileSync('data/product-vehicle-review-decisions.json', 'utf8')).decisions || []) as Rec[];
const decidedCode = new Map<string, string>(); for (const d of decisions) if (S(d.decision) === 'CODE' && S(d.trim_row_key)) decidedCode.set(plateOf(d.car_number), S(d.trim_row_key));
// ── 판정
type Row = { row: number; plate: string; code: string; trim: string; variantTrims: number; verdict: '근거 있음' | '근거 있음(결정)' | '유일 트림' | '다른 트림' | '근거 없음' | '코드 없음(마스터)'; found: string; state: string; provider: string; maker: string; model: string; sub_model: string };
const out: Row[] = []; const counts = new Map<string, number>();
for (let i = 1; i < pm.length; i++) {
  const r = pm[i]; const code = S(r[at('차종코드')]); const plate = plateOf(r[at('차량번호')]);
  if (!code || !plate || plate === '미정') continue;
  if (S(r[at('검증상태')]) !== '확정') continue;
  const rec = byKey.get(code);
  const text = norm(`${rawCols.map((c) => r[at(c)]).join(' ')} ${USE_SHEET_TEXT ? (sheetText.get(plate) || '') : ''}`);
  let verdict: Row['verdict']; let foundWord = '';
  if (!rec) verdict = '코드 없음(마스터)';
  else if (decidedCode.get(plate) === code) { verdict = '근거 있음(결정)'; foundWord = '결정 파일 CODE'; }
  else {
    const mine = trimWords(rec); const vk = code.replace(/::t\d+$/, ''); const siblings = (variantTrims.get(vk) || []).filter((x) => S(x.trim_row_key) !== code);
    const hit = mine.find((w) => text.includes(w));
    if (hit) { verdict = '근거 있음'; foundWord = hit; }
    else {
      const other = siblings.flatMap((x) => trimWords(x).map((w) => [w, S(x.trim)] as const)).find(([w]) => text.includes(w));
      if (other) { verdict = '다른 트림'; foundWord = other[1]; }
      else verdict = siblings.length === 0 ? '유일 트림' : '근거 없음';
    }
  }
  counts.set(verdict, (counts.get(verdict) || 0) + 1);
  out.push({ row: i + 1, plate, code, trim: S(rec?.trim), variantTrims: (variantTrims.get(code.replace(/::t\d+$/, '')) || []).length, verdict, found: foundWord, state: S(r[at('차량상태')]), provider: S(r[at('공급사코드')]), maker: S(rec?.maker), model: S(rec?.model), sub_model: S(rec?.sub_model) });
}
const sellable = (x: Row) => x.state !== '출고불가';
console.log(`■ 트림 근거 감사 — 상품마스터 확정 코드 ${out.length}대 (팔 수 있는 차 ${out.filter(sellable).length})`);
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${k}  (팔 수 있는 차 ${out.filter((x) => x.verdict === k && sellable(x)).length})`);
const noEvidence = out.filter((x) => x.verdict === '근거 없음'); const otherTrim = out.filter((x) => x.verdict === '다른 트림');
console.log('\n  근거 없음(다중 트림) 예:'); for (const x of noEvidence.filter(sellable).slice(0, 15)) console.log(`     ${x.plate.padEnd(10)} ${x.provider.padEnd(8)} ${x.model} ${x.sub_model} · 코드 트림 「${x.trim}」 · 변형 트림 ${x.variantTrims}개`);
console.log('  다른 트림 글자 예:'); for (const x of otherTrim.filter(sellable).slice(0, 10)) console.log(`     ${x.plate.padEnd(10)} ${x.provider.padEnd(8)} ${x.model} ${x.sub_model} · 코드 트림 「${x.trim}」 · 원문엔 「${x.found}」`);
writeFileSync('tmp/trim-evidence-report.json', JSON.stringify({ generated_at: new Date().toISOString(), counts: Object.fromEntries(counts), rows: out }, null, 2));
console.log('  보고 tmp/trim-evidence-report.json');
if (!APPLY) { console.log('※ dry-run. 원천대장 탭 반영은 --apply, 근거 없음 트림 비움은 --demote --apply'); process.exit(0); }

// ── 원천대장 「트림 근거 대조」 탭
const TAB = '트림 근거 대조';
const R: string[][] = [[`${TAB} — 상품마스터 확정 코드의 트림에 공급사 원문 근거가 있는가 · 갱신 ${kst()} KST`, '', '', '', '', '', '', '', ''],
  ['규칙: 근거 있음(원문에 트림 글자) · 유일 트림(변형에 하나뿐) · 다른 트림(원문에 다른 트림 글자 → CODE 결정으로 바로잡기) · 근거 없음(변형에 여럿, 글자 없음 → 트림 비움 = 사장님 「트림 없는 건 비운다」)', '', '', '', '', '', '', '', ''],
  ['판정', '차량번호', '공급사', '차량상태', '차종코드', '코드 트림', '변형 트림 수', '원문에서 찾은 글자', '조치']];
const order: Record<string, number> = { '다른 트림': 0, '근거 없음': 1, '코드 없음(마스터)': 2, '유일 트림': 3, '근거 있음(결정)': 4, '근거 있음': 5 };
for (const x of [...out].sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.plate.localeCompare(b.plate))) R.push([x.verdict, x.plate, x.provider, x.state, x.code, x.trim, String(x.variantTrims), x.found, x.verdict === '근거 없음' ? (DEMOTE ? '트림 비움(2026-08-19)' : '트림 비움 대상') : x.verdict === '다른 트림' ? '사람 확인 → 결정 파일 CODE' : '']);
const meta = await call(`${SH}/${M}?fields=sheets.properties(sheetId,title)`);
let gid = ((meta.sheets || []) as Rec[]).map((s) => s.properties).find((p: Rec) => S(p.title) === TAB)?.sheetId;
if (gid === undefined) { const added = await call(`${SH}/${M}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: R.length + 20, columnCount: 9, frozenRowCount: 3 } } } }] }) }); gid = added.replies?.[0]?.addSheet?.properties?.sheetId; }
await call(`${SH}/${M}/values/${encodeURIComponent(`'${TAB}'!A1:Z3000`)}:clear`, { method: 'POST', body: '{}' });
await call(`${SH}/${M}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: R }) });
await call(`${SH}/${M}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'CLIP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: 12, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: 2, endRowIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.9, blue: 0.99 }, textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  ...[110, 100, 70, 70, 330, 120, 80, 140, 220].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
] }) });
console.log(`  ✓ 원천대장 「${TAB}」 ${R.length}줄`);

if (!DEMOTE) process.exit(0);
// ── 트림 비움(근거 없음): 상품마스터 차종코드·적용값 비움 + 검수필요 + 사유 / 결정 파일 PARTIAL / 정제칸 세부트림 비움
const targets = noEvidence;
console.log(`\n■ 트림 비움 — 근거 없음 ${targets.length}대(팔 수 있는 차 ${targets.filter(sellable).length})`);
const colIdx = { code: at('차종코드'), applied: at('차종마스터 적용값'), verif: at('검증상태'), reason: at('검수사유') };
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const data: { range: string; values: string[][] }[] = [];
for (const x of targets) {
  data.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(colIdx.code)}${x.row}`, values: [['']] });
  if (colIdx.applied >= 0) data.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(colIdx.applied)}${x.row}`, values: [['']] });
  data.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(colIdx.verif)}${x.row}`, values: [['검수필요']] });
  if (colIdx.reason >= 0) data.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(colIdx.reason)}${x.row}`, values: [[`트림 근거 없음 — 원문에 트림 글자 없고 변형(${x.model} ${x.sub_model})에 트림 ${x.variantTrims}개 → 트림 비움(2026-08-19, 옛 코드 ${x.code})`]] });
}
writeFileSync(`tmp/trim-demote-snapshot-${Date.now()}.json`, JSON.stringify(targets, null, 2));
for (let i = 0; i < data.length; i += 400) await call(`${SH}/${M}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 400) }) });
console.log(`  ✓ 상품마스터 ${targets.length}줄 코드·적용값 비움 + 검수필요`);
// 결정 파일 PARTIAL
const dp = 'data/product-vehicle-review-decisions.json'; const d = JSON.parse(readFileSync(dp, 'utf8'));
const have = new Set((d.decisions as Rec[]).map((x) => plateOf(x.car_number)));
let added = 0;
for (const x of targets) {
  if (have.has(x.plate)) continue;
  d.decisions.push({ car_number: x.plate, provider: x.provider, supplier_text: '', maker: x.maker, model: x.model, sub_model: x.sub_model, trim: '', trim_row_key: '', decision: 'PARTIAL', master_action: 'NONE', basis: `2026-08-19 트림 근거 감사 — 원문에 트림 글자 없음, 변형에 트림 ${x.variantTrims}개(옛 코드 ${x.code} = 첫 트림 추정). 사장님 「트림 없는 건 비운다」. 공급사가 트림을 적어 주면 CODE 로.`, reviewed_at: '2026-08-19' });
  added++;
}
writeFileSync(dp, `${JSON.stringify(d, null, 2)}\n`);
console.log(`  ✓ 결정 파일 PARTIAL ${added}건 추가`);
// 정제칸 세부트림 비움
const bySheet = new Map<string, { range: string; values: string[][] }[]>();
for (const x of targets) { const c = sheetTrimCell.get(x.plate); if (!c || !c.value) continue; const list = bySheet.get(c.id) || []; list.push({ range: `'${c.tab.replace(/'/g, "''")}'!${colA1(c.col)}${c.row}`, values: [['']] }); bySheet.set(c.id, list); }
let cleared = 0;
for (const [id, list] of bySheet) { await call(`${SH}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: list }) }); cleared += list.length; }
console.log(`  ✓ 공급사 시트 정제칸 세부트림 비움 ${cleared}칸 — 다음: fill-supplier-ai-columns --apply --include-mirror(차종코드 정제칸 비움) → run-daily`);
