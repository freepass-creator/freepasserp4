/** 실행: npx tsx scripts/sim-sheet-conflict-decision-dry-run.mts */
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
  buildSheetConflictDecisionTargets,
  planSheetConflictDecisionDryRun,
  sheetConflictDecisionDryRunTsv,
  sheetConflictDecisionTargetBlockReason,
  type SheetConflictDecisionTarget,
} from '../lib/domain/sheet-conflict-decision-dry-run';
import type { SheetConflictReportRow } from '../lib/domain/sheet-conflict-report';

let pass = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL ${name}`);
  pass++;
  console.log(`PASS ${name}`);
};
const report = (patch: Partial<SheetConflictReportRow>): SheetConflictReportRow => ({
  category: OWNERSHIP_CONFLICT,
  decision: '실소유 공급사 확인',
  carNumber: '12가3456',
  provider: 'RP001',
  productKey: 'RP001_12가3456',
  storageKey: 'RP001_12가3456',
  vehicleStatus: '출고가능',
  source: 'sheet',
  contractProtection: '',
  priceImpact: '',
  affectedPricePeriods: '',
  raw: '12가3456 (RP001 ↔ RP023)',
  ...patch,
});
const targets = buildSheetConflictDecisionTargets({
  reportRows: [report({}), report({ storageKey: 'legacy-key' })],
  incoming: [{ car_number: '12가3456', provider_company_code: 'RP023' }],
  records: [{ product_code: 'RP001_12가3456', car_number: '12가3456' }],
  providerCodes: ['RP001', 'RP023'],
});
const ownership = targets[0];
const decision = (
  target: SheetConflictDecisionTarget,
  value: SheetConflictDecision['decision'],
  provider: string,
  patch: Partial<SheetConflictDecision> = {},
): SheetConflictDecision => ({
  fingerprint: target.fingerprint,
  category: target.category,
  decision: value,
  status: 'recorded',
  provider,
  product_key: target.productKeys[0],
  ...patch,
});

check('상세 리포트 여러 행을 원본 충돌 한 건으로 묶음', targets.length === 1 && ownership.productKeys.length === 1);
check('현재 Sheet 공급사를 유입 데이터에서 분리', ownership.providers[0] === 'RP001' && ownership.sheetProviders[0] === 'RP023');
check('미결정 대상은 작업 없이 판단 대기', planSheetConflictDecisionDryRun({ targets, decisions: [] }).rows[0].status === 'undecided');

const protectedTarget = { ...ownership, contractProtections: ['진행계약 C-1'] };
check('계약보호는 기록이 있어도 최우선 차단', planSheetConflictDecisionDryRun({
  targets: [protectedTarget],
  decisions: [decision(protectedTarget, KEEP_EXISTING_OWNER, 'RP001')],
}).rows[0].status === 'contract_protected');

const ambiguousTarget = { ...ownership, productKeys: ['P-1', 'P-2'] };
check('상품키 다중 대상은 결정 dry-run 차단', sheetConflictDecisionTargetBlockReason(ambiguousTarget).includes('상품키 2개')
  && planSheetConflictDecisionDryRun({ targets: [ambiguousTarget], decisions: [] }).rows[0].status === 'target_ambiguous');

check('기록 공급사·상품키가 현재와 다르면 원장 불일치', planSheetConflictDecisionDryRun({
  targets,
  decisions: [decision(ownership, KEEP_EXISTING_OWNER, 'RP999')],
}).rows[0].status === 'ledger_mismatch');
check('손상된 종류·결정 조합은 원장 불일치', planSheetConflictDecisionDryRun({
  targets,
  decisions: [decision(ownership, KEEP_DELETED, 'RP001')],
}).rows[0].status === 'ledger_mismatch');

const keepOwner = planSheetConflictDecisionDryRun({
  targets,
  decisions: [decision(ownership, KEEP_EXISTING_OWNER, 'RP001')],
});
check('기존 공급사 유지는 재고 patch 없는 유입제외 후보', keepOwner.rows[0].status === 'keep_existing_ready'
  && !keepOwner.rows[0].candidatePath);
check('Sheet 공급사 변경은 단순 patch 아닌 참조 이관 대상으로 분류', planSheetConflictDecisionDryRun({
  targets,
  decisions: [decision(ownership, ASSIGN_SHEET_OWNER, 'RP023')],
}).rows[0].status === 'assign_owner_migration');

const deletedRaw = '34나5678';
const deletedTarget: SheetConflictDecisionTarget = {
  category: DELETED_REAPPEARANCE_CONFLICT,
  raw: deletedRaw,
  fingerprint: decisionFingerprint(DELETED_REAPPEARANCE_CONFLICT, deletedRaw),
  carNumber: deletedRaw,
  providers: ['RP023'],
  sheetProviders: ['RP023'],
  productKeys: ['RP023_34나5678'],
  contractProtections: [],
  mergedAlias: false,
};
check('삭제 유지는 tombstone patch 없는 유입제외 후보', planSheetConflictDecisionDryRun({
  targets: [deletedTarget],
  decisions: [decision(deletedTarget, KEEP_DELETED, 'RP023')],
}).rows[0].status === 'keep_deleted_ready');
const restore = planSheetConflictDecisionDryRun({
  targets: [deletedTarget],
  decisions: [decision(deletedTarget, RESTORE_DELETED, 'RP023')],
});
check('동일키 삭제 복구는 v4 overlay 후보 경로만 생성', restore.rows[0].status === 'restore_overlay_candidate'
  && restore.rows[0].candidatePath === 'v4/products/RP023_34나5678'
  && restore.rows[0].applyAllowed === false);
check('병합 별칭 tombstone 복구 금지', planSheetConflictDecisionDryRun({
  targets: [{ ...deletedTarget, mergedAlias: true }],
  decisions: [decision({ ...deletedTarget, mergedAlias: true }, RESTORE_DELETED, 'RP023')],
}).rows[0].status === 'restore_forbidden_alias');
check('삭제 공급사와 Sheet 공급사가 다르면 대상 모호 차단', planSheetConflictDecisionDryRun({
  targets: [{ ...deletedTarget, sheetProviders: ['RP018'] }],
  decisions: [],
}).rows[0].status === 'target_ambiguous');

const stale = decision(ownership, KEEP_EXISTING_OWNER, 'RP001', { fingerprint: 'SCR-0000000000000000' });
check('현재 충돌에 없는 기록은 stale 원장으로 별도 보고', planSheetConflictDecisionDryRun({
  targets,
  decisions: [stale],
}).summary.staleLedger === 1);
check('모든 dry-run은 실행 가능한 작업 0으로 고정', restore.summary.executableOperations === 0);
const tsv = sheetConflictDecisionDryRunTsv(restore);
check('TSV는 후보 경로와 적용불가를 명시하고 원본 raw를 노출하지 않음',
  tsv.includes('v4/products/RP023_34나5678') && tsv.includes('\tNO') && !tsv.includes('원본충돌'));

console.log(`sheet conflict decision dry-run: ${pass}/16 PASS`);
