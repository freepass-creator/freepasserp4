/**
 * **정산 — 한 계약이 어디까지 왔나 · 얼마를 청구하나. 한 곳에서 정한다.**
 *
 * ★사장님 2026-08-25 「정산시트는 완성됐고 이거를 ERP에 어떻게 녹일까 · 관리자용으로 만들려고해 ·
 *   구글시트 취지를 반영해서 구현해줘봐」.
 *
 * ★**시트를 옮기는 게 아니라 시트가 «증명한 것»을 옮긴다.** 구글시트에서 428줄로 굴려 보며
 *   확인된 규칙만 여기 담는다. 서식·색·잠금은 시트라서 필요했던 장치이고 ERP 에서는 화면이 대신한다.
 *
 * ★**왜 여기 한 곳인가.** 지금 같은 산식이 세 군데에 흩어져 있다 —
 *   `compute-missing-fees` · `build-settlement-billing` · `settlement-engine`.
 *   갈리면 «시트에서 본 금액»과 «ERP 에서 본 금액»이 달라지고, 그때부터 아무도 못 믿는다.
 *   시트 도구도 ERP 화면도 이 파일만 부른다.
 *
 * ★검증: `npx tsx scripts/verify-settlement-stage.mts` 가 이 함수로 원장 428줄을 다시 갈라
 *   시트와 같은 수가 나오는지 본다. 규칙을 고치면 그 검증부터 돌린다.
 */

/** 체크 넷 — 상태를 «글자»가 아니라 «체크»가 말한다(시트에서 상태 글자를 다 걷어낸 이유다). */
export type SettlementChecks = {
  /** 계약서·서류가 다 됐나. 인도되면 당연히 참이다(거꾸로는 아니다). */
  paper: boolean;
  /** 차가 나갔나. **청구의 관문**이다 — 이 날이 청구월을 정한다. */
  delivered: boolean;
  /** 계약금이 들어왔다가 취소됐나. */
  cancelled: boolean;
  /** 계약이 끝난 뒤 돈을 되돌리나. 분납이 부러진 것도 여기다. */
  clawback: boolean;
};

export type SettlementRow = SettlementChecks & {
  plate: string;
  supplier: string;
  agent: string;
  /** 상품구분 — **수수료 기준을 정하는 축**이다. 선출고·견적출고면 차량가액 기준. */
  product: string;
  /** 개월 수. 요율이 여기서 나온다. */
  term: number;
  rent: number;
  /** 차량가액 — 선출고·견적출고의 기준값. */
  price: number;
  /** 「일시납」·「2회분납」·「3회분납」. 회차 수가 곧 개월 수다. */
  payKind: string;
  /**
   * **받은 회차.** 비어 있으면 기간 비례로 «계산»한다 —
   * 부러졌을 때만 사람이 그 회차를 박아 멈춰 세운다(사장님 2026-08-26).
   * ★1회차는 인도 때 보증금과 같이 내므로, 인도됐으면 최소 1이다.
   */
  paidRounds?: number;
  /** 보증금 — **계약 조건**이지 정산 금액이 아니다. 영업자·공급사에게도 보인다(사장님 2026-08-26). */
  deposit?: number;
  /** 모델명 — 차량번호만으로는 사람이 못 알아본다. */
  model?: string;
  /**
   * 영업자연락처 — **계정이 없어도 사람을 가리키는 열쇠.**
   * ★관리자가 이름·연락처로 적어 두면 정산이 돈다. 나중에 그 사람이 가입하면 번호로 붙는다.
   * ⚠ PII. 역할용 응답(`PublicRow`)에는 담지 않는다.
   */
  agentPhone?: string;
  /**
   * 영업자코드 — `usr_` 대체키. **동명이인을 가르는 열쇠**다.
   * ★이름은 겹치지만 코드는 안 겹친다. 코드가 있으면 이름보다 코드가 이긴다.
   */
  agentCode?: string;
  /**
   * 영업채널 — 지급이 나가는 «회사». 영업담당자(사람)와 다른 축이다.
   * ★동명이인을 가르는 데도 쓴다 — 원장에 이름만 있어 「이승호」가 둘이면 소속으로 갈린다(실측 2026-08-26).
   */
  channel?: string;
  /** 고객명. ⚠ 고객연락처는 여기 담지 않는다 — PII 는 관리자 화면에서만 흐른다. */
  customer?: string;
  receivedAt: Date | null;
  deliveredAt: Date | null;
  clawbackAt: Date | null;
  clawbackAmount: number;
  /** 원장에 적혀 있는 값이 있으면 그것이 이긴다(계산서를 실제로 끊은 금액). */
  claimWritten?: number;
  payWritten?: number;
  supplierRate?: number;
  agentRate?: number;
};

