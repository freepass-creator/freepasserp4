/**
 * # 정산 엔진 — «한 덩어리로 떼어낼 수 있는» 계산 심장
 *
 * ★★★사장님 2026-09-09 「**정산 엔진 명확하게 만들어놔. 이거 별도로 구현되어야 하니까**」
 *
 * 정산 계산이 지금은 `lib/domain/settlement-*.ts` **스물두 파일**에 흩어져 있다.
 * 흩어져 있어도 «계산»은 한 가지인데, 문이 없으니 부르는 쪽마다 다른 파일을 찔러 보고,
 * 그러다 한 곳만 고치면 다른 곳이 옛 셈으로 남는다 — 세션마다 숫자가 달라지던 그 꼴이다.
 *
 * ⇒ **이 파일이 정산 엔진의 «유일한 문»이다.** 정산 계산이 필요하면 여기서 꺼낸다.
 *
 * ```ts
 * import { claimOf, payOf, stageOfAtom, billingMonth } from '@/lib/domain/settlement/engine';
 * ```
 *
 * ---
 *
 * ## 엔진은 «무엇»인가 — 순수한 셈
 *
 * ```
 *          들어오는 것                    엔진                     나오는 것
 *   ┌──────────────────────┐   ┌────────────────────┐   ┌──────────────────────┐
 *   │ 정산 원자 한 줄       │   │ ① 규격  원자 모양   │   │ 청구액 · 지급액       │
 *   │ (settlement_rows)     │──▶│ ② 돈    청구·지급   │──▶│ 청구월 · 잠긴 달      │
 *   │ 요율표 · 오늘 날짜    │   │ ③ 요율  사다리·신차 │   │ 두 축 생애주기        │
 *   └──────────────────────┘   │ ④ 달    청구월      │   │ 청구서 줄 · 경보      │
 *                              │ ⑤ 생애  접수→수금   │   └──────────────────────┘
 *                              │ ⑥ 주기  청구·지급일 │
 *                              └────────────────────┘
 * ```
 *
 * **엔진은 아무것도 읽지 않고 아무것도 쓰지 않는다.** 주는 것을 받아 셈해서 돌려줄 뿐이다.
 * 그래서 시트가 있든 없든, 파이어스토어든 다른 저장소든, 화면이 리액트든 아니든 **그대로 돈다.**
 * 「별도로 구현」이 가능한 것은 이 한 가지 성질 덕이다 — 딸린 것이 없어야 떼어낼 수 있다.
 *
 * ## 엔진이 «아닌» 것 — 여기 들어오면 못 떼어낸다
 *
 * | 하는 일 | 어디 것인가 | 왜 엔진이 아닌가 |
 * |---|---|---|
 * | 구글시트 발행·읽기 | `lib/server/*-sheet-tabs.ts` · `scripts/publish-*.mts` | 바깥 세상과 말한다 |
 * | 파이어스토어·RTDB 읽고 쓰기 | `lib/store` · `scripts/atomize-*.mts` | 저장은 셈이 아니다 |
 * | 화면·색·뱃지 | `components/*` · `settlement-display.ts` | 보이는 것은 채(棟)마다 다르다 |
 * | 로그인·소속·권한 | `lib/session` · `lib/tenant` | 누가 보느냐는 셈을 바꾸지 않는다 |
 * | 계약↔차량 상태 동기화 | `lib/domain/settlement-engine.ts` | **이름만 같고 다른 물건이다**(아래) |
 *
 * ⚠⚠ **`lib/domain/settlement-engine.ts` 와 헷갈리지 마라.** 그것은 계약 단계를 체크하면
 *   차량 상태를 잠그는 «계약 진행» 엔진이라 `store` 를 문다. 이 파일(정산 엔진)은 순수하다.
 *   둘을 한 덩어리로 보면 정산을 떼어낼 때 계약·차량·저장소가 통째로 딸려 온다.
 *
 * ## 지키는 법 — 기계가 잡는다
 *
 * `npm run check:engine` — 엔진 심장(아래 `ENGINE_CORE`)이 저장소·세션·시트·화면을 **물기만 해도** exit 1.
 * 규격을 바꾸려면 사장님께 여쭙고 → 이 문서를 고치고 → 검사를 고친다. 검사부터 고치면 경계를 지운 것이다.
 *
 * ## 세 채(棟) 어디에 서는가
 *
 * `lib/domain/wings.ts` 의 **거래 채**(전자계약·정산·회원사/파트너사) 것이다.
 * 상품찾기·견적 채는 이 엔진을 **안 부른다** — 부르기 시작하면 경계가 무너진다.
 */

