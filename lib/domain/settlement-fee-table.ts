/**
 * **수수료표 — 정본.** 시트 「수수료표」 탭은 이 파일의 «사본»이다.
 *
 * ★사장님 2026-09-01 「태윤이가 정리한걸 다른 ai나 사람도 쉽게 볼수 있게
 *   수수료표를 기존탭 구버전으로 해놓고 수수료표를 새로 만들어주면 돼… 관리하고 보기쉽게」
 *
 * ★★**내용은 박태윤 매니저가 정한 것이다.** 옛 시트의 「박태윤 입력」 구간(38~89행)을 그대로 옮겼다.
 *   ⚠ 옛 표는 **한 칸에 공급사 15곳**이 몰려 있고 아랫줄이 윗줄을 «상속»해서, 사람도 기계도 읽기 어려웠다.
 *     실측 2026-09-01 — 그 구조 탓에 `Number('48개월')`=NaN 으로 15줄이 「표에 없다」로 잘못 나왔다.
 *   ⇒ 여기서는 **한 줄 = 한 규칙**으로 편다. 공급사도 기간도 상속하지 않는다.
 *
 * ★★**셈법이 여섯이다.** 요율 하나로 다 담기지 않는다 —
 * ```
 * 차량가액       차량가액 × 율            선출고
 * 대여료×기간     대여료 × 기간 × 율        재렌트 · 구독
 * 정액          그 금액 그대로            12개월 60만원 · 오플구독 100만
 * 한달렌탈료      한 달 대여료(VAT포함)      스타 재렌트
 * 구독료+정액     12개월구독료 100% + 정액   손오공 구독
 * 범위          «최대» 몇 % — 상한이다     매칭출고
 * 조건분기       보증금 비율로 갈린다        퍼시픽 선출고
 * ```
 *   ★뒤의 넷은 **기계가 한 값으로 못 낸다.** 그건 「틀렸다」가 아니라 「사람이 정한다」이다.
 *     그래서 `auto` 로 «기계가 낼 수 있나»를 표시한다 — 검사가 그것을 보고 판정을 미룬다.
 */

/** 셈법 — 청구액이 무엇에서 나오나. */
export type FeeBasis =
  | '차량가액'      // 차량가액 × 율
  | '대여료×기간'   // 대여료 × 계약기간 × 율
  | '정액'         // 그 금액 그대로
  | '한달렌탈료'    // 한 달 대여료(VAT 포함)
  | '구독료+정액'   // 12개월 구독료 100% + 정액
  | '범위'         // 「최대 N%」 — 상한
  | '조건분기';     // 보증금 비율 등으로 갈린다

export type FeeRule = {
  /** 공급사 — 한 줄에 «하나»만. 몰아 적지 않는다. */
  supplier: string;
  /** 신차 · 재렌트 · 구독 · 전기차 */
  kind: '신차' | '재렌트' | '구독' | '전기차';
  /** 선출고 · 매칭출고 · 인수형 · 인수,반납형 — 없으면 빈칸 */
  form: string;
  /** 계약기간(개월). 0 = 기간 무관 */
  term: number;
  basis: FeeBasis;
  /** 공급사에서 «받을» 것 — 숫자면 율(0.035) 또는 정액(600000), 글이면 사람이 정한다 */
  claim: number | string;
  /** 영업채널에 «줄» 것 */
  pay: number | string;
  /** 언제 청구·지급하나 */
  when: string;
  /** 기계가 한 값으로 낼 수 있나. false 면 검사가 판정을 «미룬다» */
  auto: boolean;
  note?: string;
};

const WHEN = '보증금·대여료 회차 완납';
/** 표준 재렌트 사다리 — 12개월만 정액이고 나머지는 기간이 길수록 율이 낮다. */
const LADDER: { term: number; c: number | string; p: number | string; basis: FeeBasis }[] = [
  { term: 12, c: 600_000, p: 500_000, basis: '정액' },
  { term: 24, c: 0.0475, p: 0.04, basis: '대여료×기간' },
  { term: 36, c: 0.0375, p: 0.03, basis: '대여료×기간' },
  { term: 48, c: 0.0325, p: 0.025, basis: '대여료×기간' },
  { term: 60, c: 0.0225, p: 0.0175, basis: '대여료×기간' },
];
const ladder = (supplier: string, kind: FeeRule['kind'], when = WHEN, note?: string): FeeRule[] =>
  LADDER.map((x) => ({ supplier, kind, form: '', term: x.term, basis: x.basis, claim: x.c, pay: x.p, when, auto: true, note }));

