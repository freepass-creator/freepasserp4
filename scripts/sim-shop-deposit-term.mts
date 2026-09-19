/** ERP4 MAIN 가격 3축은 반드시 같은 price[term] 행에서 판정한다. 외부 I/O 없음. */
import assert from 'node:assert/strict';
import { emptyQuery, priceForShopSelection, runShopQuery } from '../lib/shop/query';
import type { EntityRecord } from '../lib/intake/entities';

const product: EntityRecord = {
  _key: 'TEST_12가3456',
  product_code: 'TEST_12가3456',
  provider_company_code: 'TEST',
  car_number: '12가3456',
  vehicle_status: '출고가능',
  product_type: '중고렌트',
  maker: '기아',
  model: '테스트차',
  price: {
    '12': { rent: 500_000, deposit: 0 },
    '36': { rent: 400_000, deposit: 2_000_000 },
  },
};

const selected = (term: string, dep: string) => {
  const q = emptyQuery();
  q.sel.term = [term];
  q.sel.dep = [dep];
  return q;
};

const shortFreeQ = selected('12개월', 'd0');
const shortFree = runShopQuery([product], shortFreeQ);
assert.equal(shortFree.list.length, 1, '12개월 무보증은 12개월 가격행으로 통과해야 한다');

const shortPrice = priceForShopSelection(product, shortFreeQ.sel);
assert.equal(shortPrice?.m, 12);
assert.equal(shortPrice?.rent, 500_000);
assert.equal(shortPrice?.deposit, 0, '카드도 12개월 행의 월대여료·보증금을 표시해야 한다');

const impossible = runShopQuery([product], selected('12개월', 'd2'));
assert.equal(impossible.list.length, 0,
  '12개월 조건이 36개월 보증금 200만원을 끌어와 존재하지 않는 조합을 만들면 안 된다');

const longQ = selected('36개월', 'd2');
const long = runShopQuery([product], longQ);
assert.equal(long.list.length, 1, '36개월 + 200만원은 같은 36개월 가격행에서 통과해야 한다');

const longPrice = priceForShopSelection(product, longQ.sel);
assert.equal(longPrice?.m, 36);
assert.equal(longPrice?.rent, 400_000);
assert.equal(longPrice?.deposit, 2_000_000);

const other: EntityRecord = {
  ...product,
  _key: 'TEST_34나5678',
  product_code: 'TEST_34나5678',
  car_number: '34나5678',
  price: {
    '12': { rent: 450_000, deposit: 1_000_000 },
    '36': { rent: 300_000, deposit: 0 },
  },
};

/* 12개월 선택 중 보증금 낮은순은 36개월 deposit=0을 보지 않아야 한다. */
const depSort = emptyQuery();
depSort.sel.term = ['12개월'];
depSort.sort = 'dep';
const sorted = runShopQuery([product, other], depSort).list;
assert.equal(sorted[0]?.product_code, product.product_code,
  '12개월 보증금 낮은순은 12개월 deposit=0 차량이 먼저여야 한다');

/* facet 숫자도 같은 행 계약을 따라야 한다. */
const depFacet = shortFree.facets.dep;
assert.equal(depFacet.find((x) => x.key === 'd0')?.count, 1,
  '12개월 조건의 무보증 facet은 12개월 행만 세야 한다');
assert.equal(depFacet.find((x) => x.key === 'd2')?.count, 0,
  '12개월 조건의 facet에 36개월 보증금이 섞이면 안 된다');

/* 월 대여료도 기간과 같은 행이어야 한다. 12개월 50만원, 36개월 40만원을 섞지 않는다. */
const rentQ = emptyQuery();
rentQ.sel.term = ['12개월'];
rentQ.sel.rent = ['r50'];
assert.equal(runShopQuery([product], rentQ).list.length, 1, '12개월 월 50만원대는 통과해야 한다');

rentQ.sel.rent = ['r40'];
assert.equal(runShopQuery([product], rentQ).list.length, 0,
  '12개월 필터가 36개월 월 40만원대를 끌어오면 안 된다');

console.log('PASS ERP4 term/rent/deposit same-price-row contract');
