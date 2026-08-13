/**
 * 상품찾기·손님 카탈로그 판매가능 표시 회귀검사.
 * 실행: npx tsx scripts/sim-product-offerability.mts
 */
import { readFileSync } from 'node:fs';
import type { EntityRecord } from '../lib/intake/entities';
import {
  isListableProduct,
  isOfferableProduct,
  isStockedProduct,
  priceList,
} from '../lib/domain/product';
import {
  aggregateDyn,
  EMPTY_VEHICLE_FILTER,
  matchProduct,
  presentFilterOptions,
  presentFilterOptionsFaceted,
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
check('필터 미선택이어도 무가격 상품은 목록에 뜬다', matchProduct(noPrice, emptyState));
check('필터 미선택 유효 상품은 matchProduct 통과', matchProduct(valid, emptyState));
check('출고불가는 matchProduct에서 제외', !matchProduct(unavailable, emptyState));

const options = presentFilterOptions([valid, noPrice]);
check(
  '필터 옵션 집계는 목록 대상(출고불가 제외) 기준 — 무가격도 포함되나 개월 칸은 가격 있는 쪽만',
  options.months.length === 1 && options.months[0]?.count === 1,
  options.months,
);
const dynamic = aggregateDyn([valid, noPrice]);
check(
  '동적 옵션 집계에 무가격 공급사도 포함',
  (dynamic.provider || []).some(([name]) => name === '무가격공급사'),
  dynamic.provider,
);

{
  const hyundai = product({ product_code: 'P-H', maker: '현대', model: '쏘나타', fuel_type: '가솔린', provider_name: '현대만', price: { '36': { rent: 400_000, deposit: 0 } } });
  const kia = product({ product_code: 'P-K', maker: '기아', model: 'K5', fuel_type: '디젤', provider_name: '기아만', price: { '12': { rent: 350_000, deposit: 0 }, '36': { rent: 390_000, deposit: 0 } } });
  const withMaker: FState = { ...emptyState, vehicle: { ...EMPTY_VEHICLE_FILTER, maker: ['현대'] } };
  const faceted = presentFilterOptionsFaceted([hyundai, kia], withMaker, new Set());
  check('제조사 현대 선택 시 기간 칩은 현대 매물 개월만', faceted.months.map((m) => m.key).join(',') === '36', faceted.months);
  check('제조사 현대 선택 시 연료 칩은 현대 매물만', faceted.fuel.map((f) => f.key).join(',') === '가솔린', faceted.fuel);
  const kiaFuelStill = presentFilterOptionsFaceted([hyundai, kia], emptyState, new Set()).fuel.some((f) => f.key === '디젤');
  check('제조사 미선택이면 기아 디젤 칩도 보임', kiaFuelStill);
}

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
// 판정은 셋으로 갈린다(2026-08-12):
//   공개 목록(카탈로그·관심) = isListableProduct — 유효 대여료 필요
//   내부 목록(상품찾기)       = isStockedProduct — 가격 전이라도 공급사 재고면 표시
//   견적(공유링크 /q)         = isOfferableProduct — 유효 대여료 필요
const catalogSource = source('app/catalog/page.tsx');
check(
  '공개 카탈로그는 서버와 화면 양쪽에서 판매목록 SSOT 적용',
  catalogSource.includes('isListableProduct')
    && source('app/api/catalog/feed/route.ts').includes('isListableProduct(merged)'),
);
check('공개 견적 직접 URL도 서버에서 판매조건 확인', source('app/api/catalog/quote/route.ts').includes('!isOfferableProduct(merged)'));
const detailSource = source('app/m/[code]/page.tsx');
check(
  '내부 상세는 재고조건으로 진입하고 견적 동작은 판매조건으로 제한',
  detailSource.includes('!p || !isStockedProduct(p)')
    && detailSource.includes('const offerable = isOfferableProduct(p)'),
);
check('내부 최근·관심도 상품찾기와 같은 재고조건 확인', source('components/InterestRail.tsx').includes('isStockedProduct(live)'));
check(
  '관리자 정정 화면은 판매 필터를 적용하지 않음',
  !source('app/inventory/page.tsx').includes('ableProduct')
    && !source('app/data-check/page.tsx').includes('ableProduct'),
);
// ★손님 공유 경로에 내부 재고 판정을 쓰면 가격 없는 차량 견적이 열릴 수 있다 — 회귀 방지.
check(
  '공유링크는 내부 재고 판정을 쓰지 않고 상세만 내부 재고 판정을 쓴다',
  !source('app/q/[code]/page.tsx').includes('isStockedProduct')
    && detailSource.includes('isStockedProduct'),
);
check(
  '손님 견적서에 차량번호가 실린다',
  source('lib/domain/product.ts').includes("['차량번호', pv('car_number')]"),
);
// ★목록 = 재고 − 출고불가(2026-08-07). 차번·대여료·차종 검수대기는 목록에서 빼지 않는다.
check(
  '차종 검수대기여도 목록에 뜬다',
  isListableProduct({ car_number: '12가3456', vehicle_status: '출고가능', _needs_master_review: true, price: { 36: { rent: 500000 } } } as unknown as EntityRecord),
);
check(
  '차번이 없어도 출고불가가 아니면 목록에 뜬다',
  isListableProduct({ car_number: '', vehicle_status: '출고가능', price: { 36: { rent: 500000 } } } as unknown as EntityRecord),
);
check('대여료가 없으면 공개 목록에서는 제외', !isListableProduct(noPrice));
check('대여료가 없어도 공급사 재고면 상품찾기에는 표시', isStockedProduct(noPrice));
check(
  '번호미정 신차도 목록에 뜬다',
  isListableProduct({ car_number: '100신0001', is_pending_plate: true, vehicle_status: '출고가능', price: { 36: { rent: 500000 } } } as unknown as EntityRecord),
);
check('출고불가는 목록에서 뺀다', !isListableProduct(unavailable));
check('삭제는 목록에서 뺀다', !isListableProduct(deleted));

console.log(`\nproduct offerability: ${passed}/${passed + failed} PASS`);
if (failed) process.exitCode = 1;