/** 계약이 앉는 자리. **한 줄은 한 곳에만** 있다 — 겹치면 대수가 두 번 세어진다. */
export type Stage = '접수' | '취소' | '분납실적' | '완납실적';

const p2 = (n: number) => String(n).padStart(2, '0');
export const ym = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
/**
 * ★**«오늘»은 자정이다.** `new Date()` 에는 시각이 붙어 있어서, 만료가 «오늘»인 건이
 *   「이미 지났다」로 판정된다 — 실측 2026-08-25 에 분납 4건이 그렇게 완납실적으로 새어 나갔다.
 *   날짜끼리 견줄 때는 시각을 떨어내고 본다.
 */
export const midnight = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** 분납 회차 수. 일시납·빈칸은 1이다. */
export const roundsOf = (payKind: string) => {
  const m = /(\d)\s*회/.exec(String(payKind || ''));
  const n = m ? Number(m[1]) : 1;
  return n >= 2 ? n : 1;
};

/**
 * ★**1회차는 인도 때 낸다**(사장님 2026-08-25). 그래서 —
 *   · k회차 예정일 = 인도일 + (k−1)개월
 *   · 마지막 납입 = 인도일 + (회차−1)개월
 *   · **완료 판정 = 인도일 + 회차개월** (마지막 납입 뒤 한 달 여유)
 */
export const lastPaymentDate = (r: SettlementRow) => {
  const n = roundsOf(r.payKind);
  return n >= 2 && r.deliveredAt ? addMonths(r.deliveredAt, n - 1) : null;
};
export const instalmentDueDate = (r: SettlementRow) => {
  const n = roundsOf(r.payKind);
  return n >= 2 && r.deliveredAt ? addMonths(r.deliveredAt, n) : null;
};
/**
 * **몇 회차까지 받았나.**
 *
 * ★사장님 2026-08-26
 *   「이건 그냥 기간 비례해서 그 기간 지나갓으면 낸거고 아니면 거기서 부러지겠지」
 *   「2회 분납은 2회차만 챙기면 되는거지 1회차는 납부하면서 완료한거고 /
 *    인도하면서 보증금 1회차는 무조건 낼테니까」
 *
 * 그래서 두 가지다 —
 *   · **적혀 있으면 그 값이 이긴다** — 부러졌을 때 사람이 그 회차에서 멈춰 세운다
 *   · 안 적혀 있으면 **기간 비례** — k회차 예정일이 지났으면 받은 것으로 본다
 * ★1회차는 인도 때 보증금과 같이 내므로 **인도됐으면 무조건 1회차는 받은 것**이다.
 */
export const paidRoundsOf = (r: SettlementRow, now = new Date()): number => {
  const n = roundsOf(r.payKind);
  if (!r.deliveredAt) return 0;
  const written = Number(r.paidRounds);
  if (Number.isFinite(written) && written >= 1) return Math.min(n, Math.round(written));
  const today = midnight(now);
  let paid = 1; // 인도 = 1회차
  for (let k = 2; k <= n; k++) if (addMonths(r.deliveredAt, k - 1) <= today) paid = k;
  return paid;
};

/**
 * **부러졌나** — 받아야 할 날이 지났는데 아직 못 받은 것.
 * ★적힌 회차가 있어야 «부러졌다»고 말할 수 있다. 안 적혀 있으면 기간 비례라 늘 «받은 것»이 되고,
 *   그건 사실이 아니라 «아직 아니라고 말한 사람이 없다»는 뜻이다.
 */
