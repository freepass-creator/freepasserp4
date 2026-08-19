import assert from 'node:assert/strict';
import {
  VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS,
  VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS,
  buildVehicleMasterReviewPromotionEntries,
  finalizeVehicleMasterReviewAdoptionRows,
  matchesGoogleSheetHiddenProperty,
  splitVehicleMasterLegacyKeys,
  summarizeVehicleMasterReviewPromotion,
} from '../lib/domain/vehicle-master-review-promotion';

const row = (key: string, status: string, marker = '') => VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS.map((header) => {
  if (header === '기존 트림행키') return key;
  if (header === '검증상태') return status;
  if (header === '세부트림') return marker || '기본형';
  if (header === '확인질문') return marker === '질문' ? '연료: 가솔린 / 하이브리드 중 확인' : '추가 질문 없음';
  return `${header}-값`;
});
const live = [
  { trimRowKey: 'key-a', sheetRow: 10 },
  { trimRowKey: 'key-b', sheetRow: 20 },
  { trimRowKey: 'key-c', sheetRow: 30 },
];
const keys = new Set(['key-a', 'key-b', 'key-c']);
const fingerprint = (_row: unknown[], reviewSheetRow: number) => `sha256:${String(reviewSheetRow).padStart(64, '0')}`;

assert.equal(matchesGoogleSheetHiddenProperty(undefined, false), true);
assert.equal(matchesGoogleSheetHiddenProperty(false, false), true);
assert.equal(matchesGoogleSheetHiddenProperty(true, false), false);
assert.equal(matchesGoogleSheetHiddenProperty(true, true), true);
assert.equal(matchesGoogleSheetHiddenProperty(undefined, true), false);
assert.equal(matchesGoogleSheetHiddenProperty('false', false), false);
assert.equal(matchesGoogleSheetHiddenProperty(null, false), false);
assert.equal(matchesGoogleSheetHiddenProperty(0, false), false);
assert.equal(matchesGoogleSheetHiddenProperty(false, true), false);
assert.deepEqual(splitVehicleMasterLegacyKeys('key-a|key-b\nkey-a'), ['key-a', 'key-b']);
const entries = buildVehicleMasterReviewPromotionEntries({
  reviewHeaders: [...VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS],
  reviewRows: [row('key-a', '구조확인'), row('key-b|key-c', '중복통합검토', '질문')],
  liveMasterKeyRows: live,
  knownArtifactKeys: keys,
  groupFingerprintForRow: fingerprint,
});
assert.equal(entries.length, 3);
assert.equal(entries[0].currentMasterSheetRow, 10);
assert.equal(entries[0].targetValues.length, VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS.length);
assert.equal(entries[0].targetValues[2], '채택대기');
assert.equal(entries[1].targetValues[2], '검토유지');
assert.equal(entries[1].groupFingerprint, entries[2].groupFingerprint);
assert.deepEqual(summarizeVehicleMasterReviewPromotion(entries), {
  keyRows: 3,
  reviewGroups: 2,
  singleKeyGroups: 1,
  twoKeyGroups: 1,
  maxKeysPerGroup: 2,
  pendingHumanAdoption: 1,
  pendingWithoutSelectionQuestions: 1,
  pendingWithSelectionQuestions: 0,
  reviewOnly: 2,
  operationalStatusChanges: 0,
  byReviewStatus: { 구조확인: 1, 중복통합검토: 2 },
  minCurrentMasterSheetRow: 10,
  maxCurrentMasterSheetRow: 30,
});
const pendingWithQuestion = buildVehicleMasterReviewPromotionEntries({
  reviewHeaders: [...VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS],
  reviewRows: [row('key-a', '구조확인', '질문')],
  liveMasterKeyRows: live,
  knownArtifactKeys: keys,
  groupFingerprintForRow: fingerprint,
});
assert.equal(pendingWithQuestion[0].targetValues[2], '채택대기(선택질문유지)');
assert.equal(summarizeVehicleMasterReviewPromotion(pendingWithQuestion).pendingWithSelectionQuestions, 1);
const approvedRows = finalizeVehicleMasterReviewAdoptionRows(
  [...entries, ...pendingWithQuestion],
  '2026-08-17T12:34:56.000Z',
  '사용자 직전승인 · test-plan-sha256',
);
assert.equal(approvedRows[0][2], '규격구조채택');
assert.equal(approvedRows[1][2], '검토유지');
assert.equal(approvedRows[1][3], '');
assert.equal(approvedRows[1][4], '');
assert.equal(approvedRows.at(-1)?.[2], '규격구조채택(선택질문유지)');
assert.equal(approvedRows[0][3], '2026-08-17T12:34:56.000Z');
assert.equal(approvedRows[0][4], '사용자 직전승인 · test-plan-sha256');
assert.equal(approvedRows[0][5], '없음');
assert.throws(() => finalizeVehicleMasterReviewAdoptionRows(entries, '2026-08-17', '근거'), /승인시각/);
assert.throws(() => buildVehicleMasterReviewPromotionEntries({
  reviewHeaders: [...VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS],
  reviewRows: [row('key-a', '구조확인'), row('key-a', '구조확인')],
  liveMasterKeyRows: live,
  knownArtifactKeys: keys,
  groupFingerprintForRow: fingerprint,
}), /중복 참조/);
assert.throws(() => buildVehicleMasterReviewPromotionEntries({
  reviewHeaders: [...VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS],
  reviewRows: [row('missing', '구조확인')],
  liveMasterKeyRows: live,
  knownArtifactKeys: keys,
  groupFingerprintForRow: fingerprint,
}), /artifact에 없는/);
assert.throws(() => buildVehicleMasterReviewPromotionEntries({
  reviewHeaders: [...VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS],
  reviewRows: [row('key-a', '구조확인'), row('key-b', '구조확인')],
  liveMasterKeyRows: live,
  knownArtifactKeys: keys,
  groupFingerprintForRow: () => `sha256:${'a'.repeat(64)}`,
}), /중복 규격 행/);
assert.throws(() => buildVehicleMasterReviewPromotionEntries({
  reviewHeaders: [...VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS],
  reviewRows: [row('key-a', '구조확인')],
  liveMasterKeyRows: [{ trimRowKey: 'key-a', sheetRow: 10 }, { trimRowKey: 'key-a', sheetRow: 11 }],
  knownArtifactKeys: keys,
  groupFingerprintForRow: fingerprint,
}), /영구키가 중복/);

console.log('PASS vehicle master review promotion — live-keyed companion tab, human-approval pending, no operational status mutation');
