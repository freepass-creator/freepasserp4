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
  /**
   * ★★**사람이 «박은» 청구월** — 있으면 계산보다 이긴다.
   *   2026-08 은 태윤 매니저 원장에 맞춰 47줄 43,181,120 으로 박아 둔 달이다.
   *   ⚠ 계산이 그걸 덮으면 이미 나간 청구서와 정산서가 갈린다 —
   *     실측 2026-09-02, 안 보고 계산하니 39건 46,604,613 이 나왔다.
   */
  billMonth?: string;
  /**
   * ★★**정산 조건 넷** — 원장 「계약번호」 칸에 메모로 적혀 있던 것을 원자로 푼 것이다
   *   (실측 2026-09-01, 92줄에 메모가 들어 있었다).
   * ```
   * settleTarget   '모두' | '영업' | '공급'      한쪽만 정산하는 건 (settleTargetOf 로 읽는다)
   * settleRatio    0.5 = 절반만                   「50% 완납 후 50%」
   * billHold       이번 달 청구 아님                 「후불」·보류
   * settleExclude  아예 정산 대상 아님
   * ```
   *   ⚠ 이 넷을 안 보면 종이가 시트와 갈린다 — 실측 2026-09-02, 안 보고 뽑으니
   *     8월이 56,164,240 으로 나왔다(확정 43,181,120 · 차 12,983,120).
   */
  settleTarget?: string;
  settleRatio?: number;
  billHold?: boolean;
  settleExclude?: boolean;
  /** ★적힌 금액이 «부가세 포함»인가. 참이면 그 값이 총액이다 — 부가세를 또 붙이지 않는다. */
  vatIncluded?: boolean;
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
 * ★**분납 부러지면 «지급»이 아예 없는 공급사.**
 *   사장님 2026-08-25 「스타랑 아이카는 분납부러지면 수수료지급 없음」.
 *   ⚠ 이건 «지급» 규칙이다. 「언제 청구하나」는 아래 `claimsOnComplete` 로 옮겼다 —
 *     2026-09-01 부터 «모든» 분납건이 완료시점 청구라서, 이 목록은 더 이상 청구월을 안 정한다.
 */
export const NO_PAY_IF_BROKEN = [/스타/, /아이카/];
export const noPayIfBroken = (r: SettlementRow) =>
  NO_PAY_IF_BROKEN.some((re) => re.test(r.supplier || ''));
/** @deprecated 이름이 「청구월을 정한다」로 읽혀서 옮겼다. `NO_PAY_IF_BROKEN` 을 쓴다. */
export const CLAIM_ON_COMPLETE = NO_PAY_IF_BROKEN;

/**
 * ★★**분납건은 «분납이 끝나야» 청구한다 — 공급사를 가리지 않는다.**
 *
 *   사장님 2026-09-01 「접수 → 분납완료시점이 청구예정일 → 분납완료시점에서 청구」.
 *   ⚠ 2026-08-31 까지는 스타·아이카만 그랬다. 그 둘만 선지급이 없다고 봤기 때문인데,
 *     실제 원본 정산시트는 «모든» 분납건을 완료시점에 정산하고 있었다(실측 2026-09-01).
 *
 * ★★★**시행일이 있다 — 「앞으로는」이다.**
 *   사장님 2026-09-01 「자 **앞으로는** … 분납완료시점에서 청구」 / 「**일단** 시트기준으로 맞출거야」.
 *   ⇒ 이미 지나간 달을 새 규칙으로 다시 계산하면 «태윤이 손으로 맞춰 둔 8월»이 통째로 흔들린다
 *     (실측: 오토플러스 분납 무리 10줄이 9월로 나가고 7월분 12줄이 8월로 들어왔다).
 *   ⇒ **인도일이 시행일 앞이면 옛 규칙(인도월)** 그대로 둔다. 뒤부터 새 규칙이다.
 *   ⚠ 날짜를 «인도일»에 건다. 청구월에 걸면 규칙이 자기 결과를 보고 자기를 정하게 된다.
 */
