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
import { getProgress, hasDepositClaim, hasTermFrozen, DEPOSIT_CLAIM_KEYS, isDone, stepActorOf } from '@/lib/domain/contract';
import { readPartnerPrivate, readUserPrivate } from '@/lib/domain/private-fields';
import { requirePositiveRentAmount } from '@/lib/domain/contract-money';
import { vehicleIdentity } from '@/lib/domain/product';
import { isVehicleClaimStepKey } from '@/lib/domain/vehicle-claim';
import { displayNumber, settlementIdForContract, settlementStorageKeyForContract } from '@/lib/domain/ids';
import {
  atomicVehicleClaimsEnabled,
  releaseCancelledVehicleClaimFromClient,
  transitionVehicleClaimFromClient,
} from '@/lib/firebase/vehicle-claim-client';

const REJECT_VALS = ['불가', '부결', '출고 불가'];
const isReject = (v: unknown) => typeof v === 'string' && REJECT_VALS.includes(v);

// LocalAdapter 시뮬레이션 전용 단일 프로세스 claim. 운영 RTDB는 반드시 서버 transaction 경로를 쓴다.
// 브라우저 mutex를 운영 안전장치로 오인하지 않도록 backend가 local일 때만 사용한다.
const localVehicleClaims = new Map<string, string>();

/**
 * 율 정규화 — 0~1 범위만 유효. 벗어나면 **기본값으로 되돌리고 크게 남긴다**.
 * 예전엔 `Number(raw)`를 그대로 써서 '10'(10% 의도) 입력이 1000%로 청구되고,
 * 비숫자면 NaN이 금액 전체를 오염시켰다(QA RATE-1). 조용히 보정하지 않고 로그를 남기는 이유는
 * 잘못된 값이 어딘가에 저장돼 있다는 사실 자체가 고쳐야 할 문제이기 때문이다.
 */
function normalizeRate(raw: unknown, fallback: number, where: string): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`[정산] ${where} 값이 숫자가 아님(${String(raw)}) — 기본값 ${fallback} 사용. 데이터 수정 필요`);
    return fallback;
  }
  if (n < 0 || n > 1) {
    console.error(`[정산] ${where} 값이 0~1 범위 밖(${n}) — 기본값 ${fallback} 사용. 0.1=10% 형식으로 입력해야 한다`);
    return fallback;
  }
  return n;
}

/**
 * 수수료율 SSOT — 공급사율(partner.fee_rate, 기본 0.1) · 영업자지급율(user.agent_payout_rate, 기본 0.04).
 * 신차 = 공급사 우대 0%.
 *
 * `feeResolved` = **공급사율을 실제로 찾았는가.** 못 찾아 기본 0.1 로 때운 경우와 구분해야 한다.
 * 계약의 fee_rate_snapshot 은 규칙상 생성 시 1회 확정이고 그 뒤엔 관리자도 못 고친다
 * (database.rules.json fee_rate_snapshot .validate). 그래서 못 찾은 값을 굽는 순간
 * 그 계약은 영구히 10% 로 남는다. 실측(2026-07-31): 공급사 40곳 중 fee_rate 보유 0곳 —
 * 요율이 아직 미정이라 지금 만들어지는 계약이 전부 그 상태다.
 * 신차는 조회와 무관하게 0% 가 규칙이므로 '해석됨'으로 본다.
 */
export async function resolveRates(
  contract: EntityRecord,
  product: EntityRecord | null,
): Promise<{ feeRate: number; payoutRate: number; feeResolved: boolean }> {
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
  let feeRate = normalizeRate(rawFee, 0.1, `공급사 ${String(contract.provider_company_code || '')} fee_rate`);
  const payoutRate = normalizeRate(rawPayout, 0.04, `영업자 ${String(contract.agent_code || '')} agent_payout_rate`);
  const isNewCar = String(product?.product_type || '').startsWith('신차');
  if (isNewCar) feeRate = 0; // 신차(렌트·구독) 파트너 우대(공급사 수수료 0)
  const feeResolved = isNewCar || (rawFee != null && rawFee !== '');
  return { feeRate, payoutRate, feeResolved };
}

