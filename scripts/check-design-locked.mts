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
/*
 * 차량 정보 = 「이 차가 무엇인가」. **차 설명하는 순서**로 든다(사장님 2026-09-05).
 * ⚠ 여기 있던 검사는 정반대였다 — 「사실줄과 겹치는 줄이 돌아왔나」를 잡았다(구 §1-11).
 *   그 규칙으로 고른 결과가 «차 설명»이 아니라 «남은 것 모음»이라 폐기됐다.
 *   검사를 지운 게 아니라 **새 규격을 지키도록** 바꾼 것이다.
 */
must(/>제조사 · 세부모델 · 세부트림</.test(shopDetail),
  '차량 정보에서 「제조사 · 세부모델 · 세부트림」 첫 줄이 사라졌습니다. 이 줄이 「이 차가 무엇인가」의 머리입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-11');
must(/['"]외부 색상['"]/.test(shopDetail) && /['"]내부 색상['"]/.test(shopDetail),
  '차량 정보에서 색상이 빠졌거나 다시 하나로 뭉쳐졌습니다. 색상은 사진 없는 28%의 유일한 외관 정보입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-11');
/*
 * ⚠ 여기 「구동방식이 돌아왔나」를 잡는 줄이 있었다. **폐기한다**(2026-09-05).
 *   09-05 낮 지적(「연식이, 이륜구동, 이런 걸 넣는 게 아니라」)은 «구동방식이 첫 칸이었던 것»이지
 *   «있으면 안 된다»가 아니었다. 같은 날 사장님이 차량 정보에 넣을 것을 세어 주시면서
 *   **구동 방식을 직접 부르셨다.** 검사가 사장님 지시를 막고 있었다.
 * ⇒ 대신 **세어 주신 칸이 다 있는지**를 잡는다.
 */
for (const f of ['외부 색상', '내부 색상', '연식', '주행거리', '배기량', '연료', '구동방식', '승차정원', '배터리', '차량 가격']) {
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
  const vi = Math.max(shopDetail.indexOf('<Sec title="차량 정보"'), shopDetail.indexOf('<section aria-label="차량 정보">'));
  const opt = shopDetail.indexOf('aria-label="선택 옵션"');
  const model = shopDetail.indexOf('제조사 · 세부모델 · 세부트림');
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
must(/긴급출동 \{roadside\}/.test(shopDetail),
  '보험 맨 밑 「긴급출동」이 사라졌습니다 — 사고가 아니라 고장일 때 부르는 것이라 여기가 제자리입니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1-5');
// 심사는 계속 띄운다 — 이용 조건 안이다(요금 밑이 아니다).
must(/\['심사', credit\]/.test(shopDetail),
  '이용 조건에서 「심사」가 사라졌습니다 — 사장님 2026-09-05 「심사 조건은 계속 띄워요」.',
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
must(/const otherDeductibles = \[/.test(shopDetail)
  && /\['대인', S\('injury_deductible'\)\]/.test(shopDetail)
  && /\['자손', S\('self_body_deductible'\)\]/.test(shopDetail)
  && /\['무보험', S\('uninsured_deductible'\)\]/.test(shopDetail),
  '면책금 한 줄에서 대인·대물·자손·무보험이 빠졌습니다 — 있는 것만 이름과 값을 이어 한 줄로 씁니다.',
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
must(/display: mobile \? 'block' : 'flex', gap: mobile \? 0 : 32/.test(shopDetail),
  '웹에서 기간표와 납부가 다시 세로로 쌓였습니다 — 표 오른쪽 310px 가 빕니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1');
/*
 * 차명 밑 «표시 칩» — 출고상태 · 상품구분 · 심사 · 우대조건. **아이콘 + 글자**이고 테두리가 없다.
 * ⚠ 출고상태·상품구분은 한때 상세에 아예 없었다 — 목록 카드는 보여 주는데 상세에서 사라졌다.
 */
must(/const marks: \{ text: string; icon: LucideIcon; good\?: boolean \}\[\]/.test(shopDetail)
  && /S2\(p\.vehicle_status\)/.test(shopDetail) && /S2\(p\.product_type\)/.test(shopDetail),
  '차명 밑 표시 칩(출고상태·상품구분·심사·우대조건)이 사라졌습니다 — 목록 카드가 보여 준 말이 상세에서 없어집니다.',
  'docs/DESIGN_CONFIRMED_SHOP.md §1');
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
