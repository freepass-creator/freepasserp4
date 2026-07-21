/**
 * 정산 엔진 — 돈·상태 누락 제로의 핵심(제작자 의도 최상위 비타협 니즈).
 * 계약 단계 체크 = 단일 writer → 완료 시 [계약완료 + 차량 출고불가 + 정산 원자생성], 거절 시 [계약취소 + 환수].
 * 수수료율은 partner.fee_rate·user.agent_payout_rate SSOT에서 해석(신차=공급사 우대 0%). 계약시점 동결.
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { getProgress } from '@/lib/domain/contract';

const REJECT_VALS = ['불가', '부결', '출고 불가'];
const isReject = (v: unknown) => typeof v === 'string' && REJECT_VALS.includes(v);

/** 수수료율 SSOT — 공급사율(partner.fee_rate, 기본 0.1) · 영업자지급율(user.agent_payout_rate, 기본 0.04). 신차=공급사 우대 0%. */
export async function resolveRates(contract: EntityRecord, product: EntityRecord | null): Promise<{ feeRate: number; payoutRate: number }> {
  const co = getCompanyId(); const store = getStore();
  const partners = await store.list('partner', co);
  const users = await store.list('user', co);
  const partner = partners.find((p) => String(p.partner_code) === String(contract.provider_company_code));
  const user = users.find((u) => String(u.user_code) === String(contract.agent_code));
  let feeRate = partner && partner.fee_rate != null ? Number(partner.fee_rate) : 0.1;
  const payoutRate = user && user.agent_payout_rate != null ? Number(user.agent_payout_rate) : 0.04;
  if (String(product?.product_type || '').startsWith('신차')) feeRate = 0; // 신차(렌트·구독) 파트너 우대(공급사 수수료 0)
  return { feeRate, payoutRate };
}

/** 정산 원자 생성(멱등 ST_{계약}). 율·금액 계약시점 동결. */
export async function createSettlement(contract: EntityRecord): Promise<string> {
  const co = getCompanyId(); const store = getStore();
  const code = `ST_${contract.contract_code}`;
  if (await store.get('settlement', co, code)) return code;
  const product = contract.product_code ? await store.get('product', co, String(contract.product_code)) : null;
  // 율 = 계약시점 동결 스냅샷 우선(핸드셰이크 중 율 변경 무관). 스냅샷 없는 레거시 계약만 live 해석.
  let feeRate: number, payoutRate: number;
  if (contract.fee_rate_snapshot != null && contract.payout_rate_snapshot != null) { feeRate = Number(contract.fee_rate_snapshot); payoutRate = Number(contract.payout_rate_snapshot); }
  else { const r = await resolveRates(contract, product); feeRate = r.feeRate; payoutRate = r.payoutRate; }
  const rent = Number(contract.rent_amount_snapshot) || 0;
  const fee = Math.round(rent * feeRate);
  const payout = Math.round(rent * payoutRate);
  await store.save('settlement', co, [{
    settlement_code: code, contract_code: contract.contract_code, car_number: contract.car_number_snapshot,
    customer_name: contract.customer_name, provider_company_code: contract.provider_company_code, partner_code: contract.provider_company_code,
    agent_code: contract.agent_code, agent_channel_code: contract.agent_channel_code,
    rent_amount: rent, fee_rate: feeRate, fee_amount: fee, agent_payout: payout, net_amount: fee - payout, clawback_amount: 0,
    settlement_status: '정산대기', contract_date: contract.contract_date,
    rent_month_snapshot: contract.rent_month_snapshot, sub_model_snapshot: contract.sub_model_snapshot,
  }]);
  return code;
}

/** 경과비례 환수 — 정산완료 건만, 잔여기간 비례(공급사수수료 기준). */
export function clawbackCalc(settlement: EntityRecord, terminatedAtMs?: number): number {
  if (settlement.settlement_status !== '정산완료') return 0;
  const months = Number(settlement.rent_month_snapshot) || 0;
  const start = settlement.contract_date ? Date.parse(String(settlement.contract_date)) : NaN;
  if (!months || isNaN(start)) return 0;
  const end = terminatedAtMs || Date.now();
  const refundRatio = Math.max(0, 1 - Math.min(1, Math.max(0, (end - start) / (1000 * 60 * 60 * 24 * 30)) / months));
  return Math.round((Number(settlement.fee_amount) || 0) * refundRatio);
}

/**
 * 계약 수동 취소 — 어느 단계든(진행중·완료 포함): 계약취소 + 재고 '출고가능' 복원 + (정산 있으면) 환수대기 전이.
 * reject 분기(applyStepCheck)는 1~2단계에서만 도달하므로, 후반 단계·완료 계약의 취소는 이 함수로만 가능(단일 취소 경로).
 */
