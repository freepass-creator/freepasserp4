/** 현재 상품의 순수전기차만 EV 계보·배터리·구동·인승·트림 기준으로 감사한다. */
import { readFileSync, writeFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const coverage = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8')) as Rec;
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as Rec;
const review = JSON.parse(readFileSync('tmp/hyundai-three-model-review.json', 'utf8')) as Rec;
const byMasterKey = new Map((artifact.records || []).map((row: Rec) => [S(row.trim_row_key), row]));
const hi = (name: string) => review.headers.indexOf(name);
const reviewByKey = new Map<string, Rec>();
for (const row of review.rows || []) for (const key of S(row[hi('기존 트림행키')]).split('|').filter(Boolean)) reviewByKey.set(key, row);
const electric = (row: Rec) => {
  const master = byMasterKey.get(S(row.current_code)) as Rec | undefined;
  const fuel = S(row.audit_axes?.fuel || master?.fuel).toLowerCase();
  return fuel === '전기' || fuel === 'ev';
};
const products = (coverage.rows || []).filter(electric).map((product: Rec) => {
  const master = byMasterKey.get(S(product.current_code)) as Rec | undefined;
  const normalized = reviewByKey.get(S(product.current_code)) as any[] | undefined;
  const maker = normalized ? S(normalized[hi('제조사')]) : S(product.snap_maker);
  const issues: string[] = [];
  if (!master) issues.push('차종마스터 미확정');
  if (master && S(master.fuel) !== '전기') issues.push('연료축 불일치');
  const battery = normalized?.[hi('배터리kWh')] ?? master?.battery_kwh;
  if (!battery && maker !== '테슬라') issues.push('배터리 공식값 누락');
  const drive = S(normalized?.[hi('구동')]);
  if (!drive || drive === '미확인' || drive === '2WD') issues.push('FWD/RWD/AWD 미확정');
  const seats = Number(normalized?.[hi('인승')] || master?.seats);
  if (!seats) issues.push('인승 누락');
  const subModel = S(normalized?.[hi('세부모델')] || master?.sub_model || product.snap_sub_model);
  if (!subModel) issues.push('EV 계보 누락');
  return {
    row: product.row, category: product.category, maker, model: S(normalized?.[hi('모델')] || master?.model || product.snap_model),
    sub_model: subModel, trim: S(normalized?.[hi('세부트림')] || master?.trim || product.audit_axes?.trim),
    battery_kwh: battery || (maker === '테슬라' ? '공식비공개' : ''), drivetrain: drive,
    seats: seats || '', production_start: S(normalized?.[hi('생산시작')] || master?.production_start),
    production_end: S(normalized?.[hi('생산종료')] || master?.production_end), current_code: S(product.current_code), issues,
  };
});
const status = {
  total_products: products.length,
  master_confirmed: products.filter((row: Rec) => row.current_code && !row.issues.includes('차종마스터 미확정')).length,
  unresolved: products.filter((row: Rec) => row.issues.length).length,
  issue_counts: Object.fromEntries([...new Set(products.flatMap((row: Rec) => row.issues))].sort()
    .map((issue) => [issue, products.filter((row: Rec) => row.issues.includes(issue)).length])),
};
writeFileSync('tmp/current-product-ev-identity-audit.json', `${JSON.stringify({ generated_at: new Date().toISOString(), status, products }, null, 2)}\n`);
console.log(JSON.stringify(status, null, 2));
