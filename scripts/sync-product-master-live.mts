/**
 * 오더 A — 공급사 시트 → 상품마스터 live 칸 일일 갱신.
 * 기본 dry-run. `--apply` 시에만 쓴다. ERP/RTDB·잠금칸·차종코드는 건드리지 않는다.
 *
 *   npx tsx scripts/sync-product-master-live.mts
 *   npx tsx scripts/sync-product-master-live.mts --apply
 *   npx tsx scripts/sync-product-master-live.mts --dump=tmp/product-master-live-dump.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { importSheetTable } from '../lib/domain/sheet-import';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_MANUAL_TAB,
  PRODUCT_MASTER_TAB,
  productMasterSourceRowInfo,
  productMasterSupplierVehicleName,
} from '../lib/domain/product-master-sheet';
import {
  buildAbsentLivePatch,
  buildUnmatchedAppendRow,
  liveValuesFromSupplierProduct,
  normalizePlate,
  planProductMasterLivePatches,
  summarizeProviderPlans,
  type ProductMasterLivePlatePlan,
} from '../lib/domain/product-master-live-sync';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const FORCE_SHRINK = process.argv.includes('--force-shrink');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SHEET_ID = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');
const SALES_SHEET = arg('sales', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const DUMP = arg('dump', '');
const TODAY = new Date().toISOString().slice(0, 10);

/** 매뉴얼 탭에서 자동반영 금지 공급사코드만 뽑는다(상품마스터 전행 import 불필요). */
function manualBlockedProviderCodes(manualTable: string[][]): Set<string> {
  const headerRow = manualTable.findIndex((row) => {
    const cells = row.map(S);
    return cells.includes('판정') && cells.includes('코드') && cells.some((c) => /누락|주의/.test(c));
  });
  if (headerRow < 0) return new Set();
  const header = manualTable[headerRow].map(S);
  const iCode = header.indexOf('코드');
  const iNote = header.findIndex((c) => /누락|주의/.test(c));
  const blocked = new Set<string>();
  const re = /자동\s*반영\s*금지|반영\s*차단|연동\s*차단|자동\s*상태.*금지|자동\s*가격.*금지/i;
  for (const row of manualTable.slice(headerRow + 1)) {
    const code = S(row[iCode]);
    const note = S(row[iNote]);
    if (code && re.test(note)) blocked.add(code);
  }
  return blocked;
}

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const auth = new JWT({
  email: S(sa.client_email), key: S(sa.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
});
const gT = (await auth.getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      const wait = Math.min(60_000, 5_000 * 2 ** n);
      console.log(`  … ${res.status} — ${Math.round(wait / 1000)}초 쉬고 다시`);
      await new Promise((ok) => setTimeout(ok, wait));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries || []) as MasterEntry[];

// ── @제외 (발행기와 동일)
type ExcludeRule = { code: string; tab: string };
const EXCLUDE: ExcludeRule[] = [];
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET}/values/${encodeURIComponent("'AI 인계'!A1:C400")}`) as { values?: string[][] };
  const rows = v.values || [];
  const from = rows.findIndex((r) => S(r[0]) === '@제외');
  if (from >= 0) {
    for (const r of rows.slice(from + 1)) {
      if (S(r[0]) === '@제외끝') break;
      const spec = S(r[1]);
      if (!spec) continue;
      const [code, tab = ''] = spec.split(':');
      if (code) EXCLUDE.push({ code: code.trim(), tab: tab.trim() });
    }
  }
} catch { /* 없으면 제외 없음 */ }
/**
 * ★@제외는 «판매시트 표시 규칙»이다 — 오토플러스 전부(오플 탭 통째 복사)·손오공 구독(별도 탭)은 판매시트에서만 뺀다.
 *   상품마스터(ERP 입력)는 그 차들도 있어야 한다(2026-08-18 실측: 그대로 쓰면 오플 98대·손오공 구독 45대가 «부재»로 출고불가가 된다).
 *   그래서 여기서는 **재고 탭이 아닌 탭 규칙만** 따른다(정책·수수료·월렌트 …). 공급사 통째 제외·구독/렌트 탭 제외는 무시한다.
 */
const excluded = (code: string, tabTitle: string) =>
  EXCLUDE.some((x) => x.code === code && x.tab && !/구독|렌트|재고/.test(x.tab) && S(tabTitle).includes(x.tab));

const byCode = new Map<string, Rec & { sheet_urls: string[] }>();
{
  const idx = await api(`https://sheets.googleapis.com/v4/spreadsheets/${INDEX_SHEET}/values/A1:Z200`) as { values?: string[][] };
  for (const r of (idx.values || [])) {
    const name = S(r[0]); const c = S(r[1]); const url = S(r[2]);
    if (!c || !url || !/^https?:/.test(url)) continue;
    const cur = byCode.get(c);
    byCode.set(c, {
      ...(cur || {}),
      partner_name: S(cur?.partner_name || cur?.name) || name,
      partner_code: c,
      sheet_urls: [...new Set([url, ...(cur?.sheet_urls || [])])],
    } as Rec & { sheet_urls: string[] });
  }
  console.log(`문패 ${byCode.size}곳 · @제외 ${EXCLUDE.length} · ${APPLY ? 'APPLY' : 'dry-run'}\n`);
}