export const CLAIM_ON_COMPLETE_SINCE = '2026-09';
export const claimsOnComplete = (r: SettlementRow) => {
  if (roundsOf(r.payKind) < 2) return false;
  // 인도 전이면 앞으로 인도될 것이므로 새 규칙을 따른다.
  if (!r.deliveredAt) return true;
  return ym(r.deliveredAt) >= CLAIM_ON_COMPLETE_SINCE || noPayIfBroken(r);
};

/**
 * **청구월** — 인도가 관문이다.
 *
 * ```
 * 일시납            인도월                      (선납)
 * 분납 · 정상        마지막 납입월 = 인도일+(회차−1)개월
 * 분납 · 부러짐      ★«부러진 그 시점»           받은 회차까지의 달
 * ```
 * ★**부러지면 기다리지 않는다**(사장님 2026-09-01 「분납이 완료가 안되면 안된 시점에서
 *   그냥 그 청구금액에 맞춰 청구」). 끝나기를 기다리면 영영 안 끝나는 건이 영영 청구가 안 된다.
 *   금액은 받은 회차에 비례해 깎는다 — `moneyOf` 가 한다.
 * ★인도 전이면 청구가 없다 — `null` 이다. 「없다」가 아니라 「아직」이다.
 */
export const billingMonth = (r: SettlementRow, now = new Date()): string | null => {
  // ★★박힌 청구월이 이긴다 — 사람이 정한 달을 계산이 덮으면 종이가 시트와 갈린다.
  const written = String(r.billMonth ?? '').trim();
  if (written) return written;
  if (!r.deliveredAt) return null;
  if (!claimsOnComplete(r)) return ym(r.deliveredAt);
  // ★부러졌으면 그 자리에서 청구한다 — 마지막으로 받은 회차가 든 달이다.
  if (brokenOf(r, now)) return ym(addMonths(r.deliveredAt, Math.max(0, paidRoundsOf(r, now) - 1)));
  const at = lastPaymentDate(r);
  return at ? ym(at) : ym(r.deliveredAt);
};

/**
 * **받은 만큼의 몫** — 부러진 분납은 «받은 회차 / 전체 회차» 로 깎는다.
 *
 * ★실증(2026-09-01) — 원본 정산시트 `133호1997` 우리캐피탈, 판매수수료 1,688,750,
 *   2회분납 중 1회만 받아 「계약번호」 칸에 「0.5」 라고 적혀 있었고 태윤이 844,375 로 정산했다.
 *   1,688,750 × 1/2 = 844,375 — 사람이 손으로 하던 계산이 이것이다.
 * ⚠ **적힌 회차가 있어야 «부러졌다»고 말할 수 있다.** 안 적혀 있으면 기간 비례라 늘 「받은 것」이 되고,
 *   그건 사실이 아니라 「아직 아니라고 말한 사람이 없다」는 뜻이다(`brokenOf` 주석).
 */
/**
 * **박힌 달에는 «박힌 줄만» 선다.**
 *
 * ★사람이 한 달을 맞춰 놓았으면(2026-08 = 태윤 매니저 원장 47줄 43,181,120) 그 달은 닫힌 것이다.
 *   계산으로 늦게 들어오는 줄이 확정된 달을 흔들면 이미 나간 청구서와 정산서가 갈린다.
 *   ⚠ 실측 2026-09-02 — 이걸 안 보고 뽑으니 8월이 56건 68,204,345 로 부풀었다.
 *     박힌 46줄에 «이미 지난달까지 청구된» 10줄이 계산으로 따라 들어온 것이다.
 * ★버리는 게 아니다 — `null` 이 된 줄은 「청구월미정」으로 가서 사람이 정한다.
 */
export const billingMonthIn = (r: SettlementRow, locked: ReadonlySet<string>, now = new Date()): string | null => {
  const written = String(r.billMonth ?? '').trim();
  if (written) return written;
  const m = billingMonth(r, now);
  return m && locked.has(m) ? null : m;
};

/** 그 줄들 안에서 «박힌» 달들. `billingMonthIn` 에 그대로 넘긴다. */
export const lockedMonthsOf = (rows: readonly SettlementRow[]): Set<string> =>
  new Set(rows.map((r) => String(r.billMonth ?? '').trim()).filter(Boolean));

