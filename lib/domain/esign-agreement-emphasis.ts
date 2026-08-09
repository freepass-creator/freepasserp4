/**
 * 약관 **중요 조문 강조** — 손님이 나중에 「못 봤는데요」 하는 곳(2026-08-09 사장님 지정).
 *
 * ★왜 별도 파일인가
 *   `esign-agreement-text.ts` 는 erp3 템플릿에서 **추출해 생성**하는 파일이라, 다시 뽑으면 덮인다.
 *   강조 지정은 사람이 정하는 판단이므로 생성물과 섞지 않는다.
 *
 * ★무엇을 고르나
 *   약관 8,856자를 다 기억할 손님은 없다. 분쟁이 나는 조문은 정해져 있다 —
 *   **돈을 더 내야 하거나 · 차를 뺏기거나 · 계약이 끊기거나 · 보험이 안 되는** 조문이다.
 *   그 넷에 해당하면 강조하고, 아니면 강조하지 않는다. 다 강조하면 아무것도 강조되지 않는다.
 *
 * ★어떻게 쓰나
 *   ① 약관 화면에서 그 조문을 굵게·강조 배경으로 그린다.
 *   ② 통독이 끝난 뒤 **요약 한 줄씩** 다시 보여주고 동의를 받는다.
 *   「강조했다」가 분쟁 때 설명의무를 다한 증거가 된다.
 */
import { AGREEMENT_SECTIONS } from '@/lib/domain/esign-agreement-text';

/**
 * 왜 중요한가 — **세 갈래**(2026-08-09 사장님 지정: 미납·운전자·사고발생).
 *
 * 분쟁이 실제로 나는 곳이 이 셋이다. 손님이 「못 봤는데요」 하는 것도 여기다.
 *   · 미납   — 돈이 밀리면 시동이 꺼지고 차를 뺏긴다
 *   · 운전자 — 범위를 벗어난 사람이 몰면 보험이 안 된다
 *   · 사고   — 사고 나면 얼마를 내가 무는가
 *
 * 이 셋에 안 걸리면 강조하지 않는다. 색·아이콘도 갈래별로 달리 준다.
 */
export type RiskKind = '미납' | '운전자' | '사고';

export type KeyClause = { clause: string; risk: RiskKind; summary: string };

export const RISK_LABEL: Record<RiskKind, string> = {
  미납: '돈이 밀리면',
  운전자: '누가 모느냐에 따라',
  사고: '사고가 나면',
};

/**
 * 조문 번호는 **긴 것부터** 맞춰야 한다 — `제9조의2` 가 `제9조` 에 먼저 걸리면 안 된다.
 * `keyClauseOf` 가 정렬해서 찾는다.
 */
/**
 * ⚠ **늘리지 말 것.** 22개조 중 10개(45%)다. 절반을 넘으면 강조가 강조가 아니게 된다.
 *   하나 넣고 싶으면 하나 빼라. `sim-esign-agreement` 가 절반 넘으면 막는다.
 *
 * 뺀 것과 이유 —
 *   제3조(대여료 지급)  → 연체 결과는 제11조가 더 세게 말한다. 둘 다 강조하면 겹친다.
 *   제4조(보증금 정산)  → 섹션 「결제·연체」에서 숫자로 이미 확인받는다.
 *   제6조(반납 원상회복) → 반납형에만 걸리고, 제16조가 손해부담을 포괄한다.
 *   제18조(비용부담)    → 섹션 「사고·면책」의 면책금이 실제 다툼 지점이다.
 */
export const KEY_CLAUSES: KeyClause[] = [
  /* ── 운전자 ── */
  { clause: '제5조', risk: '운전자', summary: '정해진 운전자 범위를 벗어난 사람이 몰면 보험이 적용되지 않습니다.' },
  // 「남에게 넘기는 것」이 실제로 제일 크게 터진다(2026-08-09 사장님 지적).
  // 약관 제8조는 금지행위 12호짜리인데, 손님이 다 읽지 않는다. 그중 차를 잃는 셋만 요약에 세운다 —
  //   1호 제3자 양도·전대·담보제공·점유이전 / 7호 해외 반출·소재 불명 / 8호 압류·강제집행 대상화.
  { clause: '제8조', risk: '운전자', summary: '차를 제3자에게 넘기거나(양도·전대·담보제공) 해외로 반출하거나 압류 대상이 되게 하면 즉시 해지되고 형사 책임을 집니다. 음주·무면허·유상운송·재렌트도 금지입니다.' },
  /* ── 사고 ── */
  // ★현장이탈이 제일 크게 터진다(2026-08-09 사장님 지적) — 손님은 「나중에 접수하면 되겠지」 하고
  //   자리를 뜨는데, 그러면 **보험 처리 자체가 안 되어 수리비 전액을 문다.**
  //   면책금 이야기보다 이걸 앞에 세운다. 금액이 아니라 «되냐 안 되냐»의 문제다.
  { clause: '제9조', risk: '사고', summary: '사고가 나면 그 자리에서 경찰에 신고하고 보험사 현장출동을 받아야 합니다. 현장을 벗어나거나 접수하지 않으면 보험 처리가 되지 않아 수리비를 전액 부담합니다. 처리되는 경우에도 면책금은 손님 부담입니다.' },
  { clause: '제9조의2', risk: '사고', summary: '이 상품은 손님이 직접 보험에 가입하고 유지해야 합니다.' },
  { clause: '제16조', risk: '사고', summary: '차량이 멸실·도난·폐차되면 손님이 손해를 부담할 수 있습니다.' },
  /* ── 미납 ── */
  { clause: '제10조', risk: '미납', summary: 'GPS가 장착되며 연체·연락두절 시 시동이 제어될 수 있습니다.' },
  { clause: '제11조', risk: '미납', summary: '연체가 쌓이면 기한이익을 잃고 차량이 회수됩니다.' },
  { clause: '제14조', risk: '미납', summary: '중도 해지하면 잔여 대여료에 요율을 곱한 위약금을 냅니다.' },
];

/** 그 조문 제목이 중요 조문인가. 긴 번호부터 맞춘다(`제9조의2` 우선). */
export function keyClauseOf(title: string): KeyClause | null {
  const t = String(title ?? '').replace(/\s/g, '');
  const sorted = [...KEY_CLAUSES].sort((a, b) => b.clause.length - a.clause.length);
  return sorted.find((k) => t.startsWith(k.clause)) || null;
}

/** 약관 전문 + 강조 표시 — 착한거래가 이걸 그대로 그린다. */
export function agreementWithEmphasis(): {
  t: string; b: string; emphasis: boolean; risk?: RiskKind; summary?: string;
}[] {
  return AGREEMENT_SECTIONS.map((s) => {
    const key = keyClauseOf(s.t);
    return key
      ? { t: s.t, b: s.b, emphasis: true, risk: key.risk, summary: key.summary }
      : { t: s.t, b: s.b, emphasis: false };
  });
}

/**
 * 통독 뒤 다시 보여줄 요약 — **약관에 실제로 있는 조문만.**
 * 없는 조문을 요약에 넣으면 「약관에 없는 걸 동의받았다」가 된다.
 */
export function keyClauseSummaries(): KeyClause[] {
  return KEY_CLAUSES.filter((k) => AGREEMENT_SECTIONS.some((s) => s.t.replace(/\s/g, '').startsWith(k.clause)));
}

export const KEY_CLAUSE_CONFIRM_LABEL = '위 주요 사항을 읽고 이해했습니다';
