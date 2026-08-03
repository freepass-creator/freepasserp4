/** 실행: npx tsx scripts/sim-sheet-identity-decision.mts */
import { readFileSync } from 'node:fs';
import {
  DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID,
  DIFFERENT_VEHICLE_CREATE_REVIEW,
  DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID,
  EXCLUDE_SHEET_ROW,
  SAME_VEHICLE_ACCEPT_ATOM_UPDATE,
  SAME_VEHICLE_KEEP_OLD_PENDING_ID,
  SAME_VEHICLE_RESTORE_REVIEW,
  identityConflictPlates,
  identityDecisionFingerprint,
  isSheetIdentityDecisionProtected,
  validSheetIdentityDecisionInput,
} from '../lib/domain/sheet-identity-decision';
import {
  PENDING_IDENTITY_DRIFT_CATEGORY,
  PENDING_SIGNATURE_CATEGORY,
  UNOWNED_DELETED_CATEGORY,
} from '../lib/domain/sheet-identity-conflict-review';

let pass = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL ${name}`);
  pass++;
  console.log(`PASS ${name}`);
};

const base = (category: typeof UNOWNED_DELETED_CATEGORY | typeof PENDING_IDENTITY_DRIFT_CATEGORY | typeof PENDING_SIGNATURE_CATEGORY, raw: string) => ({
  fingerprint: identityDecisionFingerprint(category, raw),
  category,
  raw,
  provider: 'RP020',
  existingKey: 'OLD-1',
  incomingKey: 'NEW-1',
});
const unownedRaw = '12가3456 (D-1 ↔ RP020)';
const unowned = base(UNOWNED_DELETED_CATEGORY, unownedRaw);
const driftRaw = 'RP020 (기존 100신0002 ↔ 신규 100신0003)';
const drift = base(PENDING_IDENTITY_DRIFT_CATEGORY, driftRaw);
const signatureRaw = 'RP020|100신0001';
const signature = base(PENDING_SIGNATURE_CATEGORY, signatureRaw);

check('미확정 삭제의 동일·다른 차량·Sheet 오류 판단 허용',
  validSheetIdentityDecisionInput({ ...unowned, decision: SAME_VEHICLE_RESTORE_REVIEW })
  && validSheetIdentityDecisionInput({ ...unowned, decision: DIFFERENT_VEHICLE_CREATE_REVIEW })
  && validSheetIdentityDecisionInput({ ...unowned, decision: EXCLUDE_SHEET_ROW }));
check('번호미정 식별변경의 기존·신규 임시번호 판단 허용',
  validSheetIdentityDecisionInput({ ...drift, decision: SAME_VEHICLE_KEEP_OLD_PENDING_ID })
  && validSheetIdentityDecisionInput({ ...drift, decision: DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID }));
check('임시번호 신원불일치의 원자수정·신규번호 판단 허용',
  validSheetIdentityDecisionInput({ ...signature, decision: SAME_VEHICLE_ACCEPT_ATOM_UPDATE })
  && validSheetIdentityDecisionInput({ ...signature, decision: DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID }));
check('충돌 종류와 맞지 않는 판단 거부', !validSheetIdentityDecisionInput({
  ...unowned, decision: SAME_VEHICLE_KEEP_OLD_PENDING_ID,
}));
check('원문이 바뀌면 과거 지문 무효', !validSheetIdentityDecisionInput({
  ...unowned, raw: '12가3457 (D-1 ↔ RP020)', decision: SAME_VEHICLE_RESTORE_REVIEW,
}));
check('빈 공급사·기존키·Sheet키와 과도한 원문 거부',
  !validSheetIdentityDecisionInput({ ...unowned, provider: '', decision: SAME_VEHICLE_RESTORE_REVIEW })
  && !validSheetIdentityDecisionInput({ ...unowned, existingKey: '', decision: SAME_VEHICLE_RESTORE_REVIEW })
  && !validSheetIdentityDecisionInput({ ...unowned, incomingKey: '', decision: SAME_VEHICLE_RESTORE_REVIEW })
  && !validSheetIdentityDecisionInput({ ...unowned, raw: 'x'.repeat(1_001), decision: SAME_VEHICLE_RESTORE_REVIEW }));
check('세 충돌 원문에서 보호 차량번호를 정확히 추출',
  identityConflictPlates(unownedRaw, UNOWNED_DELETED_CATEGORY).join(',') === '12가3456'
  && identityConflictPlates(signatureRaw, PENDING_SIGNATURE_CATEGORY).join(',') === '100신0001'
  && identityConflictPlates(driftRaw, PENDING_IDENTITY_DRIFT_CATEGORY).join(',') === '100신0002,100신0003');
check('파싱할 수 없는 신원 원문은 fail-closed', isSheetIdentityDecisionProtected(
  '형식 오류', PENDING_IDENTITY_DRIFT_CATEGORY, [], [],
));
check('계약락·계약중 재고는 판단 기록 금지', isSheetIdentityDecisionProtected(
  signatureRaw, PENDING_SIGNATURE_CATEGORY,
  [{ _key: 'OLD-1', car_number: '100신0001', locked_by_contract: 'C-1' }], [],
) && isSheetIdentityDecisionProtected(
  signatureRaw, PENDING_SIGNATURE_CATEGORY,
  [{ _key: 'OLD-1', car_number: '100신0001', vehicle_status: '계약중' }], [],
));
check('상품키·차량번호 진행계약은 판단 기록 금지', isSheetIdentityDecisionProtected(
  signatureRaw, PENDING_SIGNATURE_CATEGORY,
  [{ _key: 'OLD-1', car_number: '100신0001' }],
  [{ contract_code: 'C-1', product_code: 'OLD-1', contract_status: '계약요청' }],
) && isSheetIdentityDecisionProtected(
  signatureRaw, PENDING_SIGNATURE_CATEGORY,
  [{ _key: 'OLD-1', car_number: '100신0001' }],
  [{ contract_code: 'C-2', car_number_snapshot: '100신0001', contract_status: '심사중' }],
));
check('완료계약은 현재 판단 기록 차단사유 아님', !isSheetIdentityDecisionProtected(
  signatureRaw, PENDING_SIGNATURE_CATEGORY,
  [{ _key: 'OLD-1', car_number: '100신0001' }],
  [{ contract_code: 'C-1', product_code: 'OLD-1', contract_status: '계약완료' }],
));

const route = readFileSync('app/api/sheet/identity-decisions/route.ts', 'utf8');
check('신원 결정 API는 관리자 인증·v4 원장·계약보호 재검증을 요구',
  route.includes('verifyAdminBearer')
  && route.includes("const DECISION_PATH = 'v4/sheet_identity_decisions'")
  && route.includes('isSheetIdentityDecisionProtected')
  && route.includes("ref('v4').update(updates)"));
check('신원 원장과 감사로그에는 원본 충돌 문자열을 저장하지 않음',
  !route.includes('raw: item.raw') && !route.includes('raw: text(item.raw)'));
check('철회 대상 0건은 감사로그 쓰기 전에 종료',
  route.indexOf("if (!eligible.length) return NextResponse.json({ revoked: 0 })")
    < route.lastIndexOf('const auditId'));
const dailySync = readFileSync('lib/domain/sheet-daily-sync.ts', 'utf8');
const sheetCommit = readFileSync('lib/domain/sheet-sync-all.ts', 'utf8');
check('신원 결정 기록은 자동·수동 동기화나 복구 작업에 소비되지 않음',
  !dailySync.includes('SheetIdentityDecision') && !sheetCommit.includes('SheetIdentityDecision'));

console.log(`sheet identity decision: ${pass}/15 PASS`);