export const brokenOf = (r: SettlementRow, now = new Date()): boolean => {
  const n = roundsOf(r.payKind);
  if (n < 2 || !r.deliveredAt) return false;
  const paid = paidRoundsOf(r, now);
  if (paid >= n) return false;
  const due = addMonths(r.deliveredAt, paid); // 다음 회차 예정일
  return due < midnight(now);
};

/** 다음에 돈이 들어올 날. 다 지났으면 없다. 1회차는 인도 때 냈으니 2회차부터 본다. */
export const nextInstalment = (r: SettlementRow, now = new Date()) => {
  const today = midnight(now);
  const n = roundsOf(r.payKind);
  if (n < 2 || !r.deliveredAt) return null;
  for (let k = 2; k <= n; k++) {
    const at = addMonths(r.deliveredAt, k - 1);
    if (at >= today) return at;
  }
  return null;
};

/**
 * ★**선지급이 없는 공급사.** 분납건은 분납이 다 들어와야 청구·지급한다.
 *   부러지면 수수료 지급이 아예 없다(사장님 2026-08-25 「스타랑 아이카는 분납부러지면 수수료지급 없음」).
 */
export const CLAIM_ON_COMPLETE = [/스타/, /아이카/];
export const claimsOnComplete = (r: SettlementRow) =>
  roundsOf(r.payKind) >= 2 && CLAIM_ON_COMPLETE.some((re) => re.test(r.supplier || ''));

/**
 * **청구월** — 인도가 관문이다.
 * ★스타·아이카 분납건만 «마지막 납입월»이고, 그 밖은 «인도월»이다(선납).
 * ★인도 전이면 청구가 없다 — `null` 이다. 「없다」가 아니라 「아직」이다.
 */
export const billingMonth = (r: SettlementRow): string | null => {
  if (!r.deliveredAt) return null;
  const at = claimsOnComplete(r) ? lastPaymentDate(r) : r.deliveredAt;
  return at ? ym(at) : null;
};

/**
 * **이 계약이 앉을 자리.** 위에서부터 걸러 내려간다 — 순서가 곧 규칙이다.
 * ★당월 접수건은 인도돼도 «이달이 마무리될 때까지» 접수에 남는다
 *   (사장님 「완납실적으로 넘기는거는 이달 마무리 되면」). 그게 그 달 실적이다.
 */
export const stageOf = (r: SettlementRow, now = new Date()): Stage => {
  const today = midnight(now);
  if (r.cancelled) return '취소';
  if (!billingMonth(r)) return '접수';
  if (r.receivedAt && ym(r.receivedAt) === ym(today)) return '접수';   // 당월 실적은 아직 여기
  const due = instalmentDueDate(r);
  if (due && due >= today && !r.clawback) return '분납실적';
  return '완납실적';
};

/**
 * **화면에서 보는 칸.** 시트의 「접수」 한 탭을 둘로 가른다
 * (사장님 2026-08-26 「당월접수탭 있고 미완료탭 있어서」).
 * ```
 * 당월접수   이번 달에 받은 계약. 인도됐든 아니든 — 그게 이 달 실적이다
 * 미완료     지난달 이전에 받았는데 아직 차가 안 나간 것. **위에 오래 있을수록 위험하다**
 * 분납실적 · 완납실적 · 취소   시트와 같다
 * ```
 * ⚠ 시트의 `stageOf` 는 그대로 둔다 — 저건 «줄이 어느 탭에 저장되나»이고,
 *   이건 «사람이 어느 칸에서 보나»다. 둘을 섞으면 저장과 표시가 얽힌다.
 */
export type Bucket = '당월접수' | '미완료' | '분납실적' | '완납실적' | '취소';
export const bucketOf = (r: SettlementRow, now = new Date()): Bucket => {
  const stage = stageOf(r, now);
  if (stage !== '접수') return stage as Bucket;
  return r.receivedAt && ym(r.receivedAt) === ym(midnight(now)) ? '당월접수' : '미완료';
};
export const BUCKETS: Bucket[] = ['당월접수', '미완료', '분납실적', '완납실적', '취소'];

// ── 돈 ────────────────────────────────────────────────────────────
export const VAT = 0.1;

