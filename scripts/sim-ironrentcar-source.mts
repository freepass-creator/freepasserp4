import { parseIronRentcarDetail, parseIronRentcarListingPage } from '../lib/server/ironrentcar-source';

let pass = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`${name}: expected=${String(expected)} actual=${String(actual)}`);
  pass++;
}

const listingHtml = `<!doctype html><html><main>
  <article class="rental-product-card rental-product-card--sold"><a href="/vehicles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?condition=new"></a></article>
  <article class="rental-product-card"><a href="/vehicles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb?condition=new"></a></article>
  <a href="/vehicles?condition=new&page=2">더보기</a>
</main></html>`;
const listing = parseIronRentcarListingPage(listingHtml, 'https://ironrentcar.com/vehicles?condition=new', 'new');
check('목록 두 건', listing.listings.length, 2);
check('판매완료 클래스 판정', listing.listings[0].sold, true);
check('활성 판정', listing.listings[1].sold, false);
check('누적 다음 페이지', listing.nextUrl, 'https://ironrentcar.com/vehicles?condition=new&page=2');

const detailHtml = `<!doctype html><html><main>
  <div class="product-detail-gallery"><img src="/_next/image?url=https%3A%2F%2Fcdn.example.test%2Fcar%2F01.jpeg&w=3840&q=75"><img src="/_next/image?url=https%3A%2F%2Fcdn.example.test%2Fcar%2F02.jpeg&w=3840&q=75"></div>
  <div class="product-detail-badges"><span class="badge-pill">신차</span><span class="badge-pill">즉시출고</span></div>
  <h1 class="product-detail-title">현대 그랜저 프리미엄</h1><p class="product-detail-subtitle">2.5가솔린 2WD · 26년식</p>
  <div class="product-detail-rent-mileage-note">연 3만km 기준</div>
  <dl><div class="product-detail-rent-row"><dt>36개월</dt><dd>월 108만원</dd></div><div class="product-detail-rent-row"><dt>48개월</dt><dd>월 98만원</dd></div></dl>
  <div class="product-detail-price-block--deposit">보증금 140만원 2회분납가능</div><div class="product-detail-price-block--vehicle">차량가 4,560만원</div>
  <dl><dt>차량번호</dt><dd>151호2230</dd><dt>유종</dt><dd>가솔린</dd><dt>외장 색상</dt><dd>어비스블랙펄</dd><dt>내장 색상</dt><dd>블랙</dd><dt>운전자 연령</dt><dd>만 21세 이상</dd><dt>대인 보상</dt><dd>무한</dd><dt>대물 보상</dt><dd>1억</dd><dt>긴급출동</dt><dd>연 5회</dd></dl>
  <span class="vehicle-option-chip">현대스마트센스1</span><span class="vehicle-option-chip">파킹어시스트</span>
</main></html>`;
const detail = parseIronRentcarDetail(detailHtml, listing.listings[1]);
check('공급사 고정', detail.product.provider_company_code, 'RP006');
check('키는 공급사+차번', detail.product.product_code, 'RP006_151호2230');
check('신차 타입', detail.product.product_type, '신차렌트');
check('연식 변환', detail.product.year, '2026');
check('36개월 만원 변환', (detail.product.price as Record<string, { rent: number }>)['36'].rent, 1_080_000);
check('보증금 변환', (detail.product.price as Record<string, { deposit: number }>)['48'].deposit, 1_400_000);
check('사진 원본 URL 복원', (detail.product.image_urls as string[])[0], 'https://cdn.example.test/car/01.jpeg');
check('사진 중복 없이 두 장', (detail.product.image_urls as string[]).length, 2);
check('옵션 결합', detail.product.options, '현대스마트센스1, 파킹어시스트');
check('차량가 공개상품 제외', 'vehicle_price' in detail.product, false);
check('차량가 private 분리', detail.privateProduct.vehicle_price, 45_600_000);
check('보험 정책 분리', detail.policySnapshot.injury_compensation_limit, '무한');
check('지문 존재', typeof detail.fingerprint, 'string');

console.log(`ironrentcar source: ${pass}/${pass} PASS`);
