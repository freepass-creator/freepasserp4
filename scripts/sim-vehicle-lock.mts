/**
 * 차량 락 시뮬레이션 — 계약금 선점(계약중) / 해제 / 재선점 / 경쟁 / 삭제보호 / 수기상태 보존.
 * 실제 도메인 함수(applyStepCheck / syncVehicleLock 경유 / blockingContractFor)를 LocalAdapter 위에서 실행.
 *   실행: npx tsx scripts/sim-vehicle-lock.mts
 */
const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
(globalThis as unknown as { localStorage: typeof ls; window: typeof globalThis }).localStorage = ls;
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
(globalThis as unknown as { window: { dispatchEvent: (e: Event) => boolean } }).window.dispatchEvent = () => true;
class CE extends Event { detail: unknown; constructor(t: string, i?: { detail?: unknown }) { super(t); this.detail = i?.detail; } }
(globalThis as unknown as { CustomEvent: typeof CE }).CustomEvent = CE;

process.env.NEXT_PUBLIC_DATA_BACKEND = ''; // LocalAdapter 강제

const { getStore } = await import('../lib/store');
const { getCompanyId } = await import('../lib/tenant');
const { newId } = await import('../lib/domain/ids');
const { applyStepCheck, vehicleLockedBy, blockingContractFor, cancelContract, finalizeContractIfReady } = await import('../lib/domain/settlement-engine');
import type { EntityRecord } from '../lib/intake/entities';

const co = getCompanyId();
const store = getStore();

