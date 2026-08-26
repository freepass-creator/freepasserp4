/**
 * **정산 한 줄이 ERP 에 담기는 모양.** 순수 — 저장소도 네트워크도 없다.
 *
 * ★사장님 2026-08-26 「구글시트를 대체할수 있게끔 만들어줘」
 *   「시트를 연동하는게 아니라 우리가 erp에서 직접 관리하는거로」.
 *
 * ★★**원자만 담는다. 파생은 담지 않는다.**
 * ```
 * 담는다    차번·고객·공급사·영업자 · 상품·기간·대여료·보증금·차량가액·분납·납입회차
 *          접수일·인도일·환수일 · 계약서·인도완료·취소·환수 · 요율·적힌 수수료
 * 안 담는다  자리(접수/분납실적/완납실적) · 청구월 · 청구액 · 청구상태
 *          → 전부 인도일·회차·요율로 «계산»된다. 담으면 계산값과 갈리고, 갈리면 아무도 못 고친다
 * ```
 *   ⇒ 시트의 탭 넷은 ERP 에서 사라진다. 탭은 «자리»였고 자리는 파생값이다.
 *
 * ★★**날짜는 `YYYY-MM-DD` 문자열이다.** 시트는 날짜를 숫자(45301)로 돌려줘서 오늘만 세 번 당했다.
 *   ERP 에서는 처음부터 사람이 읽을 수 있는 글자로 둔다 — 눈으로 틀린 걸 볼 수 있어야 한다.
 * ★★**체크는 boolean 이다.** 시트에서는 TRUE·'참'·'Y' 가 섞여 판정이 조용히 갈렸다.
 *
 * ★열쇠는 `stl_` 대체키다(ERP5 코드 규격). 차번+접수일은 사람이 고치면 바뀌지만 이건 안 바뀐다.
 */
import { newId } from './ids';

