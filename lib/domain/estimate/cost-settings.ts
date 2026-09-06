/**
 * 원가 설정 — 「원가」 화면(`/estimate/cost`)이 적고, 「견적」 화면(`/estimate`)이 읽는다.
 *
 * ★한 곳(SSOT). 두 화면이 각자 기본값을 들고 있으면, 원가를 고쳐도 견적이 안 바뀌는 날이 온다.
 *
 * ★기본값은 **엔진의 `DEFAULT_CONFIG` 에서 꺼낸다** — 여기서 숫자를 새로 적지 않는다.
 *   화면이 「6.5%」라고 보여주면 엔진도 6.5% 를 쓰고 있어야 한다. 안 그러면 화면이 거짓말을 한다.
 *
 * ★저장은 **회사 공용**이다 — `app/api/estimate/cost/route.ts`(Firestore `settings/estimate_cost`).
 *   읽기는 로그인한 모두, 쓰기는 **관리자만**. 화면이 쓰는 문은 `cost-client.ts` 하나다.
 *   ⚠ 이 파일은 **서버도 읽는다**(그 라우트가 기본값·타입을 여기서 가져간다).
 *     그래서 여기에 `window`·firebase 를 들이지 않는다 — 순수한 값과 환산만 둔다.
 *
 * ⚠ 목업(`프리패스-목업-원가설정.html`)에 있으나 **엔진이 아직 안 쓰는 칸**이 있다.
 *   지우지 않고 그대로 두되 화면에 「미반영」이라 적는다 — 없는 척하면 다음에 또 만든다.
 *     · 1차 탁송료 · 초기 상품화비 · 정기검사비
 *       → 엔진에 자리(`deliveryFee`/`etcInitRate`/`inspectionFee`)는 있고 값은 0 이다.
 *         「탁송·정기검사·기타초기비는 간접비로 보아 직접비 원가에 넣지 않는다」(대표 2026-09-05).
 *     · 일반관리·간접비 배분율 · 대손·리스크 충당 · 페이백 테이블 → 엔진에 자리가 없다.
 */
import { DEFAULT_CONFIG } from './default-config.js';

const D = DEFAULT_CONFIG as unknown as {
  interestRate: { rent: number; sub: number };
  marginRate: { rent: number; sub: number };
  loanRatio: number;
  acqTaxRate: { rent: number; sub: number };
  setting: {
    bondRate: number; regFee: number; insYear: number; selfRate: number;
    /** 정비비 — **정액(원/월) ＋ 비율(연 %)**. 둘 다 넣으면 더해진다(항목마다 맞는 쪽이 있다). */
  maintMonthly: number; maintRatePct: number;
  gpsMonthly: number; parkingMonthly: number;
    salesFeeRate: { rent: number; sub: number };
  };
};

/**
 * 화면이 다루는 값 — 전부 «사람이 읽는 단위»(퍼센트는 %, 돈은 원)다. 엔진 단위 환산은 `configFrom` 한 곳에서만.
 *
 * ★★2026-09-06 사장님 「**불변 데이터**(취득세·자동차세 같은 법정값) **말고는 다 다르다.**
 *   대출 얼마 받을 거냐, 금리가 얼마냐, 보험료가 얼마냐, **반납률이 얼마냐**, 저신용·중신용·고신용
 *   각자 회사마다 그 반납률을 얼마로 할 거냐 — 이런 건 다 다르기 때문에 **다 입력할 수 있게끔** 해야 돼.
 *   판관비도 빼서 계산해도 되지만 판관비를 넣어서 이익률 조정하든지, **이익률로 조정할지 잔가로 조정할지**
 *   이런 거는 다 좀 **자유롭게 조정**할 수 있게끔 해야 돼. 근데 그게 조합돼서 견적이 나오면 되는 거지」.
 *   ⇒ 그래서 손잡이가 넷이다 — **원가를 올리거나(항목·판관비) · 이익률을 올리거나 · 잔가를 내리거나 ·
 *     손바뀜(반납률)을 잡거나.** 어느 쪽으로 조정할지는 회사가 정한다.
 *
 * ★★**「리스크율」 같은 별도 값은 두지 않는다**(사장님 2026-09-06 「리스크율이라는 건 없어.
 *   그냥 **반납률이나 현존하는 것들의 값을 입력해서 그거대로 그냥 반영**하면 되는 거지」).
 *   신용등급 차이는 **반납률 입력값에서 저절로 나온다** — 손바뀜 횟수(1÷반납률−1) × 회당 비용.
 *   신용마다 %를 따로 적는 칸을 만들면 「그 %가 왜 그 값인지」를 아무도 못 댄다.
 *
 * ★★**잔가는 신용과 무관하다**(사장님 2026-09-06 「잔가는 다 동일해. 리스크율로 **대여료**를 다르게
 *   하는 거고, **차량별로** 그 잔존가에 플러스마이너스를 하는 거고」).
 *   ⇒ 잔가 = 표준곡선(국산 4년 58%) + **차종·체급 델타**. 신용은 잔가를 건드리지 않는다.
 *   ⚠ welrix 신차 엔진은 신용별로 잔가를 갈랐다(고54·중56·저58%) — 우리 규칙과 어긋나 안 옮겼다.
 * ⚠ **법정값은 여기 없다** — 자동차세(cc단가)·개별소비세·부가세는 엔진이 자동으로 센다. 취득세율만
 *   영업용/비영업용이 갈려 화면에 둔다(회사가 아니라 «상품»이 정하는 값이라 채널축이다).
 */
