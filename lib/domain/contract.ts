/**
 * 계약 도메인 — 순수함수. 5단계 2자 핸드셰이크(freepasserp3 contract-steps.js 이식) + 정산 2단.
 */
import type { EntityRecord } from '@/lib/intake/entities';

/* ── 5단계 2자 핸드셰이크 (영업자↔공급사) ── */
export type StepCheck = { actor: 'agent' | 'provider'; key: string; label: string; choices?: string[] };
export type Step = { id: string; label: string; checks: StepCheck[] };
export const STEPS: Step[] = [
  { id: 'inquiry', label: '출고문의', checks: [
    { actor: 'agent', key: 'agent_delivery_inquiry', label: '출고문의' },
    { actor: 'provider', key: 'provider_delivery_response', label: '출고응답', choices: ['출고 가능', '출고 협의', '출고 불가'] }] },
  { id: 'docs', label: '서류', checks: [
    { actor: 'agent', key: 'agent_docs_submitted', label: '서류제출' },
    { actor: 'provider', key: 'provider_docs_review', label: '서류확인', choices: ['승인', '부결'] }] },
  { id: 'payment', label: '입금', checks: [
    { actor: 'agent', key: 'agent_balance_paid', label: '계약금입금' },
    { actor: 'provider', key: 'provider_agreement_sent', label: '약정발송' }] },
  { id: 'agreement', label: '약정', checks: [
    { actor: 'agent', key: 'provider_agreement_done', label: '약정작성완료' }, // key명은 레거시(provider)지만 actor=agent
    { actor: 'provider', key: 'provider_balance_confirmed', label: '잔금확인' }] },
  { id: 'release', label: '출고', checks: [
    { actor: 'agent', key: 'agent_handover_confirmed', label: '인도확인' },
    { actor: 'provider', key: 'provider_release_completed', label: '출고완료' }] },
];

const DONE = ['가능', '승인', '출고 가능', '출고 협의'];
const REJECT = ['불가', '부결', '출고 불가'];
function isDone(v: unknown): boolean { if (v === true || v === 'yes') return true; return typeof v === 'string' && DONE.includes(v); }
function isRejected(v: unknown): boolean { return typeof v === 'string' && REJECT.includes(v); }

/** 단계 진행률 N/5 (단계 내 모든 체크 done & rejected 없음 = 단계 완료) */
export function getProgress(c: EntityRecord): { done: number; total: number } {
  let done = 0;
  for (const s of STEPS) {
    const subs = s.checks.map((ch) => ({ done: isDone(c[ch.key]), rejected: isRejected(c[ch.key]) }));
    if (!subs.some((x) => x.rejected) && subs.every((x) => x.done)) done++;
  }
  return { done, total: STEPS.length };
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
