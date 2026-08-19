/** ERP5 내부코드·레거시 별칭·결정키 회귀검사. RTDB write 없음. */
import assert from 'node:assert/strict';
import {
  ID_PREFIX,
  displayNumber,
  isId,
  newId,
  relatedId,
  settlementIdForContract,
  settlementStorageKeyForContract,
  stableId,
} from '../lib/domain/ids';
import {
  canonicalEntityCode,
  entityCodeAliases,
  matchesEntityCode,
} from '../lib/domain/code-identity';

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
};

await test('모든 ERP5 prefix가 중복 없이 정의됨', () => {
  const prefixes = Object.values(ID_PREFIX);
  assert.equal(new Set(prefixes).size, prefixes.length);
});

await test('신규 ID는 prefix_10자 규격', () => {
  for (const kind of Object.keys(ID_PREFIX) as (keyof typeof ID_PREFIX)[]) {
    const code = newId(kind);
    assert.equal(isId(kind, code), true, `${kind}: ${code}`);
  }
  assert.equal(isId('user', 'usr_park'), false);
  assert.equal(isId('contract', 'TMP-260101-01'), false);
});

await test('동일 업무 식별값은 동일한 결정 ID', async () => {
  const a = await stableId('room', 'product:RP001_1234|agent:legacy-user');
  const b = await stableId('room', 'product:RP001_1234|agent:legacy-user');
  const c = await stableId('room', 'product:RP001_5678|agent:legacy-user');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(isId('room', a), true);
  assert.equal(a.includes('RP001'), false);
});

await test('계약-정산 1:1 코드는 멱등', () => {
  const contract = newId('contract');
  const settlement = relatedId('contract', 'settlement', contract);
  assert.equal(isId('settlement', settlement), true);
  assert.equal(settlementIdForContract(contract), settlement);
  assert.equal(settlementStorageKeyForContract(contract), `ST_${contract}`);
  assert.equal(settlementIdForContract('TMP-260101-01'), 'ST_TMP-260101-01');
});

await test('표시번호는 내부 ID와 분리됨', () => {
  const contract = 'con_abcdefghjk';
  assert.equal(displayNumber('contract', contract, '2026-08-15'), 'FP-C-20260815-EFGHJK');
});

await test('신구 코드 별칭으로 동일 레코드 조회 가능', () => {
  const record = {
    _key: 'firebase-auth-uid',
    user_code: 'usr_abcdefghjk',
    legacy_user_code: 'RP030',
    legacy_codes: ['SP001'],
  };
  assert.equal(canonicalEntityCode('user', record), 'usr_abcdefghjk');
  assert.equal(matchesEntityCode('user', record, 'firebase-auth-uid'), true);
  assert.equal(matchesEntityCode('user', record, 'RP030'), true);
  assert.equal(matchesEntityCode('user', record, 'SP001'), true);
  assert.deepEqual(entityCodeAliases('user', record), ['usr_abcdefghjk', 'firebase-auth-uid', 'RP030', 'SP001']);
});

console.log(`ERP5 CODE SYSTEM ${passed}/${passed} PASS`);
