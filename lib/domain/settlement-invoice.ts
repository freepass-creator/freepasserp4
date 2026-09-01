/**
 * **정산서 한 장을 만든다.** 순수 함수 — 네트워크도 서식도 없다.
 *
 * ★사장님 2026-08-26 「관리자는 나중에 공급사별 영업채널별 정산서까지 만들어 낼수 있어야해」
 *   「급한건 당월거랑 당장 이번달말일로 정산해서 9월초에 청구할거를 챙기는거」.
 *
 * 축이 둘이고 **문서의 뜻이 다르다** —
 * ```
 * 공급사별   청구서   우리가 «받을» 것. 판매수수료 + 인센티브 + 부가세
 * 영업채널별 지급명세  우리가 «줄» 것.   출고수수료 + 인센티브 + 대행료 + 부가세
 * ```
 *
 * ★★**환수는 청구를 고치지 않는다.** 이미 끊은 계산서를 되돌리는 게 아니라
 *   그 달 정산서에 **마이너스 줄로 새로 선다.** 그래야 「무슨 일이 있었나」가 남는다.
 * ★★**금액을 여기서 새로 계산하지 않는다.** 적혀 있으면 적힌 값이 이긴다 —
 *   실제로 계산서를 끊은 금액이기 때문이다. 산식은 `settlement-stage.ts` 하나뿐이다.
 * ⚠ 발행자·수신처 정보를 **지어내지 않는다.** 없으면 빈칸으로 두고 «비었다»고 말한다 —
 *   사업자번호를 지어내면 그게 그대로 세금계산서에 실린다.
 */
import { VAT, moneyOf, type SettlementRow } from './settlement-stage';
import { ciOf, ciGapsOf, bizNoPretty } from './partner-ci';

/** 정산서에 실리는 회사 한 곳. 없는 값은 빈 문자열이고, 지어내지 않는다. */
export type InvoiceParty = {
  name: string;
  bizNo: string;
  ceo: string;
  address: string;
  phone: string;
  bank: string;
  account: string;
  holder: string;
};

export const EMPTY_PARTY: InvoiceParty = { name: '', bizNo: '', ceo: '', address: '', phone: '', bank: '', account: '', holder: '' };

/** 정산서 한 줄. **차 한 대가 한 줄**이다. */
export type InvoiceLine = {
  plate: string;
  model: string;
  customer: string;
  product: string;
  term: number;
  /** 수수료를 낸 기준값 — 대여료×기간 또는 차량가액. 「왜 이 금액인가」가 보여야 한다. */
  /**
   * **이 수수료가 어떻게 나왔나** — 기준값 한 줄.
   * 「대여료 550,000 × 36개월」 또는 「차량가액 30,000,000」.
   */
  base: string;
  /**
   * 적용 요율. **1 이상이면 요율이 아니라 «건당 고정액»이다**(오플구독 100만·재렌트 50만).
   * ★사장님 2026-08-27 「각 수수료가 어떻게 나왔는지」 — 종이가 그걸 말해야 한다.
   * ⚠ 곱하면 조 단위가 나온다. 화면에 찍을 때도 «%»를 붙이지 마라 — `feeShow` 가 가른다.
   */
  rate?: number;
  amount: number;
  vat: number;
  total: number;
  /** 환수 줄이면 참. 마이너스로 선다. */
  minus?: boolean;
  reason?: string;
};

export type Invoice = {
  axis: '공급사' | '영업채널';
  /** 「청구서」인지 「지급명세서」인지 — 축이 문서의 뜻을 바꾼다. */
  kind: '청구서' | '지급명세서';
  month: string;
  party: string;
  issuer: InvoiceParty;
  receiver: InvoiceParty;
  lines: InvoiceLine[];
  supply: number;
  vat: number;
  total: number;
  /** 환수로 빠진 금액(양수로 담는다). 합계에는 이미 빠져 있다. */
  clawback: number;
  /** 채워야 나갈 수 있는 칸 — 비었으면 화면이 대놓고 말한다. */
  missing: string[];
};

const S = (v: unknown) => String(v ?? '').trim();

/**
 * **고객 이름을 가린다** — 「문세준」 → 「문*준」.
 *
 * ★★★사장님 2026-08-27 「문*준 이렇게 해줘야지」.
 *
 * ★★**정산서는 «남의 회사»가 보는 종이다.** 우리 고객의 실명을 통째로 넘길 이유가 없다.
 *   회원사는 차량번호로 그 건을 찾는다 — 이름은 «같은 차 다른 계약»을 가르는 곁다리다.
 *   가운데만 가려도 그 구실은 그대로 한다.
 *
 * ★★★**가리는 자리는 «종이(HTML·PDF)» 한 곳이다.** 사장님 2026-08-27
 *   「엑셀은 가릴필요 없지 청구서에만」.
 *   ⇒ `Invoice` 에는 **온전한 이름**이 담긴다. 엑셀은 우리가 대조할 때 쓰는 것이라 그대로 둔다.
 *
 * ⛔⛔ **그래서 엑셀에는 고객 실명이 그대로 있다.**
 *   ★엑셀을 회원사에 보내면 «가린 게 소용없다». 나가는 건 PDF 다.
 *     엑셀을 밖으로 보낼 일이 생기면 그때는 여기 말고 «엑셀 만드는 곳»에서 가려야 한다.
 *
 * ⚠ 원장은 안 건드린다. 우리 화면·정산원장에는 온전한 이름이 남는다.
 *
 * ```
 * 문세준    → 문*준
 * 남궁민수  → 남**수
 * 이철      → 이*
 * (빈칸)    → (빈칸)
 * ```
 */
