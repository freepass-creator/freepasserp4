/**
 * 매뉴얼로 **확정된 디자인이 바뀌지 않게** 지킨다
 * (사장님 2026-08-28 「매뉴얼로 확정된 거는 바뀌지 않게끔 해 줘」).
 *
 * 정본은 `docs/DESIGN_CONFIRMED_LIST_CARD.md`. 여기 있는 항목은 그 문서의 각 줄과 1:1이다.
 * 코드가 문서를 벗어나면 **여기서 멈춘다.**
 *
 * 왜 필요한가 — 2026-08-28 하루에 같은 자리를 세 번 어긋나게 고쳤다:
 *   검색창 회색(웹만 고침) · 얼룩무늬(말을 반대로 두 번 읽음) · 우대조건 줄(뱃지로 오독).
 * 문서만으로는 안 지켜진다. 다음 세션은 문서를 안 읽고 코드부터 고친다.
 *
 * 바꾸려면: 사장님께 여쭙고 → 문서를 고치고 → 이 검사를 고친다. 그 차례를 지킨다.
 */
import { readFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fails: string[] = [];
const must = (ok: boolean, what: string, where: string) => { if (!ok) fails.push(`${what}\n      → ${where}`); };

const css = read('app/globals.css');
const rowCard = read('components/ProductRowCard.tsx');
const perks = read('components/product-card-perks.tsx');
const badgeView = read('components/product-card-badge-view.tsx');
const detail = read('components/ProductDetail.tsx');
const priceTable = read('components/ProductPriceTable.tsx');
const identity = read('components/product-card-identity.ts');
const entities = read('lib/intake/entities.ts');
const product = read('lib/domain/product.ts');
/* 가게(손님 동) — 정본은 docs/DESIGN_CONFIRMED_SHOP.md */
const shopDetail = read('components/shop/ShopDetail.tsx');
const shopCard = read('components/shop/ShopCard.tsx');
const shopQuery = read('lib/shop/query.ts');
const shopView = read('app/(shop)/shop/ShopView.tsx');
const shopUi = read('components/shop/shop-ui.tsx');
const qPage = read('app/q/[code]/page.tsx');

/* ── 1. 목록 ── */
must(/^\s*\/\* \.fp-card\.fp-card-row:nth-child\(even\)/m.test(css),
  '목록 얼룩무늬(지브라)가 켜졌습니다. 사장님 「얼룩무늬 뺄 거라고」 — 꺼진 채로 둡니다.',
  'app/globals.css · .fp-card-row:nth-child(even)');
must(/\.fp-page-toolbar \{ background: var\(--bg-card\)/.test(css)
  && /\.fp-finder-toolbar \{ background: var\(--bg-card\)/.test(css),
  '검색창 주변이 회색입니다. 모바일(.fp-page-toolbar)과 웹(.fp-finder-toolbar) 둘 다 흰 바탕이어야 합니다.',
  'app/globals.css — 한쪽만 고치면 반드시 되돌아옵니다');
must(!/<div className="fp-card fp-card-row"[^>]*background:/.test(rowCard),
  '목록 행에 인라인 배경이 다시 들어왔습니다. 인라인은 클래스를 이겨 무엇을 켜도 안 먹습니다.',
  'components/ProductRowCard.tsx');

/* ── 2. 카드 ── */
must(/withCredit/.test(perks) && /key: 'cd'/.test(product),
  '우대조건 줄 맨 앞의 심사조건이 사라졌습니다.',
  'lib/domain/product.ts benefitSignals · product-card-perks.tsx');
must(!/if \(key === 'cd'\) return C\.ink/.test(perks),
  '심사 아이콘만 먹색으로 되돌아갔습니다. 옆의 우대조건과 똑같이 색 든 아이콘이어야 합니다.',
  'components/product-card-perks.tsx benefitIconColor');
must(!/<Badge\b/.test(badgeView) && /SignalMarks/.test(badgeView),
  '차량 신호가 상자(박스 뱃지)로 되돌아갔습니다. 아이콘 + 글자입니다.',
  'components/product-card-badge-view.tsx');
must(!/<Badge\b/.test(detail),
  '상세 머리에 상자 뱃지가 다시 생겼습니다.',
  'components/ProductDetail.tsx');
must(/specAtoms/.test(identity),
  '차번 옆 원자 차례(연식·주행·연료·배기량·구동)가 한 곳에서 안 정해집니다.',
  'components/product-card-identity.ts specAtoms');
// 모바일 목록에는 출고상태·상품구분을 세우지 않는다 — 목록 행에서 신호는 웹 분기 하나뿐
must((rowCard.match(/<CardRailBadges/g) || []).length === 1,
  '모바일 목록에 출고상태·상품구분이 다시 붙었습니다(상세에만 둡니다).',
  'components/ProductRowCard.tsx — 웹 분기 1곳만');

/* ── 3. 상세 ── */
must(/'픽업구독'/.test(entities),
  '상품구분 캐논에서 「픽업구독」이 빠졌습니다 — 338대가 「중고구독」으로 보이게 됩니다.',
  'lib/intake/entities.ts PRODUCT_TYPES');
must(/const split = ret\.length > 0 && acq\.length > 0/.test(priceTable)
  && /<tr key="g-acq">/.test(priceTable),
  '대여료표에서 인수형 갈래 줄이 사라졌습니다.',
  'components/ProductPriceTable.tsx');
must(/보증금 상계/.test(priceTable),
  '인수형 설명이 사라졌습니다. 「만기 인수 조건」만 쓰면 만기에 돈이 더 나가는 것을 안 말하게 됩니다.',
  'components/ProductPriceTable.tsx');
must(!/groupHead/.test(priceTable),
  '반납형에까지 이름표를 붙이는 옛 구조가 돌아왔습니다. 반납형은 기본이라 이름표가 없습니다.',
  'components/ProductPriceTable.tsx');
must(/insLabel/.test(product) && /보험 포함|보험 별도/.test(product),
  '대여료 조건 칸에서 보험 포함 여부가 사라졌습니다.',
  'lib/domain/product.ts pricePlanList');
must(/cheapest_ && !mobile/.test(priceTable),
  '모바일에서 「최저」 칩이 다시 붙었습니다. 모바일은 배경 표시로 충분합니다.',
  'components/ProductPriceTable.tsx');
must(!/condition === '만기인수'/.test(priceTable),
  '갈래를 조건 «글자»로 판정하고 있습니다. 표기가 바뀌면 무너집니다 — acquisition 플래그를 쓰세요.',
  'components/ProductPriceTable.tsx');
must(!/\['차명',/.test(product),
  '상세 「차명」 줄이 되살아났습니다. 맨 위 제목이 이미 같은 이름을 듭니다(중복).',
  'lib/domain/product.ts detailSections');
must(/\['차종구분',/.test(product),
  '상세의 「차종구분」이 「차종」으로 되돌아갔습니다. 판매시트 열 이름과 같아야 합니다.',
  'lib/domain/product.ts detailSections');
must(!/\['상품', /.test(product),
  '상세 「상품」 줄이 되살아났습니다. 차량번호와 같은 말을 두 번 합니다.',
  'lib/domain/product.ts detailSections');

/* ── 4. 색 사다리 ── */
must(!/purple|teal|amber|green/.test(priceTable),
  '대여료표에 새 색(hue)이 들어왔습니다. 색은 네이비 하나, 다른 건 세기뿐입니다.',
  'docs/DESIGN_COLOR_LADDER.md');

/* ── 5. 가게(손님 동) — docs/DESIGN_CONFIRMED_SHOP.md ── */

// 상세 실행줄 셋. 공유가 빠지면 손님이 화면을 «찍어» 보내고 담당자 귀속이 끊긴다 — 퍼널이 끊기는 것이다.
must(/목록으로/.test(shopDetail) && /navigator\.share/.test(shopDetail) && /aria-label="이 차량 공유하기"/.test(shopDetail),
  '상세 실행줄(목록으로·관심·공유)이 사라졌습니다. 공유는 이 사업의 퍼널입니다.',
  'components/shop/ShopDetail.tsx TopBar');
must(/window\.location\.href/.test(shopDetail),
  '공유가 «지금 주소 그대로»를 안 보냅니다. 손으로 조립하면 ?a= 담당 귀속을 흘립니다.',
  'components/shop/ShopDetail.tsx share()');
must(/listHref/.test(shopDetail),
  '「목록으로」가 담당 귀속(?a=)을 안 물고 갑니다. 돌아가면 담당자가 바뀝니다.',
  'components/shop/ShopDetail.tsx listHref');

// 대여료 = 표. 기간 오름차순.
must(/<table/.test(shopDetail) && /월 대여료/.test(shopDetail) && /byMonth/.test(shopDetail),
  '대여료가 표에서 칩으로 되돌아갔습니다. 다른 기간이 얼마인지 눌러 봐야 알게 됩니다.',
  'components/shop/ShopDetail.tsx 대여료');
must(/sort\(\(a, b\) => a\.m - b\.m\)/.test(shopDetail),
  '대여료 표가 기간 오름차순이 아닙니다. 「길게 하면 싸지는구나」가 안 읽힙니다.',
  'components/shop/ShopDetail.tsx byMonth');

// 정책 넷. 운전 조건을 「기타」에 묻지 않는다.
// 구역이 «있는가»만 본다 — 어떤 배열로 그리는지(표·타일·큰줄)는 구역마다 달라도 된다.
for (const sec of ['보험 조건', '계약 조건', '운전 조건', '기타 사항']) {
  must(new RegExp(`title="${sec}"|<SecTitle>${sec}</SecTitle>`).test(shopDetail),
    `상세에서 「${sec}」 구역이 사라졌습니다. 한 표에 몰면 보험을 찾다 납부 방법을 지나칩니다.`,
    'components/shop/ShopDetail.tsx Sec');
}

// 금액은 반올림하지 않는다 — man 은 반올림이라 손님 화면 금지.
for (const [f, name] of [[shopDetail, 'ShopDetail'], [shopCard, 'ShopCard']] as [string, string][]) {
  must(/manWon/.test(f) && !/\bman\(/.test(f),
    `${name} 이 금액을 반올림합니다(man). 손님이 보는 금액은 낼 금액입니다 — manWon 을 씁니다.`,
    'lib/format.ts man vs manWon');
}

// 조건은 주소에 실린다.
must(/export function readQuery/.test(shopQuery) && /export function writeQuery/.test(shopQuery)
  && /writeQuery\(query, keep\)/.test(shopView),
  '조건이 주소에서 빠졌습니다. 영업자가 「이 조건으로 골라 둔 목록」을 못 보냅니다.',
  'lib/shop/query.ts · ShopView');

// 건수는 교차 집계(그 축을 뺀 나머지 조건으로 센다).
must(/passes\(p, sel, axis\)/.test(shopQuery),
  '조건 건수가 교차 집계를 안 합니다. 「디젤 120」이라 써 놓고 눌렀을 때 3대가 나옵니다.',
  'lib/shop/query.ts baseFor');

// 상세 조건으로 가는 문은 검색줄 하나.
must(/onFilter/.test(shopUi) && /aria-label="상세 조건 열기"/.test(shopUi),
  '상세 조건 버튼이 검색줄에서 빠졌습니다. 폰에는 왼쪽 기둥이 없어 축 아홉으로 갈 길이 사라집니다.',
  'components/shop/shop-ui.tsx ShopSearch');

// 브랜드 갈림은 서버 껍데기가 한다 — 화면 안에서 가르면 두 화면이 원자를 나눠 쓴다.
must(/hasBrand\(wl\) \? <ShopDetailView/.test(qPage),
  '/q/[code] 의 브랜드 갈림이 서버 껍데기에서 사라졌습니다. 화면 안에서 가르면 두 화면이 섞입니다.',
  'app/q/[code]/page.tsx');

// 손님 동에 하드코딩 hex 금지 — 채널이 늘어도 화면을 안 고치는 근거다.
for (const [f, name] of [[shopDetail, 'ShopDetail'], [shopCard, 'ShopCard'], [shopUi, 'shop-ui']] as [string, string][]) {
  must(!/#[0-9a-fA-F]{6}\b/.test(f.replace(/#fff\b/g, '')),
    `${name} 에 하드코딩 hex 가 들어왔습니다. 색은 토큰만 — 채널 색은 lib/whitelabel.ts 한 줄입니다.`,
    'docs/DESIGN_CONFIRMED_SHOP.md §3');
}

// 요금 밑에 「심사」를 쓰지 않는다 — 무심사가 셀링포인트인데 요금 옆에서 그 말을 도로 꺼내면 안 된다.
must(!/심사·재고에 따라/.test(shopDetail),
  '요금 밑 안내문이 되살아났습니다. 「심사」를 요금 옆에서 도로 꺼내는 자해입니다 — 마감 안내문 한 번이면 충분합니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-11');
// 차량 정보 표는 사실줄·차명과 안 겹치는 넷만.
must(!/['"]제조사['"], *makerDisplay/.test(shopDetail) && /['"]색상['"]/.test(shopDetail),
  '차량 정보 표에 차명·사실줄과 겹치는 줄이 돌아왔습니다(또는 색상이 빠졌습니다). 색상은 사진 없는 28%의 유일한 외관 정보입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-10');
// 전화는 담당자 → 대표번호로 떨어진다 — ?a= 없는 손님에게 전화 링크가 0개가 되면 안 된다.
must(/wl\.tel/.test(read('app/q/[code]/ShopDetailView.tsx')),
  '상세가 대표번호 폴백을 잃었습니다. ?a= 없이 들어온 손님은 폰에서 전화 링크가 0개가 됩니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-9');

if (fails.length) {
  console.error(`\n✗ 확정 디자인이 바뀌었습니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`   · ${f}\n`);
  console.error('  바꾸려면: 사장님께 여쭙고 → docs/DESIGN_CONFIRMED_LIST_CARD.md 를 고치고 → 이 검사를 고칩니다.\n');
  process.exit(1);
}
console.log('✓ 확정 디자인 유지 — 목록·카드·상세·색 사다리·가게 정합');
