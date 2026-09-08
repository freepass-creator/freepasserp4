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

/* ㉮ 견적은 **ERP «안»의 페이지**다 — 상단바·전체메뉴를 입는다.
     ⚠ 2026-09-07 사장님이 바로잡으셨다 — 「난 로그인해서 «내부 페이지»처럼 하자는 거였음」.
       9/6 「완전 별도 페이지」를 «껍데기를 벗어라»로 읽고 `guest-surface` 에 넣었던 것이 어긋난 것이었다. */
must(/const OWN_HEADER_PREFIXES = \[\] as const;/.test(guestSurface),
  '견적이 ERP 상단바를 다시 벗고 있습니다 — 「내부 페이지처럼」이 규격입니다(`OWN_HEADER_PREFIXES` 는 비어 있어야 합니다)',
  'lib/guest-surface.ts');
/* ★사장님 2026-09-08 「원가설정에는 왜 **밑줄**이 가져 있지?」 · 「견적내기 / 원가설정 **잘 정렬**해 주고」
     · 「각 페이지는 이거랑 맞춰야지, **원가랑 견적은 동일하게**」
   ⇒ 두 화면이 «같은» 머리 띠(`.global-topbar`)와 «같은» 토글(`.gt-modes`)을 쓴다.
     한쪽만 고치면 또 어긋나므로 둘을 함께 잰다. 밑줄은 `.gt-modes` 가 없앤다. */
must(/className="global-topbar"/.test(page) && /className="global-topbar"/.test(costPage),
  '견적·원가의 머리 띠가 다릅니다 — 두 화면은 «같은» 머리를 씁니다',
  'app/estimate/**/page.tsx .global-topbar');
must(/className="gt-modes"/.test(page) && /className="gt-modes"/.test(costPage),
  '「견적내기 / 원가설정」 토글이 두 화면에 같이 서 있지 않습니다',
  'app/estimate/**/page.tsx .gt-modes');
must(/\.gt-modes > \*\s*\{[\s\S]*?text-decoration: none/.test(wxCss),
  '토글 링크에 밑줄이 다시 그어집니다 — 링크라 그어지던 것을 `.gt-modes` 가 없앱니다',
  'components/estimate/welrix.css .gt-modes');
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
must(!/<select/.test(page) && !/<select/.test(cascade),
  '고르는 칸에 드롭다운이 다시 섰습니다 — 견적기에서 고르는 것은 전부 버튼입니다',
  'app/estimate/page.tsx · features/estimate/VehicleCascade.tsx');
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
must(/const listPrice = isNew \? \(picked\.price \?\? 0\) \+ optSum : usedPrice;/.test(page),
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
must(/className="foldhead"/.test(page) && /residOpen \? \(/.test(page),
  '연도별 잔가가 «접혀» 있지 않습니다 — 원가에 속한 값이라 꺼내서 쓰는 것이 규격입니다',
  'app/estimate/page.tsx #sec-resid');
must(!/className="vfields" hidden=/.test(page),
  '`hidden` 으로 접고 있습니다 — `.vfields{display:grid}` 가 이겨서 «안 접힙니다»(2026-09-08 실측)',
  'app/estimate/page.tsx');
must(/guessMarketPrice/.test(page) && /priceSeeded/.test(page),
  '시세를 «채워 주지» 않습니다 — 차를 바꾸면 앞 차 시세가 남아 대여료가 엉뚱해집니다',
  'app/estimate/page.tsx');
must(/const priceKnown = /.test(page) && /priceKnown && c\.payVat/.test(page),
  '시세를 모르는데 대여료가 섭니다 — 감가만 0 이고 고정비가 남은 «찌꺼기»입니다(2026-09-08 실측 274,000원)',
  'app/estimate/page.tsx priceKnown');
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
console.log('✓ 견적 정합 — 법정값 · 배기량 · 원가 갈래 · 손바뀜 · 위약금 · 잔가 · **화면 규격(웰릭스 테이블)**');
