/**
 * 계약 도메인 — 순수함수. 5단계 2자 핸드셰이크(freepasserp3 contract-steps.js 이식) + 정산 2단.
 */
import type { EntityRecord } from '@/lib/intake/entities';

/* ── 5단계 2자 핸드셰이크 (영업자↔공급사) ── */
export type StepCheck = { actor: 'agent' | 'provider'; key: string; label: string; choices?: string[] };
export type Step = { id: string; label: string; checks: StepCheck[] };
export const STEPS: Step[] = [
  { id: 'inquiry', label: '계약문의', checks: [
    { actor: 'agent', key: 'agent_delivery_inquiry', label: '계약문의' },
    { actor: 'provider', key: 'provider_delivery_response', label: '출고응답', choices: ['출고 가능', '출고 협의', '출고 불가'] }] },
  { id: 'docs', label: '서류', checks: [
    { actor: 'agent', key: 'agent_docs_submitted', label: '서류제출' },
    { actor: 'provider', key: 'provider_docs_review', label: '서류확인', choices: ['승인', '부결'] }] },
  { id: 'payment', label: '입금', checks: [
    { actor: 'agent', key: 'agent_balance_paid', label: '계약금 입금' },
    { actor: 'agent', key: 'agent_final_paid', label: '잔금 입금' },
    { actor: 'provider', key: 'provider_balance_confirmed', label: '입금 확인' }] },
  { id: 'agreement', label: '약정', checks: [
    { actor: 'agent', key: 'provider_agreement_done', label: '약정작성완료' }, // 손님 연락처 확인 후 계약서 발송(key명은 레거시 provider지만 actor=agent)
    { actor: 'provider', key: 'provider_agreement_sent', label: '약정발송' }] },
  { id: 'release', label: '출고', checks: [
    { actor: 'agent', key: 'agent_handover_confirmed', label: '인도확인' },
    { actor: 'provider', key: 'provider_release_completed', label: '출고완료' }] },
];

const DONE = ['가능', '승인', '출고 가능', '출고 협의'];
const REJECT = ['불가', '부결', '출고 불가'];
/** 체크값 완료 판정 SSOT — UI·목록·패널 공통. 로컬 DONE_VALS 복붙 금지. */
export function isDone(v: unknown): boolean { if (v === true || v === 'yes') return true; return typeof v === 'string' && DONE.includes(v); }
function isRejected(v: unknown): boolean { return typeof v === 'string' && REJECT.includes(v); }

/** 계약금 입금·입금확인 — 선점 락(먼저 누른 계약이 차량 계약중). */
export const DEPOSIT_CLAIM_KEYS = ['agent_balance_paid', 'provider_balance_confirmed'] as const;
export function hasDepositClaim(c: EntityRecord): boolean {
  return DEPOSIT_CLAIM_KEYS.some((k) => isDone(c[k]));
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

/**
 * 목록 분류 SSOT
 *   문의 = 단순 채팅(활성 계약 없음·취소만)
 *   계약 = 채팅에서 계약진행으로 넘어간 활성 계약(완료·취소 제외)
 */
export function isInquiryOnly(c: EntityRecord | null | undefined): boolean {
  if (!c || c._deleted === true) return true;
  const st = String(c.contract_status || '');
  return !st || st === '계약취소';
}
export function isContractInProgress(c: EntityRecord | null | undefined): boolean {
  if (!c || c._deleted === true) return false;
  const st = String(c.contract_status || '');
  return !!st && st !== '계약완료' && st !== '계약취소';
}

/** 딜 진행 뱃지 — 문의 목록용. 계약 없으면 '상담', 있으면 현재 단계/완료/취소. */
export function contractStage(c: EntityRecord | null | undefined): { label: string; tone: 'gray' | 'blue' | 'amber' | 'green' | 'red' } {
  if (!c) return { label: '상담', tone: 'gray' };
  const st = String(c.contract_status || '');
  if (st === '계약취소') return { label: '취소', tone: 'red' };
  const doneArr = STEPS.map((s) => s.checks.every((ch) => isDone(c[ch.key])));
  const idx = doneArr.findIndex((d) => !d);
  if (idx === -1 || st === '계약완료') return { label: '계약완료', tone: 'green' };
  const done = doneArr.filter(Boolean).length;
  return { label: `${STEPS[idx].label} 진행`, tone: done === 0 ? 'blue' : 'amber' };
}

/* ── 계약상태 ── */
export const CONTRACT_STATES = ['계약요청', '계약대기', '계약발송', '계약완료', '계약취소'] as const;
export function contractTone(s: string): 'blue' | 'amber' | 'green' | 'red' | 'gray' {
  return ({ 계약요청: 'blue', 계약대기: 'amber', 계약발송: 'amber', 계약완료: 'green', 계약취소: 'red' } as Record<string, 'blue' | 'amber' | 'green' | 'red' | 'gray'>)[s] || 'gray';
}

/* ── 정산 2단: 공급사 → 프리패스 → 영업자 ── */
export function settlementCalc(rentAmount: number, supplierFeeRate: number, agentPayoutRate: number): { fee: number; payout: number; net: number } {
  const rent = Number(rentAmount) || 0;
  const fee = Math.round(rent * (Number(supplierFeeRate) || 0));      // R1 공급사→프리패스(수취)
  const payout = Math.round(rent * (Number(agentPayoutRate) || 0));   // R2 프리패스→영업자(지급)
  return { fee, payout, net: fee - payout };                          // 프리패스 순수익
}
