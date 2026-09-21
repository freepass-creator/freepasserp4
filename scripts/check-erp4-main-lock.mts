/**
 * ERP4 MAIN Stability Lock
 *
 * freepasserp.com 공개 Product Browse가 «무엇인가»를 상위 레벨에서 잠근다.
 * 세부 디자인/데이터 검사는 기존 check:design · check:deposit · check:speed 등이 맡고,
 * 이 검사는 그 검사들이 지키는 조각이 다시 다른 제품 구조로 섞이는 것을 막는다.
 *
 * 변경하려면:
 * 1) 사용자 승인
 * 2) docs/ERP4-MAIN-UI-STANDARD.md + docs/ERP4-MAIN-STABILITY-LOCK.md 갱신
 * 3) 이 검사 갱신
 */
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const failures: string[] = [];

function must(cond: boolean, message: string) {
  if (!cond) failures.push(message);
}

const middleware = read('middleware.ts');
const layout = read('app/layout.tsx');
const shopPage = read('app/(shop)/shop/page.tsx');
const shopView = read('app/(shop)/shop/ShopView.tsx');
const shopUi = read('components/shop/shop-ui.tsx');
const shopCard = read('components/shop/ShopCard.tsx');
const shopDetail = read('components/shop/ShopDetail.tsx');
const guestListing = read('lib/server/guest-listing.ts');
const query = read('lib/shop/query.ts');
const pkg = read('package.json');
const standard = read('docs/ERP4-MAIN-UI-STANDARD.md');
const lockDoc = read('docs/ERP4-MAIN-STABILITY-LOCK.md');
const surfaceLock = read('docs/ERP4-MAIN-SURFACE-LOCK.md');
const wlFrame = read('components/WhitelabelFrame.tsx');

console.log('\nERP4 MAIN Stability Lock\n');


/* 0. 운영 사용면 — 쓰는 것과 안 쓰는 것을 명시적으로 잠근다. */
must(/ACTIVE_MAIN — 현재 ERP닷컴에서 쓰는 정본/.test(surfaceLock)
  && /`\/`/.test(surfaceLock)
  && /`\/shop`/.test(surfaceLock)
  && /`\/q\/\[code\]`/.test(surfaceLock),
  'ERP4 MAIN의 ACTIVE_MAIN 경로 잠금이 사라졌다.');
must(/NOT_MAIN — ERP닷컴 메인에서는 안 쓰는 것/.test(surfaceLock)
  && /`\/login`/.test(surfaceLock)
  && /`\/finder`/.test(surfaceLock)
  && /`\/settlement\/\*\*`/.test(surfaceLock)
  && /`\/erp5\/\*\*`/.test(surfaceLock),
  'ERP닷컴 메인 비사용 경로 구분이 사라졌다.');
must(/찾기 → 비교 → 상세 확인/.test(surfaceLock),
  'ERP4 MAIN의 사용자 흐름 잠금이 바뀌었다.');

/* 1. 제품 정의 / 인증 완전 분리 */
must(/상태:\s*\*\*CURRENT \/ ERP4 공개 메인 정본\*\*/.test(standard),
  '정본 문서가 CURRENT 상태가 아니다.');
must(/인증 시스템과 분리된 공개 상품 조회·검색 화면/.test(standard),
  'ERP4 MAIN 제품 정의에서 인증 분리 문구가 사라졌다.');
must(/로그인·회원·세션은 ERP4 MAIN과 분리된 별도 업무 인증 기능/.test(standard),
  '정본의 한 문장 정의가 로그인 기능을 ERP4 MAIN과 다시 묶었다.');

must(/pathname === '\/'\s*&&\s*homeIsShop\(host\)/.test(middleware),
  '상품 홈 판정이 루트(/) 전용이 아니다.');
must(/target\.pathname = '\/shop'/.test(middleware),
  '상품 홈이 /shop으로 rewrite되지 않는다.');
must(/headers\.set\(GUEST_HEADER, '1'\)/.test(middleware),
  '공개 상품 요청에 x-fp-guest 경계가 붙지 않는다.');
must(/MAIN_PUBLIC_HOSTS/.test(middleware)
  && /RETIRED_MAIN_PATHS/.test(middleware)
  && /isRetiredMainPath\(request\.nextUrl\.pathname\)/.test(middleware),
  '대표 ERP 도메인의 은퇴 업무 경로 정리 목록이 없다.');