/** ERP 에 저장되는 한 줄. **여기 없는 것은 계산된다.** */
export type SettlementRecord = {
  /** `stl_` 대체키. **절대 안 바뀐다.** */
  code: string;

  // ── 뼈대
  plate: string;
  model: string;
  supplier: string;
  channel: string;
  agent: string;
  agentCode: string;
  agentPhone: string;
  customer: string;
  phone: string;

  // ── 조건
  product: string;
  rentKind: string;
  term: number;
  deposit: number;
  rent: number;
  price: number;
  payKind: string;
  /** 받은 회차. 0이면 «기간 비례로 계산» — 부러졌을 때만 사람이 박는다. */
  paidRounds: number;
  upsell: number;
  age: string;
  region: string;

  // ── 진행 (날짜는 YYYY-MM-DD, 체크는 boolean)
  receivedAt: string;
  paper: boolean;
  delivered: boolean;
  deliveredAt: string;
  cancelled: boolean;
  clawback: boolean;
  clawbackReason: string;
  clawbackAt: string;
  clawbackAmount: number;

  // ── 정산 (요율·«적힌» 금액만. 계산되는 청구액·지급액은 안 담는다)
  supplierRate: number;
  agentRate: number;
  /** 실제로 계산서를 끊은 금액이 있으면 그것이 이긴다. */
  claimWritten: number;
  payWritten: number;
  claimIncentive: number;
  payIncentive: number;
  paperFee: number;

  // ── 참고
  contractNo: string;
  contractType: string;
  paperBy: string;
  note: string;

  // ── 자취
  createdAt: number;
  updatedAt: number;
  /** 시트에서 옮겨 온 줄이면 그 흔적. 새로 만든 줄은 빈 문자열. */
  fromSheet: string;
};

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => {
  const n = Number(S(v).replace(/[,\s원%]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
/** 시트의 체크는 TRUE·참·Y 가 섞여 있다 — 읽을 때 한 번에 굳힌다. */
const B = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));

const SERIAL0 = Date.UTC(1899, 11, 30);
const p2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/**
 * 시트 값을 날짜 글자로. ⚠ **숫자로 오는 것을 잊지 마라** —
 * `45301` 을 그냥 `new Date` 에 넣으면 45301년이 된다(실측 2026-08-26, 세 번 당했다).
 */
export function dayOf(v: unknown): string {
  const t = S(v);
  if (!t) return '';
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return isoOf(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
  }
  const d = new Date(t.replace(/\./g, '-'));
  return Number.isNaN(+d) ? '' : isoOf(d);
}

/** 시트 한 줄(칸 이름 → 값) 을 ERP 레코드로. **자리·청구월·청구액은 안 읽는다** — 계산된다. */
export function recordFromSheet(cell: (name: string) => string, opts?: { code?: string; fromSheet?: string }): SettlementRecord {
  const now = Date.now();
  return {
    code: opts?.code || newId('settlement'),
    plate: S(cell('차량번호')),
    model: S(cell('모델명')),
    supplier: S(cell('공급사')),
    channel: S(cell('영업채널')),
    agent: S(cell('영업담당자')),
    agentCode: S(cell('영업자코드')),
    agentPhone: S(cell('영업자연락처')),
    customer: S(cell('고객명')),
    phone: S(cell('고객연락처')),

    product: S(cell('상품구분')),
    rentKind: S(cell('렌트구분')),
    term: N(cell('계약기간')),
    deposit: N(cell('보증금')),
    rent: N(cell('렌탈료')),
    price: N(cell('차량가액')),
    payKind: S(cell('분납여부')),
    paidRounds: N(cell('납입회차')),
    upsell: N(cell('업셀링금액')),
    age: S(cell('연령')),
    region: S(cell('출고지역')),

    receivedAt: dayOf(cell('접수일')),
    paper: B(cell('계약서')),
    // ★인도완료는 «인도일이라는 사실»에서 끌어낸다 — 글자는 안 고치고 넘어가기 쉽다.
    delivered: !!dayOf(cell('인도일')),
    deliveredAt: dayOf(cell('인도일')),
    cancelled: B(cell('계약취소')),
    clawback: B(cell('환수')),
    clawbackReason: S(cell('환수사유')),
    clawbackAt: dayOf(cell('환수일')),
    clawbackAmount: N(cell('환수금액')),

    supplierRate: N(cell('공급사수수료율')),
    agentRate: N(cell('에이전시수수료율')),
    claimWritten: N(cell('판매수수료')),
    payWritten: N(cell('출고수수료')),
    claimIncentive: N(cell('공급사인센티브')),
    payIncentive: N(cell('에이전시인센티브')),
    paperFee: N(cell('계약서대행료')),

    contractNo: S(cell('계약번호')),
    contractType: S(cell('계약형태')),
    paperBy: S(cell('계약서작성담당')),
    note: S(cell('비고')),

    createdAt: now,
    updatedAt: now,
    fromSheet: S(opts?.fromSheet),
  };
}

/** RTDB 는 `undefined` 를 거부한다. 빈 값을 타입에 맞게 굳혀 둔다. */
export function normalizeRecord(r: Partial<SettlementRecord>): SettlementRecord {
  const now = Date.now();
  return {
    code: S(r.code) || newId('settlement'),
    plate: S(r.plate), model: S(r.model), supplier: S(r.supplier), channel: S(r.channel),
    agent: S(r.agent), agentCode: S(r.agentCode), agentPhone: S(r.agentPhone),
    customer: S(r.customer), phone: S(r.phone),
    product: S(r.product), rentKind: S(r.rentKind),
    term: N(r.term), deposit: N(r.deposit), rent: N(r.rent), price: N(r.price),
    payKind: S(r.payKind), paidRounds: N(r.paidRounds), upsell: N(r.upsell),
    age: S(r.age), region: S(r.region),
    receivedAt: S(r.receivedAt), paper: !!r.paper,
    delivered: !!S(r.deliveredAt), deliveredAt: S(r.deliveredAt),
    cancelled: !!r.cancelled, clawback: !!r.clawback,
    clawbackReason: S(r.clawbackReason), clawbackAt: S(r.clawbackAt), clawbackAmount: N(r.clawbackAmount),
    supplierRate: N(r.supplierRate), agentRate: N(r.agentRate),
    claimWritten: N(r.claimWritten), payWritten: N(r.payWritten),
    claimIncentive: N(r.claimIncentive), payIncentive: N(r.payIncentive), paperFee: N(r.paperFee),
    contractNo: S(r.contractNo), contractType: S(r.contractType), paperBy: S(r.paperBy), note: S(r.note),
    createdAt: Number(r.createdAt) || now,
    updatedAt: Number(r.updatedAt) || now,
    fromSheet: S(r.fromSheet),
  };
}
