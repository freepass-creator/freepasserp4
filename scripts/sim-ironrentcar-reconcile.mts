import { planIronRentcarReconcile } from '../lib/domain/ironrentcar-reconcile';
import type { IronRentcarCatalogItem } from '../lib/server/ironrentcar-source';
import type { EntityRecord } from '../lib/intake/entities';
import { mergeV3V4Records } from '../lib/firebase/rtdb-records';

let pass = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`${name}: expected=${String(expected)} actual=${String(actual)}`);
  pass++;
}

function web(id: string, plate: string, status = '즉시출고'): IronRentcarCatalogItem {
  const product: EntityRecord = {
    _key: `RP006_${plate}`, product_code: `RP006_${plate}`, car_number: plate,
    provider_company_code: 'RP006', vehicle_status: status, price: { 36: { rent: 500000, deposit: 0 } },
  };
  return {
    externalId: id, sourceUrl: `https://ironrentcar.com/vehicles/${id}`, condition: 'used',
    sold: status === '출고불가', product, privateProduct: {}, policySnapshot: {}, fingerprint: id,
  };
}

const existing: EntityRecord[] = [
  { _key: 'old_A', product_code: 'old_A', car_number: '11가1111', provider_company_code: 'RP006', vehicle_status: '출고가능', price: { 36: { rent: 400000 }, 48: { rent: 350000 } } },
  { _key: 'old_B1', product_code: 'old_B1', car_number: '22나2222', provider_company_code: 'RP006', vehicle_status: '출고가능' },
  { _key: 'old_B2', product_code: 'old_B2', car_number: '22나2222', provider_company_code: 'RP006', vehicle_status: '출고가능' },
  { _key: 'old_C', product_code: 'old_C', car_number: '33다3333', provider_company_code: 'RP006', vehicle_status: '출고가능' },
  { _key: 'old_D', product_code: 'old_D', car_number: '77사7777', provider_company_code: 'RP006', vehicle_status: '출고불가', ironrentcar_status_owner: 'web', ironrentcar_block_reason: 'missing_from_complete_catalog', price: { 36: { rent: 500000, deposit: 0 } } },
  { _key: 'other', product_code: 'other', car_number: '44라4444', provider_company_code: 'RP999', vehicle_status: '출고가능' },
];
const plan = planIronRentcarReconcile({
  existing,
  sourceComplete: true,
  webItems: [
    web('match', '11가1111'),
    web('duplicate', '22나2222'),
    web('create', '55마5555'),
    web('sold-new', '66바6666', '출고불가'),
    web('reactivate', '77사7777'),
  ],
});
check('일치 2대', plan.matched, 2);
check('일치 차량 patch 후보', plan.patchCandidates.length, 2);
check('홈페이지 단일 정본은 시트 전용 가격기간 제거', Object.keys((plan.patchCandidates.find((item) => item.key === 'old_A')?.patch.price || {}) as object).join(','), '36');
check('웹 부재 차단 차량 재등장 복원', plan.patchCandidates.find((item) => item.key === 'old_D')?.patch.vehicle_status, '즉시출고');
check('웹 신규 활성만 생성 후보', plan.createCandidates.length, 1);
check('웹 신규 판매완료 미생성', plan.ignoredSoldNew, 1);
check('웹 부재 ERP 집계', plan.webAbsentErp, 1);
check('완전한 웹 스냅샷은 ERP-only 출고불가 후보', plan.absentBlockCandidates.length, 1);
check('웹 단일 정본', plan.authority, 'ironrentcar_web');
check('중복차번 그룹 감지', plan.duplicatePlateGroups, 1);
check('중복 외부행 차단', plan.blockedExternalIds.length, 1);
check('타 공급사 제외', plan.webAbsentErp, 1);
check('후보 작업수', plan.candidateOperations, 4);
check('자동 실행 0 고정', plan.executableOperations, 0);

const incomplete = planIronRentcarReconcile({
  existing,
  sourceComplete: false,
  webItems: [web('match', '11가1111')],
});
check('불완전 웹 스냅샷은 부재 차단 금지', incomplete.absentBlockCandidates.length, 0);

const overlayMerged = mergeV3V4Records('product', {
  EXT_legacy: { product_code: 'RP006_88아8888', car_number: '88아8888', provider_company_code: 'RP006', price: { 48: { rent: 400000 } } },
}, {
  'RP006_88아8888': { product_code: 'RP006_88아8888', vehicle_status: '출고가능', updatedAt: 'now' },
});
check('v3 EXT child와 v4 canonical child는 논리 상품 한 건', overlayMerged.length, 1);
check('논리 overlay는 v3 차번과 v4 상태를 함께 보존', `${overlayMerged[0].car_number}|${overlayMerged[0].vehicle_status}`, '88아8888|출고가능');

console.log(`ironrentcar reconcile: ${pass}/${pass} PASS`);