must(/new URL\('https:\/\/freepasserp\.com\/'\)/.test(middleware)
  && /NextResponse\.redirect\([^\n]+, 308\)/.test(middleware),
  '대표 ERP 도메인의 은퇴 업무 경로가 canonical 홈으로 영구 이동하지 않는다.');

const guestAt = layout.indexOf('{guestSurface ? (');
const elseAt = guestAt >= 0 ? layout.indexOf(') : (', guestAt) : -1;
const authAt = layout.indexOf('<AuthProvider>');
must(/const guestSurface = hdrs\.get\('x-fp-guest'\) === '1'/.test(layout),
  'RootLayout의 공개/업무 경계가 x-fp-guest 서버 헤더가 아니다.');
must(guestAt >= 0 && elseAt > guestAt && authAt > elseAt,
  '공개 상품 가지가 AuthProvider 밖에 있지 않다.');
if (guestAt >= 0 && elseAt > guestAt) {
  const guestBranch = layout.slice(guestAt, elseAt);
  must(!guestBranch.includes('<AuthProvider>'), '공개 상품 가지에서 AuthProvider가 실행된다.');
  must(!guestBranch.includes('<TopBar'), '공개 상품 가지에 업무 TopBar가 다시 들어왔다.');
  must(!guestBranch.includes('<AppTabBar'), '공개 상품 가지에 업무 AppTabBar가 다시 들어왔다.');
}

/* 2. 데이터 원장 / 공개 목록 경계 */
must(/readWhitelabelCatalogFromErp5/.test(guestListing),
  '공개 상품 목록이 ERP5 canonical catalog를 읽지 않는다.');
