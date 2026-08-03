import {
  planProductDuplicateMigration,
  productDuplicateMigrationTsv,
} from '../lib/domain/product-duplicate-migration';
import {
  planProductDuplicateDryRun,
  productDuplicateDryRunTsv,
} from '../lib/domain/product-duplicate-dry-run';
import { resolveMergedProduct } from '../lib/domain/product-alias';
import type { EntityRecord } from '../lib/intake/entities';
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const product = (key: string, provider = 'RP001', extra: EntityRecord = {}): EntityRecord => ({
  _key: key,
  product_code: key,
  provider_company_code: provider,
  car_number: '12가3456',
  vehicle_status: '출고가능',
  ...extra,
});
const completeScan = {
  contracts: true,
  rooms: true,
  quotes: true,
  productPrivate: true,
};

const canonicalPlan = planProductDuplicateMigration({
  products: [product('EXT_OLD'), product('RP001_12가3456', 'RP001', { source: 'sheet' })],
  contracts: [],
  rooms: [],
  quotes: [],
  productPrivate: [],
  scan: completeScan,
  providerCodes: ['RP001'],
});
check('같은 공급사·차번 중복만 한 그룹으로 계획', canonicalPlan.length === 1 && canonicalPlan[0].records.length === 2);
check('진행계약이 없으면 공급사_차번 표준키를 대표 후보로 제시',
  canonicalPlan[0].representativeCandidate === 'RP001_12가3456'
  && canonicalPlan[0].candidateReason === '공급사_차번 표준키');

const protectedPlan = planProductDuplicateMigration({
  products: [product('EXT_LOCK', 'RP001', { locked_by_contract: 'CT-1', vehicle_status: '계약중' }), product('RP001_12가3456')],
  contracts: [{ _key: 'CT-1', contract_code: 'CT-1', contract_status: '계약대기', product_code: 'EXT_LOCK' }],
  rooms: [{ _key: 'ROOM-1', product_uid: 'EXT_LOCK' }],
  quotes: [],
  productPrivate: [{ _key: 'EXT_LOCK', product_code: 'EXT_LOCK', vin: 'MASKED' }],
  scan: completeScan,
  providerCodes: ['RP001'],
});
check('진행계약·계약락 키를 canonical보다 우선 보존',
  protectedPlan[0].representativeCandidate === 'EXT_LOCK'
  && protectedPlan[0].records[0].action === '유지 후보');
check('계약·방·비공개 원가 참조를 상품키별로 분리',
  protectedPlan[0].records[0].openContractRefs.includes('CT-1')
  && protectedPlan[0].records[0].roomRefs.includes('ROOM-1')
  && protectedPlan[0].records[0].hasPrivateRecord);

const withdrawnPlan = planProductDuplicateMigration({
  products: [product('EXT_WITHDRAWN'), product('RP001_12가3456')],
  contracts: [{ contract_code: 'CT-W', contract_status: '계약철회', product_code: 'EXT_WITHDRAWN' }],
  rooms: [],
  quotes: [],
  productPrivate: [],
  scan: completeScan,
  providerCodes: ['RP001'],
});
check('미결 계약철회 키도 취소로 임의 간주하지 않고 보호',
  withdrawnPlan[0].representativeCandidate === 'EXT_WITHDRAWN'
  && withdrawnPlan[0].records.some((row) => row.openContractRefs.includes('CT-W')));

const multiProtected = planProductDuplicateMigration({
  products: [product('OLD_A'), product('OLD_B')],
  contracts: [
    { contract_code: 'CT-A', contract_status: '계약요청', product_code: 'OLD_A' },
    { contract_code: 'CT-B', contract_status: '계약발송', product_uid: 'OLD_B' },
  ],
  rooms: [],
  quotes: [],
  productPrivate: [],
  scan: completeScan,
});
check('둘 이상의 키가 진행계약으로 보호되면 대표키 자동선정 차단',
  !multiProtected[0].representativeCandidate
  && multiProtected[0].blockers.includes('둘 이상의 상품키가 진행계약으로 보호됨'));

const incomplete = planProductDuplicateMigration({
  products: [product('OLD_A'), product('OLD_B')],
  contracts: [],
  rooms: [],
  scan: { contracts: true, rooms: true, quotes: false, productPrivate: false },
});
check('견적·비공개 원가 스캔이 빠지면 실행 금지',
  incomplete[0].decision === '사람·Claude 확인 전 실행 금지'
  && incomplete[0].blockers.includes('견적 참조 스캔 미완료')
  && incomplete[0].blockers.includes('비공개 원가 참조 스캔 미완료'));