/** 표준 신차 — 선출고 3.5%/3.0% · 매칭출고 최대 9%. */
const newCar = (supplier: string, sr = 0.035, ar = 0.03, when = WHEN, note?: string): FeeRule[] => [
  { supplier, kind: '신차', form: '선출고', term: 0, basis: '차량가액', claim: sr, pay: ar, when, auto: true, note },
  { supplier, kind: '신차', form: '매칭출고', term: 0, basis: '범위', claim: '최대 9%', pay: '최대 9%', when, auto: false, note: '영업자 조율 — 사람이 넣는다' },
];

/** 표준 15곳 — 옛 표에서 한 칸에 몰려 있던 공급사들. */
const STANDARD = ['웰릭스', '이안카', '경진카', '경진렌트카', '에이스', '우리캐피탈렌터카', '에코렌터카',
  'SA', '센트로', '연카', '빌린카(LC)', 'KH', 'J&J', '리더스', '렌트존'];

export const FEE_RULES: FeeRule[] = [
  // ── 손오공 ──────────────────────────────────────────────
  ...newCar('손오공', 0.035, 0.03, WHEN, '보증금 회차별 지급 가능'),
  ...ladder('손오공', '재렌트', WHEN, '보증금 회차별 지급 가능'),
  { supplier: '손오공', kind: '구독', form: '인수,반납형', term: 12, basis: '구독료+정액', claim: '12개월구독료 100% + 10만', pay: '12개월구독료 100%', when: WHEN, auto: false },
  { supplier: '손오공', kind: '구독', form: '인수형', term: 24, basis: '구독료+정액', claim: '12개월구독료 100% + 30만', pay: '12개월구독료 100%', when: WHEN, auto: false },
  { supplier: '손오공', kind: '구독', form: '인수형', term: 36, basis: '구독료+정액', claim: '12개월구독료 100% + 50만', pay: '12개월구독료 100%', when: WHEN, auto: false },
  { supplier: '손오공', kind: '구독', form: '인수형', term: 48, basis: '구독료+정액', claim: '12개월구독료 100% + 70만', pay: '12개월구독료 100%', when: WHEN, auto: false },
  { supplier: '손오공', kind: '구독', form: '인수형', term: 60, basis: '구독료+정액', claim: '12개월구독료 100% + 70만', pay: '12개월구독료 100%', when: WHEN, auto: false },

  // ── 표준 15곳 ───────────────────────────────────────────
  ...STANDARD.flatMap((s) => [...newCar(s, 0.035, 0.03, WHEN, '보증금 회차별 지급 가능'), ...ladder(s, '재렌트', WHEN, '보증금 회차별 지급 가능')]),

  // ── 스타 ────────────────────────────────────────────────
  ...newCar('스타', 0.035, 0.03, WHEN, '완납시만 정산'),
  { supplier: '스타', kind: '재렌트', form: '', term: 0, basis: '한달렌탈료', claim: '한 달 렌탈료(VAT 포함)', pay: '한 달 렌탈료 × 80%(VAT 포함)', when: WHEN, auto: false, note: '완납시만 정산' },

  // ── 오토플러스 ──────────────────────────────────────────
  { supplier: '오토플러스', kind: '구독', form: '', term: 0, basis: '정액', claim: 1_000_000, pay: 800_000, when: WHEN, auto: true, note: '3개월 유지 조건 — 환수 있음' },

  // ── 스위치 ──────────────────────────────────────────────
  ...ladder('스위치', '구독', WHEN, '보증금 회차별 지급 가능'),

  // ── 아이카 ──────────────────────────────────────────────
  ...newCar('아이카', 0.035, 0.03, WHEN, '완납시만 정산'),
  { supplier: '아이카', kind: '재렌트', form: '', term: 1, basis: '범위', claim: '10% (연장 8%)', pay: '10% (연장 8%)', when: WHEN, auto: false, note: '완납시만 정산' },
  { supplier: '아이카', kind: '재렌트', form: '', term: 6, basis: '정액', claim: 400_000, pay: 300_000, when: WHEN, auto: true, note: '완납시만 정산' },
  ...ladder('아이카', '재렌트', WHEN, '완납시만 정산'),
  { supplier: '아이카', kind: '전기차', form: '', term: 0, basis: '정액', claim: 1_000_000, pay: 800_000, when: WHEN, auto: true, note: '완납시만 정산' },

  // ── 아이언 ──────────────────────────────────────────────
  ...newCar('아이언', 0.04, 0.03, WHEN, '보증금 회차별 지급 가능'),
  ...ladder('아이언', '재렌트', WHEN, '보증금 회차별 지급 가능'),

  // ── 퍼시픽 ─ ★보증금 비율로 갈린다 ──────────────────────
  { supplier: '퍼시픽', kind: '신차', form: '선출고', term: 0, basis: '조건분기', claim: '보증금 5% → 3% · 10% → 4% (VAT 포함)', pay: '보증금 5% → 2.5% · 10% → 3% (VAT 포함)', when: WHEN, auto: false, note: '보증금 회차별 지급 가능' },
  { supplier: '퍼시픽', kind: '신차', form: '매칭출고', term: 0, basis: '조건분기', claim: '보증금 5% → 3% · 10% → 3.3% (VAT 포함)', pay: '보증금 5% → 3% · 10% → 3.3% (VAT 포함)', when: WHEN, auto: false },
  ...ladder('퍼시픽', '재렌트', WHEN, '보증금 회차별 지급 가능'),
];

