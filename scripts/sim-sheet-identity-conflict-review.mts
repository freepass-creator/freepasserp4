/** 실행: npx tsx scripts/sim-sheet-identity-conflict-review.mts */
import {
  planSheetIdentityConflictReview,
  sheetIdentityConflictReviewTsv,
} from '../lib/domain/sheet-identity-conflict-review';
import type { SheetSyncExistingConflicts } from '../lib/domain/sheet-sync-all';

let pass = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL ${name}`);
  pass++;
  console.log(`PASS ${name}`);
};
const conflicts = (patch: Partial<SheetSyncExistingConflicts> = {}): SheetSyncExistingConflicts => ({
  activeTwins: [],
  crossProviderPlateConflicts: [],
  deletedCollisions: [],
  unownedDeletedMatches: [],
  manualReactivations: [],
  manualHoldsPreserved: [],
  pendingIdentityTransitions: [],
  pendingIdentityDrifts: [],
  pendingSignatureConflicts: [],
  missingPricePeriods: [],
  unownedLegacyMatches: [],
  ...patch,
});
const deleted = {
  _key: 'D-1', product_code: 'D-1', car_number: '12가3456', _deleted: true,
  maker: '현대', model: '아반떼', trim_name: '모던', ext_color: '흰색', fuel_type: '가솔린',
};
const incoming = {
  _key: 'RP023_12가3456', product_code: 'RP023_12가3456', car_number: '12가3456', provider_company_code: 'RP023',
  maker: '현대', model: '아반떼', trim_name: '모던', ext_color: '흰색', fuel_type: '가솔린',
};
const unowned = planSheetIdentityConflictReview({
  conflicts: conflicts({ unownedDeletedMatches: ['12가3456 (D-1 ↔ RP023)'] }),
  existing: [], deleted: [deleted], incoming: [incoming], providerCodes: ['RP023'],
});
check('공급사 없는 삭제 1건과 단일 Sheet 행을 검토 후보로 분류',
  unowned.rows[0].status === 'unowned_deleted_single_candidate');
check('미확정 삭제 후보도 자동 적용 금지', unowned.rows[0].applyAllowed === false
  && unowned.summary.executableOperations === 0);
check('삭제 레코드와 Sheet 행의 신원 원자가 같으면 변경원자 없음', unowned.rows[0].changedAtoms.length === 0);

const changed = planSheetIdentityConflictReview({
  conflicts: conflicts({ unownedDeletedMatches: ['12가3456 (D-1 ↔ RP023)'] }),
  existing: [], deleted: [deleted], incoming: [{ ...incoming, ext_color: '검정' }], providerCodes: ['RP023'],
});
check('미확정 삭제의 변경 원자를 필드명으로 분리', changed.rows[0].changedAtoms.includes('외장색'));
check('병합 별칭 삭제이력은 단일 후보에서도 모호 차단', planSheetIdentityConflictReview({
  conflicts: conflicts({ unownedDeletedMatches: ['12가3456 (D-1 ↔ RP023)'] }),
  existing: [], deleted: [{ ...deleted, _merged_into: 'P-KEEP' }], incoming: [incoming], providerCodes: ['RP023'],
}).rows[0].status === 'unowned_deleted_ambiguous');
check('삭제 레코드가 여러 개면 대표 대상 확정 전 차단', planSheetIdentityConflictReview({
  conflicts: conflicts({ unownedDeletedMatches: ['12가3456 (D-1 ↔ RP023)'] }),
  existing: [], deleted: [deleted, { ...deleted, _key: 'D-2', product_code: 'D-2' }], incoming: [incoming], providerCodes: ['RP023'],
}).rows[0].status === 'unowned_deleted_ambiguous');
check('진행계약이 차번으로 연결되면 미확정 삭제도 계약보호', planSheetIdentityConflictReview({
  conflicts: conflicts({ unownedDeletedMatches: ['12가3456 (D-1 ↔ RP023)'] }),
  existing: [], deleted: [deleted], incoming: [incoming], providerCodes: ['RP023'],
  contracts: [{ contract_code: 'C-1', car_number_snapshot: '12가3456', contract_status: '계약요청' }],
}).rows[0].status === 'contract_protected');
check('완료계약은 현재 신원검토 보호사유 아님', planSheetIdentityConflictReview({
  conflicts: conflicts({ unownedDeletedMatches: ['12가3456 (D-1 ↔ RP023)'] }),
  existing: [], deleted: [deleted], incoming: [incoming], providerCodes: ['RP023'],
  contracts: [{ contract_code: 'C-1', car_number_snapshot: '12가3456', contract_status: '계약완료' }],
}).rows[0].status === 'unowned_deleted_single_candidate');

const pendingOld = {
  _key: 'RP020_100신0001', product_code: 'RP020_100신0001', car_number: '100신0001',
  provider_company_code: 'RP020', is_pending_plate: true, maker: '르노', model: '콜레오스', trim_name: '아이코닉', ext_color: '흰색',
};
const pendingNew = { ...pendingOld, ext_color: '검정' };
const signature = planSheetIdentityConflictReview({
  conflicts: conflicts({ pendingSignatureConflicts: ['RP020|100신0001'] }),
  existing: [pendingOld], deleted: [], incoming: [pendingNew], providerCodes: ['RP020'],
});
check('같은 임시번호 신원서명 변경을 별도 검토로 분류', signature.rows[0].status === 'pending_signature_review');
check('임시번호 서명 변경 원자에 외장색 표시', signature.rows[0].changedAtoms.includes('외장색'));
check('계약락 임시번호는 신원 판단보다 보호 우선', planSheetIdentityConflictReview({
  conflicts: conflicts({ pendingSignatureConflicts: ['RP020|100신0001'] }),
  existing: [{ ...pendingOld, locked_by_contract: 'C-2' }], deleted: [], incoming: [pendingNew], providerCodes: ['RP020'],
}).rows[0].status === 'contract_protected');

const driftOld = { ...pendingOld, car_number: '100신0002', _key: 'RP020_100신0002', product_code: 'RP020_100신0002' };
const driftNew = { ...pendingNew, car_number: '100신0003', _key: 'RP020_100신0003', product_code: 'RP020_100신0003' };
const drift = planSheetIdentityConflictReview({
  conflicts: conflicts({ pendingIdentityDrifts: ['RP020 (기존 100신0002 ↔ 신규 100신0003)'] }),
  existing: [driftOld], deleted: [], incoming: [driftNew], providerCodes: ['RP020'],
});
check('기존→신규 임시번호 식별변경을 파싱', drift.rows[0].status === 'pending_identity_drift_review'
  && drift.rows[0].carNumbers.length === 2);
check('식별변경도 기존·신규 원자 차이를 보고', drift.rows[0].changedAtoms.includes('외장색'));

const combined = planSheetIdentityConflictReview({
  conflicts: conflicts({
    unownedDeletedMatches: ['12가3456 (D-1 ↔ RP023)'],
    pendingSignatureConflicts: ['RP020|100신0001'],
    pendingIdentityDrifts: ['RP020 (기존 100신0002 ↔ 신규 100신0003)'],
  }),
  existing: [pendingOld, driftOld], deleted: [deleted], incoming: [incoming, pendingNew, driftNew],
  providerCodes: ['RP020', 'RP023'],
});
check('세 차단군 합계와 유형별 수가 일치', combined.summary.total === 3
  && combined.summary.unownedDeleted === 1
  && combined.summary.pendingSignature === 1
  && combined.summary.pendingIdentityDrift === 1);
check('변경원자 집계는 차량 원문 값 없이 건수만 제공', combined.summary.changedAtomCounts['외장색'] === 2);
const tsv = sheetIdentityConflictReviewTsv(combined);
check('검토 TSV는 판단근거·다음조치·적용불가를 포함',
  tsv.includes('다음조치') && tsv.includes('외장색') && tsv.includes('\tNO'));
check('충돌이 없으면 검토행과 실행작업 모두 0', planSheetIdentityConflictReview({
  conflicts: conflicts(), existing: [], deleted: [], incoming: [],
}).summary.total === 0);

console.log(`sheet identity conflict review: ${pass}/17 PASS`);
