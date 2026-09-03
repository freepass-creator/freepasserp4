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
const simpleCard = read('components/ProductCard.tsx');
const rowCard = read('components/ProductRowCard.tsx');
const cardAtoms = read('components/product-card-atoms.tsx');
const perks = read('components/product-card-perks.tsx');
const badgeView = read('components/product-card-badge-view.tsx');
const finderTable = read('features/finder/ExcelResultsTable.tsx');
const finderToolbar = read('features/finder/FinderToolbar.tsx');
const finderQuickFilters = read('features/finder/FinderQuickFilters.tsx');
const badgeSpecs = read('components/product-card-badges.tsx');
const options = read('components/product-card-options.tsx');
const detail = read('components/ProductDetail.tsx');
const priceTable = read('components/ProductPriceTable.tsx');
const identity = read('components/product-card-identity.ts');
const entities = read('lib/intake/entities.ts');
const product = read('lib/domain/product.ts');

/* ── 1. 목록 ── */
must(/\.fp-topbar\s*\{\s*background:\s*var\(--fp-bar-navy\)\s*!important;/m.test(css)
  && /\.fp-topbar \.fp-onbar\s*\{[\s\S]*?--text-main:\s*#ffffff;/m.test(css),
  '웹·모바일 공통 상단 앱바가 남색 반전 헤더에서 벗어났습니다.',
  'app/globals.css — .fp-topbar · .fp-topbar .fp-onbar');
must(/^\s*\/\* \.fp-card\.fp-card-row:nth-child\(even\)/m.test(css),
  '목록 얼룩무늬(지브라)가 켜졌습니다. 사장님 「얼룩무늬 뺄 거라고」 — 꺼진 채로 둡니다.',
  'app/globals.css · .fp-card-row:nth-child(even)');
must(/\.fp-page-toolbar \{ background: var\(--bg-card\)/.test(css)
  && /\.fp-finder-toolbar \{ background: var\(--bg-card\)/.test(css),
  '검색창 주변이 회색입니다. 모바일(.fp-page-toolbar)과 웹(.fp-finder-toolbar) 둘 다 흰 바탕이어야 합니다.',
  'app/globals.css — 한쪽만 고치면 반드시 되돌아옵니다');
must(/세부필터/.test(finderToolbar) && !/InterestTriggers|<Select\b|FINDER_SORTS/.test(finderToolbar),
  '웹 검색줄에 최근·관심 또는 독립 정렬 드롭다운이 돌아왔습니다. 세부필터 → 검색창 → 퀵필터여야 합니다.',
  'features/finder/FinderToolbar.tsx');
must(/fp-finder-quick-inline/.test(finderToolbar) && /quickFilters/.test(finderToolbar),
  '퀵필터가 검색창 아래로 분리됐습니다. 웹에서는 검색창 오른쪽에 둡니다.',
  'features/finder/FinderToolbar.tsx');
must(/key: 'sort', label: sortLabel/.test(finderQuickFilters) && /상품 많은 순/.test(finderQuickFilters) && /fp-sort-options/.test(finderQuickFilters)
  && /aria-pressed=\{selectedSort\}/.test(finderQuickFilters) && /setOpen\(null\)/.test(finderQuickFilters),
  '인기 정렬은 단일 선택 목록으로 바로 읽고 고를 수 있어야 합니다.',
  'features/finder/FinderQuickFilters.tsx');
must(/className="fp-quick-filter-reset"/.test(finderQuickFilters) && !/marginLeft:\s*'auto'/.test(finderQuickFilters),
  '초기화가 심사조건 뒤가 아니라 툴바 우측 끝으로 밀렸습니다.',
  'features/finder/FinderQuickFilters.tsx');
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
must(!/coreBadges/.test(simpleCard) && !/coreBadges/.test(cardAtoms),
  '간단보기 사진 신호가 예전 coreBadges 상자로 되돌아갔습니다.',
  'components/ProductCard.tsx · components/product-card-atoms.tsx');
must(/<SignalMarks\s+p=\{p\}\s+audience=\{audience\}\s+keys=\{\['st', 'pt'\]\}\s+dense\s+onPhoto\s*\/>/.test(simpleCard),
  '간단보기의 사진 우측 하단 신호(출고상태 → 상품구분)가 빠졌거나 다른 보기 규칙으로 바뀌었습니다.',
  'components/ProductCard.tsx — SignalMarks keys=[st, pt], onPhoto');
must(/iconColor=\{onPhoto \? C\.inverse : toneText\(spec\.tone\)\}/.test(badgeView),
  '사진 위 상품구분 아이콘이 반전되지 않았습니다. 중고렌트의 회색 태그가 배경에 묻습니다.',
  'components/product-card-badge-view.tsx — SignalMarks onPhoto');
must(/<CardPerkLine p=\{p\} dense withCredit\s*\/>/.test(simpleCard)
  && simpleCard.indexOf('<PriceAmounts') < simpleCard.indexOf('<PeriodChips')
  && simpleCard.indexOf('<PeriodChips') < simpleCard.indexOf('<CardPerkLine'),
  '간단보기의 대여료 → 기간칩 → 심사·우대조건 차례가 바뀌었습니다.',
  'components/ProductCard.tsx');
must(/<CardThumb p=\{p\} w=\{88\} heart\s*\/>/.test(rowCard)
  && (rowCard.match(/<CardRailBadges/g) || []).length === 1
  && rowCard.indexOf('<CardThumb p={p} w={88}') < rowCard.indexOf('<CardRailBadges'),
  '상세보기의 차량 신호가 본문 우측 정보 칸이 아니라 썸네일로 돌아갔습니다.',
  'components/ProductRowCard.tsx — CardThumb + CardRailBadges');
must(!/<Badge\b/.test(cardAtoms) && !/promoChip|photoMarkSpecs|marks\s*=/.test(cardAtoms),
  '상품 썸네일에 예전 상자형 신호·프로모 경로가 남아 있습니다.',
  'components/product-card-atoms.tsx — CardThumb');
must(!/<Badge\b/.test(finderTable)
  && /<SignalMarks p=\{p\} keys=\{\['st'\]\} dense\s*\/>/.test(finderTable)
  && /<SignalMarks p=\{p\} keys=\{\['pt'\]\} dense\s*\/>/.test(finderTable)
  && /<SignalMarks p=\{p\} keys=\{\['cd'\]\} dense\s*\/>/.test(finderTable),
  '엑셀형 목록의 상태·상품·심사가 상자형 뱃지로 되돌아갔습니다.',
  'features/finder/ExcelResultsTable.tsx — SignalMarks');
must(/<ConditionMarks items=\{conds\} dense\s*\/>/.test(finderTable),
  '엑셀형 목록의 우대조건이 아이콘 없이 텍스트만으로 되돌아갔습니다.',
  'features/finder/ExcelResultsTable.tsx — ConditionMarks');
must(/background:\s*C\.head/.test(options) && /borderRadius:\s*R/.test(options) && /EXCEL_OPT_CHIP_H/.test(options)
  && !/>· \{option\}</.test(options),
  '차량 옵션은 가운데점 텍스트가 아니라 옵션칩으로 통일해야 합니다.',
  'components/product-card-options.tsx');
must(!/export function (badges|BadgesClip|photoMarkSpecs)/.test(badgeSpecs),
  '삭제한 상자형 상품 뱃지 API가 다시 생겼습니다.',
  'components/product-card-badges.tsx');
must(!/<Badge\b/.test(detail),
  '상세 머리에 상자 뱃지가 다시 생겼습니다.',
  'components/ProductDetail.tsx');
must(!/<ProductStateMarks p=\{p\} onPhoto/.test(detail) && !/<FavHeart p=\{p\} onPhoto/.test(detail),
  '상세 사진·썸네일에 최근·관심 아이콘이 다시 올라왔습니다.',
  'components/ProductDetail.tsx — 사진 위 오버레이 없음');
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
must(/const paired = !!sec\.pair && !mobile/.test(detail)
  && /span=\{paired \? 4 : 2\}/.test(detail)
  && /widths=\{paired \? \[KV_LABEL_W, undefined, KV_LABEL_W, undefined\] : \[KV_LABEL_W, undefined\]\}/.test(detail),
  '웹 차량스펙의 두 항목쌍 표가 한 줄 표로 되돌아갔습니다. 모바일만 한 항목쌍 한 줄입니다.',
  'components/ProductDetail.tsx — sec.pair + mobile 분기');
must(/colSpan=\{paired \? 3 : undefined\}/.test(detail)
  && /const firstSingle = hasChips && sec\.chipsAfter === 0 && i === 0/.test(detail)
  && /if \(hasChips && i === sec\.chipsAfter\)/.test(detail),
  '웹 차량스펙의 세부모델·선택옵션 전체 줄 위치가 바뀌었습니다.',
  'components/ProductDetail.tsx — paired chipRow');

/* ── 4. 색 사다리 ── */
must(!/purple|teal|amber|green/.test(priceTable),
  '대여료표에 새 색(hue)이 들어왔습니다. 색은 네이비 하나, 다른 건 세기뿐입니다.',
  'docs/DESIGN_COLOR_LADDER.md');

if (fails.length) {
  console.error(`\n✗ 확정 디자인이 바뀌었습니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`   · ${f}\n`);
  console.error('  바꾸려면: 사장님께 여쭙고 → docs/DESIGN_CONFIRMED_LIST_CARD.md 를 고치고 → 이 검사를 고칩니다.\n');
  process.exit(1);
}
console.log('✓ 확정 디자인 유지 — 목록·카드·상세·색 사다리 정합');
