/**
 * **정산원장을 «남에게 보여줄 모양»으로 깎는다.** 순수 함수 — 여기엔 시트도 네트워크도 없다.
 *
 * ★사장님 2026-08-26
 *   「관리자가 정산관리에서 입력하는것이 계약진행, 정산확인에서 영업자공급사들이 볼수 있게끔」
 *   「대여료 기간 보증금같은것들만 확인하고 정산금액은 거기에서는 안보이게」
 *
 * 그래서 축이 이렇게 갈린다 —
 * ```
 * 정산관리 /settlement/ledger   관리자가 «넣는» 곳.   금액이 다 보인다
 * 계약진행 /contract            영업자·공급사가 «내 계약이 어떻게 되나» 보는 곳
 * 정산확인 /settlement          영업자·공급사가 «내 실적이 몇 건인가» 보는 곳
 *                              ↑ 이 둘은 대여료·기간·보증금까지. **정산 금액은 없다**
 * ```
 *
 * ★★**금액은 화면에서 숨기는 게 아니라 여기서 «안 싣는다».**
 *   `display:none` 이나 조건부 렌더로 가리면 API 응답에는 그대로 들어 있다 —
 *   개발자도구 한 번이면 다 보인다. 그건 안 가린 것이다.
 *   그래서 `PublicRow` 에는 수수료 칸이 **타입에 아예 없다.** 넣으려면 타입을 고쳐야 하고,
 *   타입을 고치려면 이 주석을 읽게 된다. 그게 이 파일이 하는 일의 전부다.
 *   ⚠ 이 때문에 `{ ...row }` 스프레드가 금지다 — 칸을 하나하나 손으로 옮겨 담는다.
 */
import { bucketOf, stageOf, type Bucket, type SettlementRow, type Stage } from './settlement-stage';

/** 보는 사람. **이름으로 맞춘다** — 원장이 코드가 아니라 상호·사람 이름으로 적혀 있다. */
export type Viewer = {
  role: 'agent' | 'provider' | 'admin';
  /** 공급사가 볼 때 맞출 상호. 예 「제일오토렌탈」 */
  supplier: string;
  /** 영업자가 볼 때 맞출 사람 이름. 원장 「영업담당자」 칸과 맞춘다. */
  agent: string;
  /**
   * 등록된 «다른» 공급사 상호 전부. 줄여 쓴 이름을 풀 때 **겹치는지 보려고** 받는다.
   * ⚠ 안 주면 줄임말을 안 푼다 — 못 푸는 쪽이 남의 계약을 보여 주는 쪽보다 낫다.
   */
  rivals?: string[];
  /**
   * 영업자의 소속 채널. **이름이 겹칠 때만** 채운다.
   *
   * ★실측 2026-08-26 — 원장에는 영업담당자가 «이름»으로만 적혀 있는데 같은 이름 계정이 둘이었다.
   *   「이승호」는 렌트야와 임시소속에 하나씩, 「이하민」은 하허호에 둘, 「정동근」은 개인영업채널과 바름카.
   *   이름만으로 맞추면 셋 다 «누구인지 정할 수 없다»가 되어 실적 확인이 영영 안 열린다.
   * ★★**겹칠 때만 소속을 본다.** 늘 소속까지 요구하면, 회사명 표기가 조금만 달라도
   *   멀쩡한 사람이 0줄을 보게 된다. 필요한 곳에서만 좁힌다.
   */
  channel?: string;
  /**
   * 영업자코드. **있으면 이것이 이긴다** — 이름은 겹쳐도 코드는 안 겹친다.
   * ★사장님 2026-08-26 「각각 영업자한테 코드를 부여해야할거 같어 / 동명이인 거르려면」.
   */
  agentCode?: string;
  /**
   * **같은 사람의 코드 전부.** 한 사람이 계정을 두 번 만든 경우가 있다 —
   * 실측 2026-08-26: 이하민(S0002·S0032) · 정동근(U0123·U0125) · 신선호(U0031·U0127).
   * 셋 다 **전화번호가 같다.** 중복 계정이 아니라 «같은 사람이 두 번 가입»한 것이다.
   *
   * ★★그래서 계정을 합치지 않고 **둘 다 같은 사람으로 본다.** 어느 쪽으로 로그인해도 내 실적이 보인다.
   *   계정 병합은 로그인·이력이 걸린 일이라 사람이 정할 일이고, 그때까지 실적이 막혀 있을 이유는 없다.
   */
  agentCodes?: string[];
};

/**
 * 밖으로 나가는 한 줄. **돈은 대여료·보증금뿐이고 둘 다 계약 조건이다.**
 * 여기 없는 것 — 판매수수료·출고수수료·청구금액·지급액·인센티브·부가세·대행료·환수금액·수수료율.
 * ⚠ 차량가액도 뺐다. 계약 조건처럼 보이지만 «선출고 수수료의 기준값»이라 요율을 역산할 수 있다.
 * ⚠ 고객연락처도 뺐다. PII 는 관리자 화면 밖으로 내보내지 않는다.
 */
