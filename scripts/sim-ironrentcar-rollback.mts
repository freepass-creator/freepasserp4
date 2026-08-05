import { readFileSync } from 'node:fs';
import { applyIronRentcarPublicOverlay } from '../lib/domain/ironrentcar-apply';
import { planIronRentcarReconcile } from '../lib/domain/ironrentcar-reconcile';
import {
  affectedProductsHaveContractLock,
  affectedProductsMatch,
  canonicalIronRentcarJson,
  failPreparedIronRentcarRun,
  IRONRENTCAR_ROOT_WRITE_MAX_BYTES,
  ironRentcarPlanKeys,
  ironRentcarRootWriteAllowed,
  ironRentcarRootWriteBytes,
  replaceAffectedProducts,
  restoreStoredSnapshot,
  rollbackRequestMatches,
  snapshotMatches,
  snapshotsForKeys,
  storedSnapshot,
  syncStateDigest,
  type IronRentcarSyncRun,
} from '../lib/domain/ironrentcar-rollback';
import type { IronRentcarCatalogItem } from '../lib/server/ironrentcar-source';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0;
const check = (name: string, ok: boolean): void => {
  if (!ok) throw new Error(name);
  pass++;
};
const item = (plate: string): IronRentcarCatalogItem => {
  const product: EntityRecord = {
    _key: `RP006_${plate}`,
    product_code: `RP006_${plate}`,
    car_number: plate,
    provider_company_code: 'RP006',
    vehicle_status: '출고가능',
    price: { 36: { rent: 600000, deposit: 1200000 } },
  };
  return {
    externalId: plate,
    sourceUrl: `https://ironrentcar.com/vehicles/${plate}`,
    condition: 'used',
    sold: false,
    product,
    privateProduct: {},
    policySnapshot: {},
    fingerprint: plate,
  };
};

const existing: EntityRecord[] = [
  {
    _key: 'RP006_11가1111', product_code: 'RP006_11가1111', car_number: '11가1111',
    provider_company_code: 'RP006', vehicle_status: '출고가능', updatedAt: 'before', custom: 'keep',
  },
  {
    _key: 'RP006_22나2222', product_code: 'RP006_22나2222', car_number: '22나2222',
    provider_company_code: 'RP006', vehicle_status: '출고가능', updatedAt: 'before', custom: 'absent-before',
  },
];
const plan = planIronRentcarReconcile({
  webItems: [item('11가1111'), item('33다3333')],
  existing,
  sourceComplete: true,
});
const keyPlan = ironRentcarPlanKeys(plan);
check('1 affected key 합집합은 정렬되고 counts 합과 일치',
  keyPlan.valid && keyPlan.keys.join(',') === [...keyPlan.keys].sort().join(',') && keyPlan.keys.length === 3);
const duplicatePlan = {
  ...plan,
  absentBlockCandidates: [...plan.absentBlockCandidates, plan.patchCandidates[0]],
};
check('1b patch/create/absent 중복 key 차단', !ironRentcarPlanKeys(duplicatePlan).valid);

const overlayBefore: Record<string, EntityRecord> = {
  RP006_22나2222: { ...existing[1] },
  unrelated: { _key: 'unrelated', product_code: 'unrelated', custom: 'untouched' },
};
const applied = applyIronRentcarPublicOverlay({
  currentOverlay: overlayBefore,
  plan,
  now: '2026-08-04T00:00:00.000Z',
  runId: 'run-1',
  revision: 'rev-1',
});
if (!applied.ok) throw new Error('fixture apply failed');
const before = snapshotsForKeys(overlayBefore, keyPlan.keys);
const after = snapshotsForKeys(applied.overlay, keyPlan.keys);
check('2 v3-only patch 상품의 v4 before는 exists:false', before.RP006_11가1111.exists === false);
check('3 기존 v4 상품 전체 preimage 보존',
  canonicalIronRentcarJson(before.RP006_22나2222.value) === canonicalIronRentcarJson(overlayBefore.RP006_22나2222));