// ── 상품마스터 + 매뉴얼
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
const liveResp = await api(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`)}`) as { values?: unknown[][] };
const masterValues = (liveResp.values || []).map((row) => row.map((c) => String(c ?? '')));
const headers = (masterValues[0] || []).map(S);
if (headers.length !== PRODUCT_MASTER_COLUMNS.length
  || PRODUCT_MASTER_COLUMNS.some((name, i) => headers[i] !== name)) {
  throw new Error('상품마스터 A:AX 헤더 불일치');
}
const col = (name: string) => headers.indexOf(name);
const manualResp = await api(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_MANUAL_TAB}'!A:Z`)}`) as { values?: unknown[][] };
const manualTable = (manualResp.values || []).map((row) => row.map((c) => String(c ?? '')));
const blockedCodes = manualBlockedProviderCodes(manualTable);

const masterByPlate = new Map<string, { rowNumber: number; cells: string[] }>();
const masterPlatesByProvider = new Map<string, Set<string>>();
for (let i = 1; i < masterValues.length; i++) {
  const cells = masterValues[i] || [];
  const plate = normalizePlate(cells[col('차량번호')]);
  if (!plate) continue;
  masterByPlate.set(plate, { rowNumber: i + 1, cells: [...cells] });
  const code = S(cells[col('공급사코드')]);
  if (!masterPlatesByProvider.has(code)) masterPlatesByProvider.set(code, new Set());
  masterPlatesByProvider.get(code)!.add(plate);
}

const snapshotPath = resolve(arg('snapshot', `tmp/product-master-live-snapshot-${Date.now()}.json`));
mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, JSON.stringify({ generated_at: new Date().toISOString(), values: masterValues }, null, 2));

const allPlans: ProductMasterLivePlatePlan[] = [];
const providerSummaries: Rec[] = [];
const dumpByPlate: Rec = {};
const seenSourcePlates = new Set<string>();