export function maskName(v: unknown): string {
  const n = S(v);
  if (n.length < 2) return n;
  if (n.length === 2) return `${n[0]}*`;
  return `${n[0]}${'*'.repeat(n.length - 2)}${n[n.length - 1]}`;
}
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

/** 기준값을 사람 말로 — 「왜 이 금액인가」가 안 보이면 공급사가 못 믿는다. */
/**
 * **요율을 사람이 읽는 말로.** 1 이상이면 요율이 아니라 건당 고정액이다.
 * ★그대로 「300%」라고 찍으면 종이가 거짓말을 한다 — 실제로 그렇게 틀린 적이 있다.
 */
export function feeShow(rate: unknown): string {
  const v = Number(rate) || 0;
  if (!v) return '';
  return v >= 1 ? `건당 ${won(v)}` : `${Number((v * 100).toFixed(2))}%`;
}

export function baseOf(r: SettlementRow): string {
  if (/선출고|견적출고/.test(r.product || '')) return r.price ? `차량가액 ${won(r.price)}` : '차량가액 없음';
  if (r.rent && r.term) return `대여료 ${won(r.rent)} × ${r.term}개월`;
  return '기준값 없음';
}

/**
 * 한 상대에게 나갈 정산서를 짠다.
 * @param rows  그 달 그 상대의 줄만 미리 걸러 넘긴다(거르는 규칙은 호출부가 안다).
 */
export function buildInvoice(opts: {
  axis: '공급사' | '영업채널';
  month: string;
  party: string;
  issuer: InvoiceParty;
  receiver: InvoiceParty;
  rows: SettlementRow[];
  /** 그 달에 마이너스로 설 환수 줄 */
  clawbacks?: SettlementRow[];
}): Invoice {
  const claim = opts.axis === '공급사';
  const lines: InvoiceLine[] = opts.rows.map((r) => {
    const m = moneyOf(r);
    const amount = claim ? m.claim : m.pay;
    const vat = claim ? m.claimVat : m.payVat;
    return {
      plate: S(r.plate), model: S(r.model), customer: S(r.customer), product: S(r.product),
      term: Number(r.term) || 0, base: baseOf(r),
      // ★청구서는 공급사 요율, 지급명세서는 영업자 요율. 축을 따라간다.
      rate: Number(claim ? r.supplierRate : r.agentRate) || 0,
      amount, vat, total: amount + vat,
    };
  });

  // ★환수는 «되돌리기»가 아니라 «새 줄»이다. 그래야 무슨 일이 있었는지가 남는다.
  let clawback = 0;
  for (const r of opts.clawbacks || []) {
    const v = Math.round(r.clawbackAmount || 0);
    if (!v) continue;
    clawback += v;
    const vat = Math.round(v * VAT);
    lines.push({
      plate: S(r.plate), model: S(r.model), customer: S(r.customer), product: S(r.product),
      term: Number(r.term) || 0, base: '환수',
      amount: -v, vat: -vat, total: -(v + vat), minus: true,
      reason: S((r as SettlementRow & { clawbackReason?: string }).clawbackReason),
    });
  }

  const supply = lines.reduce((s, l) => s + l.amount, 0);
  const vat = lines.reduce((s, l) => s + l.vat, 0);

  /**
   * **받는 곳의 신원은 CI 정본에서 메운다.**
   *
   * ★사장님 2026-08-26 「청구회사를 좀 정중하게 별도로 이름이랑 CI까지 확인해서 해주고」.
   * ★시트는 별칭(「손오공」)만 안다 — 정식 상호는 `lib/domain/partner-ci.ts` 가 안다.
   * ★★**부르는 쪽이 준 값이 이긴다.** 여기서 메우는 건 «비어 있는 칸»뿐이다.
   *   화면에서 사람이 고쳐 넣은 값을 정본이 덮으면 그 수정이 조용히 사라진다.
   */
  const ci = ciOf(opts.party);
  const receiver: InvoiceParty = {
    ...opts.receiver,
    name: S(opts.receiver.name) || S(ci?.legal),
    bizNo: bizNoPretty(S(opts.receiver.bizNo) || S(ci?.bizNo)),
    ceo: S(opts.receiver.ceo) || S(ci?.ceo),
    address: S(opts.receiver.address) || S(ci?.addr),
    phone: S(opts.receiver.phone) || S(ci?.tel),
  };

  const missing: string[] = [];
  if (!S(opts.issuer.name)) missing.push('발행자 상호');
  if (!S(opts.issuer.bizNo)) missing.push('발행자 사업자등록번호');
  if (claim && !S(opts.issuer.account)) missing.push('입금계좌');
  if (!claim && !S(receiver.account)) missing.push('지급계좌');
  if (!S(receiver.name)) missing.push('받는 곳 상호');
  if (!S(receiver.bizNo)) missing.push('받는 곳 사업자등록번호');
  // CI 정본이 아직 모르는 칸도 같이 알려 준다 — 발송 전에 채우라고.
  missing.push(...ciGapsOf(opts.party));

  return {
    axis: opts.axis,
    kind: claim ? '청구서' : '지급명세서',
    month: opts.month,
    party: opts.party,
    issuer: opts.issuer,
    receiver,
    lines,
    supply, vat, total: supply + vat,
    clawback,
    missing,
  };
}
