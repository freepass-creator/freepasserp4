import assert from 'node:assert/strict';
import {
  explicitVehicleDisplacementCc,
  hasBoundedVehiclePhrase,
  isStrictVehiclePhrasePrefix,
  mostSpecificBoundedVehiclePhrases,
  vehicleEvidenceTokens,
  vehicleBodyForm,
  vehicleRangeClass,
} from '../lib/domain/vehicle-master-format';
import { normDrive } from '../lib/domain/vehicle-master-match';
import {
  canonicalVehicleTrimSignal,
  explicitSupplierTrimSignal,
  vehicleTrimSignalMatches,
} from '../lib/domain/vehicle-trim-evidence';

assert.equal(explicitSupplierTrimSignal('롱레인지 19인치(EXCLUSIVE) · EV'), 'Exclusive');
assert.equal(explicitSupplierTrimSignal('롱레인지 20인치(PRESTIGE)0 · EV'), 'Prestige');
assert.equal(explicitSupplierTrimSignal('LPG 2.0렌터카 비지니스1 · 최초등록 26-8'), '비지니스1');
assert.equal(explicitSupplierTrimSignal('LPG 2.0렌터카 비지니스2 · 최초등록 26-8'), '비지니스2');
assert.equal(explicitSupplierTrimSignal('스포티지 2.0 LPi 노블레스 그래비티 2WD'), '노블레스 그래비티');
assert.equal(explicitSupplierTrimSignal('더 뉴 쏘렌토 2.2 디젤 2WD 7인승 시그니처 그래비티'), '시그니처 그래비티');
assert.equal(explicitSupplierTrimSignal('PRESTIGEPLUS'), '', 'partial English token must not be accepted');
assert.equal(canonicalVehicleTrimSignal('\u2160'), canonicalVehicleTrimSignal('I'));

assert.equal(canonicalVehicleTrimSignal('EXCLUSIVE'), canonicalVehicleTrimSignal('익스클루시브'));
assert.equal(canonicalVehicleTrimSignal('PRESTIGE'), canonicalVehicleTrimSignal('프레스티지'));
assert.equal(canonicalVehicleTrimSignal('비지니스1'), canonicalVehicleTrimSignal('비즈니스 1'));
assert.equal(canonicalVehicleTrimSignal('기본'), canonicalVehicleTrimSignal('기본 사양'));
assert.notEqual(canonicalVehicleTrimSignal('기본'), canonicalVehicleTrimSignal('스포츠 패키지'));
assert.equal(vehicleTrimSignalMatches('M Sport Pack', '20i M 스포츠'), true);
assert.equal(vehicleTrimSignalMatches('블랙', '캘리그래피 블랙에디션'), true);
assert.equal(vehicleTrimSignalMatches('아방가르드', 'E200 아방가르드 리미티드'), false);
assert.equal(vehicleTrimSignalMatches('기본형', '기본형 5인승'), true);

assert.deepEqual(vehicleEvidenceTokens('플래티넘Ⅱ'), ['플래티넘', 'ii']);
assert.equal(hasBoundedVehiclePhrase('더 K9 플래티넘Ⅱ', '플래티넘 II'), true);
assert.equal(hasBoundedVehiclePhrase('플래티넘 베스트셀렉션Ⅰ', '베스트 셀렉션 I'), true);
assert.equal(hasBoundedVehiclePhrase('BMW 220i 어드밴티지', '220i 어드밴티지'), true);
assert.equal(hasBoundedVehiclePhrase('PRESTIGEPLUS', 'PRESTIGE'), false);
assert.equal(hasBoundedVehiclePhrase('The New SPORTAGE', 'Sport'), false);
assert.equal(isStrictVehiclePhrasePrefix('45 TFSI', '45 TFSI 프리미엄'), true);
assert.equal(isStrictVehiclePhrasePrefix('플래티넘 II', '플래티넘'), false);
assert.equal(normDrive('quattro'), '4WD');
assert.equal(normDrive('4MATIC'), '4WD');
assert.equal(explicitVehicleDisplacementCc('싼타페 R2.0 2WD'), 2000);
assert.equal(explicitVehicleDisplacementCc('G80 가솔린 3.3T AWD'), 3300);
assert.equal(vehicleRangeClass('아이오닉 5 롱레인지'), 'long_range');
assert.equal(vehicleRangeClass('Model Y Standard'), 'standard');
assert.equal(vehicleBodyForm('GV80 Coupe'), 'coupe');
assert.deepEqual(
  mostSpecificBoundedVehiclePhrases('프레스티지 스페셜', ['프레스티지', '프레스티지 스페셜']),
  ['프레스티지 스페셜'],
  '긴 완전명이 실제로 적혔으면 짧은 접두 트림을 제거한다',
);
assert.deepEqual(
  mostSpecificBoundedVehiclePhrases('프레스티지', ['프레스티지', '프레스티지 스페셜']),
  ['프레스티지'],
  '짧은 트림만 적혔으면 존재하지 않는 긴 트림을 추정하지 않는다',
);
assert.deepEqual(
  mostSpecificBoundedVehiclePhrases(
    '더 뉴 K9 플래티넘 베스트셀렉션Ⅰ',
    ['플래티넘', '베스트 셀렉션 I'],
  ),
  ['베스트 셀렉션 I'],
  '한 차량에서 두 후보 트림이 함께 보이면 더 구체적인 완전명을 선택한다',
);

const trustedStatedYear = (stated: number | undefined, registered: number | undefined) =>
  stated && (!registered || Math.abs(stated - registered) <= 2) ? stated : undefined;
assert.equal(trustedStatedYear(2025, 2020), undefined, '오염 연식은 후보 기간축에 쓰면 안 됨');
assert.equal(trustedStatedYear(2023, 2022), 2023);

console.log('sim-product-coverage-explicit-trim: PASS');