for (const [code, p] of [...byCode].sort()) {
  const name = S(p.partner_name || p.name) || code;
  if (NOT_SHEET_BACKED.has(code)) {
    providerSummaries.push({ code, name, note: '홈페이지 수집 — 시트 없음', blocked: 1 });
    continue;
  }
  let read: ReturnType<typeof readSupplierSheet> | null = null;
  let lastErr = '';
  for (const url of (p.sheet_urls || [])) {
    const id = (S(url).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id) continue;
    try {
      const grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
      const got = readSupplierSheet(grid as never, p as EntityRecord);
      if (got.tabs.length) { read = got; break; }
      lastErr = '표 탭 없음';
    } catch (e) { lastErr = String((e as Error).message).slice(0, 80); }
  }
  if (!read) {
    providerSummaries.push({ code, name, note: `시트 읽기 실패: ${lastErr}`, blocked: 1 });
    continue;
  }

  const sourceProducts = new Map<string, EntityRecord>();
  const sourceRaw = new Map<string, { headers: string[]; row: string[]; tab: string }>();
  for (const tab of read.tabs) {
    if (excluded(code, tab.title) || isOurNonInventoryTab(tab.title)) continue;
    const table = (tab.table || []).map((row) => row.map((c) => String(c ?? '')));
    if (table.length < 2) continue;
    const header = table[0].map(S);
    const plateIdx = header.findIndex((h) => /차량번호|차번|차량넘버/.test(h.replace(/\s/g, '')));
    const statusIdx = header.findIndex((h) => /배차상태|차량상태|상태/.test(h.replace(/\s/g, '')));
    const preview = table.map((row, rowIndex) => {
      if (!rowIndex || statusIdx < 0) return [...row];
      const copy = [...row];
      if (normalizePlate(copy[plateIdx])) copy[statusIdx] = '출고가능';
      return copy;
    });
    let imported;
    try {
      imported = importSheetTable(preview, {
        providerCode: code,
        entries,
        acceptAssignedPendingPlate: true,
      });
    } catch (e) {
      console.log(`  ⚠ ${code} ${tab.title} 파서 실패: ${String((e as Error).message).slice(0, 80)}`);
      continue;
    }
    for (const product of imported.products) {
      const plate = normalizePlate(product.car_number);
      if (!plate) continue;
      const sourceRow = table.find((row, idx) => idx > 0 && normalizePlate(row[plateIdx]) === plate);
      if (sourceRow && statusIdx >= 0) {
        product.status_label_raw = S(sourceRow[statusIdx]) || product.status_label_raw;
        product.vehicle_status = product.status_label_raw;
      }
      product.sheet_source_tab = tab.title;
      sourceProducts.set(plate, product);
      if (sourceRow) sourceRaw.set(plate, { headers: header, row: sourceRow, tab: tab.title });
    }
  }

  const sourcePlates = [...sourceProducts.keys()];
  const masterSet = masterPlatesByProvider.get(code) || new Set<string>();
  const manualBlocked = blockedCodes.has(code);
  const plans: ProductMasterLivePlatePlan[] = [];

  for (const plate of sourcePlates) {
    seenSourcePlates.add(plate);
    const product = sourceProducts.get(plate)!;
    const { values, diagnostics } = liveValuesFromSupplierProduct(product, { today: TODAY });
    const existing = masterByPlate.get(plate);
    if (!existing) {
      const raw = sourceRaw.get(plate);
      const rawInfo = raw
        ? productMasterSourceRowInfo({ tab: raw.tab, headers: raw.headers, row: raw.row })
        : S(product._raw_vehicle?.source_text || product.model || '');
      const supplierName = raw
        ? productMasterSupplierVehicleName(rawInfo)
        : S(product.model || product.sub_model || '');
      const appendRow = buildUnmatchedAppendRow({
        car_number: plate,
        provider_code: code,
        provider_name: name,
        supplier_vehicle_name: supplierName,
        raw_preserved: typeof rawInfo === 'string' ? rawInfo : JSON.stringify(rawInfo),
        live: values,
        today: TODAY,
      });
      plans.push({
        car_number: plate, provider_code: code, kind: 'append',
        patches: PRODUCT_MASTER_COLUMNS.map((column, columnIndex) => ({
          column, columnIndex, before: '', after: appendRow[columnIndex],
        })).filter((p) => p.after),
        diagnostics,
        expected_updated_at: '',
      });
      dumpByPlate[plate] = { provider: code, kind: 'append', ...values };
      continue;
    }
    if (manualBlocked) {
      plans.push({
        car_number: plate, provider_code: code, kind: 'blocked',
        rowNumber: existing.rowNumber, patches: [], diagnostics: [...diagnostics, '매뉴얼 차단'],
        expected_updated_at: S(existing.cells[col('최종갱신')]),
      });
      continue;
    }
    const plan = planProductMasterLivePatches({
      headers, masterRow: existing.cells, rowNumber: existing.rowNumber,
      incoming: values, diagnostics,
    });
    plans.push(plan);
    dumpByPlate[plate] = {
      provider: code, kind: plan.kind,
      patches: plan.patches.map((p) => ({ column: p.column, before: p.before, after: p.after })),
    };
  }

  for (const plate of masterSet) {
    if (sourceProducts.has(plate)) continue;
    const existing = masterByPlate.get(plate);
    if (!existing) continue;
    if (manualBlocked) {
      plans.push({
        car_number: plate, provider_code: code, kind: 'blocked',
        rowNumber: existing.rowNumber, patches: [], diagnostics: ['매뉴얼 차단(부재)'],
        expected_updated_at: S(existing.cells[col('최종갱신')]),
      });
      continue;
    }
    const plan = buildAbsentLivePatch({
      headers, masterRow: existing.cells, rowNumber: existing.rowNumber, today: TODAY,
    });
    plans.push(plan);
    dumpByPlate[plate] = { provider: code, kind: 'absent', patches: plan.patches };
  }

  const summary = summarizeProviderPlans(
    code, name, plans, sourcePlates.length, masterSet.size, manualBlocked, FORCE_SHRINK,
  );
  providerSummaries.push(summary);
  if (summary.shrink_blocked || summary.manual_blocked) {
    // 해당 공급사 계획은 적용 목록에서 제외(진단만)
    continue;
  }
  allPlans.push(...plans.filter((p) => p.patches.length > 0));
}

