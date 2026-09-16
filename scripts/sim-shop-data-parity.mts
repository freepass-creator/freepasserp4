/**
 * 공개 화이트라벨의 웹·모바일 데이터 경로 회귀 방지.
 *
 * 두 화면은 같은 ShopView와 `/api/catalog/feed`를 쓰며, 이 API는 ERP5 Firestore
 * 검증 발행본만 읽는다. 다른 원장 fallback은 상태를 갈라 놓으므로 막는다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const feed = source('app/api/catalog/feed/route.ts');
// ★2026-09-16: feed 가 ERP5 판독기를 «직접» 부르지 않게 됐다(#330 이 60초 캐싱 껍데기
//   lib/server/guest-listing.ts 를 사이에 끼웠다). 경로가 바뀐 것이 아니라 한 겹 늘었을 뿐이라
//   — guest-listing 이 같은 인자(includePartners/includeUsers)로 그대로 넘긴다 —
//   「직접 호출」만 보던 옛 식이 못 맞아 CI 가 빨갰다.
//   느슨하게 풀지 않고 «그 겹까지 따라가서» 조인다. 이 검사의 목적은 다른 원장 fallback 을
//   막는 것이지 호출이 몇 겹인지 세는 것이 아니다.
const listing = source('lib/server/guest-listing.ts');
const erp5 = source('lib/server/erp5-firestore-app.ts');
const reader = source('lib/server/whitelabel-erp5-catalog.ts');
const shop = source('app/(shop)/shop/ShopView.tsx');

assert.match(erp5, /ERP5_FIREBASE_PROJECT_ID = 'freepasserp5'/);
assert.match(erp5, /ERP5_WHITELABEL_FIRESTORE_ENABLED/);
// 캐시 키와 Firestore 컬렉션 이름이 다르다 — collection(<캐시키>, <컬렉션이름>).
// ★2026-09-16: 1인자만 찾던 옛 식이 2인자 도입 뒤 못 맞아 CI 가 빨갰다.
//   느슨하게 풀지 않고 «실제 컬렉션 이름이 두 번째 인자에 있는가» 로 조인다 —
//   이 검사의 목적은 다른 원장 fallback 을 막는 것이지 인자 개수를 세는 것이 아니다.
assert.match(reader, /collection\('products', *'products'\)/);
assert.match(reader, /collection\('policies', *'policy'\)/);
assert.match(reader, /ERP5 화이트라벨 전환 요청이 OFF/);
assert.doesNotMatch(reader, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);

assert.match(listing, /readWhitelabelCatalogFromErp5/);
assert.match(feed, /loadGuestListing/);
assert.match(listing, /includePartners: !!providerCode/);
assert.match(listing, /includeUsers: !!share/);
assert.doesNotMatch(feed, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);
assert.doesNotMatch(listing, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);
assert.match(feed, /Cache-Control': 'no-store'/);
assert.match(source('lib/server/guest-quote.ts'), /readWhitelabelCatalogFromErp5/);
assert.match(source('lib/server/guest-quote.ts'), /includeUsers: true/);
assert.doesNotMatch(source('lib/server/guest-quote.ts'), /firebaseAdminApp|firestore-ref-shim|\.ref\(/);

assert.match(shop, /fetch\(`\/api\/catalog\/feed\?\$\{p\}`/);
assert.match(shop, /window\.setInterval\([\s\S]*45_000/);
assert.match(shop, /requestId !== feedRequestRef\.current/);
assert.match(shop, /hasFeedRowsRef\.current/);

console.log('PASS shop web/mobile shared Firestore feed and refresh contract');
