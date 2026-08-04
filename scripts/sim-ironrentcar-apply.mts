import { applyIronRentcarPublicOverlay } from '../lib/domain/ironrentcar-apply';
import { planIronRentcarReconcile } from '../lib/domain/ironrentcar-reconcile';
import type { IronRentcarCatalogItem } from '../lib/server/ironrentcar-source';
import type { EntityRecord } from '../lib/intake/entities';
import { readFileSync } from 'node:fs';

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

const routeSource = readFileSync(new URL('../app/api/inventory/ironrentcar/apply/route.ts', import.meta.url), 'utf8');
const sheetSource = readFileSync(new URL('../lib/domain/sheet-sync-all.ts', import.meta.url), 'utf8');
const sheetUiSource = readFileSync(new URL('../components/SheetSync.tsx', import.meta.url), 'utf8');
check('운영 apply는 서버 기능 플래그 기본 OFF', routeSource.includes("process.env.IRONRENTCAR_SYNC_ENABLED !== 'true'"));
check('운영 apply는 확인문구·revision·예상건수 요구', routeSource.includes('explicit confirmation required') && routeSource.includes('candidate plan changed'));
check('운영 apply는 v4/products 부모 transaction으로 공개변경 원자 적용', routeSource.includes("db.ref('v4/products').transaction"));
check('웹 source 전환은 진행 중 Sheet sync와 동시 실행 금지', routeSource.includes("db.ref('v4/system_locks/sheet_daily_sync')"));
check('실패 시 공급사 source overlay 복구', routeSource.includes('partnerSwitched && !applyCompleted'));
check('상품 transaction 성공 뒤 감사표식 실패는 Sheet source로 롤백하지 않음',
  routeSource.indexOf('applyCompleted = true') < routeSource.indexOf('let auditCompleted = true'));
check('웹 단일 정본 공급사는 시트 roster에서 제외', sheetSource.includes('if (isWebInventoryPartner(p)) return false'));
check('관리자 화면은 Iron 읽기전용 preview를 제공',
  sheetUiSource.includes("fetch('/api/inventory/ironrentcar/preview'")
  && sheetUiSource.includes('미리보기 새로고침'));
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

console.log(`ironrentcar apply: ${pass}/${pass} PASS`);