export type CostSettings = {
  // 취득
  bondPct: number; regFee: number;
  deliveryFee: number; initPrepFee: number;        // 미반영(간접비로 봄)
  /**
   * **금융 — 신용 구간(A/B/C)별로 나뉜다.**
   * ★사장님 2026-09-06 「저신용하고 정상신용 렌터카 **원가는 똑같지**. 근데 거기에서 우리가
   *   저신용 원가·중신용 원가·정상신용 원가를 **조금씩 구분해서 입력**을 하는 거야.
   *   저신용은 **금리를 조금 높게** 할 수도 있는 거고, **계약 유지율을 좀 낮게** 할 수 있는 거고.
   *   그래서 **원가 항목은 다 같은데** 그 구간을 나눠 놓는 거지. **ABC 로 나눠서 정상신용에는 A 적용,
   *   중신용 B, 저신용 C** 이렇게 가는 거야」.
   *   ⇒ 구간은 셋 — **A(정상) · B(중신용) · C(저신용)**. 항목은 같고 값만 다르다.
   */
  interestAPct: number; interestBPct: number; interestCPct: number;
  loanAPct: number; loanBPct: number; loanCPct: number;
  // 직접 운영비
  /** 정비비 — **정액(원/월) ＋ 비율(연 %)**. 둘 다 넣으면 더해진다(항목마다 맞는 쪽이 있다). */
  maintMonthly: number; maintRatePct: number;
  gpsMonthly: number; parkingMonthly: number;
  inspectionFee: number;                            // 미반영
  // 판관비
  overheadPct: number; badDebtPct: number;          // 미반영(엔진에 자리 없음)
  // 수수료
  salesFeePct: number;
  // 조건별(채널축)
  acqTaxRentPct: number; acqTaxSubPct: number;
  /**
   * 보험·자차 — **채널마다 다르다**. 구독은 보통 고객 명의라 0 이다.
   * ★자차가 원가에 들어오는 길이 둘이다(사장님 2026-09-06) —
   *     자체 충당 `selfPct` = 차량가 × %/년 (실무 1~2%, 보험사 자차요율과 비슷한 자리)
   *     자차보험 가입 `selfInsYear` = 정액 원/년
   *   한쪽만 쓰면 다른 쪽은 0. 둘 다 넣으면 더해진다.
   */
  insRentYear: number; insSubYear: number;
  selfRentPct: number; selfSubPct: number;
  selfInsRentYear: number; selfInsSubYear: number;
  marginRentPct: number; marginSubPct: number;
  /**
   * 차량가 업금액 — 사 온 값에 얹어 «취득원가»를 만든다. 감가·이자·수수료가 다 이 값 위에서 돈다.
   * ★축이 **중고/신차**다(렌트/구독이 아니다). 업금액은 «차를 어떻게 들여왔나»에 붙는 값이기 때문이다.
   *   중고 = 매입가(우리가 사 온 값)에 얹는다.
   *   신차 = **출고가(제조사 공표가)라 기본 0**이다 — 공표가에 우리가 얹을 자리가 없다.
   *   ⚠ 2026-09-06 까지 신차에도 20%가 붙어 있었다. 그래서 신차 2,500만이 실제보다 비쌌다.
   */
  markupUsedPct: number; markupNewPct: number;
  /** EW(연장보증) — 렌트 반납형만. 연 단위. */
  ewYear: number;
  // 손바뀜(반납률) — 신용등급별 계약 유지율. 낮을수록 손바뀜이 잦아 위험원가가 커진다.
  retentionNormalPct: number; retentionMidPct: number; retentionLowPct: number;
  /** 손바뀜 회당 비용 — 상품화 · 왕복탁송 · 영업수수료(총대여료 대비 %) · 휴차 개월. */
  turnoverPrepFee: number; turnoverDeliveryFee: number; turnoverFeePct: number; turnoverVacancyMonths: number;
  /**
   * **위약금 상쇄** — 손바뀜 한 번에 «실제로 받아 내는» 돈. 두 칸이 곱해진다.
   *
   * ★사장님 2026-09-06 「평균 보증금을 입력을 하면 대신 손바뀜이 있을 때 비용은 나가지만
   *   그만큼이 상쇄가 되겠지. 근데 **사실상 위약금이 발생돼도 저신용은 거의 못 받거든.**
   *   그런 것들이 좀 **현실적으로 반영이 돼야** 돼.」
   *
   *   ⇒ 정액 한 칸(「중도해지 위약금 얼마」)으로는 그 현실이 안 잡힌다.
   *     받아 낼 «자리»(보증금)와 실제로 «받아 내는 정도»(회수율)는 서로 다른 값이고,
   *     회수율만 신용 구간에 따라 갈린다.
   *
   *   회당 상쇄액 = 월납 × `depositMonths` × `penaltyRecovery{A|B|C}Pct`
   *
   *   depositMonths       보증금이 **월납 몇 달 치**인가(사장님 2026-09-06 「보통 요즘에 저신용
   *                       보증금은 한 두 달 치를 받거든?」). 정액(원)이 아니라 배수다 —
   *                       정액으로 두면 비싼 차에서 보증금이 실제보다 작아진다.
   *   penaltyRecovery*Pct 그중 실제로 위약금으로 «떼는» 비율. A 정상은 대체로 떼지만
   *                       C 저신용은 미납 대여료·수리비로 이미 소진되어 거의 못 뗀다.
   *
   * ⚠⚠ **위약금으로는 손바뀜이 안 막힌다.** 저신용 4년 아반떼 실측(2026-09-06):
   *    회당 나가는 돈 253만(상품화 50 + 왕복탁송 50 + 수수료 재지급 90 + 휴차 63)인데
   *    두 달 치 보증금은 125만이다. **다 떼도 50%**, 회수율 10%면 **5%**다.
   *    ⇒ 나머지는 대여료가 진다. 보증금을 더 받거나(저신용은 낼 돈이 없다),
   *      회당 비용을 줄이는(휴차·탁송·수수료) 쪽이 실제 손잡이다.
   */
  depositMonths: number;
  penaltyRecoveryAPct: number; penaltyRecoveryBPct: number; penaltyRecoveryCPct: number;
  /** 잔가 가감(±%p) — 「잔가로 조정」하는 손잡이. 곡선 전체를 통째로 올리거나 내린다. */
  residualAdjustPct: number;
  /**
   * **끝날 때 드는 돈** — 반납형만. 인수형은 고객이 가져가니 회수도 매각도 없다.
   *   회수 탁송  계약 끝나고 차를 가져오는 값(정액)
   *   매각 비용  경매 수수료·매각 대행 — 잔존가 대비 %(값에 비례한다)
   */
  returnDeliveryFee: number; disposalFeePct: number;
};