/* ══════════════════════════════════════════════════════════════════════
   ① 규격 — 원자가 어떤 모양인가 (56밭 · 9묶음)
   ══════════════════════════════════════════════════════════════════════ */
export type { AtomGroup, AtomField } from '../settlement-atom';
export {
  SETTLEMENT_FIELDS, ATOM_KEYS, ATOM_NOT_KEPT,
  atomField, atomGroups, shapeAtom,
} from '../settlement-atom';
export type { SettlementRow, SettlementChecks } from '../settlement-stage';

/* ══════════════════════════════════════════════════════════════════════
   ② 돈 — 청구(공급사에게 받는다) · 지급(영업채널에 준다)
   ★두 축은 «절대» 섞지 않는다. 청구액은 채널 시트에, 지급액은 공급사 시트에 못 간다.
   ══════════════════════════════════════════════════════════════════════ */
export type { MoneyRow, InvoiceRow } from '../settlement-money';
export { claimOf, payOf, claimBaseOf, payBaseOf, incentiveOf } from '../settlement-money';
/** ★부가세 가르기 — 줄마다 가르고 «그 다음에» 더한다. 총액에 곱하면 1원씩 어긋난다. */
export { invoiceMoneyOf, clawMoneyOf } from '../settlement-money';
export type { Money, FeeBase, SettleTarget } from '../settlement-stage';
export { moneyOf, feeOf, feeBaseOf, VAT, SETTLE_TARGETS, settleTargetOf } from '../settlement-stage';

/* ══════════════════════════════════════════════════════════════════════
   ③ 요율 — 사다리(12/24/36/48/60) · 신차(선출고·선발주·발주·매칭출고)
   ⚠ 「발주」와 「매칭출고」는 요율이 «없다» — 영업자가 넣은 금액이 정본이다(auto:false).
   ══════════════════════════════════════════════════════════════════════ */
export type { FeeBasis, FeeRule } from '../settlement-fee-table';
export { FEE_RULES, FEE_TIMING, SUPPLIER_ALIAS, EV_MODEL, feeKindOf, feeRuleFor } from '../settlement-fee-table';

/* ══════════════════════════════════════════════════════════════════════
   ④ 달 — 어느 달 정산인가
   ★적힌 청구월이 이긴다 · 확정된 달은 못 옮긴다 · 분납은 접수일 기준(settlement-bill-month-rule)
   ══════════════════════════════════════════════════════════════════════ */
export {
  billingMonth, billingMonthIn, lockedMonthsOf, ym, midnight,
  roundsOf, paidRoundsOf, paidRatioOf, lastPaymentDate, instalmentDueDate, nextInstalment,
} from '../settlement-stage';
export { settlementMonthOf, ymOf, dateOf } from '../settlement-billing-month';

/* ══════════════════════════════════════════════════════════════════════
   ⑤ 생애주기 — 접수 → 청구 → 확인 → 수금 / 접수 → 통보 → 확인 → 지급
   ★사장님 2026-09-08 「청구까지 완료, 돈 받은 거까지 정산 생애주기를 관리하면 되지」
   ⚠ 「정정·보류·취소」는 길 위의 칸이 아니라 «멈춘 자리»다 — 길과 나란히 두지 않는다.
   ══════════════════════════════════════════════════════════════════════ */
