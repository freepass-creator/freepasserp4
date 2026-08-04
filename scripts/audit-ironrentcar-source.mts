/** 아이언렌트카 웹 공급사 소스 전수 read-only 점검. 운영 write 없음. */
import { fetchIronRentcarCatalog } from '../lib/server/ironrentcar-source';
import { ironRentcarExistingRows, planIronRentcarReconcile } from '../lib/domain/ironrentcar-reconcile';
import { readFileSync } from 'node:fs';
import type { EntityRecord } from '../lib/intake/entities';

const catalog = await fetchIronRentcarCatalog({ cacheMs: 0 });
const products = catalog.items.map((item) => item.product);
const missingPlate = products.filter((product) => !String(product.car_number || '')).length;
const missingPrice = products.filter((product) => !Object.keys((product.price || {}) as object).length).length;
const missingImage = products.filter((product) => !Array.isArray(product.image_urls) || !product.image_urls.length).length;
const duplicatePlates = products.length - new Set(products.map((product) => String(product.car_number || ''))).size;
const privateLeak = products.filter((product) => 'vehicle_price' in product).length;

console.log(`아이언 웹 read-only: 전체 ${catalog.listings} · 활성 ${catalog.active} · 판매완료 ${catalog.sold} · 신차 ${catalog.newCount} · 중고 ${catalog.usedCount}`);
console.log(`상세 변환: ${catalog.items.length}/${catalog.listings} · 오류 ${catalog.errors.length} · 차번누락 ${missingPlate} · 가격누락 ${missingPrice} · 사진누락 ${missingImage} · 중복차번 ${duplicatePlates} · 공개원가누수 ${privateLeak}`);
console.log(`revision=${catalog.revision} complete=${catalog.complete}`);
if (!catalog.complete || missingPlate || missingPrice || missingImage || duplicatePlates || privateLeak) {
  if (catalog.errors.length) console.error(catalog.errors.slice(0, 5));
  process.exit(1);
}

const arg = (name: string): string => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
};
const v3File = arg('--v3');
const v4File = arg('--v4');
if (v3File && v4File) {
  const v3 = JSON.parse(readFileSync(v3File, 'utf8')) as Record<string, EntityRecord> | null;
  const v4 = JSON.parse(readFileSync(v4File, 'utf8')) as Record<string, EntityRecord> | null;
  const merged = new Map<string, EntityRecord>();
  for (const [key, value] of Object.entries(v3 || {})) merged.set(key, { ...value, _key: key });
  for (const [key, value] of Object.entries(v4 || {})) merged.set(key, { ...(merged.get(key) || {}), ...value, _key: key });
  const plan = planIronRentcarReconcile({
    webItems: catalog.items,
    existing: [...merged.values()],
    sourceComplete: catalog.complete,
  });
  console.log(`ERP 대조: 일치 ${plan.matched} · patch후보 ${plan.patchCandidates.length} · 무변경 ${plan.unchanged} · 신규활성후보 ${plan.createCandidates.length} · 신규판매완료제외 ${plan.ignoredSoldNew} · 웹부재 ${plan.webAbsentErp} · 부재차단후보 ${plan.absentBlockCandidates.length} · 계약보호 ${plan.protectedErpOnly} · 중복차번그룹 ${plan.duplicatePlateGroups} · 실행작업 ${plan.executableOperations}`);

  type Terms = { rent?: number; deposit?: number };
  const priceOf = (row: EntityRecord): Record<string, Terms> =>
    row.price && typeof row.price === 'object' ? row.price as Record<string, Terms> : {};
  const plateOf = (row: EntityRecord): string => String(row.car_number || row.vehicle_number || '').replace(/\s/g, '');
  const existingByPlate = new Map<string, EntityRecord[]>();
  for (const row of ironRentcarExistingRows([...merged.values()])) {
    const plate = plateOf(row);
    if (plate) existingByPlate.set(plate, [...(existingByPlate.get(plate) || []), row]);
  }
  let exactVehicles = 0;
  let comparedCells = 0;
  let rentMatches = 0;
  let depositMatches = 0;
  let pairMatches = 0;
  let webOnlyPeriods = 0;
  let erpOnlyPeriods = 0;
  for (const item of catalog.items) {
    const group = existingByPlate.get(plateOf(item.product)) || [];
    if (group.length !== 1) continue;
    const webPrice = priceOf(item.product);
    const erpPrice = priceOf(group[0]);
    const webPeriods = Object.keys(webPrice).sort();
    const erpPeriods = Object.keys(erpPrice).sort();
    let exact = JSON.stringify(webPeriods) === JSON.stringify(erpPeriods);
    for (const period of webPeriods) {
      const current = erpPrice[period];
      if (!current) {
        webOnlyPeriods++;
        exact = false;
        continue;
      }
      comparedCells++;
      const sameRent = Number(webPrice[period]?.rent || 0) === Number(current.rent || 0);
      const sameDeposit = Number(webPrice[period]?.deposit || 0) === Number(current.deposit || 0);
      if (sameRent) rentMatches++;
      if (sameDeposit) depositMatches++;
      if (sameRent && sameDeposit) pairMatches++;
      else exact = false;
    }
    erpOnlyPeriods += erpPeriods.filter((period) => !webPrice[period]).length;
    if (exact) exactVehicles++;
  }
  console.log(`대여조건 대조(${plan.matched}대): 차량전체동일 ${exactVehicles} · 비교기간 ${comparedCells} · 월대여료동일 ${rentMatches} · 보증금동일 ${depositMatches} · 쌍동일 ${pairMatches} · 웹에만있는기간 ${webOnlyPeriods} · ERP에만있는기간 ${erpOnlyPeriods}`);
}
