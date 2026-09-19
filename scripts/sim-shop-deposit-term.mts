/** 화이트라벨 기간·대여료·보증금은 같은 price[term] 행에서 판정해야 한다. 외부 I/O 없음. */
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

const query = (term: string, dep: string) => {
  const q = emptyQuery();
  q.sel.term = [term];
  q.sel.dep = [dep];
  return q;
};

const shortQuery = query('12개월', 'd0');
const shortFree = runShopQuery([product], shortQuery);
assert.equal(shortFree.list.length, 1, '12개월 무보증은 12개월 가격행으로 통과해야 한다');
const shortPrice = priceForShopSelection(product, shortQuery.sel);
assert.equal(shortPrice?.m, 12);
assert.equal(shortPrice?.rent, 500_000);
assert.equal(shortPrice?.deposit, 0, '카드 대표가격도 12개월 가격행의 월대여료·보증금을 써야 한다');

const shortWrongLongDeposit = runShopQuery([product], query('12개월', 'd2'));
assert.equal(shortWrongLongDeposit.list.length, 0,
  '12개월 필터가 36개월 장기보증 200만원을 끌어와 통과시키면 안 된다');

const longQuery = query('36개월', 'd2');
const longDeposit = runShopQuery([product], longQuery);
assert.equal(longDeposit.list.length, 1, '36개월 보증금 200만원은 같은 36개월 가격행으로 통과해야 한다');
const longPrice = priceForShopSelection(product, longQuery.sel);
assert.equal(longPrice?.m, 36);
assert.equal(longPrice?.rent, 400_000);
assert.equal(longPrice?.deposit, 2_000_000, '카드 대표가격도 36개월 가격행의 월대여료·보증금을 써야 한다');

const depFacetOn12 = shortFree.facets.dep;
assert.equal(depFacetOn12.find((x) => x.key === 'd0')?.count, 1,
  '12개월 조건의 보증금 facet도 12개월 가격행을 세야 한다');
assert.equal(depFacetOn12.find((x) => x.key === 'd2')?.count, 0,
  '12개월 조건의 facet에서 36개월 보증금이 섞이면 안 된다');

console.log('PASS shop term/rent/deposit same-price-row contract');