const concurrent = { ...overlayBefore, RP006_22나2222: { ...overlayBefore.RP006_22나2222, custom: 'raced' } };
check('4 apply 전 affected 변경 시 전체 적용 중단', !replaceAffectedProducts(concurrent, before, after).ok);
const appliedReplace = replaceAffectedProducts(overlayBefore, before, after);
check('5 unrelated 상품 변경·값 보존', appliedReplace.ok && appliedReplace.products.unrelated === overlayBefore.unrelated);

const restored = replaceAffectedProducts(appliedReplace.products, after, before);
check('6 생성 상품 rollback은 v4 child 삭제', restored.ok && !restored.products.RP006_33다3333);
check('7 수정·부재차단 상품은 정확한 이전 객체 복원', restored.ok
  && canonicalIronRentcarJson(restored.products.RP006_22나2222) === canonicalIronRentcarJson(overlayBefore.RP006_22나2222)
  && !restored.products.RP006_11가1111);
const partnerBefore = storedSnapshot({ _key: 'RP006', inventory_source: 'sheet', custom: 'partner-before' });
const partnerAfter = storedSnapshot({ _key: 'RP006', inventory_source: 'ironrentcar_web', ironrentcar_sync_run_id: 'run-1' });
check('8 RP006 기존 overlay는 exact snapshot으로 복원',
  canonicalIronRentcarJson(restoreStoredSnapshot(partnerBefore))
  === canonicalIronRentcarJson({ _key: 'RP006', inventory_source: 'sheet', custom: 'partner-before' }));

const manuallyChanged = {
  ...appliedReplace.products,
  RP006_22나2222: { ...appliedReplace.products.RP006_22나2222, memo: 'manual' },
};
check('9 적용 후 affected 한 필드 수정은 rollback 전체 차단', !affectedProductsMatch(manuallyChanged, after));
const locked = {
  ...appliedReplace.products,
  RP006_22나2222: { ...appliedReplace.products.RP006_22나2222, locked_by_contract: 'CT-1' },
};
check('10 계약 lock 추가 상품 rollback 차단', affectedProductsHaveContractLock(locked, keyPlan.keys));

const controlBefore = storedSnapshot({ latest_applied_run_id: 'older' });
const controlAfter = storedSnapshot({ latest_applied_run_id: 'run-1', latest_applied_revision: 'rev-1' });
const run: IronRentcarSyncRun = {
  run_id: 'run-1', provider_code: 'RP006', revision: 'rev-1',
  counts: { patches: 1, creates: 1, absentBlocks: 1 },
  actor_uid: 'admin-1', apply_audit_id: 'audit-apply', state: 'applied',
  affected_keys: keyPlan.keys, products_before: before, products_after: after,
  partner_before: partnerBefore, partner_after: partnerAfter,
  control_before: controlBefore, control_after: controlAfter,
  before_digest: syncStateDigest({ products: before, partner: partnerBefore, control: controlBefore }),
  after_digest: syncStateDigest({ products: after, partner: partnerAfter, control: controlAfter }),
  prepared_at: 1, applied_at: 2,
};
check('12 revision/digest 일치만 rollback 요청 허용', rollbackRequestMatches({
  run, expectedRevision: 'rev-1', expectedAfterDigest: run.after_digest,
}) && !rollbackRequestMatches({ run, expectedRevision: 'rev-X', expectedAfterDigest: run.after_digest })
  && !rollbackRequestMatches({ run, expectedRevision: 'rev-1', expectedAfterDigest: 'bad' }));
const preparedFailure = failPreparedIronRentcarRun({ ...run, state: 'prepared' }, 3, 'apply_conflict');
check('prepared run만 apply_failed로 종결', preparedFailure?.state === 'apply_failed'
  && preparedFailure.failed_at === 3 && preparedFailure.failure_code === 'apply_conflict');
check('이미 applied인 run은 apply_failed로 덮지 않음', failPreparedIronRentcarRun(run, 4, 'apply_exception') === null);

