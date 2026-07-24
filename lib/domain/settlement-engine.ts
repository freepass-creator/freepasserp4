/**
 * 정산 엔진 — 돈·상태 누락 제로의 핵심(제작자 의도 최상위 비타협 니즈).
 * 계약 단계 체크 = 단일 writer → 완료 시 [계약완료 + 차량 출고불가 + 정산 원자생성], 거절 시 [계약취소 + 환수].
 * 차량: 계약금 입금(확인) 선점 → 계약중 · 완료 → 출고불가. 문의·서류만으로는 잠금 없음.
 * 수수료율은 partner.fee_rate·user.agent_payout_rate SSOT에서 해석(신차=공급사 우대 0%). 계약시점 동결.
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { currentActor } from '@/lib/session';
import { type EntityRecord } from '@/lib/intake/entities';
import { getProgress, hasDepositClaim, DEPOSIT_CLAIM_KEYS, isDone, stepActorOf } from '@/lib/domain/contract';
import { readPartnerPrivate, readUserPrivate } from '@/lib/domain/private-fields';

const REJECT_VALS = ['불가', '부결', '출고 불가'];
const isReject = (v: unknown) => typeof v === 'string' && REJECT_VALS.includes(v);

/** 수수료율 SSOT — 공급사율(partner.fee_rate, 기본 0.1) · 영업자지급율(user.agent_payout_rate, 기본 0.04). 신차=공급사 우대 0%. */
export async function resolveRates(contract: EntityRecord, product: EntityRecord | null): Promise<{ feeRate: number; payoutRate: number }> {
  const co = getCompanyId(); const store = getStore();
  const partners = await store.list('partner', co);
  const users = await store.list('user', co);
  const partner = partners.find((p) => String(p.partner_code) === String(contract.provider_company_code));
  const user = users.find((u) => String(u.user_code) === String(contract.agent_code));
  // 상업기밀·PII 분리(_private) 대응 — private 우선, 없으면 본노드 폴백(미마이그레이션·권한없음·no-db 모두 기존값).
  //  ★율 계산 수학·신차 특례·반올림·반환형 전부 불변. private 가 null 이면 아래 식은 기존과 완전 동치.
  const pp = await readPartnerPrivate(String(partner?.partner_code ?? contract.provider_company_code ?? ''));
  const up = await readUserPrivate(String(user?.uid ?? user?.user_code ?? contract.agent_code ?? ''));
  const rawFee = pp?.fee_rate ?? partner?.fee_rate;
  const rawPayout = up?.agent_payout_rate ?? user?.agent_payout_rate;
  let feeRate = rawFee != null ? Number(rawFee) : 0.1;
  const payoutRate = rawPayout != null ? Number(rawPayout) : 0.04;
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
 * 계약 수동 취소 — 어느 단계든(진행중·완료 포함): 계약취소 + 재고 복원 + (정산 있으면) 환수대기 전이.
 * reject 분기(applyStepCheck)는 1~2단계에서만 도달하므로, 후반 단계·완료 계약의 취소는 이 함수로만 가능(단일 취소 경로).
 */
export async function cancelContract(contract: EntityRecord): Promise<void> {
  const co = getCompanyId(); const store = getStore();
  const code = String(contract.contract_code);
  const fresh = (await store.get('contract', co, code)) || contract;
  if (fresh.contract_status === '계약취소') return;
  await store.update('contract', co, code, { contract_status: '계약취소' });
  // 재고 = 이 계약 취소 후 재계산(다른 계약중/완료 있으면 유지). 무조건 출고가능 복원 금지.
  if (fresh.product_code) await syncVehicleLock(String(fresh.product_code), code);
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
 * 차량 상태 엔진 잠금 — 완료=출고불가 · 계약금 입금(확인) 선점=계약중.
 * 문의·서류만 진행 중이면 잠금 없음(여러 영업 병행 가능, 입금 선점이 이김).
 * byContract = 락을 쥔 계약코드. 상품의 locked_by_contract 와 대조해 "내 락 vs 남의 락"을 구분한다(자기잠금 데드락 방지).
 * opts.contracts = 이미 조회한 계약목록(applyStepCheck가 1회 list 공유). 없으면 store.list.
 */
export async function vehicleLockedBy(
  productCode: string,
  opts?: { contracts?: EntityRecord[] },
): Promise<{ status: '출고불가' | '계약중' | null; byContract: string }> {
  if (!productCode) return { status: null, byContract: '' };
  const co = getCompanyId(); const store = getStore();
  const all = opts?.contracts ?? await store.list('contract', co);
  const cts = all.filter((c) => String(c.product_code) === String(productCode) && c.contract_status !== '계약취소');
  const done = cts.find((c) => c.contract_status === '계약완료');
  if (done) return { status: '출고불가', byContract: String(done.contract_code) };
  const claim = cts.find((c) => hasDepositClaim(c));
  if (claim) return { status: '계약중', byContract: String(claim.contract_code) };
  return { status: null, byContract: '' };
}
export async function vehicleLockedStatus(productCode: string): Promise<'출고불가' | '계약중' | null> {
  return (await vehicleLockedBy(productCode)).status;
}

/**
 * 락 반영 SSOT — 계약 상태로 차량 락을 재계산해 상품에 기록. 선점·해제 양방향.
 * 해제 규칙(중요): 수기 상태를 덮지 않는다.
 *   · 내가 쥔 락(locked_by_contract === 이 계약)만 해제.
 *   · 주인 없는 '계약중' = 소유필드 도입 이전에 엔진이 남긴 락 → 치유 대상(해제).
 *   · 주인 없는 '출고불가' = 공급사 수기 설정이거나 구규칙 잔재 → 건드리지 않음(백필로 별도 처리).
 *   · 상품화중·출고협의 등 비락 상태는 어떤 경우에도 보존.
 */
async function syncVehicleLock(
  productCode: string,
  actingContractCode: string,
  opts?: { contracts?: EntityRecord[] },
): Promise<void> {
  if (!productCode) return;
  const co = getCompanyId(); const store = getStore();
  const lock = await vehicleLockedBy(productCode, opts);
  const p = await store.get('product', co, productCode);
  if (!p) return;
  const cur = String(p.vehicle_status || '');
  const owner = String(p.locked_by_contract || '');
  if (lock.status) {
    // 주인없는 '출고불가'(공급사 수기 보류) 불가침 — 아래 release분기(orphan 출고불가 보존)와 대칭.
    //  계약 락(계약중/출고불가)으로 덮으면 공급사 수기 보류가 무효화·중복판매 → 스킵. (정상 딜은 cur가 출고가능/상품화중/자기락이라 미해당.)
    if (cur === '출고불가' && !owner) return;
    if (cur !== lock.status || owner !== lock.byContract) {
      await store.update('product', co, productCode, { vehicle_status: lock.status, locked_by_contract: lock.byContract });
    }
    return;
  }
  const mine = owner === actingContractCode;
  const orphanClaim = !owner && cur === '계약중';
  if ((cur === '계약중' || cur === '출고불가') && (mine || orphanClaim)) {
    await store.update('product', co, productCode, { vehicle_status: '출고가능', locked_by_contract: '' });
  }
}

/**
 * 삭제·중대변경 차단용 — 이 매물을 붙잡고 있는 계약코드(없으면 '').
 * 락(입금선점)보다 넓다: 문의만 있는 건은 통과시키되, 한 단계라도 진행된 계약은 막는다.
 * 입금선점을 락 기준으로 좁히면서 삭제보호까지 같이 좁아지면 진행 중인 딜의 매물이 삭제되므로 분리한다.
 */
export async function blockingContractFor(productCode: string): Promise<string> {
  if (!productCode) return '';
  const co = getCompanyId(); const store = getStore();
  const c = (await store.list('contract', co)).find((x) =>
    String(x.product_code) === String(productCode)
    && x.contract_status !== '계약취소'
    && (x.contract_status === '계약완료' || hasDepositClaim(x) || getProgress(x).done > 0));
  return c ? String(c.contract_code) : '';
}

/** 같은 매물에 이미 계약금 선점한 다른 계약(또는 완료)이 있으면 그 코드. */
function rivalDepositClaimFrom(
  contracts: EntityRecord[],
  productCode: string,
  exceptContractCode: string,
): string | null {
  const rival = contracts.find((c) =>
    String(c.product_code) === String(productCode)
    && String(c.contract_code) !== exceptContractCode
    && c.contract_status !== '계약취소'
    && (c.contract_status === '계약완료' || hasDepositClaim(c)));
  return rival ? String(rival.contract_code) : null;
}

/**
 * 단일 writer — 단계 체크 기록 + 자동 전이 사슬. ContractPanel/계약페이지는 이것만 호출.
 * opts.system = 신뢰 파이프라인(전자서명 approveSign 등) 내부 호출 → actor 인가 우회.
 */
export async function applyStepCheck(contract: EntityRecord, key: string, value: string, opts?: { system?: boolean }): Promise<void> {
  const co = getCompanyId(); const store = getStore();
  const code = String(contract.contract_code);
  const productCode = contract.product_code ? String(contract.product_code) : '';

  // [인가 강제] 스텝 write 는 STEPS 상 담당 역할만(admin 예외). 엔진이 UI mine 게이팅(ch.actor===role||admin)을 신뢰만 하던 구멍을 강제로 전환.
  //  ★정상흐름 보존: 정상 UI(agent가 agent스텝·provider가 provider스텝·admin 전체)는 mine 규칙과 동일해 그대로 통과.
  //  비스텝 필드(stepActor undefined)는 applyStepCheck 호출 경로가 없어 무관 — 기존대로 허용.
  //  system 우회 = provider_agreement_sent 처럼 전자서명(approveSign, 영업자/관리자가 승인)이 provider 스텝을 정당하게 진행하는 경로 보존.
  if (!opts?.system) {
    const stepActor = stepActorOf(key);
    const role = currentActor().role;
    if (stepActor && role !== 'admin' && role !== stepActor) {
      throw new Error(`${stepActor === 'provider' ? '공급사' : '영업자'} 단계는 해당 역할만 진행할 수 있습니다`);
    }
  }

  // 계약목록 1회 조회 — rival/dup/락 재계산이 공유(체크마다 전량 list×N 제거). 판정 로직 불변.
  const contracts = await store.list('contract', co);

  // 계약금 입금·입금확인 선점 — 먼저 누른 계약만 계약중. 이미 선점/완료된 매물은 차단.
  const claimingDeposit = !isReject(value) && (DEPOSIT_CLAIM_KEYS as readonly string[]).includes(key) && !isDone(contract[key]);
  if (claimingDeposit && productCode) {
    const rival = rivalDepositClaimFrom(contracts, productCode, code);
    if (rival) throw new Error(`이미 계약금이 확인된 계약(${rival})이 있는 차량입니다 — 선점 불가`);
    // 2차 방어 — 계약목록 조회가 권한/캐시로 실패해 rival 을 못 봤을 때를 대비해 상품의 락 소유자로 재확인.
    // 소유자가 본 계약이면 통과(체크 재클릭·잔금확인 등 후속). 소유자 없는 '계약중'만 구데이터 잔재로 보고 막지 않음(데드락 방지) — 소유자 없는 '출고불가'는 공급사 수기 보류라 아래에서 차단.
    const p = await store.get('product', co, productCode);
    const st = String(p?.vehicle_status || '');
    const owner = String(p?.locked_by_contract || '');
    // 남의 락(출고불가·계약중)이면 선점 불가.
    if ((st === '출고불가' || st === '계약중') && owner && owner !== code) {
      throw new Error(`이 차량은 이미 ${st} 상태입니다(계약 ${owner}) — 중복 계약 불가`);
    }
    // 주인없는 '출고불가' = 공급사가 재고에서 수기로 보류(locked_by_contract 없음). 완료 시엔 owner=code로 찍히므로 이 계약이 만든 락일 수 없다 → 재선점 차단.
    //  (주인없는 '계약중'은 소유필드 도입 이전 엔진 잔재 → 치유 대상이라 여기서 막지 않음: 자기잠금 데드락 방지 유지.)
    if (st === '출고불가' && !owner) {
      throw new Error('이 차량은 공급사가 출고불가로 보류한 차량입니다 — 선점 불가');
    }
  }

  // 중복완료 가드(v3 이식) — 이 체크로 계약이 완료되는데 같은 차량에 이미 '계약완료'된 다른 계약이 있으면 이중판매 → 쓰기 전에 차단.
  if (!isReject(value) && productCode) {
    const hypo = getProgress({ ...contract, [key]: value } as EntityRecord);
    if (hypo.done === hypo.total && contract.contract_status !== '계약완료') {
      const dup = contracts.find((c) => String(c.product_code) === productCode && String(c.contract_code) !== code && c.contract_status === '계약완료');
      if (dup) throw new Error(`이미 완료된 계약(${dup.contract_code})이 있는 차량입니다 — 이중판매 불가`);
    }
  }
  await store.update('contract', co, code, { [key]: value });
  // store.update 가 delta 로 캐시를 정확히 패치 — 호출자 stale 스냅샷(contract 전체)으로 덮지 않는다(캐시 되돌림→락 오해제·중복판매 방지).
  const fresh = (await store.get('contract', co, code)) || ({ ...contract, [key]: value } as EntityRecord);
  // 공유 list에 방금 패치 반영한 사본(락 재계산 first-wins가 최신 체크값 보도록).
  const contractsFresh = contracts.map((c) => String(c.contract_code) === code ? fresh : c);

  if (isReject(value)) {
    if (fresh.contract_status !== '계약취소') await store.update('contract', co, code, { contract_status: '계약취소' });
    if (productCode) await syncVehicleLock(productCode, code, { contracts: contractsFresh.map((c) => String(c.contract_code) === code ? { ...fresh, contract_status: '계약취소' } : c) });
    await onContractCancel(fresh);
    return;
  }
  const pr = getProgress(fresh);
  if (pr.done === pr.total && fresh.contract_status !== '계약완료') {
    // 정산을 먼저(멱등 ST_) — 실패 시 계약완료·락을 찍지 않아 "완료만 남고 정산 누락"을 막는다.
    //  재시도 시 createSettlement는 이미 있으면 즉시 반환 → status/락만 이어감.
    await createSettlement(fresh);
    await store.update('contract', co, code, { contract_status: '계약완료' });
    if (productCode) await store.update('product', co, productCode, { vehicle_status: '출고불가', locked_by_contract: code });
  } else if (productCode) {
    // 락 재계산 — 선점·해제 양방향. 체크 해제('')로 선점이 풀린 경우도 반드시 여기서 상품에 반영된다.
    // (구현: 해제를 별도 분기로 두면 매번 새 누락 경로가 생김 → 매 체크마다 무조건 재계산이 SSOT)
    await syncVehicleLock(productCode, code, { contracts: contractsFresh });
  }
}