/**
 * **아직 안 정한 실비** — 값이 0 이라 원가에 안 잡히는 칸들.
 * ★사장님 2026-09-06 「공통으로 들어가는 부분 중 **얼마인지 모르는 부분들을 쭉 만들어 놓고**
 *   표준 비용을 넣어서 표준 견적을 제시해 주는 거야」.
 *   ⇒ 칸을 세워 두는 것으로 끝내지 않는다. **비어 있다는 사실을 화면이 말한다** —
 *     안 그러면 「0 이라서 싼 견적」을 표준인 줄 알고 내보낸다.
 * ⚠ 0 이 «맞는» 칸(판관비·대손 — 사장님 「내부 관리비 없이 순수 직관적인 원가」)은 세지 않는다.
 */
export const UNSET_FEES: { key: keyof CostSettings; label: string }[] = [
  { key: 'deliveryFee', label: '1차 탁송료' },
  { key: 'initPrepFee', label: '초기 상품화비' },
  { key: 'inspectionFee', label: '정기검사비' },
  { key: 'returnDeliveryFee', label: '회수 탁송료' },
  { key: 'disposalFeePct', label: '매각 비용' },
];
export const unsetFees = (cs: CostSettings) => UNSET_FEES.filter((f) => !Number(cs[f.key]));