must(/slimForList\(sanitizeProductForGuest/.test(guestListing),
  '공개 목록이 guest sanitize + list slim 경계를 거치지 않는다.');
must(!/getStore\s*\(/.test(guestListing) && !/Realtime Database|RTDB.*fallback/i.test(guestListing.replace(/\/\*[\s\S]*?\*\//g, '')),
  '공개 목록 코드에 레거시 store/RTDB fallback이 다시 들어왔다.');

/* 3. UI 토큰 — 숫자를 화면 파일에서 새로 만들지 않고 SHOP 정본을 쓴다 */
must(/top:\s*\{\s*title:\s*18,\s*cobrand:\s*12\s*\}/.test(shopUi),
  '상단 제목 18 / 동반표기 12 토큰이 바뀌었다.');
must(/height: mobile \? 48 : 56/.test(wlFrame),
  '상단바 높이 56/48 잠금이 바뀌었다.');
must(/borderBottom: 'none'/.test(wlFrame),
  '상단바 아래 구분선이 다시 생겼다.');
must(/h:\s*\{\s*web:\s*44,\s*mobile:\s*44\s*\}/.test(shopUi),
  '기본 컨트롤 높이 44/44가 바뀌었다.');
must(/pill:\s*\{\s*web:\s*26,\s*mobile:\s*32\s*\}/.test(shopUi),
  '빠른조건 칩 높이 26/32가 바뀌었다.');
must(/icon:\s*\{\s*web:\s*36,\s*mobile:\s*40\s*\}/.test(shopUi),
  '아이콘 버튼 36/40이 바뀌었다.');
must(/r:\s*\{[^}]*chip:\s*8[^}]*ctrl:\s*10[^}]*card:\s*12[^}]*pill:\s*PILL_R/.test(shopUi),
  'ERP4 MAIN radius 사다리(8/10/12/pill)가 바뀌었다.');
must(/sp:\s*\{\s*tight:\s*4,\s*snug:\s*8,\s*cozy:\s*12,\s*edge:\s*16,\s*part:\s*24,\s*pane:\s*32,\s*wide:\s*48\s*\}/.test(shopUi),
  'ERP4 MAIN spacing 사다리(4/8/12/16/24/32/48)가 바뀌었다.');

must(/fontSize:\s*SHOP\.top\.title[\s\S]{0,140}?fontWeight:\s*FW\.title[\s\S]{0,160}?letterSpacing:\s*'-0\.02em'[\s\S]{0,80}?lineHeight:\s*1/.test(shopDetail),
  '상세 「상품 상세」 헤더가 목록 상단 타이포 정본과 갈렸다.');
must(/aspectRatio:\s*'16 \/ 10'[\s\S]{0,100}?borderRadius:\s*SHOP\.r\.card/.test(shopCard),
  '목록 카드 사진 16:10 / 카드 radius 규격이 바뀌었다.');
must(/width:\s*260,\s*flexShrink:\s*0/.test(shopView),
  '웹 좌측 필터 260px 규격이 바뀌었다.');

/* 4. 검색/필터/정렬은 URL과 같은 상태를 공유 */
must(/export const SHOP_DEFAULT_SORT:\s*ShopSort\s*=\s*'popular'/.test(query),
  '기본 정렬이 인기순에서 바뀌었다.');
must(/export function readQuery/.test(query) && /export function writeQuery/.test(query),
  '검색/필터 URL read/write 계약이 사라졌다.');
must(/if \(query\.sort !== SHOP_DEFAULT_SORT\) out\.set\('sort', query\.sort\)/.test(query),
  '기본 정렬을 URL에 불필요하게 싣거나 URL 정렬 계약이 바뀌었다.');

/* 가격 3축은 한 차량 안의 서로 다른 기간 행을 섞지 않는다. */
must(/const PRICE_AXES = \['term', 'rent', 'dep'\] as const/.test(query)
  && /const priceSelectionsMatch/.test(query)
  && /const priceFacetMatch/.test(query),
  '기간·월대여료·보증금의 동일 가격행 엔진이 사라졌다.');
must(/export function priceForShopSelection/.test(query),
  '카드 대표가격을 현재 가격행 조건에서 고르는 함수가 사라졌다.');
must(/displayPrice=\{priceForShopSelection\(p, liveQuery\.sel\)\}/.test(shopView),
  '목록과 카드 가격이 같은 liveQuery 가격조건을 쓰지 않는다.');
must(/displayPrice === undefined \? cheapest\(p\) : displayPrice/.test(shopCard),
  'ShopCard가 선택 가격행을 무시하고 전체 최저가를 다시 계산한다.');
must(/sim-deposit-rule\.mts && tsx scripts\/sim-shop-deposit-term\.mts/.test(pkg),
  'check:deposit에 동일 가격행 회귀 테스트가 연결되어 있지 않다.');

must(/FIRST_SCREEN\s*=\s*6/.test(shopPage),
  '첫 화면 서버 선렌더 카드 수(6)가 바뀌었다 — 성능 검토 없이 변경 금지.');

/* 5. 공개 상품면에서 로그인 진입점을 다시 만들지 않는다 */
for (const [file, src] of [
  ['ShopView', shopView],
  ['ShopCard', shopCard],
  ['ShopDetail', shopDetail],
] as const) {
  must(!/href\s*=\s*["'{][^\n]*\/login/.test(src),
    `${file}에 /login 링크가 생겼다.`);
}
must(/LOCK-01[\s\S]*인증 분리/.test(lockDoc)
  && /LOCK-02[\s\S]*ERP5/.test(lockDoc)
  && /LOCK-03[\s\S]*디자인/.test(lockDoc),
  'Stability Lock 문서의 핵심 잠금 항목이 사라졌다.');

if (failures.length) {
  console.error(`✗ ERP4 MAIN Stability Lock 위반 ${failures.length}건\n`);
  failures.forEach((x) => console.error(`  · ${x}`));
  console.error('\n구조/규격을 바꾸려면 먼저 정본 문서와 잠금 문서를 사용자 승인에 맞춰 갱신해야 합니다.\n');
  process.exit(1);
}

console.log('✓ LOCK-00 운영 사용면 / 비사용면');
console.log('✓ LOCK-01 제품/인증 경계');
console.log('✓ LOCK-02 ERP5 공개 데이터 경계');
console.log('✓ LOCK-03 목록·상세 디자인 토큰');
console.log('✓ LOCK-04 URL 검색/필터/정렬 + 동일 가격행 계약');
console.log('✓ LOCK-05 첫 화면 성능·로그인 진입점');
console.log('\n✅ ERP4 MAIN 안정화 기준선 유지\n');
