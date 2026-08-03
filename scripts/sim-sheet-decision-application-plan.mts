/** 실행: npx tsx scripts/sim-sheet-decision-application-plan.mts */
import {
  ASSIGN_SHEET_OWNER,
  DELETED_REAPPEARANCE_CONFLICT,
  KEEP_DELETED,
  KEEP_EXISTING_OWNER,
  OWNERSHIP_CONFLICT,
  RESTORE_DELETED,
  decisionFingerprint,
  type SheetConflictDecision,
} from '../lib/domain/sheet-conflict-decision';
import {
  planSheetConflictDecisionDryRun,
  type SheetConflictDecisionTarget,
} from '../lib/domain/sheet-conflict-decision-dry-run';
import {
  DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID,
  DIFFERENT_VEHICLE_CREATE_REVIEW,
  EXCLUDE_SHEET_ROW,
  SAME_VEHICLE_ACCEPT_ATOM_UPDATE,
  SAME_VEHICLE_RESTORE_REVIEW,
  type SheetIdentityDecision,
} from '../lib/domain/sheet-identity-decision';
import {
  PENDING_SIGNATURE_CATEGORY,
  UNOWNED_DELETED_CATEGORY,
  type SheetIdentityConflictReview,
  type SheetIdentityReviewRow,
} from '../lib/domain/sheet-identity-conflict-review';
import {
  planSheetDecisionApplication,
  sheetDecisionApplicationPlanTsv,
} from '../lib/domain/sheet-decision-application-plan';