async function asRole<T>(role: 'agent' | 'provider', run: () => Promise<T>): Promise<T> {
  const before = localStorage.getItem('fp4_role');
  localStorage.setItem('fp4_role', role);
  try {
    return await run();
  } finally {
    if (before == null) localStorage.removeItem('fp4_role');
    else localStorage.setItem('fp4_role', before);
  }
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, got?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got === undefined ? '' : `  → got: ${JSON.stringify(got)}`}`); }
};
const head = (s: string) => console.log(`\n━━ ${s}`);

const vehStatus = async (code: string) => String((await store.get('product', co, code))?.vehicle_status || '');
const owner = async (code: string) => String((await store.get('product', co, code))?.locked_by_contract || '');
const ct = async (code: string) => (await store.get('contract', co, code)) as EntityRecord;

let _fxSeq = 0; // 계약코드 전역 고유 카운터(하네스)
let _vehSeq = 0; // 서로 다른 fixture를 트윈으로 오인하지 않도록 차량번호도 고유하게 만든다.
/** 매물 1대 + 계약 n건 생성. */
async function fixture(n: number, productStatus = '출고가능', carNumber?: string) {
  const pc = newId('product');
  const plate = carNumber ?? `99시${String(1000 + _vehSeq++).padStart(4, '0')}`;
  await store.save('product', co, [{
    product_code: pc, car_number: plate, maker: '현대', model: '쏘나타',
    vehicle_status: productStatus, product_type: '중고렌트', provider_company_code: 'sup_jeil',
    price: { '36': { rent: 550000, deposit: 0, fee: 55000 } },
  } as EntityRecord]);
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const cc = `TMP-SIM-${_fxSeq++}`; // 전역 단조 카운터 — Date.now() 밀리초 충돌 제거(결정적)
    await store.save('contract', co, [{
      contract_code: cc, product_code: pc, contract_status: '계약요청',
      agent_code: `agent${i}`, provider_company_code: 'sup_jeil',
      rent_amount_snapshot: 550000, rent_month_snapshot: 36,
    } as EntityRecord]);
    codes.push(cc);
  }
  return { pc, codes };
}

const allDone = {
  agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  agent_docs_submitted: 'yes', provider_docs_review: '승인',
  agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
  provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
  agent_handover_confirmed: 'yes', provider_release_completed: 'yes',
};

// ── 1. 선점 → 계약중 + 주인 각인 ──
head('1. 계약금 입금 → 계약중 선점');
{
  const { pc, codes: [c1] } = await fixture(1);
  await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes');
  check('차량상태 = 계약중', (await vehStatus(pc)) === '계약중', await vehStatus(pc));
  check('락 주인 = 해당 계약', (await owner(pc)) === c1, await owner(pc));
  check('vehicleLockedBy 일치', (await vehicleLockedBy(pc)).byContract === c1);
}

// ── 2. 해제 → 복원 (버그 #1: 이전엔 계약중에 영구히 남았음) ──
head('2. 계약금 체크 해제 → 출고가능 복원');
{
  const { pc, codes: [c1] } = await fixture(1);
  await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes');
  check('선점됨', (await vehStatus(pc)) === '계약중');
  await applyStepCheck(await ct(c1), 'agent_balance_paid', ''); // 오클릭 취소
  check('해제 후 출고가능', (await vehStatus(pc)) === '출고가능', await vehStatus(pc));
  check('락 주인 비워짐', (await owner(pc)) === '', await owner(pc));
}

// ── 3. 해제 후 재선점 (버그 #1의 자기잠금 데드락) ──
head('3. 해제 후 재선점 — 자기잠금 데드락 없음');
{
  const { pc, codes: [c1] } = await fixture(1);
  await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes');
  await applyStepCheck(await ct(c1), 'agent_balance_paid', '');
  let threw = '';
  try { await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes'); }
  catch (e) { threw = (e as Error).message; }
  check('재선점 성공(예외 없음)', threw === '', threw);
  check('다시 계약중', (await vehStatus(pc)) === '계약중', await vehStatus(pc));
  check('주인 복구', (await owner(pc)) === c1, await owner(pc));
}

// ── 4. 경쟁 — 남의 선점은 차단 ──
head('4. 다른 계약이 선점한 차량 — 중복 선점 차단');
{
  const { pc, codes: [c1, c2] } = await fixture(2);
  await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes');
  let threw = '';
  try { await applyStepCheck(await ct(c2), 'agent_balance_paid', 'yes'); }
  catch (e) { threw = (e as Error).message; }
  check('2번째 선점은 예외', threw !== '', threw);
  check('주인은 여전히 1번', (await owner(pc)) === c1, await owner(pc));
  check('상태 유지', (await vehStatus(pc)) === '계약중');
}

// ── 5. 본인 계약의 후속 체크는 통과 ──
head('5. 선점자 본인의 후속 체크(입금확인)는 통과');
{
  const { pc, codes: [c1] } = await fixture(1);
  await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes');
  let threw = '';
  try { await asRole('provider', async () => applyStepCheck(await ct(c1), 'provider_balance_confirmed', 'yes')); }
  catch (e) { threw = (e as Error).message; }
  check('예외 없음', threw === '', threw);
  check('여전히 계약중', (await vehStatus(pc)) === '계약중', await vehStatus(pc));
}

// ── 6. 삭제보호 — 서류 단계 진행 중인 매물 ──
head('6. 삭제보호 — 입금 전(서류 단계)에도 진행 계약이면 차단');
{
  const { pc, codes: [c1] } = await fixture(1);
  check('진행 없음 → 삭제 허용', (await blockingContractFor(pc)) === '');
  await applyStepCheck(await ct(c1), 'agent_delivery_inquiry', 'yes');
  await asRole('provider', async () => applyStepCheck(await ct(c1), 'provider_delivery_response', '출고 가능'));
  check('1단계 완료 → 삭제 차단', (await blockingContractFor(pc)) === c1, await blockingContractFor(pc));
  check('락은 아직 없음(문의만으론 잠금 안 함)', (await vehicleLockedBy(pc)).status === null);
}

// ── 7. 취소 → 복원 ──
head('7. 계약 취소 → 락 해제');
{
  const { pc, codes: [c1] } = await fixture(1);
  await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes');
  await cancelContract(await ct(c1));
  check('취소 후 출고가능', (await vehStatus(pc)) === '출고가능', await vehStatus(pc));
  check('주인 비워짐', (await owner(pc)) === '', await owner(pc));
}

// ── 8. 수기 상태 보존 — 상품화중은 덮지 않는다 ──
head('8. 수기 상태(상품화중) 보존 — 거절/취소가 강제 출고가능으로 덮지 않음');
{
  const { pc, codes: [c1] } = await fixture(1, '상품화중');
  await applyStepCheck(await ct(c1), 'agent_delivery_inquiry', 'yes');
  check('문의 후에도 상품화중 유지', (await vehStatus(pc)) === '상품화중', await vehStatus(pc));
  await asRole('provider', async () => applyStepCheck(await ct(c1), 'provider_delivery_response', '출고 불가')); // 거절
  check('거절 후에도 상품화중 유지', (await vehStatus(pc)) === '상품화중', await vehStatus(pc));
}

// ── 9. 구데이터 치유 — 주인 없는 계약중 ──
head('9. 주인 없는 계약중(소유필드 이전 잔재) — 자기잠금 안 됨');
{
  const { pc, codes: [c1] } = await fixture(1, '계약중'); // locked_by_contract 없음
  let threw = '';
  try { await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes'); }
  catch (e) { threw = (e as Error).message; }
  check('선점 통과(구데이터에 막히지 않음)', threw === '', threw);
  check('주인 각인됨', (await owner(pc)) === c1, await owner(pc));
}

// ── 10. 트윈 코드 선점 차단 ──
head('10. 같은 실차의 다른 매물코드 — 중복 선점 차단');
{
  const sharedPlate = '88하8801';
  const { pc: pc1, codes: [c1] } = await fixture(1, '출고가능', sharedPlate);
  const { pc: pc2, codes: [c2] } = await fixture(1, '출고가능', sharedPlate);
  await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes');
  let threw = '';
  try { await applyStepCheck(await ct(c2), 'agent_balance_paid', 'yes'); }
  catch (e) { threw = (e as Error).message; }
  check('트윈 2번째 선점은 예외', /선점 불가|중복 계약 불가/.test(threw), threw);
  check('첫 코드 락 유지', (await owner(pc1)) === c1, await owner(pc1));
  check('둘째 코드는 출고가능 유지', (await vehStatus(pc2)) === '출고가능', await vehStatus(pc2));
}

// ── 11. placeholder 번호는 서로 다른 차량 ──
head('11. 번호 미정 차량 — 서로 트윈으로 묶지 않음');
{
  const { codes: [c1] } = await fixture(1, '출고가능', '-');
  const { pc: pc2, codes: [c2] } = await fixture(1, '출고가능', '-');
  await applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes');
  let threw = '';
  try { await applyStepCheck(await ct(c2), 'agent_balance_paid', 'yes'); }
  catch (e) { threw = (e as Error).message; }
  check('번호 미정 2번째 차량 선점 허용', threw === '', threw);
  check('둘째 차량이 자기 계약으로 잠김', (await owner(pc2)) === c2, await owner(pc2));
}

// ── 12. 취소된 5/5 계약 재완료 금지 ──
head('12. 취소된 완료대기 계약 — 재시도로 되살리지 않음');
{
  const { pc, codes: [c1] } = await fixture(1);
  await store.update('contract', co, c1, { ...allDone, contract_status: '계약취소' });
  const finalized = await finalizeContractIfReady(await ct(c1));
  check('완료 처리 결과 false', finalized === false, finalized);
  check('계약취소 유지', (await ct(c1)).contract_status === '계약취소', (await ct(c1)).contract_status);
  check('정산 미생성', (await store.get('settlement', co, `ST_${c1}`)) == null);
  check('차량 잠금 없음', (await vehStatus(pc)) === '출고가능', await vehStatus(pc));
}

// ── 13. 완료처리 재시도도 트윈 중복완료 차단 ──
head('13. 완료처리 재시도 — 트윈의 기존 완료계약 우회 차단');
{
  const sharedPlate = '77호7701';
  const { codes: [doneCode] } = await fixture(1, '출고가능', sharedPlate);
  const { pc: retryProduct, codes: [retryCode] } = await fixture(1, '출고가능', sharedPlate);
  await store.update('contract', co, doneCode, { contract_status: '계약완료' });
  await store.update('contract', co, retryCode, { ...allDone, contract_status: '계약요청' });
  let threw = '';
  try { await finalizeContractIfReady(await ct(retryCode)); }
  catch (e) { threw = (e as Error).message; }
  check('트윈 완료 재시도는 예외', /이중판매 불가/.test(threw), threw);
  check('재시도 계약은 완료되지 않음', (await ct(retryCode)).contract_status === '계약요청', (await ct(retryCode)).contract_status);
  check('재시도 정산 미생성', (await store.get('settlement', co, `ST_${retryCode}`)) == null);
  check('재시도 차량 잠금 없음', (await vehStatus(retryProduct)) === '출고가능', await vehStatus(retryProduct));
}

// ── 14. 동시 선점은 정확히 하나만 성공해야 함 ──
head('14. 같은 차량 동시 선점 — 한 계약만 성공');
{
  const { pc, codes: [c1, c2] } = await fixture(2);
  const results = await Promise.allSettled([
    applyStepCheck(await ct(c1), 'agent_balance_paid', 'yes'),
    applyStepCheck(await ct(c2), 'agent_balance_paid', 'yes'),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled').length;
  const claims = [await ct(c1), await ct(c2)].filter((contract) => contract.agent_balance_paid === 'yes').length;
  check('동시 요청 성공은 1건', fulfilled === 1, { fulfilled, results: results.map((result) => result.status) });
  check('계약금 선점 기록도 1건', claims === 1, { claims, owner: await owner(pc) });
}

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) { console.log(`   ✗ 실패 ${fail}건`); process.exit(1); }
