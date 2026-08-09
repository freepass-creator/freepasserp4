/**
 * 계약 도메인 — 순수함수. 5단계 2자 핸드셰이크(freepasserp3 contract-steps.js 이식) + 정산 2단.
 */
import type { EntityRecord } from '@/lib/intake/entities';

/* ── 5단계 2자 핸드셰이크 (영업자↔공급사) ── */
export type StepCheck = { actor: 'agent' | 'provider'; key: string; label: string; choices?: string[] };
export type Step = { id: string; label: string; checks: StepCheck[] };
/** 순서 = 출고문의 → 서류 → 약정(기간·금액 동결) → 입금 → 출고. 금액은 약정에서 굳힌다. */
export const STEPS: Step[] = [
  { id: 'inquiry', label: '출고문의', checks: [
    { actor: 'agent', key: 'agent_delivery_inquiry', label: '출고문의' },
    { actor: 'provider', key: 'provider_delivery_response', label: '출고응답', choices: ['출고 가능', '출고 협의', '출고 불가'] }] },
  { id: 'docs', label: '서류', checks: [
    { actor: 'agent', key: 'agent_docs_submitted', label: '서류제출' },
    { actor: 'provider', key: 'provider_docs_review', label: '서류확인', choices: ['승인', '부결'] }] },
  { id: 'agreement', label: '약정', checks: [
    { actor: 'agent', key: 'provider_agreement_done', label: '약정작성완료' }, // 기간·금액 동결 + 손님 연락처 후 계약서(key명은 레거시 provider지만 actor=agent)
    { actor: 'provider', key: 'provider_agreement_sent', label: '약정발송' }] },
  { id: 'payment', label: '입금', checks: [
    { actor: 'agent', key: 'agent_balance_paid', label: '계약금 입금' },
    { actor: 'agent', key: 'agent_final_paid', label: '잔금 입금' },
    { actor: 'provider', key: 'provider_balance_confirmed', label: '입금 확인' }] },
  { id: 'release', label: '출고', checks: [
    { actor: 'agent', key: 'agent_handover_confirmed', label: '인도확인' },
    { actor: 'provider', key: 'provider_release_completed', label: '출고완료' }] },
];

const DONE = ['가능', '승인', '출고 가능', '출고 협의'];
const REJECT = ['불가', '부결', '출고 불가'];
/** 체크값 완료 판정 SSOT — UI·목록·패널 공통. 로컬 DONE_VALS 복붙 금지. */
export function isDone(v: unknown): boolean { if (v === true || v === 'yes') return true; return typeof v === 'string' && DONE.includes(v); }
/** 거부 판정 SSOT — '출고 불가'·'부결'. 화면에서 완료와 같은 색으로 칠하지 않기 위해 필요하다. */
export function isRejected(v: unknown): boolean { return typeof v === 'string' && REJECT.includes(v); }

/** 스텝키 → 담당 actor(엔진 인가 강제용 SSOT). 비스텝 필드면 undefined.
 *  key 접두(provider_*)가 아니라 STEPS의 actor 를 본다 — provider_agreement_done 처럼 이름은 provider지만 actor=agent 인 예외를 정확히 반영. */
export function stepActorOf(key: string): 'agent' | 'provider' | undefined {
  for (const s of STEPS) for (const ch of s.checks) if (ch.key === key) return ch.actor;
  return undefined;
}

/** 계약금 입금·입금확인 — 선점 락(먼저 누른 계약이 차량 계약중). */
export const DEPOSIT_CLAIM_KEYS = ['agent_balance_paid', 'provider_balance_confirmed'] as const;
export function hasDepositClaim(c: EntityRecord): boolean {
  return DEPOSIT_CLAIM_KEYS.some((k) => isDone(c[k]));
}

/** 약정에서 굳힌 기간·월대여료가 있는지. 출고문의 셸은 비어 있다. */
export function hasTermFrozen(c: EntityRecord | null | undefined): boolean {
  if (!c) return false;
  const months = Number(c.rent_month_snapshot) || 0;
  const rent = Number(c.rent_amount_snapshot) || 0;
  return months > 0 && rent > 0;
}

