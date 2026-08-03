/** 실행: npx tsx scripts/sim-sheet-conflict-resolution.mts */
import {
  applySheetConflictResolutions,
  KEEP_EXISTING_PRICES,
  PRICE_PERIOD_CONFLICT,
  sheetConflictFingerprint,
  validPriceResolutionInput,
} from '../lib/domain/sheet-conflict-resolution';
import type { SheetSyncExistingConflicts } from '../lib/domain/sheet-sync-all';

let pass = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL ${name}`);
  pass++;
  console.log(`PASS ${name}`);
};
const raw = 'RP023|12가3456 (12_3만,18_2만)';
const fingerprint = sheetConflictFingerprint(PRICE_PERIOD_CONFLICT, raw);
const conflicts: SheetSyncExistingConflicts = {
  activeTwins: [], crossProviderPlateConflicts: [], deletedCollisions: [], unownedDeletedMatches: [],
  manualReactivations: [], manualHoldsPreserved: [], pendingIdentityTransitions: [], pendingIdentityDrifts: [],
  pendingSignatureConflicts: [], missingPricePeriods: [raw], unownedLegacyMatches: [],
};
const resolution = {
  fingerprint, category: PRICE_PERIOD_CONFLICT, decision: KEEP_EXISTING_PRICES,
  status: 'approved' as const,
};

check('지문은 같은 충돌에서 결정적', fingerprint === sheetConflictFingerprint(PRICE_PERIOD_CONFLICT, raw));
check('원문 기간이 바뀌면 과거 승인 무효', fingerprint !== sheetConflictFingerprint(PRICE_PERIOD_CONFLICT, `${raw},24_2만`));
check('허용 결정과 지문 검증', validPriceResolutionInput({ ...resolution, raw }));
check('null·비객체 승인 입력 거부', !validPriceResolutionInput(null) && !validPriceResolutionInput('approval'));
check('과도하게 긴 원문 승인 입력 거부', !validPriceResolutionInput({
  ...resolution,
  raw: 'x'.repeat(1_001),
}));
check('승인된 비계약 가격 누락만 해제', applySheetConflictResolutions({
  conflicts, resolutions: [resolution], existing: [{ car_number: '12가3456', provider_company_code: 'RP023' }],
}).conflicts.missingPricePeriods.length === 0);
check('계약락 차량은 승인돼도 차단 유지', applySheetConflictResolutions({
  conflicts, resolutions: [resolution], existing: [{ car_number: '12가3456', provider_company_code: 'RP023', locked_by_contract: 'C-1' }],
}).conflicts.missingPricePeriods.length === 1);
check('진행계약 차량은 승인돼도 차단 유지', applySheetConflictResolutions({
  conflicts, resolutions: [resolution], existing: [{ _key: 'P-1', car_number: '12가3456', provider_company_code: 'RP023' }],
  contracts: [{ contract_code: 'C-1', product_code: 'P-1', contract_status: '계약요청' }],
}).conflicts.missingPricePeriods.length === 1);
check('완료계약은 현재 가격 승인 차단사유 아님', applySheetConflictResolutions({
  conflicts, resolutions: [resolution], existing: [{ _key: 'P-1', car_number: '12가3456', provider_company_code: 'RP023' }],
  contracts: [{ contract_code: 'C-1', product_code: 'P-1', contract_status: '계약완료' }],
}).conflicts.missingPricePeriods.length === 0);
check('revoked 승인은 차단 유지', applySheetConflictResolutions({
  conflicts, resolutions: [{ ...resolution, status: 'revoked' }], existing: [],
}).conflicts.missingPricePeriods.length === 1);

console.log(`sheet conflict resolution: ${pass}/10 PASS`);