const emptyRootBytes = ironRentcarRootWriteBytes({ payload: '' });
const exactLimitRoot = { payload: 'x'.repeat(IRONRENTCAR_ROOT_WRITE_MAX_BYTES - emptyRootBytes) };
check('14MB UTF-8 proposed root 경계값 허용',
  ironRentcarRootWriteBytes(exactLimitRoot) === IRONRENTCAR_ROOT_WRITE_MAX_BYTES
  && ironRentcarRootWriteAllowed(exactLimitRoot));
check('14MB 초과 proposed root 차단',
  !ironRentcarRootWriteAllowed({ payload: `${exactLimitRoot.payload}x` }));
check('control after에 수동 필드 변경 시 exact CAS 차단',
  !snapshotMatches({ ...(controlAfter.value || {}), manual: true }, run.control_after));

const applySource = readFileSync(new URL('../app/api/inventory/ironrentcar/apply/route.ts', import.meta.url), 'utf8');
const rollbackSource = readFileSync(new URL('../app/api/inventory/ironrentcar/rollback/route.ts', import.meta.url), 'utf8');
check('11 최신 run 아닌 rollback 차단', rollbackSource.includes('latest_applied_run_id') && rollbackSource.includes('latest_applied_revision'));
check('12b confirmation/revision/digest 필수',
  rollbackSource.includes("const CONFIRMATION = '아이언 홈페이지 연동 롤백'")
  && rollbackSource.includes('expectedRevision') && rollbackSource.includes('expectedAfterDigest'));
check('13 admin 외 역할 차단', rollbackSource.includes('verifyAdminBearer(request)') && rollbackSource.includes("error: 'forbidden'"));
check('14 상품 복원 후 partner 실패 상태 안전 재개',
  rollbackSource.includes("state: 'rollback_products_restored'")
  && (rollbackSource.match(/db\.ref\('v4'\)\.transaction/g) || []).length === 2
  && rollbackSource.includes("currentRun.state === 'rollback_products_restored'"));
check('rollback 두 단계 모두 14MB root 상한과 control exact snapshot 검사',
  (rollbackSource.match(/ironRentcarRootWriteAllowed\(root\)/g) || []).length === 3
  && rollbackSource.includes('snapshotMatches(control, run.control_after)'));
check('15 동일 run 이중 rollback 차단',
  rollbackSource.includes("['applied', 'rollback_products_restored'].includes(run.state)")
  && !['applied', 'rollback_products_restored'].includes('rolled_back'));
check('16 성공 rollback 후 affected 상품+RP006가 apply 직전과 deep-equal', restored.ok
  && canonicalIronRentcarJson(snapshotsForKeys(restored.products, keyPlan.keys)) === canonicalIronRentcarJson(before)
  && canonicalIronRentcarJson(restoreStoredSnapshot(partnerBefore))
    === canonicalIronRentcarJson({ _key: 'RP006', inventory_source: 'sheet', custom: 'partner-before' }));
check('17 v3 write 0', !/db\.ref\(['"]products['"]\)\.(?:set|update|remove|transaction)/.test(`${applySource}\n${rollbackSource}`));
check('18 products_private write 0', !`${applySource}\n${rollbackSource}`.includes('products_private'));
check('19 apply/rollback 감사가 run/revision/digest에 결속',
  applySource.includes('run_id: runId') && applySource.includes('before_digest: beforeDigest') && applySource.includes('after_digest: afterDigest')
  && rollbackSource.includes('run_id: input.run.run_id') && rollbackSource.includes('revision: input.run.revision')
  && rollbackSource.includes('before_digest: input.run.before_digest') && rollbackSource.includes('after_digest: input.run.after_digest'));
const failedReplacement = replaceAffectedProducts(manuallyChanged, after, before);
check('20 실패 경로 unrelated v4 상품 불변', !failedReplacement.ok
  && failedReplacement.products.unrelated === manuallyChanged.unrelated
  && canonicalIronRentcarJson(failedReplacement.products.unrelated) === canonicalIronRentcarJson(overlayBefore.unrelated));

console.log(`ironrentcar rollback: ${pass}/${pass} PASS`);
