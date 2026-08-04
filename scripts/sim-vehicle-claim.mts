import {
  canTransitionVehicleClaim,
  markVehicleClaimReleasing,
  reserveVehicleClaim,
  STALE_VEHICLE_CLAIM_MS,
  type VehicleClaimActor,
  type VehicleClaimRecord,
} from '../lib/domain/vehicle-claim';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
}

const contract = {
  contract_code: 'C-1', agent_uid: 'A-1', agent_channel_code: 'CH-1', provider_company_code: 'P-1',
};
const actor = (patch: Partial<VehicleClaimActor>): VehicleClaimActor => ({
  uid: 'X', role: 'agent', rawRole: 'agent', companyCode: '', agentChannelCode: '', ...patch,
});
check('소유 영업자 agent_balance 허용', canTransitionVehicleClaim(actor({ uid: 'A-1' }), contract, 'agent_balance_paid'));
check('같은 채널 관리자 agent_balance 허용', canTransitionVehicleClaim(actor({ rawRole: 'agent_admin', agentChannelCode: 'CH-1' }), contract, 'agent_balance_paid'));
check('타 영업자 agent_balance 차단', !canTransitionVehicleClaim(actor({ uid: 'A-2' }), contract, 'agent_balance_paid'));
check('소유 공급사 provider_balance 허용', canTransitionVehicleClaim(actor({ role: 'provider', rawRole: 'provider', companyCode: 'P-1' }), contract, 'provider_balance_confirmed'));
check('타 공급사 provider_balance 차단', !canTransitionVehicleClaim(actor({ role: 'provider', rawRole: 'provider', companyCode: 'P-2' }), contract, 'provider_balance_confirmed'));
check('플랫폼 관리자 양쪽 허용', canTransitionVehicleClaim(actor({ role: 'admin', rawRole: 'admin' }), contract, 'agent_balance_paid')
  && canTransitionVehicleClaim(actor({ role: 'admin', rawRole: 'admin' }), contract, 'provider_balance_confirmed'));

let current: VehicleClaimRecord | null = null;
async function claim(code: string): Promise<string> {
  await Promise.resolve();
  const next = reserveVehicleClaim(current, {
    contract_code: code, product_code: `P-${code}`, identity_hash: 'HASH-1', actor_uid: code,
  }, Date.now());
  if (!next) throw new Error('conflict');
  current = next;
  await Promise.resolve();
  current = { ...current, status: 'active' };
  return code;
}

const results = await Promise.allSettled([claim('C-A'), claim('C-B')]);
check('동시 claim 정확히 하나만 성공', results.filter((result) => result.status === 'fulfilled').length === 1, results.map((result) => result.status));
check('claim 원장 소유자 하나', !!current && ['C-A', 'C-B'].includes(current.contract_code), current);
const owner = current?.contract_code || '';
check('같은 계약 재시도 멱등 허용', !!reserveVehicleClaim(current, {
  contract_code: owner, product_code: `P-${owner}`, identity_hash: 'HASH-1', actor_uid: owner,
}, Date.now()));
check('다른 계약 재시도 차단', reserveVehicleClaim(current, {
  contract_code: 'C-OTHER', product_code: 'P-OTHER', identity_hash: 'HASH-1', actor_uid: 'C-OTHER',
}, Date.now()) === null);
check('소유 계약만 releasing 전환', !!markVehicleClaimReleasing(current, owner, Date.now())
  && markVehicleClaimReleasing(current, 'C-OTHER', Date.now()) === null);

// ── 중간에 죽은 선점 회수 ──
// 선점은 transaction('claiming') → multipath update('active') 두 단계다. 그 사이에서 죽으면
// 'claiming' 이 남아 그 차를 아무도 못 판다. 반대로 정상 선점을 시간으로 뺏으면 그게 이중판매다.
// 두 방향을 같이 고정한다.
const t0 = 1_000_000_000_000;
const rival = { contract_code: 'C-OTHER', product_code: 'P-OTHER', identity_hash: 'HASH-1', actor_uid: 'U-OTHER' };
const deadClaiming: VehicleClaimRecord = {
  contract_code: 'C-DEAD', product_code: 'P-DEAD', identity_hash: 'HASH-1',
  status: 'claiming', updated_at: t0, actor_uid: 'U-DEAD',
};
check('죽은 claiming 은 유예 뒤 회수', !!reserveVehicleClaim(deadClaiming, rival, t0 + STALE_VEHICLE_CLAIM_MS + 1));
check('유예 안 지난 claiming 은 보호', reserveVehicleClaim(deadClaiming, rival, t0 + STALE_VEHICLE_CLAIM_MS - 1) === null);
check('죽은 releasing 도 유예 뒤 회수', !!reserveVehicleClaim({ ...deadClaiming, status: 'releasing' }, rival, t0 + STALE_VEHICLE_CLAIM_MS + 1));
check('active 선점은 아무리 오래돼도 안 뺏김',
  reserveVehicleClaim({ ...deadClaiming, status: 'active' }, rival, t0 + STALE_VEHICLE_CLAIM_MS * 1000) === null);
check('회수된 원장은 새 계약 소유', reserveVehicleClaim(deadClaiming, rival, t0 + STALE_VEHICLE_CLAIM_MS + 1)?.contract_code === 'C-OTHER');
check('updated_at 없는 구데이터도 회수 가능',
  !!reserveVehicleClaim({ ...deadClaiming, updated_at: undefined as unknown as number }, rival, t0));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