/** 단계 진행률 N/5 (단계 내 모든 체크 done & rejected 없음 = 단계 완료) */
export function getProgress(c: EntityRecord): { done: number; total: number } {
  let done = 0;
  for (const s of STEPS) {
    const subs = s.checks.map((ch) => ({ done: isDone(c[ch.key]), rejected: isRejected(c[ch.key]) }));
    if (!subs.some((x) => x.rejected) && subs.every((x) => x.done)) done++;
  }
  return { done, total: STEPS.length };
}

/** 저장 상태 비교 전 공백만 정리한다. 레거시 `계약철회`는 사업 결정 전 임의로 취소 변환하지 않는다. */
export function normalizeContractStatus(raw: unknown): string {
  return String(raw ?? '').trim();
}

export function isContractCancelled(c: EntityRecord | null | undefined): boolean {
  return !!c && normalizeContractStatus(c.contract_status) === '계약취소';
}

export function isContractCompleted(c: EntityRecord | null | undefined): boolean {
  return !!c && normalizeContractStatus(c.contract_status) === '계약완료';
}

/**
 * 아직 «살아 있는» 계약인가 — 그 차를 잡고 있어 재판매·시트반영을 막아야 하는가.
 *
 * 중복정리(product-duplicate-migration)와 시트 충돌리포트가 각자 같은 판정을 들고 있었다.
 * 결과는 같았지만(실측 2026-08-09: 영문 상태 0건 · status='deleted' 0건) 목록이 서로 달라
 * 한쪽만 늘리면 «한 화면은 막고 다른 화면은 푸는» 상태가 된다. 넓게 잡던 쪽으로 모은다.
 *
 * ★`계약철회`는 여기서 «살아 있음»으로 남는다 — 취소로 볼지는 사업 결정 전이라 임의로 바꾸지
 *   않는다(normalizeContractStatus 와 같은 이유). 실데이터 5건이 그 상태다.
 */
export function isOpenContractRow(row: EntityRecord): boolean {
  if (row._deleted === true || row.deletedAt || normalizeContractStatus(row.status) === 'deleted') return false;
  const status = normalizeContractStatus(row.contract_status ?? row.status).toLowerCase();
  return !['계약완료', '완료', '계약취소', '취소', 'completed', 'complete', 'cancelled', 'canceled'].includes(status);
}

/**
 * 목록 분류 SSOT
 *   문의 = 단순 채팅(활성 계약 없음·취소만)
 *   계약 = 채팅에서 계약진행으로 넘어간 활성 계약(완료·취소 제외)
 */
export function isInquiryOnly(c: EntityRecord | null | undefined): boolean {
  if (!c || c._deleted === true) return true;
  const st = normalizeContractStatus(c.contract_status);
  // 계약 레코드가 있는데 상태가 비어 있으면 단순 문의가 아니라 데이터 확인 대상이다.
  return st === '계약취소';
}
export function isContractInProgress(c: EntityRecord | null | undefined): boolean {
  if (!c || c._deleted === true) return false;
  const st = normalizeContractStatus(c.contract_status);
  return !!st && st !== '계약완료' && st !== '계약취소';
}

/** 5/5 체크는 저장됐지만 정산·계약완료 전이가 남은 복구 대상인지 판정한다. */
export function needsContractFinalization(c: EntityRecord | null | undefined): boolean {
  if (!c || isContractCancelled(c)) return false;
  const allDone = STEPS.every((step) => step.checks.every((check) => isDone(c[check.key])));
  return allDone && normalizeContractStatus(c.contract_status) !== '계약완료';
}

