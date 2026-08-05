import { applyIronRentcarPublicOverlay } from '../lib/domain/ironrentcar-apply';
import { planIronRentcarReconcile } from '../lib/domain/ironrentcar-reconcile';
import type { IronRentcarCatalogItem } from '../lib/server/ironrentcar-source';
import type { EntityRecord } from '../lib/intake/entities';
import { readFileSync } from 'node:fs';
import { mergeV3V4Records } from '../lib/firebase/rtdb-records';

let pass = 0;
const check = (name: string, ok: boolean): void => {
  if (!ok) throw new Error(name);
  pass++;
};
const item = (plate: string, status = '출고가능'): IronRentcarCatalogItem => {
  const product: EntityRecord = {
    _key: `RP006_${plate}`, product_code: `RP006_${plate}`, car_number: plate,
    provider_company_code: 'RP006', vehicle_status: status,
    price: { 36: { rent: 600000, deposit: 1200000 } },
  };
  return { externalId: plate, sourceUrl: `https://ironrentcar.com/vehicles/${plate}`, condition: 'used', sold: status === '출고불가', product, privateProduct: { vehicle_price: 30_000_000 }, policySnapshot: {}, fingerprint: plate };
};

const existing: EntityRecord[] = [
  { _key: 'RP006_11가1111', product_code: 'RP006_11가1111', car_number: '11가1111', provider_company_code: 'RP006', vehicle_status: '출고가능', updatedAt: 'before', price: { 48: { rent: 1 } } },
  { _key: 'RP006_22나2222', product_code: 'RP006_22나2222', car_number: '22나2222', provider_company_code: 'RP006', vehicle_status: '출고가능', updatedAt: 'before' },
];
const plan = planIronRentcarReconcile({ webItems: [item('11가1111'), item('33다3333')], existing, sourceComplete: true });
const applied = applyIronRentcarPublicOverlay({ currentOverlay: {}, plan, now: 'after' });
check('정상 계획 원자 적용', applied.ok && applied.updated === 1 && applied.created === 1 && applied.absentBlocked === 1);
check('가격은 웹 전체로 교체', Object.keys(applied.overlay['RP006_11가1111'].price as object).join(',') === '36');
check('신규 생성', applied.overlay['RP006_33다3333']?.createdAt === 'after');
check('웹 부재 차단', applied.overlay['RP006_22나2222']?.vehicle_status === '출고불가');
check('웹 부재 provenance 시각', applied.overlay['RP006_22나2222']?.ironrentcar_blocked_at === 'after');
check('private 차량가는 공개 overlay 제외', !('vehicle_price' in applied.overlay['RP006_33다3333']));

const diagnosed = applyIronRentcarPublicOverlay({
  currentOverlay: {},
  plan,
  now: 'after',
  runId: 'run-1',
  revision: 'rev-1',
});
check('affected 상품에 run/revision/apply time 진단필드',
  diagnosed.overlay['RP006_11가1111']?.ironrentcar_sync_run_id === 'run-1'
  && diagnosed.overlay['RP006_33다3333']?.ironrentcar_sync_revision === 'rev-1'
  && diagnosed.overlay['RP006_22나2222']?.ironrentcar_synced_at === 'after');

const raced = applyIronRentcarPublicOverlay({
  currentOverlay: { 'RP006_11가1111': { updatedAt: 'raced', vehicle_status: '계약중' } },
  plan,
  now: 'after',
});
check('검증 뒤 계약/갱신 경합은 전체 중단', !raced.ok && raced.conflicts.includes('RP006_11가1111'));

const createRace = applyIronRentcarPublicOverlay({
  currentOverlay: { other: { car_number: '33다3333', provider_company_code: 'RP006', vehicle_status: '출고가능' } },
  plan,
  now: 'after',
});
check('동일 공급사·차번 신규 경합 차단', !createRace.ok && createRace.conflicts.includes('RP006_33다3333'));

const tombstoneRecreate = applyIronRentcarPublicOverlay({
  currentOverlay: {
    'RP006_33다3333': {
      product_code: 'RP006_33다3333', provider_company_code: 'RP006',
      _deleted: true, status: 'deleted', deletedAt: 'before',
    },
  },
  plan,
  now: 'after',
});
check('삭제 tombstone과 같은 키의 홈페이지 활성 차량은 재생성 가능',
  tombstoneRecreate.ok
  && tombstoneRecreate.overlay['RP006_33다3333']?._deleted !== true
  && tombstoneRecreate.overlay['RP006_33다3333']?.status !== 'deleted');

