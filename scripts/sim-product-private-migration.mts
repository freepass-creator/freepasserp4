import { buildProductPrivateMigrationPlan } from '../lib/firebase/migrate-products-private';

type Rec = Record<string, unknown>;
type Rows = Record<string, Rec>;

const v3: Rows = {
  legacy_child: {
    product_code: 'P-001',
    provider_company_code: 'SUP-1',
    vehicle_price: 24000000,
    vin: 'OLDVIN1234567890',
    price: {
      '36': { rent: 410000, deposit: 0, fee: 41000, fee_memo: 'v3 memo' },
    },
  },
  public_only: {
    product_code: 'P-002',
    provider_company_code: 'SUP-2',
    price: { '36': { rent: 350000, deposit: 700000 } },
  },
};

const v4: Rows = {
  'P-001': {
    product_code: 'P-001',
    provider_company_code: 'SUP-1',
    vehicle_price: 25000000,
    price: {
      '36': { rent: 390000, deposit: 0, commission: 12000 },
    },
  },
};

const existingPrivate: Rows = {
  'P-001': {
    product_code: 'P-001',
    provider_company_code: 'SUP-1',
    vin: 'NEWVIN1234567890',
    price: { '36': { fee_memo: 'private wins' } },
  },
};

const plan = buildProductPrivateMigrationPlan(v3, v4, existingPrivate);
const migrated = plan.updates['v4/products_private/P-001'] as Rec;
const migratedTerms = (migrated.price as Record<string, Rec>)['36'];

const checks: [string, boolean][] = [
  ['상품 2대 검사', plan.scannedProducts === 2],
  ['민감 상품 1대', plan.productsWithPrivate === 1],
  ['private 1건 준비', plan.privateWrites === 1],
  ['v4 원가 우선', migrated.vehicle_price === 25000000],
  ['기존 private VIN 최우선', migrated.vin === 'NEWVIN1234567890'],
  ['기존 private 메모 최우선', migratedTerms.fee_memo === 'private wins'],
  ['v4 commission 보존', migratedTerms.commission === 12000],
  ['v3 fee 보존', migratedTerms.fee === 41000],
  ['v3 원가 삭제 계획', plan.updates['products/legacy_child/vehicle_price'] === null],
  ['v3 VIN 삭제 계획', plan.updates['products/legacy_child/vin'] === null],
  ['v3 fee 삭제 계획', plan.updates['products/legacy_child/price/36/fee'] === null],
  ['v4 원가 삭제 계획', plan.updates['v4/products/P-001/vehicle_price'] === null],
  ['v4 commission 삭제 계획', plan.updates['v4/products/P-001/price/36/commission'] === null],
  ['공개 전용 상품 미변경', !Object.keys(plan.updates).some((path) => path.includes('P-002'))],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (ok) passed++;
}
console.log(`\n━━ 결과: ${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
if (passed !== checks.length) process.exit(1);
