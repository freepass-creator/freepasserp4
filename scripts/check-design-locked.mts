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
must(!/\['상품', /.test(product),
  '상세 「상품」 줄이 되살아났습니다. 차량번호와 같은 말을 두 번 합니다.',
  'lib/domain/product.ts detailSections');

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
