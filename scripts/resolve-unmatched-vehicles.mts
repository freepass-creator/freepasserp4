/**
 * **정제칸에 코드가 없는(팔 수 있는) 차를 차종마스터와 맞춰 3축 결정으로 적는다.** 기본 dry-run, 반영은 `--apply`(결정 파일에 추가).
 *
 * ★사장님 2026-08-18 — 「정제칸 채워줘, 그래야 상품리스트에 정제된 규격으로 올라가지」 · 「공급사 정제시트는 한 번만 차종마스터 맞춰 두면 되잖아」.
 *   정본(상품마스터 코드·결정)이 없는 차만 대상. 결과는 `data/product-vehicle-review-decisions.json` 에 CODE/PARTIAL 로 들어간다 —
 *   그 뒤 fill-supplier-ai-columns(정제칸)·publish-origin-tab(상품리스트)·plan/apply-product-master-vehicle-coverage(상품마스터 코드)가 그 결정을 쓴다.
 * ★판정 규칙(지어내지 않는다):
 *   ① 스냅(글자→마스터)으로 제조사·세부모델을 잡는다. 공급사 글자에 세대코드(KA4·DN8·GN7·LX2·MQ4·NQ5·JX1·RG3·CN7 …)가 있으면 그것으로 세부모델을 못 박는다.
 *   ② 그 세부모델의 마스터 행 가운데 연료·배기량(±7%)이 맞는 것만 남긴다.
 *   ③ 남은 행의 세부트림 가운데 공급사 글자에 그 트림 이름이 있으면 그것 → **CODE**(하나일 때만).
 *      트림 글자가 없거나 여럿이면 → **PARTIAL**(제조사·모델·세부모델까지, 트림 빈칸).
 *      세부모델 행이 마스터에 없으면 → 안 적는다(마스터 보강 후보로 목록).
 *   ④ 이미 결정이 있는 차는 건드리지 않는다.
 *
 *   npx tsx scripts/resolve-unmatched-vehicles.mts
 *   npx tsx scripts/resolve-unmatched-vehicles.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { MASTER_SHEET_ID, MASTER_TAB, readMasterSheet, type MasterRow } from '../lib/domain/vehicle-master-sheet';
import { snapToMaster } from '../lib/domain/vehicle-master-match';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { normFuel } from '../lib/domain/vehicle-master-format';
import { adoptedSpecByKey, buildPlateNormalization } from '../lib/domain/product-vehicle-normalization';
import { loadProductVehicleReviewDecisions, PRODUCT_VEHICLE_REVIEW_DECISIONS_PATH } from '../lib/domain/product-vehicle-review-decisions';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';
import { companyAlias } from '../lib/domain/identity';
import type { MasterEntry, VehicleTrimMasterArtifact } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const key = (v: unknown) => norm(v).toLowerCase().replace(/[()（）\-_.·,/]/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string): Promise<Rec> => { for (let n = 0; ; n++) { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } }); const t = await r.text(); if (r.ok) return JSON.parse(t); if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; } throw new Error(`${r.status} ${t.slice(0, 200)}`); } };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── 정본·마스터
const masterValues = (((await call(`${SH}/${MASTER_SHEET_ID}/values/${encodeURIComponent(`'${MASTER_TAB}'`)}`)) as { values?: string[][] }).values || []).map((r) => r.map(S));
const BOOK = readMasterSheet(masterValues);
/** 코드 → 연식/생산 기간(연도) — 페이스리프트(더 뉴 …)와 이전 세대를 등록 연도로 가른다. */
const PERIOD = new Map<string, { start: number; end: number }>();
{
  const h = masterValues[0] || []; const at = (n: string) => h.indexOf(n);
  const ci = at('트림행키'), ps = at('생산시작'), pe = at('생산종료'), ys = at('연식시작'), ye = at('연식종료');
  const yr = (v: unknown) => Number((S(v).match(/20\d\d|19\d\d/) || [0])[0]) || 0;
  for (const r of masterValues.slice(1)) { const c = S(r[ci]); if (!c) continue; const start = yr(r[ys]) || yr(r[ps]); const end = yr(r[ye]) || yr(r[pe]) || (start ? 2100 : 0); if (start) PERIOD.set(c, { start, end }); }
}
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const ENTRIES = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];
const pm = await call(`${SH}/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AZ`)}`) as { values?: unknown[][] };
const adoptedValues = await call(`${SH}/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent("'차종마스터_규격채택'!A:AD")}`) as { values?: unknown[][] };
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
const decisionsFile = loadProductVehicleReviewDecisions();
const NORMALIZED = buildPlateNormalization({ productMasterValues: pm.values || [], adopted: adoptedSpecByKey(adoptedValues.values || []), artifact, decisions: decisionsFile.decisions }).byPlate;
const decided = new Set(decisionsFile.decisions.map((d) => norm(d.car_number)));
console.log(`■ 미해결 차 3축 결정 ${APPLY ? '반영' : '미리보기'} — 마스터 ${BOOK.byCode.size}행 · 정본 ${NORMALIZED.size}대 · 기존 결정 ${decided.size}`);

// 마스터를 제조사+세부모델로 묶는다(제조사는 표기 규격으로)
const bySub = new Map<string, MasterRow[]>();
for (const row of BOOK.byCode.values()) { const k = `${key(canonMakerDisplay(row.maker))}|${key(row.subModel)}`; bySub.set(k, [...(bySub.get(k) || []), row]); }
const byMaker = new Map<string, MasterRow[]>();
for (const row of BOOK.byCode.values()) { const k = key(canonMakerDisplay(row.maker)); byMaker.set(k, [...(byMaker.get(k) || []), row]); }
const GEN = /\b([A-Z]{1,3}\d{1,2}[A-Z]?|[A-Z]{2,4})\b/g;   // KA4 · DN8 · GN7 · LX2 · MQ4 · NQ5 · JX1 · RG3 · CN7 · TAM · HZG · MX5 · JK1 · GL3 · TF · IG …
/** 마스터 세부모델에 실제로 쓰인 세대코드만 인정한다(LONG·RWD 같은 영어 단어가 세대코드로 잡히지 않게). */
const GEN_TOKENS = new Set<string>();
for (const row of BOOK.byCode.values()) for (const m of `${row.subModel}`.toUpperCase().matchAll(GEN)) if (m[1].length >= 2) GEN_TOKENS.add(m[1]);
const ccOf = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) || 0;
const fuelOf = (v: unknown) => { const f = normFuel(v); return f === 'lpg' ? 'LPG' : f; };

// ── 공급사 시트에서 미해결 차 모으기
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
type Car = { plate: string; supplier: string; code: string; maker: string; name: string; fuel: string; cc: number; year: string; options: string; sub: string; trimRaw: string };
const cars: Car[] = [];
for (const f of (found.files || []) as Rec[]) {
  const supplier = supplierSheetLabel(S(f.name));
  const meta = await call(`${SH}/${f.id}?fields=sheets.properties(title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const t = S(sh.properties.title); if (sh.properties.hidden || isOurNonInventoryTab(t)) continue;
    const v = await call(`${SH}/${f.id}/values/${encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S)); const h = rows[0] || [];
    const at = (n: string) => h.findIndex((x) => norm(x) === norm(n));
    const pi = at('차량번호'), si = at('상태'), ci = at('차종코드'); if (pi < 0) continue;
    for (const r of rows.slice(1)) {
      const plate = norm(r[pi]); if (!plate || /출고불가/.test(S(r[si])) || S(r[ci])) continue;
      if (NORMALIZED.has(plate) || decided.has(plate)) continue;
      const g = (n: string) => { const i = at(n); return i < 0 ? '' : S(r[i]); };
      cars.push({ plate, supplier, code: companyAlias(supplier) || supplier, maker: canonMakerDisplay(g('제조사(정제)') || g('제조사')), name: [g('차명(세부모델+트림)'), g('모델명'), g('세부모델') && !g('차명(세부모델+트림)') ? g('세부모델') : ''].filter(Boolean).join(' '), fuel: fuelOf(g('연료') || g('연료(정제)')), cc: ccOf(g('배기량') || g('배기량(정제)')), year: (S(g('연식')).match(/20\d\d/) || S(g('최초등록일')).match(/20\d\d/) || [''])[0], options: g('옵션'), sub: g('세부모델'), trimRaw: g('세부트림') });
    }
    await sleep(300);
  }
}
console.log(`  코드 없는 팔 수 있는 차 ${cars.length}대`);

// ── 판정
type Out = { car: Car; decision: 'CODE' | 'PARTIAL' | 'NONE'; row?: MasterRow; sub?: string; model?: string; maker?: string; why: string; cands: number };
const outs: Out[] = [];
for (const car of cars) {
  const snap = snapToMaster({ maker: car.maker, model: '', sub_model: car.name, trim_name: car.trimRaw, fuel_type: car.fuel, engine_cc: car.cc || undefined } as EntityRecord, ENTRIES);
  const maker = canonMakerDisplay(snap?.maker || car.maker);
  const gens = [...new Set([...`${car.name}`.toUpperCase().matchAll(GEN)].map((m) => m[1]).filter((g) => GEN_TOKENS.has(g) && !/^(AWD|FWD|RWD|LPI|LPG|GDI|CVT|DCT|SUV|EV|HEV|PHEV|MY|AT|MT|SBW|HUD|II|III|IV|VI|VII|DE|MP|GT|GL|SE|LE|RE|N|X)$/.test(g)))];
  let cands: MasterRow[] = [];
  let sub = snap?.sub_model ? S(snap.sub_model) : '';
  // 세대코드로 못 박기
  const makerRows = byMaker.get(key(maker)) || [];
  for (const gcode of gens) { const hit = makerRows.filter((r) => key(r.subModel).includes(key(gcode)) || key(r.code).includes(key(gcode))); if (hit.length) { cands = hit; sub = hit[0].subModel; break; } }
  if (!cands.length && sub) cands = bySub.get(`${key(maker)}|${key(sub)}`) || [];
  if (!cands.length && sub) { const k = key(sub); cands = makerRows.filter((r) => key(r.subModel) === k || key(r.subModel).includes(k) || k.includes(key(r.subModel))); }
  const before = cands.length;
  if (process.env.DEBUG_PLATE && car.plate === process.env.DEBUG_PLATE) console.log('DEBUG', { gens, sub, year: car.year, fuel: car.fuel, cc: car.cc, cands: cands.map((r) => `${r.subModel}/${r.trim}/${r.fuel}/${r.cc}/${JSON.stringify(PERIOD.get(r.code))}`).slice(0, 12) });
  // 연료·배기량으로 좁히기
  let narrowed = cands;
  if (car.fuel) { const f = narrowed.filter((r) => fuelOf(r.fuel) === car.fuel); if (f.length) narrowed = f; }
  // 배기량이 비어 있으면 차명의 「2.0」·「1.6」 같은 리터 표기로 대신 좁힌다(±10%)
  const liters = !car.cc ? Number((car.name.match(/(\d\.\d)\s*(?:L|T|터보|가솔린|디젤|LPI|LPG|HEV|하이브리드|2WD|4WD|AWD|\s)/i) || [])[1] || 0) : 0;
  const ccGuess = car.cc || (liters ? Math.round(liters * 1000) : 0);
  if (ccGuess > 300) { const tol = car.cc ? 0.07 : 0.1; const f = narrowed.filter((r) => { const c = ccOf(r.cc); return !c || Math.abs(c - ccGuess) / ccGuess <= tol; }); if (f.length) narrowed = f; }
  // 트림 글자
  // 공급사 글자만 본다 — 정제칸(세부트림)은 옛 스냅 값일 수 있어 안 본다
  const text = key(car.name);   // 트림 글자는 차명에서만 — 옵션 글자(스마트키·기본형 패키지)로 트림을 맞추면 틀린다
  // 세부모델 후보가 여럿(세대·페이스리프트)이면 등록 연도로 가른다 — 연식시작~연식종료(±1년) 안의 행만
  let distinctSubs = [...new Set(narrowed.map((r) => key(r.subModel)))];
  if (distinctSubs.length > 1 && car.year) {
    const y = Number(car.year);
    const inYear = narrowed.filter((r) => { const p = PERIOD.get(r.code); return p ? (y >= p.start - 1 && y <= p.end + 1) : false; });
    if (inYear.length) { narrowed = inYear; distinctSubs = [...new Set(narrowed.map((r) => key(r.subModel)))]; }
    // 그래도 여럿이면 «더 뉴»(페이스리프트) 여부를 공급사 글자로 — 글자에 「더 뉴/더뉴/F/L/페이스리프트」가 있으면 그쪽, 없으면 그 밖
    if (distinctSubs.length > 1) {
      const wantsFL = /더뉴|더\s*뉴|F\/L|페이스리프트|facelift/i.test(car.name);
      const pick = narrowed.filter((r) => /더뉴|더\s*뉴|FL$|F\/L/i.test(r.subModel) === wantsFL);
      if (pick.length) { narrowed = pick; distinctSubs = [...new Set(narrowed.map((r) => key(r.subModel)))]; }
    }
  }
  const withTrim = narrowed.filter((r) => S(r.trim) && text.includes(key(r.trim)));
  if (!narrowed.length) { outs.push({ car, decision: 'NONE', why: sub ? `세부모델 「${sub}」 행이 마스터에 없음(후보 ${before})` : `세부모델을 못 잡음(스냅 ${snap?.confidence || '없음'})`, cands: before }); continue; }
  if (distinctSubs.length > 1) { outs.push({ car, decision: 'NONE', why: `세부모델 후보 여럿: ${[...new Set(narrowed.map((r) => r.subModel))].slice(0, 4).join(' / ')}`, cands: narrowed.length }); continue; }
  const pickRow = withTrim.length === 1 ? withTrim[0] : (narrowed.length === 1 && (!S(narrowed[0].trim) || text.includes(key(narrowed[0].trim))) ? narrowed[0] : undefined);
  if (pickRow) outs.push({ car, decision: 'CODE', row: pickRow, maker: canonMakerDisplay(pickRow.maker), model: pickRow.model, sub: pickRow.subModel, why: `${withTrim.length === 1 ? '트림 글자 일치' : '후보 하나'} · 연료 ${car.fuel || '?'} · ${car.cc || '?'}cc`, cands: narrowed.length });
  else outs.push({ car, decision: 'PARTIAL', maker: canonMakerDisplay(narrowed[0].maker), model: narrowed[0].model, sub: narrowed[0].subModel, why: `트림 후보 ${[...new Set(narrowed.map((r) => r.trim || '(없음)'))].slice(0, 5).join(' / ')} — 글자로 못 가름`, cands: narrowed.length });
}
const cnt = (k: string) => outs.filter((o) => o.decision === k).length;
console.log(`  판정: CODE ${cnt('CODE')} · PARTIAL ${cnt('PARTIAL')} · 못 정함 ${cnt('NONE')}`);
for (const o of outs) console.log(`  ${o.decision.padEnd(7)} ${o.car.supplier.padEnd(6)} ${o.car.plate} 「${o.car.name.slice(0, 34)}」 → ${o.decision === 'NONE' ? o.why : `${o.maker} · ${o.model} · ${o.sub}${o.row ? ` · ${o.row.trim || '(트림없음)'} [${o.row.code}]` : ' · (트림 미정)'} — ${o.why}`}`);
writeFileSync('tmp/resolve-unmatched-report.json', JSON.stringify(outs.map((o) => ({ ...o, row: o.row?.code })), null, 2));
if (!APPLY) { console.log('※ dry-run. 결정 파일에 넣으려면 --apply'); process.exit(0); }
const now = new Date().toISOString().slice(0, 10);
const add = outs.filter((o) => o.decision !== 'NONE').map((o) => ({
  car_number: o.car.plate, provider: o.car.code, supplier_text: `${o.car.maker} ${o.car.name} · ${o.car.fuel} ${o.car.cc || ''} · ${o.car.year}`.trim(),
  // ★결정 파일의 제조사는 마스터 표기 그대로(르노코리아) — 검증기(plan-product-vehicle-review-decisions)가 코드 행과 글자로 견준다. 시트 표기(르노)는 채울 때 canonMakerDisplay 가 맞춘다.
  maker: o.decision === 'CODE' ? S(o.row!.maker) : o.maker, model: o.model, sub_model: o.sub, trim: o.decision === 'CODE' ? S(o.row!.trim) : '',
  // 코드 행이 automatic 확정키가 아니면 CODE 대신 TRIPLE(이름 3축)로 둔다 — 마스터 승격 뒤 CODE 로.
  trim_row_key: o.decision === 'CODE' && o.row!.state === '확정' ? o.row!.code : '',
  decision: o.decision === 'CODE' && o.row!.state !== '확정' ? 'TRIPLE' : o.decision,
  master_action: o.decision === 'CODE' && o.row!.state !== '확정' ? 'UNBLOCK' : 'ALIAS',
  basis: `auto ${now} 차종마스터 대조 — ${o.why} (후보 ${o.cands})`,
}));
const file = JSON.parse(readFileSync(PRODUCT_VEHICLE_REVIEW_DECISIONS_PATH, 'utf8')) as Rec;
file.decisions = [...(file.decisions || []), ...add];
file.reviewed_by = `${S(file.reviewed_by)} + claude-auto ${now}`.trim();
writeFileSync(PRODUCT_VEHICLE_REVIEW_DECISIONS_PATH, JSON.stringify(file, null, 2) + '\n', 'utf8');
loadProductVehicleReviewDecisions();   // 검증 — 형식이 틀리면 여기서 던진다
console.log(`  ✓ 결정 ${add.length}건 추가 → ${PRODUCT_VEHICLE_REVIEW_DECISIONS_PATH} (CODE ${add.filter((a) => a.decision === 'CODE').length} · PARTIAL ${add.filter((a) => a.decision === 'PARTIAL').length})`);