const plateOnly = planProductDuplicateMigration({
  products: [product('OLD_A'), product('RP001_12가3456')],
  contracts: [{ contract_code: 'CT-PLATE', contract_status: '계약완료', car_number_snapshot: '12가3456' }],
  rooms: [],
  quotes: [],
  productPrivate: [],
  scan: completeScan,
});
check('상품키 없이 차번만 남은 관계는 수동확인 차단',
  plateOnly[0].plateOnlyReferences === 1
  && plateOnly[0].blockers.some((reason) => reason.includes('차번 참조 1건')));

const crossProvider = planProductDuplicateMigration({
  products: [
    product('OLD_A'),
    product('RP001_12가3456'),
    product('OTHER_12가3456', 'OTHER'),
  ],
  contracts: [],
  rooms: [],
  quotes: [],
  productPrivate: [],
  scan: completeScan,
});
check('같은 공급사 중복 후보라도 같은 차번의 타 공급사가 있으면 소유권 확정 전 차단',
  crossProvider.some((group) => group.provider === 'RP001'
    && group.blockers.some((reason) => reason.includes('공급사 소유권 충돌'))));

const tsv = productDuplicateMigrationTsv(protectedPlan);
check('TSV에 대표키·진행계약·채팅방·비공개 원가·조치 열 포함',
  tsv.startsWith('차량번호\t공급사\t대표키후보')
  && tsv.includes('CT-1')
  && tsv.includes('ROOM-1')
  && tsv.includes('있음')
  && tsv.includes('유지 후보'));

const auditServerSource = readFileSync(new URL('../lib/server/product-duplicate-audit.ts', import.meta.url), 'utf8');
const auditRouteSource = readFileSync(new URL('../app/api/inventory/duplicate-plan/route.ts', import.meta.url), 'utf8');
const sheetSyncSource = readFileSync(new URL('../components/SheetSync.tsx', import.meta.url), 'utf8');
check('서버 감사는 계약·채팅방·견적·비공개 원가 노드를 모두 읽음',
  ['contracts', 'rooms', 'quotes', 'v4/products_private'].every((node) => auditServerSource.includes(`ref('${node}')`)));
check('중복 이관계획 API는 관리자 Bearer 인증을 통과해야 조회',
  auditRouteSource.includes('verifyAdminBearer(request)')
  && auditRouteSource.includes("status: 403"));
check('관리자 화면 이관계획 버튼은 읽기 전용 API 결과만 TSV로 복사',
  sheetSyncSource.includes("fetch('/api/inventory/duplicate-plan'")
  && sheetSyncSource.includes('중복 이관계획 TSV')
  && !auditRouteSource.includes('.update(')
  && !auditRouteSource.includes('.set('));
check('서버 dry-run은 레거시 공개 원가를 public/private로 분리하고 값 없는 TSV만 반환',
  auditServerSource.includes('splitProductPrivate(product)')
  && auditServerSource.includes('dryRunTsv: productDuplicateDryRunTsv'));
check('관리자 화면은 별도 patch dry-run TSV와 적용후보·충돌 건수를 표시',
  sheetSyncSource.includes('result.dryRunTsv')
  && sheetSyncSource.includes('중복 patch dry-run')
  && sheetSyncSource.includes('dryRunEligibleGroups'));
const rtdbAdapterSource = readFileSync(new URL('../lib/firebase/rtdb-adapter.ts', import.meta.url), 'utf8');
check('상품 단건 조회는 중복 tombstone의 _merged_into 별칭을 복원',
  rtdbAdapterSource.includes('resolveMergedProduct(rows, key)'));
const dailyStatusSource = sheetSyncSource.slice(
  sheetSyncSource.indexOf('const refreshDailyStatus'),
  sheetSyncSource.indexOf('// roster 바뀌면 검증 스냅샷 무효'),
);
check('자동연동 상태 새로고침은 전용 loading을 반드시 해제',
  dailyStatusSource.includes('finally')
  && dailyStatusSource.includes('setDailyStatusLoading(false)'));