/** 정산 원자 생성. 운영 저장키는 ST_를 유지하고 신규 계약에는 canonical stl_ 코드를 병기한다. */
export async function createSettlement(contract: EntityRecord): Promise<string> {
  const co = getCompanyId(); const store = getStore();
  const code = settlementStorageKeyForContract(contract.contract_code);
  const canonicalCode = settlementIdForContract(contract.contract_code);
  if (!code || !canonicalCode) throw new Error('정산 생성: 계약코드 없음');
  if (await store.get('settlement', co, code)) return code;
  // 레거시 계약·직접 호출도 0원 정산으로 승격되지 않게 최종 writer에서 재검증한다.
  const rent = requirePositiveRentAmount(contract.rent_amount_snapshot, '정산 생성');
  const product = contract.product_code ? await store.get('product', co, String(contract.product_code)) : null;
  // 율 = 계약시점 동결 스냅샷 우선(핸드셰이크 중 율 변경 무관). 스냅샷 없으면 live 해석.
  //  ⚠ 둘을 **따로** 본다. 예전엔 "둘 다 있어야 스냅샷 채택"이라, 공급사율 하나가 없다는 이유로
  //   멀쩡히 동결돼 있던 영업자지급율까지 버리고 다시 해석했다.
  const feeSnap = contract.fee_rate_snapshot != null && contract.fee_rate_snapshot !== '' ? Number(contract.fee_rate_snapshot) : null;
  const payoutSnap = contract.payout_rate_snapshot != null && contract.payout_rate_snapshot !== '' ? Number(contract.payout_rate_snapshot) : null;
  let feeRate = feeSnap ?? 0.1;
  let payoutRate = payoutSnap ?? 0.04;
  let feeResolved = feeSnap != null;
  if (feeSnap == null || payoutSnap == null) {
    const r = await resolveRates(contract, product);
    if (feeSnap == null) { feeRate = r.feeRate; feeResolved = r.feeResolved; }
    if (payoutSnap == null) payoutRate = r.payoutRate;
  }
  // 공급사율을 끝내 못 구했으면 금액은 만들되(정산 누락 제로가 상위 원칙) 표식을 남긴다.
  //  계약 스냅샷과 달리 **정산의 fee_rate·fee_amount 는 관리자가 고칠 수 있다** — 여기가 복구 지점이다.
  if (!feeResolved) console.error(`[정산] ${code} 공급사율 미해석 — 기본 0.1 로 생성. 요율 입력 후 관리자 재계산 필요`);
  const fee = Math.round(rent * feeRate);
  const payout = Math.round(rent * payoutRate);
  try {
    await store.save('settlement', co, [{
      settlement_code: code,
      ...(canonicalCode !== code ? { canonical_code: canonicalCode, legacy_settlement_code: code } : {}),
      settlement_number: displayNumber('settlement', canonicalCode, String(contract.contract_date || '')),
      contract_code: contract.contract_code, car_number: contract.car_number_snapshot,
      customer_name: contract.customer_name, provider_company_code: contract.provider_company_code, partner_code: contract.provider_company_code,
      agent_code: contract.agent_code, agent_channel_code: contract.agent_channel_code,
      rent_amount: rent, fee_rate: feeRate, fee_amount: fee, agent_payout: payout, net_amount: fee - payout, clawback_amount: 0,
      // 공급사율 미해석 표식 — 화면에서 "요율 확정 후 재계산 필요"로 보여 준다. 해석됐으면 남기지 않는다.
      ...(feeResolved ? {} : { fee_rate_unresolved: 'yes' }),
      settlement_status: '정산대기', contract_date: contract.contract_date,
      rent_month_snapshot: contract.rent_month_snapshot, sub_model_snapshot: contract.sub_model_snapshot,
    }]);
  } catch (error) {
    const message = String((error as Error)?.message || error);
    if (/permission[\s_-]*denied/i.test(message)) {
      throw new Error('정산 저장 권한이 거부되었습니다. 최신 database.rules.json 게시 상태를 확인한 뒤 완료 처리를 재시도하세요.');
    }
    throw error;
  }
  return code;
}

/**
 * 5/5인데 정산·완료 전이 중 실패한 계약을 멱등 복구한다.
 * 정산 → 계약완료 → 차량잠금 순서를 지켜 완료만 남거나 정산이 중복되는 것을 막는다.
 */