export const paidRatioOf = (r: SettlementRow, now = new Date()): number => {
  const n = roundsOf(r.payKind);
  if (n < 2 || !brokenOf(r, now)) return 1;
  return paidRoundsOf(r, now) / n;
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
/**
 * **정산 대상 — 「모두 · 영업 · 공급」 셋뿐이다.**
 *
 * ★사장님 2026-09-02 「정산대상을 영업 공급 이렇게 하면 되지 굳이 불필요한 뭐뭐사만~ 이렇게 할필요있다?
 *   모두 영업 공급 이렇게 드롭다운 하면 되잖아」
 * ```
 * 모두   양쪽 다 정산한다 (거의 전부)
 * 영업   영업채널에만 준다 — 공급사 청구가 0 이다 (지난달 이미 받은 건)
 * 공급   공급사에만 청구한다 — 영업 지급이 0 이다
 * ```
 * ★옛 말(「양쪽」·「영업사만」·「공급사만」)도 그대로 읽는다 — 원장에 이미 그렇게 적힌 줄이 있다.
 *   ⚠ 글자를 바꾸면서 «읽기»를 안 넓히면, 이미 적힌 줄이 조용히 「모두」가 되어 청구가 되살아난다.
 */
export const SETTLE_TARGETS = ['모두', '영업', '공급'] as const;
export type SettleTarget = (typeof SETTLE_TARGETS)[number];
export const settleTargetOf = (v: unknown): SettleTarget => {
  const t = String(v ?? '').trim();
  if (t.includes('영업')) return '영업';
  if (t.includes('공급')) return '공급';
  return '모두';
};

export const moneyOf = (r: SettlementRow, now = new Date()): Money => {
  /**
   * ★**부러진 분납은 받은 만큼만**(사장님 2026-09-01 「안된 시점에서 그냥 그 청구금액에 맞춰 청구」).
   *   ⚠ «적힌» 수수료(claimWritten)에도 건다 — 적힌 값은 «다 받았을 때»의 금액이라
   *     부러진 줄에 그대로 쓰면 안 받은 회차까지 청구하게 된다.
   */
  /**
   * ★**정산 조건이 먼저다.** 「영업사만」이면 공급사 청구가 0 이고, 「0.5」면 양쪽 절반이며,
   *   청구보류·정산제외면 그 달에 안 선다. 부러진 비례(`paidRatioOf`)와 «곱해서» 같이 건다.
   */
  const target = settleTargetOf(r.settleTarget);
  const share = Number(r.settleRatio) || 1;
  const hold = r.billHold === true;
  const excl = r.settleExclude === true;
  const k = paidRatioOf(r, now) * share;
  const claimFull = r.claimWritten || feeOf(r.supplierRate || 0, r);
  const claim = excl || hold || target === '영업' ? 0 : Math.round(claimFull * k);
  /** ★스타·아이카는 부러지면 지급이 «아예» 없다 — 비례가 아니라 0 이다. */
  const payFull = r.payWritten || feeOf(r.agentRate || 0, r);
  const pay = excl || target === '공급' ? 0
    : (paidRatioOf(r, now) < 1 && noPayIfBroken(r) ? 0 : Math.round(payFull * k));
  /**
   * ★★**「부가세 포함」이면 적힌 금액이 «총액»이다** — 거기에 부가세를 또 붙이면 두 번 받는다.
   *   태윤 매니저 2026-09-02 「스타스카이 부가세 포함으로 정산만 수정되면 됩니다 · 나머진 다 맞습니다」.
   *   ⚠ `vatIncluded` 는 원자에 «이미» 박혀 있었는데(2026-09-01 메모에서 옮긴 축) 아무도 안 봤다.
   *     그래서 스타스카이 2줄이 780,000 → 858,000 · 1,650,000 → 1,815,000 으로 나갔다.
   *   ★수수료표도 그렇게 말하고 있다 — 스타 재렌트 「한 달 렌탈료(VAT 포함)」.
   */
  const gross = r.vatIncluded === true;
  const claimNet = gross ? Math.round(claim / (1 + VAT)) : claim;
  const claimVat = gross ? claim - claimNet : Math.round(claim * VAT);
  const payNet = gross ? Math.round(pay / (1 + VAT)) : pay;
  const payVat = gross ? pay - payNet : Math.round(pay * VAT);
  const claw = r.clawback ? r.clawbackAmount || 0 : 0;
  return {
    claim: claimNet, claimVat, claimTotal: claimNet + claimVat,
    pay: payNet, payVat, payTotal: payNet + payVat,
    margin: claimNet - payNet,
    net: claimNet - payNet - claw,
  };
};

/**
 * **청구 장부에 설 줄들.** 한 계약이 최대 두 줄이 된다 —
 * ★청구(+)는 «청구월»에, 환수(−)는 «환수일이 든 달»에 선다.
 *   ⚠ **기존 줄을 고치지 않는다.** 10월에 환수가 터졌다고 8월 장부를 고치면
 *     이미 계산서를 끊은 달이 바뀐다(사장님 「청구한거는 변함이 없게하고」).
 * ★환수일이 없으면 어느 달에 넣을지 모른다 — 넣지 않고 `unassignedClawback` 로 짚어 준다.
 */
export type BillingLine = {
  month: string; kind: '청구' | '환수';
  /** 공급사에 «받을» 몫. 환수면 음수다. */
  amount: number; vat: number; total: number;
  /** ★영업자에게 «줄» 몫. 환수면 음수다. */
  pay: number; payVat: number; payTotal: number;
};
export const billingLines = (r: SettlementRow): { lines: BillingLine[]; unassignedClawback: boolean } => {
  const lines: BillingLine[] = [];
  const m = billingMonth(r);
  const money = moneyOf(r);
  if (m && !r.cancelled) {
    lines.push({
      month: m, kind: '청구',
      amount: money.claim, vat: money.claimVat, total: money.claimTotal,
      pay: money.pay, payVat: money.payVat, payTotal: money.payTotal,
    });
  }
  let unassigned = false;
  if (r.clawback && r.clawbackAmount) {
    if (r.clawbackAt) {
      const v = Math.round(r.clawbackAmount);
      const vat = Math.round(v * VAT);
      /**
       * ★★**환수는 공급사·영업자가 «같이» 마이너스다**(사장님 2026-09-01 「환수는 공급사 영업자 같이 - 되니까」).
       *   되받는 것은 우리가 받은 수수료만이 아니다 — 영업자에게 준 것도 같이 돌아온다.
       *   ⚠ 예전에는 청구에서만 뺐다. 그러면 환수가 날 때마다 «우리 몫»이 실제보다 작아진다
       *     (준 돈은 그대로 나간 것으로 두고 받을 돈만 깎았으니).
       *
       * ★얼마나 빼나 — **그 줄의 지급/청구 비율 그대로**다. 환수금액은 «공급사 기준»으로 적히기 때문이다.
       *   실증(2026-09-01) 원본 `394우1198` 오토플러스 — 환수 665,455 · 시트의 영업자 환수 532,364.
       *   그 줄은 정액 청구 1,000,000 / 지급 800,000 이라 비율 0.8. 665,455 × 0.8 = 532,364 ✓
       * ⚠ 청구가 0 이면 비율을 못 낸다 — 그때는 지급도 0 으로 둔다(지어내지 않는다).
       */
      const ratio = money.claim > 0 ? money.pay / money.claim : 0;
      const pv = Math.round(v * ratio);
      const pvat = Math.round(pv * VAT);
      lines.push({
        month: ym(r.clawbackAt), kind: '환수',
        amount: -v, vat: -vat, total: -(v + vat),
        pay: -pv, payVat: -pvat, payTotal: -(pv + pvat),
      });
    } else unassigned = true;
  }
  return { lines, unassignedClawback: unassigned };
};

/** 화면에서 줄 색을 정한다 — 시트와 같은 규칙. 센 것이 이긴다. */
export type RowTone = 'cancelled' | 'clawback' | 'delivered' | 'plain';
export const toneOf = (r: SettlementRow): RowTone =>
  (r.cancelled ? 'cancelled' : r.clawback ? 'clawback' : r.delivered ? 'delivered' : 'plain');