const cleanDryRun = planProductDuplicateDryRun({
  products: [
    product('RP001_12가3456', 'RP001', { maker: '', model: 'K5' }),
    product('EXT_OLD', 'RP001', { maker: '기아', model: 'K5' }),
  ],
  contracts: [],
  rooms: [{ _key: 'ROOM-OLD', product_uid: 'EXT_OLD', product_code: 'EXT_OLD' }],
  quotes: [],
  productPrivate: [{ _key: 'EXT_OLD', product_code: 'EXT_OLD', vin: 'VIN-MASKED' }],
  partners: [],
  providerCodes: ['RP001'],
});
check('대표키 빈 공개필드와 비공개 원가는 값 노출 없이 fill 계획',
  cleanDryRun[0].eligible
  && cleanDryRun[0].publicFillFields.includes('maker')
  && cleanDryRun[0].privateFillFields.includes('vin'));
check('채팅방 ID는 유지하고 상품 참조 필드만 v4 overlay patch',
  cleanDryRun[0].operations.some((operation) => operation.kind === 'reference-patch'
    && operation.path === 'v4/rooms/ROOM-OLD'
    && operation.fields.includes('product_uid')
    && operation.fields.includes('product_code')));
check('중복 상품은 예전 URL 복원용 _merged_into와 tombstone을 함께 계획',
  cleanDryRun[0].operations.some((operation) => operation.kind === 'alias-tombstone'
    && operation.fields.includes('_merged_into')
    && operation.destructive
    && operation.claudeGate));
const conflictingDryRun = planProductDuplicateDryRun({
  products: [
    product('RP001_12가3456', 'RP001', { model: 'K5' }),
    product('EXT_OLD', 'RP001', { model: '쏘나타' }),
  ],
  contracts: [],
  rooms: [],
  quotes: [],
  productPrivate: [],
  partners: [],
  providerCodes: ['RP001'],
});
check('대표·중복 상품의 비어있지 않은 값이 다르면 필드 충돌로 dry-run 차단',
  !conflictingDryRun[0].eligible
  && conflictingDryRun[0].publicConflictFields.includes('model')
  && conflictingDryRun[0].operations.length === 0);
const dryRunTsv = productDuplicateDryRunTsv(cleanDryRun);
check('patch dry-run TSV는 경로·파괴적 작업·Claude 게이트를 표시하고 값은 노출하지 않음',
  dryRunTsv.includes('v4/products/EXT_OLD')
  && dryRunTsv.includes('alias-tombstone')
  && !dryRunTsv.includes('VIN-MASKED'));
const aliased = resolveMergedProduct([
  product('CANON'),
  { ...product('OLD'), _deleted: true, _merged_into: 'CANON' },
], 'OLD');
check('예전 상품키는 tombstone 별칭을 따라 대표 상품으로 복원', aliased?.product_code === 'CANON');
check('상품 별칭 순환은 fail-closed',
  resolveMergedProduct([
    { ...product('A'), _deleted: true, _merged_into: 'B' },
    { ...product('B'), _deleted: true, _merged_into: 'A' },
  ], 'A') === null);
const redundantAccountDryRun = planProductDuplicateDryRun({
  products: [
    product('RP001_12가3456', 'RP001', { account_number: 'BANK-MASKED' }),
    product('EXT_OLD', 'RP001', { account_number: 'BANK-MASKED' }),
  ],
  contracts: [],
  rooms: [],
  quotes: [],
  productPrivate: [],
  partners: [{ _key: 'RP001', partner_code: 'RP001', bank_account: 'BANK-MASKED' }],
  providerCodes: ['RP001'],
});
check('상품 계좌가 파트너 bank_account의 중복값이면 상품 병합에서 폐기 가능',
  redundantAccountDryRun[0].eligible
  && redundantAccountDryRun[0].accountNumberDisposition.includes('중복값'));
const mismatchedAccountDryRun = planProductDuplicateDryRun({
  products: [
    product('RP001_12가3456', 'RP001', { account_number: 'BANK-A' }),
    product('EXT_OLD', 'RP001', { account_number: 'BANK-B' }),
  ],
  contracts: [],
  rooms: [],
  quotes: [],
  productPrivate: [],
  partners: [{ _key: 'RP001', partner_code: 'RP001', bank_account: 'BANK-A' }],
  providerCodes: ['RP001'],
});
check('상품 계좌가 파트너 계좌와 다르면 값 노출 없이 dry-run 차단',
  !mismatchedAccountDryRun[0].eligible
  && mismatchedAccountDryRun[0].blockers.includes('상품 account_number와 파트너 bank_account 불일치'));

console.log(`\nproduct duplicate migration simulation: ${pass}/${pass + fail} PASS`);
if (fail) process.exit(1);
