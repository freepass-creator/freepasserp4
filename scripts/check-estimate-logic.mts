/**
 * 견적·원가 **계산 로직**이 확정된 규칙에서 벗어나지 않게 지킨다
 * (사장님 2026-09-07 「코덱스랑 **그때그때 헤매지 않게끔 로직을 확실하게 박아서** 가자」).
 *
 * 정본은 `docs/견적-원가-로직.md`. 여기 항목은 그 문서의 각 줄과 1:1이다.
 * 코드가 문서를 벗어나면 **여기서 멈춘다.**
 *
 * 왜 필요한가 — 2026-09-07 하루에 같은 자리를 여러 번 헤맸다:
 *   자동차세 경계가 법과 달랐고(엑셀 오류를 그대로 옮겼다), 배기량이 79쌍 중 32에서 null 이라
 *   **자동차세가 조용히 0** 으로 빠졌으며, 그걸 `safe-calc` 도 안 잡았다.
 *   문서만으로는 안 지켜진다. 다음 세션은 문서를 안 읽고 코드부터 고친다.
 *
 * 바꾸려면: 사장님께 여쭙고 → 문서를 고치고 → 이 검사를 고친다. 그 차례를 지킨다.
 * ⚠ 이 검사를 «먼저» 고쳐 통과시키는 것은 규격을 지운 것과 같다.
 */
import { readFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fails: string[] = [];
const must = (ok: boolean, what: string, where: string) => { if (!ok) fails.push(`${what}\n      → ${where}`); };

const cfg = read('lib/domain/estimate/data/cost-config.js');
const calc = read('lib/domain/estimate/calc.js');
const carIndex = read('lib/domain/estimate/car-index.ts');
const settings = read('lib/domain/estimate/cost-settings.ts');
const turnover = read('lib/domain/estimate/turnover-cost.js');
const quoteInput = read('lib/domain/estimate/quote-input.js');
const page = read('app/estimate/page.tsx');
const costPage = read('app/estimate/cost/page.tsx');
const residual = read('lib/domain/estimate/residual-lookup.js');

/* ── 1-1. 자동차세 경계는 «이하» — 법정(지방세법 §127) ─────────────────
   ⚠ 2,499 · 1,599 로 돌아가면 정확히 2,500cc·1,600cc 인 차가 한 단계 위 세율을 문다.
     1,600 은 아반떼·셀토스·코나가 쓰는 가장 흔한 배기량이고 구독 기준 차이가 43% 다. */
must(/maxCc:\s*1600,\s*perCc:\s*18/.test(cfg) && /maxCc:\s*2500,\s*perCc:\s*19/.test(cfg),
  '렌트 자동차세 경계가 법과 다릅니다 — 1,600 이하 18원 · **2,500 이하** 19원 · 초과 24원',
  'lib/domain/estimate/data/cost-config.js CHANNEL.rent.cartaxBrackets');
must(/maxCc:\s*1000,\s*perCc:\s*104/.test(cfg) && /maxCc:\s*1600,\s*perCc:\s*182/.test(cfg),
  '구독 자동차세 경계가 법과 다릅니다 — 1,000 이하 104원 · **1,600 이하** 182원 · 초과 260원',
  'lib/domain/estimate/data/cost-config.js CHANNEL.sub.cartaxBrackets');
must(!/maxCc:\s*(2499|1599)\b/.test(cfg),
  '자동차세 경계에 2499·1599 가 살아 있습니다 — 엑셀 원식(`cc<2500`)의 오류입니다. 법은 «이하» 입니다',
  'lib/domain/estimate/data/cost-config.js');

/* ── 1-2. 전기차 — 취득세 감면 140만 · 공채 면제 · 보조금은 price 단계에서 먼저 ── */
must(/ev:\s*\{[^}]*acqTaxCredit:\s*1400000/.test(cfg),
  '전기차 취득세 감면(140만)이 빠졌습니다 — 법정입니다',
  'lib/domain/estimate/data/cost-config.js FUEL.ev.acqTaxCredit');
must(/ev:\s*\{[^}]*bondExempt:\s*true/.test(cfg),
  '전기차 공채 면제가 빠졌습니다 — 전기차는 채권 매입 의무가 없습니다',
  'lib/domain/estimate/data/cost-config.js FUEL.ev.bondExempt');
must(/fuelCfg\.acqTaxCredit/.test(calc) && /fuelCfg\.bondExempt/.test(calc),
  '엔진이 전기차 감면·면제를 «읽지 않습니다» — 선언만 두면 적용되는 줄 오해합니다',
  'lib/domain/estimate/calc.js');
must(/const evSubsidy\s*=\s*fuel === 'ev'/.test(calc) && /const netPrice\s*=\s*Math\.max\(0,\s*price - evSubsidy\)/.test(calc),
  '전기차 보조금이 `price` 단계에서 «먼저» 빠지지 않습니다 — 취득세·공채·잔가·보증금이 다 같이 낮은 값 기준이어야 합니다',
  'lib/domain/estimate/calc.js');

/* ── 2. 배기량 — 지어내지 않는다. 못 찾으면 «화면이 묻는다» ───────────── */
must(/export function ccFromFuelLabel/.test(carIndex),
  '신차 배기량을 연료 표기에서 뽑는 길이 사라졌습니다 — 이름 매칭만으로는 79쌍 중 32이 null 이 됩니다',
  'lib/domain/estimate/car-index.ts ccFromFuelLabel');
must(/const fromLabel = ccFromFuelLabel\(fuel\);/.test(carIndex) && /if \(fromLabel\) return fromLabel;/.test(carIndex),
  '`guessCc` 가 연료 표기를 «먼저» 보지 않습니다 — 남의 인덱스 이름 추측보다 그게 원천에 가깝습니다',
  'lib/domain/estimate/car-index.ts guessCc');
must(/const needCc = !picked\.cc;/.test(page) && /\{needCc \?/.test(page),
  '배기량이 없을 때 화면이 «묻지» 않습니다 — `Number(null)=0` 이라 자동차세가 조용히 0 으로 빠집니다',
  'app/estimate/page.tsx needCc');

/* ── 3-1. 손잡이가 겹치지 않게 ───────────────────────────────────────── */
must(/markupUsedPct:\s*0,\s*markupNewPct:\s*0/.test(settings),
  '차량가 업금액 기본값이 0 이 아닙니다 — 얹은 금액은 잔가에 안 붙어 통째로 감가가 됩니다. 마진은 목표 수익률에서 잡습니다',
  'lib/domain/estimate/cost-settings.ts COST_DEFAULTS');
must(/badDebtPct:\s*0/.test(settings),
  '대손 충당 기본값이 0 이 아닙니다 — 신용 위험은 손바뀜에서 이미 원가로 잡습니다(두 번 잡힙니다)',
  'lib/domain/estimate/cost-settings.ts COST_DEFAULTS');
must(/vatBase:\s*'excluded'/.test(settings),
  '운영이 VAT 제외 기준이 아닙니다 — 감가를 VAT 포함가로 잡고 대여료에 VAT 를 또 물리면 이중 부과입니다',
  'lib/domain/estimate/cost-settings.ts configFrom');

/* ── 3-2. 손바뀜 = 횟수 × 회당 · 반납률만 신용을 탄다 · 휴차 1개월 확정 ── */
must(/1 \/ \(retention \|\| 0\.30\) - 1/.test(turnover),
  '손바뀜 횟수 산식이 바뀌었습니다 — 「1 ÷ 반납률 − 1」 입니다',
  'lib/domain/estimate/turnover-cost.js expectedTurnovers');
must(/retentionNormalPct:\s*97,\s*retentionMidPct:\s*75,\s*retentionLowPct:\s*30/.test(settings),
  '신용 구간별 반납률이 바뀌었습니다 — A 97 · B 75 · C 30',
  'lib/domain/estimate/cost-settings.ts COST_DEFAULTS');
must(/turnoverVacancyMonths:\s*1\b/.test(settings),
  '휴차 공실이 1개월이 아닙니다 — 사장님 「평균 한 달은 잡아야 보수적으로 책정할 수 있다」. 줄이려면 먼저 여쭙니다',
  'lib/domain/estimate/cost-settings.ts COST_DEFAULTS');
must(/Math\.max\(0,\s*gross - penalty\)/.test(turnover),
  '손바뀜 회당 순비용이 0 밑으로 내려갈 수 있습니다 — 위약금이 커도 원가가 음수가 되면 안 됩니다',
  'lib/domain/estimate/turnover-cost.js turnoverCost');

/* ── 3-3. 위약금 = 월납 × 보증금 개월 × 회수율 · 회수율만 신용을 탄다 ─── */
must(/rent \* \(c\.depositMonths \|\| 0\) \* \(c\.penaltyRecoveryRate \|\| 0\)/.test(turnover),
  '위약금이 「월납 × 보증금 개월 × 회수율」이 아닙니다 — 정액 한 칸으로는 「저신용은 거의 못 받는다」가 안 잡힙니다',
  'lib/domain/estimate/turnover-cost.js');
must(/depositMonths:\s*2,/.test(settings),
  '보증금 개월 수 기본값이 2 가 아닙니다 — 사장님 「저신용 보증금은 한두 달 치」',
  'lib/domain/estimate/cost-settings.ts COST_DEFAULTS');
must(/penaltyRecoveryAPct:\s*80,\s*penaltyRecoveryBPct:\s*50,\s*penaltyRecoveryCPct:\s*10/.test(settings),
  '위약금 회수율이 바뀌었습니다 — A 80 · B 50 · C 10(저신용은 미납·수리비로 보증금이 이미 소진됩니다)',
  'lib/domain/estimate/cost-settings.ts COST_DEFAULTS');

/* ── 3-4. 잔가 = 표준 곡선 + 차종 델타 · 신용과 무관 ──────────────────── */
must(/1:\s*85,\s*2:\s*75,\s*3:\s*66,\s*4:\s*58,\s*5:\s*51/.test(residual),
  '국산 표준 잔가 곡선이 바뀌었습니다 — 1년 85 · 2년 75 · 3년 66 · **4년 58** · 5년 51',
  'lib/domain/estimate/residual-lookup.js STANDARD');
must(!/residual[A-Za-z]*(정상|중신용|저신용)/.test(settings) && !/creditResidual/.test(settings),
  '잔가가 신용을 타고 있습니다 — 잔가는 신용과 «무관»합니다. 신용은 대여료로만 갈립니다',
  'lib/domain/estimate/cost-settings.ts');

/* ── 4. 엔진 연료 키는 영문이다 ─────────────────────────────────────── */
must(/gasoline:|diesel:|lpg:|hybrid:|ev:/.test(cfg) && !/'가솔린':|'전기':/.test(cfg),
  '엔진 연료 키에 한글이 섞였습니다 — 키는 `gasoline`·`diesel`·`lpg`·`hybrid`·`ev` 이고 화면이 `engineFuel()` 로 정규화합니다',
  'lib/domain/estimate/data/cost-config.js FUEL');
must(/evSubsidy: adminCfg\?\.evSubsidy \?\? 0/.test(quoteInput),
  '전기차 보조금이 엔진까지 실려 가지 않습니다',
  'lib/domain/estimate/quote-input.js');

/* ── 원가 화면이 «법정값은 못 고친다»고 말하는가 ───────────────────── */
/* 문서 §1-2 는 「화면에 없음」= «고칠 수 없음» 이라는 뜻이다. 읽기 전용 «표시»는 오히려 있어야 한다 —
   안 보이면 다음 사람이 감면을 또 넣어 두 번 깎는다. (2026-09-07 코덱스가 문서·검사 불일치로 지적) */
must(/전기차 취득세 감면/.test(costPage) && /value="1,400,000" disabled/.test(costPage),
  '원가 화면이 전기차 취득세 감면을 «읽기 전용»으로 보여 주지 않습니다 — 안 보이면 다음 사람이 또 넣습니다',
  'app/estimate/cost/page.tsx');

/* ══════════════════════════════════════════════════════════════════════════
   ★화면 규격 — 정본 `docs/견적기-원본-학습.md` §4-2
     사장님 2026-09-07 「코덱스랑 **페이지 규격 맞추면서** 해 … 이것도 중요하다」.
     원본(손오공·웰릭스)에서 배우는 것은 «무엇이 어느 칸에 있나»이고,
     칸의 **넓이는 우리 공통규격**(`components/WorkPage.tsx` 1:1:1:1)을 쓴다.
   ══════════════════════════════════════════════════════════════════════════ */
const guestSurface = read('lib/guest-surface.ts');
const estCss = read('components/estimate/estimate.css');
const costCss = read('components/estimate/cost.css');
const picker = read('features/estimate/CarPicker.tsx');
const workPage = read('components/WorkPage.tsx');

/* ㉮ 견적은 **ERP «안»의 페이지**다 — 상단바·전체메뉴를 입는다.
     ⚠ 2026-09-07 사장님이 바로잡으셨다 — 「난 로그인해서 «내부 페이지»처럼 하자는 거였음」.
       9/6 「완전 별도 페이지」를 «껍데기를 벗어라»로 읽고 `guest-surface` 에 넣었던 것이 어긋난 것이었다. */
must(/const OWN_HEADER_PREFIXES = \[\] as const;/.test(guestSurface),
  '견적이 ERP 상단바를 다시 벗고 있습니다 — 「내부 페이지처럼」이 규격입니다(`OWN_HEADER_PREFIXES` 는 비어 있어야 합니다)',
  'lib/guest-surface.ts');
must(!/className="wm"/.test(page) && !/className="wm"/.test(costPage),
  '견적·원가 자체 머리에 워드마크가 다시 섰습니다 — ERP 상단바가 위에 있어 머리가 둘이 됩니다(노브랜드 규칙)',
  'app/estimate/**/page.tsx');

/* ㉠ 기둥 1:1:1:1 — 견적·원가 둘 다 */
must(/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(estCss),
  '견적 웹 기둥이 1:1:1:1 이 아닙니다 — 공통규격(`WorkPage` 기본 ratio 1)에 맞춥니다',
  'components/estimate/estimate.css');
must(/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(costCss),
  '원가 웹 기둥이 1:1:1:1 이 아닙니다 — 견적과 같은 규격입니다',
  'components/estimate/cost.css');
must(/defaultPaneRatio = panes\.length === 1 \? 3 : 1/.test(workPage),
  '공통규격(`WorkPage`)의 기본 패널 비율이 1 이 아닙니다 — 견적·원가가 그 값에 맞춰져 있습니다',
  'components/WorkPage.tsx');
/* 접힘 1000px — 원본 손오공과 같은 자리 */
must(/@media \(min-width:1000px\)/.test(estCss) && /@media \(min-width:1000px\)/.test(costCss),
  '웹 기둥이 서는 분기점이 1000px 이 아닙니다 — 원본 손오공(`App.vue:1021`)과 같은 자리입니다',
  'components/estimate/*.css');
/* 마지막 기둥만 선이 없다 — WorkPage 와 같은 규칙 */
must(/\.col\.c3\.wide\{grid-column:span 2/.test(estCss),
  '손익표가 «두 칸»을 안 씁니다 — 표 최소폭이 760px 인데 한 칸(1600 화면에서 400)에서는 못 읽습니다',
  'components/estimate/estimate.css .col.c3.wide');
must(/\.col\.c4\{border-right:0\}/.test(costCss),
  '원가 마지막 기둥에 오른쪽 선이 남아 있습니다 — `WorkPage` 는 마지막 패널만 선을 뺍니다',
  'components/estimate/cost.css');
must(/const narrow = useIsMobile\(1600\);/.test(page),
  '손익표를 «다 들어가는 폭»에서만 펴지 않습니다 — 반쪽만 보이는 표는 안 편 것만 못합니다',
  'app/estimate/page.tsx');

/* ㉡ 폰은 목업 그대로 — 감싸개가 `display:contents` 여야 «없는 셈»이 된다 */
must(/\.est-root \.col\{display:contents\}/.test(estCss),
  '견적 감싸개가 폰에서 «없는 셈»이 아닙니다 — `.col{display:contents}` 가 있어야 목업이 그대로 섭니다',
  'components/estimate/estimate.css');
must(/\.est-root\.cost \.col\{display:contents\}/.test(costCss),
  '원가 감싸개가 폰에서 «없는 셈»이 아닙니다',
  'components/estimate/cost.css');

/* ㉢ 고르는 일에는 모달을 안 쓴다 — 웹은 인라인 */
must(/inline\?: boolean;/.test(picker) && /est-picker inline/.test(picker),
  '차 고르기에 «인라인»이 없습니다 — 원본 둘 다 좌 기둥에 박혀 있고, 모달은 결과물에만 씁니다',
  'features/estimate/CarPicker.tsx');
must(/open=\{mobile \? pickerOpen : true\} inline=\{!mobile\}/.test(page),
  '견적 화면이 웹에서 피커를 «항상 펼치지» 않습니다 — 좌 기둥이 차 고르는 자리입니다',
  'app/estimate/page.tsx');

/* ㉣ 손익표 = 행 항목 · 열 기간 · 숫자는 안 접힌다 */
must(/className="qmx"/.test(page) && /repeat\(\$\{cards\.length\}, minmax\(112px,1fr\)\)/.test(page),
  '손익표가 «행=항목 · 열=기간»이 아니거나 칸 최소폭이 없습니다 — 좁으면 숫자가 겹칩니다',
  'app/estimate/page.tsx .qmx');
must(/white-space:nowrap/.test(estCss) && /\.qmxw\{[^}]*overflow-x:auto/.test(estCss),
  '손익표 숫자가 줄바꿈되거나 표가 제 안에서 안 밀립니다 — 화면 전체가 밀리면 안 됩니다',
  'components/estimate/estimate.css .qmx / .qmxw');

/* ㉤ 컨트롤 — 폰 분기와 입력 16px(iOS 확대 방지) */
must(/--ctrl-input-fs:16px/.test(estCss),
  '폰 입력 글자가 16px 이 아닙니다 — 그 밑이면 iOS 가 탭할 때 화면을 확대합니다',
  'components/estimate/estimate.css');
must(/\.est-root \.modesw > \*/.test(estCss),
  '머리 토글이 «자식 무엇이든» 잡지 않습니다 — `a,button` 만 잡아 활성 `<span>` 이 깨진 적이 있습니다',
  'components/estimate/estimate.css .modesw');

/* ══════════════════════════════════════════════════════════════════════════
   ★★여기부터는 **동작**을 잰다 — 문자열이 있는지가 아니라 «엔진을 돌려 값이 맞는지».

   2026-09-07 코덱스 지적: 위 정규식들은 「배기량 null → 자동차세 0」을 **못 막았다**
   (입력칸이 «있는지»만 봤지 «막는지»는 안 봤다). 문자열 검사는 표기를 바꾸면 통과하고,
   같은 결과를 내는 다른 구현(`<=` → `<`)도 못 잡는다.
   ⇒ 돈이 걸린 자리는 **계산해서 확인한다.**
   ══════════════════════════════════════════════════════════════════════════ */
const { computeTerm } = await import('../lib/domain/estimate/calc.js');
const { safeComputeTerm } = await import('../lib/domain/estimate/safe-calc.js');

/** 자동차세만 보려고 최소 입력으로 한 해를 돌린다. */
function cartax(channel: 'rent' | 'sub', cc: number, fuel = 'gasoline'): number {
  const r = computeTerm(12, {
    channel, type: 'return', price: 30_000_000, cc, fuel, accident: 'none',
    group: 'A', residualRates: { 12: 0.85, 24: 0.75, 36: 0.66, 48: 0.58, 60: 0.51 },
  }) as { cost?: { cartax?: number } };
  return Math.round(r.cost?.cartax ?? 0);
}

/* 1-1 경계 «이하» — 정확히 1,600cc·2,500cc 가 낮은 구간에 들어가야 한다. */
/* ⚠ 세액이 아니라 **cc 당 원단위**를 견준다 — 2,500 과 2,499 는 cc 가 다르니 세액도 당연히 다르다.
   같은 «구간»에 있는지가 물음이다(2026-09-07 처음에 세액을 견줘 헛경보를 냈다). */
const perCc = (ch: 'rent' | 'sub', cc: number) => cartax(ch, cc) / cc;
must(Math.abs(perCc('rent', 2500) - perCc('rent', 2499)) < 0.01,
  `렌트 2,500cc 가 2,499cc 와 다른 구간입니다(cc당 ${perCc('rent', 2500).toFixed(2)} vs ${perCc('rent', 2499).toFixed(2)}) — 법은 「2,500 이하」입니다`,
  'lib/domain/estimate/data/cost-config.js CHANNEL.rent.cartaxBrackets');
must(perCc('rent', 2501) > perCc('rent', 2500) + 0.01,
  '렌트 2,501cc 가 2,500cc 보다 비싸지 않습니다 — 초과 구간(24원)이 살아 있어야 합니다',
  'lib/domain/estimate/data/cost-config.js');
must(Math.abs(perCc('sub', 1600) - perCc('sub', 1599)) < 0.01,
  `구독 1,600cc 가 1,599cc 와 다른 구간입니다(cc당 ${perCc('sub', 1600).toFixed(2)} vs ${perCc('sub', 1599).toFixed(2)}) — 법은 「1,600 이하」입니다`,
  'lib/domain/estimate/data/cost-config.js CHANNEL.sub.cartaxBrackets');
must(perCc('sub', 1601) > perCc('sub', 1600) + 0.01,
  '구독 1,601cc 가 1,600cc 보다 비싸지 않습니다 — 초과 구간(260원)이 살아 있어야 합니다',
  'lib/domain/estimate/data/cost-config.js');

/* 2. 배기량 미확정 — «조용히 0» 이 아니라 깃발이 서야 한다.
      ⚠ 이것이 코덱스가 「못 막는다」고 한 자리다. 이제 계산해서 확인한다. */
const noCc = safeComputeTerm(48, {
  channel: 'rent', type: 'return', price: 30_000_000, cc: null, fuel: 'gasoline', accident: 'none',
  group: 'A', residualRates: { 12: 0.85, 24: 0.75, 36: 0.66, 48: 0.58, 60: 0.51 },
}, {}) as { incompleteCc?: boolean; calcError?: boolean };
must(noCc.incompleteCc === true,
  '내연기관인데 배기량이 없을 때 «미완성» 깃발이 안 섭니다 — 자동차세가 0 으로 잡히고 아무도 모릅니다',
  'lib/domain/estimate/calc.js incompleteCc');
must(/incompleteCc/.test(page),
  '화면이 배기량 미확정을 «말하지» 않습니다 — 깃발만 세우고 안 보여 주면 없는 것과 같습니다',
  'app/estimate/page.tsx');

/* 전기차는 배기량이 없는 것이 정상이라 깃발이 서면 안 된다. */
const evNoCc = safeComputeTerm(48, {
  channel: 'rent', type: 'return', price: 40_000_000, cc: null, fuel: 'ev', accident: 'none',
  group: 'A', residualRates: { 12: 0.85, 24: 0.75, 36: 0.66, 48: 0.58, 60: 0.51 },
}, {}) as { incompleteCc?: boolean };
must(evNoCc.incompleteCc === false,
  '전기차에 배기량 미완성 깃발이 섰습니다 — 전기차는 배기량이 없는 것이 정상입니다',
  'lib/domain/estimate/calc.js');

/* 1-2. 전기차 보조금이 «취득가부터» 빠지는가 — 잔가·보증금까지 같이 내려가야 한다. */
const evBase = { channel: 'rent' as const, type: 'return' as const, price: 48_000_000, cc: 0, fuel: 'ev',
  accident: 'none', group: 'A', residualRates: { 12: 0.85, 24: 0.75, 36: 0.66, 48: 0.58, 60: 0.51 } };
const evNo = computeTerm(48, evBase) as { residualAmt: number; deposit: number };
const evYes = computeTerm(48, { ...evBase, evSubsidy: 6_000_000 }) as { residualAmt: number; deposit: number };
must(evYes.residualAmt < evNo.residualAmt && evYes.deposit < evNo.deposit,
  '전기차 보조금이 잔가·보증금까지 안 내려갑니다 — `price` 단계에서 «먼저» 빼야 앞뒤가 맞습니다',
  'lib/domain/estimate/calc.js netPrice');

/* 4. 연료 정규화 — 영문 「EV」도 전기차다. 「PHEV」는 하이브리드다.
     ⚠ 2026-09-07 전수 검사에서 잡혔다 — 신차마스터가 기아 전기차를 「EV」로 싣는데
       한글 「전기」만 봐서 **EV3·EV4·EV5·EV6 가 통째로 가솔린으로 계산**됐다.
       보조금·취득세 감면·공채 면제가 하나도 안 걸리고 자동차세는 cc 가 없어 0 이 됐다. */
const { engineFuel } = await import('../lib/domain/estimate/car-index');
for (const [label, want] of [['EV', 'ev'], ['ev', 'ev'], ['전기', 'ev'], ['EV 롱레인지', 'ev'],
  ['PHEV', 'hybrid'], ['하이브리드', 'hybrid'], ['3.5 가솔린', 'gasoline'], ['디젤', 'diesel']] as const) {
  must(engineFuel(label) === want,
    `연료 「${label}」가 «${engineFuel(label)}» 로 잡힙니다 — «${want}» 여야 합니다`,
    'lib/domain/estimate/car-index.ts engineFuel');
}

/* 3-2. 손바뀜 — 반납률이 낮을수록 원가가 커야 한다(30% > 75% > 97%). */
const { turnoverCost } = await import('../lib/domain/estimate/turnover-cost.js');
const tLow = turnoverCost('저신용', { monthlyRent: 600_000, term: 48, retention: 0.30 });
const tMid = turnoverCost('중신용', { monthlyRent: 600_000, term: 48, retention: 0.75 });
const tHi = turnoverCost('정상', { monthlyRent: 600_000, term: 48, retention: 0.97 });
must(tLow > tMid && tMid > tHi,
  `손바뀜 원가가 반납률을 안 따릅니다(저 ${Math.round(tLow)} · 중 ${Math.round(tMid)} · 정상 ${Math.round(tHi)})`,
  'lib/domain/estimate/turnover-cost.js');

/* 3-3. 위약금 — 보증금·회수율이 커지면 손바뀜 원가가 «줄어야» 하고, 0 밑으로는 안 간다. */
const tNoPen = turnoverCost('저신용', { monthlyRent: 600_000, term: 48, retention: 0.30 });
const tPen = turnoverCost('저신용', { monthlyRent: 600_000, term: 48, retention: 0.30, depositMonths: 2, penaltyRecoveryRate: 0.8 });
must(tPen < tNoPen && tPen >= 0,
  '위약금이 손바뀜 원가를 안 깎거나 음수가 됩니다 — 상쇄는 하되 0 밑으로는 안 내려갑니다',
  'lib/domain/estimate/turnover-cost.js');

if (fails.length) {
  console.error(`\n✗ 견적 로직이 정본과 다릅니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`  · ${f}\n`);
  console.error('  정본: docs/견적-원가-로직.md');
  console.error('  바꾸시려면 — 사장님께 여쭙고 → 문서를 고치고 → 이 검사를 고칩니다.');
  console.error('  ⚠ 이 검사를 «먼저» 고쳐 통과시키는 것은 규격을 지운 것과 같습니다.\n');
  process.exit(1);
}
console.log('✓ 견적 정합 — 법정값 · 배기량 · 원가 갈래 · 손바뀜 · 위약금 · 잔가 · **화면 규격(1:1:1:1)**');
