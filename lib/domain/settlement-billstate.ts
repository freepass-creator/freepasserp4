/**
 * **청구가 어디까지 갔나.** 순수 함수 — 네트워크 없음.
 *
 * ★사장님 2026-08-26 「미청구건이랑 청구완료건 청구했지만 환수될수 있는거 이런거
 *   구분값 다 반영되게 해줘야지」.
 *
 * 지금까지 원장에 있던 것은 «자리»(접수·취소·분납실적·완납실적)뿐이었다.
 * 자리는 **계약이 어디까지 왔나**를 말하고, 여기 있는 것은 **돈이 어디까지 갔나**를 말한다.
 * 둘은 다른 축이다 — 완납실적인데 아직 청구 안 한 건이 있고, 분납실적인데 이미 청구한 건이 있다.
 *
 * ```
 * 인도전     아직 청구가 «설» 수 없다. 인도가 관문이다
 * 청구예정   청구월이 아직 안 왔다. 「없다」가 아니라 「아직」이다
 * 미청구     청구월이 됐는데 청구서가 안 나갔다  ★여기가 돈이 새는 자리다
 * 환수위험   청구는 나갔는데 분납이 아직 안 끝났다 — 부러지면 되돌려줘야 한다
 * 청구완료   그 건이 든 청구서가 발행됐고 분납도 끝났다
 * 환수       깨졌다. 그 달에 마이너스 줄로 서 있다
 * 취소       계약 자체가 없어졌다
 * ```
 *
 * ★★**「청구완료」는 «청구서가 나갔나»로 판정한다.** 날짜가 지났다고 나간 게 아니다 —
 *   실제로 발행 기록(`v4/settlement_invoices`)이 있어야 나간 것이다.
 *   날짜로 판정하면 「청구한 줄 알았는데 아무도 안 보낸」 건이 조용히 완료로 넘어간다.
 * ★★**청구는 공급사별로 한 장씩 나간다.** 그래서 한 줄의 발행 여부는
 *   「그 줄의 청구월 · 그 줄의 공급사」로 끊긴 청구서가 있느냐로 정해진다.
 * ⚠ 「환수위험」은 나쁜 상태가 아니라 **아직 안 끝난** 상태다. 분납이 다 들어오면 청구완료로 간다.
 */
import { billingMonth, roundsOf, type SettlementRow } from './settlement-stage';

export type BillState = '인도전' | '청구예정' | '미청구' | '환수위험' | '청구완료' | '환수' | '취소';

/** 이 순서로 화면에 세운다 — **손이 필요한 것이 앞**이다. */
export const BILL_STATES: BillState[] = ['미청구', '환수위험', '인도전', '청구예정', '청구완료', '환수', '취소'];

export const BILL_TONE: Record<BillState, 'gray' | 'blue' | 'green' | 'red' | 'amber'> = {
  인도전: 'gray',
  청구예정: 'gray',
  미청구: 'amber',
  환수위험: 'blue',
  청구완료: 'green',
  환수: 'red',
  취소: 'red',
};

/** 왜 이 상태인지 한 줄. 화면에 그대로 쓴다 — 말이 갈리면 사람이 헷갈린다. */
export const BILL_WHY: Record<BillState, string> = {
  인도전: '인도가 안 됐습니다. 인도해야 청구월이 섭니다.',
  청구예정: '청구월이 아직 안 왔습니다.',
  미청구: '청구월이 됐는데 청구서가 안 나갔습니다.',
  환수위험: '청구는 나갔지만 분납이 아직 안 끝났습니다. 부러지면 돌려줘야 합니다.',
  청구완료: '청구서가 나갔고 분납도 끝났습니다.',
  환수: '깨졌습니다. 그 달에 마이너스로 서 있습니다.',
  취소: '계약이 취소됐습니다.',
};

/** 청구서 한 장을 가리키는 열쇠 — 달 + 공급사. 청구는 공급사별로 한 장씩 나간다. */
export const issuedKey = (month: string, supplier: string) =>
  `${String(month || '').trim()}|${String(supplier || '').trim()}`;

const p2 = (n: number) => String(n).padStart(2, '0');
const ymOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;

/**
 * @param issued  발행된 청구서 열쇠 모음(`issuedKey`). **없으면 아무것도 「청구완료」가 아니다** —
 *                모르는 것을 「됐다」로 치면 안 된 것이 조용히 넘어간다.
 */
export function billStateOf(r: SettlementRow, issued: Set<string>, now = new Date()): BillState {
  if (r.cancelled) return '취소';
  if (r.clawback) return '환수';
  const m = billingMonth(r);
  if (!r.delivered || !m) return '인도전';

  const thisMonth = ymOf(now);
  if (m > thisMonth) return '청구예정';
  if (!issued.has(issuedKey(m, r.supplier))) return '미청구';

  // 청구서는 나갔다. 분납이 남아 있으면 아직 되돌아올 수 있다.
  const rounds = roundsOf(r.payKind);
  if (rounds >= 2 && r.deliveredAt) {
    const last = new Date(r.deliveredAt.getFullYear(), r.deliveredAt.getMonth() + (rounds - 1), r.deliveredAt.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (last >= today) return '환수위험';
  }
  return '청구완료';
}

/** 세어 보여 주는 용도 — 무엇이 몇 건인지. */
export function countByBillState(states: BillState[]): { state: BillState; n: number }[] {
  const m = new Map<BillState, number>();
  for (const s of states) m.set(s, (m.get(s) || 0) + 1);
  return BILL_STATES.map((state) => ({ state, n: m.get(state) || 0 })).filter((x) => x.n > 0);
}
