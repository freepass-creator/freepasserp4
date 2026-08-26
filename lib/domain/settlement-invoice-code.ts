/**
 * **정산서 번호 — 코드 규격을 따른다.** 순수 함수.
 *
 * ★사장님 2026-08-26 「정산코드랑 이런거는 신규코드 발행 매뉴얼에 따르고」.
 *   규격은 `docs/ERP5_CODE_SYSTEM.md` 와 `lib/domain/ids.ts` 다. 새로 만들지 않고 **따른다.**
 *
 * 층이 둘이다(ERP 표준 3층 중 ①②) —
 * ```
 * ① 대체키   stl_k7m2p9x4qz    기계가 쓴다. **절대 안 바뀐다.** newId('settlement')
 * ② 문서번호 FP-S-202608-001   사람이 읽고 말한다. 계약번호 FP-C-YYYYMMDD-* 와 같은 결
 * ```
 * ★★**번호는 «발행할 때» 붙고, 붙으면 안 바뀐다.**
 *   정산서는 원장에서 그때그때 그려 내는 종이라, 번호를 그릴 때마다 만들면 재인쇄할 때마다
 *   다른 번호가 나간다. 같은 달 같은 상대에게 번호가 둘이면 그건 문서가 아니다.
 *   그래서 발행 기록(`v4/settlement_invoices/{stl_}`)을 남기고, 다시 뽑으면 그것을 **다시 쓴다.**
 * ⚠ 순번은 **그 달 안에서** 센다. 달이 바뀌면 001 부터다 — 사람이 「8월 3번」이라 말한다.
 * ⚠ 코드에 뜻을 넣지 않는다(규격). 여기 든 것은 연월과 순번뿐이고, 상대 이름은 **안 넣는다** —
 *   상호가 바뀌면 번호가 거짓말이 된다(실측: 정책코드에 옛 공급사코드가 박혀 있었다).
 */

/** 발행 기록 한 줄. RTDB `v4/settlement_invoices/{code}` 에 그대로 들어간다. */
export type IssuedInvoice = {
  /** ① 대체키 — `stl_` */
  code: string;
  /** ② 사람이 읽는 문서번호 */
  invoiceNo: string;
  month: string;
  axis: '공급사' | '영업채널';
  party: string;
  /** 발행 시점의 합계 — 나중에 원장이 바뀌면 «달라졌다»고 말할 수 있어야 한다 */
  supply: number;
  vat: number;
  total: number;
  lines: number;
  issuedAt: number;
  issuedBy: string;
};

/** 같은 달·같은 축·같은 상대면 같은 문서다. 발행 기록을 찾는 열쇠. */
export const invoiceKey = (month: string, axis: string, party: string) =>
  `${String(month).trim()}|${String(axis).trim()}|${String(party).trim()}`;

const p3 = (n: number) => String(n).padStart(3, '0');

/**
 * 다음 문서번호. **그 달에 이미 나간 번호들**을 보고 뒤를 잇는다.
 * 청구서와 지급명세를 갈라 둔다 — 나가는 곳이 달라 번호가 섞이면 대사할 때 헷갈린다.
 */
export function nextInvoiceNo(month: string, axis: '공급사' | '영업채널', taken: string[]): string {
  const ym = String(month).replace(/[^0-9]/g, '').slice(0, 6);
  const kind = axis === '공급사' ? 'S' : 'P';
  const head = `FP-${kind}-${ym}-`;
  const used = taken
    .filter((v) => String(v).startsWith(head))
    .map((v) => Number(String(v).slice(head.length)))
    .filter((n) => Number.isFinite(n) && n > 0);
  return head + p3((used.length ? Math.max(...used) : 0) + 1);
}

/** 발행 뒤 원장이 바뀌었나 — 바뀌었으면 **말해야 한다.** 조용히 다른 금액을 인쇄하면 안 된다. */
export function driftOf(issued: IssuedInvoice | null, now: { supply: number; vat: number; lines: number }): string {
  if (!issued) return '';
  if (issued.supply === now.supply && issued.vat === now.vat && issued.lines === now.lines) return '';
  const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
  return `발행할 때는 ${issued.lines}건 ${won(issued.supply)} 였는데 지금 원장은 ${now.lines}건 ${won(now.supply)} 입니다.`;
}