export type PublicRow = {
  plate: string;
  model: string;
  supplier: string;
  agent: string;
  product: string;
  /** 계약기간(개월) */
  term: number;
  /** 보증금 */
  deposit: number;
  /** 대여료 */
  rent: number;
  payKind: string;
  customer: string;
  receivedAt: string;
  deliveredAt: string;
  /** 계약서를 썼나 */
  paper: boolean;
  /** 인도가 됐나 — 실적을 세는 관문이다 */
  delivered: boolean;
  cancelled: boolean;
  /** 어느 자리에 앉아 있나 */
  stage: Stage;
  bucket: Bucket;
  /** 사람이 읽는 한마디 */
  status: string;
};

const S = (v: unknown) => String(v ?? '').trim();
const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '');

/**
 * 상호 대조용 — 「(주)제일오토렌탈」과 「제일오토렌탈」이 같은 곳이라는 걸 사람은 알고 코드는 모른다.
 * ⚠ **법인격 표기를 «통째로» 먼저 뗀다.** 괄호만 지우면 `(주)…` 가 `주…` 로 남아 안 맞는다(실측).
 */
export const nameKey = (v: unknown) => S(v)
  .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
  .replace(/\(\s*(주|유|재|사|합)\s*\)|㈜|주식회사|유한회사|유한책임회사/g, '')
  .replace(/[\s()·\-_.]/g, '')
  .toLowerCase();

/** 한 줄을 밖에 보일 모양으로. **칸을 손으로 옮겨 담는다** — 스프레드를 쓰면 돈이 딸려 나온다. */
export function publicRowOf(r: SettlementRow, now = new Date()): PublicRow {
  const stage = stageOf(r, now);
  const bucket = bucketOf(r, now);
  return {
    plate: S(r.plate),
    model: S(r.model),
    supplier: S(r.supplier),
    agent: S(r.agent),
    product: S(r.product),
    term: Number(r.term) || 0,
    deposit: Number(r.deposit) || 0,
    rent: Number(r.rent) || 0,
    payKind: S(r.payKind),
    customer: S(r.customer),
    receivedAt: iso(r.receivedAt),
    deliveredAt: iso(r.deliveredAt),
    paper: !!r.paper,
    delivered: !!r.delivered,
    cancelled: !!r.cancelled,
    stage,
    bucket,
    status: statusOf(r, stage),
  };
}

/** 상태 한마디 — 금액을 말하지 않고 «지금 어디까지 왔나»만 말한다. */
export function statusOf(r: SettlementRow, stage = stageOf(r)): string {
  if (r.cancelled) return '계약취소';
  if (!r.delivered) return r.paper ? '계약서 완료 · 인도 대기' : '접수 · 계약서 대기';
  if (stage === '분납실적') return '인도완료 · 분납 진행중';
  return '인도완료';
}

/**
 * **내 것만 남긴다.** 못 알아보면 «전부»가 아니라 «0줄»이다 —
 * 실패했을 때 열리는 쪽으로 기울면 그건 잠금장치가 아니다.
 */
export function scopeRows(rows: SettlementRow[], viewer: Viewer): SettlementRow[] {
  if (viewer.role === 'admin') return rows;
  const mine = nameKey(viewer.role === 'provider' ? viewer.supplier : viewer.agent);
  if (!mine) return [];
  if (viewer.role === 'provider') {
    return rows.filter((r) => isSameCompany(r.supplier, mine, viewer.rivals || []));
  }
  // ★코드가 양쪽에 다 있으면 **코드가 이긴다.** 이름은 겹쳐도 코드는 안 겹친다.
  //   ★같은 사람이 두 번 가입한 경우가 있어 «내 코드들»을 다 본다(전화번호가 같은 계정).
  const codes = new Set([S(viewer.agentCode), ...(viewer.agentCodes || []).map(S)].filter(Boolean));
  if (codes.size) {
    const coded = rows.filter((r) => codes.has(S(r.agentCode)));
    // 아직 코드가 안 박힌 옛 줄이 있으니, 코드로 잡힌 게 하나도 없을 때만 이름으로 내려간다.
    if (coded.length) return coded;
  }
  // ★이름이 겹치는 사람만 소속까지 맞춘다. 안 겹치면 이름만으로 충분하다.
  const ch = nameKey(viewer.channel);
  return rows.filter((r) => !S(r.agentCode) && nameKey(r.agent) === mine
    && (!ch || nameKey(r.channel) === ch || !nameKey(r.channel)));
}

