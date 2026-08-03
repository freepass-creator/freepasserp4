/** 실행: npx tsx scripts/sim-sheet-decision-patch-dry-run.mts */
import type {
  SheetDecisionApplicationPlan,
  SheetDecisionApplicationRow,
} from '../lib/domain/sheet-decision-application-plan';
import {
  planSheetDecisionPatchDryRun,
  sheetDecisionPatchDryRunJson,
  sheetDecisionPatchDryRunTsv,
} from '../lib/domain/sheet-decision-patch-dry-run';

let pass = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL ${name}`);
  pass++;
  console.log(`PASS ${name}`);
};

const row = (patch: Partial<SheetDecisionApplicationRow> = {}): SheetDecisionApplicationRow => ({
  source: 'ownership_or_deleted',
  fingerprint: 'SCR-1111111111111111',
  category: '공급사 소유 충돌',
  decisionCode: 'keep_existing_owner',
  decision: '기존 공급사 유지',
  provider: 'RP001',
  carNumbers: ['12가3456'],
  existingKey: 'OLD-1',
  incomingKey: 'NEW-1',
  kind: 'exclude_sheet_row',
  status: 'candidate_review',
  reason: '검토 후보',
  nextAction: '검토',
  candidatePaths: [],
  candidateFields: [],
  references: { contracts: 0, rooms: 0, quotes: 0, total: 0 },
  applyAllowed: false,
  ...patch,
});
const application = (rows: SheetDecisionApplicationRow[]): SheetDecisionApplicationPlan => ({
  generatedAt: 100,
  rows,
  summary: {
    total: rows.length,
    candidateReview: rows.filter((item) => item.status === 'candidate_review').length,
    referenceMigrations: 0,
    exclusions: rows.filter((item) => item.kind === 'exclude_sheet_row').length,
    restores: rows.filter((item) => item.kind === 'restore_deleted_overlay').length,
    creates: rows.filter((item) => item.kind === 'create_product').length,
    identityUpdates: rows.filter((item) => item.kind === 'update_identity_atoms').length,
    undecided: 0,
    blocked: 0,
    staleLedger: 0,
    executableOperations: 0,
  },
});
const run = (
  rows: SheetDecisionApplicationRow[],
  records: Record<string, unknown>[] = [],
  incoming: Record<string, unknown>[] = [],
) => planSheetDecisionPatchDryRun({
  applicationPlan: application(rows), records, incoming, companyId: 'freepass', now: 1_800_000_000_000,
});

const exclusion = run([row()]);
const exclusionOp = exclusion.rows[0].operations[0];
check('유입 제외는 지문 경로 create-if-absent', exclusionOp.path === 'v4/sheet_sync_exclusions/SCR-1111111111111111'
  && exclusionOp.mode === 'create_if_absent');
check('유입 제외 payload는 공급사·키·결정코드에 결속', exclusionOp.patch.provider === 'RP001'
  && exclusionOp.patch.existing_key === 'OLD-1' && exclusionOp.patch.incoming_key === 'NEW-1'
  && exclusionOp.patch.decision === 'keep_existing_owner');
check('유입 제외 payload는 차량번호·원본충돌 미저장', !JSON.stringify(exclusionOp.patch).includes('12가3456'));

const restoreRow = row({
  fingerprint: 'SCR-2222222222222222', category: '삭제이력 재등장', decisionCode: 'restore_deleted',
  kind: 'restore_deleted_overlay', existingKey: 'D-1', incomingKey: 'D-1', provider: 'RP020',
});
const existing = {
  _key: 'D-1', product_code: 'D-1', car_number: '34나5678', provider_company_code: 'RP020',
  _deleted: true, deletedAt: 'yesterday', deletedReason: 'old', status: 'deleted', vehicle_status: '출고불가',
  model: '기존모델', memo: '수기메모', updatedAt: 'before', vehicle_price: 30_000_000,
  price: { 36: { rent: 500_000, fee: 0.1 } },
};
const incoming = {
  _key: 'D-1', product_code: 'D-1', car_number: '34나5678', provider_company_code: 'RP020',
  model: '현재모델', memo: '', vehicle_status: '출고가능', price: { 36: { rent: 550_000 } },
};
const restore = run([restoreRow], [existing], [incoming]);
const restoreOp = restore.rows[0].operations[0];
check('삭제 복구는 동일 v4 상품키 update', restoreOp.path === 'v4/products/D-1' && restoreOp.mode === 'update');
check('삭제 복구는 삭제 표식과 legacy deleted status 해제', restoreOp.patch._deleted === null
  && restoreOp.patch.deletedAt === null && restoreOp.patch.deletedReason === null && restoreOp.patch.status === null);
check('삭제 복구는 Sheet 공개 soft-merge와 빈값 수기보존', restoreOp.patch.model === '현재모델'
  && restoreOp.patch.memo === undefined && (restoreOp.patch.price as Record<string, Record<string, unknown>>)['36'].rent === 550_000);
check('삭제 복구 patch와 CAS에 private 원가·수수료 미노출', !JSON.stringify(restoreOp).includes('30000000')
  && !JSON.stringify(restoreOp).includes('"fee"'));
check('삭제 복구 CAS는 patch필드와 계약·삭제 guard 포함', restoreOp.casFields.includes('model')
  && restoreOp.casFields.includes('locked_by_contract') && restoreOp.casFields.includes('updatedAt'));

const privateRestore = run([restoreRow], [existing], [{ ...incoming, vin: 'SECRET-VIN' }]);
check('Sheet 복구 입력에 private 필드가 있으면 전체 후보 차단', privateRestore.rows[0].status === 'blocked_private_input'
  && privateRestore.rows[0].operations.length === 0);

const createRow = row({
  fingerprint: 'SCR-3333333333333333', category: '임시번호 신원불일치', decisionCode: 'different_vehicle_allocate_new_pending_id',
  kind: 'create_product', existingKey: 'OLD-2', incomingKey: 'NEW-2', provider: 'RP020', source: 'identity',
});
const create = run([createRow], [], [{
  _key: 'NEW-2', product_code: 'NEW-2', car_number: '100신0002', provider_company_code: 'RP020', model: '쏘나타', source: 'sheet',
}]);
const createOp = create.rows[0].operations[0];
check('다른 차량은 신규키 create-if-absent', createOp.path === 'v4/products/NEW-2'
  && createOp.mode === 'create_if_absent' && createOp.casExpected === null);
check('신규 상품 payload에 회사·감사·결정지문 포함', createOp.patch.companyId === 'freepass'
  && createOp.patch.createdBy === 'sheet_decision_apply'
  && createOp.patch.sheet_decision_fingerprint === 'SCR-3333333333333333');
check('신규 Sheet 행 private 필드는 fail-closed', run([createRow], [], [{
  product_code: 'NEW-2', car_number: '100신0002', provider_company_code: 'RP020', account_number: 'SECRET',
}]).rows[0].status === 'blocked_private_input');

const identityRow = row({
  fingerprint: 'SCR-4444444444444444', category: '임시번호 신원불일치', decisionCode: 'same_vehicle_accept_atom_update',
  kind: 'update_identity_atoms', existingKey: 'OLD-3', incomingKey: 'NEW-3', provider: 'RP020', source: 'identity',
  candidateFields: ['외장색', '트림'],
});
const identity = run([identityRow], [{
  product_code: 'OLD-3', ext_color: '검정', trim_name: '프리미엄', vehicle_status: '출고가능', updatedAt: 'old', price: { 36: { rent: 1 } },
}], [{
  product_code: 'NEW-3', ext_color: '흰색', trim_name: '인스퍼레이션', vehicle_status: '출고불가', price: { 36: { rent: 9 } },
  _pending_signature: 'NEW-SIGNATURE',
}]);
const identityPatch = identity.rows[0].operations[0].patch;
check('신원 갱신은 승인된 원자와 새 서명만 patch', identityPatch.ext_color === '흰색'
  && identityPatch.trim_name === '인스퍼레이션' && identityPatch._pending_signature === 'NEW-SIGNATURE');
check('신원 갱신은 상태·가격을 따라오지 않음', identityPatch.vehicle_status === undefined && identityPatch.price === undefined);
check('동일한 신원 원자는 no-change', run([identityRow], [{
  product_code: 'OLD-3', ext_color: '흰색', trim_name: '인스퍼레이션', _pending_signature: 'NEW-SIGNATURE',
}], [{
  product_code: 'NEW-3', ext_color: '흰색', trim_name: '인스퍼레이션', _pending_signature: 'NEW-SIGNATURE',
}]).rows[0].status === 'no_change');

const migration = run([row({ kind: 'migrate_owner_references', status: 'requires_reference_migration' })]);
check('공급사 참조이관은 정책 승인 전 exact patch 생성 차단', migration.rows[0].status === 'blocked_reference_migration'
  && migration.rows[0].operations.length === 0);
check('상위 적용계획에서 차단된 행은 patch로 승격하지 않음', run([row({ status: 'blocked_contract' })]).rows[0].status === 'blocked_application_plan');
check('소스 레코드 누락은 fail-closed', run([restoreRow]).rows[0].status === 'blocked_source_missing');
check('요약의 실제 후보 수와 작업 수 일치·실행 0 고정', restore.summary.readyReview === 1
  && restore.summary.operationCount === 1 && restore.summary.executableOperations === 0);
const json = sheetDecisionPatchDryRunJson(restore);
check('검토 JSON에 exact patch·CAS는 있고 private 값은 없음', json.includes('"casExpected"')
  && json.includes('"_deleted": null') && !json.includes('30000000'));
const tsv = sheetDecisionPatchDryRunTsv(restore);
check('검토 TSV에 경로·patch필드·CAS필드·적용불가 포함', tsv.includes('v4/products/D-1')
  && tsv.includes('patch필드') && tsv.includes('CAS필드') && tsv.includes('\tNO'));

console.log(`sheet decision patch dry-run: ${pass}/21 PASS`);
