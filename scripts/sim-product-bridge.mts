import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  collectProductBridgeReferences,
  projectLegacyProductForActor,
  selectLegacyProductsForBridge,
} from '../lib/domain/product-bridge';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`PASS ${passed.toString().padStart(2, '0')} · ${name}`);
};

const source = {
  product_code: 'P-001',
  provider_company_code: 'RP004',
  maker: '현대',
  vehicle_price: 31_000_000,
  vin: 'VIN-SECRET',
  account_number: '123-456',
  price: {
    36: { rent: 700_000, deposit: 2_000_000, fee: 0.1, commission: 200_000, fee_memo: '내부' },
  },
};

check('영업자에게 차량 원가·VIN·계좌가 없다', () => {
  const row = projectLegacyProductForActor(source, { role: 'agent', companyCode: 'SP001' });
  assert.equal(row.vehicle_price, undefined);
  assert.equal(row.vin, undefined);
  assert.equal(row.account_number, undefined);
});

check('영업자에게 공개 대여료·보증금은 유지된다', () => {
  const row = projectLegacyProductForActor(source, { role: 'agent', companyCode: 'SP001' });
  assert.deepEqual(row.price, { 36: { rent: 700_000, deposit: 2_000_000 } });
});

check('영업자에게 기간별 내부 수수료 원자가 없다', () => {
  const row = projectLegacyProductForActor(source, { role: 'agent', companyCode: 'SP001' });
  const terms = (row.price as Record<string, Record<string, unknown>>)['36'];
  assert.equal(terms.fee, undefined);
  assert.equal(terms.commission, undefined);
  assert.equal(terms.fee_memo, undefined);
});

check('공급사는 자기 회사 v3 원가를 볼 수 있다', () => {
  const row = projectLegacyProductForActor(source, { role: 'provider', companyCode: 'RP004' });
  assert.equal(row.vehicle_price, 31_000_000);
  assert.equal(row.vin, 'VIN-SECRET');
});

check('공급사는 타 회사 v3 원가를 볼 수 없다', () => {
  const row = projectLegacyProductForActor(source, { role: 'provider', companyCode: 'RP023' });
  assert.equal(row.vehicle_price, undefined);
  assert.equal(row.vin, undefined);
});

check('회사코드가 빈 공급사 세션은 fail-closed다', () => {
  const row = projectLegacyProductForActor(source, { role: 'provider', companyCode: '' });
  assert.equal(row.vehicle_price, undefined);
});

check('관리자는 운영 점검을 위해 원문을 유지한다', () => {
  const row = projectLegacyProductForActor(source, { role: 'admin', companyCode: '' });
  assert.equal(row.vehicle_price, 31_000_000);
  assert.equal(row.account_number, '123-456');
});

check('활성 재고는 참조가 없어도 서버 응답에 유지된다', () => {
  const selected = selectLegacyProductsForBridge({ active: source }, { productKeys: new Set(), plates: new Set() });
  assert.equal(selected.active?.product_code, 'P-001');
});

check('참조 없는 삭제 이력은 대량 응답에서 제외된다', () => {
  const deleted = { ...source, status: 'deleted' };
  const selected = selectLegacyProductsForBridge({ deleted }, { productKeys: new Set(), plates: new Set() });
  assert.deepEqual(selected, {});
});

check('계약이 상품키로 참조하는 삭제 이력은 차량명 복원용으로 유지된다', () => {
  const refs = collectProductBridgeReferences([{ C1: { product_code: 'P-001' } }]);
  const selected = selectLegacyProductsForBridge({ legacy: { ...source, status: 'deleted' } }, refs);
  assert.equal(selected.legacy?.product_code, 'P-001');
});

check('문의가 차번으로만 참조하는 삭제 이력도 유지된다', () => {
  const refs = collectProductBridgeReferences([{ R1: { car_number: '12가 3456' } }]);
  const selected = selectLegacyProductsForBridge({ legacy: { ...source, status: 'deleted', car_number: '12가3456' } }, refs);
  assert.equal(selected.legacy?.car_number, '12가3456');
});

const route = fs.readFileSync('app/api/products/bridge/route.ts', 'utf8');
const auth = fs.readFileSync('lib/server/firebase-admin.ts', 'utf8');
const adapter = fs.readFileSync('lib/firebase/rtdb-adapter.ts', 'utf8');

check('서버 경로는 활성 계정 verifier를 통과해야 한다', () => {
  assert.match(route, /verifyActiveBearer\(request\)/);
  assert.match(auth, /sign_in_provider === 'anonymous'/);
  assert.match(auth, /pending.*deleted.*rejected/);
});

check('응답은 인증별 비저장이고 조용히 자르지 않는다', () => {
  assert.match(route, /private, no-store/);
  assert.match(route, /Vary: 'Authorization'/);
  assert.match(route, /sourceCount > MAX_SOURCE_PRODUCTS/);
  assert.match(route, /count > MAX_RESPONSE_PRODUCTS/);
  assert.match(route, /selectLegacyProductsForBridge/);
});

check('클라이언트는 Bearer 서버 브리지를 먼저 사용한다', () => {
  assert.match(adapter, /fetch\('\/api\/products\/bridge'/);
  assert.match(adapter, /Authorization: `Bearer \$\{token\}`/);
  assert.match(adapter, /cache: 'no-store'/);
});

check('현재 Rules 호환 fallback은 read-only이며 v3 write가 없다', () => {
  const method = adapter.slice(adapter.indexOf('private async readLegacyProducts'), adapter.indexOf('private async readNode'));
  assert.match(method, /this\.readNode\('product', co, false/);
  assert.doesNotMatch(method, /dbUpdate|runTransaction|\.set\(/);
});

check('관리자 strict 원문은 축약 API보다 직접 read를 우선한다', () => {
  const method = adapter.slice(adapter.indexOf('private async readLegacyProducts'), adapter.indexOf('private async readNode'));
  assert.match(method, /getSession\(\)\?\.role === 'admin'/);
  assert.ok(method.indexOf("this.readNode('product', co, false") < method.indexOf("fetch('/api/products/bridge'"));
});

console.log(`\n상품 서버 브리지 적대검증 ${passed}/${passed} PASS`);