/** 딜 진행 표시 — 문의·계약 목록 공통. 계약 없으면 문의, 있으면 현재 단계/완료/취소. */
export function contractStage(c: EntityRecord | null | undefined): { label: string; tone: 'gray' | 'blue' | 'amber' | 'green' | 'red' } {
  if (!c) return { label: '문의', tone: 'gray' };
  const st = normalizeContractStatus(c.contract_status);
  if (!st) return { label: '상태 확인', tone: 'red' };
  if (st === '계약취소') return { label: '계약취소', tone: 'red' };
  // 운영 이관 건의 의미·차량 복원 여부가 미결이다. 엔진과 다르게 취소로 간주하지 않고 경고한다.
  if (st === '계약철회') return { label: '계약철회', tone: 'red' };
  // 새 엔진은 계약요청→완료/취소만 쓴다. 대기·발송 등 레거시 저장상태를
  // 정상 단계처럼 보이면 필터의 '확인 필요'와 행 뱃지가 다시 어긋난다.
  if (st !== '계약요청' && st !== '계약완료') return { label: '상태 확인', tone: 'red' };
  // 상세 패널은 거부를 빨강으로 보여 준다. 목록도 같은 의미여야 하므로
  // 첫 미완료 단계를 파랑/주황 "진행"으로 오인시키지 않는다.
  for (const step of STEPS) {
    const rejected = step.checks.find((check) => isRejected(c[check.key]));
    if (!rejected) continue;
    const value = String(c[rejected.key] || '').trim();
    const label = value === '부결'
      ? `${step.label} 부결`
      : value === '불가' && step.id === 'inquiry'
        ? '출고 불가'
        : value || `${step.label} 거부`;
    return { label, tone: 'red' };
  }
  if (st === '계약완료') return { label: '계약완료', tone: 'green' };
  const doneArr = STEPS.map((s) => s.checks.every((ch) => isDone(c[ch.key])));
  const idx = doneArr.findIndex((d) => !d);
  // 체크는 끝났지만 정산/상태 전이가 실패한 경우. 상세의 재시도 경고와 같은 의미를 쓴다.
  if (idx === -1) return { label: '완료 처리 대기', tone: 'amber' };
  const done = doneArr.filter(Boolean).length;
  return { label: `${STEPS[idx].label} 진행`, tone: done === 0 ? 'blue' : 'amber' };
}

/* ── 계약상태 ── */
export const CONTRACT_STATES = ['계약요청', '계약대기', '계약발송', '계약완료', '계약취소'] as const;
export function contractTone(s: string): 'blue' | 'amber' | 'green' | 'red' | 'gray' {
  return ({ 계약요청: 'blue', 계약대기: 'amber', 계약발송: 'amber', 계약완료: 'green', 계약취소: 'red', 계약철회: 'red' } as Record<string, 'blue' | 'amber' | 'green' | 'red' | 'gray'>)[normalizeContractStatus(s)] || 'gray';
}

/* ── 정산 2단: 공급사 → 프리패스 → 영업자 ──
 * 금액 계산은 settlement-engine.createSettlement 단일 구현.
 * (여기 있던 settlementCalc 은 임포터 0인 두 번째 구현이었다 — 돈 계산이 두 벌이면
 *  나중에 요율 로직을 고칠 때 안 쓰이는 쪽을 고칠 위험이 있어 제거. 2026-07-21)
 */

/**
 * **테스트 계약** — 실계약과 한 목록에 살면서도 섞이지 않아야 한다.
 * 발송·서명 흐름을 눌러 보려면 계약이 하나 필요한데, 그걸 실계약 사이에 두면
 * 어느 것이 진짜인지 흐려지고, 실계약을 지워 자리를 비우면 정산·문의가 참조하던
 * 것이 사라진다. 그래서 «지우지 않고 표식으로 가른다».
 *
 * 이 함수 하나만 본다 — 목록·정산·발송이 각자 판정하면 어딘가에서 테스트 건이
 * 진짜처럼 새어 나간다.
 */
export function isTestContract(contract: EntityRecord): boolean {
  return contract.is_test === true || String(contract.is_test) === 'true';
}