const missingMileageExisting: EntityRecord[] = [{
  _key: 'RP006_44라4444', product_code: 'RP006_44라4444', car_number: '44라4444',
  provider_company_code: 'RP006', vehicle_status: '출고가능', mileage: 123456,
}];
const missingMileagePlan = planIronRentcarReconcile({
  webItems: [item('44라4444')], existing: missingMileageExisting, sourceComplete: true,
});
const missingMileageApplied = applyIronRentcarPublicOverlay({
  currentOverlay: {}, plan: missingMileagePlan, now: 'after',
});
const missingMileageMerged = mergeV3V4Records('product', {
  EXT_legacy: missingMileageExisting[0],
}, missingMileageApplied.overlay);
check('RTDB round-trip 뒤에도 홈페이지 누락 주행거리가 v3에서 되살아나지 않음',
  missingMileageApplied.ok && missingMileageMerged[0]?.mileage === '');

const routeSource = readFileSync(new URL('../app/api/inventory/ironrentcar/apply/route.ts', import.meta.url), 'utf8');
const previewRouteSource = readFileSync(new URL('../app/api/inventory/ironrentcar/preview/route.ts', import.meta.url), 'utf8');
const sheetSource = readFileSync(new URL('../lib/domain/sheet-sync-all.ts', import.meta.url), 'utf8');
const sheetUiSource = readFileSync(new URL('../components/SheetSync.tsx', import.meta.url), 'utf8');
check('운영 apply는 서버 기능 플래그 기본 OFF', routeSource.includes("process.env.IRONRENTCAR_SYNC_ENABLED !== 'true'"));
check('운영 apply는 확인문구·revision·예상건수 요구', routeSource.includes('explicit confirmation required') && routeSource.includes('candidate plan changed'));
check('아이언 검증·반영은 ERP3 products를 읽지 않고 ERP4 재고만 정본으로 사용',
  !routeSource.includes("db.ref('products')")
  && !previewRouteSource.includes("database.ref('products')")
  && routeSource.includes("db.ref('v4/products')")
  && previewRouteSource.includes("database.ref('v4/products')"));
check('운영 apply는 prepared 원장 뒤 v4 원자 transaction으로 공개변경 적용',
  routeSource.includes('inventory_sync_runs/ironrentcar/${runId}')
  && routeSource.includes("db.ref('v4').transaction")
  && routeSource.indexOf("db.ref('v4').update") < routeSource.indexOf("db.ref('v4').transaction"));
check('웹 source 전환은 진행 중 Sheet sync와 동시 실행 금지', routeSource.includes("db.ref('v4/system_locks/sheet_daily_sync')"));
check('상품·RP006·control·완료 감사는 같은 v4 transaction에 결속',
  routeSource.includes('root.products = replaced.products')
  && routeSource.includes('root.partners =')
  && routeSource.includes('root.inventory_sync_control =')
  && routeSource.includes("action: 'apply_completed'"));
check('v4 root 제안값은 공용 14MB 상한 검사 뒤에만 반환',
  routeSource.includes('ironRentcarRootWriteAllowed(root)')
  && routeSource.indexOf('ironRentcarRootWriteAllowed(root)') < routeSource.indexOf('return root;'));
check('prepared apply 충돌·예외는 apply_failed 상태와 append-only 감사로 종결',
  routeSource.includes("finalizePreparedFailure('apply_conflict')")
  && routeSource.includes("finalizePreparedFailure('apply_exception')")
  && routeSource.includes("action: 'apply_failed'"));
check('웹 단일 정본 공급사는 시트 roster에서 제외', sheetSource.includes('if (isWebInventoryPartner(p)) return false'));
check('관리자 화면은 Iron 읽기전용 preview를 제공',
  sheetUiSource.includes("fetch('/api/inventory/ironrentcar/preview'")
  && sheetUiSource.includes('상품 검증'));
check('Iron 적용은 preview revision과 세 가지 예상건수를 전달',
  sheetUiSource.includes('revision: ironPreview.revision')
  && sheetUiSource.includes('patches: ironPreview.reconciliation.patchCandidates')
  && sheetUiSource.includes('creates: ironPreview.reconciliation.createCandidates')
  && sheetUiSource.includes('absentBlocks: ironPreview.reconciliation.absentBlockCandidates'));
check('Iron 적용은 사용자 확인 뒤 서버 확인문구로 요청',
  sheetUiSource.indexOf('await confirmDialog') < sheetUiSource.indexOf("fetch('/api/inventory/ironrentcar/apply'")
  && sheetUiSource.includes("confirmation: '아이언 홈페이지 연동 적용'"));
check('Iron UI는 중복·차단 계획 적용 버튼을 비활성화',
  sheetUiSource.includes('ironPreview.reconciliation.duplicatePlateGroups')
  && sheetUiSource.includes('ironPreview.reconciliation.blocked'));
check('홈페이지·Sheet 커넥터를 같은 상품 연동 용어로 표시',
  sheetUiSource.includes('전체 공급사 상품 연동')
  && sheetUiSource.includes('상품 검증')
  && sheetUiSource.includes('상품 반영'));

console.log(`ironrentcar apply: ${pass}/${pass} PASS`);