export { CLAIM_STAGES, PAY_STAGES, OFF_STAGES } from '../settlement-atom';
/** 두 축(청구·지급)의 자리를 받아 한 줄의 «지금»을 낸다 — 원자용. */
export { stageOf as stageOfAtom } from '../settlement-atom';
/** 원장 한 줄에서 단계를 «셈해» 낸다 — 시트/원장용(날짜·회차를 본다). */
export { stageOf as stageOfRow, bucketOf, BUCKETS, toneOf } from '../settlement-stage';
export type { Stage, Bucket, RowTone } from '../settlement-stage';
export type { BillState } from '../settlement-billstate';
export { BILL_STATES, BILL_WHY, billStateOf, countByBillState, issuedKey } from '../settlement-billstate';
export type { Step, TimelineInput } from '../settlement-timeline';
export { timelineOf, reachedOf, nextTodoOf } from '../settlement-timeline';
export type { ConfirmState, Confirmation } from '../settlement-confirm';
export { confirmKey, canBill, providerBillGate } from '../settlement-confirm';

/* ══════════════════════════════════════════════════════════════════════
   ⑥ 주기 — 언제 청구하고 언제 주는가 (공급사마다 지급일이 다르다)
   ══════════════════════════════════════════════════════════════════════ */
export { BILL_DAY, DUE_DAY, PAY_DAY, billDate, dueDate, payDate, payDayOf, cyclePhase } from '../settlement-cycle';

/* ══════════════════════════════════════════════════════════════════════
   ⑦ 종이 — 청구서 한 장 · 청구서 줄
   ★방향: 공급사에게는 «우리가» 계산서를 끊고, 영업채널은 «우리에게» 끊는다.
   ══════════════════════════════════════════════════════════════════════ */
export type { Invoice, InvoiceLine, InvoiceParty } from '../settlement-invoice';
export { buildInvoice, EMPTY_PARTY, baseOf, feeShow, maskName } from '../settlement-invoice';
export type { BillingLine } from '../settlement-stage';
export { billingLines } from '../settlement-stage';

/* ══════════════════════════════════════════════════════════════════════
   ⑧ 경보 — 묵은 것 · 곧 닥칠 것
   ══════════════════════════════════════════════════════════════════════ */
export type { Alert, AlertLevel, AlertContext } from '../settlement-alert';
export { alertsOf, levelOf, countAlerts, STALE_DAYS, SOON_DAYS } from '../settlement-alert';

/**
 * ★★**엔진의 심장 — 이 파일들은 «순수»해야 한다.**
 *   `npm run check:engine` 이 이 명단만 검사한다. 여기 한 줄 더하면 그 파일도 순수해야 한다.
 *   (문 자신인 `settlement/engine.ts` 도 포함 — 문이 더러우면 안이 깨끗해도 소용없다)
 */
export const ENGINE_CORE = [
  'lib/domain/settlement/engine.ts',
  'lib/domain/settlement-atom.ts',
  'lib/domain/settlement-money.ts',
  'lib/domain/settlement-fee-table.ts',
  'lib/domain/settlement-stage.ts',
  'lib/domain/settlement-billing-month.ts',
  'lib/domain/settlement-cycle.ts',
  'lib/domain/settlement-billstate.ts',
  'lib/domain/settlement-timeline.ts',
  'lib/domain/settlement-confirm.ts',
  'lib/domain/settlement-invoice.ts',
  'lib/domain/settlement-alert.ts',
  'lib/domain/settlement-view.ts',
  /**
   * ★거래처 «정체»표 — 상호·사업자등록번호·대표자. 계산서는 법인에 끊으므로 엔진이 안다.
   *   사장님 2026-09-09 「탭은 법인별로 해야 함」 — 묶는 열쇠가 사업자번호라 이 표가 심장에 있다.
   */
  'lib/domain/partner-ci.ts',
] as const;

/**
 * ★엔진이 «물면 안 되는» 것 — 하나라도 물면 떼어낼 수 없다.
 *   저장(store·firebase) · 누구(session·tenant) · 바깥(googleapis·lib/server) · 얼굴(react·next).
 */
export const ENGINE_FORBIDDEN = [
  '@/lib/store', '@/lib/session', '@/lib/tenant', '@/lib/firebase',
  '@/lib/server', 'firebase-admin', 'googleapis', 'google-auth-library',
  'react', 'next/', 'node:fs', 'node:path',
] as const;
