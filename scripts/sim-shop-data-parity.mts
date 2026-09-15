/**
 * 공개 화이트라벨의 웹·모바일 데이터 경로 회귀 방지.
 *
 * 두 화면은 같은 ShopView와 `/api/catalog/feed`를 쓰며, 이 API는 Firestore `products`
 * 원자만 읽는다. RTDB 폴백을 다시 넣으면 상태 변경이 한쪽에만 늦게 보일 수 있으므로 막는다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const feed = source('app/api/catalog/feed/route.ts');
const guest = source('lib/server/guest-source.ts');
const shop = source('app/(shop)/shop/ShopView.tsx');

assert.match(guest, /getFirestore\(firebaseAdminApp\(\)\)/);
assert.match(guest, /collection\('products'\)/);
assert.match(guest, /collection\('policy'\)/);
assert.match(guest, /const TTL_MS = 15_000/);
assert.doesNotMatch(guest, /firestore-ref-shim|\.ref\(/);

assert.match(feed, /collection\('partner'\)/);
assert.match(feed, /collection\('user'\)/);
assert.doesNotMatch(feed, /firestore-ref-shim|\.ref\(/);
assert.match(feed, /Cache-Control': 'no-store'/);
assert.match(feed, /findGuestPolicy\(src\.policies, p\.policy_code\)/);
assert.match(source('lib/server/guest-quote.ts'), /findGuestPolicy\(\(await guestSource\(\)\)\.policies, policyCode\)/);
assert.match(source('lib/server/guest-quote.ts'), /collection\('user'\)/);
assert.doesNotMatch(source('lib/server/guest-quote.ts'), /firestore-ref-shim|\.ref\(/);

assert.match(shop, /fetch\(`\/api\/catalog\/feed\?\$\{p\}`/);
assert.match(shop, /window\.setInterval\([\s\S]*45_000/);
assert.match(shop, /requestId !== feedRequestRef\.current/);
assert.match(shop, /hasFeedRowsRef\.current/);

console.log('PASS shop web/mobile shared Firestore feed and refresh contract');