/** 수수료 기준 셋. **상품구분이 정한다.** */
export type FeeBase = '고정' | '차량가액' | '대여료×기간';
export const feeBaseOf = (product: string, rate: number): FeeBase =>
  (rate >= 1 ? '고정' : /선출고|견적출고/.test(product || '') ? '차량가액' : '대여료×기간');

/**
 * 수수료 한 건.
 * ★**요율 칸에 1 이상이 들어 있으면 그건 요율이 아니라 «건당 고정액»**이다
 *   (오플구독 100만·80만 · 재렌트 50만). 곱하면 조 단위가 나온다 — 실제로 그렇게 틀린 적이 있다.
 */
export const feeOf = (rate: number, r: Pick<SettlementRow, 'rent' | 'term' | 'price' | 'product'>) => {
  if (!rate) return 0;
  if (rate >= 1) return Math.round(rate);
  if (/선출고|견적출고/.test(r.product || '')) return r.price ? Math.round(r.price * rate) : 0;
  return r.rent && r.term ? Math.round(r.rent * r.term * rate) : 0;
};

export type Money = {
  claim: number; claimVat: number; claimTotal: number;
  pay: number; payVat: number; payTotal: number;
  /** 우리 몫 — 부가세는 통과금이라 뺀다. */
  margin: number;
  /** 환수를 뺀 순액. */
  net: number;
};

/**
 * 한 계약의 돈.
 * ★**적혀 있으면 그 값이 이긴다** — 실제로 계산서를 끊은 금액이다.
 *   없을 때만 요율로 낸다. 이것이 「청구는 안 고친다」를 지키는 방법이다.
 */
export const moneyOf = (r: SettlementRow): Money => {
  const claim = r.claimWritten || feeOf(r.supplierRate || 0, r);
  const pay = r.payWritten || feeOf(r.agentRate || 0, r);
  const claimVat = Math.round(claim * VAT);
  const payVat = Math.round(pay * VAT);
  const claw = r.clawback ? r.clawbackAmount || 0 : 0;
  return {
    claim, claimVat, claimTotal: claim + claimVat,
    pay, payVat, payTotal: pay + payVat,
    margin: claim - pay,
    net: claim - pay - claw,
  };
};

/**
 * **청구 장부에 설 줄들.** 한 계약이 최대 두 줄이 된다 —
 * ★청구(+)는 «청구월»에, 환수(−)는 «환수일이 든 달»에 선다.
 *   ⚠ **기존 줄을 고치지 않는다.** 10월에 환수가 터졌다고 8월 장부를 고치면
 *     이미 계산서를 끊은 달이 바뀐다(사장님 「청구한거는 변함이 없게하고」).
 * ★환수일이 없으면 어느 달에 넣을지 모른다 — 넣지 않고 `unassignedClawback` 로 짚어 준다.
 */
export type BillingLine = { month: string; kind: '청구' | '환수'; amount: number; vat: number; total: number };
export const billingLines = (r: SettlementRow): { lines: BillingLine[]; unassignedClawback: boolean } => {
  const lines: BillingLine[] = [];
  const m = billingMonth(r);
  const money = moneyOf(r);
  if (m && !r.cancelled) lines.push({ month: m, kind: '청구', amount: money.claim, vat: money.claimVat, total: money.claimTotal });
  let unassigned = false;
  if (r.clawback && r.clawbackAmount) {
    if (r.clawbackAt) {
      const v = Math.round(r.clawbackAmount);
      const vat = Math.round(v * VAT);
      lines.push({ month: ym(r.clawbackAt), kind: '환수', amount: -v, vat: -vat, total: -(v + vat) });
    } else unassigned = true;
  }
  return { lines, unassignedClawback: unassigned };
};

/** 화면에서 줄 색을 정한다 — 시트와 같은 규칙. 센 것이 이긴다. */
export type RowTone = 'cancelled' | 'clawback' | 'delivered' | 'plain';
export const toneOf = (r: SettlementRow): RowTone =>
  (r.cancelled ? 'cancelled' : r.clawback ? 'clawback' : r.delivered ? 'delivered' : 'plain');
