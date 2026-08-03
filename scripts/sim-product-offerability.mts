/**
 * 상품찾기·손님 카탈로그 판매가능 표시 회귀검사.
 * 실행: npx tsx scripts/sim-product-offerability.mts
 */
import { readFileSync } from 'node:fs';
import type { EntityRecord } from '../lib/intake/entities';
import {
  isOfferableProduct,
  priceList,
} from '../lib/domain/product';
import {
  aggregateDyn,
  EMPTY_VEHICLE_FILTER,
  matchProduct,
  presentFilterOptions,
  type FState,
} from '../lib/domain/product-filters';
import { checkInventory } from '../lib/domain/data-check';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}`, detail ?? '');
}

const product = (patch: Partial<EntityRecord> = {}): EntityRecord => ({
  product_code: 'P-VALID',
  car_number: '12가3456',
  maker: '현대',
  model: '그랜저',
  vehicle_status: '출고가능',
  product_type: '중고렌트',
  provider_name: '정상공급사',
  price: { '36': { rent: 550_000, deposit: 1_000_000 } },
  ...patch,
});

const valid = product();
const noPrice = product({ product_code: 'P-NONE', provider_name: '무가격공급사', price: {} });
const zeroPrice = product({ product_code: 'P-ZERO', price: { '36': { rent: 0, deposit: 0 } } });
const lowOutlier = product({ product_code: 'P-LOW', price: { '36': { rent: 99_999, deposit: 0 } } });
const highOutlier = product({ product_code: 'P-HIGH', price: { '36': { rent: 20_000_001, deposit: 0 } } });
const unavailable = product({ product_code: 'P-OFF', vehicle_status: ' 출고 불가 ' });
const deleted = product({ product_code: 'P-DELETED', _deleted: true });
const contracted = product({ product_code: 'P-CONTRACT', vehicle_status: '계약중' });

check('유효 대여료 상품은 판매목록 대상', isOfferableProduct(valid));
check('가격맵 없음은 판매목록 제외', !isOfferableProduct(noPrice));
check('0원만 있으면 판매목록 제외', !isOfferableProduct(zeroPrice));
check('하한 미만 대여료는 판매목록 제외', priceList(lowOutlier).length === 0 && !isOfferableProduct(lowOutlier));
check('상한 초과 대여료는 판매목록 제외', priceList(highOutlier).length === 0 && !isOfferableProduct(highOutlier));
check('공백 포함 출고불가는 판매목록 제외', !isOfferableProduct(unavailable));
check('삭제 상품은 판매목록 제외', !isOfferableProduct(deleted));
check('계약중이지만 가격이 유효하면 기존대로 노출', isOfferableProduct(contracted));
const noPriceHits = checkInventory([valid, noPrice, zeroPrice, lowOutlier, highOutlier])
  .find((group) => group.key === 'no_price')?.hits || [];
check(
  '데이터점검도 빈맵·0원·이상치 가격을 모두 정정 대상으로 표시',
  noPriceHits.length === 4 && !noPriceHits.some((hit) => hit.code === valid.product_code),
  noPriceHits.map((hit) => hit.code),
);

const emptyState: FState = {
  q: '',
  periods: new Set(),
  rent: new Set(),
  dep: new Set(),
  mile: new Set(),
  fuel: new Set(),
  ptype: new Set(),
  credit: new Set(),
  perks: new Set(),
  promo: new Set(),
  dyn: {},
  vehicle: { ...EMPTY_VEHICLE_FILTER },
};
check('필터 미선택이어도 무가격 상품은 matchProduct에서 제외', !matchProduct(noPrice, emptyState));
check('필터 미선택 유효 상품은 matchProduct 통과', matchProduct(valid, emptyState));

const options = presentFilterOptions([valid, noPrice]);
check(
  '필터 옵션 집계도 판매가능 상품만 계산',
  options.months.length === 1 && options.months[0]?.count === 1,
  options.months,
);
const dynamic = aggregateDyn([valid, noPrice]);
check(
  '동적 옵션 집계에서 무가격 공급사 제외',
  !(dynamic.provider || []).some(([name]) => name === '무가격공급사'),
  dynamic.provider,
);

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const catalogSource = source('app/catalog/page.tsx');
check(
  '공개 카탈로그는 로드와 캐시 첫 페인트 모두 SSOT 적용',
  (catalogSource.match(/isOfferableProduct/g) || []).length >= 3,
);
check('공개 견적 직접 URL도 판매조건 확인', source('app/q/[code]/page.tsx').includes('!isOfferableProduct(p)'));
const detailSource = source('app/m/[code]/page.tsx');
check(
  '내부 상세 우회 진입·최근목록 저장도 판매조건 확인',
  detailSource.includes('!isOfferableProduct(p)')
    && detailSource.includes('p && isOfferableProduct(p)'),
);
check('최근·관심 우회 링크도 판매조건 확인', source('components/InterestRail.tsx').includes('isOfferableProduct(live)'));
check(
  '관리자 정정 화면은 판매 필터를 적용하지 않음',
  !source('app/inventory/page.tsx').includes('isOfferableProduct')
    && !source('app/data-check/page.tsx').includes('isOfferableProduct'),
);

console.log(`\nproduct offerability: ${passed}/${passed + failed} PASS`);
if (failed) process.exitCode = 1;