export async function finalizeContractIfReady(contract: EntityRecord): Promise<boolean> {
  const co = getCompanyId(); const store = getStore();
  const code = String(contract.contract_code);
  const fresh = (await store.get('contract', co, code)) || contract;
  // 취소된 계약은 되살리지 않는다 — 배너의 '완료 처리 재시도'가 취소를 덮고 정산·락을 다시 만들던 구멍(QA FIN-1).
  if (fresh.contract_status === '계약취소') return false;
  const progress = getProgress(fresh);
  if (progress.done !== progress.total) return false;
  // 이중판매 가드 — 이 경로는 applyStepCheck 를 거치지 않아 가드가 통째로 빠져 있었다(QA FIN-1).
  //  이미 완료된 계약의 멱등 재실행은 자기 락을 자기가 막지 않도록 완료 전 상태에서만 검사한다.
  if (fresh.contract_status !== '계약완료' && fresh.product_code) {
    const reason = await duplicateSaleReason(String(fresh.product_code), code);
    if (reason) throw new Error(reason);
  }
  await createSettlement(fresh);
  if (fresh.contract_status !== '계약완료') {
    await store.update('contract', co, code, { contract_status: '계약완료' });
  }
  if (fresh.product_code) {
    await store.update('product', co, String(fresh.product_code), {
      vehicle_status: '출고불가',
      locked_by_contract: code,
    });
  }
  return true;
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
  if (fresh.contract_status === '계약취소') {
    if (atomicVehicleClaimsEnabled(store.backend)) await releaseCancelledVehicleClaimFromClient(co, code);
    else await releaseLocalVehicleClaim(fresh, code);
    return;
  }
  // 완료 계약은 R1(private 공급사 수수료)을 기준으로 환수액을 계산한다.
  // 영업자 세션에는 R1이 노출되지 않으므로 클라이언트에서 취소하면 0원 환수 또는
  // 계약·차량만 먼저 바뀐 부분완료가 생길 수 있다. 완료 후 취소·환수는 관리자만 처리한다.
  if (fresh.contract_status === '계약완료' && currentActor().role !== 'admin') {
    throw new Error('완료된 계약의 취소·환수는 관리자만 처리할 수 있습니다');
  }
  await store.update('contract', co, code, { contract_status: '계약취소' });
  // 재고 = 이 계약 취소 후 재계산(다른 계약중/완료 있으면 유지). 무조건 출고가능 복원 금지.
  if (atomicVehicleClaimsEnabled(store.backend)) await releaseCancelledVehicleClaimFromClient(co, code);
  else if (fresh.product_code) await syncVehicleLock(String(fresh.product_code), code);
  await releaseLocalVehicleClaim(fresh, code);
  await onContractCancel(fresh); // 정산 존재(완료건) → 환수대기+환수액. 없으면 no-op.
}