const pct = (v: number) => Math.round((v || 0) * 1000) / 10;   // 0.065 → 6.5

/**
 * 기본값 = 엔진 `DEFAULT_CONFIG` + **손오공 운영값**.
 *
 * ★★2026-09-06 실측 — 손오공 견적기의 «실제 운영 설정»(RTDB `teamjpk-b70b7 /sonogong/config`)이
 *   코드 기본값과 셋 달랐다. 관리자가 화면에서 고친 값이고, 그게 **사장님이 「원래 책정해 놓은 것」**이다.
 *   ```
 *   대출 비율      80% → 90%
 *   주차장·관리   35,000 → 0     (3자 마켓이라 차를 우리가 세워 두지 않는다)
 *   영업수당율      5% → 3%
 *   ```
 *   ⇒ 여기서 덮는다. `default-config.js`(무손실 이관본)는 **안 고친다** — 그건 엑셀 회귀의 기준이다.
 *   ⚠ 이 셋을 안 맞추면 아반떼 2,500만 4년이 89만으로 나온다(운영값은 74만). 사장님이 「말이 되냐」 하신 값이다.
 */
export const COST_DEFAULTS: CostSettings = {
  bondPct: pct(D.setting.bondRate), regFee: D.setting.regFee,
  deliveryFee: 0, initPrepFee: 0,
  // A(정상) · B(중신용) · C(저신용) — 지금은 셋 다 같은 값이다. 회사가 구간을 벌리면 여기서 벌어진다.
  interestAPct: pct(D.interestRate.rent), interestBPct: pct(D.interestRate.rent), interestCPct: pct(D.interestRate.rent),
  loanAPct: 90, loanBPct: 90, loanCPct: 90,   // ← 손오공 운영값(코드 기본 80)
  maintMonthly: D.setting.maintMonthly, maintRatePct: 0, gpsMonthly: D.setting.gpsMonthly,
  parkingMonthly: 0,                 // ← 손오공 운영값(코드 기본 35,000)
  inspectionFee: 0,
  overheadPct: 0, badDebtPct: 0,
  salesFeePct: 3,                    // ← 손오공 운영값(코드 기본 5%)
  acqTaxRentPct: pct(D.acqTaxRate.rent), acqTaxSubPct: pct(D.acqTaxRate.sub),
  insRentYear: D.setting.insYear, insSubYear: 0,
  selfRentPct: pct(D.setting.selfRate), selfSubPct: 0,
  selfInsRentYear: 0, selfInsSubYear: 0,
  marginRentPct: pct(D.marginRate.rent), marginSubPct: pct(D.marginRate.sub),
  markupUsedPct: 0, markupNewPct: 0,   // ← 2026-09-06 업금액을 걷었다(아래 `configFrom` 머리말)
  ewYear: 80000,
  retentionNormalPct: 97, retentionMidPct: 75, retentionLowPct: 30,
  // ★휴차 «한 달»은 확정값이다 — 사장님 2026-09-06 「평균 한 달은 잡아야 될 거야.
  //   그래야 보수적으로 책정해서 할 수 (있다)」. 회당 비용의 4분의 1을 차지해,
  //   여기를 줄이면 원가가 눈에 띄게 싸 보인다. **줄이려면 먼저 여쭌다.**
  turnoverPrepFee: 500000, turnoverDeliveryFee: 500000, turnoverFeePct: 3, turnoverVacancyMonths: 1,
  // 보증금 두 달 치 = 저신용 실무(사장님 2026-09-06). 회수율은 「저신용은 거의 못 받거든」을 숫자로 옮긴 것.
  depositMonths: 2,
  penaltyRecoveryAPct: 80, penaltyRecoveryBPct: 50, penaltyRecoveryCPct: 10,
  residualAdjustPct: 0,
  returnDeliveryFee: 0, disposalFeePct: 0,
};

