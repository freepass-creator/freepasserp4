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
const erp5 = source('lib/server/erp5-firestore-app.ts');
const reader = source('lib/server/whitelabel-erp5-catalog.ts');
const shop = source('app/(shop)/shop/ShopView.tsx');

assert.match(erp5, /ERP5_FIREBASE_PROJECT_ID = 'freepasserp5'/);
assert.match(erp5, /ERP5_WHITELABEL_FIRESTORE_ENABLED/);
/*
 * ⚠ 2026-09-16 PR #329(「읽은 것을 60초 쥔다」)가 `collection(<캐시 열쇠>, <컬렉션 이름>)` 두 인자로
 *   바꿨는데 이 기대값을 같이 안 고쳐, **머지된 순간부터 main 이 빨간불**이었다(하루 동안 모든 PR 이 막혔다).
 * ★고치되 «무엇을 읽는지»는 그대로 못 박는다 — 이 검사의 목적은 호출 모양이 아니라
 *   **손님 화면이 ERP5 의 products·policy 컬렉션을 읽는가**이다. 느슨하게 풀면 원장이 갈려도 안 잡힌다.
 */
assert.match(reader, /collection\('products',\s*'products'\)/);
assert.match(reader, /collection\('policies',\s*'policy'\)/);
assert.match(reader, /ERP5 화이트라벨 전환 요청이 OFF/);
assert.doesNotMatch(reader, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);

/*
 * ⚠ 2026-09-16 PR #330(「필터를 «서버»가 같이 내려준다」)이 목록 읽기를 `lib/server/guest-listing.ts`
 *   한 겹 아래로 내렸다. 이 검사는 옛 파일만 보고 있어 **머지된 순간부터 main 이 빨간불**이었다.
 * ★따라 내려가되 «무엇을 지키는지»는 그대로다 — 목록 문은 **한 문(`loadGuestListing`)으로만** 읽고,
 *   그 문이 **ERP5 검증 발행본**을 읽으며, 어느 쪽도 다른 원장(RTDB·심)을 직접 안 본다.
 */
assert.match(feed, /loadGuestListing/);
assert.doesNotMatch(feed, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);

const listing = source('lib/server/guest-listing.ts');
// The approved consumer facade is a boundary, not an authority change.
const boundary = source('lib/server/freepass-catalog.ts');
assert.match(listing, /const src = await readFreepassCatalog\(/);
assert.match(listing, /from ['"]@\/lib\/server\/freepass-catalog['"]/);
assert.match(boundary, /return readWhitelabelCatalogFromErp5\(options\)/);
assert.doesNotMatch(boundary, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);
assert.match(listing, /includePartners: !!providerCode/);
assert.match(listing, /includeUsers: !!share/);
assert.doesNotMatch(listing, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);
assert.match(feed, /Cache-Control': 'no-store'/);
const guestQuote = source('lib/server/guest-quote.ts');
assert.match(guestQuote, /from ['"]@\/lib\/server\/freepass-catalog['"]/);
assert.match(guestQuote, /const readGuestCatalog = cache\(readFreepassCatalog\)/);
assert.match(guestQuote, /readGuestCatalog\(\{ includeUsers: true \}\)/);
assert.doesNotMatch(guestQuote, /readWhitelabelCatalogFromErp5|firebaseAdminApp|firestore-ref-shim|\.ref\(/);

assert.match(shop, /fetch\(`\/api\/catalog\/feed\?\$\{p\}`/);
assert.match(shop, /window\.setInterval\([\s\S]*45_000/);
assert.match(shop, /requestId !== feedRequestRef\.current/);
assert.match(shop, /hasFeedRowsRef\.current/);

console.log('PASS shop web/mobile shared Firestore feed and refresh contract');