let pass = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL ${name}`);
  pass++;
  console.log(`PASS ${name}`);
};

const target = (patch: Partial<SheetConflictDecisionTarget> = {}): SheetConflictDecisionTarget => ({
  category: OWNERSHIP_CONFLICT,
  raw: '12가3456 (RP001 ↔ RP023)',
  fingerprint: decisionFingerprint(OWNERSHIP_CONFLICT, '12가3456 (RP001 ↔ RP023)'),
  carNumber: '12가3456',
  providers: ['RP001'],
  sheetProviders: ['RP023'],
  productKeys: ['RP001_12가3456'],
  contractProtections: [],
  mergedAlias: false,
  ...patch,
});
const decision = (
  row: SheetConflictDecisionTarget,
  value: SheetConflictDecision['decision'],
  provider: string,
): SheetConflictDecision => ({
  fingerprint: row.fingerprint,
  category: row.category,
  decision: value,
  status: 'recorded',
  provider,
  product_key: row.productKeys[0],
});
const identityReview = (rows: SheetIdentityReviewRow[] = []): SheetIdentityConflictReview => ({
  generatedAt: 1,
  rows,
  summary: {
    total: rows.length,
    unownedDeleted: rows.filter((row) => row.category === UNOWNED_DELETED_CATEGORY).length,
    pendingIdentityDrift: 0,
    pendingSignature: rows.filter((row) => row.category === PENDING_SIGNATURE_CATEGORY).length,
    protected: rows.filter((row) => !!row.contractProtection).length,
    unownedSingleCandidates: rows.filter((row) => row.status === 'unowned_deleted_single_candidate').length,
    ambiguous: rows.filter((row) => row.status === 'unowned_deleted_ambiguous').length,
    executableOperations: 0,
    changedAtomCounts: {},
  },
});
const identityRow = (patch: Partial<SheetIdentityReviewRow> = {}): SheetIdentityReviewRow => ({
  raw: 'RP020|100신0001',
  fingerprint: 'SCR-1111111111111111',
  category: PENDING_SIGNATURE_CATEGORY,
  status: 'pending_signature_review',
  provider: 'RP020',
  carNumbers: ['100신0001'],
  existingKeys: ['OLD-1'],
  incomingKeys: ['NEW-1'],
  changedAtoms: ['외장색'],
  contractProtection: '',
  mergedAlias: false,
  reason: '신원서명 변경',
  nextAction: '동일 차량 여부 확인',
  applyAllowed: false,
  ...patch,
});
const identityDecision = (
  row: SheetIdentityReviewRow,
  value: SheetIdentityDecision['decision'],
  patch: Partial<SheetIdentityDecision> = {},
): SheetIdentityDecision => ({
  fingerprint: row.fingerprint,
  category: row.category,
  decision: value,
  status: 'recorded',
  provider: row.provider,
  existing_key: row.existingKeys[0],
  incoming_key: row.incomingKeys[0],
  ...patch,
});

const baseInput = {
  incoming: [
    { product_code: 'RP023_12가3456', car_number: '12가3456', provider_company_code: 'RP023' },
    { product_code: 'NEW-1', car_number: '100신0001', provider_company_code: 'RP020' },
  ],
  records: [{ product_code: 'RP001_12가3456', car_number: '12가3456' }, { product_code: 'OLD-1', car_number: '100신0001' }],
  providerCodes: ['RP001', 'RP020', 'RP023'],
  references: {
    contracts: [{ contract_code: 'C-1', product_code: 'RP001_12가3456', contract_status: '계약완료' }],
    rooms: [{ _key: 'R-1', product_code: 'RP001_12가3456' }],
    quotes: [{ quote_code: 'Q-1', car_number: '12가3456' }],
  },
};

const ownership = target();
const keepPlan = planSheetDecisionApplication({
  ...baseInput,
  conflictPlan: planSheetConflictDecisionDryRun({
    targets: [ownership], decisions: [decision(ownership, KEEP_EXISTING_OWNER, 'RP001')],
  }),
  identityReview: identityReview(),
  identityDecisions: [],
});
check('기존 공급사 유지 결정은 Sheet 유입 제외 후보', keepPlan.rows[0].kind === 'exclude_sheet_row'
  && keepPlan.rows[0].status === 'candidate_review');
check('유입 제외 후보는 원본 지문 원장 경로만 제안', keepPlan.rows[0].candidatePaths[0] === `v4/sheet_sync_exclusions/${ownership.fingerprint}`);

const ownerMove = planSheetDecisionApplication({
  ...baseInput,
  conflictPlan: planSheetConflictDecisionDryRun({
    targets: [ownership], decisions: [decision(ownership, ASSIGN_SHEET_OWNER, 'RP023')],
  }),
  identityReview: identityReview(), identityDecisions: [],
});
check('공급사 변경은 단순 상품 patch가 아닌 참조 이관 계획', ownerMove.rows[0].kind === 'migrate_owner_references'
  && ownerMove.rows[0].status === 'requires_reference_migration');
check('계약·채팅·견적 참조를 모두 집계', ownerMove.rows[0].references.contracts === 1
  && ownerMove.rows[0].references.rooms === 1 && ownerMove.rows[0].references.quotes === 1);
check('공급사 변경은 공개·private 양쪽 후보경로 표시', ownerMove.rows[0].candidatePaths.includes('v4/products_private/RP001_12가3456')
  && ownerMove.rows[0].candidatePaths.includes('v4/products/RP023_12가3456'));

const deleted = target({
  category: DELETED_REAPPEARANCE_CONFLICT,
  raw: '34나5678',
  fingerprint: decisionFingerprint(DELETED_REAPPEARANCE_CONFLICT, '34나5678'),
  carNumber: '34나5678', providers: ['RP023'], sheetProviders: ['RP023'], productKeys: ['RP023_34나5678'],
});
const deletedIncoming = [{ product_code: 'RP023_34나5678', car_number: '34나5678', provider_company_code: 'RP023' }];
const keepDeleted = planSheetDecisionApplication({
  ...baseInput, incoming: deletedIncoming,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [deleted], decisions: [decision(deleted, KEEP_DELETED, 'RP023')] }),
  identityReview: identityReview(), identityDecisions: [],
});
check('삭제 유지 결정도 Sheet 유입 제외 후보', keepDeleted.rows[0].kind === 'exclude_sheet_row');
const restore = planSheetDecisionApplication({
  ...baseInput, incoming: deletedIncoming,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [deleted], decisions: [decision(deleted, RESTORE_DELETED, 'RP023')] }),
  identityReview: identityReview(), identityDecisions: [],
});
check('동일 삭제키 복구는 v4 overlay 후보만 생성', restore.rows[0].kind === 'restore_deleted_overlay'
  && restore.rows[0].candidatePaths.join() === 'v4/products/RP023_34나5678');
check('복구 후보도 실제 적용은 불허', restore.rows[0].applyAllowed === false);

const identity = identityRow();
const sameVehicle = planSheetDecisionApplication({
  ...baseInput,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview([identity]),
  identityDecisions: [identityDecision(identity, SAME_VEHICLE_ACCEPT_ATOM_UPDATE)],
});
check('동일 임시차 판단은 변경 원자만 기존키 patch 후보', sameVehicle.rows[0].kind === 'update_identity_atoms'
  && sameVehicle.rows[0].candidateFields.join() === '외장색');

const differentVehicle = planSheetDecisionApplication({
  ...baseInput,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview([identity]),
  identityDecisions: [identityDecision(identity, DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID)],
});
check('다른 임시차 판단은 신규 상품 create 후보', differentVehicle.rows[0].kind === 'create_product'
  && differentVehicle.rows[0].candidatePaths.join() === 'v4/products/NEW-1');
check('신규 후보키가 이미 ERP에 있으면 fail-closed', planSheetDecisionApplication({
  ...baseInput,
  records: [...baseInput.records, { product_code: 'NEW-1' }],
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview([identity]),
  identityDecisions: [identityDecision(identity, DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID)],
}).rows[0].status === 'blocked_ambiguous');

const unowned = identityRow({
  raw: '56다7890 (D-1 ↔ RP020)', fingerprint: 'SCR-2222222222222222', category: UNOWNED_DELETED_CATEGORY,
  status: 'unowned_deleted_single_candidate', carNumbers: ['56다7890'], existingKeys: ['D-1'], incomingKeys: ['RP020_56다7890'],
});
const unownedIncoming = [{ product_code: 'RP020_56다7890', car_number: '56다7890', provider_company_code: 'RP020' }];
const unownedRestore = planSheetDecisionApplication({
  ...baseInput, incoming: unownedIncoming,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview([unowned]),
  identityDecisions: [identityDecision(unowned, SAME_VEHICLE_RESTORE_REVIEW)],
});
check('공급사 미확정 삭제의 동일차 판단은 기존 삭제키 복구 후보', unownedRestore.rows[0].kind === 'restore_deleted_overlay'
  && unownedRestore.rows[0].candidatePaths.join() === 'v4/products/D-1');
const unownedNew = planSheetDecisionApplication({
  ...baseInput, incoming: unownedIncoming,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview([unowned]),
  identityDecisions: [identityDecision(unowned, DIFFERENT_VEHICLE_CREATE_REVIEW)],
});
check('공급사 미확정 삭제의 다른차 판단은 Sheet키 신규 생성 후보', unownedNew.rows[0].kind === 'create_product');
check('Sheet 오류 판단은 신원 충돌도 유입 제외 후보', planSheetDecisionApplication({
  ...baseInput, incoming: unownedIncoming,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview([unowned]),
  identityDecisions: [identityDecision(unowned, EXCLUDE_SHEET_ROW)],
}).rows[0].kind === 'exclude_sheet_row');

check('계약보호는 기록된 판단보다 우선 차단', planSheetDecisionApplication({
  ...baseInput,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview([{ ...identity, contractProtection: '진행계약 C-9', status: 'contract_protected' }]),
  identityDecisions: [identityDecision(identity, SAME_VEHICLE_ACCEPT_ATOM_UPDATE)],
}).rows[0].status === 'blocked_contract');
check('현재 대상과 공급사·키가 다른 원장은 차단', planSheetDecisionApplication({
  ...baseInput,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview([identity]),
  identityDecisions: [identityDecision(identity, SAME_VEHICLE_ACCEPT_ATOM_UPDATE, { incoming_key: 'WRONG' })],
}).rows[0].status === 'blocked_ledger');
check('현재 충돌에 없는 신원 원장은 stale로 보고', planSheetDecisionApplication({
  ...baseInput,
  conflictPlan: planSheetConflictDecisionDryRun({ targets: [], decisions: [] }),
  identityReview: identityReview(),
  identityDecisions: [identityDecision(identity, SAME_VEHICLE_ACCEPT_ATOM_UPDATE)],
}).summary.staleLedger === 1);

const overlapIdentity = identityRow({ existingKeys: ['RP001_12가3456'], incomingKeys: ['NEW-2'] });
const overlap = planSheetDecisionApplication({
  ...baseInput,
  incoming: [...baseInput.incoming, { product_code: 'NEW-2', car_number: '100신0001', provider_company_code: 'RP020' }],
  conflictPlan: planSheetConflictDecisionDryRun({
    targets: [ownership], decisions: [decision(ownership, KEEP_EXISTING_OWNER, 'RP001')],
  }),
  identityReview: identityReview([overlapIdentity]),
  identityDecisions: [identityDecision(overlapIdentity, SAME_VEHICLE_ACCEPT_ATOM_UPDATE)],
});
check('서로 다른 판단이 같은 상품키를 건드리면 중복 계획 차단', overlap.rows.every((row) => row.status === 'blocked_overlap'));
check('모든 적용계획은 실행작업 0으로 고정', overlap.summary.executableOperations === 0
  && [...keepPlan.rows, ...ownerMove.rows, ...restore.rows].every((row) => row.applyAllowed === false));
const tsv = sheetDecisionApplicationPlanTsv(ownerMove);
check('TSV는 참조수·후보경로·적용불가를 포함', tsv.includes('참조계약')
  && tsv.includes('v4/products_private/RP001_12가3456') && tsv.includes('\tNO'));

console.log(`sheet decision application plan: ${pass}/20 PASS`);
