/**
 * 오더 B — 판매시트 ↔ ERP ↔ 상품마스터 3방향 정합 감사(읽기 전용).
 * 돈 칸이 1개라도 어긋나면 exit 1.
 *
 *   npx tsx scripts/audit-sales-sheet-vs-erp.mts
 *   npx tsx scripts/audit-sales-sheet-vs-erp.mts --out=tmp/sales-sheet-vs-erp.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fetchSalesInventorySheet } from '../lib/server/sales-inventory-sheet';
import { fetchProductMasterSheet } from '../lib/server/product-master-sheet';
import { sameMoneyCell, normalizePlate } from '../lib/domain/product-master-live-sync';
import { PRODUCT_MASTER_PERIODS } from '../lib/domain/product-master-sheet';
import type { EntityRecord } from '../lib/intake/entities';
import { liveProducts, mergeNodes, snapshot } from './lib/db-snapshot.mts';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const OUT = resolve(arg('out', 'tmp/sales-sheet-vs-erp.json'));

const snap = await snapshot({ refresh: process.argv.includes('--refresh') });
const partners = Object.values(mergeNodes(snap.partners, snap.v4Partners)) as EntityRecord[];
const erpProducts = liveProducts(snap) as EntityRecord[];

const [salesFetch, masterFetch] = await Promise.all([
  fetchSalesInventorySheet({ partners }),
  fetchProductMasterSheet({ partners }),
]);

const salesByPlate = new Map<string, EntityRecord>();
for (const p of salesFetch.products) {
  const plate = normalizePlate(p.car_number);
  if (plate) salesByPlate.set(plate, p);
}
const erpByPlate = new Map<string, EntityRecord>();
for (const p of erpProducts) {
  const plate = normalizePlate(p.car_number);
  if (plate) erpByPlate.set(plate, p);
}
const masterByPlate = new Map<string, EntityRecord>();
for (const p of masterFetch.products) {
  const plate = normalizePlate(p.car_number);
  if (plate) masterByPlate.set(plate, p);
}

const allPlates = new Set([...salesByPlate.keys(), ...erpByPlate.keys(), ...masterByPlate.keys()]);

type Diff = {
  car_number: string;
  provider: string;
  axes: string[];
  detail: Rec;
};

const diffs: Diff[] = [];
const setOnly = { sales: [] as string[], erp: [] as string[], master: [] as string[] };

function priceObj(p?: EntityRecord): Record<string, { rent?: number; deposit?: number }> {
  return (p?.price && typeof p.price === 'object') ? p.price as Rec : {};
}

function axisName(p?: EntityRecord) {
  return {
    model: S(p?.model),
    sub_model: S(p?.sub_model),
    trim: S(p?.trim_name || p?.trim),
  };
}

for (const plate of allPlates) {
  const sales = salesByPlate.get(plate);
  const erp = erpByPlate.get(plate);
  const master = masterByPlate.get(plate);
  const provider = S(sales?.provider_company_code || erp?.provider_company_code || master?.provider_company_code);
  if (sales && !erp) setOnly.sales.push(plate);
  if (erp && !sales) setOnly.erp.push(plate);
  if (master && !sales && !erp) setOnly.master.push(plate);

  if (!sales || !erp) continue; // 집합 차이는 아래 집계; 돈 대조는 교집합만
  const axes: string[] = [];
  const detail: Rec = {};

  const salesStatus = S(sales.vehicle_status || sales.status_label_raw);
  const erpStatus = S(erp.vehicle_status || erp.status_label_raw);
  if (salesStatus && erpStatus && salesStatus !== erpStatus) {
    axes.push('차량상태');
    detail.status = { sales: salesStatus, erp: erpStatus, master: S(master?.vehicle_status) };
  }

  const salesPolicy = S(sales.policy_code);
  const erpPolicy = S(erp.policy_code);
  if (salesPolicy && erpPolicy && salesPolicy !== erpPolicy) {
    axes.push('정책코드');
    detail.policy = { sales: salesPolicy, erp: erpPolicy, master: S(master?.policy_code) };
  }

  const sa = axisName(sales);
  const ea = axisName(erp);
  if ((sa.model || sa.sub_model || sa.trim) && (ea.model || ea.sub_model || ea.trim)) {
    if (sa.model !== ea.model || sa.sub_model !== ea.sub_model || sa.trim !== ea.trim) {
      axes.push('3축차명');
      detail.triple = { sales: sa, erp: ea, master: axisName(master) };
    }
  }

  const sp = priceObj(sales);
  const ep = priceObj(erp);
  const moneyDiffs: Rec[] = [];
  for (const months of PRODUCT_MASTER_PERIODS) {
    const sk = String(months);
    // 판매시트/ERP 키 변형(오토플러스 12_3만 등) — 같은 기간 원자 견주기
    const sTerm = sp[sk] || sp[`${months}_3만`] || sp[`${months}_2만`];
    const eTerm = ep[sk] || ep[`${months}_3만`] || ep[`${months}_2만`];
    if (!sTerm && !eTerm) continue;
    if (!sameMoneyCell(sTerm?.rent, eTerm?.rent) || !sameMoneyCell(sTerm?.deposit, eTerm?.deposit)) {
      moneyDiffs.push({ months, sales: sTerm || null, erp: eTerm || null });
    }
  }
  if (moneyDiffs.length) {
    axes.push('대여료보증금');
    detail.money = moneyDiffs;
  }

  if (axes.length) diffs.push({ car_number: plate, provider, axes, detail });
}

const byProvider: Rec = {};
for (const d of diffs) {
  const key = d.provider || '(unknown)';
  if (!byProvider[key]) byProvider[key] = { total: 0, money: 0, status: 0, policy: 0, triple: 0 };
  byProvider[key].total++;
  for (const a of d.axes) {
    if (a === '대여료보증금') byProvider[key].money++;
    if (a === '차량상태') byProvider[key].status++;
    if (a === '정책코드') byProvider[key].policy++;
    if (a === '3축차명') byProvider[key].triple++;
  }
}

const moneyDiffCount = diffs.filter((d) => d.axes.includes('대여료보증금')).length;
const report = {
  generated_at: new Date().toISOString(),
  counts: {
    sales: salesByPlate.size,
    erp: erpByPlate.size,
    master: masterByPlate.size,
    both_sales_erp: [...allPlates].filter((p) => salesByPlate.has(p) && erpByPlate.has(p)).length,
    sales_only: setOnly.sales.length,
    erp_only: setOnly.erp.length,
    master_only: setOnly.master.length,
    diff_plates: diffs.length,
    money_diff_plates: moneyDiffCount,
  },
  set_note: {
    sales_only: `우리 시트(판매) ${setOnly.sales.length} · 아닌 시트(ERP없음) ${setOnly.sales.length} · 총 ${salesByPlate.size}`,
    erp_only: `우리 시트(ERP) ${setOnly.erp.length} · 아닌 시트(판매없음) ${setOnly.erp.length} · 총 ${erpByPlate.size}`,
  },
  by_provider: byProvider,
  // 콘솔엔 집계만 — 차량번호는 파일에만
  plates: {
    sales_only: setOnly.sales,
    erp_only: setOnly.erp,
    master_only: setOnly.master,
    diffs,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

console.log(JSON.stringify({
  out: OUT,
  counts: report.counts,
  by_provider: byProvider,
  money_diff_plates: moneyDiffCount,
  exit: moneyDiffCount > 0 ? 1 : 0,
}, null, 2));

const { deleteApp, getApps } = await import('firebase-admin/app');
await Promise.all(getApps().map((app) => deleteApp(app)));

if (moneyDiffCount > 0) process.exit(1);