const updates: { range: string; values: string[][] }[] = [];
const appendRows: string[][] = [];
const colLetter = (index: number) => {
  let n = index + 1; let out = '';
  while (n) { out = String.fromCharCode(65 + ((n - 1) % 26)) + out; n = Math.floor((n - 1) / 26); }
  return out;
};

if (APPLY) {
  // CAS: 차량번호·최종갱신 재조회
  const fresh = await api(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`)}`) as { values?: unknown[][] };
  const freshValues = fresh.values || [];
  for (const plan of allPlans) {
    if (plan.kind === 'append') {
      const row = PRODUCT_MASTER_COLUMNS.map((_, i) => {
        const patch = plan.patches.find((p) => p.columnIndex === i);
        return patch?.after || '';
      });
      appendRows.push(row);
      continue;
    }
    if (!plan.rowNumber) continue;
    const liveRow = freshValues[plan.rowNumber - 1] || [];
    const livePlate = normalizePlate(liveRow[col('차량번호')]);
    const liveUpdated = S(liveRow[col('최종갱신')]);
    if (livePlate !== plan.car_number) throw new Error(`CAS 차량번호 불일치 ${plan.car_number} row ${plan.rowNumber}`);
    if (liveUpdated !== plan.expected_updated_at) {
      throw new Error(`CAS 최종갱신 불일치 ${plan.car_number}: expected ${plan.expected_updated_at} got ${liveUpdated}`);
    }
    for (const patch of plan.patches) {
      const a1 = `'${PRODUCT_MASTER_TAB}'!${colLetter(patch.columnIndex)}${plan.rowNumber}`;
      updates.push({ range: a1, values: [[patch.after]] });
    }
  }
  if (updates.length) {
    await api(`${base}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
  }
  if (appendRows.length) {
    await api(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: appendRows }),
    });
  }
}

if (DUMP) {
  mkdirSync(dirname(resolve(DUMP)), { recursive: true });
  writeFileSync(resolve(DUMP), JSON.stringify({
    generated_at: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run',
    providers: providerSummaries, plates: dumpByPlate,
  }, null, 2) + '\n');
}

const totals = {
  providers: providerSummaries.length,
  patch_plates: allPlans.length,
  patch_cells: allPlans.reduce((n, p) => n + p.patches.length, 0),
  append: allPlans.filter((p) => p.kind === 'append').length,
  absent: allPlans.filter((p) => p.kind === 'absent').length,
  shrink_blocked: providerSummaries.filter((s) => s.shrink_blocked).length,
  manual_blocked: providerSummaries.filter((s) => s.manual_blocked).length,
  sheet_write: APPLY ? updates.length + appendRows.length : 0,
  snapshot: snapshotPath,
  dump: DUMP || null,
};
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', totals, providers: providerSummaries.map((s) => ({
  code: s.code, name: s.name,
  source: s.source_plates, master: s.master_plates,
  created: s.created, status: s.status_changed, rent: s.rent_changed,
  absent: s.absent, blocked: s.blocked, shrink: s.shrink_blocked, manual: s.manual_blocked,
})) }, null, 2));
