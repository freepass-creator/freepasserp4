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
import { splitNote, readRule, rulesFrom, priceOf } from '../lib/domain/estimate/option-note';
import { impliedOf } from '../lib/domain/estimate/implied-options';
import { modelKey, basisOf, expandGenesis } from '../lib/domain/estimate/genesis-lineup';
import { matchIncluded } from '../lib/domain/estimate/genesis-included';
import { trimPrice, trimBasis, trimSaleTaxCredit } from '../lib/domain/estimate/car-index';
import { splitAxis } from '../lib/domain/estimate/newcar-normalize';
import { optionList, optionSum, isEnabled, toggleOption, type OptionSpec } from '../lib/domain/estimate/option-rules';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/** 소스에서 «주석을 걷은» 코드만 — 개발센터 SSOT 의견서 FP-SSOT-04:
 *  검사기가 파일 전체 문자열로 판정하면 **주석에만 있어도 초록**이 된다(재현됨). */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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
must(/const evSubsidy\s*=\s*fuel === 'ev'/.test(calc) && /const netPrice\s*=\s*Math\.max\(0,\s*price - evSubsidy(?: - saleTaxCredit)?\)/.test(calc),
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
   ★화면 규격 — **웰릭스 테이블 그대로**. 정본 `docs/견적기-원본-학습.md` §4-2
     사장님 2026-09-07 「야 일단 **웰릭스 테이블을 그대로 복사**해와봐」
                       「거기서 **신차에서 중고차로만 변환**하고 **원가구조만 다르게** 쓰면 되는 거잖아」
     ⇒ 칸의 넓이까지 원본 것이다(400px · 52fr · 20fr). 예전 규격(우리 1:1:1:1)은 이때 폐기됐다.
       바꾼 것은 딱 둘 — ㉠ 왼쪽이 신차 카탈로그가 아니라 «중고 차종 + 시세·연식·주행»
                        ㉡ 셋째 칸이 계약·채팅이 아니라 «우리 원가·손익»
   ══════════════════════════════════════════════════════════════════════════ */
const guestSurface = read('lib/guest-surface.ts');
const wxCss = read('components/estimate/welrix.css');
/* 원가 화면은 여전히 견적 «옛» CSS 를 밑에 깔고 선다(`app/estimate/cost/page.tsx` 가 둘 다 싣는다).
   견적 화면만 웰릭스로 갈아탔다. */
const estCss = read('components/estimate/estimate.css');
const costCss = read('components/estimate/cost.css');
const picker = read('features/estimate/CarPicker.tsx');
const cascade = read('features/estimate/VehicleCascade.tsx');
const carIndexSrc = read('lib/domain/estimate/car-index.ts');
const pickerCss = read('components/estimate/picker.css');
const newcarApi = read('app/api/newcar/route.ts');
const gate = read('features/estimate/EstimateGate.tsx');
const costApi = read('app/api/estimate/cost/route.ts');
const workPage = read('components/WorkPage.tsx');

/* ㉭ ★★«임시 공개» — 사장님 2026-09-08 「일단 모두 공개로 해주고 **로그인할지 말지는 나중에**」.
     ⚠ 이건 규격이 아니라 **임시 상태**다. 검사는 「열려 있다」가 아니라 **「열어 둔 것을 알고 있다」**를 지킨다:
       ㉠ 문지기(`EstimateGate`)를 **지우지 않았다** — 닫을 때 한 줄만 걷으면 명단이 되살아난다
       ㉡ 원가 **쓰기(PUT)는 여전히 관리자만**이다 — 열면 아무나 우리 대여료를 바꾼다
     ⇒ 닫을 때는 `lib/public-access.ts` 의 세 줄과 `PUBLIC_READ` 를 되돌린다. */
must(/canSeeEstimate/.test(gate),
  '문지기의 명단이 «지워졌습니다» — 임시 공개는 문을 지우는 게 아니라 열어 두는 것입니다',
  'features/estimate/EstimateGate.tsx');
must(/if \(!admin\) return NextResponse\.json\(\{ error: 'forbidden' \}/.test(costApi),
  '원가 **쓰기**가 열렸습니다 — 열면 아무나 우리 대여료를 바꿉니다(읽기만 임시 공개입니다)',
  'app/api/estimate/cost/route.ts PUT');

/* ㉮ ★★견적기는 **별도 페이지**다 — ERP 상단바를 벗는다(2026-09-08 확정).
     사장님 「이거 **별도 페이지**라서 위에 **상단바 없어도 되고**, 프리패스erp 내의 페이지가 아니라
     **별도 페이지**야」 · 「**나중에 합치더라도 별도로 운용할 계획**임」
   ⇒ 같은 날 셋이 한 방향으로 움직였다 — ㉠ 모두 공개(로그인 없음) ㉡ 「웰릭스·손오공은 없고
     **프리패스 견적기**로 간다」 ㉢ 별도 페이지. 견적기는 ERP 의 한 층이 아니라 «따로 서는 물건»이다.
   ★길은 자체 머리에 있다 — `.global-topbar` 의 「견적내기 | 원가설정」 토글.
   ⚠ 2026-09-07 에는 반대였다(「난 로그인해서 «내부 페이지»처럼 하자는 거였음」). **뒤엣것이 이긴다** —
     그때는 로그인이 걸려 있고 ERP 메뉴로만 들어오는 화면이었다. 지금은 아니다. */
must(/const OWN_HEADER_PREFIXES = \['\/estimate'\] as const;/.test(guestSurface),
  '견적이 ERP 상단바를 다시 입고 있습니다 — 「별도 페이지」가 규격입니다',
  'lib/guest-surface.ts');
/* ★★머리 띠가 «없는» 것이 규격이다 — 사장님 2026-09-08
     「**상단바 없고 그냥 이거 자체가 별도 페이지야**」.
   ERP 상단바도, 견적기 «자체» 머리 띠(`.global-topbar`)도 없다. 화면이 곧 페이지다.
   ★길은 끊기지 않았다 — 견적은 맨 아래 주석 줄의 「원가설정」, 원가는 「← 견적으로」 한 줄.
   ⚠ 판의 «행»도 하나여야 한다 — 원본은 `48px 1fr`(첫 행이 머리 자리)이라, 머리를 걷고 그 행을
     그대로 두면 왼쪽 기둥이 48px 칸에 갇혀 통째로 잘린다(2026-09-08 실측으로 잡음). */
must(!/className="global-topbar"/.test(page) && !/className="global-topbar"/.test(costPage),
  '머리 띠가 다시 섰습니다 — 「그냥 이거 자체가 별도 페이지」가 규격입니다',
  'app/estimate/**/page.tsx');
must(/\.wx-root \{ grid-template-rows: 1fr; \}/.test(wxCss),
  '판의 행이 아직 «머리 자리»를 남기고 있습니다 — 왼쪽 기둥이 48px 에 갇혀 잘립니다',
  'components/estimate/welrix.css');
must(/원가설정<\/Link>/.test(page) && /← 견적으로/.test(costPage),
  '두 화면 사이 길이 끊겼습니다 — 띠가 없으니 화면 안에 글자로 남아 있어야 합니다',
  'app/estimate/**/page.tsx');

must(!/className="wm"/.test(page) && !/className="wm"/.test(costPage),
  '견적·원가 자체 머리에 워드마크가 다시 섰습니다 — ERP 상단바가 위에 있어 머리가 둘이 됩니다(노브랜드 규칙)',
  'app/estimate/**/page.tsx');

/* ㉠ 기둥 = 원본 그대로 400px · 52fr · 20fr */
must(/grid-template-columns: 400px minmax\(0, 52fr\) minmax\(0, 20fr\);/.test(wxCss),
  '견적 웹 기둥이 원본(400px · 52fr · 20fr)과 다릅니다 — 웰릭스 테이블을 그대로 씁니다',
  'components/estimate/welrix.css');
must(/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(costCss),
  '원가 웹 기둥이 1:1:1:1 이 아닙니다 — 원가는 «우리» 화면이라 공통규격을 씁니다',
  'components/estimate/cost.css');
must(/defaultPaneRatio = panes\.length === 1 \? 3 : 1/.test(workPage),
  '공통규격(`WorkPage`)의 기본 패널 비율이 1 이 아닙니다 — 원가 화면이 그 값에 맞춰져 있습니다',
  'components/WorkPage.tsx');

/* ㉡ ★웰릭스 CSS 는 «가둬져» 있어야 한다 — 안 그러면 ERP 전체가 웰릭스 톤으로 물든다.
      원본은 `body`·`html`·`*`·`:root` 를 전역으로 리셋한다. 하나라도 새면 사고다. */
must(!/^\s*(body|html|\*|:root)\s*[,{]/m.test(wxCss),
  '웰릭스 CSS 의 전역 리셋이 «샜습니다» — `.wx-root` 밖으로 나가면 ERP 전체가 물듭니다',
  'components/estimate/welrix.css');
must(/scripts\/extract-welrix-css\.py/.test(wxCss),
  '웰릭스 CSS 가 «손으로» 고쳐진 것 같습니다 — 생성기가 만든 파일이어야 합니다(원본이 바뀌면 다시 돌립니다)',
  'components/estimate/welrix.css');
/* 웰릭스 CI 레드는 남의 간판이다 — 액센트만 프리패스 남색으로 돌려 둔다(노브랜드 규칙). */
must(/--brand: #1B2A4A;/.test(wxCss),
  '웰릭스 CI 레드가 되살아났습니다 — 액센트는 프리패스 남색입니다(브랜드 표식은 안 세운다)',
  'components/estimate/welrix.css 프리패스 덧칠');

/* ㉢ 고르는 일에는 모달을 안 쓴다 — 웹은 좌 기둥에 인라인 */
must(/inline\?: boolean;/.test(picker) && /est-picker inline/.test(picker),
  '차 고르기에 «인라인»이 없습니다 — 원본 둘 다 좌 기둥에 박혀 있고, 모달은 결과물에만 씁니다',
  'features/estimate/CarPicker.tsx');
/* ★2026-09-08 뒤집힘 — 9/7 에는 「웹은 피커를 좌 기둥에 통째로 펼친다」가 규격이었다.
     사장님 「차량 선택하는 거는 **저렇게 굵을 필요 없고**」 · 「**버튼만** 만들어 주면 되고」
             「차량 고르는 거는 **딱딱 누르는 거에 연동**이 되어야지」
   ⇒ 왼쪽은 **캐스케이드 넷**(제조사→모델→파워트레인/연료→트림)이다. 판을 박지 않는다.
     ⚠ 9/7 「왜 패널이 새로 뜨니」와 부딪히지 않는다 — 그건 «왼쪽에서 다 고른 뒤 또» 뜬 것을
       두고 하신 말이고, 지금은 왼쪽에서 고르고 끝난다. */
must(/<VehicleCascade mode=\{cond\}/.test(page),
  '왼쪽이 «딱딱 눌러 이어지는» 차종 캐스케이드가 아닙니다 — 판을 박으면 왼쪽이 굵어집니다',
  'app/estimate/page.tsx VehicleCascade');
must(/id="sec-manufacturer"/.test(cascade) && /id="sec-model"/.test(cascade)
  && /id="sec-variant"/.test(cascade) && /id="sec-trim"/.test(cascade),
  '캐스케이드 칸 이름이 원본 것이 아닙니다 — 웰릭스 CSS 가 그 이름에 「라벨 96 + 한 줄」을 겁니다',
  'features/estimate/VehicleCascade.tsx');
must(!/<CarPicker open inline/.test(page),
  '차 고르기 «판»이 왼쪽에 다시 박혔습니다 — 그게 「굵다」의 정체였습니다(2026-09-08)',
  'app/estimate/page.tsx');

/* ㉣ 원본에 있던 것이 사라지지 않았나 — 손님·담당자 줄과 「손님 발송용 견적」 */
must(/className="cs-form"/.test(page),
  '손님·담당자 줄이 없습니다 — 원본 `CustomerStaffForm` 자리입니다(견적서에 찍혀 나갈 이름)',
  'app/estimate/page.tsx .cs-form');
/* ★★2026-09-08 — 「기본 견적(고정 3장)」·「손님 발송용(자유 3열)」·「오른쪽 손익(기간 탭)」 셋을
     **다섯 줄 한 벌**로 합쳤다.
     사장님 「우측에서 **1년부터 5년까지 설계**되게끔 해주고, 각 기간별로 **수익이나 원가 볼 수 있게끔
     그 라인에 표현**해주면 돼. **우측에 따로 놓지 말고**」
   ⇒ 같은 숫자를 세 군데서 세면 어디를 봐야 하는지가 흐려지고, 다섯 해를 나란히 못 견준다. */
must(/className="qgrid"/.test(page),
  '1~5년이 «가로로» 서 있지 않습니다 — 다섯 해를 나란히 견주는 것이 이 화면의 일입니다',
  'app/estimate/page.tsx .qgrid');
must(/grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/.test(wxCss),
  '기간 칸이 다섯이 아닙니다 — 1년부터 5년까지 가로로 쭉 섭니다',
  'components/estimate/welrix.css .qgrid');
must(/@media \(max-width: 760px\) \{ \.wx-root \.qgrid \{ grid-template-columns: 1fr; \} \}/.test(wxCss),
  '폰에서 기간 칸이 «위아래로» 안 갈립니다 — 폰은 한 해가 한 장입니다',
  'components/estimate/welrix.css .qgrid 폰');
must(/const cogs = v\.rev - v\.opProfit;/.test(page),
  '칸에서 「매출 − 원가 = 영업이익」이 안 맞습니다 — 원가는 «총원가»(매출원가+판관비)입니다',
  'app/estimate/page.tsx cogs');
must(/className="qdetail"/.test(page) && /className="qopen"/.test(page),
  '「원가 펼치기」가 없습니다 — 그 칸 «안»에서 열리는 것이 규격입니다(탭으로 옮겨 다니지 않습니다)',
  'app/estimate/page.tsx .qdetail');
must(/term-card__check/.test(page),
  '「발송」 체크가 없습니다 — 보낼 기간만 고르는 것이 원본 `TermsGrid` 의 핵심입니다',
  'app/estimate/page.tsx .term-card__check');
/* ★고르는 것은 «버튼»이다 — 사장님 2026-09-08 「드랍다운보다는 버튼으로 할 수 있으면 버튼으로 해」.
   드롭다운은 열고 고르느라 두 번 누른다. 통화 중에 그 한 걸음이 그대로 느려짐이 된다. */
/* ★★색상은 «둘»이다 — 사장님 2026-09-08
     「신차마스터에는 **제조사 색상 그대로** 해야지」
     「**중고마스터 색상과 신차마스터 색상은 각각 존재**해야 함」
   ⚠ 색상은 처음부터 있었다 — 크롤러가 받아 Firestore 에 넣는데 **API 가 버리고 있었다**
     (실측 423 트림 중 284 = 67% 에 있다). 화면이 우리 규격색 12색을 대신 보여 준 까닭이다.
   ★값이 붙는 색이 있다 — 「세레니티 화이트 펄 +10만」·「녹턴그레이매트 +30만」.
     옵션과 같이 **차량가에 더한다**(실측: 4,245만 → 4,275만 · 월 150.0만 → 150.9만). */
must(/extColors/.test(newcarApi) && /intColors/.test(newcarApi),
  '신차 API 가 제조사 색상을 «버립니다» — 크롤러는 넣고 있는데 화면까지 못 옵니다',
  'app/api/newcar/route.ts');
must(/isNew && extColors\.length/.test(page) && /EXT_COLORS\.map/.test(page),
  '색상이 갈래별로 갈리지 않습니다 — 신차는 제조사 색, 중고는 규격색입니다',
  'app/estimate/page.tsx #sec-color');
must(/\+ optSum \+ colorAdd/.test(page),
  '유료 색상이 차량가에 «안 붙습니다» — 「+30만」을 골라도 대여료가 그대로입니다',
  'app/estimate/page.tsx listPrice');

/* ★★고르는 «방식»은 **목록 길이**가 정한다(2026-09-08 오후 확정):
     **두셋 = 버튼** — 상품(중고/신차) · 채널 · 만기 · 신용 · 취득
        사장님 「드랍다운보다는 버튼으로 할 수 있으면 버튼으로 해」 — 열고 고르는 두 걸음을 아낀다
     **여럿 = 드롭다운** — 제조사 · 모델 · 세부모델 · 트림 · **색상**
        사장님 「차 고르는 거는 드랍다운으로 해야지… 한 줄 한 줄」 · 「드랍다운처럼 눌러야 선택되게끔」
        칩으로 펴면 열일곱·수십·열둘이 왼쪽을 두세 줄씩 먹는다(실측). */
must(/<Seg tone="t2"/.test(page) && /<Chips opts={CREDIT/.test(page) && /<Chips opts={ACQ/.test(page),
  '두셋 중 하나를 고르는 칸이 버튼이 아닙니다 — 상품·신용·취득은 버튼입니다',
  'app/estimate/page.tsx');
must(/className="color-wrap"/.test(page) && /className="step-dd" value={colorExt}/.test(page),
  '색상이 «드롭다운»이 아닙니다 — 열두 색을 펴면 왼쪽을 두 줄 먹습니다',
  'app/estimate/page.tsx #sec-color');
/* ★★고르는 «방식»은 목록 길이가 정한다 — 사장님 2026-09-08
     오전 「드랍다운보다는 **버튼**으로 할 수 있으면 버튼으로 해」
     오후 「**차 고르는 거는 드랍다운으로 해야지… 한 줄 한 줄.** 신차 같은 경우나 중고차도」
   부딪히지 않는다. **재 보고 갈린 것**이다 — 제조사 열일곱·세부모델 수십을 칩으로 펴니
   왼쪽이 세 줄씩 먹었다. 규칙:
     두셋 = 버튼(상품·채널·만기·신용·취득) · 여럿 = 드롭다운(제조사·모델·세부모델·트림)
     색상만 예외 — **색을 봐야 고르는** 것이라 칩이다. */
must(/className="step-dd"/.test(cascade) && !/tchips/.test(cascade),
  '차 고르기가 «한 줄 드롭다운»이 아닙니다 — 목록이 길면 칩으로 펴서 왼쪽을 먹습니다',
  'features/estimate/VehicleCascade.tsx');
/* 걸음은 갈래마다 다르다 — 중고는 파워트레인 걸음이 «아직» 없다(원자가 없어서). */
must(/mode === 'used' \? '모델' : '세부모델'/.test(cascade)
  && /mode === 'used' \? '세부모델' : '파워트레인'/.test(cascade),
  '걸음 이름이 갈래와 안 맞습니다 — 중고=모델·세부모델·트림 / 신차=세부모델·파워트레인·트림',
  'features/estimate/VehicleCascade.tsx');
/* ★메인컬러는 프리패스 남색 하나 — 웰릭스의 검정(#0a0a0a)이 이기면 버튼이 검게 나온다(실측). */
must(/\.wx-root\.est-root \{[\s\S]{0,300}--accent: #1B2A4A/.test(wxCss),
  '메인컬러가 안 잡혀 있습니다 — 웰릭스의 검정이 이겨 선택 버튼이 검게 나옵니다',
  'components/estimate/welrix.css');

/* ★고르는 칸은 «기존 것»을 쓴다 — 사장님 2026-09-08 「**기존거 활용하라고 했는데**」.
   견적기에는 이미 세그·칩·숫자칸이 있었다: `.seg`·`.chips`·`.pin`(estimate.css) ·
   `.mkrow`·`.tchips`·`.oprow`(picker.css). 새로 만들면 규격이 둘이 되고, 그러면 또 갈린다. */
must(/className={`seg /.test(page) && /className="chips"/.test(page) && /tchips/.test(page),
  '고르는 칸이 «기존 것»이 아닙니다 — `.seg`·`.chips`·`.tchips` 를 씁니다(새로 만들지 않습니다)',
  'app/estimate/page.tsx');
must(/className="pin w"/.test(page),
  '숫자칸이 «기존 것»(`.pin`)이 아닙니다',
  'app/estimate/page.tsx');
must(/est-root/.test(page) && /estimate\.css/.test(page) && /picker\.css/.test(page),
  '기존 견적기 규격을 안 싣고 있습니다 — 칩·세그·숫자칸과 **사선 0** 이 거기 있습니다',
  'app/estimate/page.tsx');
/* ★숫자에 «사선 0» — 사장님 2026-09-08 「숫자 있는 거는 숫자에 사선 나오는 프리텐다드 써야 함」.
   0 과 O 가 안 갈리면 차번·금액을 잘못 읽는다. 원본은 `tabular-nums` 만 걸어 사선이 꺼져 있었다. */
must(!/font-variant-numeric:\s*tabular-nums(?!\s+slashed-zero)/.test(wxCss),
  '숫자에 «사선 0» 이 꺼진 자리가 있습니다 — 0 과 O 가 안 갈립니다',
  'components/estimate/welrix.css');

/* ㉤ 옵션·색상은 «왼쪽 별도 칸»이다 — 원본과 같은 자리(사장님 2026-09-08 「1번으로」) */
must(/id="sec-options"/.test(page) && /id="sec-color"/.test(page),
  '선택 옵션·색상 칸이 왼쪽에 없습니다 — 원본은 차종 밑에 «별도 칸»으로 세웁니다',
  'app/estimate/page.tsx #sec-options / #sec-color');
must(/optionsOutside mode=\{cond\}/.test(page) && /optionsOutside\?: boolean;/.test(picker),
  '차 고르기 시트가 옵션을 «또» 묻습니다 — 두 군데서 고르면 어느 값이 이겼는지 모릅니다',
  'features/estimate/CarPicker.tsx optionsOutside');
must(/const listPrice = isNew \? \(picked\.price \?\? 0\) \+ optSum \+ colorAdd : usedPrice;/.test(page),
  '신차 차량가에 고른 옵션이 «안 더해집니다» — 옵션을 밖에서 고르면 더하는 일은 화면 몫입니다',
  'app/estimate/page.tsx listPrice');
/* 색은 화면이 지어내지 않는다 — 규격색·색칩은 색상마스터 한 곳에서만 온다(로컬 색맵 금지). */
must(/from '@\/lib\/domain\/color-master'/.test(page) && !/#[0-9a-fA-F]{6}/.test(page),
  '색을 화면이 지어냈습니다 — 규격색·색칩은 색상마스터(SSOT)에서만 당깁니다',
  'app/estimate/page.tsx lib/domain/color-master');

/* ★★좌 = «차» · 우 = «견적» — 화면의 뼈대다(사장님 2026-09-08
     「차에 관련된 거만 좌측에서 선택, 우측은 견적에 관련된 거」).
   가르는 법 = 「그 차의 성질인가, 이 견적의 조건인가」.
   채널·만기·신용은 같은 차라도 건마다 달라진다 ⇒ 견적 ⇒ 오른쪽 조건 줄. */
const leftRail = page.slice(page.indexOf('className="wrap"'), page.indexOf('className="total-bar"'));
must(!/CHANNELS\.map/.test(leftRail) && !/TYPES\.map/.test(leftRail) && !/CREDIT\.map/.test(leftRail),
  '채널·만기·신용이 왼쪽에 있습니다 — 왼쪽은 «차», 오른쪽이 «견적»입니다',
  'app/estimate/page.tsx .wrap');
must(/qp-form--conds[\s\S]{0,900}CHANNELS\.map[\s\S]{0,900}CREDIT\.map/.test(page),
  '오른쪽 조건 줄에 채널·만기·신용이 없습니다 — 견적의 조건은 오른쪽에 모입니다',
  'app/estimate/page.tsx .qp-form--conds');

/* ㉦ 원가에 속한 것은 견적 화면에서 «접어» 둔다 + 시세는 «채워 주되 잠그지 않는다»
     사장님 2026-09-08 「기존 웰릭스 손오공거 감안해서 **원가페이지에 들어갈 거는 안 보여주는** 거야」
                     「**잔가 수동 넣기는 숨겨놨다가 꺼내서** 쓸 수 있는 거고」
                     「없으면 **평균시세는 입력해주고 바꿀 수 있게끔**. 평균시세는 틀릴 수 있으니까」 */
/* ★★잔가는 «오른쪽»에 있고 «둘»이다 — 사장님 2026-09-08
     「우는 견적을 확정짓는 곳 — 렌트 구독 반납인수부터 보증금 선납금 수수료 **잔가** 이런 거 선택하는 거지」
     「**그 해당 기간에 잔가를 직접 넣을 수 있게끔** 되는 거야」
     「잔가는 내부에서 **견적용 잔가와 손님 인수용 잔가가 2개**가 있음」
   ⚠ 둘을 한 값으로 묶으면 「손님에게 싸게 넘기려고 잔가를 올렸더니 대여료가 같이 싸지는」 사고가 난다. */
must(/const buyoutPct = /.test(page) && /buyoutOverride/.test(page),
  '잔가가 하나뿐입니다 — 견적용과 손님 인수용은 «다른 값»입니다',
  'app/estimate/page.tsx buyoutPct');
must(/className="term-card__cond resid2"/.test(page),
  '기간 칸에서 잔가를 «직접» 못 넣습니다 — 그 해당 기간에 넣는 것이 규격입니다',
  'app/estimate/page.tsx .resid2');
must(!/id="sec-resid"/.test(page),
  '잔가가 아직 왼쪽에 있습니다 — 왼쪽은 «차량가격을 확정짓는 곳», 잔가는 견적이라 오른쪽입니다',
  'app/estimate/page.tsx');
/* ★인수 잔가가 대여료를 «건드리지 않는지» — 엔진에 들어가는 것은 견적용뿐이다. */
must(/residualDefault = adjustResidual\(raw, cost\.residualAdjustPct\)/.test(page)
  && !/buyoutPct\[[^\]]*\][\s\S]{0,200}createQuoteInput/.test(page),
  '인수 잔가가 대여료 계산에 흘러들었습니다 — 인수용은 만기에 받는 돈이지 월납이 아닙니다',
  'app/estimate/page.tsx createQuoteInput');
/* ★★2026-09-08 사고 — 선택자를 «문자열 치환»으로 넓혔더니 «뒷부분만» 넓어졌다.
     `.est-picker .tchips button` → `.est-root .tchips, .est-picker .tchips button`
   앞은 컨테이너, 뒤는 버튼이 되어 **`.est-root .tchips button` 규칙이 사라졌다.**
   제조사 칩 열일곱이 브라우저 기본 버튼(2px outset)으로 나와 검은 덩어리가 됐다.
   사장님 「야 지금 이거 뭐냐???」 — **내가 바꿔 놓고 눈으로 안 봤다.**
   ⇒ 넓힐 때는 «선택자 통째로» 짝을 짓는다. 기계가 그 짝을 센다. */
for (const sel of ['.est-root .mkrow button', '.est-root .tchips button', '.est-root .oprow .bx']) {
  must(pickerCss.includes(sel),
    `시트 칩 규칙 「${sel}」 이 없습니다 — 선택자를 넓힐 때 «통째로» 짝지어야 합니다`,
    'components/estimate/picker.css');
}

/* ★★파워트레인으로 신차를 «딱» 건다 — 사장님 2026-09-08
     「**파워트레인이라는 게 들어가거든? 그래야 신차가 딱 걸릴 거야**」.
   모델 이름만 맞추면 그랜저 하나에 「가솔린 2.5 · LPi 3.5 · 가솔린 3.5 · 하이브리드 1.6T」가 섞여
   **어느 차의 값도 아닌** 중앙값이 나온다(실측: 스포티지 가솔린 3,560만 / 하이브리드 4,040만이
   좁히기 전에는 둘 다 3,620만이었다). */
must(/powertrain\?: string \| null/.test(carIndexSrc) && /engineFuel\(powertrain\)/.test(carIndexSrc),
  '시세를 짚을 때 파워트레인을 «안 봅니다» — 그러면 하이브리드와 가솔린이 같은 값이 됩니다',
  'lib/domain/estimate/car-index.ts guessMarketPrice');
must(/picked\.powertrain\)/.test(page),
  '화면이 고른 차의 파워트레인을 «안 넘깁니다»',
  'app/estimate/page.tsx guessMarketPrice');

must(/koModel\(al, m\.sub_model\)/.test(carIndexSrc),
  '신차 이름을 «한글로도» 안 맞춥니다 — 기아가 영문 슬러그(ray)로 와서 통째로 안 잡힙니다',
  'lib/domain/estimate/car-index.ts guessMarketPrice');

/* ㉥ 기둥은 «둘»이다 — 셋째 칸을 두지 않는 것이 규격이다(2026-09-08 사장님 「우측에 따로 놓지 말고」) */
must(!/className="contract-panel"/.test(page),
  '셋째 칸이 다시 섰습니다 — 원가는 «각 줄 안»에 있습니다(따로 두면 다섯 해를 못 견줍니다)',
  'app/estimate/page.tsx');
must(/\.wx-root:not\(\.cost\) \{ grid-template-columns: 400px minmax\(0, 1fr\); \}/.test(wxCss)
  && /@media \(min-width: 1025px\) \{[\s\S]{0,400}?\.wx-root:not\(\.cost\)/.test(wxCss),
  '견적 기둥이 둘이 아닙니다 — 좌 400(차량 선택) : 우 나머지(조건 + 1~5년 설계)',
  'components/estimate/welrix.css');

/* ㉤ 컨트롤 — 폰 분기와 입력 16px(iOS 확대 방지) */
must(/--ctrl-input-fs:16px/.test(estCss),
  '원가 화면 폰 입력 글자가 16px 이 아닙니다 — 그 밑이면 iOS 가 탭할 때 화면을 확대합니다',
  'components/estimate/estimate.css (원가 화면의 밑바탕)');
must(/max-width: 1024px/.test(wxCss),
  '견적 화면이 좁은 폭에서 한 줄로 안 접힙니다 — 원본이 1024px 에서 접는 그 자리입니다',
  'components/estimate/welrix.css');

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
  ['PHEV', 'hybrid'], ['하이브리드', 'hybrid'], ['3.5 가솔린', 'gasoline'], ['디젤', 'diesel'],
  /* ⚠ 신차마스터는 LPG 를 「LPi 3.5」로 준다 — 안 잡으면 가솔린으로 떨어져 연료 설정이 통째로 틀어진다
     (2026-09-08 파워트레인을 맞추다 잡음). */
  ['LPi 3.5', 'lpg'], ['LPG 3.5', 'lpg']] as const) {
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

/* ══ 5. 손님 견적서 — «내보내는 길» ══════════════════════════════════════════
     사장님 2026-09-08 「다음 ㄱㄱㄱ」 — 화면에서 보고 끝나면 손님한테 갈 길이 없다. */
const qp = read('features/estimate/QuotePreview.tsx');
/* ⚠ 주석은 빼고 «코드»만 본다 — 여기 주석은 「원가는 안 나간다」를 «설명»하느라 그 말들을 쓴다.
   주석까지 세면 규격을 적어 둔 것이 규격 위반이 된다. */
const qpCode = qp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

/* 5-1. ★★원가·손익이 손님 문서에 «자리조차» 없어야 한다.
   자리가 있으면 언젠가 채워지고, 채워지면 손님이 우리 마진을 본다. */
for (const w of ['opProfit', 'cogs', 'depreciation', 'interest', 'turnoverCost', 'commission',
  '감가', '조달금리', '손바뀜', '영업이익', '매출총이익', '영업수수료', '원가']) {
  must(!qpCode.includes(w),
    `손님 견적서에 원가말 「${w}」 가 들어 있습니다 — 원가·손익은 한 줄도 안 나갑니다`,
    'features/estimate/QuotePreview.tsx');
}
must(/export type QuoteLine = \{[^}]*\}/s.test(qpCode) && !/QuoteLine = \{[^}]*(cost|profit|margin)/is.test(qpCode),
  '`QuoteLine` 에 원가·손익 자리가 생겼습니다 — 자리를 두지 않는 것이 이 문서의 규격입니다',
  'features/estimate/QuotePreview.tsx');

/* 5-2. 웰릭스 CSS 가 기다리는 «속 짜임»을 지킨다 — 클래스만 베끼면 글자가 붙어 나온다.
   2026-09-08 실측: `.qd-people__col` 을 <b>/<span> 으로 짰더니 「고객님고객」이 됐다. */
for (const [sel, hint] of [
  ['<h4>고객</h4>', '.qd-people__col 은 h4 + .name 이다'],
  ['className="name"', '.qd-people__col .name'],
  ['className="label">Total', '.qd-vehicle__price 는 .label + .value 다'],
  ['className="price"', '.qd-monthly__price 는 .price + .unit + .residual 이다'],
  ['className="unit"', '.qd-monthly__price .unit'],
  ['<ul className="qd-notes">', '.qd-notes 는 ul>li 다'],
] as const) {
  must(qp.includes(sel), `손님 견적서 짜임이 웰릭스 CSS 와 안 맞습니다 — ${hint}`,
    'features/estimate/QuotePreview.tsx');
}

/* 5-3. ★노브랜드 — 우리 이름·로고·계좌를 손님 문서에 세우지 않는다(사장님 2026-08-30). */
for (const w of ['qd-hero__logo', 'qd-footer__bank', '프리패스', 'freepass', '웰릭스']) {
  must(!qpCode.includes(w),
    `손님 견적서에 브랜드 표식 「${w}」 이 있습니다 — 공급사·영업자가 같이 쓰는 판입니다`,
    'features/estimate/QuotePreview.tsx');
}

/* 5-4. 인쇄 길 — 견적서만 남기는 @media print 가 있어야 「PDF 로 저장」이 문서 한 장이 된다. */
must(wxCss.includes('#quote-doc-print'),
  '인쇄 규칙(@media print)이 없습니다 — 인쇄하면 견적기 화면이 통째로 찍힙니다',
  'scripts/extract-welrix-css.py');

/* 5-5. 화면에서 문서로 가는 길이 실제로 걸려 있는가. */
must(page.includes('QuotePreview') && page.includes('setDocOpen(true)'),
  '견적서 버튼이 문서를 안 엽니다',
  'app/estimate/page.tsx');
must(page.includes("scen.filter((x) => x.send)"),
  '체크하지 않은 기간까지 손님 견적서에 담깁니다 — 「체크한 칸만 나갑니다」가 화면의 약속입니다',
  'app/estimate/page.tsx');

/* ══ 6. 마스터의 «구멍»을 화면이 삼키지 않는가 ═══════════════════════════════
     2026-09-08 실측 — 제네시스 여덟 모델은 트림명이 «비어» 있고(BTO 가 기본 한 대 + 옵션),
     제네시스 G80 은 같은 이름 옵션이 두 줄이다(AWD 280만/0원 · 파노라마 110만/140만). */

/* 6-1. 이름 없는 트림도 고를 수 있어야 한다 — 값이 빈 문자열이면 «고를 안내문»과 구별이 안 된다. */
must(cascade.includes("t.trim || '기본'") && cascade.includes('newTrims.map((t, i)'),
  '이름 없는 트림을 못 고릅니다 — 제네시스 여덟 모델이 전부 트림명이 비어 있습니다',
  'features/estimate/VehicleCascade.tsx');
must(!/\{ v: t\.trim, label: t\.trim \}/.test(cascade),
  '신차 트림 값을 «이름»으로 나릅니다 — 이름이 비면 고를 수 없게 됩니다',
  'features/estimate/VehicleCascade.tsx');

/* 6-2. 옵션은 «이름»이 아니라 «줄»로 센다 — 같은 이름 두 줄이 한 칸을 같이 쥐면 값이 틀어진다. */
must(page.includes('const optKey =') && page.includes('optSel[optKey(o, i)]'),
  '옵션을 이름으로 셉니다 — 같은 이름이 두 줄인 트림에서 하나를 누르면 둘이 켜집니다',
  'app/estimate/page.tsx');
must(!/optSel\[o\.name\]/.test(page),
  '옵션 선택이 아직 이름 키를 씁니다',
  'app/estimate/page.tsx');
must(page.includes('setOptSel({})'),
  '차를 바꿔도 고른 옵션이 안 지워집니다 — 앞 차의 옵션이 다음 차에 붙습니다',
  'app/estimate/page.tsx');

/* ══ 7. 신차 «내 차 만들기» — 고르는 차례와 값 쌓는 차례 ═══════════════════════
     ★★사장님 2026-09-09 「신차는 제조사에서 **차량 가격 산출까지 어떻게 하는지 그 로직을 동일하게**」
       「**세부모델 · 파워트레인 · 세부트림 · 색상 · 옵션** 순서로 기억하고 있음」 ·
       「그랜저를 고르면 **그랜저 건만** 나와야 되고, **2.5 터보를 누르면 그에 따른 세부 트림**이」 */

/* 7-1. 왼쪽 칸 차례가 제조사 차례와 같은가 — 색상이 «옵션 위»여야 한다. */
{
  const order = ['sec-color', 'sec-options', 'sec-carinfo']
    .map((id) => page.indexOf(`id="${id}"`));
  must(order.every((n) => n >= 0) && order[0] < order[1] && order[1] < order[2],
    '왼쪽 칸 차례가 제조사 「내 차 만들기」와 다릅니다 — 색상 → 옵션 → 차량정보 여야 합니다',
    'app/estimate/page.tsx');
}

/* 7-2. 값 쌓는 차례도 같은가 — 트림 → 색상 → 옵션. */
must(page.indexOf('+ 색상 <b>') < page.indexOf('+ 옵션 <b>'),
  '차량가 식이 «색상 → 옵션» 차례가 아닙니다 — 고르는 차례와 같아야 합니다',
  'app/estimate/page.tsx');

/* 7-3. ★내장 유료색도 차량가에 든다 — 제네시스 「시그니쳐 디자인 셀렉션Ⅰ +150만」.
     2026-09-08 판은 외장만 더해, 유료 내장을 골라도 차량가가 그대로였다. */
must(/intColors\.find\(\(c\) => c\.name === colorInt\)/.test(page),
  '내장 유료색이 차량가에 안 듭니다 — 제조사는 내장에도 값을 매깁니다',
  'app/estimate/page.tsx');

/* ══ 8. 제네시스 라인업 펴기 — «모델 한 줄»을 엔진 × 변형으로 ═══════════════════
     ⚠ 2026-09-08 에 나는 제네시스 트림 빈칸을 「기본」이라 적어 덮었다. 데이터를 안 찾고 화면을 덮은 것이다.
       조합은 `data/new-car/genesis-config.json` 에 이미 있었다. */
const { expandGenesis, fillBlankFuel, lineupOf, genesisConfig } =
  await import('../lib/domain/estimate/genesis-lineup');

/* 8-0. ★★정본만 읽는다 — `genesis-config.json`(mtops)은 **구가·폐기**다.
     `docs/신차마스터-피드.md` 와 `app/api/newcar/config/route.ts` 둘 다 그렇게 적어 두었는데
     2026-09-09 오전에 내가 안 읽고 그 폐기 파일을 읽었다. 사장님 「여기도 SSOT 에서 제대로 갖고와야 한다」. */
{
  const src = read('lib/domain/estimate/genesis-lineup.ts');
  must(!/readFileSync\([^)]*genesis-config\.json/.test(src) && !/'data\/new-car\/genesis-config\.json'/.test(src),
    '폐기된 `genesis-config.json`(mtops 구가)을 읽고 있습니다 — 정본은 `genesis-config-fs.json` 입니다',
    'lib/domain/estimate/genesis-lineup.ts');
  must(src.includes('genesis-config-fs.json'),
    '제네시스 정본(`genesis-config-fs.json`)을 안 읽습니다',
    'lib/domain/estimate/genesis-lineup.ts');
}

/* 8-1. G80 이 엔진 둘 × 구동 둘로 펴지는가 — 값은 «정본»(공식 PDF·코덱스 확정) 이다. */
{
  const g80 = genesisConfig().get('g80');
  must(!!g80, '제네시스 정본(genesis-config-fs.json)에서 G80 을 못 찾습니다',
    'data/new-car/genesis-config-fs.json');
  const rows = g80 ? lineupOf(g80, '가솔린') ?? [] : [];
  const f = (fuel: string, trim: string) => rows.find((r) => r.fuel === fuel && r.trim === trim)?.price ?? 0;
  must(rows.length === 4, `G80 라인업이 넷이 아닙니다(${rows.length}) — 엔진 2 × 구동 2`,
    'lib/domain/estimate/genesis-lineup.ts');
  must(f('가솔린 2.5 터보', '2WD') === 60_630_000 && f('가솔린 3.5 터보', '2WD') === 67_230_000,
    'G80 엔진별 값이 정본과 다릅니다 — base 6,063만 + 3.5T 660만(공식 PDF · 코덱스 확정)',
    'lib/domain/estimate/genesis-lineup.ts');
  /* ⚠ 엔진 그룹에 옵션 문구가 섞인 모델이 있다(GV70 「브레이크 및 후륜 스타일링 커버…」).
     연료말 «과» 배기량이 둘 다 있어야 엔진으로 본다. */
  must(!lineupOf(genesisConfig().get('gv70')!, '가솔린')!.some((r) => /브레이크|커버/.test(r.fuel)),
    'GV70 엔진 자리에 옵션 문구가 그대로 들어옵니다 — 엔진처럼 안 생긴 선택지는 버려야 합니다',
    'lib/domain/estimate/genesis-lineup.ts looksLikeEngine');
}

/* 8-2. GV60 은 전기다 — 신차마스터가 「가솔린」이라 싣고 있어도 **차종마스터**가 이긴다.
     ⚠ 이게 틀리면 보조금 600만·취득세 감면 140만·공채 면제가 하나도 안 걸린다. */
{
  const rows = expandGenesis([{ maker: '제네시스', sub_model: 'GV60', fuel: '가솔린', priceAfter: 64_900_000 }]);
  must(rows.every((r) => r.fuel === '전기'),
    'GV60 이 전기로 안 잡힙니다 — 신차마스터의 「가솔린」을 그대로 믿으면 EV 혜택이 다 빠집니다',
    'lib/domain/estimate/genesis-lineup.ts masterFuel');
}

/* 8-3. 못 펴는 모델은 «원본 한 줄»을 그대로 둔다 — 지어내지 않는다. */
{
  const one = [{ maker: '제네시스', sub_model: 'G80-EV', fuel: '전기', priceAfter: 84_790_000 }];
  must(expandGenesis(one).length === 1, '조합이 없는 모델까지 펴고 있습니다 — 없는 것을 지어내면 안 됩니다',
    'lib/domain/estimate/genesis-lineup.ts');
  must(expandGenesis([{ maker: '현대', sub_model: '더 뉴 그랜저', fuel: '가솔린 2.5', priceAfter: 42_450_000 }]).length === 1,
    '제네시스가 아닌 제조사를 건드리고 있습니다 — 현대·기아는 크롤이 이미 제대로 싣는다',
    'lib/domain/estimate/genesis-lineup.ts');
}

/* 8-4. 빈 연료는 «형제가 한 목소리일 때만» 채운다 — 기아 EV9 여섯 줄이 그렇다.
     ⚠ 빈 연료는 `engineFuel('')` 이 가솔린으로 떨어져 **보조금·감면·자동차세가 통째로 틀어진다.** */
{
  const ev9 = fillBlankFuel([
    { maker: '기아', sub_model: 'ev9', fuel: '' },
    { maker: '기아', sub_model: 'ev9', fuel: 'EV' },
    { maker: '르노', sub_model: '필랑트', fuel: '' },
    { maker: '현대', sub_model: '아무개', fuel: '' },
    { maker: '현대', sub_model: '아무개', fuel: '가솔린 2.0' },
    { maker: '현대', sub_model: '아무개', fuel: '디젤 2.2' },
  ]);
  must(ev9[0].fuel === 'EV', '기아 EV9 의 빈 연료가 안 채워집니다 — 형제 줄이 전부 EV 입니다',
    'lib/domain/estimate/genesis-lineup.ts fillBlankFuel');
  must(ev9[2].fuel === '', '르노 필랑트의 빈 연료를 «지어냈습니다» — 형제도 다 비었으면 「모른다」가 맞습니다',
    'lib/domain/estimate/genesis-lineup.ts fillBlankFuel');
  must(ev9[3].fuel === '', '형제가 둘로 갈리는데 한쪽으로 채웠습니다 — 어느 쪽인지 모르면 비워 둡니다',
    'lib/domain/estimate/genesis-lineup.ts fillBlankFuel');
}

/* 8-5. 피드가 실제로 펴서 내보내는가. */
must(/expandGenesis\(trims\)/.test(read('app/api/newcar/route.ts'))
  && /fillBlankFuel\(trims\)/.test(read('app/api/newcar/route.ts')),
  '신차 피드가 제네시스를 안 펴고 내보냅니다 — 화면이 아니라 «피드»가 펴야 견적기(netlify)도 같이 낫습니다',
  'app/api/newcar/route.ts');

/* 8-6. 파워트레인 칸도 «자리 번호»로 나른다 — 이름이 비면 못 고르던 것(르노 필랑트·기아 EV9). */
must(cascade.includes("label: f || '미상'") && cascade.includes('newFuels.map((f, i)'),
  '연료가 빈 줄을 못 고릅니다 — 비었으면 「미상」이라 적고 고를 수 있게 둡니다',
  'features/estimate/VehicleCascade.tsx');
must(!/\{ v: f, label: f \}/.test(cascade),
  '파워트레인 값을 «이름»으로 나릅니다 — 이름이 비면 안내문과 구별이 안 됩니다',
  'features/estimate/VehicleCascade.tsx');
must(cascade.includes('variants.length !== 1'),
  '고를 것이 하나뿐인 파워트레인 걸음을 자동으로 안 넘깁니다 — 막힌 문이 됩니다',
  'features/estimate/VehicleCascade.tsx');

/* ══ 9. 폰은 «다음 다음 다음» ══════════════════════════════════════════════
     ★★사장님 2026-09-09 「그래서 **모바일에서는 이거를 다음 다음 다음** 이렇게 하게 만들었잖아
       **직관적으로**. **웰릭스 테이블에 이미 있는 내용**이고」
     ⚠ 2026-09-08 에 나는 「모바일 버전은 다음다음 하게 해놨어」를 «미룬다»로 읽고 미뤘다. */
const wiz = read('features/estimate/EstimateWizard.tsx');

/* 9-1. 원본 폰 CSS 가 실제로 들어와 있는가 — 안 들어오면 마법사가 맨몸으로 선다. */
for (const sel of ['.m-progress__seg', '.sv-brand-card', '.sv-trim-card', '.sq-term-card', '.m-btn']) {
  must(wxCss.includes(sel), `원본 폰 스타일 「${sel}」 이 없습니다 — 생성기 SFC 목록에서 mobile 조각이 빠졌습니다`,
    'scripts/extract-welrix-css.py');
}
must(wxCss.includes('.wx-root.est-root--wiz'),
  '마법사 껍데기 맞춤이 없습니다 — `.wx-root` 의 100vh 격자를 안 풀면 머리가 본문을 덮습니다',
  'scripts/extract-welrix-css.py');
/* ⚠ 하단 홈바가 남는 화면이다 — 안 들어 올리면 「다음」이 홈바 밑에 깔려 «안 눌린다». */
must(/est-root--wiz \.m-footer \{ bottom: var\(--fp-bar-h/.test(wxCss),
  '마법사 발이 하단 홈바에 깔립니다 — `--fp-bar-h` 만큼 들어 올려야 합니다',
  'scripts/extract-welrix-css.py');

/* 9-2. 쪽 차례가 제조사 「내 차 만들기」와 같은가 — 색상이 옵션 «앞». */
{
  const m = /const steps = useMemo<WizStep\[\]>\(\(\) => \[([\s\S]*?)\], \[isNew\]\)/.exec(wiz);
  must(!!m, '마법사 쪽 차례를 못 찾습니다', 'features/estimate/EstimateWizard.tsx');
  const body = m ? m[1] : '';
  must(body.indexOf("'colors'") >= 0 && body.indexOf("'colors'") < body.indexOf("'options'"),
    '폰 쪽 차례가 제조사와 다릅니다 — 색상이 옵션 «앞»이어야 합니다',
    'features/estimate/EstimateWizard.tsx');
}

/* 9-3. ★★조각은 데스크톱과 «같은 것»을 쓴다 — 폰용 마크업을 따로 짜면 두 화면이 갈린다
     (CLAUDE.md 절대원칙 3 · 사장님 「작업을 하고 배포까지 했는데 왜 또 얼레벌레 자꾸 바뀌는거여」). */
must(/sections=\{\{ carinfo: secCarinfo, colors: secColor, options: secOptions, conditions: condRow, terms: termGrid \}\}/.test(page),
  '폰이 데스크톱과 다른 조각을 씁니다 — 같은 변수를 넘겨야 두 화면이 안 갈립니다',
  'app/estimate/page.tsx');
for (const v of ['const secColor = (', 'const secOptions = (', 'const secCarinfo = (', 'const condRow = (', 'const termGrid = (']) {
  must(page.includes(v), `화면 조각 「${v.slice(6, -4)}」 이 변수로 안 뽑혀 있습니다 — 두 껍데기가 나눠 쓸 수 없습니다`,
    'app/estimate/page.tsx');
}

/* 9-4. ⚠⚠ 차 걸음이 아닐 때도 캐스케이드는 «붙어» 있어야 한다.
     떼면 트림을 고른 순간 조각이 떨어져 `onPick` 이 한 번도 안 돌고,
     색상·옵션·기간이 통째로 빈다(2026-09-09 실측 — 옵션 칸이 「트림을 먼저 고르면」이었다). */
must(cascade.includes('hidden?: boolean') && cascade.includes('if (wizard.hidden) return null'),
  '차 걸음이 아닐 때 캐스케이드를 «떼고» 있습니다 — 감추기만 해야 고른 차가 위로 올라갑니다',
  'features/estimate/VehicleCascade.tsx');
must(/hidden: !isCarStep/.test(wiz),
  '마법사가 캐스케이드를 조건부로 그립니다 — 붙여 두고 `hidden` 으로 감춰야 합니다',
  'features/estimate/EstimateWizard.tsx');

/* 9-5. 무한 되그림 막이 — `ko` 가 그림마다 새로 만들어지면 효과가 끝없이 돈다(콘솔 3천 줄). */
must(/const ko = useCallback\(/.test(cascade),
  '`ko` 가 그림마다 새로 만들어집니다 — 이걸 의존에 넣은 useMemo 가 매번 돌아 무한 되그림이 납니다',
  'features/estimate/VehicleCascade.tsx');
must(/}, \[wStep, wOnState, wCount, wChosen\]\)/.test(cascade),
  '걸음 상태를 알리는 효과가 «객체»를 의존으로 씁니다 — 원시값이어야 안 돕니다',
  'features/estimate/VehicleCascade.tsx');

/* 9-6. 갈래를 바꾸면 앞 갈래 찌꺼기를 안 물려준다 — 「2026년식 0km 중고차」가 나오던 것. */
must(page.includes('const setSource = useCallback(') && /onPick=\{setSource\}/.test(page),
  '상품을 바꿔도 연식·주행이 안 되돌아갑니다 — 신차를 봤다 오면 「올해식 0km 중고차」가 됩니다',
  'app/estimate/page.tsx');

/* ══ 10. 이름 정제 — 원천마다 다른 표기를 «한 규격»으로 ═══════════════════════
     ★★사장님 2026-09-09 「**여기도 SSOT 에서 제대로 갖고와야 한다**」 · 「**제대로 쌓아올려봐**」
     이름이 지저분하면 옵션도 색상도 조합지도도 못 붙는다(실측 완전일치 27%). */
const { canonFuel: cf, splitAxis: sa, withSuffix: ws } = await import('../lib/domain/estimate/newcar-normalize');

/* 10-1. 연료 라벨이 규격으로 모이는가 — `{연료} {배기량}{ 터보}`. */
for (const [raw, want] of [
  ['1.6 가솔린 터보', '가솔린 1.6 터보'],   // 기아 어순
  ['가솔린 1.6T-GDi', '가솔린 1.6 터보'],
  ['가솔린 1.6 T-GDi(N라인)', '가솔린 1.6 터보'],
  ['LPi 3.5', 'LPG 3.5'],
  ['전기모터', '전기'], ['전기차', '전기'], ['EV', '전기'],
  ['수소전기', '수소'],
  ['하이브리드 1.6T', '하이브리드 1.6 터보'],
  ['하이브리드', '하이브리드'],            // ⚠ 없는 배기량을 지어내지 않는다
] as const) {
  must(cf(raw) === want, `연료 라벨 「${raw}」가 «${cf(raw)}» 로 모입니다 — «${want}» 여야 합니다`,
    'lib/domain/estimate/newcar-normalize.ts');
}

/* 10-2. 탭 라벨이 «연료»가 아닌 축이면 트림 꼬리로 옮긴다 — 안 옮기면 같은 트림이 값만 다르게 두 줄이 된다. */
{
  const a = sa('터보 하이브리드(전자식4WD)');
  must(a.fuel === '하이브리드 터보' && a.trimSuffix.includes('전자식4WD'),
    '구동 축이 트림 꼬리로 안 옮겨집니다 — 쏘렌토 하이브리드가 2WD/4WD 로 안 갈립니다',
    'lib/domain/estimate/newcar-normalize.ts splitAxis');
  const b = sa('2WD', true);
  must(b.fuel === '전기' && b.trimSuffix === '2WD',
    'EV9 의 「2WD」 탭이 전기로 안 잡힙니다 — 같은 트림이 값만 다르게 두 줄이 됩니다',
    'lib/domain/estimate/newcar-normalize.ts splitAxis');
  must(sa('9인승').fuel === '', '좌석 탭에서 연료를 «지어냈습니다» — 카니발은 연료를 모릅니다',
    'lib/domain/estimate/newcar-normalize.ts splitAxis');
}

/* 10-3. 꼬리를 붙일 때 괄호가 겹치지 않는다. */
must(ws('노블레스(9인승)', '9인승 하이루프') === '노블레스(9인승 하이루프)',
  '트림 꼬리가 괄호를 겹쳐 붙입니다 — 「노블레스(9인승)(하이루프)」가 됩니다',
  'lib/domain/estimate/newcar-normalize.ts withSuffix');
must(ws('프레스티지(9인)', '9인승') === '프레스티지(9인)',
  '이미 들어 있는 꼬리를 또 붙입니다',
  'lib/domain/estimate/newcar-normalize.ts withSuffix');

/* ══ 11. 옵션 «조합 규칙» — 배타(택1)·선행필수·배제 ═══════════════════════════
     ★★사장님 2026-09-09 「야 **옵션은 명확하게 다 구현하는 게 웰릭스 테이블에 있는데**」
     여태는 규칙을 «글»로만 보여 주고 안 막았다 — 그러면 «있을 수 없는 차»의 값이 견적서에 찍힌다. */
const OR = await import('../lib/domain/estimate/option-rules');

/* 11-1. 선행필수 — 3.5 엔진을 안 사면 HTRAC 을 못 고른다(현대 그랜저 실물 규칙). */
{
  const spec: import('../lib/domain/estimate/option-rules').OptionSpec = {
    optionsMaster: {
      engine_3_5: { name: '가솔린 3.5 엔진', price: 2_470_000 },
      htrac: { name: 'HTRAC (4WD)', price: 2_200_000, requires: ['engine_3_5'] },
      roof_a: { name: '파노라마 선루프', price: 1_200_000 },
      roof_b: { name: '스마트 비전 루프', price: 900_000 },
    },
    exclusiveGroups: [{ id: 'roof', label: '루프', members: ['roof_a', 'roof_b'] }],
    optionExcludes: { roof_b: ['htrac'] },
    availableOptions: ['engine_3_5', 'htrac', 'roof_a', 'roof_b'],
  };
  const none = new Set<string>();
  must(!OR.isEnabled(spec, 'htrac', none),
    '선행이 없는데 옵션을 고를 수 있습니다 — 있을 수 없는 차의 값이 견적서에 찍힙니다',
    'lib/domain/estimate/option-rules.ts isEnabled');
  must(/선행 필요/.test(OR.whyBlocked(spec, 'htrac', none)),
    '못 고르는 까닭을 안 말해 줍니다 — 사람이 「고장났다」고 읽습니다',
    'lib/domain/estimate/option-rules.ts whyBlocked');

  /* 11-2. 배타(택1) — 같은 그룹에서 하나를 고르면 형제가 꺼진다. */
  let ch = OR.toggleOption(spec, 'roof_a', none);
  ch = OR.toggleOption(spec, 'roof_b', ch);
  must(ch.has('roof_b') && !ch.has('roof_a'),
    '배타그룹에서 둘이 동시에 켜집니다 — 「중 1개만」이 말뿐입니다',
    'lib/domain/estimate/option-rules.ts toggleOption');

  /* 11-3. 선행을 끄면 그것을 딛고 선 것도 «같이» 꺼진다(사슬까지). */
  let c2 = OR.toggleOption(spec, 'engine_3_5', new Set<string>());
  c2 = OR.toggleOption(spec, 'htrac', c2);
  must(c2.has('htrac'), '선행을 켰는데도 못 고릅니다', 'lib/domain/estimate/option-rules.ts');
  must(OR.optionSum(spec, c2) === 4_670_000,
    `옵션 합이 다릅니다(${OR.optionSum(spec, c2)}) — 247만 + 220만 = 467만`,
    'lib/domain/estimate/option-rules.ts optionSum');
  const c3 = OR.toggleOption(spec, 'engine_3_5', c2);
  must(!c3.has('htrac'),
    '선행을 껐는데 그것을 딛고 선 옵션이 남습니다 — 값이 남아 차량가가 틀립니다',
    'lib/domain/estimate/option-rules.ts toggleOption');

  /* 11-4. 배제 — 부모를 켜면 막힌 것은 못 고른다. */
  const c4 = OR.toggleOption(spec, 'roof_b', new Set<string>());
  must(!OR.isEnabled(spec, 'htrac', c4),
    '배제 규칙이 안 먹습니다 — 「동시 선택 불가」가 말뿐입니다',
    'lib/domain/estimate/option-rules.ts isEnabled');
}

/* 11-5. 규칙이 «없는» 트림은 막지 않는다 — 못 받은 것을 없는 것으로 만들지 않는다. */
must(!OR.hasRules({}), '규칙이 없는데 있다고 봅니다', 'lib/domain/estimate/option-rules.ts hasRules');

/* 11-6. 화면이 실제로 그 규칙을 쓰는가. */
must(page.includes('hasRules(optSpec)') || page.includes('const ruled = hasRules'),
  '화면이 조합 규칙을 안 씁니다 — 규칙을 실어 놓고 안 쓰면 실은 뜻이 없습니다',
  'app/estimate/page.tsx');
must(page.includes('toggleOption(optSpec, id, prev)') && page.includes('whyBlocked(optSpec, id, optIds)'),
  '옵션 줄이 규칙대로 «막지» 않습니다',
  'app/estimate/page.tsx');
/* ⚠ 규칙판에서 고른 것이 차량가·견적서에 그대로 들어가야 한다. */
must(page.includes('ruled ? optionSum(optSpec, optIds)'),
  '규칙판에서 고른 옵션이 차량가에 안 들어갑니다',
  'app/estimate/page.tsx');

/* 11-7. 피드가 규칙을 내보내는가 — 화면이 아니라 «피드»가 실어야 견적기(netlify)도 같이 낫는다. */
{
  const api = read('app/api/newcar/route.ts');
  for (const f of ['optionsMaster', 'exclusiveGroups', 'optionExcludes', 'availableOptions', 'impliedOptions']) {
    must(api.includes(f), `신차 피드가 「${f}」 를 안 내보냅니다`, 'app/api/newcar/route.ts');
  }
}

/* ══ 12. 제조사에서 «직접» 받은 옵션 — 웰릭스가 모르는 모델을 메운다 ══════════
     ★★사장님 2026-09-09 「다음 ㄱㄱㄱ」 — 웰릭스 조합지도는 25모델뿐이라
       EV3~EV9·스타리아·아이오닉·르노가 통째로 비어 있었다. 기아는 공식 HTML 에 선택품목이 있다.

   ★★★2026-09-09 개발센터 SSOT 의견서 **FP-SSOT-04** 와 «같은 병»이 여기 있었다 —
     「검사기가 파일 전체의 «문자열»로 판정해, 주석만 있어도 초록으로 통과한다」.
     이 자리의 옛 검사가 정확히 그랬다:
       · `/동시\s\*적용\s\*불가/` — `\s\*` 는 «공백 + 리터럴 별표». **절대 안 맞는 죽은 정규식**이었고,
         `|| src.includes('동시')` 로 통과했다. 그 낱말은 **파일 머리 주석**에 있다.
       · `includes('※')` · `includes("+[rt]'")` — 주석·따옴표 짜임에 못을 박은 검사.
     ⇒ **소스를 읽지 말고 «불러서» 잰다.** 파서는 순수 함수라 부를 수 있다.
   ⚠ 크롤러 자체는 «부르지» 않는다 — 부르면 제조사에 요청이 나간다. 규격만 소스로 본다. */
const kiaOptCode = code('scripts/crawl-newcar-kia-options.mts');
const hdOptCode = code('scripts/crawl-newcar-hyundai-options.mts');

/* 12-1. 「블랙 루프스킨(선루프와 동시 적용 불가)」 — 괄호·※·* 뒤는 «이름»이 아니라 «규칙»이다. */
{
  const a = splitNote('블랙 루프스킨(선루프와 동시 적용 불가)');
  must(a.name === '블랙 루프스킨' && a.notes.length === 1,
    `괄호 규칙을 이름에서 안 뗍니다 — 「${a.name}」`, 'lib/domain/estimate/option-note.ts splitNote');

  const b = splitNote('듀얼 모터 4WD ※ 19인치 휠&타이어 적용 시 듀얼모터 4WD 선택 가능');
  must(b.name === '듀얼 모터 4WD' && b.notes.length === 1,
    `「※」 규칙을 이름에서 안 뗍니다 — 「${b.name}」`, 'lib/domain/estimate/option-note.ts splitNote');

  /* ★규칙이 «여럿» 붙는다 — 하나만 떼면 나머지가 이름에 문장으로 남는다(운영 실측 20개). */
  const c = splitNote('투톤 컬러 루프 *와이드 선루프 중복 선택 불가 *블랙 익스테리어 선택 불가');
  must(c.name === '투톤 컬러 루프' && c.notes.length === 2,
    `규칙이 둘인데 하나만 뗍니다 — 「${c.name}」 / ${c.notes.length}건`, 'lib/domain/estimate/option-note.ts splitNote');

  /* ⚠ 괄호가 «규칙말»이 아니면 이름이다 — 「(9인승)」을 떼면 트림이 안 갈린다. */
  const d = splitNote('컴포트 II (9인승)');
  must(d.name === '컴포트 II (9인승)' && d.notes.length === 0,
    `규칙이 아닌 괄호를 뗍니다 — 「${d.name}」`, 'lib/domain/estimate/option-note.ts splitNote');
}

/* 12-2. 뗀 규칙을 «읽는다» — 선행(needs)과 배제(bans). 상대가 둘이면 둘 다. */
{
  const ban = readRule('선루프와 동시 적용 불가');
  must(ban.bans.includes('선루프') && ban.needs.length === 0,
    '「동시 적용 불가」를 배제로 안 읽습니다', 'lib/domain/estimate/option-note.ts readRule');

  const need = readRule('19인치 휠&타이어 적용 시 듀얼모터 4WD 선택 가능');
  must(need.needs.includes('19인치 휠&타이어') && need.bans.length === 0,
    '「… 적용 시 … 가능」을 선행으로 안 읽습니다', 'lib/domain/estimate/option-note.ts readRule');

  /* ★상대가 쉼표로 여럿 — 하나만 읽으면 나머지 조합이 안 막힌다. */
  const two = readRule('선루프, 파노라마 선루프와 동시 선택 불가');
  must(two.bans.length === 2,
    `상대가 둘인 배제를 하나만 읽습니다 — ${two.bans.length}건`, 'lib/domain/estimate/option-note.ts readRule');
}

/* 12-3. ⚠⚠ **상대를 못 찾으면 규칙을 «만들지 않는다»** — 지어낸 배타는 고를 수 있는 것을 막는다. */
{
  const 없음 = rulesFrom([
    { name: '블랙 루프스킨', price: 500000, note: '선루프와 동시 적용 불가' },
    { name: '컴포트 I', price: 900000 },
  ]);
  must(Object.keys(없음.excludes).length === 0,
    '목록에 없는 상대로 배타를 «지어냅니다» — 고를 수 있는 것을 막게 됩니다',
    'lib/domain/estimate/option-note.ts rulesFrom');

  const 있음 = rulesFrom([
    { name: '블랙 루프스킨', price: 500000, note: '선루프와 동시 적용 불가' },
    { name: '파노라마 선루프', price: 1200000 },
  ]);
  must((있음.excludes['블랙 루프스킨'] ?? []).includes('파노라마 선루프')
    && (있음.excludes['파노라마 선루프'] ?? []).includes('블랙 루프스킨'),
    '상대가 «있는데»도 배타를 안 세웁니다 — 규칙이 한쪽만 걸립니다',
    'lib/domain/estimate/option-note.ts rulesFrom');
}

/* 12-4. ⚠⚠ **값을 못 읽으면 «0 원»이 아니라 «안 싣는다»** — 0 은 「기본 포함」과 구별이 안 된다. */
{
  must(priceOf('<p class="item-price"> 1,200,000 <span>원</span></p>') === 1200000,
    '값 앞뒤 공백·태그가 끼면 값을 못 읽습니다', 'lib/domain/estimate/option-note.ts priceOf');
  must(priceOf('<li><span class="item-name">기본 적용</span></li>') === null,
    '값이 없는데 «0 원»으로 싣습니다 — 유료 옵션이 공짜가 됩니다', 'lib/domain/estimate/option-note.ts priceOf');
}

/* 12-5. 두 크롤러가 «같은 자»를 쓴다 — 한쪽에만 넣어서 운영 16줄·옵션 20개에 문장이 남았다. */
for (const [f, src] of [['kia', kiaOptCode], ['hyundai', hdOptCode]] as const) {
  must(/from '\.\.\/lib\/domain\/estimate\/option-note'/.test(src),
    `${f} 가 규칙 파서를 «따로» 씁니다 — 한쪽만 고치면 다른 쪽에 문장이 남습니다`,
    `scripts/crawl-newcar-${f}-options.mts`);
  /* ★색상은 옵션에서 뺀다 — 화면이 색상을 «따로» 더한다(colorAdd). 두 번 받으면 안 된다. */
  must(src.includes('colorNames.has(N(o.name))'),
    `${f} — 유료 색상이 옵션에도 들어갑니다(색상값 이중계상)`, `scripts/crawl-newcar-${f}-options.mts`);
  /* ★이미 실린 «규칙»을 덮지 않는다 — 공식 HTML 은 배타·선행을 안 준다. 덮으면 웰릭스 규칙이 사라진다. */
  must(src.includes('if (v.optionsMaster && Object.keys(v.optionsMaster).length)'),
    `${f} — 이미 실린 조합 규칙을 덮어씁니다(배타·선행 소실)`, `scripts/crawl-newcar-${f}-options.mts`);
  /* ★★「이미 산 엔진·구동」을 «다시 팔지» 않는다 — 판정은 공용 원자 하나다. */
  must(/impliedOptions:\s*impliedOf\(/.test(src),
    `${f} — 「이미 산 엔진·구동」을 안 가립니다(그랜저 3.5 엔진 246만·아이오닉6 HTRAC 247만 이중계상)`,
    `scripts/crawl-newcar-${f}-options.mts`);
}

/* 12-6. 붙이는 상대는 «모델 + 연료»로 고른다 — 값만 같으면 포터2에 아반떼 옵션이 붙는다(실측). */
must(hdOptCode.includes('sameModel') && hdOptCode.includes('sameFuel'),
  '값만 보고 옵션을 붙입니다 — 값이 같은 다른 모델에 남의 옵션이 실립니다',
  'scripts/crawl-newcar-hyundai-options.mts');
must(kiaOptCode.includes('sameFuel'),
  '기아도 연료를 안 맞댑니다 — 다연료 모델에 틀린 연료의 옵션이 붙습니다',
  'scripts/crawl-newcar-kia-options.mts');

/* ══ 13. 「이미 산 것」 · 이름 · 배치 — 조용히 «돈»과 «데이터»가 새던 자리 ═══════ */

/* 13-1. ★★엔진값 이중계상 — 그 줄의 연료·트림이 곧 엔진·구동이면 옵션으로 또 팔지 않는다. */
{
  const om = {
    g35: { name: '가솔린 3.5 터보 엔진' },
    g35e: { name: '가솔린 3.5 터보 48V 일렉트릭 슈퍼차저 엔진' },
    awd: { name: 'AWD' },
    htrac: { name: 'HTRAC (상시 4륜 구동)' },
    comfort: { name: '컴포트 I' },
  };
  const 편줄 = impliedOf(om, '가솔린 3.5 터보', 'AWD');
  must(편줄.includes('g35') && 편줄.includes('awd'),
    '펴 놓은 줄에서 엔진·구동을 «또» 팝니다 — G80 3.5T AWD 에서 940만원 이중계상',
    'lib/domain/estimate/implied-options.ts impliedOf');
  /* ⚠ 48V 슈퍼차저는 «다른 엔진»이다 — 배기량만 보면 진짜 옵션이 사라진다(G90 600만). */
  must(!편줄.includes('g35e'),
    '48V 슈퍼차저를 «같은 엔진»으로 봅니다 — G90 의 진짜 옵션 600만이 사라집니다',
    'lib/domain/estimate/implied-options.ts engineSig');
  must(!편줄.includes('comfort'),
    '엔진·구동이 아닌 옵션까지 «이미 샀다»고 합니다', 'lib/domain/estimate/implied-options.ts');

  /* ⚠ 「모른다」를 「이미 샀다」로 삼키지 않는다 — 연료말에 배기량이 없으면 어떤 엔진인지 모른다. */
  must(impliedOf({ e: { name: '엔진' } }, '가솔린', '프레스티지').length === 0,
    '어떤 엔진인지 «모르는데» 이미 샀다고 합니다 — 진짜 옵션이 사라집니다',
    'lib/domain/estimate/implied-options.ts impliedByFuel');
  /* ⚠ 트림이 구동이 아니면 안 걸러야 한다 — 「블랙」 트림에서 AWD 는 진짜 옵션이다. */
  must(!impliedOf(om, '가솔린 2.5 터보', '블랙').includes('awd'),
    '구동이 아닌 트림에서 AWD 를 «이미 샀다»고 합니다', 'lib/domain/estimate/implied-options.ts impliedByTrim');
  /* ★현대는 구동 이름이 「HTRAC」이다 — 낱말을 모르면 247만을 또 받는다. */
  must(impliedOf(om, '가솔린 2.5 터보', 'HTRAC').includes('htrac'),
    'HTRAC 를 구동으로 못 읽습니다 — 아이오닉6·그랜저에서 247만 이중계상',
    'lib/domain/estimate/implied-options.ts impliedByTrim');
}

/* 13-2. ★★제네시스를 «엔진 × 구동»으로 펴 때 원본 줄의 판정을 복사하지 않는다.
     → 이제 §18 이 «값»으로 잰다(G80 3.5T·AWD = 70,030,000 · GV80 블랙 = 95,080,000).
     ★문자열 검사를 행동 검사로 «올린» 것이지 낮춘 것이 아니다 — 지우는 방향이 중요하다. */

/* 13-3. ★모델 이름은 «한글이 살아 있어야» 짝이 맞는다 — 영숫자만 남기면 통째로 뭉개진다. */
must(modelKey('일렉트리파이드 GV70') !== modelKey('GV70'),
  '모델 열쇠가 한글을 지웁니다 — 「일렉트리파이드 GV70」 이 「GV70」 과 같은 차가 됩니다',
  'lib/domain/estimate/genesis-lineup.ts modelKey');

/* 13-4. ★인승은 «축»이다 — 11인승을 못 읽으면 스타리아 트림이 통째로 안 붙는다. */
must(splitAxis('11인승').trimSuffix === '11인승' && splitAxis('9인승').trimSuffix === '9인승',
  `두 자리 인승을 못 읽습니다 — 「${splitAxis('11인승').trimSuffix}」. 스타리아 11인승 줄이 통째로 안 붙습니다`,
  'lib/domain/estimate/newcar-normalize.ts splitAxis');

/* 13-5. ★★이름을 한글로 바꿔 실을 때 «나머지 칸을 들고 간다» — 안 들면 색상·옵션이 통째로 날아간다.
     (2026-09-09 드라이런에서 잡음 — 기아 색상·옵션 전부가 사라질 뻔했다.) */
{
  const bf = code('scripts/backfill-newcar-names.mts');
  must(bf.includes('const DROP') && bf.includes('carry('),
    '이름만 새로 쓰고 «나머지 칸»을 안 들고 갑니다 — 색상·옵션이 통째로 지워집니다',
    'scripts/backfill-newcar-names.mts');
}

/* 13-6. ★Firestore 배치는 500 이 한계다 — 안 끊으면 «전부» 안 써진다(조용히 실패). */
for (const f of ['scripts/backfill-newcar-names.mts', 'scripts/ingest-newcar-options.mts',
  'scripts/crawl-newcar-kia-options.mts', 'scripts/crawl-newcar-hyundai-options.mts']) {
  must(/\bn[0-9]? >= 400\b/.test(code(f)), '배치를 안 끕습니다 — 500줄이 넘으면 통째로 안 써집니다', f);
}

/* 13-7. ★★조합지도는 «폐기된 파일»로 몰래 물러서지 않는다 — 옛 mtops 값은 구가다.
     물러서면 화면은 멀쩡히 그려지는데 «옛 가격»을 판다(사장님 GV80 쿠페 1억3천 지적의 정체). */
{
  const cfgRoute = code('app/api/newcar/config/route.ts');
  must(!/genesis-config\.json/.test(cfgRoute.replace(/genesis-config-fs\.json/g, '')),
    '폐기된 `genesis-config.json`(구가·mtops)으로 물러섭니다 — 옛 가격을 팝니다',
    'app/api/newcar/config/route.ts');
}

/* 13-8. ★「고를 것이 없다」와 「못 받았다」를 가른다 — 빈 배열을 «전부 열기»로 읽으면 안 된다. */
{
  const 빈칸: OptionSpec = { optionsMaster: { a: { name: '컴포트', price: 900000 } }, availableOptions: [] };
  must(optionList(빈칸).length === 0,
    '그 트림에 «없는» 옵션을 열어 줍니다 — 고를 수 없는 것을 팝니다',
    'lib/domain/estimate/option-rules.ts optionList');
  const 없는칸: OptionSpec = { optionsMaster: { a: { name: '컴포트', price: 900000 } } };
  must(optionList(없는칸).length === 1,
    '목록을 «안 받았을» 때까지 닫아 버립니다 — 못 받은 것이 없는 것이 됩니다',
    'lib/domain/estimate/option-rules.ts optionList');
}

/* ══ 14. ★★차량가 «기준»은 하나다 — 세제혜택 «전»(개별소비세 5% = 제조사 표시가) ══════
     사장님 2026-09-09 「견적만 제대로 나오게 해 기준만 있으면 됩니다」.

   ⚠⚠ **여기 적혀 있던 「취득세를 두 번 뺀다」는 틀렸다**(2026-09-09 실데이터 반증 · §19 참조).
     맞는 근거는 이것이다 — **옵션값이 「전」 기준**이고, `priceAfter` 의 출처가 제조사마다 달라
     (제네시스·르노는 「후 = 전」 복사) 「후」로는 통일이 안 된다. 감면은 §19 가 원가에서 뺀다.
     게다가 **옵션값은 「전」 기준**이라
     차값만 「후」로 쓰면 한 견적서 안에서 기준이 섞인다(기아 144트림 중 60개가 갈리고,
     EV9 GT-Line 롱레인지는 412만원 차이).
   ⚠ 이 검사를 고쳐서 통과시키지 마라 — 견적서 금액이 통째로 바뀐다. 정본 = docs/신차마스터-피드.md. */
{
  /* ★★★**문을 «불러서» 잰다.** 문자열로 재면 뚫린다 —
     2026-09-09 개발센터 4-AI 관문에서 Codex 가 네 가지 우회를 재현했다:
       · `t["priceAfter"]` 대괄호 접근        · `Number(t?.priceAfter)` 직접 접근
       · 문자열 리터럴 `"/*"` 로 code() 를 속여 코드를 지우기
       · 쉼표 연산자 `(A, Number(t?.priceAfter) || 0)` — **실제로 79,170,000 을 돌려주는데 통과**
     ⇒ 규격은 «값»으로 잰다. 아래는 전/후가 다른 진짜 트림(EV9 GT-Line 롱레인지)이다. */
  const ev9 = { priceBefore: 83290000, priceAfter: 79170000 };
  must(trimPrice(ev9) === 83290000,
    `차량가가 «세제혜택 후»에서 나옵니다 — ${trimPrice(ev9).toLocaleString('ko-KR')}원(나와야 할 값 83,290,000원). `
    + '옵션값이 「전」 기준이라 한 견적서에서 기준이 섞이고, 제조사마다 「후」의 뜻이 달라 비교가 안 됩니다',
    'lib/domain/estimate/car-index.ts trimPrice');
  must(trimBasis(ev9) === '세제혜택 전',
    `기준을 「${trimBasis(ev9)}」 라고 말합니다`, 'lib/domain/estimate/car-index.ts trimBasis');
  /* 「전」이 비면 «지어내지 않는다» — 「후」로 물러서되 그렇다고 말한다. */
  must(trimPrice({ priceBefore: 0, priceAfter: 5000 }) === 5000
    && trimBasis({ priceBefore: 0, priceAfter: 5000 }) === '세제혜택 후',
    '「전」이 빈 줄에서 물러서지 않거나, 물러서고도 «후»라고 말하지 않습니다',
    'lib/domain/estimate/car-index.ts trimBasis');
  must(trimPrice(null) === 0 && trimBasis(undefined) === '',
    '값이 없는데 0/빈 기준을 안 줍니다', 'lib/domain/estimate/car-index.ts trimPrice');

  must(/priceBasis: trimBasis\(t\)/.test(code('lib/domain/estimate/car-index.ts')),
    '고른 차가 «어느 기준»인지 안 들고 다닙니다 — 견적서가 말할 수 없습니다',
    'lib/domain/estimate/car-index.ts pickNew');

  /* ★★★**문은 하나다.** 값을 따로 꺼내는 곳이 하나라도 있으면 기준이 또 갈린다 —
     실제로 여섯 군데가 따로 꺼내 손님이 「7,917만」을 고르고 견적서엔 「8,329만」이 찍혔다
     (EV9 GT-Line 롱레인지 · **412만** 차이 · 2026-09-09 화면 실측).
     ⇒ 문(`car-index.ts`) 밖에서는 `priceAfter` 라는 낱말이 **아예 안 나와야** 한다.
       대괄호·구조분해·변수 경유를 다 막으려면 「쓰지 마라」가 「이렇게 쓰지 마라」보다 낫다. */
  for (const f of ['features/estimate/VehicleCascade.tsx', 'features/estimate/CarPicker.tsx',
    'app/estimate/page.tsx']) {
    must(!code(f).includes('priceAfter'),
      '차량가를 «문 밖에서» 꺼냅니다 — 고를 때와 견적서의 값이 갈립니다(`trimPrice` 를 쓰세요)', f);
  }
  /* ★엔진이 «제 줄»에서 감면한다는 전제가 깨지면 위 기준도 무너진다. 같이 못 박는다. */
  must(/acqTaxCredit/.test(code('lib/domain/estimate/calc.js')),
    '엔진이 전기차 취득세 감면을 «제 줄»에서 안 뺍니다 — 그러면 차량가 기준(「전」)의 전제가 깨집니다',
    'lib/domain/estimate/calc.js acqTax');
}

/* ══ 15. ★★★「이미 산 것」이 **돈에서 실제로 빠지는가** ══════════════════════
     ⚠⚠ 2026-09-09 개발센터 4-AI 관문에서 **Codex 가 잡았다.**
       §12·§13 은 크롤러가 `impliedOptions` 를 «만드는지»만 봤다. 그런데 화면 쪽은
       `requiresOf` 에서 「선행 충족」으로만 썼고 **목록·토글·합계는 아무것도 안 걸렀다.**
       ⇒ 「3.5 엔진 +246만」이 체크칸으로 서고, 체크하면 합계에 그대로 더해졌다.
       **「막았다」고 문서·주석·커밋에 적어 놓고 한 푼도 안 막고 있었다.**
       (재현: optionSum({optionsMaster:{eng35:2460000}, impliedOptions:['eng35']}, {'eng35'}) = 2,460,000)

     ★교훈 — **「만드는 쪽」을 검사하고 「쓰는 쪽」을 안 검사하면 그게 거짓 합격이다.**
       데이터에 표시를 남기는 것과 돈이 안 나가는 것은 «다른 일»이다. 여기서는 돈을 잰다. */
{
  const spec: OptionSpec = {
    optionsMaster: {
      eng35: { name: '가솔린 3.5 터보 엔진', price: 2460000 },
      awd: { name: 'HTRAC', price: 2470000 },
      cf: { name: '컴포트 I', price: 900000 },
    },
    availableOptions: ['eng35', 'awd', 'cf'],
    impliedOptions: ['eng35', 'awd'],
  };
  /* ㉠ 팔 물건 목록에 서면 안 된다 — 서면 영업자가 누른다. */
  const ids = optionList(spec).map((x) => x.id);
  must(!ids.includes('eng35') && !ids.includes('awd') && ids.includes('cf'),
    `「이미 산 것」이 팔 물건 목록에 섭니다 — [${ids.join(',')}] · 누르면 엔진값을 또 받습니다`,
    'lib/domain/estimate/option-rules.ts optionList');

  /* ㉡ 켜지면 안 된다. */
  must(!isEnabled(spec, 'eng35', new Set()) && isEnabled(spec, 'cf', new Set()),
    '「이미 산 것」을 켤 수 있습니다 — 켜지면 합계에 또 더해집니다',
    'lib/domain/estimate/option-rules.ts isEnabled');

  /* ㉢ ★마지막 빗장 — 목록·토글을 «뚫고» 들어와도(저장된 옛 선택·URL·버그) 돈은 안 나간다. */
  const sum = optionSum(spec, new Set(['eng35', 'awd', 'cf']));
  must(sum === 900000,
    `「이미 산 것」이 합계에 더해집니다 — ${sum.toLocaleString('ko-KR')}원(나와야 할 값 900,000원) · 그랜저 246만·HTRAC 247만 이중계상`,
    'lib/domain/estimate/option-rules.ts optionSum');

  /* ㉣ 선행 조건으로는 «충족»으로 본다 — 이미 갖고 있으니까. 이건 원래 되던 것이라 지킨다. */
  const dep: OptionSpec = { ...spec, optionsMaster: { ...spec.optionsMaster, pkg: { name: '패키지', price: 500000, requires: ['eng35'] } },
    availableOptions: ['cf', 'pkg'] };
  must(isEnabled(dep, 'pkg', new Set()),
    '「이미 산 것」을 선행으로 삼는 옵션이 영영 안 켜집니다 — 이미 갖고 있는데 못 고르게 막습니다',
    'lib/domain/estimate/option-rules.ts requiresOf');
}

/* ══ 16. ★★★**파이프도 검사한다** — 만드는 쪽·쓰는 쪽만 막으면 사이로 샌다 ═══════
     ⚠⚠ 2026-09-09 개발센터 4-AI 관문에서 **Codex 가 잡았다.**
       나는 크롤러(만드는 쪽)와 `option-rules`(쓰는 쪽)를 다 막아 놓고, **그 사이 피드**를 안 봤다.
       `/api/newcar` 가 `&& v.availableOptions.length` 로 **빈 배열을 통째로 떨궜고**,
       소비자는 칸이 없으니 「못 받았다」로 읽어 **옵션 «전부»를 열었다.**
       ⇒ 「빈 배열 = 고를 것이 없다」 방어가 운영에서 **통째로 무력화**돼 있었다.
     ★교훈 — 「없다」와 「비었다」를 가르기로 해 놓고 **전송에서 둘을 합치면** 가른 적이 없는 것이다. */
{
  const api = code('app/api/newcar/route.ts');
  for (const f of ['availableOptions', 'impliedOptions']) {
    must(!new RegExp(`Array\\.isArray\\(v\\.${f}\\)\\s*&&\\s*v\\.${f}\\.length`).test(api),
      `피드가 빈 «${f}» 를 버립니다 — 소비자가 「못 받았다」로 읽어 그 트림에 없는 옵션을 팝니다`,
      'app/api/newcar/route.ts');
    must(new RegExp(`Array\\.isArray\\(v\\.${f}\\)\\s*\\?`).test(api),
      `피드가 «${f}» 를 배열 그대로 안 보냅니다`, 'app/api/newcar/route.ts');
  }
}

/* 16-2. ★그 트림에서 «파는 것»이 아니면 켤 수 없다 — 목록에서 뺀 것이 합계에 들면 안 된다.
     G80 2.5T 줄에서 「20" 피렐리(3.5T 전용)」를 켜고 70만원을 받을 수 있었다(Codex 재현). */
{
  const spec: OptionSpec = {
    optionsMaster: { w20: { name: '20" 피렐리 타이어&휠', price: 700000 }, cf: { name: '컴포트 I', price: 900000 } },
    availableOptions: ['cf'],
  };
  must(!isEnabled(spec, 'w20', new Set()) && isEnabled(spec, 'cf', new Set()),
    '그 트림에서 «안 파는» 옵션을 켤 수 있습니다 — 목록에 없는 것이 합계에 듭니다',
    'lib/domain/estimate/option-rules.ts isEnabled');
  const after = toggleOption(spec, 'w20', new Set(['cf']));
  must(!after.has('w20'),
    '안 파는 옵션이 토글로 들어옵니다 — 있을 수 없는 차의 값이 견적서에 찍힙니다',
    'lib/domain/estimate/option-rules.ts toggleOption');
}

/* ══ 17. ★★★제네시스 `base` 의 «기준»은 모델마다 다르다 — 이름을 잘못 붙이지 않는다 ═══
     ⚠⚠ 2026-09-09 개발센터 4-AI 관문에서 **Codex 가 잡았다.**
       정본(`genesis-config-fs.json`)이 G80-EV 를 「**세제혜택 후** 최저」라 적어 두었는데,
       피드 폴백이 그 값을 `priceBefore` 에 넣고 **「세제혜택 전」이라 이름 붙여** 내보냈다.
       코드 주석까지 「제네시스 min 은 세제혜택 전이다」로 **반대로** 적혀 있었다.
       ★**주석은 증거가 아니다. 데이터가 말하게 한다.** */
{
  const g80ev = { model: 'G80-EV', base: 84790000,
    minMax: { min: 84790000, minConfig: '세제혜택 후 최저(스탠다드 2WD/단일AWD, 개소세5%)',
      variants: { 'AWD 세제후': 84790000, '세제전': 89080000 } } };
  const b1 = basisOf(g80ev);
  must(b1.price === 89080000 && b1.basis === '세제혜택 전',
    `「세제전」이 «적혀 있는데» 안 씁니다 — ${b1.price.toLocaleString('ko-KR')}원 / ${b1.basis}`,
    'lib/domain/estimate/genesis-lineup.ts basisOf');

  /* 「전」이 없고 「후」라고 적혀 있으면 — 값은 쓰되 «후»라고 말한다. 지어내지 않는다. */
  const onlyAfter = { model: 'X-EV', base: 1000, minMax: { min: 1000, minConfig: '세제후 최저', variants: {} } };
  const b2 = basisOf(onlyAfter);
  must(b2.price === 1000 && b2.basis === '세제혜택 후',
    `「후」밖에 없는데 「${b2.basis}」 라고 말합니다 — 금액의 기준 자체를 잘못 설명합니다`,
    'lib/domain/estimate/genesis-lineup.ts basisOf');

  /* 표시가 없는 내연 = 피드 정본 규칙(개소세 5%)대로 「전」. */
  must(basisOf({ model: 'G80', base: 60630000, minMax: { min: 60630000, variants: {} } }).basis === '세제혜택 전',
    '표시가 없는 내연 모델을 「전」으로 안 봅니다 — 피드 정본은 「모든 가격 = 개소세 5%」입니다',
    'lib/domain/estimate/genesis-lineup.ts basisOf');

  /* ★표시가 없는 «전기»는 「미확인」이다 — 형제 EV 가 「세제후」라 「전」이라 단정하면 지어내는 것이다. */
  must(basisOf({ model: 'GV70-EV', base: 79740000, minMax: { min: 79740000, variants: {} } }).basis === '기준 미확인',
    '기준이 안 적힌 전기 모델을 「전」이라 단정합니다 — 형제 EV 는 「세제후」로 적혀 있습니다',
    'lib/domain/estimate/genesis-lineup.ts basisOf');

  /* ★피드 폴백이 그 판정을 «쓰는가» — 판정만 만들고 안 쓰면 아무것도 안 고친 것이다. */
  const rt = code('app/api/newcar/route.ts');
  must(/basisOf\(/.test(rt) && !/priceBasis: '세제혜택 전', options: \[\], _fallback/.test(rt),
    '제네시스 폴백이 기준을 «무조건 전»으로 박습니다 — 세제후 값을 「전」이라 부릅니다',
    'app/api/newcar/route.ts');
}

/* ══ 18. ★★★펴 놓은 제네시스 줄은 «기본 포함»도 다시 센다 ══════════════════════
     ⚠⚠ 2026-09-09 개발센터 4-AI 관문 · **Codex #4.** 엔진 × 구동으로 펴면서 «펴기 전»
       옵션 조건을 그대로 복사해, 정본이 「기본포함」이라 적어 둔 것을 **또 팔고** 있었다:
         · G80 3.5T·AWD 70,030,000 → ECS(프리뷰 전자제어 서스펜션) 선택 → **71,130,000**
         · GV80 블랙 2.5T 95,080,000 → AWD 선택 → **98,080,000**
       ★「이름에 AWD 가 없으면 진짜 옵션」이라는 규칙이 **기본구성 정보와 충돌**했다 —
         구동 그룹이 «없는» 라인업은 구동이 base 에 박힌 것이지 «없는» 것이 아니다.
     ⇒ 정본이 «사람 말»로 적어 둔 세 자리를 읽는다(`baseConfig` · 엔진 `note` · `conditionals`). */
{
  /* ⚠ **겹치는 항목을 빼지 않는다.** 정본 사전에는 「AWD」와 「드라이빙어시Ⅱ(AWD)」가 같이 있고,
     그것을 빼 놓았더니 §18 이 초록인데 GV80 블랙이 AWD 300만을 또 팔고 있었다(2026-09-10 Codex). */
  const om = {
    ecs: { name: '프리뷰 전자제어 서스펜션', price: 1100000 },
    awd: { name: 'AWD', price: 3000000 },
    bo: { name: '뱅앤올룹슨', price: 1900000 },
    pano: { name: '파노라마 선루프', price: 1400000 },
    d2a: { name: '드라이빙어시Ⅱ(2WD)', price: 2000000 },
    d2b: { name: '드라이빙어시Ⅱ(AWD)', price: 2700000 },
  };
  const rows = expandGenesis([{
    maker: '제네시스', sub_model: 'G80', fuel: '가솔린', priceBefore: 0, priceAfter: 0,
    optionsMaster: om, availableOptions: Object.keys(om),
  } as never]) as Record<string, unknown>[];
  const find = (fuelRe: RegExp, trim: string) =>
    rows.find((r) => fuelRe.test(String(r.fuel)) && String(r.trim) === trim);

  /* 재현 A — G80 3.5T 는 ECS 가 기본이다(`choices[3.5T].note` 「ECS·19인치 콘티 기본」). */
  const a = find(/3\.5/, 'AWD');
  const aIm = (a?.impliedOptions ?? []) as string[];
  must(!!a && Number(a.priceBefore) === 70030000 && aIm.includes('ecs') && aIm.includes('awd'),
    `G80 3.5T·AWD 가 기본 포함을 «또 팝니다» — ${Number(a?.priceBefore || 0).toLocaleString('ko-KR')}원 / implied=[${aIm.join(',')}]. `
    + 'ECS 를 고르면 110만이 더 붙습니다',
    'lib/domain/estimate/genesis-lineup.ts expandGenesis');
  /* ⚠ 2.5T 에서는 ECS 가 «진짜 유료 옵션»이다 — 넘겨 짚어 지우면 유료 옵션이 사라진다. */
  const b25 = find(/2\.5/, '2WD');
  must(!((b25?.impliedOptions ?? []) as string[]).includes('ecs'),
    'G80 2.5T 에서 ECS 를 「이미 샀다」고 지웁니다 — 거기서는 진짜 유료 옵션(110만)입니다',
    'lib/domain/estimate/genesis-lineup.ts expandGenesis');

  /* 재현 B — GV80 블랙은 구동 그룹이 «없고» base 가 AWD 다(`baseConfig` 「2.5T·AWD·…」). */
  const gv = (expandGenesis([{
    maker: '제네시스', sub_model: 'GV80', fuel: '가솔린', priceBefore: 0, priceAfter: 0,
    optionsMaster: om, availableOptions: Object.keys(om),
  } as never]) as Record<string, unknown>[]).find((r) => String(r.trim) === '블랙' && /2\.5/.test(String(r.fuel)));
  const gvIm = (gv?.impliedOptions ?? []) as string[];
  must(!!gv && Number(gv.priceBefore) === 95080000 && gvIm.includes('awd'),
    `GV80 블랙이 AWD 를 «또 팝니다» — ${Number(gv?.priceBefore || 0).toLocaleString('ko-KR')}원 / implied=[${gvIm.join(',')}]. `
    + '구동 그룹이 없는 라인업은 구동이 base 에 박힌 것입니다(+300만)',
    'lib/domain/estimate/genesis-lineup.ts expandGenesis');

  /* ★그래서 돈이 실제로 안 나가는가 — 판정만 만들고 안 쓰면 아무것도 안 고친 것이다(§15 의 교훈). */
  const spec: OptionSpec = { optionsMaster: om, availableOptions: Object.keys(om), impliedOptions: aIm };
  must(optionSum(spec, new Set([...aIm, 'pano'])) === 1400000,
    '기본 포함이 합계에 더해집니다 — 파노라마만 고른 값(1,400,000원)이 나와야 합니다',
    'lib/domain/estimate/option-rules.ts optionSum');

  /* ⚠ 줄임말 맞대기가 «넘겨 짚지» 않는가 — 못 찾으면 지우지 않는다. */
  must(matchIncluded('없는이름', { a: '컴포트 I' }) === undefined,
    '없는 이름을 아무 옵션에나 갖다 붙입니다 — 유료 옵션이 사라집니다',
    'lib/domain/estimate/genesis-included.ts matchIncluded');
  must(matchIncluded('뱅올', { bo: '뱅앤올룹슨' }) === 'bo' && matchIncluded('ECS', { e: '프리뷰 전자제어 서스펜션' }) === 'e',
    '정본이 줄여 쓴 말(「뱅올」·「ECS」)을 못 알아봅니다 — 기본 포함을 또 팝니다',
    'lib/domain/estimate/genesis-included.ts matchIncluded');
}

/* ══ 19. ★★★**판매가격 세제감면을 «실제로» 뺀다** ═══════════════════════════
     ⚠⚠ 2026-09-09 개발센터 4-AI 관문 · **독립 Claude F1.** 우리는 차량가를
       「세제혜택 «전»」(표시가)으로 통일해 놓고 그 감면을 **어디서도 빼지 않았다.**
       「이중차감」이 아니라 **「미차감」**이었고, 나는 그 틀린 전제를 §14 에
       「고치지 마라 — 규격을 지운 것과 같다」로 **잠가** 두었다.
       ★반증은 실데이터다 — 전기 77줄 감면이 가격의 4.81~4.94%(비례·절편 0),
         하이브리드 35줄이 **정액 1,001,000**. 취득세 감면(한도 140만)이 섞였다면
         하이브리드가 그보다 작을 수 없다. ⇒ 판매«가격» 세제와 취득세는 **겹치지 않는다.**
       실측 손해: EV9 GT-Line 렌트반납 48개월 **월 63,000원 · 48개월 302만원** 비쌌다. */
{
  /* 19-1. 제조사가 준 두 값의 «차»를 쓴다 — 법정 한도를 우리가 계산하지 않는다. */
  must(trimSaleTaxCredit({ priceBefore: 83290000, priceAfter: 79170000 }) === 4120000,
    '판매가격 세제감면을 «제조사가 준 차»로 안 잡습니다', 'lib/domain/estimate/car-index.ts trimSaleTaxCredit');
  /* ⚠ 「후」가 「전」과 같으면 0 — 제네시스·르노는 `priceAfter = priceBefore` 로 «복사»만 되어 있다.
       「없다」가 아니라 「아직 안 받아왔다」이다. 지어내지 않는다. */
  must(trimSaleTaxCredit({ priceBefore: 60630000, priceAfter: 60630000 }) === 0
    && trimSaleTaxCredit({ priceBefore: 0, priceAfter: 5000 }) === 0,
    '감면이 없는 줄에서 값을 «지어냅니다»', 'lib/domain/estimate/car-index.ts trimSaleTaxCredit');

  /* 19-2. ★★**엔진이 그것을 실제로 뺀다** — 값만 만들고 안 쓰면 아무것도 안 고친 것이다
       (§15 에서 겪은 그대로: `impliedOptions` 를 만들어 놓고 합계에서 안 뺐다). */
  const cj = code('lib/domain/estimate/calc.js');
  must(/netPrice = Math\.max\(0, price - evSubsidy - saleTaxCredit\)/.test(cj),
    '엔진이 판매가격 세제감면을 취득가에서 안 뺍니다 — 전기·하이브리드 견적이 그만큼 비쌉니다',
    'lib/domain/estimate/calc.js netPrice');
  /* ⚠ 취득세 감면은 «별개»다 — 같이 지우면 이번엔 반대로 두 번 빼게 된다. */
  must(/acqTaxCredit/.test(cj),
    '취득세 감면(별개)을 같이 지웠습니다 — 판매가격 세제와 취득세는 겹치지 않습니다',
    'lib/domain/estimate/calc.js acqTax');
  must(code('lib/domain/estimate/quote-input.js').includes('saleTaxCredit'),
    '견적 입력이 감면을 엔진에 안 넘깁니다', 'lib/domain/estimate/quote-input.js');
  must(code('app/estimate/page.tsx').includes('saleTaxCredit'),
    '화면이 고른 차의 감면을 안 싣습니다', 'app/estimate/page.tsx');

  /* 19-3. ★손님이 보는 값은 «안 움직인다» — 표시는 「전」 하나, 감면은 원가에서만.
       고른 차량가에서 감면을 빼 버리면 제조사 표시가와 달라져 손님이 못 믿는다. */
  must(trimPrice({ priceBefore: 83290000, priceAfter: 79170000 }) === 83290000,
    '표시 차량가에서 감면을 빼 버립니다 — 제조사 표시가와 달라집니다',
    'lib/domain/estimate/car-index.ts trimPrice');
}

/* ══ 20. 규칙·값 읽기의 «갈래»를 빠뜨리지 않는다 (독립 Claude F3·F4) ═══════════ */
{
  /* 20-1. 「A 선택 불가」 — 「동시/중복」이 «없는» 갈래. 운영 데이터에 실제로 있다. */
  must(readRule('블랙 익스테리어 선택 불가').bans.includes('블랙 익스테리어'),
    '「… 선택 불가」(동시·중복 없는 갈래)를 안 읽습니다 — 규칙이 한 개도 안 섭니다',
    'lib/domain/estimate/option-note.ts readRule');
  must(readRule('선루프와 동시 적용 불가').bans.includes('선루프')
    && readRule('19인치 휠 적용 시 가능').needs.includes('19인치 휠'),
    '갈래를 늘리다 원래 되던 것을 깼습니다', 'lib/domain/estimate/option-note.ts readRule');

  /* 20-2. ★값을 «붙여 읽지» 않는다 — 「1,200,000 ~ 2,000,000」이 12조가 됐다. */
  must(priceOf('<p class="item-price">1,200,000 ~ 2,000,000</p>') === 1200000,
    `범위 값을 붙여 읽습니다 — ${priceOf('<p class="item-price">1,200,000 ~ 2,000,000</p>')}`,
    'lib/domain/estimate/option-note.ts priceOf');
  must(priceOf('<p class="item-price">150만원</p>') === 1500000,
    `「만원」 표기를 원 단위로 읽습니다 — ${priceOf('<p class="item-price">150만원</p>')}원`,
    'lib/domain/estimate/option-note.ts priceOf');

  /* 20-3. ★구동말이 «들어 있다»고 구동 그 자체는 아니다 — G90 「후륜 조향 시스템」 150만이 사라졌다. */
  must(impliedOf({ rs: { name: '후륜 조향 시스템' } }, '가솔린 3.5 터보', '2WD(후륜)').length === 0,
    '「후륜 조향 시스템」을 「이미 산 구동」으로 지웁니다 — 150만원짜리 유료 옵션이 사라집니다',
    'lib/domain/estimate/implied-options.ts impliedByTrim');
  must(impliedOf({ d: { name: '전자제어 풀타임 4WD' } }, '가솔린 2.5 터보', 'AWD').length === 1,
    '진짜 구동(「전자제어 풀타임 4WD」)까지 안 걸러냅니다 — 구동값을 또 받습니다',
    'lib/domain/estimate/implied-options.ts impliedByTrim');
}

/* ══ 21. ★★★2026-09-10 개발센터 4-AI 관문 «재검토»에서 잡힌 것 ═════════════════
     앞 회차를 고치면서 **새로 만든 균열**과, 내가 **조작한 검사**가 드러났다. */

/* 21-1. ★★★**화면과 견적서가 «같은 값»을 쓴다** (Codex 발견 1·2)
     견적서만 감면 후(`netPrice`)로 옮기고 화면 카드(선납·만기인수·손익)를 `price` 로 남겨,
     한 견적에서 인수가가 **239만** 갈렸다(EV9 48개월: 화면 4,831만 vs 견적서 4,592만).
     ⚠ 「기준이 하나」는 **문서 안»에서만»이 아니라 화면과 문서 «사이»에서도** 지켜야 한다. */
{
  const pg = code('app/estimate/page.tsx');
  for (const what of ['sc.pre / 100', 'buyoutPct[sc.term] / 100']) {
    const line = pg.split('\n').find((l) => l.includes(what)) ?? '';
    must(line.includes('netPrice'),
      `화면 카드가 «감면 전» 값으로 셉니다 — 견적서와 갈립니다(${what})`, 'app/estimate/page.tsx');
  }
  must(!/Math\.round\(price \* (sc\.pre|buyoutPct)/.test(pg),
    '화면에 «감면 전» 기준이 남아 있습니다 — 손님이 두 값을 보게 됩니다', 'app/estimate/page.tsx');
}

/* 21-2. ★★★**검사를 조작하지 않는다** — §18 은 «겹치는 항목을 뺀» 사전으로 초록을 냈다.
     정본의 진짜 사전에는 「AWD」와 「드라이빙어시Ⅱ(AWD)」가 **같이** 있고, 그러면
       · `matchIncluded('AWD')` 가 둘에 걸려 **못 찾고** → GV80 블랙이 AWD **300만**을 또 판다
       · `matchIncluded('드라Ⅱ')` 가 **2WD 항목**을 집어 → AWD용 드라Ⅱ **270만**을 또 판다
     (2026-09-10 Codex 발견 4 · 앞 회차 반례가 «죽지 않았다»).
     ⇒ 아래 사전은 GV80 정본 `options.individual` 그대로다. 빼지 않는다. */
{
  const real = {
    awd: 'AWD', pano: '파노라마 선루프', hud: '헤드업 디스플레이', conv: '컨비니언스 패키지',
    d1: '드라이빙어시Ⅰ', d2a: '드라이빙어시Ⅱ(2WD)', d2b: '드라이빙어시Ⅱ(AWD)',
    rear: '후석컴포트 패키지', bo: '뱅앤올룹슨', cam: '빌트인캠',
  };
  must(matchIncluded('AWD', real, 'AWD') === 'awd',
    `이름이 «똑같은데» 못 찾습니다 — ${matchIncluded('AWD', real, 'AWD') ?? '(못 찾음)'}. GV80 블랙이 AWD 300만을 또 팝니다`,
    'lib/domain/estimate/genesis-included.ts matchIncluded');
  must(matchIncluded('드라Ⅱ', real, 'AWD') === 'd2b' && matchIncluded('드라Ⅱ', real, '2WD(후륜)') === 'd2a',
    `구동이 갈리는 항목을 «그 줄의 구동»으로 안 고릅니다 — AWD줄에서 ${matchIncluded('드라Ⅱ', real, 'AWD')}. AWD용 270만을 또 팝니다`,
    'lib/domain/estimate/genesis-included.ts matchIncluded');
  /* ⚠ 구동을 «모르면» 고르지 않는다 — 지어내면 진짜 옵션이 사라진다. */
  must(matchIncluded('드라Ⅱ', real, '') === undefined,
    '구동을 모르는데 둘 중 하나를 «지어냅니다»', 'lib/domain/estimate/genesis-included.ts matchIncluded');
}

/* 21-3. ★★구동은 «트림»에만 있는 게 아니다 (Codex 발견 5)
     아이오닉6·아이오닉9 는 파워트레인 쪽에 붙는다(「전기 롱레인지 AWD」·트림은 「Prestige」).
     트림만 보면 **HTRAC 247만을 또 판다.** */
must(impliedOf({ htrac: { name: 'HTRAC (상시 4륜 구동)' } }, '전기 롱레인지 AWD', 'Prestige').length === 1,
  '파워트레인에 든 구동을 못 봅니다 — 아이오닉6 에서 HTRAC 247만을 또 팝니다',
  'lib/domain/estimate/implied-options.ts impliedOf');
must(impliedOf({ htrac: { name: 'HTRAC' } }, '전기 롱레인지 2WD', 'Prestige').length === 0,
  '2WD 줄에서 HTRAC 를 「이미 샀다」고 지웁니다 — 진짜 유료 옵션입니다',
  'lib/domain/estimate/implied-options.ts impliedOf');

/* 21-4. ★★**마지막 빗장은 «고를 수 있는 것»만 센다** (Codex 발견 3)
     예전 빗장은 「이미 산 것」만 막고, «그 트림에서 안 파는 것»·«규칙을 어긴 것»은 그대로 더했다. */
{
  const 금지: OptionSpec = {
    optionsMaster: { f: { name: '3.5T 전용 휠', price: 700000 }, ok: { name: '컴포트 I', price: 900000 } },
    availableOptions: ['ok'],
  };
  must(optionSum(금지, new Set(['f', 'ok'])) === 900000,
    `안 파는 옵션이 합계에 듭니다 — ${optionSum(금지, new Set(['f', 'ok'])).toLocaleString('ko-KR')}원(나와야 할 값 900,000원)`,
    'lib/domain/estimate/option-rules.ts optionSum');
  const 선행: OptionSpec = {
    optionsMaster: { a: { name: 'A', price: 100 }, b: { name: 'B', price: 200, requires: ['a'] } },
    availableOptions: ['a', 'b'],
  };
  must(optionSum(선행, new Set(['b'])) === 0 && optionSum(선행, new Set(['a', 'b'])) === 300,
    '선행을 안 갖춘 옵션이 합계에 듭니다 — 있을 수 없는 차의 값이 나갑니다',
    'lib/domain/estimate/option-rules.ts optionSum');
}

if (fails.length) {
  console.error(`\n✗ 견적 로직이 정본과 다릅니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`  · ${f}\n`);
  console.error('  정본: docs/견적-원가-로직.md');
  console.error('  바꾸시려면 — 사장님께 여쭙고 → 문서를 고치고 → 이 검사를 고칩니다.');
  console.error('  ⚠ 이 검사를 «먼저» 고쳐 통과시키는 것은 규격을 지운 것과 같습니다.\n');
  process.exit(1);
}
console.log('✓ 견적 정합 — 법정값 · 배기량 · 원가 갈래 · 손바뀜 · 위약금 · 잔가 · 화면 규격 · **옵션 규칙(행동 검사)**');
