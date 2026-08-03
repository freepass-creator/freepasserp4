/** 실행: npx tsx scripts/sim-sheet-conflict-decision.mts */
import { readFileSync } from 'node:fs';
import {
  ASSIGN_SHEET_OWNER,
  DELETED_REAPPEARANCE_CONFLICT,
  KEEP_DELETED,
  KEEP_EXISTING_OWNER,
  OWNERSHIP_CONFLICT,
  RESTORE_DELETED,
  conflictDecisionPlate,
  decisionFingerprint,
  isSheetConflictDecisionProtected,
  validSheetConflictDecisionInput,
} from '../lib/domain/sheet-conflict-decision';

let pass = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL ${name}`);
  pass++;
  console.log(`PASS ${name}`);
};

const ownershipRaw = '12가3456 (RP001 ↔ RP023)';
const ownershipFingerprint = decisionFingerprint(OWNERSHIP_CONFLICT, ownershipRaw);
const ownershipInput = {
  fingerprint: ownershipFingerprint,
  category: OWNERSHIP_CONFLICT,
  decision: KEEP_EXISTING_OWNER,
  raw: ownershipRaw,
  provider: 'RP001',
  productKey: 'P-1',
};
const deletedRaw = '34나5678';
const deletedInput = {
  fingerprint: decisionFingerprint(DELETED_REAPPEARANCE_CONFLICT, deletedRaw),
  category: DELETED_REAPPEARANCE_CONFLICT,
  decision: RESTORE_DELETED,
  raw: deletedRaw,
  provider: 'RP023',
  productKey: 'P-2',
};

check('소유권 유지 결정과 원문 지문 검증', validSheetConflictDecisionInput(ownershipInput));
check('Sheet 공급사 변경 결정 허용', validSheetConflictDecisionInput({
  ...ownershipInput,
  decision: ASSIGN_SHEET_OWNER,
  provider: 'RP023',
}));
check('삭제 유지·복구 결정 허용', validSheetConflictDecisionInput(deletedInput)
  && validSheetConflictDecisionInput({ ...deletedInput, decision: KEEP_DELETED }));
check('충돌 종류와 맞지 않는 결정 거부', !validSheetConflictDecisionInput({
  ...ownershipInput,
  decision: RESTORE_DELETED,
}));
check('원문이 바뀌면 과거 결정 지문 무효', !validSheetConflictDecisionInput({
  ...ownershipInput,
  raw: '12가3456 (RP001 ↔ RP024)',
}));
check('null·과도하게 긴 원문 거부', !validSheetConflictDecisionInput(null)
  && !validSheetConflictDecisionInput({ ...ownershipInput, raw: 'x'.repeat(1_001) }));
check('대상 공급사·상품키가 없는 결정 거부', !validSheetConflictDecisionInput({ ...ownershipInput, provider: '' })
  && !validSheetConflictDecisionInput({ ...ownershipInput, productKey: '' }));
check('공급사 접두 원문에서도 차량번호 추출', conflictDecisionPlate('RP023|12가3456 (P-1)') === '12가3456');
check('계약락·계약중 재고는 결정 금지', isSheetConflictDecisionProtected(
  ownershipRaw,
  [{ _key: 'P-1', car_number: '12가3456', locked_by_contract: 'C-1' }],
  [],
) && isSheetConflictDecisionProtected(
  ownershipRaw,
  [{ _key: 'P-1', car_number: '12가3456', vehicle_status: '계약중' }],
  [],
));
check('상품키·차량번호 진행계약은 결정 금지', isSheetConflictDecisionProtected(
  ownershipRaw,
  [{ _key: 'P-1', car_number: '12가3456' }],
  [{ contract_code: 'C-1', product_code: 'P-1', contract_status: '계약요청' }],
) && isSheetConflictDecisionProtected(
  ownershipRaw,
  [{ _key: 'P-1', car_number: '12가3456' }],
  [{ contract_code: 'C-2', car_number_snapshot: '12가3456', contract_status: '심사중' }],
));
check('완료계약은 현재 결정 차단사유 아님', !isSheetConflictDecisionProtected(
  ownershipRaw,
  [{ _key: 'P-1', car_number: '12가3456' }],
  [{ contract_code: 'C-1', product_code: 'P-1', contract_status: '계약완료' }],
));
check('차량번호를 특정할 수 없으면 fail-closed', isSheetConflictDecisionProtected('', [], []));
const decisionRouteSource = readFileSync('app/api/sheet/conflict-decisions/route.ts', 'utf8');
check('결정 API는 관리자 인증·v4 원장·계약보호 재검증을 요구',
  decisionRouteSource.includes('verifyAdminBearer')
  && decisionRouteSource.includes("const DECISION_PATH = 'v4/sheet_conflict_decisions'")
  && decisionRouteSource.includes('isSheetConflictDecisionProtected')
  && decisionRouteSource.includes("ref('v4').update(updates)"));
check('결정 원장과 감사로그에는 원본 충돌 문자열을 저장하지 않음',
  !decisionRouteSource.includes('raw: item.raw')
  && !decisionRouteSource.includes('raw: text(item.raw)'));
const dailySyncSource = readFileSync('lib/domain/sheet-daily-sync.ts', 'utf8');
const sheetCommitSource = readFileSync('lib/domain/sheet-sync-all.ts', 'utf8');
check('결정 기록은 아직 수동·자동 동기화 차단 해제에 소비되지 않음',
  !dailySyncSource.includes('SheetConflictDecision')
  && !sheetCommitSource.includes('SheetConflictDecision'));

console.log(`sheet conflict decision: ${pass}/15 PASS`);