/**
 * **청구·지급 시점** — 요율과 «따로» 도는 규칙이다.
 * ★스타·아이카만 선지급이 없다. 그 둘은 분납이 다 들어와야 청구·지급하고, 부러지면 지급이 아예 없다.
 */
export const FEE_TIMING: { who: string; case: string; how: string; broken: string }[] = [
  { who: '스타 · 아이카', case: '분납건', how: '선지급 없음 — 분납이 다 들어와야 청구·지급', broken: '부러지면 수수료 지급 없음(전액)' },
  { who: '그 밖 공급사', case: '분납건', how: '선납 — 인도되면 바로 전액 청구·지급', broken: '부러지면 받은 회차만큼 (2회분납 1회차만 받으면 50%)' },
  { who: '모두', case: '일시납', how: '선납 — 인도되면 바로 전액', broken: '나눌 회차가 없다' },
  { who: '모두', case: '보증금 분납', how: '1회차는 인도 때 낸다 · k회차 = 인도일 + (k−1)개월', broken: '완료 판정은 인도일 + 회차개월(한 달 여유)' },
];

const HEAD = (s: string) => s.replace(/\s|주식회사|㈜|렌터카|렌트카|모빌리티|\(.*\)/g, '');
/**
 * **같은 회사를 다르게 부르는 것** — 원장은 줄여 적고 표는 다른 말을 쓴다.
 * ★원자 사전에도 같은 메모가 있다(「판매시트 「SA」 = 에스에이」).
 * ⚠ 확실한 것만 적는다. 모르면 안 적는 게 낫다 — 잘못 붙이면 «남의 요율»로 청구한다.
 */
/**
 * **원장이 부르는 이름 ↔ 표가 부르는 이름.**
 * ★「엘씨렌트」는 표의 「빌린카(LC)」와 «같은 회사»다 — LC = 엘씨.
 *   2026-09-02 까지 둘을 따로 세서 둘 다 「표에 없다」로 섬다.
 */
const ALIAS: Record<string, string> = { 에스에이: 'SA', SA: '에스에이', 스타스카이: '스타', 스타: '스타스카이', 엘씨렌트: '빌린카', 빌린카: '엘씨렌트' };

/**
 * 그 계약에 맞는 규칙을 찾는다. **이름은 앞머리로 맞춘다** — 원장은 줄여 적고 표는 정식 상호다.
 * ★찾는 차례 ① 공급사+형태+기간 ② 기간무관 ③ 형태 무시 ④ **전기차 특약이 없으면 일반 갈래로 내려간다**
 *   ⚠ 2026-09-01 — 「모델Y」를 전기차로 읽었는데 아이언에는 전기차 특약이 없어 통째로 «표에 없다»가 됐다.
 *     특약이 없으면 «없는 것»이 아니라 «일반 규칙»이다.
 */
export function feeRuleFor(supplier: string, kind: FeeRule['kind'], term: number, form?: string, fallbackKind?: FeeRule['kind']): FeeRule | undefined {
  const s = HEAD(supplier);
  if (!s) return undefined;
  const names = [s, ALIAS[supplier] ? HEAD(ALIAS[supplier]) : ''].filter(Boolean);
  const mine = FEE_RULES.filter((r) => { const t = HEAD(r.supplier); return t && names.some((n) => n.startsWith(t) || t.startsWith(n)); });
  if (!mine.length) return undefined;
  const pick = (k: FeeRule['kind']) => {
    const byForm = form ? mine.filter((r) => r.form === form) : mine;
    return byForm.find((r) => r.kind === k && r.term === term)
      || byForm.find((r) => r.kind === k && r.term === 0)
      || mine.find((r) => r.kind === k && r.term === term)
      || mine.find((r) => r.kind === k && r.term === 0);
  };
  return pick(kind) || (fallbackKind ? pick(fallbackKind) : undefined);
}