export async function cancelContract(contract: EntityRecord): Promise<void> {
  const co = getCompanyId(); const store = getStore();
  const code = String(contract.contract_code);
  const fresh = (await store.get('contract', co, code)) || contract;
  if (fresh.contract_status === '계약취소') return;
  await store.update('contract', co, code, { contract_status: '계약취소' });
  // 재고 상태 = 이 계약 취소 후 재계산(다른 진행/완료 계약 있으면 출고불가 유지 — 단일 writer 보호). 무조건 출고가능 복원 금지.
  if (fresh.product_code) { const lock = await vehicleLockedStatus(String(fresh.product_code)); await store.update('product', co, String(fresh.product_code), { vehicle_status: lock || '출고가능' }); }
  await onContractCancel(fresh); // 정산 존재(완료건) → 환수대기+환수액. 없으면 no-op.
}

/** 계약취소 → 정산 환수대기 전이 + 환수액 기록. */
export async function onContractCancel(contract: EntityRecord): Promise<void> {
  const co = getCompanyId(); const store = getStore();
  const code = `ST_${contract.contract_code}`;
  const st = await store.get('settlement', co, code);
  if (!st) return;
  await store.update('settlement', co, code, { settlement_status: '환수대기', clawback_amount: clawbackCalc(st) });
}

/**
 * 차량 상태 엔진 잠금 판정 — 진행중(done>0)/완료 계약(취소 아님)이 있으면 '출고불가'로 잠금.
 * 재고 편집 등 페이지가 vehicle_status를 폼값으로 덮기 전 이 값이 있으면 그걸 우선(단일 writer 보호).
 */
export async function vehicleLockedStatus(productCode: string): Promise<string | null> {
  if (!productCode) return null;
  const co = getCompanyId(); const store = getStore();
  const cts = (await store.list('contract', co)).filter((c) => String(c.product_code) === String(productCode) && c.contract_status !== '계약취소');
  const locked = cts.some((c) => c.contract_status === '계약완료' || getProgress(c).done > 0);
  return locked ? '출고불가' : null;
}

/** 단일 writer — 단계 체크 기록 + 자동 전이 사슬. ContractPanel/계약페이지는 이것만 호출. */
export async function applyStepCheck(contract: EntityRecord, key: string, value: string): Promise<void> {
  const co = getCompanyId(); const store = getStore();
  const code = String(contract.contract_code);
  // 중복완료 가드(v3 이식) — 이 체크로 계약이 완료되는데 같은 차량에 이미 '계약완료'된 다른 계약이 있으면 이중판매 → 쓰기 전에 차단.
  if (!isReject(value) && contract.product_code) {
    const hypo = getProgress({ ...contract, [key]: value } as EntityRecord);
    if (hypo.done === hypo.total && contract.contract_status !== '계약완료') {
      const dup = (await store.list('contract', co)).find((c) => String(c.product_code) === String(contract.product_code) && String(c.contract_code) !== code && c.contract_status === '계약완료');
      if (dup) throw new Error(`이미 완료된 계약(${dup.contract_code})이 있는 차량입니다 — 이중판매 불가`);
    }
  }
  await store.update('contract', co, code, { [key]: value });
  const fresh = (await store.get('contract', co, code)) || ({ ...contract, [key]: value } as EntityRecord);

  if (isReject(value)) {
    if (fresh.contract_status !== '계약취소') await store.update('contract', co, code, { contract_status: '계약취소' });
    // 재고 = 재계산(다른 진행/완료 계약 있으면 출고불가 유지). 무조건 출고가능 금지 — cancelContract와 동일 규칙.
    if (fresh.product_code) { const lock = await vehicleLockedStatus(String(fresh.product_code)); await store.update('product', co, String(fresh.product_code), { vehicle_status: lock || '출고가능' }); }
    await onContractCancel(fresh);
    return;
  }
  const pr = getProgress(fresh);
  if (pr.done === pr.total && fresh.contract_status !== '계약완료') {
    await store.update('contract', co, code, { contract_status: '계약완료' });
    if (fresh.product_code) await store.update('product', co, String(fresh.product_code), { vehicle_status: '출고불가' });
    await createSettlement(fresh);
  } else if (fresh.product_code && pr.done > 0 && fresh.contract_status !== '계약완료' && fresh.contract_status !== '계약취소') {
    // 계약 진행 시작(계약문의 단계 넘어감) = 계약중 → 재고 자동 출고불가(중복판매 방지). 계약취소 시 출고가능 복귀(위 isReject 분기).
    const p = await store.get('product', co, String(fresh.product_code));
    if (p && p.vehicle_status !== '출고불가') await store.update('product', co, String(fresh.product_code), { vehicle_status: '출고불가' });
  }
}