/**
 * **원장에 줄여 쓴 상호를 등록 상호에 붙인다 — 단, «유일할 때만».**
 *
 * ★실측 2026-08-26: 원장 27곳 중 14곳이 등록과 글자가 달라 그 공급사는 155줄을 «0줄»로 봤다.
 *   원장은 사람이 손으로 적어 짧다 — 「웰릭스」·「아이언」·「스위치」.
 *   등록은 정식 상호다 — 「웰릭스모빌리티」·「(주)아이언렌트카」·「스위치플랜」.
 *   ⚠ 이건 버그로 신고가 안 들어온다. 공급사 눈에는 「권한이 막혔나 보다」로 보인다.
 *
 * 규칙은 하나다. **줄임말이 내 상호의 앞머리이고, 그 앞머리로 시작하는 등록사가 나뿐일 때만** 붙인다.
 *   「웰릭스」로 시작하는 등록사가 웰릭스모빌리티 하나뿐 → 붙인다.
 *   「리더스」로 시작하는 등록사가 둘이면 → **아무에게도 안 붙인다.**
 * ⚠ 헐겁게 풀면 남의 계약이 보인다. 못 푸는 것은 불편이고, 잘못 푸는 것은 사고다.
 */
export function isSameCompany(ledgerName: string, myKey: string, rivals: string[]): boolean {
  const v = nameKey(ledgerName);
  if (!v) return false;
  if (v === myKey) return true;
  if (v.length < 2 || !myKey.startsWith(v)) return false;
  return !rivals.some((r) => { const k = nameKey(r); return k !== myKey && k.startsWith(v); });
}

/**
 * **관리자가 보는 한 줄 — 여기에만 금액이 붙는다.**
 *
 * ★사장님 2026-08-26 「관리자가 접수해서 계약진행확인이랑 정산확인할수 있는 페이지를
 *   계약/정산확인 메뉴에 페이지로 하나만 만들어서 범용적으로 확인할수 있게끔」.
 *   화면은 하나지만 **담기는 것이 역할마다 다르다.** 관리자만 이 모양을 받는다.
 * ⚠ 이 함수를 부르는 자리는 «역할을 서버가 검증한 뒤»여야 한다. 화면 분기로는 못 막는다.
 */
export type AdminRow = PublicRow & {
  claim: number;
  pay: number;
  net: number;
  billingMonth: string;
  clawback: boolean;
  clawbackAt: string;
  clawbackAmount: number;
  /**
   * 영업채널 — **정산서를 끊는 축이다**(사장님 2026-08-26
   * 「관리자는 나중에 공급사별 영업채널별 정산서까지 만들어 낼수 있어야해」).
   * 공급사는 «받을 곳», 영업채널은 «줄 곳». 두 축으로 갈라야 정산서가 나온다.
   */
  channel: string;
  /** 고객연락처 — PII. 관리자 화면에서만 흐른다. */
  phone: string;
};

/**
 * **자기 쪽 금액만 붙은 줄.**
 *
 * ★사장님 2026-08-26 「영업자 청구서를 만들어서 확인하는 작업이 있어야지」 —
 *   건수만 보고 「맞다」고 하기는 어렵다. 자기가 받을 돈을 봐야 확인이 된다.
 *   (2026-08-26 앞선 지시 「일단 금액은 적지 않을거야」에서 «일단»이 풀린 것이다.)
 *
 * ★★**각자 자기 쪽 금액만 본다.**
 * ```
 * 영업자   지급액   내가 «받을» 것
 * 공급사   청구액   내가 «낼» 것
 * 우리 몫  —        아무도 못 본다. 청구−지급은 관리자 화면에만 있다
 * ```
 *   한쪽 금액만 실으면 다른 쪽을 역산할 수 없다 — 그게 이 분리의 이유다.
 * ⚠ 그래서 이 타입에는 «금액이 하나»뿐이다. 둘을 담으면 뺄셈으로 우리 몫이 나온다.
 */
export type PartyRow = PublicRow & {
  /** 영업자면 지급액, 공급사면 청구액. **무엇인지는 `moneyLabel` 이 말한다.** */
  amount: number;
  /** 부가세 포함 — 실제로 오갈 돈 */
  amountTotal: number;
  billingMonth: string;
};

/** 그 금액이 무엇인가. 화면이 지어내지 않게 서버가 말해 준다. */
export const moneyLabelOf = (role: 'agent' | 'provider') => (role === 'agent' ? '지급액' : '청구액');

/** 정산확인이 묻는 것 — **몇 건인가**. 금액은 세지 않는다. */
export function countsOf(rows: PublicRow[]): { label: string; n: number }[] {
  const live = rows.filter((r) => !r.cancelled);
  return [
    { label: '진행중', n: live.filter((r) => !r.delivered).length },
    { label: '인도완료', n: live.filter((r) => r.delivered).length },
    { label: '분납 진행중', n: live.filter((r) => r.bucket === '분납실적').length },
    { label: '실적 확정', n: live.filter((r) => r.bucket === '완납실적').length },
    { label: '취소', n: rows.filter((r) => r.cancelled).length },
  ];
}

/** 「26년08월」로 묶어 준다 — 실적은 달로 세는 게 몸에 배어 있다. */
export function byMonth(rows: PublicRow[]): { month: string; rows: PublicRow[] }[] {
  const m = new Map<string, PublicRow[]>();
  for (const r of rows) {
    const d = r.deliveredAt || r.receivedAt;
    const k = d ? d.slice(0, 7) : '미정';
    (m.get(k) || m.set(k, []).get(k)!).push(r);
  }
  return [...m].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, rs]) => ({ month, rows: rs }));
}
