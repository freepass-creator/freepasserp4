import assert from 'node:assert/strict';
import { driverAgeRange, residentAgeOn, residentIdInfo } from '../lib/domain/esign-resident-id';

assert.equal(residentIdInfo('900101-1234567')?.birthDate, '1990-01-01');
assert.equal(residentIdInfo('050101-3234567')?.birthDate, '2005-01-01');
assert.equal(residentIdInfo('901332-1234567'), null, '존재하지 않는 생년월일은 거절');
assert.equal(residentIdInfo('900101-9234567')?.birthDate, '1890-01-01');
assert.equal(residentAgeOn('050101-3234567', '2026-01-01'), 21);
assert.equal(residentAgeOn('050102-3234567', '2026-01-01'), 20);
assert.deepEqual(driverAgeRange('만 26세 이상 · 만 70세 이하'), { min: 26, max: 70 });
assert.deepEqual(driverAgeRange('만 21세 이상'), { min: 21, max: null });
assert.deepEqual(driverAgeRange('만 18세 이상'), { min: 21, max: null });
assert.deepEqual(driverAgeRange(''), { min: 21, max: null });

console.log('✓ 주민등록번호 생년월일 파생 및 계약 운전자 연령 범위 해석');