/**
 * **취득 경로** — 같은 차라도 어떻게 들여왔느냐에 따라 초기비가 다르다.
 * ★사장님 2026-09-06 「중고랜트·중고구독은 **기 보유한 걸 하는 건지 중고를 구매해 오는 건지**에 따라
 *   견적이 달라지겠지. **상품화 여부** 이런 거. 새로 사오는, 상품화가 된 걸 사오는 건지
 *   상품화 안 된 걸 사 오는 건지」.
 */
export type AcqPath =
  | 'own'      // 기보유 — **취득세·공채·등록비·탁송·상품화가 이미 났다.** 새 계약에 또 물리지 않는다.
  | 'bought'   // 매입 · 상품화 완료된 차 — 취득세·공채·등록·탁송.
  | 'prep';    // 매입 · 상품화 필요 — 위 전부 + 상품화비.

/**
 * 원가 설정 → 엔진이 받는 `adminCfg`. **환산은 여기 한 곳**에서만 한다.
 * @param opts.newCar 신차인가 — 업금액·초기비를 신차 규칙으로 쓴다(등록·탁송 O, 상품화 X).
 * @param opts.path   중고 취득 경로 — 초기비가 켜지고 꺼진다.
 *
 * ★★**「차량가 업금액」을 걷었다**(기본 0 · 2026-09-06). 사장님 「손오공 견적은 신경 쓰지 말고
 *   **우리가 이제 우리 표준견적을 새로 만드는 거야**」 · 「중고 렌트 2,700만이 **왜 이렇게 비싸냐**」.
 *   ⚠ 업금액은 **취득에만 붙고 잔존에는 안 붙어** 그 금액이 통째로 «감가»로 위장됐다.
 *     2,700만 × 20% = 540만이 4년에 걸쳐 손님에게 청구되고 있었다(월납 683,000 → 528,000).
 *   ⇒ **마진은 이익률에서, 상품화·탁송은 실비에서** 잡는다. 손잡이가 겹치지 않게 한다.
 *     그래도 정률로 얹고 싶은 회사는 원가 화면에서 값을 넣으면 예전처럼 굴러간다.
 */
/** 신용등급 → 원가 구간. A=정상 · B=중신용 · C=저신용(무신용도 C). */
export function bandOf(credit: string | null | undefined): 'A' | 'B' | 'C' {
  const c = String(credit ?? '');
  if (c === '저신용' || c === '무신용') return 'C';
  if (c === '중신용') return 'B';
  return 'A';
}

