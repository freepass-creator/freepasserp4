import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const projectId = 'freepasserp5';
const fail: string[] = [];
const warn: string[] = [];

function read(relative: string) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

const boundary = read('lib/server/erp5-firestore-app.ts');
const whitelabelReader = read('lib/server/whitelabel-erp5-catalog.ts');
const catalogFeed = read('app/api/catalog/feed/route.ts');
const guestQuote = read('lib/server/guest-quote.ts');
const shopView = read('app/(shop)/shop/ShopView.tsx');
if (!boundary.includes(`ERP5_FIREBASE_PROJECT_ID = '${projectId}'`)) {
  fail.push('ERP5 전용 Firebase project_id가 고정돼 있지 않음');
}
if (/firebase-admin\/database|databaseURL|getDatabase\(/.test(boundary)) {
  fail.push('ERP5 Firestore 경계에 RTDB 의존성이 남아 있음');
}
if (!boundary.includes('ERP5_FIREBASE_SERVICE_ACCOUNT_JSON')) {
  fail.push('ERP5 전용 서버 자격증명 경계가 없음');
}
if (!boundary.includes("CUTOVER_RECEIPT_COLLECTION = 'ops'")) {
  fail.push('ERP5 전환 영수증 컬렉션 계약이 없음');
}
if (!boundary.includes('ERP5_WHITELABEL_FIRESTORE_ENABLED')) {
  fail.push('ERP5 화이트라벨 전환 kill switch가 없음');
}
if (!boundary.includes('missingCount !== 0')) {
  fail.push('상품 inventory 누락을 막는 전환 게이트가 없음');
}
if (!/projectId !== ERP5_FIREBASE_PROJECT_ID/.test(boundary)) {
  fail.push('서비스계정 project_id 불일치 차단이 없음');
}
if (!boundary.includes('ERP3 자격증명 대체 사용은 금지')) {
  fail.push('기존 ERP3 자격증명 fallback 금지 계약이 없음');
}
if (/firebase-admin\/database|databaseURL|getDatabase\(/.test(whitelabelReader)) {
  fail.push('화이트라벨 ERP5 reader에 RTDB 의존성이 남아 있음');
}
if (!whitelabelReader.includes('assertErp5WhitelabelCutoverReady')) {
  fail.push('화이트라벨 ERP5 reader가 READY 영수증을 검사하지 않음');
}
if (!catalogFeed.includes('whiteLabelRequest && erp5WhitelabelCutoverRequested()')) {
  fail.push('공개 목록에서 화이트라벨 요청만 ERP5로 가는 분기가 없음');
}
if (!guestQuote.includes('options.whitelabel === true && erp5WhitelabelCutoverRequested()')) {
  fail.push('공개 상세에서 화이트라벨 요청만 ERP5로 가는 분기가 없음');
}
if (!shopView.includes("p.set('wl', wlKey)")) {
  fail.push('화이트라벨 목록이 API에 채널 키를 전달하지 않음');
}

const erp5ReaderConsumers = [
  'app/api/catalog/feed/route.ts',
  'lib/server/guest-quote.ts',
].filter((file) => read(file).includes('readWhitelabelCatalogFromErp5'));
if (erp5ReaderConsumers.length !== 2) {
  fail.push(`ERP5 reader 소비자 범위가 화이트라벨 공개 경로와 다름: ${erp5ReaderConsumers.join(', ') || '없음'}`);
}

const legacySurface = [
  'lib/firebase/client.ts',
  'lib/server/firebase-admin.ts',
  'lib/server/firestore-ref-shim.ts',
].filter((file) => /firebase\/database|firebase-admin\/database|NEXT_PUBLIC_FIREBASE_DATABASE_URL|getDatabase\(/.test(read(file)));
if (legacySurface.length) {
  warn.push(`기존 ERP3/RTDB 소비 경로가 남아 있어 운영 전환 HOLD: ${legacySurface.join(', ')}`);
}

if (fail.length) {
  for (const item of fail) console.error(`FAIL ${item}`);
  process.exit(1);
}
console.log(`PASS ERP5 Firestore 연결 경계: ${projectId}`);
for (const item of warn) console.log(`HOLD ${item}`);
