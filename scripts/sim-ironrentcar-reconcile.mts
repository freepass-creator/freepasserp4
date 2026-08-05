import { planIronRentcarReconcile } from '../lib/domain/ironrentcar-reconcile';
import type { IronRentcarCatalogItem } from '../lib/server/ironrentcar-source';
import type { EntityRecord } from '../lib/intake/entities';
import { mergeV3V4Records } from '../lib/firebase/rtdb-records';

let pass = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`${name}: expected=${String(expected)} actual=${String(actual)}`);
  pass++;
}

function web(id: string, plate: string, status = '즉시출고', extra: EntityRecord = {}): IronRentcarCatalogItem {
  const product: EntityRecord = {
    _key: `RP006_${plate}`, product_code: `RP006_${plate}`, car_number: plate,
    provider_company_code: 'RP006', vehicle_status: status, price: { 36: { rent: 500000, deposit: 0 } },
    ...extra,
  };
  return {
    externalId: id, sourceUrl: `https://ironrentcar.com/vehicles/${id}`, condition: 'used',
    sold: status === '출고불가', product, privateProduct: {}, policySnapshot: {}, fingerprint: id,
  };
}

const existing: EntityRecord[] = [
  {
    _key: 'old_A', product_code: 'old_A', car_number: '11가1111', provider_company_code: 'RP006',
    vehicle_status: '출고가능', maker: '옛 제조사', trim_name: '옛 트림', options: '옛 옵션', mileage: 123,
    image_urls: ['old.jpg'], locked_by_contract: '', vehicle_price: 99000000,
    price: { 36: { rent: 400000 }, 48: { rent: 350000 } },
  },
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
    web('match', '11가1111', '즉시출고', {
      maker: '현대', trim_name: '', options: '', image_urls: ['new.jpg'],
    }),
    web('duplicate', '22나2222'),
    web('create', '55마5555'),
    web('sold-new', '66바6666', '출고불가'),
    web('reactivate', '77사7777'),
  ],
});
check('일치 2대', plan.matched, 2);
check('일치 차량 patch 후보', plan.patchCandidates.length, 2);
check('홈페이지 단일 정본은 시트 전용 가격기간 제거', Object.keys((plan.patchCandidates.find((item) => item.key === 'old_A')?.patch.price || {}) as object).join(','), '36');
const exactPatch = plan.patchCandidates.find((item) => item.key === 'old_A')?.patch || {};
check('홈페이지 소유 제조사 정확 교체', exactPatch.maker, '현대');
check('홈페이지 빈 트림도 옛 값 제거', exactPatch.trim_name, '');
check('홈페이지 빈 옵션도 옛 값 제거', exactPatch.options, '');
check('홈페이지 사진 목록 정확 교체', JSON.stringify(exactPatch.image_urls), JSON.stringify(['new.jpg']));
check('홈페이지에 사라진 주행거리는 v3 재노출 없는 빈 overlay', exactPatch.mileage, '');
check('계약락은 홈페이지 patch 대상 아님', Object.prototype.hasOwnProperty.call(exactPatch, 'locked_by_contract'), false);
check('차량원가는 홈페이지 공개 patch 대상 아님', Object.prototype.hasOwnProperty.call(exactPatch, 'vehicle_price'), false);
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

const protectedPlan = planIronRentcarReconcile({
  sourceComplete: true,
  existing: [
    { _key: 'locked', product_code: 'locked', car_number: '99자9999', provider_company_code: 'RP006', vehicle_status: '계약중', locked_by_contract: 'CT-1', maker: '기존' },
    { _key: 'manual', product_code: 'manual', car_number: '88아8888', provider_company_code: 'RP006', vehicle_status: '출고불가', maker: '기존' },
  ],
  webItems: [
    web('locked', '99자9999', '출고가능', { maker: '현대' }),
    web('manual', '88아8888', '출고가능', { maker: '기아' }),
  ],
});
const lockedPatch = protectedPlan.patchCandidates.find((item) => item.key === 'locked')?.patch || {};
const manualPatch = protectedPlan.patchCandidates.find((item) => item.key === 'manual')?.patch || {};
check('계약중 상태는 홈페이지가 해제하지 않음', Object.prototype.hasOwnProperty.call(lockedPatch, 'vehicle_status'), false);
check('계약중이어도 설명 필드는 홈페이지 정본 반영', lockedPatch.maker, '현대');
check('수기 출고불가는 홈페이지 재등장만으로 해제하지 않음', Object.prototype.hasOwnProperty.call(manualPatch, 'vehicle_status'), false);

const ownershipConflict = planIronRentcarReconcile({
  sourceComplete: true,
  existing: [{
    _key: 'RP006_12가3456', product_code: 'RP006_12가3456', car_number: '12가3456',
    provider_company_code: 'RP999', vehicle_status: '출고가능',
  }],
  webItems: [web('foreign-owner', '12가3456')],
});
check('RP006 키여도 명시 공급사가 다르면 매칭하지 않음', ownershipConflict.matched, 0);
check('명시 공급사 소유권 충돌은 신규 생성 금지', ownershipConflict.createCandidates.length, 0);
check('명시 공급사 소유권 충돌 외부행 차단', ownershipConflict.blockedExternalIds[0], 'foreign-owner');

const overlayMerged = mergeV3V4Records('product', {
  EXT_legacy: { product_code: 'RP006_88아8888', car_number: '88아8888', provider_company_code: 'RP006', price: { 48: { rent: 400000 } } },
}, {
  'RP006_88아8888': { product_code: 'RP006_88아8888', vehicle_status: '출고가능', updatedAt: 'now' },
});
check('v3 EXT child와 v4 canonical child는 논리 상품 한 건', overlayMerged.length, 1);
check('논리 overlay는 v3 차번과 v4 상태를 함께 보존', `${overlayMerged[0].car_number}|${overlayMerged[0].vehicle_status}`, '88아8888|출고가능');

console.log(`ironrentcar reconcile: ${pass}/${pass} PASS`);
