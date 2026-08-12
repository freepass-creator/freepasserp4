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
 * ⚠ **늘리지 말 것.** 전체 조문의 절반을 넘으면 강조가 강조가 아니게 된다.
 *   하나 넣고 싶으면 하나 빼라. `sim-esign-agreement` 가 절반 넘으면 막는다.
 *
 * 뺀 것과 이유 —
 *   제6조(대여료·보증금) → 섹션 「결제·연체」에서 숫자로 이미 확인받는다.
 *   제12조(차량 인도)    → 인수 화면과 차량인수증에서 별도로 확인한다.
 *   제21·22조(차량 반납) → 반납 단계에서 다시 확인한다.
 */
export const KEY_CLAUSES: KeyClause[] = [
  /* ── 운전자 ── */
  { clause: '제13조', risk: '운전자', summary: '등록된 운전자 범위를 벗어난 사람이 운전하면 보험·공제 처리가 제한될 수 있습니다.' },
  { clause: '제15조', risk: '운전자', summary: '차를 제3자에게 넘기거나 무단운전·유상운송·재대여에 사용하면 계약이 해지되고 차량이 회수될 수 있습니다.' },
  /* ── 사고 ── */
  { clause: '제11조', risk: '사고', summary: '보험 가입 주체·운전자 범위·보상한도·면책금은 계약서와 사고 당시 유효한 보험조건에 따릅니다.' },
  { clause: '제17조', risk: '사고', summary: '사고가 나면 안전조치 후 회사와 보험사에 즉시 알리고 현장 기록을 남겨야 합니다. 임의합의·자가수리·사고은폐는 보험 처리를 제한할 수 있습니다.' },
  { clause: '제19조', risk: '사고', summary: '수리비와 손해는 객관적 증빙과 실제 손해를 기준으로 정산하며, 휴차손해는 월 대여료의 1일 환산액 50%를 기준으로 합니다.' },
  /* ── 미납 ── */
  { clause: '제24조', risk: '미납', summary: '연체·미반환 기준을 넘으면 기록 통지 후 안전하게 정차된 차량에 한해 운행제한·차량회수 조치가 이루어질 수 있습니다.' },
  { clause: '제8조', risk: '미납', summary: '중도 해지하면 계약서에 정한 청구기준을 적용하며 잔여 대여료와 중도해지수수료를 중복 청구하지 않습니다.' },
];

/** 그 조문 제목이 중요 조문인가. */
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