/** 계약취소 → 정산 환수대기 전이 + 환수액 기록. */
export async function onContractCancel(contract: EntityRecord): Promise<void> {
  const co = getCompanyId(); const store = getStore();
  const code = settlementStorageKeyForContract(contract.contract_code);
  if (!code) return;
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

/**
 * 트윈 = 같은 실물이 여러 product_code 로 존재하는 상태. 선점·중복완료 가드가 코드 하나만 보면
 * 다른 코드로 같은 차를 또 판다(QA TWIN-1).
 * 실측 2026-08-04: 트윈 그룹 102 · 두 코드 이상이 동시에 판매 가능한 그룹 100 · 공급사가 서로 다른 그룹 42.
 *
 * 목록 dedup 이 있으니 괜찮다는 건 착각이다. dedup 승자는 richness(가격·사진·연식) 우선이라
 * **락 상태를 전혀 보지 않는다.** 시트 동기화가 패자 쪽에 가격을 채우면 승자가 뒤집혀
 * 이미 팔린 차가 다시 매물로 뜬다. 그래서 화면이 아니라 가드에서 막아야 한다.
 */
type TwinSet = { codes: Set<string>; rows: EntityRecord[]; identity: string | null };

/**
 * listRawFresh 를 쓰는 이유 둘 —
 *  · list 는 dedup 이 끝난 목록이라 쌍둥이가 애초에 안 보인다(가드가 볼 수 없다).
 *  · 세션 캐시를 우회해야 다른 영업자가 방금 건 락을 본다(RACE-1 과 같은 이유).
 * 신원키(실번호판·VIN 11자↑)가 없으면 합치지 않는다 — '미정'·'-' 같은 placeholder 를 공유하는
 * 서로 다른 차를 한 대로 묶으면 멀쩡한 매물이 서로를 막는다.
 * 조회 실패(권한·네트워크)면 자기 코드만 담아 오늘 동작으로 degrade 한다 — 가드가 정상 거래를 막는 쪽으로 실패하지 않는다.
 */
async function twinsOf(productCode: string): Promise<TwinSet> {
  const codes = new Set<string>([productCode]);
  if (!productCode) return { codes, rows: [], identity: null };
  const co = getCompanyId(); const store = getStore();
  let all: EntityRecord[] = [];
  try {
    if (store.listRawFresh) all = await store.listRawFresh('product', co);
    else if (store.listRaw) all = await store.listRaw('product', co);
    else all = await store.list('product', co);
  } catch { return { codes, rows: [], identity: null }; }
  const self = all.find((r) => String(r.product_code) === productCode || String(r._key) === productCode);
  const id = self ? vehicleIdentity(self) : null;
  if (!id) return { codes, rows: [], identity: null };
  const rows = all.filter((r) => vehicleIdentity(r) === id);
  for (const r of rows) {
    const c = String(r.product_code || r._key || '');
    if (c) codes.add(c);
  }
  return { codes, rows, identity: id };
}

async function releaseLocalVehicleClaim(contract: EntityRecord, contractCode: string): Promise<void> {
  const store = getStore();
  const productCode = String(contract.product_code || '');
  if (!store.backend.startsWith('local') || !productCode) return;
  const twin = await twinsOf(productCode);
  const claimKey = twin.identity || `CODE:${productCode}`;
  if (localVehicleClaims.get(claimKey) === contractCode) localVehicleClaims.delete(claimKey);
}

/** 같은 실물(트윈 코드 포함)에 이미 계약금 선점한 다른 계약(또는 완료)이 있으면 그 코드. */
function rivalDepositClaimFrom(
  contracts: EntityRecord[],
  productCodes: Set<string>,
  exceptContractCode: string,
): string | null {
  const rival = contracts.find((c) =>
    productCodes.has(String(c.product_code))
    && String(c.contract_code) !== exceptContractCode
    && c.contract_status !== '계약취소'
    && (c.contract_status === '계약완료' || hasDepositClaim(c)));
  return rival ? String(rival.contract_code) : null;
}

/**
 * 이중판매 차단 판정 — 완료 직전 공용 가드. applyStepCheck 와 finalizeContractIfReady 가 **같은 검사**를 쓴다.
 * 배너의 '완료 처리 재시도'가 applyStepCheck 를 거치지 않아 가드가 통째로 빠지던 구멍(QA FIN-1)을 막는다.
 * 반환 = 차단 사유(있으면 throw) · null = 통과.
 *
 * 쌍둥이에서는 **주인 있는 락만** 본다. 주인 없는 '출고불가'는 다른 공급사가 자기 재고에 건 수기 보류라
 * 이 매물이 팔렸다는 뜻이 아니다 — 위험 트윈 100 중 42 가 공급사 교차라, 그걸 막으면 멀쩡한 거래가 죽는다.
 */
async function duplicateSaleReason(
  productCode: string,
  exceptContractCode: string,
  opts?: { contracts?: EntityRecord[]; twin?: TwinSet },
): Promise<string | null> {
  if (!productCode) return null;
  const co = getCompanyId(); const store = getStore();
  const twin = opts?.twin ?? await twinsOf(productCode);
  const contracts = opts?.contracts ?? await store.list('contract', co);
  const dup = contracts.find((c) =>
    twin.codes.has(String(c.product_code))
    && String(c.contract_code) !== exceptContractCode
    && c.contract_status === '계약완료');
  if (dup) return `이미 완료된 계약(${dup.contract_code})이 있는 차량입니다 — 이중판매 불가`;
  // 계약목록은 역할 스코프(영업자=본인 것만)+세션 캐시라 남의 완료가 안 보인다.
  //  매물 락 소유자는 캐시를 우회해 본다 — 교차 영업자 이중판매의 마지막 방어선.
  const self = await (store.getFresh ? store.getFresh('product', co, productCode) : store.get('product', co, productCode));
  const owner = String(self?.locked_by_contract || '');
  if (owner && owner !== exceptContractCode && String(self?.vehicle_status || '') === '출고불가') {
    return `이 차량은 이미 다른 계약(${owner})으로 출고 완료됐습니다 — 이중판매 불가`;
  }
  for (const t of twin.rows) {
    const tc = String(t.product_code || t._key || '');
    if (!tc || tc === productCode) continue;
    const tOwner = String(t.locked_by_contract || '');
    if (tOwner && tOwner !== exceptContractCode && String(t.vehicle_status || '') === '출고불가') {
      return `같은 차량이 다른 매물코드(${tc})로 이미 출고 완료됐습니다(계약 ${tOwner}) — 이중판매 불가`;
    }
  }
  return null;
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

  // 입금은 약정에서 기간·금액이 굳힌 뒤에만.
  if (
    value
    && !isReject(value)
    && (key === 'agent_balance_paid' || key === 'agent_final_paid' || key === 'provider_balance_confirmed')
    && !hasTermFrozen(contract)
  ) {
    throw new Error('약정에서 대여기간·금액을 먼저 확정해 주세요');
  }

  // 운영 RTDB 입금 선점은 서버가 차량 신원 hash claim을 transaction으로 선점한 뒤 계약·재고를 갱신한다.
  // 기존 클라이언트 check-then-act 경로로 내려가면 서로 다른 브라우저가 동시에 통과하므로 여기서 완전히 분기한다.
  if (productCode && isVehicleClaimStepKey(key) && atomicVehicleClaimsEnabled(store.backend)) {
    await transitionVehicleClaimFromClient(co, code, key, value);
    const fresh = (await (store.getFresh ? store.getFresh('contract', co, code) : store.get('contract', co, code)))
      || ({ ...contract, [key]: value } as EntityRecord);
    const progress = getProgress(fresh);
    if (progress.done === progress.total && fresh.contract_status !== '계약완료') await finalizeContractIfReady(fresh);
    return;
  }

  // 계약목록 1회 조회 — rival/dup/락 재계산이 공유(체크마다 전량 list×N 제거). 판정 로직 불변.
  const contracts = await store.list('contract', co);

  // 트윈 조회는 선점·완료 판정에서만 필요하고 전량 신선조회라 비싸다 — 이 호출 안에서 1회만.
  let twinMemo: TwinSet | null = null;
  const twins = async (): Promise<TwinSet> => (twinMemo ??= await twinsOf(productCode));

  // 계약금 입금·입금확인 선점 — 먼저 누른 계약만 계약중. 이미 선점/완료된 매물은 차단.
  const claimingDeposit = !isReject(value) && (DEPOSIT_CLAIM_KEYS as readonly string[]).includes(key) && !isDone(contract[key]);
  if (claimingDeposit && productCode) {
    const twin = await twins();
    const rival = rivalDepositClaimFrom(contracts, twin.codes, code);
    if (rival) throw new Error(`이미 계약금이 확인된 계약(${rival})이 있는 차량입니다 — 선점 불가`);
    // 2차 방어 — 계약목록 조회가 권한/캐시로 실패해 rival 을 못 봤을 때를 대비해 상품의 락 소유자로 재확인.
    // 소유자가 본 계약이면 통과(체크 재클릭·잔금확인 등 후속). 소유자 없는 '계약중'만 구데이터 잔재로 보고 막지 않음(데드락 방지) — 소유자 없는 '출고불가'는 공급사 수기 보류라 아래에서 차단.
    // ★캐시 우회 필수 — store.get()은 세션 영구 list 캐시를 먼저 본다. 캐시를 읽으면
    //  "다른 영업자가 방금 건 락"이 안 보여 가드가 통과하고 같은 차가 두 번 팔린다(QA RACE-1).
    const p = await (store.getFresh ? store.getFresh('product', co, productCode) : store.get('product', co, productCode));
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
    // 쌍둥이 코드의 락 — 같은 실물이 다른 코드로 이미 계약에 잡혀 있으면 선점 불가.
    //  주인 있는 락만 본다(§duplicateSaleReason 과 같은 이유 — 남의 수기 보류로 멀쩡한 거래를 막지 않는다).
    for (const t of twin.rows) {
      const tc = String(t.product_code || t._key || '');
      if (!tc || tc === productCode) continue;
      const tSt = String(t.vehicle_status || '');
      const tOwner = String(t.locked_by_contract || '');
      if ((tSt === '출고불가' || tSt === '계약중') && tOwner && tOwner !== code) {
        throw new Error(`같은 차량이 다른 매물코드(${tc})로 이미 ${tSt} 상태입니다(계약 ${tOwner}) — 중복 계약 불가`);
      }
    }
  }

  // 중복완료 가드(v3 이식) — 이 체크로 계약이 완료되는데 같은 실물에 이미 '계약완료'된 다른 계약이 있으면 이중판매 → 쓰기 전에 차단.
  //  판정은 finalizeContractIfReady 와 공유한다(둘이 갈리면 한쪽만 뚫린다 — QA FIN-1 이 그 사고였다).
  if (!isReject(value) && productCode) {
    const hypo = getProgress({ ...contract, [key]: value } as EntityRecord);
    if (hypo.done === hypo.total && contract.contract_status !== '계약완료') {
      const reason = await duplicateSaleReason(productCode, code, { contracts, twin: await twins() });
      if (reason) throw new Error(reason);
    }
  }
  // LocalAdapter 적대 시뮬레이션도 같은 tick의 두 요청 중 하나만 통과시킨다.
  // 운영 브라우저에는 이 Map을 쓰지 않으며 위 서버 transaction이 유일한 동시성 경계다.
  let localClaimKey = '';
  if (claimingDeposit && store.backend.startsWith('local')) {
    const twin = await twins();
    localClaimKey = twin.identity || `CODE:${productCode}`;
    const owner = localVehicleClaims.get(localClaimKey);
    if (owner && owner !== code) throw new Error(`같은 차량을 다른 계약(${owner})이 먼저 선점했습니다.`);
    localVehicleClaims.set(localClaimKey, code);
  }
  try {
    await store.update('contract', co, code, { [key]: value });
  } catch (error) {
    if (localClaimKey && localVehicleClaims.get(localClaimKey) === code) localVehicleClaims.delete(localClaimKey);
    throw error;
  }
  // store.update 가 delta 로 캐시를 정확히 패치 — 호출자 stale 스냅샷(contract 전체)으로 덮지 않는다(캐시 되돌림→락 오해제·중복판매 방지).
  const fresh = (await store.get('contract', co, code)) || ({ ...contract, [key]: value } as EntityRecord);
  // 공유 list에 방금 패치 반영한 사본(락 재계산 first-wins가 최신 체크값 보도록).
  const contractsFresh = contracts.map((c) => String(c.contract_code) === code ? fresh : c);

  if (isReject(value)) {
    if (fresh.contract_status !== '계약취소') await store.update('contract', co, code, { contract_status: '계약취소' });
    if (atomicVehicleClaimsEnabled(store.backend)) await releaseCancelledVehicleClaimFromClient(co, code);
    else if (productCode) await syncVehicleLock(productCode, code, { contracts: contractsFresh.map((c) => String(c.contract_code) === code ? { ...fresh, contract_status: '계약취소' } : c) });
    if (store.backend.startsWith('local')) {
      const twin = await twins(); const claimKey = twin.identity || `CODE:${productCode}`;
      if (localVehicleClaims.get(claimKey) === code) localVehicleClaims.delete(claimKey);
    }
    await onContractCancel(fresh);
    return;
  }
  const pr = getProgress(fresh);
  if (pr.done === pr.total && fresh.contract_status !== '계약완료') {
    // 정산을 먼저(신규 stl_·기존 ST_ 모두 멱등) — 실패 시 계약완료·락을 찍지 않아 "완료만 남고 정산 누락"을 막는다.
    // 중간 실패는 ContractPanel의 명시적 재시도 경로로 같은 전이 사슬을 이어간다.
    await finalizeContractIfReady(fresh);
  } else if (productCode) {
    // 락 재계산 — 선점·해제 양방향. 체크 해제('')로 선점이 풀린 경우도 반드시 여기서 상품에 반영된다.
    // (구현: 해제를 별도 분기로 두면 매번 새 누락 경로가 생김 → 매 체크마다 무조건 재계산이 SSOT)
    await syncVehicleLock(productCode, code, { contracts: contractsFresh });
  }
  if (store.backend.startsWith('local') && isVehicleClaimStepKey(key) && !hasDepositClaim(fresh)) {
    const twin = await twins(); const claimKey = twin.identity || `CODE:${productCode}`;
    if (localVehicleClaims.get(claimKey) === code) localVehicleClaims.delete(claimKey);
  }
}
