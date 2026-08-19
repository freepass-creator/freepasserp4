import assert from 'node:assert/strict';
import {
  VEHICLE_MASTER_HEADERS_WITH_POWERTRAIN,
  VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN,
  buildAdoptionIntoMasterPlan,
  dropPowertrainColumnFromValues,
  isEligibleAdoptionStatus,
} from '../lib/domain/vehicle-master-adoption-into-master';
import { composePowertrainLabel, resolvePowertrainLabel } from '../lib/domain/vehicle-powertrain-label';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import {
  TRIM_KEY_SEMANTIC_HEADERS_V3,
  auditTrimKeyContract,
  trimKeyRecordsFromValues,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';

assert.equal(composePowertrainLabel({ fuel: '가솔린', displacement_l: 2.5, turbo: false, drivetrain: '2WD' }), '가솔린 2.5 2WD');
assert.equal(composePowertrainLabel({ fuel: '가솔린', displacement_l: 3, turbo: false, drivetrain: '2WD' }), '가솔린 3.0 2WD');
assert.equal(composePowertrainLabel({ fuel: '전기', drivetrain: 'AWD' }), '전기 AWD');
assert.equal(
  resolvePowertrainLabel({ sheetLabel: '', priorLabel: 'LPG 2.5T 2WD 자동5단', axes: { fuel: 'LPG', displacement_l: 2.5, turbo: true, drivetrain: '2WD' } }),
  'LPG 2.5T 2WD 자동5단',
  'prior 라벨이 합성보다 이긴다',
);

const masterHeader = [...VEHICLE_MASTER_HEADERS_WITH_POWERTRAIN];
const masterRow = [
  '확정', '확정', '신차', '국산', '현대', '아반떼', '아반떼 CN7', '가솔린 1.6 2WD', '스마트',
  'mf-test::v01::t01', 'mf-test', 1, 1, 'CN7', 'CN7', '2020-01', '현재', '2021', '현재',
  '가솔린', 1591, 1.6, '아니오', '2WD', 5, '', '', 'https://example.com', '근거', '2026-08-18', '승용', '',
];
const masterRow2 = [
  '확정', '확정', '신차', '국산', '현대', '아반떼', '아반떼 CN7', '가솔린 1.6 2WD', '인스퍼레이션',
  'mf-test::v01::t02', 'mf-test', 1, 2, 'CN7', 'CN7', '2020-01', '현재', '2021', '현재',
  '가솔린', 1591, 1.6, '아니오', '2WD', 5, '', '', 'https://example.com', '근거', '2026-08-18', '승용', '',
];

const adoptionHeader = [
  '트림행키', '규격그룹키', '규격채택상태', '채택승인기록시각', '채택승인근거', '운영등급변경',
  '규격_제조국', '규격_제조사', '규격_모델', '규격_세부모델', '규격_세부트림',
  '규격_연료', '규격_배기량cc', '규격_과급', '규격_배터리kWh', '규격_구동', '규격_구동시스템', '규격_인승',
  '규격_차종분류', '규격_차체형태', '규격_연식시작', '규격_연식종료', '규격_생산시작', '규격_생산종료',
  '규격_기존 세부모델', '규격_공식근거', '규격_기존 트림행키', '규격_검증상태', '규격_확인필요항목', '규격_확인질문',
];
const adoptionRow = (key: string, status: string, trim: string, fuel = '가솔린') => [
  key, 'sha256:abc', status, '2026-08-18T00:00:00.000Z', 'test', '없음',
  '국산', '현대', '아반떼', '더 뉴 아반떼 CN7', trim,
  fuel, '1591', '아니오', '', '2WD', '', '5',
  '승용', '세단', '2021', '현재', '2020-01', '현재',
  '아반떼 CN7', 'https://example.com', key, '구조확인', '', '추가 질문 없음',
];

assert.equal(isEligibleAdoptionStatus('규격구조채택'), true);
assert.equal(isEligibleAdoptionStatus('규격구조채택(선택질문유지)'), true);
assert.equal(isEligibleAdoptionStatus('검토유지'), false);

const plan = buildAdoptionIntoMasterPlan({
  masterValues: [masterHeader, masterRow, masterRow2],
  adoptionValues: [
    adoptionHeader,
    adoptionRow('mf-test::v01::t01', '규격구조채택', '스마트'),
    adoptionRow('mf-test::v01::t02', '검토유지', '인스퍼레이션'),
  ],
});
assert.equal(plan.eligibleKeys, 1);
assert.equal(plan.nameChangeKeys, 1);
assert.ok(plan.namePatches.some((p) => p.column === '세부모델' && p.to === '더 뉴 아반떼 CN7'));
assert.equal(plan.skippedReviewOnly, 1);

const driftPlan = buildAdoptionIntoMasterPlan({
  masterValues: [masterHeader, masterRow],
  adoptionValues: [adoptionHeader, adoptionRow('mf-test::v01::t01', '규격구조채택', '스마트', '하이브리드')],
});
assert.ok(driftPlan.semanticDrift.some((p) => p.column === '연료' && p.to === '하이브리드'));

const dropped = dropPowertrainColumnFromValues([masterHeader, masterRow, masterRow2]);
assert.deepEqual(dropped[0], [...VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN]);
assert.equal((dropped[0] as string[]).includes('파워트레인'), false);

const prior = new Map([['mf-test::v01::t01', '가솔린 1.6 2WD'], ['mf-test::v01::t02', '가솔린 1.6 2WD']]);
const artifact = buildVehicleTrimMasterArtifact(dropped, 'sheet', '차종마스터', { priorPowertrainByKey: prior });
assert.equal(artifact.records[0].powertrain, '가솔린 1.6 2WD');
assert.equal(artifact.records.find((r) => r.trim_row_key === 'mf-test::v01::t01')?.sub_model, '아반떼 CN7');

const records = trimKeyRecordsFromValues(dropped, [...TRIM_KEY_SEMANTIC_HEADERS_V3]);
const registry: TrimKeyRegistry = {
  schemaVersion: 3,
  spreadsheetId: 'sheet',
  sheetName: '차종마스터',
  capturedAt: '2026-08-18',
  semanticHeaders: [...TRIM_KEY_SEMANTIC_HEADERS_V3],
  records,
};
assert.equal(auditTrimKeyContract(registry, records).ok, true);

console.log('PASS — adoption-into-master plan · powertrain prior · V3 key headers');
