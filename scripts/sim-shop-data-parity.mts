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
assert.match(reader, /collection\('products'\)/);
assert.match(reader, /collection\('policy'\)/);
assert.match(reader, /ERP5 화이트라벨 전환 요청이 OFF/);
assert.doesNotMatch(reader, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);

assert.match(feed, /readWhitelabelCatalogFromErp5/);
assert.match(feed, /includePartners: !!providerCode/);
assert.match(feed, /includeUsers: !!share/);
assert.doesNotMatch(feed, /firebaseAdminApp|firestore-ref-shim|\.ref\(/);
assert.match(feed, /Cache-Control': 'no-store'/);
assert.match(source('lib/server/guest-quote.ts'), /readWhitelabelCatalogFromErp5/);
assert.match(source('lib/server/guest-quote.ts'), /includeUsers: true/);
assert.doesNotMatch(source('lib/server/guest-quote.ts'), /firebaseAdminApp|firestore-ref-shim|\.ref\(/);

assert.match(shop, /fetch\(`\/api\/catalog\/feed\?\$\{p\}`/);
assert.match(shop, /window\.setInterval\([\s\S]*45_000/);
assert.match(shop, /requestId !== feedRequestRef\.current/);
assert.match(shop, /hasFeedRowsRef\.current/);

console.log('PASS shop web/mobile shared Firestore feed and refresh contract');
