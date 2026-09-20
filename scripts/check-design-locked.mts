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
import { existsSync, readFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fails: string[] = [];
const must = (ok: boolean, what: string, where: string) => { if (!ok) fails.push(`${what}\n      → ${where}`); };

/*
 * ★★**스타일시트가 둘이다**(2026-09-08) — 업무동 `globals.css` · 손님 동 `whitelabel.css`.
 *   아래 규격 검사들은 「어느 파일에 있느냐」가 아니라 「그 규칙이 살아 있느냐」를 본다.
 *   그래서 둘을 이어 붙여 읽는다 — 규칙을 파일 사이로 옮기는 것만으로 검사가 깨지면
 *   다음 사람이 «검사를 피하려고» 규칙을 옮기게 된다.
 * ⚠ 「섞이지 않았는가」는 이것과 «다른» 검사다(맨 아래) — 거기서는 두 파일을 따로 읽는다.
 */
const css = [read('app/globals.css'), read('app/whitelabel.css')].join(`
`);
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
/*
 * 목록 행의 출고상태·상품구분은 **웹·폰 둘 다** 선다(사장님 2026-09-17 「그냥 웹앱 웹에서 보이는 거랑
 * 모바일 동일하게 하자고」 · 손님 가게 폰 화면을 가리키며 「표준라벨도 이렇게 나와야 한다고」).
 * ⚠ 예전 규칙은 「웹 분기 1곳만」이었다 — 폰 목록을 4줄로 좁히려고 신호를 상세로 내렸는데,
 *   그래서 웹에서는 「출고가능·픽업구독」이 보이는 차가 **폰에서는 아무 표시도 없었다.**
 *   손님 가게(화이트라벨)는 폰에서도 그 신호를 보여 주고 있어, 같은 회사 화면에서 폰만 정보가 적었다.
 * ⇒ 웹·폰 둘 다 «있는지»를 본다. 하나라도 빠지면 그때가 드리프트다.
 */
must((rowCard.match(/<CardRailBadges/g) || []).length === 2,
  '목록 카드의 출고상태·상품구분이 한쪽(웹 또는 폰)에서 빠졌습니다 — 둘 다 세웁니다.',
  'components/ProductRowCard.tsx — 웹·모바일 각 1곳');
must((rowCard.match(/<OptionChips/g) || []).length === 2,
  '목록 카드의 옵션칩이 한쪽(웹 또는 폰)에서 빠졌습니다 — 둘 다 세웁니다.',
  'components/ProductRowCard.tsx — 웹·모바일 각 1곳');

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
/*
 * ★**지키는 것은 「기간 오름차순」 하나다 — 잣대의 «차례»가 아니다**(2026-09-16 두 번째 손질).
 *   ⚠ 여기 `sort((a, b) => a.m - b.m)` «한 줄 통째»를 맞대고 있었다. 그래서 같은 기간 안에서
 *     갈래(반납형/인수형) 차례를 더하는 순간, 규격을 지켰는데도 빨간불이 떴다.
 *   ★지키려는 것은 「길게 하면 싸지는구나」가 읽히는 것 = **기간이 첫 잣대**라는 것뿐이다.
 *     같은 기간 줄이 둘일 때 어느 갈래가 위인지는 그 규격이 말하는 바가 아니다.
 *   ⇒ `a.m - b.m` 이 sort 의 «첫 비교»인지만 본다. 뒤따르는 `||` 은 허용한다.
 *
 * ⚠⚠ **또 걸렸다 — 이번엔 갈래 묶음 때문이다**(같은 날). 사장님이 「반납형 인수형은 섹션으로도
 *   분리해줘」 하셔서 갈래로 «먼저» 묶었다. 그러자 첫 비교가 `a.acquisition` 이 되어 빨간불이 떴다.
 *   ★그런데 규격이 지키려는 것은 **여전히 지켜진다** — 반납형 12→60 이 한 묶음, 인수형 12→60 이
 *     한 묶음으로 서서 「길게 하면 싸지는구나」가 구역 «안에서» 그대로 읽힌다. 사다리가 둘이 됐을 뿐이다.
 *   ⚠ 기간을 첫 잣대로 두면 갈래가 한 줄씩 번갈아 서서 구역 줄이 열 번 나온다 — 그게 진짜 사고다.
 * ⇒ `a.m - b.m` 이 그 sort 의 **잣대 중에 있는지**만 본다. 차례는 묻지 않는다.
 *   ★여전히 잡는다 — `a.m` 을 아예 안 쓰고 요금순으로만 세우면 빨간불이다(실측).
 */
must(/byMonth[\s\S]{0,600}?a\.m - b\.m/.test(shopDetail),
  '대여료 표가 기간 오름차순이 아닙니다. 「길게 하면 싸지는구나」가 안 읽힙니다.',
  'components/shop/ShopDetail.tsx byMonth');

/*
 * 정책은 넷으로 갈린다 — **가르는 축은 «손님이 묻는 순서»**다(사장님 2026-09-05
 * 「손님 입장에서 뭐가 궁금할지를 한번 생각을 해봐」).
 * ⚠ 여기 이름이 「보험 / 계약 / 운전 / 기타」였다. 넷으로 가른다는 규칙은 그대로고 «축»만 바뀌었다 —
 *   그건 공급사 정책표의 칸 이름이지 손님의 말이 아니다. 손님은 「계약 조건」이 아니라
 *   「목돈이 얼마나 들어가나」를 궁금해한다.
 * 구역이 «있는가»만 본다 — 어떤 배열로 그리는지(표·타일·큰줄)는 구역마다 달라도 된다.
 */
for (const sec of ['차량 정보', '대여료 및 보증금', '보험', '이용 조건']) {
  // ⚠ «모양»이 아니라 «있는가»를 본다 — 전에 아이콘 프롭 하나 붙였다고 구역이 사라졌다고 잡았다.
  must(new RegExp(`title="${sec}"|<SecTitle[^>]*>${sec}`).test(shopDetail),
    `상세에서 「${sec}」 구역이 사라졌습니다. 한 표에 몰면 보험을 찾다 납부 방법을 지나칩니다.`,
    'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
}

/*
 * 금액은 **반올림하지 않는다** — `man()` 은 반올림이라 손님 화면 금지(398,000 이 「40만」이 된다).
 * ★2026-09-08 부터 손님 화면 금액은 «하나»다 — `wonKo`(「97만3천원」). 사장님
 *   「숫자에 0 들어가는 거 이거 홈페이지에는 안 해도 될 거 같은데」 · 「97만3천원 이렇게 하든가」.
 *   그전에는 카드가 소수점(97.3만원), 상세가 0 세 개(97만 3,000원)라 **같은 금액을 두 번 다르게**
 *   읽어야 했다. 둘 다 반올림은 안 했지만 «말»이 갈렸다.
 * ⚠ 지키는 것은 예나 지금이나 **「반올림 금지」 한 가지**다 — 함수 «이름»이 아니라.
 *   `wonKo` 는 천원 단위로 딱 떨어질 때만 만·천으로 적고, 아니면 원 단위 그대로 적는다.
 */
/* 2026-09-21 — 목록 카드는 훑는 자리라 만원 단위 한 자리까지 축약한다. 상세는 실제 원 단위 유지. */
must(/manShort\(price\.rent, \{ decimal: true \}\)/.test(shopCard) && !/\bman\(price\.rent/.test(shopCard),
  'ShopCard 대여료는 「67만원 · 67.5만원」 목록 축약 규격을 써야 합니다. man() 반올림은 금지입니다.',
  'components/shop/ShopCard.tsx · 사장님 2026-09-21');
must(/wonKo|manWon/.test(shopDetail) && !/\bman\(/.test(shopDetail),
  'ShopDetail 금액이 축약/반올림됐습니다. 상세는 실제 원 단위 금액을 유지합니다.',
  'lib/format.ts man vs manWon · 사장님 2026-09-21');

// 조건은 주소에 실린다.
must(/export function readQuery/.test(shopQuery) && /export function writeQuery/.test(shopQuery)
  && /writeQuery\(query, keep\)/.test(shopView),
  '조건이 주소에서 빠졌습니다. 영업자가 「이 조건으로 골라 둔 목록」을 못 보냅니다.',
  'lib/shop/query.ts · ShopView');

// 건수는 교차 집계(그 축을 뺀 나머지 조건으로 센다).
must(/passes\(p, sel, axis\)/.test(shopQuery),
  '조건 건수가 교차 집계를 안 합니다. 「디젤 120」이라 써 놓고 눌렀을 때 3대가 나옵니다.',
  'lib/shop/query.ts baseFor');

/*
 * 상세 조건으로 가는 문 — 폰에는 왼쪽 기둥이 없어 이 문이 사라지면 축 아홉으로 갈 길이 없다.
 * ⚠ 자리가 옮겨졌다(2026-09-05): 검색줄 «안» → **머리띠 오른쪽**(검색 아이콘 옆).
 *   검색이 머리띠로 올라갔으므로 조건도 같이 올라가야 한다 — 둘이 갈리면 손님이 두 군데를 뒤진다.
 */
must(/label="상세 조건 열기"/.test(shopView) && /count=\{queryCount\(query\)\}/.test(shopView),
  '상세 조건 버튼이 머리띠에서 빠졌습니다. 폰에는 왼쪽 기둥이 없어 축 아홉으로 갈 길이 사라집니다.',
  'app/(shop)/shop/ShopView.tsx headerActions');

/*
 * 브랜드 갈림은 서버 껍데기가 한다 — 화면 안에서 가르면 두 화면이 원자를 나눠 쓴다.
 * ⚠ 2026-09-09 — 판정 «이름»이 갈렸다: `hasBrand`(라벨이 붙나) → `hasShopFrame`(가게인가).
 *   라벨 없는 기본 얼굴(`plain`)이 생기면서, 「이름이 있나」로 가르면 그 얼굴이 옛 「상품 안내」로
 *   떨어진다. **규격(서버 껍데기가 가른다)은 그대로**고 무엇으로 가르느냐만 바뀌었다 —
 *   그래서 검사도 «서버에서 가르는가»만 본다. 화면 안에서 가르는 것은 여전히 막힌다.
 */
must(/(hasBrand|hasShopFrame)\(wl\)[\s\S]{0,200}?\?\s*<ShopDetailView|shop\s*\?\s*<ShopDetailView/.test(qPage),
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
/*
 * 차량 정보 = 「이 차가 무엇인가」. **차 설명하는 순서**로 든다(사장님 2026-09-05).
 * ⚠ 여기 있던 검사는 정반대였다 — 「사실줄과 겹치는 줄이 돌아왔나」를 잡았다(구 §1-11).
 *   그 규칙으로 고른 결과가 «차 설명»이 아니라 «남은 것 모음»이라 폐기됐다.
 *   검사를 지운 게 아니라 **새 규격을 지키도록** 바꾼 것이다.
 */
/*
 * ⚠ **라벨이 「세부모델 및 트림」으로 바뀌었다**(사장님 2026-09-16 「제조사 세부모델 세부트림
 *   이거를 **세부모델 및 트림**으로 하고」). 값 줄이 이미 「기아 · 쏘렌토 MQ4 · 트렌디」로
 *   제조사를 들고 있어서, 라벨에 또 적으면 같은 말이 위아래로 두 번이었다.
 * ★지키는 것은 **「이 차가 무엇인가」의 머리 줄이 있는가**다 — 그 «글자»가 아니다.
 */
must(/>세부모델 및 트림</.test(shopDetail),
  '차량 정보에서 「세부모델 및 트림」 첫 줄이 사라졌습니다. 이 줄이 「이 차가 무엇인가」의 머리입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-11');
/*
 * **색상은 «한 칸»이고 내·외부가 같이 든다 + 색 견본을 단다**(사장님 2026-09-05
 *   「색상은 왜 «외부 색상»이니? 색상에는 **내외부 색상이 다 있는 거지**」 ·
 *   「그 **색상 칩**을 만들었거든? 이렇게 색상 보이는 거, **직관적으로**? 색상 칩 달아주면 되고」).
 * ⚠ 여기 검사는 정반대였다 — 「외부 색상」·「내부 색상」 두 칸을 «요구»했다. 사장님 지시로 뒤집었다.
 *   두 칸으로 쪼개면 내장색이 없는 차(32%)는 늘 한 칸이 비어 「덜 채운 표」가 된다.
 * ★색 코드는 `lib/domain/color-chips` 가 정본 — 화면이 hex 를 새로 정하면 그때부터 갈린다.
 */
/*
 * ⚠ 2026-09-07 — 색상이 «제 줄»에서 **격자의 첫 칸**으로 옮겨 갔다(사장님 「색상 연식 주행거리를
 *   배정하자고」). 그래서 `aria-label="색상"` 은 더 없다. 묻는 것은 그대로다:
 *   **한 칸 안에 내·외부가 견본과 함께** 있어야 한다(두 칸으로 쪼개면 내장색 없는 차 32%가 늘 빈다).
 */
must(/\['색상', colorText,/.test(shopDetail)
  && /<ColorMark name=\{p\.ext_color\} label="외부"/.test(shopDetail)
  && /<ColorMark name=\{p\.int_color\} label="내부"/.test(shopDetail)
  && /from '@\/lib\/domain\/color-chips'/.test(read('components/ui/badges.tsx')),
  '색상이 다시 두 칸으로 갈렸거나 색 견본이 빠졌습니다 — 색상은 한 칸에 내·외부, 견본과 함께입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-11');
/*
 * ⚠ 여기 「구동방식이 돌아왔나」를 잡는 줄이 있었다. **폐기한다**(2026-09-05).
 *   09-05 낮 지적(「연식이, 이륜구동, 이런 걸 넣는 게 아니라」)은 «구동방식이 첫 칸이었던 것»이지
 *   «있으면 안 된다»가 아니었다. 같은 날 사장님이 차량 정보에 넣을 것을 세어 주시면서
 *   **구동 방식을 직접 부르셨다.** 검사가 사장님 지시를 막고 있었다.
 * ⇒ 대신 **세어 주신 칸이 다 있는지**를 잡는다.
 */
for (const f of ['색상', '연식', '주행거리', '배기량', '연료', '구동방식', '승차정원', '배터리', '차량 가격']) {
  must(new RegExp(`\['"]${f}['"]`).test(shopDetail),
    `차량 정보에서 「${f}」 칸이 사라졌습니다 — 사장님이 세어 주신 목록입니다(값이 없으면 줄만 안 그려집니다).`,
    'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
}
/*
 * 선택 옵션은 **차량 정보 구역 안, 차명 줄 바로 다음**이다(사장님 2026-09-05
 * 「차명 밑에 선택 옵션을 넣으라는 거는 그 **차량 정보 섹션** 차명 들어가고 선택 옵션 들어가는 거야.
 *  그 위에 요약표에 들어가는 그 밑에를 말하는 게 아니라」).
 * ⚠ 코덱스가 넣은 검사는 `[\s\S]*` 가 파일 전체를 먹어 **옵션이 어디 있든 통과**했다.
 *   그래서 차명 밑에 있든 차량 정보 안에 있든 빨간불이 안 떴다. 구간을 «구역 안»으로 좁혔다.
 */
{
  const vi = Math.max(
    shopDetail.indexOf('<Sec title="차량 정보"'),
    shopDetail.indexOf('<Sec id="detail-vehicle" title="차량 정보"'),
    shopDetail.indexOf('<section aria-label="차량 정보">'),
  );
  const opt = shopDetail.indexOf('aria-label="선택 옵션"');
  const model = shopDetail.indexOf('>세부모델 및 트림<');
  must(vi >= 0 && opt > vi && model > vi && opt > model,
    '선택 옵션이 차량 정보 구역 «안 · 차명 줄 다음»에 없습니다. 옵션은 그 차가 무엇인가의 일부입니다.',
    'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
}
must((shopDetail.match(/aria-label="선택 옵션"/g) || []).length === 1,
  '선택 옵션이 두 군데에 중복됐습니다. 차명 아래 한 번만 보입니다.',
  'components/shop/ShopDetail.tsx');
/*
 * 대표 요금 · 기간표 · 납부는 **한 구역(대여료)** 안이다 — 손님이 돈 이야기를 한자리에서 끝낸다.
 * ⚠ 구역 «제목»을 박지 않는다. 코덱스가 「기간별 대여료」라는 제목을 정규식에 박아 뒀는데,
 *   그러면 제목을 한 글자만 바꿔도 «구조가 깨졌다»고 잡는다. 검사는 **구조**를 본다.
 */
must(/icon=\{Coins\}[\s\S]*<table/.test(shopDetail),
  '대표 대여료와 기간표가 다른 구역으로 갈라졌습니다. 요금·기간표·납부는 「대여료」 한 구역 안입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
must(/>납부</.test(shopDetail),
  '대여료 구역에서 「납부」(분납·카드·납부 방법)가 빠졌습니다. 돈 이야기는 한 구역에서 끝냅니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
must(/title="기타 사항"|>기타 사항</.test(shopDetail),
  '「기타 사항」 구역이 사라졌습니다 — 정비·대차·긴급출동·이용 지역이 갈 데가 없어집니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * 웹 요금 칸에는 전화 버튼을 세우지 않는다 — 머리띠가 이미 연락처를 든다.
 * (사장님 2026-09-05 「담당자한테 연락하는 저 구성 때문에 되게 쌩뚱맞아」)
 * 폰 하단독의 전화는 `mobile ?` 안에 있어 이 검사에 안 걸린다.
 */
must(!/\{!mobile && telHref/.test(shopDetail),
  '웹 대여료 칸에 전화 버튼이 돌아왔습니다. 가격을 읽는 자리에 영업이 끼어듭니다 — 웹은 머리띠 연락처로 충분합니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2');
// 「대여료에 포함」은 되살리지 않는다 — 우리 상품은 «따로 붙이는» 쪽이라 그 격자가 「별도·불가·확인」만 찍었다.
// ⚠ «그려지는» 글자만 본다 — 이 파일 주석이 「대여료에 포함」을 걷은 이유를 적고 있다.
must(!/title="대여료에 포함"|>대여료에 포함</.test(shopDetail),
  '「대여료에 포함」 격자가 되살아났습니다. 우리 상품에서 그 칸은 「별도·담당자 확인·불가」만 찍습니다 — 포함이라 써 놓고 포함 안 된 칸입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
// 전기차에 배기량을 쓰지 않는다 — 전기 42대 중 9대에 엉뚱한 cc 가 붙어 있다(니로 넷은 1580).
must(/isEv \? 0 :/.test(shopDetail),
  '전기차에 배기량이 다시 뜹니다. 전기차는 배기량이 없는데 원천에 값이 붙어 있어 «거짓 숫자»가 나갑니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * ★★**한 값은 «한 자리»에만 선다**(사장님 2026-09-05 「어떤 원자가 그 해당 섹션에 들어가야 되고
 *   **중복되면 안 되지** … 어정쩡한 데에 명분 없이 들어가지 마. 꼭 있어야 될 자리에 있어야 되고」).
 * 겹쳐서 걷은 둘을 되돌아오지 못하게 잡는다.
 *   ① 대여료 밑 우대조건 뱃지 — 분납가능·무보증·만21세·경력무관이 전부 아래 제자리와 같은 말이었다.
 *      뱃지는 「있다/없다」만, 제자리는 「얼마·몇 회·몇 살까지」를 말한다. 뱃지가 덜 정확한 쪽이다.
 *   ② 요약줄의 연식·주행·배기량·연료 — 바로 아래 차량 정보와 같은 값이다. 요약줄은 차번 하나다.
 */
must(!/const badges/.test(shopDetail),
  '대여료 밑에 우대조건 뱃지가 되살아났습니다. 분납가능·무보증·만21세·경력무관은 납부·대여료·이용 조건에 «값»으로 이미 있습니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
must(/const facts = String\(p\.car_number \|\| ''\)\.trim\(\);/.test(shopDetail),
  '요약줄에 연식·주행·배기량·연료가 돌아왔습니다 — 바로 아래 차량 정보와 같은 값입니다. 요약줄은 차번 하나입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * 보험 = **한도가 메인, 면책금은 그 밑, 긴급출동이 맨 밑**(사장님 2026-09-05
 * 「보험은 한도를 메인에 하고 그 밑에 면책금에 대한 거를 써야겠다」).
 * ⚠ 한때 반대로(면책금 위) 세웠었다 — 순서가 뒤집히면 이 검사가 잡는다.
 */
{
  const cov = shopDetail.indexOf('rows={coverage}');
  const ded = shopDetail.indexOf('>면책금<');
  must(cov > 0 && ded > cov,
    '보험 순서가 뒤집혔습니다 — 「보장 한도」가 메인(위)이고 「면책금」이 그 밑입니다.',
    'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
}
/*
 * 보험 안에서 **넷은 위계가 다르다**(사장님 2026-09-05
 * 「보험료 포함 여부와 보상 한도, 긴급출동, 자차 면책금 요기가 조금씩 다 그 위계가 달라야 돼」).
 *   ① 보험료 포함 여부 — 상품 조건. 보상 한도와 «다른 영역»이라 같은 격자에 안 둔다
 *   ② 보상 한도       — 격자
 *   ③ 면책금          — 자차가 «따로» 서고 나머지 셋은 그 밑에
 *   ④ 긴급출동        — 보험이 아니다. 여백으로 떨어뜨린다
 */
/*
 * ① 보험료 포함/별도는 **구역 제목 옆**에 붙는다(사장님 2026-09-05 「보험 타이틀 옆에다가
 *   표시를 해주는 것이 직관적일 거 같애」). 값이 둘뿐이라 본문에 줄을 하나 더 쓰지 않는다.
 * ⚠ 한때 본문 큰 줄(BigRow)로 세웠었다 — 「보상 한도와 다른 영역」이라는 판단은 그대로고,
 *   자리만 제목 옆으로 옮겼다. 격자에 섞이면 이 검사가 잡는다.
 */
must(/tag=\{insuranceFee\}/.test(shopDetail),
  '보험료 포함 여부가 제목 옆에서 빠졌습니다 — 보장 내용이 아니라 상품 조건이라 제목 옆 한 낱말로 섭니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
must(!/\['보험료', S\('insurance_included'\)\]/.test(shopDetail),
  '보험료가 보상 한도 격자 «안»으로 돌아갔습니다 — 그러면 대인·대물과 같은 무게로 읽힙니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
must(/>보상 한도</.test(shopDetail) && />면책금</.test(shopDetail),
  '보험에서 「보상 한도」 또는 「면책금」 소제목이 사라졌습니다 — 둘은 성격이 달라 섞이면 안 됩니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * 자차 면책금 = **「수리비 ○○% · 최소 얼마 ~ 최대 얼마」 한 줄**이고, 정렬은 다른 면책금과 같다
 * (사장님 2026-09-05 「자차 면책금은 수리비 땡땡 프로, 최소 얼마에서 최대 얼마 표현해 줘야 되고 …
 *  **이것도 면책금이니까 우측 정렬**을 해줘야지」).
 * ⚠ 한때 자차만 왼쪽 정렬 큰 줄로 떼어 놓았다 — 그러면 넷이 «다른 종류»로 보인다.
 *   갈라야 할 것은 «정렬»이 아니라 **무게**다(`strongFirst`).
 */
must(/const ownDamageDeductible = \[/.test(shopDetail)
  && /수리비 \$\{S\('own_damage_repair_ratio'\)\}/.test(shopDetail)
  && /최소 \$\{S\('own_damage_min_deductible'\)\} ~ 최대/.test(shopDetail),
  '자차 면책금이 「수리비 ○○% · 최소 ~ 최대」 한 줄에서 갈라졌습니다 — 셋은 한 값의 세 조각입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
must(/const ownDamageDeductible = \[/.test(shopDetail),
  '자차 면책금 줄이 사라졌습니다 — 사고 나면 실제로 무는 돈이라 한 줄을 통째로 씁니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * ★2026-09-07 — 문장(「긴급출동 {roadside}」)에서 **라벨+값 한 칸**으로 바뀌었다.
 *   「보험이 아니다」는 이제 «짜임»이 아니라 «큰 여백»이 말한다(문서 §1-5 ④).
 *   그래도 **이 자리에 긴급출동이 있어야 한다**는 규격은 그대로라, 라벨과 값을 같이 본다.
 */
must(/\['긴급출동', roadside\]/.test(shopDetail),
  '보험 맨 밑 「긴급출동」이 사라졌습니다 — 사고가 아니라 고장일 때 부르는 것이라 여기가 제자리입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * **심사는 셋(무심사·소득확인·신용조회)이고, 화면에 «한 자리»만 쓴다.**
 * 계속 띄우되(사장님 「심사 조건은 계속 띄워요」) 두 번 쓰지 않는다(「중복되면 안 되지」).
 * 자리는 차명 밑 조건 칩 — 손님이 제일 먼저 재는 값이라 위에 있어야 한다.
 * ⚠ 무심사만 초록(`good`)이고 나머지 둘은 «해야 할 일»(`ask`)이라 흐리다.
 * ★그림은 **값마다 다르다**(`markIconFor` — 방패/서류/조회). 셋이 같은 방패였을 때는
 *   글자를 읽어야만 구분됐다(사장님 2026-09-06 「아이콘이 다 똑같은데 다 다르게 해줘야 돼」).
 */
must(/text: creditChip, icon: markIconFor\(creditChip\),/.test(shopDetail)
  && /good: \/무심사\/\.test\(creditChip\), ask: !\/무심사\/\.test\(creditChip\)/.test(shopDetail)
  && !/\['심사', credit\]/.test(shopDetail),
  '심사가 사라졌거나 다시 두 자리(조건 칩 + 이용 조건)에 실렸습니다 — 셋 중 하나를 칩 한 자리에만 씁니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
must(/'screening_criteria'/.test(read('lib/domain/public-catalog.ts')),
  '손님 화이트리스트에서 screening_criteria 가 빠졌습니다 — 값이 안 오면 화면에 심사가 안 뜹니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
// 웹은 구역마다 「제목 왼쪽 기둥 | 값 오른쪽」으로 편다 — 폰은 그대로 쌓는다.
must(/gridTemplateColumns: '200px minmax\(0, 1fr\)'/.test(shopDetail),
  '웹의 구역 제목 기둥이 사라졌습니다 — 웹이 다시 «폰을 늘려 놓은» 꼴이 됩니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1');
/*
 * 보험에서 「없음」은 «값»이다 — 면책금 없음 = 내 돈이 안 나간다 · 보장 없음 = 보상이 안 된다.
 * 둘 다 확정된 사실이라 `meaningful`(없음을 지운다)로 거르면 정보를 없앤다.
 */
must(/const insRows = /.test(shopDetail) && /const coverage = insRows\(/.test(shopDetail)
  && /insMeaningful/.test(shopDetail),
  '보험이 다시 「없음」을 지우는 필터를 씁니다 — 면책금 없음·보장 없음은 손님이 알아야 할 확정된 사실입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * 면책금은 **두 줄**이다 — 자차 한 줄, 나머지 한 줄(사장님 2026-09-05
 * 「기타 면책금이라고 하긴 좀 그렇고 … 면책금을 면책금이라고 해 놓고, 있는 면책금은 그냥
 *  「대인 얼마 대물 얼마」, 없는 거는 쓰지 말고. **자차는 다가 한 줄로 좀 길게**」).
 * ⚠ 소제목이 이미 「면책금」이라 줄에서는 **이름만** 쓴다 — 「대인 면책금」처럼 낱말을 또 붙이지 않는다.
 */
/*
 * ★2026-09-07 — 나머지 넷이 «통 문장 한 줄»에서 **보상 한도와 같은 격자**로 바뀌었다(문서 §1-5).
 *   지켜야 하는 것은 그대로다 — ㉠ 네 이름이 다 있고 ㉡ 있는 것만 나오고(`insRows`)
 *   ㉢ 자차는 여전히 제 한 줄. 바뀐 것은 낱말이 아니라 짜임이라, 검사도 «짜임»만 옮겨 본다.
 */
must(/const otherDeductibles: FactRow\[\] = insRows\(\[/.test(shopDetail)
  && /\['대인', S\('injury_deductible'\)\]/.test(shopDetail)
  && /\['대물', S\('property_deductible'\)\]/.test(shopDetail)
  && /\['자손', S\('self_body_deductible'\)\]/.test(shopDetail)
  && /\['무보험', S\('uninsured_deductible'\)\]/.test(shopDetail)
  && /rows=\{otherDeductibles\}/.test(shopDetail),
  '면책금 넷(대인·대물·자손·무보험)이 빠졌거나 보상 한도와 다른 짜임으로 돌아갔습니다 — 같은 격자에 세웁니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
must(!/'자차 면책금'|'대인 면책금'|'기타 면책금'/.test(shopDetail),
  '면책금 줄에 「…면책금」 라벨이 돌아왔습니다 — 소제목이 이미 「면책금」이라 낱말이 두 번 나옵니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * 보험에서 「없음」은 «값»이다 — 면책금 없음 = 내 돈이 안 나간다 · 보장 없음 = 보상이 안 된다.
 * 둘 다 확정된 사실이라 `meaningful`(없음을 지운다)로 거르면 정보를 없앤다.
 */
must(/const insRows = /.test(shopDetail) && /const coverage = insRows\(/.test(shopDetail)
  && /insMeaningful/.test(shopDetail),
  '보험이 다시 「없음」을 지우는 필터를 씁니다 — 면책금 없음·보장 없음은 손님이 알아야 할 확정된 사실입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * 약정 주행의 가산액은 **「1만km 추가 시」**다 — 「초과」가 아니다(사장님 2026-09-05
 * 「연간 약정 주행거리는 **1만km 추가 시 10만원**이야. 그 표현을 명확하게 해줘야 돼」).
 * ⚠ 「초과」는 «약정을 넘겨서 무는 벌칙»으로 읽힌다. 실제로는 «약정을 미리 올릴 때의 가산액»이고
 *   정책 정본도 「1만km 상향 요금」이라 적어 두었다(필드 이름부터 `upcharge`).
 */
must(/1만km당 ↑\$\{S\('mileage_upcharge_per_10000km'\)\}/.test(shopDetail)
  && /\['최대 주행', S\('max_annual_mileage'\)\]/.test(shopDetail),
  '약정 주행이 「1만km당 ↑금액」이 아니거나 「최대 주행」이 빠졌습니다 — 1만km씩 되풀이해 올릴 수 있고, 어디까지 올릴 수 있는지도 말해야 합니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * 연령 낮추기 = **「낮추는 나이 ↑얹히는 돈」**, 못 낮추면 **「불가」**(사장님 2026-09-05
 * 「연령 낮추기는 **21세, 23세가 있으니까**, 아예 불가하면 그냥 **「연령 낮추기 불가」**.
 *  그리고 21세에 23세, 거기다가 **플러스 얼마**」).
 * ⚠ 낮추는 나이가 차마다 다르다 — 목표 나이를 빼고 값만 쓰면 «몇 살까지» 내려가는지가 사라진다.
 * ⚠ 「불가」도 확정된 사실이라 줄을 지우지 않는다.
 */
must(/\/불가\/\.test\(raw\) \? '불가' : ''/.test(shopDetail)
  && /\$\{age\(lowered\)\} ↑\$\{cost\}/.test(shopDetail),
  '연령 낮추기가 「나이 ↑금액」이 아니거나 「불가」를 안 씁니다 — 낮추는 나이는 차마다 다르고, 불가도 확정된 사실입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
/*
 * 웹은 **사진 옆에 썸네일 줄**, **기간표 옆에 납부**를 세워 오른쪽 공백을 메운다(2026-09-05).
 * ⚠ 사진 높이를 520 에서 끊자 4:3 때문에 폭이 693 으로 줄어 **오른쪽 427px 가 통째로 비었다.**
 *   기간표(520)도 내용 칸(832) 안에서 오른쪽 310 을 비웠다. 둘 다 «덜 만든 화면»으로 보였다.
 */
must(/const thumbs = !mobile && n > 1 \?/.test(shopDetail)
  && /번째 사진 보기/.test(shopDetail),
  '웹 사진 옆 썸네일 줄이 사라졌습니다 — 사진이 왼쪽에 떠 오른쪽이 통째로 빕니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1');
/*
 * 웹에서는 기간표 «오른쪽»에 납부가 선다. 다만 좁은 웹(760~900)에서는 아래로 내려간다 —
 * 폭을 못 박아 두었더니 칸 밖으로 넘쳤다(코덱스 2026-09-05 · 820px 실측).
 * ⇒ 가로 배치 + 줄바꿈 + 납부의 «최소폭»(이게 없으면 줄바꿈 대신 65px 로 찌그러진다) 셋이 다 있어야 한다.
 */
must(/display: mobile \? 'block' : 'flex', flexWrap: 'wrap',/.test(shopDetail)
  && /flex: '1 1 300px', minWidth: 260/.test(shopDetail),
  '웹에서 기간표와 납부가 다시 세로로 쌓였거나, 좁은 웹에서 납부 칸이 찌그러집니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1');
/*
 * 차명 밑 «표시 칩» — 출고상태 · 상품구분 · 심사 · 우대조건. **아이콘 + 글자**이고 테두리가 없다.
 * ⚠ 출고상태·상품구분은 한때 상세에 아예 없었다 — 목록 카드는 보여 주는데 상세에서 사라졌다.
 */
/* ⚠ 2026-09-08 — 상품구분은 «캐논 한 번»을 거쳐 읽는다(`canonProductType`). 카드는 원자를 그대로
     찍고 필터는 캐논을 보던 탓에 같은 차가 「오플구독」/「중고구독」 두 답을 냈다. 원자를 안 읽는
     것이 아니라 «같은 함수로» 읽는 것이라 이 검사의 뜻은 그대로다. */
must(/const stateMarks: Mark\[\]/.test(shopDetail) && /const perkMarks: Mark\[\]/.test(shopDetail)
  && /S2\(p\.vehicle_status\)/.test(shopDetail) && /canonProductType\(p\.product_type\)/.test(shopDetail),
  '표시 칩이 사라졌거나 신원(출고상태·구분)과 조건(심사·우대)이 다시 한 덩어리가 됐습니다 — 신원은 차명 줄 오른쪽, 조건은 그 밑입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1');
/*
 * 폰에는 «위 실행줄»이 없다 — 관심·공유는 **머리띠 오른쪽**이 받고, 그 머리띠는 폰에서 고정이다.
 * ⚠ 되돌아가면 ㉠ 상세 맨 위에 짝 없는 빈 줄이 다시 생기거나 ㉡ 스크롤 한 번에 공유가 사라진다.
 *   공유는 이 사업의 퍼널이라 ㉡ 는 화면이 깨지는 것보다 조용하고 더 비싸다.
 */
/*
 * **관련 있는 것끼리 뭉쳐 놓는다**(사장님 2026-09-05). 순서가 흐트러지면 화면은 멀쩡해 보이는데
 * 손님이 눈으로 값을 다시 맞춰야 한다 — 연식과 주행거리가 갈리면 「2022년식」과 「12만km」가
 * 서로 다른 이야기가 된다.
 *   차량 정보 ㉠연식·주행거리 ㉡배기량/배터리·연료·구동방식 ㉢색·인승 ㉣신차가
 *   이용 조건 ㉠나이 셋 ㉡심사·면허·범위·추가운전자 ㉢주행 둘
 */
const at = (needle: string) => shopDetail.indexOf(needle);
/*
 * **사람이 차를 보는 차례** — 이름(제조사·세부모델·세부트림) → **선택 옵션** → **색상·연식·주행거리**
 * (사장님 2026-09-05 「사람들이 차를 볼 때 «아 이게 어느 트림이고, 옵션이 뭐고, 아 색상이
 *  뭐구나» 이렇게 들어간단 말이야」).
 * ★옵션은 격자 칸이 아니라 **한 줄을 통째로** 쓴다(사장님 2026-09-07 「선택옵션 줄을 한 줄 다 쓰는 거고」).
 * ★★그 다음 줄이 **색상 · 연식 · 주행거리**다(같은 날 「그다음엔 색상 연식 주행거리를 배정하자고」) —
 *   색상이 제 줄을 통째로 쓰던 것을 격자 «첫 칸»으로 옮겼다. 웹 1400 에서 오른쪽 660px 이 비었었다.
 */
must(at('>제조사 · 세부모델 · 세부트림<') < at('aria-label="선택 옵션"')
  && at('aria-label="선택 옵션"') < at('<Facts rows={specs}')
  /* 격자 첫 무리가 «색상 → 연식 → 주행거리» 차례여야 한다. */
  && at("['색상', colorText,") < at("['연식', yearFullDisplay(p.year)]")
  && at("['연식', yearFullDisplay(p.year)]") < at("['주행거리',"),
  '차량 정보의 차례가 흩어졌습니다 — 이름 → 선택 옵션 → (색상·연식·주행거리) 순입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2-2');
must(/function grouped\(/.test(shopDetail) && /const specs: FactRow\[\] = grouped\(/.test(shopDetail)
  && at("['차급'") < at("['연식'")          // 차급은 «겉과 이력» 무리의 둘째(4/4 를 맞추는 자리)
  && at("['연식'") < at("? '배터리' : '배기량'")
  && at("['주행거리'") < at("['연료'")
  && at("['구동방식'") < at("['승차정원'")
  && at("['승차정원'") < at("['차량 가격'")
  /*
   * ★★**웹은 «고정 격자»다 — 지금은 4분할**(사장님 2026-09-08 「최초등록을 빼 기타사항으로
   *   보내고 차급을 넣어야겠네. **그럼 4개 4개**니까」).
   * ★★**숫자가 규격이 아니라 「무리와 칸 수를 맞춘다」가 규격이다.**
   *   09-07 에 「3분할」로 정한 것은 그때 무리가 셋(색상·연식·주행거리)이었기 때문이고,
   *   09-08 에 무리가 넷(색상·차급·연식·주행거리 / 배기량·연료·구동방식·승차정원)이 되어 넷이 됐다.
   * ⚠ 3분할일 때 실측 — 두 무리가 3+1 · 3+2 로 갈려 **혼자 남은 칸이 두 줄**이었다.
   *   그러면 격자가 «표»로 안 읽히고 흘리다 만 것으로 보인다.
   * ⚠⚠ 09-05 에는 정반대로 정했었다 — 「웹은 «띠»로 흐른다」. 그때 근거도 실측이었다.
   *   ⇒ 고정 격자는 빈자리를 «감수»하는 선택이다. 사장님이 «맞은 세로줄»을 더 친다고 판단하셨다.
   *     되돌리려면 먼저 여쭙는다.
   * ★무리 수가 또 바뀌면 **칸 수도 같이 바꾼다** — 이 검사도 그때 같이 고친다.
   */
  && /gridTemplateColumns: 'repeat\(4, minmax\(0, 1fr\)\)'/.test(shopDetail)
  && /if \(mobile\) \{[\s\S]{0,160}?display: 'grid'/.test(shopDetail),
  '차량 정보의 차례가 흐트러졌거나, 웹 격자가 4분할이 아닙니다 — 색상·차급·연식·주행 / 동력 넷 / 신차가.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2-3');
must(/const useRows = grouped\(/.test(shopDetail)
  && at("['기본 운전 연령'") < at("['연령 낮추기'")
  && at("['연령 낮추기'") < at("['면허'")
  && at("['추가 운전자'") < at("['약정 주행'"),
  '이용 조건의 무리가 흐트러졌습니다 — 나이 셋 / 심사·면허·범위·추가운전자 / 주행 둘 차례입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2-3');

const wlFrame = read('components/WhitelabelFrame.tsx');
const brandCi = read('components/brand-ci.tsx');
/** 채널 표 — 라벨 세 갈래(표준·채널·공급)의 이름이 여기 산다(`labelKind`). */
const wlTable = read('lib/whitelabel.ts');
/*
 * 폰 상세 머리띠는 «채널 간판»이 아니라 「상품 상세」다 — 손님은 이미 그 가게 안이다.
 * 그리고 차번은 «차명 뒤»에 붙는다 — 제 줄을 하나 차지하지도, 머리띠로 올라가지도 않는다.
 */
must(/mobile && headerLead \? headerLead :/.test(wlFrame)
  && /headerLead=\{<ShopDetailLead \/>\}/.test(read('app/q/[code]/ShopDetailView.tsx'))
  && />상품 상세</.test(shopDetail),
  '폰 상세 머리띠가 다시 채널 간판을 들었습니다 — 상세는 「상품 상세」입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2-1');

/*
 * 상단바 타이포는 웹/모바일에서 같은 서비스 위계를 유지한다.
 * 화면 폭에 따라 여백·아이콘 크기는 달라도 제목 글자 크기는 달라지지 않는다.
 */
must(/top: \{ title: 18, cobrand: 12 \}/.test(shopUi)
  && /fs=\{SHOP\.top\.title\}/.test(wlFrame)
  && /headlineFs=\{SHOP\.top\.title\}/.test(wlFrame)
  && /CoBrandFreepass fs=\{SHOP\.top\.cobrand\}/.test(wlFrame)
  && /fontSize: SHOP\.top\.title, fontWeight: FW\.title, color: C\.ink, letterSpacing: '-0\.02em', lineHeight: 1/.test(shopDetail)
  && /headlineFs\?: number/.test(brandCi),
  '목록과 상세의 상단 헤더 규격이 갈렸습니다 — 제목 크기·굵기·자간·줄높이를 동일하게 씁니다.',
  'docs/ERP4-MAIN-UI-STANDARD.md §4');
/* 차번은 차명 줄 «안»에 있다 — h1 이 닫히기 전에 나와야 이름의 끝으로 읽힌다. */
must(/\{title\}[\s\S]{0,400}?\{facts \? \([\s\S]{0,400}?<\/h1>/.test(shopDetail),
  '차번이 차명에서 떨어졌습니다 — 「현대 그랜저 122두8108」처럼 이름 뒤에 붙습니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2-1');

must(/const bar = mobile \? null :/.test(shopDetail)
  && /headerActions=\{<FavShare/.test(read('app/q/[code]/ShopDetailView.tsx'))
  && /\{mobile \? headerActions : null\}/.test(wlFrame)
  /* ⚠ 2026-09-07 — 머리띠는 이제 «웹에서도» 붙박이다(사장님 「웹페이지 틀고정 … 상세페이지도」).
       그래서 조건이 `mobile && headerActions` 가 아니라 «언제나»다. 묻는 것은 그대로 —
       머리띠가 붙박여 있어야 스크롤해도 공유·전화가 손에 남는다. */
  && /position: 'sticky' as const, top: 0, zIndex: 15,/.test(wlFrame),
  '폰의 관심·공유가 머리띠를 떠났거나 머리띠 고정이 풀렸습니다 — 스크롤하면 공유가 사라집니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2');

/*
 * 신원 칩과 조건 칩은 «얼굴»도 달라야 한다 — 자리만 갈라 놓으면 여전히 한 종류로 보인다.
 * 신원 = 연한 «면» 위 작은 흐린 글자(딱지) · 조건 = 면 «없이» 아이콘 + 진한 글자.
 */
const stateChipSrc = (shopUi.split('export function StateChip')[1] ?? '').split('export function PerkMark')[0];
const perkMarkSrc = (shopUi.split('export function PerkMark(')[1] ?? '').slice(0, 700);
must(stateChipSrc.includes('background') && !perkMarkSrc.includes('background'),
  '신원 칩과 조건 칩이 다시 같은 얼굴이 됐습니다 — 신원은 연한 면 위 딱지, 조건은 면 없이 아이콘+진한 글자입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1');
/*
 * **카드의 신원 칩은 «사진 우하»이고, 차번은 «차명 뒤»다**(사장님 2026-09-05).
 * 업무동 카드와 같은 자리·같은 처리(.fp-onphoto/.fp-signal-chip)라 두 목록이 한 짜임으로 읽힌다.
 */
must(/className="fp-onphoto"/.test(shopCard) && /className="fp-signal-chip"/.test(shopCard)
  /* ⚠ 뒤에 붙는 속성까지 «글자 그대로» 재지 않는다 — 이 검사가 지키는 것은 «칩이 사진 우하에
       선다»는 자리다. 2026-09-08 에 성능용 `rank` 를 하나 더 넘겼더니, 자리는 그대로인데
       검사가 깨졌다. 그때 규격을 고친 것이 아니라 «자»가 너무 좁았던 것이다. */
  && /<ShopThumb p=\{p\} marks=\{stateMarks\}/.test(shopCard)
  && /\{title\}[\s\S]{0,300}?\{plate \? \(/.test(shopCard),
  '카드의 신원 칩이 사진 우하를 떠났거나 차번이 차명에서 떨어졌습니다 — 상세·업무동과 같은 짜임입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2-3-2');

/*
 * **폰 규격 — 글자 사다리가 «한 곳»에서 한 단 올라간다.**
 * 사장님 2026-09-05 「모바일 버전은 전체 텍스트하고 움직임하고 … 통상 모바일 규격이 있을 거 아니니」.
 * ⚠ 되돌아가면 폰 본문이 다시 13px 이 된다 — 실측 438개 글자 중 259개가 그 크기였다.
 */
must(/--shop-fs-body: 15px/.test(css) && /@media \(max-width: 599px\)/.test(css)
  && /body: 'var\(--shop-fs-body\)'/.test(shopUi)
  /*
   * ★★**글자는 사다리 «한 곳»에서만 온다**(사장님 2026-09-06 「규격만 통일돼서 움직일 수 있으면 돼.
   *   **공통 규격으로 쓸 수 있게끔**」). 이름 열하나가 폰·웹 두 값을 CSS 변수로 쥔다.
   * ⚠⚠ **손님 동은 업무동 토큰(`FS.*`)을 쓰지 않는다.** 그게 폰 화면에 14.5·13·12·11 을 만들어
   *   글자 크기를 **12가지**로 벌려 놓은 출처였다. 업무동은 콕핏 규격(본문 12~13)이라 그 값이
   *   섞이면 **폰 사다리를 올려도 그 글자만 안 따라온다** — 2026-09-05 에 한 번 겪은 사고다.
   * ★예외 둘만 사다리 밖 — 워드마크(브랜드 타이포)와 검색 «입력칸» 폰 16 고정(iOS 확대 방지).
   */
  && /--shop-fs-price: 19px/.test(css) && /price: 'var\(--shop-fs-price\)'/.test(shopUi)
  && /--shop-fs-tag/.test(css) && /--shop-fs-hero/.test(css)
  && !/FS\.[a-z]/.test(shopUi) && !/FS\.[a-z]/.test(shopCard)
  && !/FS\.[a-z]/.test(shopDetail) && !/FS\.[a-z]/.test(wlFrame),
  '손님 동 글자가 사다리를 벗어났습니다 — 업무동 토큰(FS.*)을 섞었거나 숫자를 화면에 박았습니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-3');

/*
 * **조건 목록 — 건수는 «제 라벨»에 붙는다. 폰 시트는 한 열이다.**
 *
 * 사장님 2026-09-06 「필터 **연식이 두 줄로 돼 있어가지고 좀 짤리는 게** 있고」.
 * ⚠ 실측 — 잘린 글자는 없었다. 두 열에서 건수를 칸 «오른쪽 끝»에 세우니
 *   `2026 … 128 │ 2025 … 75` 에서 **128 이 제 라벨과 40px, 옆 칸 라벨과 12px** 였다.
 *   숫자가 엉뚱한 이름에 묶여 읽히는 것이 「짤린다」의 정체다.
 * ⇒ ㉠ 폰 시트는 **전부 한 열**(연식 예외를 걷었다) ㉡ 두 열로 서는 웹 축은 **건수를 라벨 뒤에 붙인다.**
 * ★한 열일 때는 반대다 — 오른쪽 끝에 세워야 숫자가 세로로 맞아 훑기 좋다.
 */
must(/tight=\{columns > 1\}/.test(read('components/shop/ShopFilters.tsx'))
  && /flex: tight \? '0 1 auto' : 1/.test(read('components/shop/ShopFilters.tsx'))
  && /mobile columns=\{1\}/.test(read('components/shop/ShopFilterSheet.tsx')),
  '조건 건수가 다시 옆 칸 라벨에 붙어 읽힙니다 — 폰 시트는 한 열, 두 열은 건수를 라벨 뒤에 붙입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-3');

/*
 * **카드는 디자인을 유지하고, 넓은 웹에서만 밀도를 한 단계 올린다.**
 *
 * 카드 내부 넉 줄은 8 균등을 유지한다. 모바일은 1열/24px 세로 간격으로 한 단계 조밀화한다.
 * 모바일 카드 타이포는 차명 15 · 대여료 18 · 보조정보 13 · 캡션 12, 컨트롤은 44다.
 * 웹은 600~759px 1열, 760~1023px 2열, 1024~1279px 3열, 1280px 이상 4열이며
 * 카드끼리 가로 16·세로 24를 쓴다. 600px 미만에서만 모바일 전용 흐름으로 바뀐다.
 * 넓은 웹 카드 타이포는 차명 14 · 대여료 18 · 보조정보 12.5 · 캡션 11.5다.
 */
must(/fontSize: SHOP\.fs\.price, fontWeight: FW\.head/.test(shopCard)
  && /className="fp-shop-grid"/.test(shopView)
  && /export const SHOP_MOBILE_BP = 600/.test(shopUi)
  && /\.fp-shop-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?row-gap:\s*24px[\s\S]*?column-gap:\s*16px/.test(css)
  && /@media \(min-width: 760px\)[\s\S]*?\.fp-shop-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(css)
  && /@media \(min-width: 1024px\)[\s\S]*?\.fp-shop-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/.test(css)
  && /@media \(min-width: 1280px\)[\s\S]*?\.fp-shop-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)[\s\S]*?--shop-fs-price:\s*18px[\s\S]*?--shop-fs-h2:\s*14px[\s\S]*?--shop-fs-sub:\s*12\.5px[\s\S]*?--shop-fs-cap:\s*11\.5px/.test(css)
  && /@media \(max-width: 599px\)[\s\S]*?\.fp-shop-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?row-gap:\s*24px[\s\S]*?column-gap:\s*12px/.test(css)
  && /h: \{ web: 44, mobile: 44 \}/.test(shopUi)
  && /@media \(max-width: 599px\)[\s\S]*?--shop-fs-price:\s*18px[\s\S]*?--shop-fs-h2:\s*15px[\s\S]*?--shop-fs-body:\s*15px[\s\S]*?--shop-fs-sub:\s*13px[\s\S]*?--shop-fs-cap:\s*12px/.test(css)
  /* 넉 줄은 8 균등 — 위계는 글자 크기가 낸다. */
  && /gap: SHOP\.sp\.snug, minWidth: 0, flex: 1/.test(shopCard)
  && !/marginTop: 'auto', paddingTop/.test(shopCard),
  'ERP4 MAIN 카드 밀도 규격이 어긋났습니다 — 600 미만 모바일, 웹 1→2→3→4열입니다.',
  'docs/ERP4-MAIN-UI-STANDARD.md §4');

/*
 * **우대조건 줄 — 옅은 «면» 위 뱃지 · 아이콘은 값마다 다르다.**
 *
 * 사장님 2026-09-06 ① 「심사 조건, 만21세 요쪽 라인들, 그 **살짝 배경 있는 그 배지** 그거를
 * 해줘야지. 그 이렇게 **테두리는 아니고 배경**」 ② 「분납가능 이런 거 **아이콘이 다 똑같은데
 * 다 다르게** 해줘야 돼」.
 * ⚠ 그림이 같으면 **글자를 읽어야만** 구분된다 — 그럴 거면 그림이 없는 것과 같다.
 * ★표(`MARK_ICON`)가 정본이다. 카드·상세가 각자 정하고 있어서 **한쪽만 고치면 갈렸다**.
 * ★면은 조건 칩(`C.head`)보다 한 단 옅다(`C.zebra`) — **누를 수 있는 것이 더 진하다.**
 */
/*
 * **뱃지는 «한 벌» 규격이다** — 사진 위 신원 칩과 본문 우대조건이 같은 치수.
 * 사장님 2026-09-06 「**배지 규격은 다 통일해** 줘야지 … 근데 뱃지가 **너무 많이 삐져나갈 필요가
 * 없다** — 거의 **텍스트를 살짝만 감쌀 정도**면 된다」.
 * ⚠ 실측 — 사진 위 `2px 6px`/아이콘11/높이20 vs 본문 `4px 8px`/아이콘13/높이27 로 갈려 있었다.
 *   한쪽을 고칠 때 다른 쪽이 안 따라와서다. ⇒ `BADGE` 한 벌이 정본이다.
 * ★사진 위 칩만 «유리 바탕 + 흰 실선»을 더 갖는다 — 치수가 아니라 «바탕»의 차이다(사진 위에서 읽히려면 필요).
 */
/*
 * **같은 일을 하는 문을 한 화면에 둘 두지 않는다**(사장님 2026-09-06 「닫기 버튼이 있는데
 * 위쪽에 또 X 표가 있을 필요 없고 … 한 페이지에 같은 버튼이 굳이 두 개가 있을 필요가 없잖아」).
 * ⚠ 되돌아가면 «어느 것을 눌러야 하나»를 손님이 매번 한 번씩 생각한다.
 *   시트 머리 X(바닥 닫기와 중복) · 웹 기둥 「선택 초기화」(조건 줄과 중복) · 열린 검색의 돋보기(죽은 단추).
 */
/* ⚠ 2026-09-06 — 시트 하단독을 `ShopDock` 원자로 합치면서 마크업 «모양»이 바뀌었다.
   묻는 것은 그대로다: **바닥에 「닫기」가 있고 · 머리에 X(label="닫기")가 없다.** */
must(!/label="닫기"/.test(read('components/shop/ShopFilterSheet.tsx'))
  && />닫기</.test(read('components/shop/ShopFilterSheet.tsx'))
  && !/>선택 초기화</.test(read('components/shop/ShopFilters.tsx'))
  && /\{searchOpen \? null : \(/.test(shopView)
  && /onClear=\{list\.length \? onClearAll : undefined\}/.test(shopView),
  '같은 일을 하는 문이 한 화면에 둘로 늘었습니다 — 시트 X · 기둥 초기화 · 열린 검색의 돋보기.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-3');

must(/export const BADGE = \{/.test(shopUi)
  && /padY: 2,/.test(shopUi) && /padX: 6,/.test(shopUi) && /icon: 12,/.test(shopUi)
  && /padding: `\$\{BADGE\.padY\}px \$\{BADGE\.padX\}px`/.test(shopUi)
  && /<m\.icon size=\{BADGE\.icon\}/.test(shopCard)
  /*
   * ⚠ 2026-09-06 — `StateChip`(신원 딱지)만 이 한 벌을 «안» 따르고 있었다(`5px 10px`·아이콘 13).
   *   그래서 상세 머리에서 신원 29 · 조건 18 로 **두 줄의 딱지 높이가 달랐다.**
   *   머리말에는 「둘이 같은 치수」라고 적혀 있었는데 글만 그랬다 — 이제 자가 잡는다
   *   (사장님 2026-09-06 「같은 원자·같은 항목이면 그것끼리도 높이나 이런 게 같아야지」).
   */
  /* 신원 딱지·조건 칩 «둘 다» 이 한 벌을 쓴다 — 한 곳이라도 제 치수를 쓰면 높이가 갈린다. */
  && (shopUi.match(/padding: `\$\{BADGE\.padY\}px \$\{BADGE\.padX\}px`/g) || []).length >= 2
  && (shopUi.match(/lineHeight: BADGE\.lineHeight/g) || []).length >= 2
  && !/padding: '5px 10px'/.test(shopUi)
  && /<Icon size=\{BADGE\.icon\} aria-hidden \/>\{mark\.text\}/.test(shopUi)
  && !/<PerkMarks marks=\{marks\} fs=/.test(shopCard),
  '뱃지 규격이 다시 두 벌로 갈렸습니다 — 신원 딱지·사진 위 칩·본문 우대조건은 같은 치수(BADGE)입니다.',
  'components/shop/shop-ui.tsx BADGE');

must(/export function markIconFor/.test(shopUi)
  && /무심사: ShieldCheck/.test(shopUi) && /분납가능: Coins/.test(shopUi)
  && /만21세: UserRound/.test(shopUi) && /경력무관: IdCard/.test(shopUi)
  && /background: (?:C\.zebra|highlighted \? C\.brandSoft : C\.zebra), padding: `\$\{BADGE\.padY\}px \$\{BADGE\.padX\}px`/.test(shopUi)
  && /icon: markIconFor\(k\)/.test(shopCard) && /icon: markIconFor\(k\)/.test(shopDetail),
  '우대조건 뱃지의 면이 사라졌거나 아이콘이 다시 한 그림으로 돌아갔습니다.',
  'components/shop/shop-ui.tsx MARK_ICON · PerkMark');

/*
 * **여백은 «사다리»에서만 고른다** — 4·8·12·16·24·32 여섯 칸(`SHOP.sp`).
 *
 * 사장님 2026-09-05 「**간격이랑 이런 거도 좀 짜임새 있게** 맞춰보자고」.
 * ⚠ 실측 — 가게 다섯 파일에 여백이 **열아홉 가지**(3·4·5·6·7·8·9·10·11·12·13·14·18·20·22·26·28·30·34)
 *   섞여 있었다. 9 와 10 은 눈에 같은 간격이라, 「붙은 것/떨어진 것」이 우연히 갈렸다.
 * ★되돌아가면 여백이 다시 뜻을 잃는다 — 고칠 때마다 한두 픽셀씩 다르게 찍히기 때문이다.
 */
must(/sp: \{ tight: 4, snug: 8, cozy: 12, edge: 16, part: 24, pane: 32, wide: 48 \}/.test(shopUi)
  && /gap: SHOP\.sp\.pane/.test(shopView)
  && /paddingBlock: SHOP\.sp\.cozy/.test(shopView)
  && !/SHOP\.gap/.test(shopView)
  /* 목록만 사다리를 타면 상세로 넘어갈 때 다시 어긋난다 — 가게 넉 화면이 같이 탄다. */
  && /SHOP\.sp\./.test(shopCard) && /SHOP\.sp\./.test(shopDetail)
  && /SHOP\.sp\./.test(read('components/shop/ShopFilterSheet.tsx'))
  && /SHOP\.sp\./.test(read('components/shop/ShopFilters.tsx')),
  '가게 여백 사다리(SHOP.sp)가 사라졌거나 손으로 찍은 숫자로 되돌아갔습니다.',
  'components/shop/shop-ui.tsx SHOP.sp');

/*
 * **ERP 도메인에서 손님 화면이 «프리패스»로 떨어지지 않는다.**
 *
 * 사장님 2026-09-06 「프리패스 erp 점 컴에서 **원래 상세 페이지가 조회되거나 그러면 안 되는데**」.
 * ⚠ 실측 — `www.freepasserp.com/q/<토큰>` 에서 **`?wl=` 꼬리표만 떼면** 프리패스 「상품 안내」가 떴고,
 *   `/shop` 은 재고 전체를 프리패스 껍데기로 공개했으며, `/uniauto` 는 겉만 유니오토이고
 *   **소스에 `프리패스모빌리티 주식회사`** 가 실려 나갔다. 손님이 주소창에서 지울 수 있는 값이
 *   브랜드를 정하고 있었던 것이다(카톡 미리보기 봇은 애초에 꼬리표 없는 주소를 긁는다).
 * ★뿌리는 **채널 도메인이 아직 안 붙은 것**이다. 그래서 「호스트가 정본, 못 찾으면 임시 채널」로 두었다 —
 *   도메인을 붙이면 호스트가 이겨서 이 폴백은 안 탄다(코드 재수정 없음).
 * ⚠ 업무동(`/login`·`/inventory`)은 **예전 그대로**여야 한다 — 콕핏은 우리 화면이다.
 */
/*
 * ⚠ 2026-09-06 — 채널마다 있던 라우트 파일(`app/(shop)/uniauto/page.tsx`)을 **걷었다.**
 *   채널 하나 더 파는 일이 「표에 한 줄」이어야 해서(사장님 「홍길동 영업채널 걸로 하나 파줘,
 *   그럼 바로 파줘야 되는 거야」), 임시 주소는 **미들웨어가 `/shop` 으로 다시 쓴다.**
 *   묻는 것은 그대로다 — **ERP 도메인의 손님 화면이 노브랜드로 안 떨어진다.**
 *   오히려 한 줄 더 묻는다: 껍데기 판정(`guest-surface`)이 **채널 표를 읽는가** —
 *   여기서 표를 안 보면 새 채널 화면 위에만 업무동 남색 상단바가 얹힌다.
 */
must(/export function resolveGuestWhitelabel/.test(read('lib/whitelabel.ts'))
  && /export function isGuestPath/.test(read('lib/guest-surface.ts'))
  && /WHITELABELS/.test(read('lib/guest-surface.ts'))
  && /resolveGuestWhitelabel\(\(await headers\(\)\)\.get\('host'\), one\(sp\.wl\)\)/.test(read('app/q/[code]/page.tsx'))
  && /resolveGuestWhitelabel\(\(await headers\(\)\)\.get\('host'\), one\(sp\.wl\)\)/.test(read('app/(shop)/shop/page.tsx'))
  && /isGuestPath\(request\.nextUrl\.pathname\)/.test(read('middleware.ts'))
  && /x-fp-guest/.test(read('app/layout.tsx'))
  /* 채널 임시 주소 → `/shop` 다시쓰기 + 손님 표시. 이 셋이 한 덩어리다. */
  && /w\.sitePath && request\.nextUrl\.pathname === w\.sitePath/.test(read('middleware.ts'))
  && /target\.searchParams\.set\('wl', channel\.key\)/.test(read('middleware.ts')),
  'ERP 도메인의 손님 화면이 다시 노브랜드(프리패스)로 떨어집니다 — 상세·목록·소스에 우리 이름이 샙니다.',
  'lib/whitelabel.ts resolveGuestWhitelabel');

/*
 * **폰 검색 = 머리띠 돋보기 → «퀵필터 칩 줄 위»로 나온다.** 목록 위에 상시로 깔지 않는다.
 *
 * 사장님 2026-09-05 「유튜브 모바일 **우측 상단에 돋보기를 누르면** 우리 원래 있던 그 **퀵필터 칩**
 * 있잖아. **그 위에 검색창이 나온다고. 거기서 검색을 하는 거**라고」
 * · 「유니오토모빌 **CI 가 좌측에 타이트하게** 잘 붙게끔」.
 * ⚠ 머리띠를 «통째로» 검색줄로 갈아입히지 않는다 — 거기는 간판(CI)의 자리다. 처음에 그렇게
 *   만들었다가 바로 잡혔다(2026-09-05). 돋보기는 «부르는 단추»고 칸은 본문에 선다.
 * ⚠ 되돌아가 상시 노출이 되면 폰 첫 화면이 검색줄에 60px + 여백을 다시 내준다 —
 *   손님이 여기 오는 이유는 「차를 본다」이지 「검색한다」가 아니다.
 * ★검색어가 있으면 **접히지 않는다**(`searchOn || !!typed.trim()`) — 접히면 목록이 왜 줄었는지
 *   화면이 말해 주지 않는다.
 */
must(/: searchOpen \? \(\s*<ShopRevealSearch/.test(shopView)
  && /searchOn \|\| !!typed\.trim\(\)/.test(shopView)
  && /\{!mobile \? \(\s*<ShopSearch/.test(shopView)
  && !/headerOverlay/.test(wlFrame)
  && /padding: mobile \? '0 4px 0 12px'/.test(wlFrame),
  '폰 검색이 상시 검색줄로 돌아왔거나, 머리띠를 통째로 덮었거나, CI 가 좌측에서 떨어졌습니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-3');

/*
 * **가게의 «비주요» 누름은 선이 아니라 «면»이다** — 조건 칩·정렬·더 보기·공유·하단독 이전.
 *
 * 사장님 2026-09-05 「유튜브 보니까 퀵필터가 약간 **회색 배경에 텍스트**가 들어갔는데 우리도
 * 그렇게 할까? **박스로 가두는 거는 조금 촌스러워** 보이고」.
 * ⚠ 되돌아가면 한 줄에 칩이 예닐곱 서면서 **가는 테두리가 그만큼 그어져** 목록보다 칩이 시끄러워진다.
 *   켜짐/꺼짐도 「선 색 + 면」 두 축으로 갈려 무엇이 켜진 것인지 한눈에 안 읽힌다.
 */
must(/background: on \? C\.brand : C\.head/.test(shopUi)
  && !/border: `1px solid \$\{on \? C\.brand : C\.line\}`/.test(shopUi)
  && /className="fp-shop-press fp-shop-fill"/.test(shopUi)
  && /\.fp-shop-fill:hover/.test(css),
  '가게 조건 칩이 다시 «테두리 상자»가 됐습니다 — 꺼짐은 회색 면, 켜짐은 브랜드 면입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-3');

/*
 * **누르는 «영역» ≠ 보이는 «크기»** — 폰 치수 셋(tap 44 · pill 38 · icon 40).
 *
 * 사장님 2026-09-05 「**버튼이나 칩·검색창이 좀 커 보인다**. 유튜브나 다른 데 가보니까…」 — 맞다.
 * 앞서 「모바일 통상 규격」을 듣고 **44/48 을 «보이는 높이»에 그대로 박아** 칩까지 44 로 키웠다.
 * 머티리얼 규격서의 48dp 는 «터치 대상»이고 칩의 높이는 32dp 다. 둘을 다시 붙이면 같은 사고가 난다.
 * ⚠ 되돌아가면 목록 칩·정렬·아이콘이 다시 손가락만 해져 한 화면에 드는 매물이 줄어든다.
 */
must(/tap: \{ web: 36, mobile: 44 \}/.test(shopUi)
  /* ⚠ 2026-09-07 — 칩을 두 번 내렸다. 44 → 36 → 32/36(「칩이 너무 뚱뚱한 거 같은데」) →
       **26/32**(같은 날 저녁 「칩을 얇게는 해줄 수 있지 않나」 · 「조금 더 얇아도 되지 않을까」).
       32 의 근거였던 머리띠 「전화 상담」 단추가 같은 날 사라져(「웹은 누르는 거 아니고」)
       그 값에 묶일 이유도 없어졌다. 되돌리려면 먼저 여쭙는다. */
  && /pill: \{ web: 26, mobile: 32 \}/.test(shopUi)
  && /icon: \{ web: 36, mobile: 40 \}/.test(shopUi)
  && !/height: mobile \? 4[48] :/.test(shopUi),
  '가게 컨트롤이 다시 «터치 영역» 크기로 부풀었습니다 — 폰은 줄 44 · 칩 32 · 아이콘 40 입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-3');

/*
 * **둥글기 사다리 넷** — 담는 것 12 · 누르는 것 10 · 표시 8 · 진짜 원만 999
 * (사장님 2026-09-05 「무게감 있게 격식 있게 통일감」). 알약을 컨트롤에 쓰지 않는다.
 * ⚠ 되돌아가면 이 화면에 둥글기가 규칙 없이 셋 섞인 상태로 되돌아간다.
 */
must(/r: \{ chip: 8, ctrl: 10, box: R_CARD, card: 12, pill: PILL_R \}/.test(shopUi)
  && !/borderRadius: 999/.test(shopUi) && !/borderRadius: 999/.test(shopDetail)
  && !/borderRadius: 999/.test(shopCard),
  '둥글기가 다시 알약(999)으로 돌아갔습니다 — 담는 것 12 · 누르는 것 10 · 표시 8 · 진짜 원만 999 입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §브랜드');

/*
 * **관심(하트)은 손님 화면에 없다** — 손님은 로그인이 없다(사장님 2026-09-05
 * 「손님들이 여기에 로그인을 안 할 거라서 관심을 못 찍을 거야 … 영업사원 전용 로그인이야」).
 * 담아 둔 것을 다시 꺼내 볼 «내 목록»이 없는데 담는 단추만 있었다. 공유는 남는다 — 받는 사람은
 * 남의 화면이라 로그인이 필요 없고, 그게 이 사업의 퍼널이다.
 */
must(!/aria-label=\{faved/.test(shopDetail) && !/Heart/.test(shopDetail) && !/Heart/.test(shopCard)
  && /aria-label="이 차량 공유하기"/.test(shopDetail),
  '손님 화면에 관심(하트)이 되살아났거나 공유가 사라졌습니다 — 손님은 로그인이 없어 관심을 다시 볼 곳이 없습니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-2');

/*
 * **목록 카드와 상세가 같은 칩 원자를 쓴다**(사장님 2026-09-05 「목록 페이지하고 전체 구성 한번
 * 맞춰보자 — 일체감이 있는지」). 카드만 «박스 뱃지»로 남아 같은 값이 두 화면에서 다르게 보였다.
 * 집 규칙도 그쪽이 틀렸다 — 「박스 뱃지 쓰지 말고 아이콘 텍스트로, **모든 곳에서**」(2026-08-28·30).
 */
must(/<PerkMarks marks=/.test(shopDetail) && /<PerkMarks marks=/.test(shopCard)
  && !/<Badge/.test(shopCard),
  '손님 카드가 다시 박스 뱃지를 씁니다 — 목록·상세가 같은 칩 원자(PerkMarks)를 써야 합니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1 · docs/DESIGN_CONFIRMED_LIST_CARD.md');
// 전화는 담당자 → 대표번호로 떨어진다 — ?a= 없는 손님에게 전화 링크가 0개가 되면 안 된다.
must(/wl\.tel/.test(read('app/q/[code]/ShopDetailView.tsx')),
  '상세가 대표번호 폴백을 잃었습니다. ?a= 없이 들어온 손님은 폰에서 전화 링크가 0개가 됩니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-9');

/*
 * ★★**채널마다 라우트 파일을 만들지 않는다**(2026-09-06).
 *   사장님 「홍길동 영업채널 걸로 하나 파줘 그럼 **바로 파줘야** 되는 거야」 —
 *   채널 하나 파는 일이 「표에 한 줄」이려면 화면이 «한 벌»이어야 한다.
 *   임시 주소는 미들웨어가 `/shop` 으로 다시 쓴다. 파일을 만들면 화면이 두 벌이 되고,
 *   한쪽만 고쳐지는 순간 「그 채널만 예전 화면」이 된다.
 * ⚠ 표에서 `sitePath` 를 읽어 «그 경로의 라우트 파일이 없는지»를 센다 —
 *   채널이 늘어도 이 검사는 안 고친다.
 */
{
  const table = read('lib/whitelabel.ts');
  const paths = [...table.matchAll(/sitePath:\s*'([^']+)'/g)].map((m) => m[1]);
  const stray = paths.filter((p) => existsSync(new URL(`../app/(shop)${p}/page.tsx`, import.meta.url))
    || existsSync(new URL(`../app${p}/page.tsx`, import.meta.url)));
  must(stray.length === 0,
    `채널 전용 라우트 파일이 생겼습니다(${stray.join(' · ')}) — 채널은 «표 한 줄»이고 화면은 한 벌입니다.`,
    'docs/영업자홈피-채널-매뉴얼.md §2');
}

/*
 * ★★★**세로 리듬은 «사다리»만 쓴다**(사장님 2026-09-06 「줄 간격들을 … **다 통일** 시켰으면
 *   좋겠어. **어디는 넓고 어딘 좁고** 이러지 않고」).
 *   손님 동 파일에서 `margin*: <숫자>` 가 사다리(0·4·8·12·16·24·32·48 = `SHOP.sp`) 밖이면 걸린다.
 * ⚠ 실측 2026-09-06 — 무리 사이가 **16·24·28** 로, 라벨 밑이 **4·8** 로 갈려 있었다.
 *   보는 사람은 규칙을 못 읽고 「여기는 왜 붙었지」만 느낀다.
 * ★**세로만 본다**(`marginTop|marginBottom|margin`). 가로(`marginLeft/Right`)는 아이콘을 1px 밀어
 *   글자 밑선에 맞추는 «눈맞춤»이 섞여 있어 사다리로 잴 값이 아니다.
 * ★`padding` 은 안 본다 — 뱃지 규격(`BADGE.padY` 2)처럼 «리듬이 아닌» 값이 섞여 있다.
 */
{
  const LADDER = new Set([0, 4, 8, 12, 16, 24, 32, 48]);
  const files = [
    'components/shop/ShopDetail.tsx', 'components/shop/ShopCard.tsx',
    'components/shop/ShopFilters.tsx', 'components/shop/ShopFilterSheet.tsx',
    'components/shop/shop-ui.tsx', 'components/WhitelabelFrame.tsx',
    'app/(shop)/shop/ShopView.tsx',
  ];
  const strays: string[] = [];
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/margin(?:Top|Bottom)?:\s*(\d+)/g)) {
      if (!LADDER.has(Number(m[1]))) strays.push(`${f} margin ${m[1]}`);
    }
    /* ★`gap` 도 «사이»다 — 줄 사이든 칸 사이든 같은 사다리를 탄다(2026-09-06 실측으로 여덟 군데 잡았다). */
    for (const m of src.matchAll(/(?:^|[^A-Za-z])(?:row|column)?[Gg]ap:\s*(\d+)/g)) {
      if (!LADDER.has(Number(m[1]))) strays.push(`${f} gap ${m[1]}`);
    }
  }
  must(strays.length === 0,
    `세로 리듬이 사다리를 벗어났습니다(${strays.slice(0, 4).join(' · ')}) — 간격은 SHOP.sp 만 씁니다.`,
    'components/shop/ShopDetail.tsx §세로 리듬');
}

/* ── 스타일시트가 다시 섞이지 않았는가 ────────────────────────────────────
 * 2026-09-08 에 손님 동 CSS 346줄을 `app/whitelabel.css` 로 뗐다. 뗀 이유는 «취향»이 아니라
 * **사고 셋**이다 — 업무동 쪽을 고치다 손님 목록이 통째로 접혔다(08-31 · 09-01 · 09-04).
 * 그중 한 번은 하루 넘게 아무도 몰랐다.
 * ⇒ 다시 섞이면 그 사고가 돌아온다. 「한 줄쯤이야」로 다시 붙는 것을 여기서 막는다.
 * ★반대 방향도 막는다 — 업무동 규칙(`.fp-finder-*`·`.fp-topbar`)이 손님 시트로 넘어오면
 *   이번엔 손님 쪽을 고치다 업무동이 깨진다. 벽은 양쪽으로 서 있어야 벽이다.
 */
{
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const guestSel = /\.fp-(?:wl|shop)[-\s.,:>[{]/;
  const workSel = /\.fp-(?:finder|topbar|onbar)[-\s.,:>[{]/;
  must(!guestSel.test(strip(read('app/globals.css'))),
    '손님 동 규칙(.fp-wl / .fp-shop-*)이 **업무동 스타일시트로 돌아왔습니다**.',
    'app/globals.css → app/whitelabel.css 로 옮기세요(섞여서 손님 목록이 세 번 접혔습니다)');
  must(!workSel.test(strip(read('app/whitelabel.css'))),
    '업무동 규칙(.fp-finder-* / .fp-topbar)이 **손님 스타일시트로 넘어왔습니다**.',
    'app/whitelabel.css → app/globals.css 로 돌리세요(벽은 양쪽으로 서 있어야 합니다)');
  const layout = read('app/layout.tsx');
  must(layout.indexOf("globals.css") < layout.indexOf("whitelabel.css") && layout.includes("whitelabel.css"),
    '손님 스타일시트가 `globals.css` **뒤**에 실리지 않습니다.',
    'app/layout.tsx — 뒤여야 같은 세기일 때 손님 동 규칙이 이깁니다');
}

/*
 * **조건칸은 «쭈구러들지» 않는다 — 줄은 그대로, 숫자만 0** (2026-09-10 확정 · §12)
 *
 * 사장님 「필터는 **연동형 필터 아니고** 그냥 누른다고 해서 **다 없어지면 안 되는데**」 ·
 * 「그냥 기존 필터에서 **숫자가 0으로 바뀌면** 되잖아 **이게 쭈구러 든다**고」 ·
 * 「**공통으로 쓰는 것들은 한 군데서 고치면 다 동일하게 고쳐져야지.** 좀 이상하다는 생각이 드는데?」
 *
 * ★★★**그래서 이 검사는 «규칙이 한 곳에 있는가»를 본다.**
 *   ⚠ 처음엔 손님 동·업무동 «두 파일»에 같은 규칙이 손으로 적혀 있었고, 이 검사도 두 군데를
 *     각각 노려봤다. 그래서 2026-09-10 에 손님 동만 고치고 업무동을 하루 남겨 뒀다 —
 *     **검사가 두 개면 한쪽만 통과시키는 일도 두 개**다.
 *   ⇒ 규칙은 `lib/domain/facet-standing.ts` 하나이고, 두 동은 **그걸 부르기만** 한다.
 *     여기서는 ㉠ 정본이 살아 있나 ㉡ 두 동이 정말 그걸 부르나 ㉢ 손으로 다시 짜지 않았나를 본다.
 */
{
  const standing = read('lib/domain/facet-standing.ts');
  const finder = read('lib/domain/product-filters.ts');
  const editor = read('components/shop/ShopQuickEditor.tsx');

  // ㉠ 정본 — 줄은 base 가 세우고(0 이면 안 선다), 차례도 base 가 매긴다.
  must(/\.filter\(\(o\) => o\.base > 0\)/.test(standing) && /b\.base - a\.base/.test(standing),
    '조건칸 정본이 «지금 건수»로 줄을 세웁니다 — 조건 하나 누를 때마다 보던 줄이 사라집니다.',
    'lib/domain/facet-standing.ts · docs/DESIGN_CONFIRMED_SHOP.md §12');

  // ㉡ 두 동이 그 정본을 «부른다»
  for (const [file, src] of [['lib/shop/query.ts', shopQuery], ['lib/domain/product-filters.ts', finder]] as const) {
    must(/from '@\/lib\/domain\/facet-standing'/.test(src) && /standingFixed|standingRanked/.test(src),
      `${file} 이 조건칸 정본(facet-standing)을 안 씁니다 — 규칙이 다시 두 벌이 됩니다.`,
      'docs/DESIGN_CONFIRMED_SHOP.md §12');
    // ㉢ 손으로 다시 짜지 않았나 — 건수 0 을 줄째 빼는 옛 버릇.
    must(!/\.filter\(\(o\) => o\.count > 0\)/.test(src),
      `${file} 에서 건수 0 인 줄을 다시 뺍니다 — 「0이라고 쓴다」가 규격입니다.`,
      'docs/DESIGN_CONFIRMED_SHOP.md §12');
  }

  // ㉣ 빠른조건 칩도 같은 잣대다 — 「지금 0대」로 걷으면 칩 줄까지 같이 쭈그러든다.
  must(/facets\[axis\]\.filter\(\(o\) => o\.base > 0/.test(editor),
    '빠른조건을 «있는 값»이 아닌 데서 고르게 됐습니다 — 고르는 목록은 조건칸과 같은 집계에서 옵니다.',
    'components/shop/ShopQuickEditor.tsx · docs/DESIGN_CONFIRMED_SHOP.md §11');
  /*
   * ㉤ 고치는 문 = **웹 조건칸 «맨 아래 구역»** · 칸 안은 **조건칸과 같은 체크 줄**(2026-09-11).
   *   사장님 「퀵필터 조정하는 거 **설정페이지 맨 하단 섹션 하나** 주고 거기서 **펼쳐서** 넣게」 ·
   *   「엥 필터는 **저렇게 나오면 안 되는데**??」(알약으로 쏟아 놓은 것) · 「**모바일 필터는 기존 게 맞는 거야**」.
   */
  must(/tail=\{quickTail\}/.test(shopView)
      && /<ShopQuickEditor[\s\S]{0,200}value=\{quickAll\}/.test(shopView)
      && /tail\?: ShopFilterTail/.test(read('components/shop/ShopFilters.tsx')),
    '빠른조건 고치는 칸이 웹 조건칸 맨 아래에 없습니다.',
    'app/(shop)/shop/ShopView.tsx · docs/DESIGN_CONFIRMED_SHOP.md §13');
  must(/<ShopFilters /.test(editor) && !/<ShopPill/.test(editor),
    '빠른조건 칸이 조건칸과 다른 모양(알약 등)으로 값을 늘어놓습니다 — 같은 체크 줄 원자를 씁니다.',
    'components/shop/ShopQuickEditor.tsx · docs/DESIGN_CONFIRMED_SHOP.md §13');
  must(!/ShopQuickEditor|\btail[=?:]/.test(read('components/shop/ShopFilterSheet.tsx')),
    '폰 상세 조건 시트에 빠른조건 칸이 들어갔습니다 — 폰 시트는 기존 그대로입니다.',
    'components/shop/ShopFilterSheet.tsx · docs/DESIGN_CONFIRMED_SHOP.md §13');
  must(!/role="dialog"/.test(editor) && !/setQuickOpen/.test(shopView),
    '빠른조건 고치기가 다시 «창»으로 떴습니다 — 조건칸 맨 아래 구역에서 펼쳐 고칩니다.',
    'components/shop/ShopQuickEditor.tsx · docs/DESIGN_CONFIRMED_SHOP.md §13');

  must(/facets\[k\.axis\]\.some\(\(o\) => o\.key === k\.key && o\.base > 0\)/.test(shopView),
    '빠른조건 칩이 «지금 건수»로 사라집니다 — 조건을 누를 때마다 칩 줄이 같이 쭈그러듭니다.',
    'app/(shop)/shop/ShopView.tsx · docs/DESIGN_CONFIRMED_SHOP.md §11');


  /*
   * ★★★**한 조건 = 한 자리 — 웹도 폰도.**
   *   사장님 2026-09-10 「웹 버전과 모바일 버전 **필터 누르는 방식이 다르다니까.**
   *   **퀵필터에 있는 거는 누르면 «자리»가 눌리는 거지 새로운 게 나오는 게 아니잖아**」.
   *
   * ⚠ 2026-09-08 에 웹만 고치고 **폰을 두 해 동안 남겨 뒀다.** 폰에서 「SUV」를 누르면
   *   칩이 켜지는 동시에 **밑에 줄이 하나 새로 생겨** 목록이 밀렸다 — 한 조건이 한 화면에 두 번.
   * ⇒ 두 곳 다 「칩이 있는 조건은 토큰을 안 만든다」를 걸어 둔다. 하나만 통과시킬 수 없게
   *   **한 검사에서 둘을 같이** 본다(검사가 둘이면 한쪽만 고치는 일도 둘이다).
   */
  const tokenGuards = shopView.match(/tokens\.filter\(\(t\) => !quickKeys\.has\(/g) || [];
  must(tokenGuards.length >= 2,
    `퀵필터 칩과 «같은 조건»이 토큰으로 또 섭니다 — 누르면 자리가 눌려야지 새 줄이 생기면 안 됩니다(지금 ${tokenGuards.length}곳만 걸림 · 웹·폰 둘 다여야 합니다).`,
    'app/(shop)/shop/ShopView.tsx · docs/DESIGN_CONFIRMED_SHOP.md §15');}

/* ── 출고상태는 «모양»으로 갈린다 — 다섯이 다 체크면 못 가른다 ─────────────────
 *
 * 사장님 2026-09-17 「이 화이트라벨은 **영업자들이 차를 쉽게 찾고 빠르게 보이고, 내가 이 차가
 *   어떤 상태에 있는 차인지를 명확하게 바라보는 것**이거든」.
 *
 * ⚠ 다섯 상태가 전부 같은 체크(✓)였고 색만 갈렸다. 실측(2026-09-17 운영 746대) —
 *   출고가능 468 · **출고협의 245(33%)** · 즉시출고 25 · 계약중 4 · 상품화중 2.
 *   셋에 하나가 「일정 조율이 필요한 차」인데 출고가능과 같은 모양으로 서 있었다.
 * ⇒ 상태 → 아이콘·색은 **원자 한 곳**(`vehicleStatusMark`)이 정하고, 목록·상세가 그것만 부른다.
 *   ★전에는 같은 줄이 두 파일에 손으로 적혀 있었다 — 한쪽만 고치면 목록과 상세가 갈린다.
 */
/*
 * ⚠ 처음엔 「파일에 Clock·Lock·Wrench 글자가 있나」로 셌다 — **가짜 초록**이었다.
 *   import 줄에 이름이 남아 있어서, 정작 «짝지은 줄»을 지워도 검사가 통과했다(자기시험에서 잡았다).
 *   개발센터 사고원장 `INC-FALSE-GREEN` 과 같은 종류다. ⇒ **상태 ↔ 모양의 «짝»**을 본다.
 */
must(/export function vehicleStatusMark/.test(shopUi),
  '출고상태 마크를 정하는 원자(vehicleStatusMark)가 사라졌습니다 — 목록·상세가 각자 짜게 됩니다.',
  'components/shop/shop-ui.tsx vehicleStatusMark');
for (const [state, icon] of [['출고협의', 'Clock'], ['계약중', 'Lock'], ['상품화중', 'Wrench']] as const) {
  must(new RegExp(`${state}[^\\n]*\\n?[^\\n]*icon: ${icon}\\b`).test(shopUi),
    `출고상태 「${state}」가 제 모양(${icon})을 잃었습니다 — 다섯 상태가 다 체크면 영업자가 못 가릅니다.`,
    'components/shop/shop-ui.tsx vehicleStatusMark');
}
for (const [file, src] of [['components/shop/ShopCard.tsx', shopCard], ['components/shop/ShopDetail.tsx', shopDetail]] as const) {
  must(/vehicleStatusMark\(status\)/.test(src),
    `${file} 이 상태 마크를 손으로 다시 짭니다 — 목록과 상세가 갈립니다(원자 vehicleStatusMark 를 부르세요).`,
    'components/shop/shop-ui.tsx vehicleStatusMark');
}

/* ── 머리띠 오른쪽 — 표준라벨과 영업채널이 «딱 한 칸» 다르다 ─────────────────
 *
 * 사장님 2026-09-16 「**표준라벨은 날짜 시간 날씨**로 하고 · **화이트라벨(영업채널용) 상단
 *   상담 및 문의 대표번호로** 하고 · **딱 그거만 다르게**」
 * 사장님 2026-09-17 「이거 **매뉴얼 좀 해놔라 어딘가에 박아놔야지** — 코드나 SSOT 에」.
 *
 * ⚠ 그때까지 이 규칙은 **화면 파일 주석에만** 있었다. 주석은 지워져도 아무도 모른다 —
 *   이 저장소의 「고쳐 놓으면 또 바뀐다」가 대부분 그렇게 났다.
 * ★그래서 셋을 «기계»가 지킨다:
 *   ㉠ 가르는 잣대는 **`self`** 다 — 「번호가 있나」로 가르면 폰에 문의 단추를 단 순간 웹 날짜가 사라진다(겪었다).
 *   ㉡ 채널 쪽 말은 **한 곳**(`CONTACT_LABEL`)에서 온다 — 손으로 적으면 웹·폰이 갈린다.
 *   ㉢ 표준라벨 쪽은 **날짜·시각**(`nowLabelKo`)과 **날씨**(`head.weather`)를 든다.
 * ★폰 둘째 줄(날짜·날씨)은 2026-09-17 에 걷었다 — 그건 «없는 것»이 규격이라 여기서 안 센다.
 */
/*
 * ⚠ 2026-09-17 잣대가 `self` → **`labelKind`** 로 바뀌었다(사장님 「표준라벨, 채널라벨, 공급라벨
 *   이렇게 있는 거야」 · 우리 브랜드 가게는 **채널라벨 묶음**). `self` 로 가르던 때는 우리 가게에도
 *   날씨가 섰다. 세 갈래의 이름·표는 `lib/whitelabel.ts` `labelKind` 머리말이 정본이다.
 */
must(/const standardLabel = labelKind\(wl\) === 'standard'/.test(wlFrame)
  && /const who = standardLabel \? ''/.test(wlFrame)
  && /const phone = standardLabel \? ''/.test(wlFrame)
  && /const webContact = !mobile && !standardLabel && !!phone/.test(wlFrame),
  '머리띠 오른쪽을 가르는 잣대가 바뀌었습니다 — 표준라벨만 날짜·시각·날씨, 채널·공급라벨은 상담 대표번호입니다.',
  'components/WhitelabelFrame.tsx webContact · lib/whitelabel.ts labelKind');
must(/key: 'plain'[\s\S]*?tel: ''[\s\S]*?bizLines: \[\]/.test(wlTable),
  '표준라벨에 전화번호나 사업자 귀속이 다시 들어갔습니다 — freepasserp.com 하단은 비워 둡니다.',
  'lib/whitelabel.ts plain · docs/ERP4-MAIN-UI-STANDARD.md §1');
must(/export function labelKind/.test(wlTable) && /supplier/.test(wlTable),
  '라벨 세 갈래(표준·채널·공급)의 이름이 표에서 사라졌습니다 — 규칙을 갈래 이름으로 적을 수 없게 됩니다.',
  'lib/whitelabel.ts labelKind · docs/DESIGN_CONFIRMED_SHOP.md 「머리띠 오른쪽」');
must(/const CONTACT_LABEL = '상담 및 문의'/.test(wlFrame) && /\{CONTACT_LABEL\}/.test(wlFrame),
  '채널 머리띠의 「상담 및 문의」가 한 곳(CONTACT_LABEL)에서 안 옵니다 — 손으로 적으면 웹·폰이 갈립니다.',
  'components/WhitelabelFrame.tsx CONTACT_LABEL · docs/DESIGN_CONFIRMED_SHOP.md 「머리띠 오른쪽」');
must(/nowLabelKo\(now\)/.test(wlFrame) && /head\.weather/.test(wlFrame),
  '표준라벨 머리띠에서 날짜·시각·날씨가 빠졌습니다 — 「재고가 지금 것」임을 말하는 자리입니다.',
  'components/WhitelabelFrame.tsx · docs/DESIGN_CONFIRMED_SHOP.md 「머리띠 오른쪽」');

/*
 * ★★★**재고 갱신 시각의 «출처» — 화면이 그리는 그 원자다.** (2026-09-17 확정)
 *
 * 사장님 「여기서 역으로 한번 그쪽으로 파봐」 → 실측: 화면은 「9. 14. 02:01」인데 원자 절반이
 * 그날 아침(09-17 09:53) 것이었다. **80시간 틀렸다**(운영 1,615대 전수 ·
 * `scripts/diag-erp5-atom-freshness.mts`). 화면이 그리는 재고(erp5 `products`)와 화면이 읽던
 * 시각(erp4 `sheet_daily_sync`·`ops/pipeline`)이 **서로 다른 파이프라인**이었기 때문이다.
 *
 * ⚠⚠ 2026-09-10 에 같은 자리가 이미 한 번 어긋났고, 그때는 출처를 «바꾸지» 않고 «하나 더 늘려»
 *   고쳤다. 늘리는 고침은 원장이 옮겨 가면 또 깨진다 — 그래서 이번엔 **출처를 원자로 옮겼다.**
 * ★지켜야 할 것 셋 —
 *   ㉠ 원자에게 **먼저** 묻고, 답이 있으면 **그것만** 쓴다
 *   ㉡ 옛 두 기록과 `max()` 로 **섞지 않는다**(더 최근인 엉뚱한 기록이 묵은 재고를 가려 준다)
 *   ㉢ 시각 하나 때문에 컬렉션을 통째로 읽지 않는다(`limit(1)`)
 */
{
  const statusRoute = read('app/api/shop/status/route.ts');
  const erp5 = read('lib/server/whitelabel-erp5-catalog.ts');

  must(/export async function readErp5StockFreshness/.test(erp5)
    && /_direct_ingest_at/.test(erp5) && /_var_polled_at/.test(erp5),
    '재고 시각을 원자에서 읽는 자리가 사라졌습니다 — 수집기가 찍는 칸(_direct_ingest_at·_var_polled_at)이 출처입니다.',
    'lib/server/whitelabel-erp5-catalog.ts readErp5StockFreshness');
  must(/\.limit\(1\)/.test(erp5.slice(erp5.indexOf('readErp5StockFreshness'))),
    '재고 시각을 읽으려고 컬렉션을 통째로 읽고 있습니다 — 시각 하나에 1,600건을 읽을 이유가 없습니다.',
    'lib/server/whitelabel-erp5-catalog.ts readErp5StockFreshness · limit(1)');

  /* ⚠ 잣대는 «뒷문이 시작되는 자리»로 잡는다 — Math.max 의 인자 차례가 바뀌어도 안 흔들리게. */
  const atomAt = statusRoute.indexOf('readErp5StockFreshness()');
  const maxAt = statusRoute.indexOf('pick(DAILY_SYNC_PATH');
  must(atomAt > 0 && maxAt > 0 && atomAt < maxAt,
    '머리띠 시각이 원자보다 옛 기록을 «먼저» 봅니다 — 화면이 그리는 데이터가 제 나이를 말해야 합니다.',
    'app/api/shop/status/route.ts loadUpdated');
  must(/if \(atom > 0\) return \{ ms: atom/.test(statusRoute),
    '원자가 답했는데도 옛 기록을 계속 봅니다 — 답이 있으면 «그것만» 씁니다(뒤섞으면 2026-09-10 버그로 돌아갑니다).',
    'app/api/shop/status/route.ts loadUpdated');
  must(!/Math\.max\([^)]*atom/.test(statusRoute),
    '원자 시각을 옛 기록과 max() 로 섞었습니다 — 더 최근인 «엉뚱한» 기록이 묵은 재고를 가려 줍니다.',
    'app/api/shop/status/route.ts loadUpdated');
}

/*
 * ★★★**보증금은 «자르지도 넘치지도» 않는다.** (2026-09-05 확정 + 2026-09-18 실측 보강)
 *
 * ㉠ 자르지 않는다 — 「보증금 103만 5,…」로 끝이 잘려 있던 것을 2026-09-05 에 고쳤다.
 *   보증금은 저신용 손님이 제일 먼저 재는 «지금 드는 돈»이라, 자리에 안 맞으면 줄을 바꾼다.
 * ㉡ 넘치지도 않는다 — 그런데 «규칙 글자»(「보증금 월 대여료 × 약정연수 (최대 3개월)」)는
 *   금액보다 훨씬 길어(웹 실측 210px) `nowrap` 으로는 접히지도 줄지도 못하고 **칸 밖으로 흘렀다.**
 *   2026-09-18 운영 실측 — 창 900px · 카드폭 167px → **45px 가 옆 카드 위로 넘어가 글자가 겹쳤다**
 *   (카드폭 210 미만 = 창 약 1010px 밑에서 늘). 노트북 반쪽 화면이 딱 그 폭이다.
 * ⇒ 「금액이냐 문장이냐」를 `depositLine` 이 `rule` 로 알려 주고, 카드가 그때만 줄을 바꾼다.
 *   ⚠ ellipsis 로 막으면 ㉠ 을 되돌리는 것이다 — «자르기»가 아니라 «줄바꿈»으로만 막는다.
 */
{
  const fmt = read('lib/format.ts');
  must(/depositLine\([^)]*\)[\s\S]{0,200}?rule: boolean/.test(fmt),
    '`depositLine` 이 「금액인지 규칙 문장인지」를 안 알려 줍니다 — 부르는 쪽이 둘을 같은 폭으로 세우면 문장이 칸을 넘칩니다.',
    'lib/format.ts depositLine');

  const depAt = shopCard.indexOf('dep && dep.rule');
  must(depAt > 0, '카드가 보증금 «규칙 문장»을 금액과 구분해 세우지 않습니다 — 좁은 창에서 옆 카드로 넘칩니다.',
    'components/shop/ShopCard.tsx · lib/format.ts depositLine');
  if (depAt > 0) {
    const near = shopCard.slice(depAt, depAt + 260);
    must(/whiteSpace: 'normal'/.test(near),
      '보증금 규칙 문장이 줄바꿈을 못 합니다 — 접히지 못하면 칸 밖으로 흐릅니다.',
      'components/shop/ShopCard.tsx 보증금 줄');
    must(!/textOverflow: 'ellipsis'/.test(near),
      '보증금을 … 로 잘랐습니다 — 2026-09-05 에 고친 것을 되돌린 것입니다(자르지 말고 줄을 바꿉니다).',
      'components/shop/ShopCard.tsx 보증금 줄 · DESIGN_CONFIRMED_SHOP.md');
  }
}

/*
 * ★★★**화이트라벨은 보증금을 «금액»으로 말한다.** (2026-09-18 확정)
 *
 * 사장님 「화이트라벨에는 실제로 그 보증금을 입력해 두자는 거지 · **계산해서 그렇게 넣어 주자** ·
 * 모든 게 다 화이트라벨에는 **금액이 들어가니까**」.
 *
 * ⚠⚠ 그 전에는 규칙 글자(「월 대여료 × 약정연수 (최대 3개월)」)가 손님 화면에 그대로 나갔고,
 *   상세 요금표는 더 나빴다 — 금액이 0 인 **285대에서 보증금 칸 열 줄이 전부 「없음」**이었다.
 *   보증금이 있는 차를 「없음」이라고 말한 것이라 빈 게 아니라 **틀린 말**이었다.
 * ★원자(SSOT)는 그대로 규칙 글자를 싣는다 — 바뀌는 것은 «손님이 보는 말»뿐이다
 *   (2026-09-17 판단 유지: 「계산값을 원자에 박으면 원천 대여료가 바뀔 때 보증금만 따로 늙는다」).
 * ★셈은 **한 곳**(`lib/format.ts` `depositFromRule`) — 카드·상세 머리·요금표·공유가 같은 답을 쓴다.
 *   셈이 맞는지는 `npm run check:deposit` 가 운영 실측값으로 매번 다시 푼다.
 * ⚠ **모르는 규칙은 지어내지 않는다**(`null` → 규칙 글자 그대로). 돈을 틀리게 부르는 것보다 낫다.
 */
{
  const fmt = read('lib/format.ts');
  const detail = read('components/shop/ShopDetail.tsx');

  must(/export function depositFromRule/.test(fmt),
    '보증금 규칙을 금액으로 바꾸는 셈이 사라졌습니다 — 손님 화면에 「월 대여료 × 약정연수」가 그대로 나갑니다.',
    'lib/format.ts depositFromRule · npm run check:deposit');
  must(/return null;\s*\}\s*$/m.test(fmt.slice(fmt.indexOf('export function depositFromRule'), fmt.indexOf('export function depositLine'))),
    '`depositFromRule` 이 모르는 규칙에도 숫자를 냅니다 — 모르면 null 이어야 규칙 글자로 안전하게 나갑니다.',
    'lib/format.ts depositFromRule');

  /* 네 화면이 전부 «기간»을 넘겨야 셈이 된다 — 하나라도 빠지면 그 화면만 글자로 남는다. */
  for (const [file, src] of [
    ['components/shop/ShopCard.tsx', shopCard],
    ['components/shop/ShopDetail.tsx', detail],
    ['app/q/[code]/page.tsx', read('app/q/[code]/page.tsx')],
  ] as const) {
    /* ⚠ 괄호로 잘라 세지 않는다 — 인자 안에 `(p as Record<…>)` 가 있어 첫 `)` 에서 끊긴다. */
    const at: number[] = [];
    for (let i = src.indexOf('depositLine('); i >= 0; i = src.indexOf('depositLine(', i + 1)) at.push(i);
    must(at.length > 0 && at.every((i) => /months:/.test(src.slice(i, i + 300))),
      `${file} 이 보증금을 셀 «기간»을 안 넘깁니다 — 그 화면만 규칙 글자로 남습니다.`,
      `${file} · lib/format.ts depositLine`);
  }

  must(!/x\.deposit > 0 \? wonKo\(x\.deposit\) : '없음'/.test(detail),
    '요금표 보증금 칸이 다시 「없음」으로 굳었습니다 — 규칙으로 오는 285대가 보증금 없는 차로 보입니다.',
    'components/shop/ShopDetail.tsx 요금표 보증금 칸');
}

/*
 * ★★★**배너 = 손님에게 말을 거는 자리 — 글도 그림도 받고, 눌러서 «그 차들»로 보낸다.** (2026-09-18 확정)
 *
 * 사장님 「표준라벨에서 배너를 조금 **적극적으로 활용**해 볼 생각이거든 · **닫기 버튼도 확실하게
 * 누르는 거를** 좀 해주고 · 어떤 상품이 좋다 · 무보증 상품이 있다 이런 것들 · **앞으로 이미지 또는
 * 텍스트로 넣을 거야**」.
 *
 * 지킬 것 넷 —
 *  ㉠ **그림 배너**를 받는다(`notice.image`) — 웹·폰 두 벌 · `alt` 필수
 *  ㉡ **면 전체가 링크**다(`notice.link`) — 주소가 곧 조건이라 `/?perk=무보증` 이면 그 341대 앞에 내려놓는다
 *  ㉢ **닫기는 아주 연한 문구 + X** — 별도 체크박스·버튼 면·테두리를 세우지 않는다(2026-09-21 재개정)
 *  ㉣ **글도 그림도 없으면 안 그린다** — 빈 띠가 첫 화면을 118~161px 먹는 것보다 없는 편이 낫다
 * ★「오늘 하루 안 보기」 글자는 그대로 남고, 문구+X 전체 누름 영역은 모바일 최소 44px을 가진다.
 */
{
  const wlTableSrc = read('lib/whitelabel.ts');

  must(/image\?: \{ web: string; mobile\?: string; alt: string \}/.test(wlTableSrc),
    '배너가 «그림»을 못 받습니다 — 사장님이 이미지로 넣으실 자리입니다(웹·폰 두 벌 · alt 필수).',
    'lib/whitelabel.ts notice.image · docs/DESIGN_CONFIRMED_SHOP.md 「배너」');
  must(/link\?: \{ href: string; label\?: string \}/.test(wlTableSrc),
    '배너가 «누르면 갈 곳»을 못 받습니다 — 「무보증 상품이 있다」고 말만 하고 끝납니다.',
    'lib/whitelabel.ts notice.link');

  const banner = wlFrame.slice(wlFrame.indexOf('function WhitelabelNotice'));
  must(/src=\{\(mobile && img\.mobile\) \|\| img\.web\}/.test(banner),
    '그림 배너가 폰·웹을 안 가릅니다 — 배너 폭이 1280 대 343 이라 한 장을 늘리면 글자가 뭉개집니다.',
    'components/WhitelabelFrame.tsx WhitelabelNotice');
  must(/if \(!notice \|\| closed \|\| \(!img && !hasText\)\) return null;/.test(banner),
    '글도 그림도 없는데 배너를 그립니다 — 빈 띠가 첫 화면을 먹습니다.',
    'components/WhitelabelFrame.tsx WhitelabelNotice');
  must(/<a href=\{href\}/.test(banner),
    '배너 면 «전체»가 링크가 아닙니다 — 손님을 그 조건이 걸린 목록 앞에 내려놓지 못합니다.',
    'components/WhitelabelFrame.tsx WhitelabelNotice · lib/whitelabel.ts notice.link');

  /* 오늘 숨김 — 아주 연한 문구 + X. 별도 면/테두리 없이 모바일 44px 누름영역 유지. */
  const dismiss = banner.slice(banner.indexOf('aria-label="오늘 하루 안 보기"'));
  must(/<Btn/.test(dismiss) && /variant="bare"/.test(dismiss) && /background: 'transparent'/.test(dismiss),
    '배너 오늘 숨김이 bare 공통 버튼 원자에서 벗어나거나 강한 버튼 면을 갖게 됐습니다.',
    'components/WhitelabelFrame.tsx 오늘 하루 안 보기 · 사장님 2026-09-21');
  must(/minHeight: mobile \? 44 : 36/.test(dismiss),
    '배너 오늘 숨김의 모바일 터치영역이 44px 아래로 줄었습니다.',
    'components/WhitelabelFrame.tsx 오늘 하루 안 보기 · AI Core touch target');
  must(dismiss.includes('오늘 하루 안 보기') && /color: C\.faint/.test(dismiss) && /<X size=\{ICON\.sm\}/.test(dismiss),
    '「오늘 하루 안 보기 + X」의 연한 보조표현 규격이 바뀌었습니다.',
    'components/WhitelabelFrame.tsx 오늘 하루 안 보기');
}

if (fails.length) {
  console.error(`\n✗ 확정 디자인이 바뀌었습니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`   · ${f}\n`);
  console.error('  바꾸려면: 사장님께 여쭙고 → docs/DESIGN_CONFIRMED_LIST_CARD.md 를 고치고 → 이 검사를 고칩니다.\n');
  process.exit(1);
}
console.log('✓ 확정 디자인 유지 — 목록·카드·상세·색 사다리·가게 정합');