export function configFrom(cs: CostSettings, opts: { newCar?: boolean; path?: AcqPath; credit?: string } = {}) {
  const r = (v: number) => (v || 0) / 100;
  // 금융은 신용 구간(A/B/C)에서 고른다 — 항목은 같고 값만 다르다.
  const band = bandOf(opts.credit);
  const interestPct = band === 'C' ? cs.interestCPct : band === 'B' ? cs.interestBPct : cs.interestAPct;
  const loanPct = band === 'C' ? cs.loanCPct : band === 'B' ? cs.loanBPct : cs.loanAPct;
  const recoveryPct = band === 'C' ? cs.penaltyRecoveryCPct : band === 'B' ? cs.penaltyRecoveryBPct : cs.penaltyRecoveryAPct;
  const markupRate = r(opts.newCar ? cs.markupNewPct : cs.markupUsedPct);
  // 신차는 언제나 «사 오는 차»다(등록·탁송 O · 상품화 X).
  const path: AcqPath = opts.newCar ? 'bought' : (opts.path ?? 'prep');
  const brought = path !== 'own';           // 새로 들여온 차인가
  const needsPrep = path === 'prep';        // 상품화를 우리가 하나
  return {
    ...DEFAULT_CONFIG,
    /**
     * **운영은 VAT 제외 기준**(사장님 2026-09-06 「모든 거는 다 VAT 제외 기준으로 들어가는 거지.
     * 렌터카도 일단 부가세 환급을 받은 다음에 개별소비세 납부를 하는 거니까」).
     * ⚠ 엔진 기본값은 'included'(엑셀 원본)다 — 그래야 회귀 39개가 «엑셀 대조»로 계속 살아 있는다.
     *   운영 규칙이 엑셀에서 이탈한 것이고, 그 이탈을 이 한 줄이 드러낸다.
     */
    vatBase: 'excluded' as const,
    interestRate: { rent: r(interestPct), sub: r(interestPct) },
    marginRate: { rent: r(cs.marginRentPct), sub: r(cs.marginSubPct) },
    loanRatio: r(loanPct),
    markup: { rent: { rate: markupRate }, sub: { rate: markupRate } },
    // 보험·자차 — 채널별. 0 도 «정한 값»이라 엔진이 존중한다(구독 0 = 고객 명의).
    insYear: { rent: cs.insRentYear, sub: cs.insSubYear },
    selfRate: { rent: r(cs.selfRentPct), sub: r(cs.selfSubPct) },
    selfInsuredYear: { rent: cs.selfInsRentYear, sub: cs.selfInsSubYear },
    ewPerYear: { rent: cs.ewYear, sub: 0 },
    /**
     * 취득세·공채 — **새로 들여온 차만** 낸다.
     * ★사장님 2026-09-06 「**기보유한 차들은 아무렴 취득세만큼이 싸니까** 조금 싸질 거고,
     *   **탁송비나 이런 것들은 안 들어갈 거 아냐**」.
     *   이미 우리 이름으로 등록된 차다 — 새 계약을 맺는다고 취득세를 또 내지 않는다.
     */
    acqTaxRate: brought
      ? { ...D.acqTaxRate, rent: r(cs.acqTaxRentPct), sub: r(cs.acqTaxSubPct) }
      : { rent: 0, sub: 0 },
    // 판관비·대손 — 직접원가에 비율로 얹는다(엔진 `calc.js`. 기본 0이면 없던 것과 같다).
    overheadRate: r(cs.overheadPct),
    badDebtRate: r(cs.badDebtPct),
    /**
     * 손바뀜 — 신용등급별 «반납률(계약 유지율)»과 회당 비용.
     * ⚠ 키는 엔진(`turnover-cost.js` RETENTION)이 아는 이름이어야 한다. 「고신용」과 「정상」은 같은 칸이다.
     */
    turnover: {
      retention: {
        고신용: r(cs.retentionNormalPct), 정상: r(cs.retentionNormalPct),
        중신용: r(cs.retentionMidPct),
        저신용: r(cs.retentionLowPct), 무신용: r(cs.retentionLowPct),
      },
      productization: cs.turnoverPrepFee,
      deliveryRoundTrip: cs.turnoverDeliveryFee,
      feeRateOfRent: r(cs.turnoverFeePct),
      vacancyMonths: cs.turnoverVacancyMonths,
      // 회당 «받아 내는» 돈 = 월납 × 보증금 개월 × 그 신용 구간의 회수율(월납은 엔진이 안다).
      depositMonths: cs.depositMonths,
      penaltyRecoveryRate: r(recoveryPct),
    },
    setting: {
      ...D.setting,
      // 등록·탁송은 «새로 들여온 차»만. 기보유는 이미 났다 — 새 계약에 또 물리지 않는다.
      bondRate: brought ? r(cs.bondPct) : 0, regFee: brought ? cs.regFee : 0,
      ewYear: cs.ewYear,
      maintMonthly: cs.maintMonthly, maintRate: r(cs.maintRatePct),
      gpsMonthly: cs.gpsMonthly, parkingMonthly: cs.parkingMonthly,
      deliveryFee: brought ? cs.deliveryFee : 0,
      initPrepFee: needsPrep ? cs.initPrepFee : 0,
      inspectionFee: cs.inspectionFee,
      returnDeliveryFee: cs.returnDeliveryFee, disposalFeeRate: r(cs.disposalFeePct),
      salesFeeRate: { rent: r(cs.salesFeePct), sub: r(cs.salesFeePct) },
    },
  };
}

/**
 * 잔가 곡선에 «가감(±%p)»을 얹는다 — 「잔가로 조정」하는 손잡이(사장님 2026-09-06).
 * ★잔가를 올리면 감가가 줄어 대여료가 내려간다. 이익률을 안 건드리고 값을 맞추는 길이다.
 * ⚠ 5~98% 로 가둔다. 100% 를 넘기면 「타고 나면 더 비싸지는 차」가 되고, 0 이면 감가가 차값 전부가 된다.
 */
export function adjustResidual(rates: Record<number, number>, pct: number): Record<number, number> {
  const d = (pct || 0) / 100;
  if (!d) return rates;
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(rates)) out[Number(k)] = Math.max(0.05, Math.min(0.98, v + d));
  return out;
}
