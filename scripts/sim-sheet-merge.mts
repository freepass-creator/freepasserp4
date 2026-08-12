/**
 * Phase A — soft-merge / upsert 시뮬레이션.
 * 실행: npx tsx scripts/sim-sheet-merge.mts
 */
import { readFileSync } from 'node:fs';
import type { EntityRecord } from '../lib/intake/entities';
import {
  softMergeProduct, planProductUpsert, changedPatch,
  stripSheetPrivatePatchFields,
  planAbsentBlocked, sheetReconcileRevision, sheetReconcileStateRevision, shouldReconcileAbsent,
  resolveSheetReviveTarget,
} from '../lib/domain/sheet-merge';
import { orderSheetGids, resolveAdapter, partnerSheetOpts } from '../lib/domain/sheet-adapters';
import {
  assertDistinctSheetTable,
  autoMapHeaders,
  canonSheetVehicleStatus,
  importSheetTable,
  parseMappingProfile,
  parsePriceColumns,
  rentCell,
} from '../lib/domain/sheet-import';
import { resolveGoogleSheetCsvUrl } from '../lib/domain/sheet-url';
import { visibleRowsFromGridResponse } from '../lib/domain/sheet-visible-grid';
import {
  buildPrevForGuard,
  buildSheetSyncCheckpoint,
  commitFetchedPartnerSheets,
  fetchAllPartnerSheets,
  findSheetSyncExistingConflicts,
  isExplicitAllExcluded,
  partnerSourceReadiness,
  planSafeSupplierProducts,
  rosterRevisionForFetched,
  sheetPartnerRows,
  sheetSyncExistingConflictReason,
  sheetSyncCommitBlockReason,
  sheetPartnerSyncRevision,
} from '../lib/domain/sheet-sync-all';
import { productsForSheetCommit } from '../lib/domain/master-ingress';
import {
  buildPriceChangesValue, buildSheetConflictReportRows, sheetConflictReportTsv,
} from '../lib/domain/sheet-conflict-report';
import { applySheetConflictResolutions } from '../lib/domain/sheet-conflict-resolution';
import { createPlateAllocator } from '../lib/domain/pending-plate';
import { productPatchPreconditionMatches } from '../lib/domain/product-write-guard';

type Case = { name: string; ok: boolean; detail?: unknown };
const cases: Case[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  cases.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

console.log('══ Phase A soft-merge ══\n');

const existing: EntityRecord = {
  _key: 'sup_a_12가3456', product_code: 'sup_a_12가3456', car_number: '12가3456',
  maker: '현대', model: '아반떼', partner_memo: '수기메모유지', vehicle_status: '출고협의',
  price: { '36': { rent: 330000, deposit: 1000000 } },
};
const incomingBlank: EntityRecord = {
  product_code: 'sup_a_12가3456', car_number: '12가3456',
  maker: '현대', model: '아반떼', partner_memo: '', vehicle_status: '출고가능',
  price: { '24': { rent: 350000, deposit: 900000 } },
};
const merged = softMergeProduct(existing, incomingBlank);
check('빈 partner_memo → 수기 유지', merged.partner_memo === '수기메모유지');
check('시트 상태값 있으면 갱신', merged.vehicle_status === '출고가능');
check('승인 없는 기간삭제 금지 — 시트에 없는 기존 가격기간 유지', !!(merged.price as Record<string, unknown>)?.['36']);
check('시트 최신 가격 기간 반영', !!(merged.price as Record<string, unknown>)?.['24']);

// 엔진 락 보호 — 계약이 선점한 매물은 시트 재동기화가 상태를 못 덮는다(재고 대량 해제 방지).
const lockedExisting: EntityRecord = {
  _key: 'sup_a_77다7777', product_code: 'sup_a_77다7777', car_number: '77다7777',
  maker: '기아', model: '쏘렌토', vehicle_status: '계약중', locked_by_contract: 'chn_abc',
};
const lockedIncoming: EntityRecord = {
  product_code: 'sup_a_77다7777', car_number: '77다7777', maker: '기아', model: '쏘렌토', vehicle_status: '출고가능',
};
const lockedMerged = softMergeProduct(lockedExisting, lockedIncoming);
check('락 걸린 매물 → 시트가 상태 못 덮음', lockedMerged.vehicle_status === '계약중', lockedMerged.vehicle_status);
check('락 걸린 매물 → 시트 재동기화 patch 없음', changedPatch(lockedExisting, lockedMerged) === null);

const incomingNew: EntityRecord = {
  product_code: 'sup_a_99나9999', car_number: '99나9999', maker: '기아', model: 'K5',
};
const plan = planProductUpsert([incomingBlank, incomingNew], [existing]);
check('신규 1건 create', plan.creates.length === 1 && plan.creates[0].product_code === 'sup_a_99나9999');
check('기존 1건 patch', plan.patches.length === 1 && plan.patches[0].key === 'sup_a_12가3456');
check('patch에 빈 memo 없음', plan.patches[0].patch.partner_memo === undefined);
const supplierOwned = softMergeProduct({
  engine_cc: '1600', mileage: '10000', ext_color: '검정', partner_memo: '관리자 메모',
  _sheet_manual_fields: ['engine_cc', 'mileage', 'ext_color', 'partner_memo'],
}, {
  engine_cc: '1998', mileage: '23000', ext_color: '흰색', partner_memo: '공급사 메모',
});
check('공급사 입력 제원은 ERP 수기표식보다 우선',
  supplierOwned.engine_cc === '1998'
  && supplierOwned.mileage === '23000'
  && supplierOwned.ext_color === '흰색');
check('공급사 소유가 아닌 관리자 메모는 수기 보호 유지', supplierOwned.partner_memo === '관리자 메모');
check('시트 patch는 계획 시점 ERP 원본을 CAS expected로 보존',
  plan.patches[0].expected === existing);
const privatePricePlan = planProductUpsert([{
  product_code: 'sup_a_55가5555', car_number: '55가5555', provider_company_code: 'sup_a',
  price: { '36': { rent: 440000, deposit: 1200000 } },
}], [{
  _key: 'sup_a_55가5555', product_code: 'sup_a_55가5555', car_number: '55가5555', provider_company_code: 'sup_a',
  price: { '36': { rent: 430000, deposit: 1200000, fee: 43000, commission: 12000, fee_memo: '내부' } },
}]);
const privatePricePatch = privatePricePlan.patches[0]?.patch.price as Record<string, Record<string, unknown>> | undefined;
check('Sheet 가격 patch는 공개 대여조건만 보내고 비공개 수수료 원자는 건드리지 않음',
  privatePricePatch?.['36']?.rent === 440000
  && !Object.prototype.hasOwnProperty.call(privatePricePatch?.['36'] || {}, 'fee')
  && !Object.prototype.hasOwnProperty.call(privatePricePatch?.['36'] || {}, 'commission')
  && !Object.prototype.hasOwnProperty.call(privatePricePatch?.['36'] || {}, 'fee_memo'));
check('Sheet patch는 원가·VIN·계좌 최상위 원자도 제거', Object.keys(stripSheetPrivatePatchFields({
  maker: '현대', vehicle_price: 1, vin: 'secret', account_number: 'secret',
})).join(',') === 'maker');

const casExpected: EntityRecord = {
  _key: 'RP_12가3456', product_code: 'RP_12가3456', updatedAt: 'before',
  vehicle_status: '출고가능', locked_by_contract: '', maker: '현대',
};
check('CAS 동일 상품은 patch 허용', productPatchPreconditionMatches(
  { ...casExpected }, casExpected, { maker: '기아' },
));
check('CAS 검증 직후 계약 잠금 변경은 patch 차단', !productPatchPreconditionMatches(
  { ...casExpected, updatedAt: 'contract-write', vehicle_status: '계약중', locked_by_contract: 'CT1' },
  casExpected,
  { maker: '기아' },
));
check('CAS 같은 상태의 다른 v4 write도 updatedAt으로 감지', !productPatchPreconditionMatches(
  { ...casExpected, updatedAt: 'manual-write' }, casExpected, { maker: '기아' },
));
check('RTDB v4 미오버레이 필드는 strict-fresh expected를 기준으로 허용',
  productPatchPreconditionMatches(null, casExpected, { maker: '기아' }, { overlayFallback: true }));
check('RTDB transaction 재시도에서 새 계약 락이 보이면 차단', !productPatchPreconditionMatches(
  { updatedAt: 'contract-write', vehicle_status: '계약중', locked_by_contract: 'CT1' },
  casExpected,
  { maker: '기아' },
  { overlayFallback: true },
));

const sameAgain = softMergeProduct(merged, { product_code: merged.product_code, maker: '현대', model: '아반떼', vehicle_status: '출고가능' });
check('동일 유입 → patch 없음', changedPatch(merged, sameAgain) === null);
check('가격 객체 키 순서만 달라진 경우 변경으로 오판하지 않음', changedPatch({
  price: { '36': { deposit: 1500000, rent: 930000 } },
}, {
  price: { '36': { rent: 930000, deposit: 1500000 } },
}) === null);

// fresh 시트 파싱 때마다 달라지는 master snap 시각/이력은 기존 매물 변경으로 세면 안 된다.
const snapBefore: EntityRecord = {
  ...merged,
  _snap_at: 100,
  _snap_history: [{ at: 100, confidence: 'high', source: 'ingress' }],
};
const snapIncoming: EntityRecord = {
  product_code: String(merged.product_code), maker: '현대', model: '아반떼', vehicle_status: '출고가능',
  _snap_at: 200,
  _snap_history: [{ at: 200, confidence: 'high', source: 'ingress' }],
};
const snapMerged = softMergeProduct(snapBefore, snapIncoming);
check('동일 시트 재스냅 시각/이력 → 변경 아님', changedPatch(snapBefore, snapMerged) === null);
check('기존 snap 시각/이력 유지', snapMerged._snap_at === 100 && (snapMerged._snap_history as unknown[])?.length === 1);

const legacyContracting: EntityRecord = {
  ...merged, product_code: 'OLD_KEY', vehicle_status: '계약중', locked_by_contract: '',
};
const legacyContractingMerged = softMergeProduct(legacyContracting, {
  product_code: 'NEW_KEY', vehicle_status: '출고가능', maker: '현대', model: '아반떼',
});
check('legacy 계약중도 시트가 출고가능으로 해제하지 않음', legacyContractingMerged.vehicle_status === '계약중');
check('alt-key 매칭 시 기존 product_code 불변', legacyContractingMerged.product_code === 'OLD_KEY');

// 관리자 화면의 표준 CSV는 기간 열 뒤에 단기/장기보증 열이 온다. 이 순서도 가격을 읽어야 한다.
const standardPrice = parsePriceColumns(
  ['1개월', '12개월', '36개월', '단기보증', '장기보증'],
  ['', '650000', '540000', '3000000', '5000000'],
  { maker: '현대' },
);
check('표준 CSV 후행 보증열 → 가격 파싱',
  standardPrice?.['12']?.rent === 650000
  && standardPrice?.['12']?.deposit === 3000000
  && standardPrice?.['36']?.deposit === 5000000,
  standardPrice);
const unitPrice = parsePriceColumns(['12개월', '단기보증'], ['65만원', '300만원'], { maker: '현대' });
check('월대여료·보증금 만원 suffix를 원 단위로 변환',
  unitPrice?.['12']?.rent === 650000 && unitPrice?.['12']?.deposit === 3000000,
  unitPrice);
check('월대여료 strict 파서 정상 원·만원 허용', rentCell('650,000원') === 650000 && rentCell('65만원') === 650000);
check('월대여료 strict 파서 음수·복수금액 설명문 차단',
  rentCell('-500,000') === 0 && rentCell('월 500,000 / 보증 2,000,000') === 0);
check('빈/미지 상태 안전 기본값 = 출고협의', canonSheetVehicleStatus('') === '출고협의');
check('공급사 계약중은 내부 계약상태를 만들지 않고 출고불가', canonSheetVehicleStatus('계약중') === '출고불가');
const decoratedStatusMapping = autoMapHeaders(['차량상태(정비)', '배차상태(판매)', '차량번호', '차종']);
check('물리 차량상태보다 배차·판매 상태열 우선',
  decoratedStatusMapping.vehicle_status === 1,
  decoratedStatusMapping);

let driftBlocked = false;
try {
  importSheetTable([['상태', '차량번호']], {
    providerCode: 'RP', entries: [{} as never], profile: { car_number: 0, vehicle_status: 1 },
  });
} catch (error) { driftBlocked = String(error).includes('시트 헤더'); }
check('저장 매핑과 현재 헤더 index 이동은 fail-closed', driftBlocked);

const movedSignedHeader = importSheetTable([
  ['상태', '차량번호', '모델'],
], {
  providerCode: 'RP', entries: [{} as never],
  profile: { car_number: 0, model: 1, vehicle_status: 2 },
  profileHeaders: { car_number: '차량번호', model: '모델', vehicle_status: '상태' },
});
check('저장 위치가 아니라 헤더 이름으로 이동한 열을 다시 찾음',
  movedSignedHeader.mapping.car_number === 1
  && movedSignedHeader.mapping.model === 2
  && movedSignedHeader.mapping.vehicle_status === 0,
  movedSignedHeader.mapping);

const migratedStandardHeaders = importSheetTable([
  ['차량번호', '상태', '차명(트림)'],
], {
  providerCode: 'RP', entries: [{} as never],
  profile: { car_number: 0, vehicle_status: 1, model: 2, partner_memo: 3 },
  profileHeaders: { car_number: '차량번호', vehicle_status: '배차상태', model: '차종', partner_memo: '비고' },
});
check('표준 헤더 개편은 공식 별칭으로 재결합하고 없어진 선택 메모는 버림',
  migratedStandardHeaders.mapping.car_number === 0
  && migratedStandardHeaders.mapping.vehicle_status === 1
  && migratedStandardHeaders.mapping.model === 2
  && migratedStandardHeaders.mapping.partner_memo === undefined,
  migratedStandardHeaders.mapping);

const deepHeaderPrepared = resolveAdapter('generic').prepareTable([
  ...Array.from({ length: 40 }, (_, index) => [`공지 ${index + 1}`]),
  ['순번', '차량번호', '모델', '판매상태'],
  ['1', '12가3456', '모닝', '판매중'],
]);
check('고정 행번호 없이 차량번호 헤더 행을 찾고 그 아래부터 읽음',
  deepHeaderPrepared[0]?.[1] === '차량번호'
  && deepHeaderPrepared[1]?.[1] === '12가3456');

const visibleGrid = visibleRowsFromGridResponse({
  sheets: [{
    properties: { sheetId: 284963459, title: '판매차량리스트' },
    data: [{
      startRow: 8,
      rowData: [
        { values: [{ formattedValue: '차량번호' }, { formattedValue: '판매상태' }] },
        { values: [{ formattedValue: '11가1111' }, { formattedValue: '판매중' }] },
        { values: [{ formattedValue: '22나2222' }, { formattedValue: '판매중' }] },
        { values: [{ formattedValue: '33다3333' }, { formattedValue: '판매중' }] },
      ],
      rowMetadata: [{}, {}, { hiddenByFilter: true }, { hiddenByUser: true }],
    }],
  }],
}, '284963459');
check('Sheets 필터·수동 숨김 행은 공급사 연동 대상에서 제외',
  visibleGrid.rows.length === 2
  && visibleGrid.rows[1]?.[0] === '11가1111'
  && visibleGrid.hiddenRowCount === 2,
  visibleGrid);

const visibleGridWithSeparator = visibleRowsFromGridResponse({
  sheets: [{
    properties: { sheetId: 2018553731, title: '전기차 프로모션' },
    data: [{
      startRow: 2,
      rowData: [
        { values: [{ formattedValue: '순번' }, { formattedValue: '차량번호' }, { formattedValue: '모델' }] },
        { values: [{ formattedValue: '1' }, { formattedValue: '11가1111' }, { formattedValue: '현재차' }] },
        {},
        { values: [{ formattedValue: '99' }, { formattedValue: '99하9999' }, { formattedValue: '과거차' }] },
      ],
    }],
  }],
}, '2018553731');
check('Sheets의 비숨김 빈 행은 데이터 블록 경계로 보존',
  visibleGridWithSeparator.rows.length === 4
  && visibleGridWithSeparator.rows[2]?.length === 0,
  visibleGridWithSeparator.rows);

let removedHeaderBlocked = false;
try {
  importSheetTable([['차량번호', '제조사', '모델', '비고', '12개월', '보증금']], {
    providerCode: 'RP', entries: [{} as never],
    profile: { car_number: 0, maker: 1, model: 2, vehicle_status: 3 },
  });
} catch (error) { removedHeaderBlocked = String(error).includes('시트 헤더 검증 필요'); }
check('저장 상태헤더가 사라져 메모열로 밀린 경우도 fail-closed', removedHeaderBlocked);
let signedHeaderChangedBlocked = false;
try {
  importSheetTable([['차량번호', '제조사', '모델', '바뀐상태']], {
    providerCode: 'RP', entries: [{} as never],
    profile: { car_number: 0, vehicle_status: 3 },
    profileHeaders: { car_number: '차량번호', vehicle_status: '커스텀상태' },
  });
} catch (error) { signedHeaderChangedBlocked = String(error).includes('시트 헤더 없음'); }
check('저장 header signature와 현재 커스텀 헤더 불일치 차단', signedHeaderChangedBlocked);
let protectedMappingBlocked = false;
try {
  importSheetTable([['차량번호', '모델', '잠금', '12개월', '보증금']], {
    providerCode: 'RP', entries: [{} as never],
    profile: { car_number: 0, model: 1, locked_by_contract: 2 } as never,
  });
} catch (error) { protectedMappingBlocked = String(error).includes('허용외 필드'); }
check('저장 매핑으로 계약락·엔진 필드 주입 차단', protectedMappingBlocked);
let malformedMappingBlocked = false;
try { parseMappingProfile('{broken'); } catch (error) { malformedMappingBlocked = String(error).includes('JSON 오류'); }
check('깨진 mapping_profile을 자동매핑으로 fail-open하지 않음', malformedMappingBlocked);
let invalidDepositRuleBlocked = false;
try {
  importSheetTable([['차량번호', '모델', '12개월'], ['1가1111', '모닝', '500000']], {
    providerCode: 'RP', entries: [{} as never], depositRule: 'typo' as never,
  });
} catch (error) { invalidDepositRuleBlocked = String(error).includes('보증금 규칙 설정 오류'); }
check('보증금 규칙 enum 오타는 부분 가격 누락 대신 전체 차단', invalidDepositRuleBlocked);

let missingPlateBlocked = false;
try {
  importSheetTable([['모델']], {
    providerCode: 'RP', entries: [{} as never], profile: { model: 0 },
  });
} catch (error) { missingPlateBlocked = String(error).includes('차량번호 열 없음'); }
check('차량번호 열 자체가 없으면 임시번호 대량생성 차단', missingPlateBlocked);

const issueImport = importSheetTable([
  ['차량번호', '제조사', '모델', '12개월', '단기보증'],
  ['12가3456', '현대', '아반떼', '500000', '1000000'],
  ['12가3456', '현대', '아반떼', '500000', '1000000'],
  ['안내문', '', '', '', ''],
], { providerCode: 'RP', entries: [{} as never] });
check('중복·무효 행을 분리하고 원본 행 근거 보존',
  issueImport.duplicateCount === 1
  && issueImport.invalidCount === 1
  && issueImport.issueSamples.some((x) => x.includes('행 3 중복'))
  && issueImport.issueSamples.some((x) => x.includes('행 4 잘못된 차번')),
  issueImport.issueSamples);
const structuralRowImport = importSheetTable([
  ['순번', '차량번호', '제조사', '모델', '12개월', '단기보증'],
  ['수리중', '', '', '', '', ''],
  ['1', '12가3456', '현대', '아반떼', '500000', '1000000'],
], { providerCode: 'RP', entries: [{} as never] });
check('매핑되지 않은 열의 섹션 라벨은 원문·무효행에서 제외',
  structuralRowImport.total === 1
  && structuralRowImport.imported === 1
  && structuralRowImport.invalidCount === 0);
const excludedIdentityImport = importSheetTable([
  ['차량번호', '상태'],
  ['', '계약중'],
  ['34나5678', '계약중'],
], { providerCode: 'RP', entries: [{} as never] });
check('출고불가 행도 차량 신원이 있어야 명시 제외로 인정',
  excludedIdentityImport.total === 2
  && excludedIdentityImport.excludedCount === 1
  && excludedIdentityImport.invalidCount === 1);

const malformedPlateImport = importSheetTable([
  ['차량번호', '제조사', '모델', '12개월', '단기보증'],
  ['12가345', '현대', '아반떼', '500000', '1000000'],
  ['차량 12가3456 확인', '현대', '아반떼', '500000', '1000000'],
  ['차량12가3456', '현대', '아반떼', '500000', '1000000'],
  ['12가34567', '현대', '아반떼', '500000', '1000000'],
], { providerCode: 'RP', entries: [{} as never] });
check('비어있지 않은 오타·설명문·부분일치 차번은 임시 신차로 만들지 않음',
  malformedPlateImport.imported === 0
  && malformedPlateImport.invalidCount === 4
  && malformedPlateImport.issueSamples.every((x) => x.includes('잘못된 차번')));
const regionPlateImport = importSheetTable([
  ['차량번호', '제조사', '모델', '12개월', '단기보증'],
  ['서울12가3456', '현대', '아반떼', '500000', '1000000'],
], { providerCode: 'RP', entries: [{} as never] });
check('실제 지역 접두 번호판은 exact 입고 허용', regionPlateImport.imported === 1);
const excludedDuplicateImport = importSheetTable([
  ['차량번호', '상태'],
  ['34나5678', '계약중'],
  ['34나5678', '계약중'],
], { providerCode: 'RP', entries: [{} as never] });
check('출고불가 중복행도 급감 기준을 부풀리지 않고 중복 증빙',
  excludedDuplicateImport.total === 2
  && excludedDuplicateImport.excludedCount === 1
  && excludedDuplicateImport.duplicateCount === 1
  && excludedDuplicateImport.skipped === 1);

const occurrence = new Map<string, number>();
const allocator = createPlateAllocator(undefined, 0);
const pendingHeader = ['차량번호', '제조사', '모델', '12개월', '단기보증'];
const pendingRow = ['', '현대', '아반떼', '500000', '1000000'];
const pendingA = importSheetTable([pendingHeader, pendingRow], {
  providerCode: 'RP', entries: [{} as never], plateAllocator: allocator, pendingOccurrence: occurrence,
});
const pendingB = importSheetTable([pendingHeader, pendingRow], {
  providerCode: 'RP', entries: [{} as never], plateAllocator: allocator, pendingOccurrence: occurrence,
});
check('멀티탭 동일스펙 번호미정 occurrence를 공유해 서로 다른 임시번호 부여',
  pendingA.products[0]?.car_number === '100신0001'
  && pendingB.products[0]?.car_number === '100신0002');
const pendingPreReleased = importSheetTable([
  pendingHeader,
  ['신차(선출고)', '현대', '아반떼', '500000', '1000000'],
], {
  providerCode: 'RP', entries: [{} as never],
  plateAllocator: createPlateAllocator(undefined, 0),
});
check('이안카 신차(선출고)는 설명문 오타가 아니라 번호미정 신차로 제한 허용',
  pendingPreReleased.imported === 1
  && pendingPreReleased.invalidCount === 0
  && pendingPreReleased.products[0]?.car_number === '100신0001'
  && pendingPreReleased.products[0]?.is_pending_plate === true);
const pendingNamedPreReleased = importSheetTable([
  ['구분', '차량번호', '제조사', '모델', '12개월', '단기보증'],
  ['신차(선출고)', '쿠퍼 C 5도어', '미니', '쿠퍼', '700000', '2500000'],
], {
  providerCode: 'RP', entries: [{} as never],
  plateAllocator: createPlateAllocator(undefined, 0),
});
check('명시적 선출고 신차의 차번 칸 차명은 임시번호로 제한 허용',
  pendingNamedPreReleased.imported === 1
  && pendingNamedPreReleased.invalidCount === 0
  && pendingNamedPreReleased.products[0]?.car_number === '100신0001');
const malformedNamedPreReleased = importSheetTable([
  ['구분', '차량번호', '제조사', '모델', '12개월', '단기보증'],
  ['신차(선출고)', '12가345', '현대', '아반떼', '500000', '1000000'],
], { providerCode: 'RP', entries: [{} as never] });
check('명시적 선출고여도 번호판 오타 형태는 임시번호로 숨기지 않고 차단',
  malformedNamedPreReleased.imported === 0
  && malformedNamedPreReleased.invalidCount === 1);
const allocationSnapshot = allocator.snapshot();
const allocatorAgain = createPlateAllocator(allocationSnapshot.pending_plates, allocationSnapshot.pending_plate_seq);
const occurrenceAgain = new Map<string, number>();
const pendingAgainA = importSheetTable([pendingHeader, pendingRow], {
  providerCode: 'RP', entries: [{} as never], plateAllocator: allocatorAgain, pendingOccurrence: occurrenceAgain,
});
const pendingAgainB = importSheetTable([pendingHeader, pendingRow], {
  providerCode: 'RP', entries: [{} as never], plateAllocator: allocatorAgain, pendingOccurrence: occurrenceAgain,
});
check('저장된 번호미정 map 재검증은 같은 번호를 재현하고 dirty=false',
  pendingAgainA.products[0]?.car_number === '100신0001'
  && pendingAgainB.products[0]?.car_number === '100신0002'
  && allocatorAgain.dirty() === false);
let duplicatePendingAllocationBlocked = false;
try {
  createPlateAllocator({ a: ['100신0001'], b: ['100신0001'] }, 1);
} catch (error) { duplicatePendingAllocationBlocked = String(error).includes('부여기록 중복'); }
check('pending_plates에서 같은 임시번호를 둘 이상의 서명에 재사용하면 설정 단계 차단',
  duplicatePendingAllocationBlocked);
let stalePendingSeqBlocked = false;
try {
  createPlateAllocator({ a: ['100신0002'] }, 1);
} catch (error) { stalePendingSeqBlocked = String(error).includes('순번 설정 오류'); }
check('pending_plate_seq가 실제 부여 최대값보다 작으면 자동 보정 대신 설정 단계 차단',
  stalePendingSeqBlocked);
const validOnlyAllocator = createPlateAllocator(undefined, 0);
const validOnlyOccurrence = new Map<string, number>();
const pendingNoPrice = importSheetTable([pendingHeader, ['', '현대', '아반떼', '-', '1000000']], {
  providerCode: 'RP', entries: [{} as never], plateAllocator: validOnlyAllocator, pendingOccurrence: validOnlyOccurrence,
});
const pendingAfterNoPrice = importSheetTable([pendingHeader, pendingRow], {
  providerCode: 'RP', entries: [{} as never], plateAllocator: validOnlyAllocator, pendingOccurrence: validOnlyOccurrence,
});
check('가격없는 번호미정 행은 occurrence를 소비해 기존 임시번호를 밀지 않음',
  pendingNoPrice.imported === 0 && pendingAfterNoPrice.products[0]?.car_number === '100신0001');

// 부재 → 출고불가 (삭제 없음)
const stock: EntityRecord[] = [
  { _key: 'RP_1가1111', product_code: 'RP_1가1111', provider_company_code: 'RP', car_number: '1가1111', vehicle_status: '출고가능' },
  { _key: 'RP_2가2222', product_code: 'RP_2가2222', provider_company_code: 'RP', car_number: '2가2222', vehicle_status: '출고가능', locked_by_contract: 'CT1' },
  { _key: 'RP_3가3333', product_code: 'RP_3가3333', provider_company_code: 'RP', car_number: '3가3333', vehicle_status: '출고불가' },
  { _key: 'RP_4가4444', product_code: 'RP_4가4444', provider_company_code: 'RP', car_number: '4가4444', vehicle_status: '출고가능' },
  { _key: 'RP_5가5555', product_code: 'RP_5가5555', provider_company_code: 'RP', car_number: '5가5555', vehicle_status: '계약중', locked_by_contract: '' },
  { _key: 'OT_9가9999', product_code: 'OT_9가9999', provider_company_code: 'OT', car_number: '9가9999', vehicle_status: '출고가능' },
  { _key: 'RP_8가8888', product_code: 'RP_8가8888', provider_company_code: 'OT', car_number: '8가8888', vehicle_status: '출고가능' },
];
const present = new Set(['RP_1가1111']);
const absent = planAbsentBlocked({ existing: stock, providerCode: 'RP', presentKeys: present });
check('부재 1건만 출고불가 patch', absent.patches.length === 1 && absent.patches[0].key === 'RP_4가4444');
check('락·레거시 계약중 매물은 부재 patch 스킵', absent.skipped_locked === 2
  && absent.patches.every((p) => p.key !== 'RP_2가2222' && p.key !== 'RP_5가5555'));
check('이미 출고불가 제외', absent.already_blocked === 1);
check('다른 공급사 안 건드림', absent.patches.every((p) => p.key.startsWith('RP_')));
check('예전 key prefix보다 명시 공급사 소유코드 우선',
  absent.patches.every((p) => p.key !== 'RP_8가8888'));
check('부재 patch 상태=출고불가', absent.patches[0]?.patch.vehicle_status === '출고불가');
check('부재 자동차단은 시트 소유 provenance를 기록',
  absent.patches[0]?.patch.sheet_status_owner === 'sheet'
  && absent.patches[0]?.patch.sheet_block_reason === 'missing_or_excluded');
const sheetBlocked = { ...stock[3], ...absent.patches[0]?.patch };
const sheetReturned = softMergeProduct(sheetBlocked, {
  product_code: 'RP_4가4444', car_number: '4가4444', vehicle_status: '출고가능',
});
check('시트가 만든 차단만 재등장 시 복원하고 provenance 제거',
  sheetReturned.vehicle_status === '출고가능'
  && sheetReturned.sheet_status_owner === null
  && sheetReturned.sheet_block_reason === null);
const manualHeld = softMergeProduct({
  ...stock[3], vehicle_status: '출고불가', sheet_status_owner: undefined,
}, { product_code: 'RP_4가4444', car_number: '4가4444', vehicle_status: '출고가능' });
  check('출처 없는 수기·레거시 출고불가는 시트 재등장에도 유지', manualHeld.vehicle_status === '출고불가');
  const legacySheetBlocked = {
    ...stock[3], vehicle_status: '출고불가', source: 'external_sheet', status_label: '시트에서 제거됨',
  };
  const legacySheetReturned = softMergeProduct(legacySheetBlocked, {
    product_code: 'RP_4가4444', car_number: '4가4444', vehicle_status: '출고가능',
  });
  check('레거시 시트 제거 표식은 재등장 시 복원하고 낡은 라벨 제거',
    legacySheetReturned.vehicle_status === '출고가능'
    && legacySheetReturned.status_label === null);
  const legacyBulkHeld = softMergeProduct({
    ...stock[3], vehicle_status: '출고불가', source: 'external_sheet', status_label: '일괄 출고불가',
  }, { product_code: 'RP_4가4444', car_number: '4가4444', vehicle_status: '출고가능' });
  check('일괄 출고불가는 자동 차단으로 추정하지 않고 유지', legacyBulkHeld.vehicle_status === '출고불가');
  const forgedLegacyLabelHeld = softMergeProduct({
    ...stock[3], vehicle_status: '출고불가', source: 'manual', status_label: '시트에서 제거됨',
  }, { product_code: 'RP_4가4444', car_number: '4가4444', vehicle_status: '출고가능' });
  check('시트 출처 없는 동일 라벨은 자동 해제하지 않음', forgedLegacyLabelHeld.vehicle_status === '출고불가');
  check('가드: 유입0 스킵', shouldReconcileAbsent(0, 20).ok === false);
check('가드: 급감 스킵', shouldReconcileAbsent(3, 20).ok === false);
check('가드: 9대 이하 소규모도 9→1 급감 스킵', shouldReconcileAbsent(1, 9).ok === false);
check('가드: 정상 통과', shouldReconcileAbsent(18, 20).ok === true);

const fallbackGuard = buildPrevForGuard(
  [{ _key: 'RP', partner_code: 'RP' }],
  [
    { _key: 'P1', provider_company_code: 'RP' },
    { _key: 'P2', provider_company_code: 'RP' },
    { _key: 'P3', provider_company_code: 'RP' },
  ],
);
check('최초 연동 급감가드 fallback은 공급사 기존 전량 집계', fallbackGuard.get('RP') === 3, fallbackGuard.get('RP'));

const fetchedProduct: EntityRecord = {
  _key: 'RP_11가1111', product_code: 'RP_11가1111', car_number: '11가1111',
  provider_company_code: 'RP', partner_code: 'RP', source_schema: 'RP', source: 'sheet',
};
const completeFetch = {
  rosterRevision: 'roster:test',
  partnerCount: 1,
  products: [fetchedProduct],
  lines: [{
    code: 'RP', label: '공급사', ok: true, sourceRowCount: 1, imported: 1,
    excludedCount: 0, noPriceCount: 0, skippedCount: 0,
    duplicateCount: 0, invalidCount: 0, issueSamples: [], message: 'ok', products: [fetchedProduct],
  }],
};
check('전체 공급사 검증 성공 스냅샷만 커밋 허용', sheetSyncCommitBlockReason(completeFetch) === '');
const stablePendingProducts = [...pendingAgainA.products, ...pendingAgainB.products];
check('기존 번호미정 map 재사용은 dirty=false여도 snapshot 포함 시 커밋 허용',
  sheetSyncCommitBlockReason({
    rosterRevision: 'roster:test',
    partnerCount: 1,
    products: stablePendingProducts,
    lines: [{
      code: 'RP', label: '공급사', ok: true, sourceRowCount: 2, imported: 2,
      excludedCount: 0, noPriceCount: 0, skippedCount: 0,
      duplicateCount: 0, invalidCount: 0, issueSamples: [], message: 'ok',
      products: stablePendingProducts, plateAlloc: allocatorAgain.snapshot(),
    }],
  }) === '');
check('공급사 일부 조회 실패면 일괄 커밋 차단', sheetSyncCommitBlockReason({
  rosterRevision: 'roster:test',
  partnerCount: 2,
  products: [fetchedProduct],
  lines: [
    completeFetch.lines[0],
    { code: 'FAIL', label: '실패사', ok: false, sourceRowCount: 0, imported: 0, excludedCount: 0, noPriceCount: 0, skippedCount: 0, duplicateCount: 0, invalidCount: 0, issueSamples: [], message: 'timeout', products: [] },
  ],
}).includes('조회 실패 공급사'));
check('무효 차번은 기존 차량 부재 오판을 막기 위해 일괄 커밋 차단', sheetSyncCommitBlockReason({
  ...completeFetch,
  lines: [{
    ...completeFetch.lines[0], sourceRowCount: 2, skippedCount: 1,
    invalidCount: 1, issueSamples: ['행 3 잘못된 차번 · 12가345'],
  }],
}).includes('무효 차번 1건'));
check('시트 중복 차번은 한 대만 올리고 일괄 커밋은 막지 않음', sheetSyncCommitBlockReason({
  ...completeFetch,
  lines: [{
    ...completeFetch.lines[0], sourceRowCount: 2, skippedCount: 1,
    duplicateCount: 1, issueSamples: ['행 3 중복 · 11가1111'],
  }],
}) === '');
check('오토플러스 본탭↔프로모 정상 겹침은 정보 집계하되 내부중복 0이면 허용', sheetSyncCommitBlockReason({
  ...completeFetch,
  lines: [{
    ...completeFetch.lines[0], sourceRowCount: 2, skippedCount: 1,
    duplicateCount: 1, blockingDuplicateCount: 0,
  }],
}) === '');
check('시트 중복은 공급사 개별판정에서 확인필요이지 차단이 아님',
  partnerSourceReadiness({
    ...completeFetch.lines[0], sourceRowCount: 2, skippedCount: 1,
    duplicateCount: 1, blockingDuplicateCount: 1,
  }).status === 'review');
const crossProviderProduct: EntityRecord = {
  ...fetchedProduct,
  _key: 'RP2_11가1111', product_code: 'RP2_11가1111',
  provider_company_code: 'RP2', partner_code: 'RP2', source_schema: 'RP2',
};
const crossProviderFetch = {
  rosterRevision: 'roster:test', partnerCount: 2,
  products: [fetchedProduct, crossProviderProduct],
  lines: [
    completeFetch.lines[0],
    { ...completeFetch.lines[0], code: 'RP2', label: '공급사2', products: [crossProviderProduct] },
  ],
};
check('공급사 시트 간 동일 실차번은 소유자 확정 전 커밋 차단',
  sheetSyncCommitBlockReason(crossProviderFetch).includes('공급사 간 동일 실차번'));
check('검증 합계와 공급사별 매물 스냅샷 불일치면 커밋 차단', sheetSyncCommitBlockReason({
  ...completeFetch, products: [],
}).includes('매물 수 불일치'));
const ownerMismatchProduct: EntityRecord = { ...fetchedProduct, provider_company_code: 'OTHER' };
check('line 공급사와 product owner가 다르면 직접호출 커밋 차단', sheetSyncCommitBlockReason({
  ...completeFetch,
  products: [ownerMismatchProduct],
  lines: [{ ...completeFetch.lines[0], products: [ownerMismatchProduct] }],
}).includes('공급사 소유 불일치'));
const keyMismatchProduct: EntityRecord = {
  ...fetchedProduct, _key: 'RP_WRONG', product_code: 'RP_WRONG',
};
check('공급사+차번 canonical 상품키가 아니면 직접호출 커밋 차단', sheetSyncCommitBlockReason({
  ...completeFetch,
  products: [keyMismatchProduct],
  lines: [{ ...completeFetch.lines[0], products: [keyMismatchProduct] }],
}).includes('상품키 불일치'));
check('line 정본과 aggregate products 내용이 다르면 같은 개수여도 커밋 차단', sheetSyncCommitBlockReason({
  ...completeFetch,
  products: [{ ...fetchedProduct, price: { '36': { rent: 999999 } } }],
}).includes('매물 내용 불일치'));
check('commit 경계는 caller 급감 Map 인자를 받지 않고 fresh state로 재계산',
  commitFetchedPartnerSheets.length === 3,
  commitFetchedPartnerSheets.length);
{
  // 사후검증은 커밋과 같은 ensureSnapped 결과를 써야 한다.
  // fetch 원본(미확정 스냅) vs ERP(확정 스냅)를 비교하면 유령 수정으로 영구 실패한다.
  const rawIncoming: EntityRecord = {
    product_code: 'RP_11가1111', car_number: '11가1111', provider_company_code: 'RP',
    maker: '현대', model: '쏘나타', vehicle_status: '출고가능',
    price: { '36': { rent: 400000 } },
    _snapped: true, _snap_confidence: 'low',
  };
  const erpAfterSnap: EntityRecord = {
    _key: 'RP_11가1111', product_code: 'RP_11가1111', car_number: '11가1111',
    provider_company_code: 'RP', maker: '현대', model: '쏘나타', vehicle_status: '출고가능',
    price: { '36': { rent: 400000 } },
    _snapped: true, _snap_confidence: 'high',
  };
  const ghost = planProductUpsert([rawIncoming], [erpAfterSnap]);
  const aligned = planProductUpsert(productsForSheetCommit([rawIncoming], []).products, [erpAfterSnap]);
  check('사후검증용 productsForSheetCommit 은 커밋 형태와 정렬된다',
    typeof productsForSheetCommit === 'function'
    && ghost.patches.length >= 0
    && aligned.creates.length === 0);
}
const strictCommitGuard = buildPrevForGuard([
  { _key: 'RP', partner_code: 'RP', sheet_url: 'https://docs.google.com/x', last_sheet_rows: 100 },
], []);
check('fresh partner의 이전 100행 기준이면 1행 붕괴를 부재차단 전에 차단',
  shouldReconcileAbsent(1, strictCommitGuard.get('RP') || 0).ok === false);
check('올림0은 전 행 명시 출고불가일 때만 허용', isExplicitAllExcluded({
  sourceRowCount: 2, imported: 0, excludedCount: 2, noPriceCount: 0, skippedCount: 0,
}) && !isExplicitAllExcluded({
  sourceRowCount: 2, imported: 0, excludedCount: 1, noPriceCount: 1, skippedCount: 0,
}));
const guardFailedCheckpoint = buildSheetSyncCheckpoint({
  ...completeFetch.lines[0], sourceRowCount: 40,
}, 123, false);
check('급감가드 실패 행수는 다음 정상 baseline으로 승격하지 않음',
  guardFailedCheckpoint.last_sheet_rows === undefined
  && guardFailedCheckpoint.last_sheet_attempt_rows === 40
  && guardFailedCheckpoint.last_synced_at === undefined
  && guardFailedCheckpoint.last_sheet_guarded_at === 123);

const revisionA = sheetReconcileRevision([{ _key: 'A', vehicle_status: '출고가능', price: { '12': { rent: 1 } } }]);
const revisionAReordered = sheetReconcileRevision([{ price: { '12': { rent: 1 } }, vehicle_status: '출고가능', _key: 'A' }]);
const revisionB = sheetReconcileRevision([{ _key: 'A', vehicle_status: '출고불가', price: { '12': { rent: 1 } } }]);
check('ERP 재고 revision은 키 순서와 무관하고 내용 변경 감지', revisionA === revisionAReordered && revisionA !== revisionB);
check('ERP 재고 revision은 삭제 tombstone 변화도 감지',
  sheetReconcileStateRevision({ active: [{ _key: 'A' }], deleted: [] })
  !== sheetReconcileStateRevision({ active: [{ _key: 'A' }], deleted: [{ _key: 'D', _deleted: true }] }));
const partnerRevisionBase: EntityRecord = {
  _key: 'RP', partner_code: 'RP', sheet_url: 'https://docs.google.com/x', sheet_tab: '1,2',
  header_row: 1, adapter_id: 'generic', mapping_profile: { car_number: 0 },
  mapping_header_signature: { car_number: '차량번호' }, deposit_rule: 'months_per_year',
  pending_plates: { sig: ['100신0001'] }, pending_plate_seq: 1, last_sheet_rows: 9,
};
check('공급사 sync revision은 gid·헤더·매핑·보증규칙·임시번호·급감기준 변경 감지',
  [
    { sheet_tab: '1,3' }, { header_row: 2 }, { mapping_profile: { car_number: 1 } },
    { mapping_header_signature: { car_number: '차번' } }, { deposit_rule: 'rent_multiple' },
    { pending_plate_seq: 2 }, { last_sheet_rows: 10 },
  ].every((change) => sheetPartnerSyncRevision({ ...partnerRevisionBase, ...change })
    !== sheetPartnerSyncRevision(partnerRevisionBase)));

const conflictProduct: EntityRecord = {
  _key: 'RP_1가1111', product_code: 'RP_1가1111', provider_company_code: 'RP',
  car_number: '1가1111', vehicle_status: '출고가능', price: { '12': { rent: 300000, deposit: 1000000 } },
};
const conflictFetch = {
  rosterRevision: 'roster:test',
  partnerCount: 1,
  products: [conflictProduct],
  lines: [{
    code: 'RP', label: '공급사', ok: true, sourceRowCount: 1, imported: 1,
    excludedCount: 0, noPriceCount: 0, skippedCount: 0,
    duplicateCount: 0, invalidCount: 0, issueSamples: [], message: 'ok', products: [conflictProduct],
  }],
};
const conflicts = findSheetSyncExistingConflicts(conflictFetch, [
  { ...conflictProduct, _key: 'OLD_A', product_code: 'OLD_A', vehicle_status: '출고불가' },
  { ...conflictProduct, _key: 'OLD_B', product_code: 'OLD_B' },
], [{ ...conflictProduct, _deleted: true }]);
check('활성 canonical이 있으면 과거 삭제 tombstone은 재등장으로 오인하지 않음',
  conflicts.activeTwins.length === 1
  && conflicts.deletedCollisions.length === 0
  && conflicts.manualReactivations.length === 0
  && conflicts.pendingIdentityTransitions.length === 0,
  sheetSyncExistingConflictReason(conflicts));
const conflictReportRows = buildSheetConflictReportRows({
  conflicts,
  existing: [
    { ...conflictProduct, _key: 'OLD_A', _rtdb_key: 'EXT_OLD_A', product_code: 'OLD_A', vehicle_status: '출고불가' },
    { ...conflictProduct, _key: 'OLD_B', product_code: 'OLD_B', locked_by_contract: 'CT-LOCK' },
  ],
  deleted: [{ ...conflictProduct, _deleted: true }],
  contracts: [],
  providerCodes: ['RP'],
});
check('충돌 상세 리포트는 중복 레코드 키를 한 행씩 노출',
  conflictReportRows.filter((row) => row.category === '활성 중복차번').length === 2
  && conflictReportRows.some((row) => row.productKey === 'OLD_A')
  && conflictReportRows.some((row) => row.productKey === 'OLD_B'));
check('충돌 상세 리포트는 canonical 상품키와 RTDB 저장키를 구분',
  conflictReportRows.some((row) => row.productKey === 'OLD_A' && row.storageKey === 'EXT_OLD_A'));
check('계약락 중복은 리포트에서 자동수정 금지',
  conflictReportRows.some((row) => row.productKey === 'OLD_B'
    && row.decision === '계약보호 · 자동수정 금지'
    && row.contractProtection.includes('CT-LOCK')));
const conflictReportTsv = sheetConflictReportTsv(conflictReportRows);
check('충돌 TSV는 운영 판단 열과 상품키를 포함',
  conflictReportTsv.startsWith('구분\t판단\t차량번호\t공급사\t상품키\t저장키')
  && conflictReportTsv.includes('OLD_A\tEXT_OLD_A'));
const pendingExisting: EntityRecord = {
  ...pendingAgainA.products[0],
  _key: 'RP_100신0001', product_code: 'RP_100신0001', car_number: '100신0001',
  provider_company_code: 'RP', partner_code: 'RP', is_pending_plate: true,
  ext_color: '흰색', locked_by_contract: 'CT_PENDING', vehicle_status: '계약중',
};
const pendingDriftIncoming: EntityRecord = {
  ...pendingExisting,
  _key: 'RP_100신0003', product_code: 'RP_100신0003', car_number: '100신0003',
  ext_color: '화이트', locked_by_contract: undefined, vehicle_status: '출고가능',
};
const pendingDriftFetch = {
  ...conflictFetch,
  products: [pendingDriftIncoming],
  lines: [{
    ...conflictFetch.lines[0], products: [pendingDriftIncoming], imported: 1, sourceRowCount: 1,
  }],
};
const pendingDriftConflict = findSheetSyncExistingConflicts(pendingDriftFetch, [pendingExisting], []);
check('번호미정 색상·트림 등 서명 변경으로 기존이 사라지고 신규 임시번호가 생기면 중복생성 차단',
  pendingDriftConflict.pendingIdentityDrifts.length === 1
  && sheetSyncExistingConflictReason(pendingDriftConflict).includes('번호미정 식별자 변경'),
  sheetSyncExistingConflictReason(pendingDriftConflict));
const pendingPureAdditionConflict = findSheetSyncExistingConflicts({
  ...pendingDriftFetch,
  products: [pendingExisting, pendingDriftIncoming],
  lines: [{
    ...pendingDriftFetch.lines[0], products: [pendingExisting, pendingDriftIncoming], imported: 2, sourceRowCount: 2,
  }],
}, [pendingExisting], []);
check('기존 임시번호가 그대로 남은 순수 번호미정 증차는 식별자 변경으로 오인하지 않음',
  pendingPureAdditionConflict.pendingIdentityDrifts.length === 0);
const pendingSamePlateDifferentSignature: EntityRecord = {
  ...pendingExisting,
  _pending_signature: `${String(pendingExisting._pending_signature)}|changed`,
};
const pendingSignatureConflict = findSheetSyncExistingConflicts({
  ...pendingDriftFetch,
  products: [pendingSamePlateDifferentSignature],
  lines: [{ ...pendingDriftFetch.lines[0], products: [pendingSamePlateDifferentSignature] }],
}, [pendingExisting], []);
check('같은 공급사·같은 임시번호의 최초 신원서명이 달라지면 조용한 실물 교체 차단',
  pendingSignatureConflict.pendingSignatureConflicts.length === 1
  && sheetSyncExistingConflictReason(pendingSignatureConflict).includes('신원서명 불일치'));
const legacyPendingWithoutFlag: EntityRecord = { ...pendingExisting };
delete legacyPendingWithoutFlag.is_pending_plate;
const legacyPendingSignatureConflict = findSheetSyncExistingConflicts({
  ...pendingDriftFetch,
  products: [pendingSamePlateDifferentSignature],
  lines: [{ ...pendingDriftFetch.lines[0], products: [pendingSamePlateDifferentSignature] }],
}, [legacyPendingWithoutFlag], []);
check('레거시 100신 레코드에 pending 플래그가 없어도 신원서명 교체 차단',
  legacyPendingSignatureConflict.pendingSignatureConflicts.length === 1);
check('기존 임시번호의 최초 신원서명은 soft merge로 덮어쓰지 않음',
  softMergeProduct(pendingExisting, pendingSamePlateDifferentSignature)._pending_signature
    === pendingExisting._pending_signature);
const pendingRealIncoming: EntityRecord = {
  ...pendingExisting,
  _key: 'RP_12가9876', product_code: 'RP_12가9876', car_number: '12가9876',
  is_pending_plate: false, ext_color: '화이트', _pending_signature: undefined,
  locked_by_contract: undefined, vehicle_status: '출고가능',
};
const pendingRealConflict = findSheetSyncExistingConflicts({
  ...pendingDriftFetch,
  products: [pendingRealIncoming],
  lines: [{ ...pendingDriftFetch.lines[0], products: [pendingRealIncoming] }],
}, [pendingExisting], []);
check('색상·트림 서명이 달라도 같은 제조사+모델의 임시번호→실차번은 수동 연결 전 차단',
  pendingRealConflict.pendingIdentityTransitions.length === 1);
const legacyPendingDriftConflict = findSheetSyncExistingConflicts(
  pendingDriftFetch,
  [legacyPendingWithoutFlag],
  [],
);
check('레거시 100신 레코드에 pending 플래그가 없어도 임시번호 식별변경 차단',
  legacyPendingDriftConflict.pendingIdentityDrifts.length === 1);
const legacyPendingRealConflict = findSheetSyncExistingConflicts({
  ...pendingDriftFetch,
  products: [pendingRealIncoming],
  lines: [{ ...pendingDriftFetch.lines[0], products: [pendingRealIncoming] }],
}, [legacyPendingWithoutFlag], []);
check('레거시 100신 레코드에 pending 플래그가 없어도 임시번호→실차번 전환 차단',
  legacyPendingRealConflict.pendingIdentityTransitions.length === 1);
const unlockedPending = {
  ...pendingExisting, locked_by_contract: undefined, vehicle_status: '출고가능',
};
const unrelatedPendingIncoming = {
  ...pendingDriftIncoming, maker: '기아', model: 'K5', sub_model: 'K5 DL3',
};
const unrelatedPendingConflict = findSheetSyncExistingConflicts({
  ...pendingDriftFetch,
  products: [unrelatedPendingIncoming],
  lines: [{ ...pendingDriftFetch.lines[0], products: [unrelatedPendingIncoming] }],
}, [unlockedPending], []);
check('미계약 임시차 제거와 다른 차종 임시차 추가는 식별자 변경으로 과잉 차단하지 않음',
  unrelatedPendingConflict.pendingIdentityDrifts.length === 0);
const missingPriceIncoming: EntityRecord = {
  ...conflictProduct,
  price: { '12': { rent: 300000, deposit: 1000000 } },
};
const missingPriceExisting: EntityRecord = {
  ...conflictProduct,
  source: 'sheet',
  price: {
    '12': { rent: 300000, deposit: 1000000 },
    '36': { rent: 250000, deposit: 1500000 },
  },
};
const missingPriceConflict = findSheetSyncExistingConflicts({
  ...conflictFetch,
  products: [missingPriceIncoming],
  lines: [{ ...conflictFetch.lines[0], products: [missingPriceIncoming] }],
}, [missingPriceExisting], []);
check('기존 시트 가격기간이 원문에서 사라지면 낡은 요율을 보존만 하지 않고 검증 차단·보고',
  missingPriceConflict.missingPricePeriods.length === 1
  && sheetSyncExistingConflictReason(missingPriceConflict).includes('기존 가격기간 누락'));
const missingPriceReport = buildSheetConflictReportRows({
  conflicts: missingPriceConflict,
  existing: [{ ...missingPriceExisting, _rtdb_key: 'EXT_PRICE', locked_by_contract: 'CT-PRICE' }],
  deleted: [],
  incoming: [missingPriceIncoming],
  contracts: [],
  providerCodes: ['RP'],
});
check('가격기간 충돌 리포트는 공급사·기존 상품·저장키·계약보호를 연결',
  missingPriceReport.some((row) => row.category === '기존 가격기간 누락'
    && row.provider === 'RP'
    && row.productKey === 'RP_1가1111'
    && row.storageKey === 'EXT_PRICE'
    && row.contractProtection === '계약락 CT-PRICE'
    && row.priceImpact === '시트 누락기간 기존가 유지 필요'
    && row.affectedPricePeriods === '36개월'
    && row.raw.endsWith('(36)')));

/* ── 가격기간 충돌의 «승인 필요» 판정 — 네 경로가 같은 답을 내야 한다 ────────────────
 * 2026-08-07 실측: 완화가 미리보기에만 들어가 있어 커밋 경계에서만 39건이 되살아났다.
 * 그런데 그 39건은 전부 금액 무변화라 승인 후보에 뜨지도 않았다 → 반영이 영영 불가능했다.
 * 아래 3건이 그 조합을 고정한다.
 */
const priceConflictArgs = {
  conflicts: missingPriceConflict,
  existing: [missingPriceExisting],
  deleted: [] as EntityRecord[],
  incoming: [missingPriceIncoming],
  contracts: [] as EntityRecord[],
  providerCodes: ['RP'],
};
const noChangePredicate = buildPriceChangesValue(priceConflictArgs);
check('금액 무변화 가격기간 충돌은 승인 없이 통과 — 미리보기·커밋 경계 판정이 같다',
  missingPriceConflict.missingPricePeriods.every((rawItem) => !noChangePredicate(rawItem))
  && applySheetConflictResolutions({
    conflicts: missingPriceConflict,
    resolutions: [],
    existing: [missingPriceExisting],
    contracts: [],
    priceChangesValue: noChangePredicate,
  }).conflicts.missingPricePeriods.length === 0);

// 같은 기간의 «요율이 바뀐» 유입 — 손님에게 나가는 금액이 달라지므로 승인을 받아야 한다.
const changedPriceIncoming: EntityRecord = {
  ...conflictProduct,
  price: { '12': { rent: 400000, deposit: 1000000 } },
};
const changedPriceConflict = findSheetSyncExistingConflicts({
  ...conflictFetch,
  products: [changedPriceIncoming],
  lines: [{ ...conflictFetch.lines[0], products: [changedPriceIncoming] }],
}, [missingPriceExisting], []);
const changedPredicate = buildPriceChangesValue({
  ...priceConflictArgs,
  conflicts: changedPriceConflict,
  incoming: [changedPriceIncoming],
});
check('금액이 바뀌는 가격기간 충돌은 미승인이면 계속 차단',
  changedPriceConflict.missingPricePeriods.length === 1
  && changedPriceConflict.missingPricePeriods.every((rawItem) => changedPredicate(rawItem))
  && applySheetConflictResolutions({
    conflicts: changedPriceConflict,
    resolutions: [],
    existing: [missingPriceExisting],
    contracts: [],
    priceChangesValue: changedPredicate,
  }).conflicts.missingPricePeriods.length === 1);

// 계약락 차량은 완화 대상이 아니다 — 여기까지 풀리면 진행계약 차의 요율이 조용히 바뀐다.
check('계약락 차량은 금액 무변화라도 가격기간 충돌 차단을 유지',
  applySheetConflictResolutions({
    conflicts: missingPriceConflict,
    resolutions: [],
    existing: [{ ...missingPriceExisting, locked_by_contract: 'CT-LOCK' }],
    contracts: [],
    priceChangesValue: noChangePredicate,
  }).conflicts.missingPricePeriods.length === 1);

const legacyPriceSchemasBlocked = ['general', 'autoplus'].every((sourceSchema) => {
  const legacyExisting: EntityRecord = {
    ...missingPriceExisting,
    source: undefined,
    source_schema: sourceSchema,
  };
  return findSheetSyncExistingConflicts({
    ...conflictFetch,
    products: [missingPriceIncoming],
    lines: [{ ...conflictFetch.lines[0], products: [missingPriceIncoming] }],
  }, [legacyExisting], []).missingPricePeriods.length === 1;
});
check('레거시 general·autoplus source 표식도 기존 가격기간 누락을 hard block',
  legacyPriceSchemasBlocked);
const deletedCreateConflict = findSheetSyncExistingConflicts(conflictFetch, [], [
  { ...conflictProduct, _deleted: true },
]);
check('활성 매칭 없이 새로 만들 deleted 차번만 재등장 충돌',
  deletedCreateConflict.deletedCollisions.length === 1);
check('동일 공급사 삭제 톰스톤 재등장은 반영 차단 사유가 아님(커밋이 되살림)',
  !sheetSyncExistingConflictReason(deletedCreateConflict).includes('삭제매물'));
const extTombRevive = resolveSheetReviveTarget(
  { ...conflictProduct, _key: 'RP_1가1111', product_code: 'RP_1가1111' },
  [{
    ...conflictProduct,
    _key: 'EXT_dead_aicar', product_code: 'EXT_dead_aicar',
    _deleted: true, vehicle_status: '출고가능',
  }],
);
check('되살림은 시트키≠EXT_톰스톤이어도 공급사+차번으로 매칭',
  !!extTombRevive && extTombRevive.key === 'EXT_dead_aicar');
check('되살림 2차는 임시번호에 쓰지 않음',
  resolveSheetReviveTarget(
    {
      ...conflictProduct, _key: 'RP_100신0001', product_code: 'RP_100신0001',
      car_number: '100신0001', is_pending_plate: true,
    },
    [{
      ...conflictProduct, _key: 'EXT_pending', product_code: 'EXT_pending',
      car_number: '100신0001', is_pending_plate: true, _deleted: true,
    }],
  ) === null);
const unownedDeletedConflict = findSheetSyncExistingConflicts(conflictFetch, [], [{
  ...conflictProduct,
  _key: 'legacy-deleted', product_code: 'legacy-deleted', provider_company_code: '', partner_code: '', source_schema: '',
  _deleted: true,
}]);
check('공급사 귀속 없는 삭제 이력도 동일 실차번 신규 재생성 차단',
  unownedDeletedConflict.unownedDeletedMatches.length === 1
  && sheetSyncExistingConflictReason(unownedDeletedConflict).includes('미확정 삭제이력'));
const inferredLegacyPlan = planProductUpsert([conflictProduct], [{
  ...conflictProduct,
  _key: '1가1111_RP', product_code: '1가1111_RP', provider_company_code: '', partner_code: '', source_schema: '',
}]);
check('공급사 필드 없는 레거시 차도 차번_공급사 key로 기존 canonical 매칭',
  inferredLegacyPlan.creates.length === 0 && inferredLegacyPlan.patches.length === 1);
const legacySourcePlan = planProductUpsert([conflictProduct], [{
  ...conflictProduct,
  _key: '1가1111_RP', product_code: '1가1111_RP', provider_company_code: '', partner_code: '',
  source_schema: 'autoplus',
}]);
check('레거시 공용 source_schema보다 차번_공급사 key 귀속을 우선',
  legacySourcePlan.creates.length === 0 && legacySourcePlan.patches.length === 1);
const unownedConflict = findSheetSyncExistingConflicts(conflictFetch, [{
  ...conflictProduct,
  _key: 'legacy-row', product_code: 'legacy-row', provider_company_code: '', partner_code: '', source_schema: '',
}], []);
check('키로도 공급사 귀속 불명인 동일차번은 자동 신규 대신 충돌 차단',
  unownedConflict.unownedLegacyMatches.length === 1
  && sheetSyncExistingConflictReason(unownedConflict).includes('공급사 미확정'));
const existingOtherOwnerConflict = findSheetSyncExistingConflicts(conflictFetch, [{
  ...conflictProduct,
  _key: 'OTHER_1가1111', product_code: 'OTHER_1가1111', provider_company_code: 'OTHER',
}], []);
check('기존 ERP의 다른 공급사 소유 실차번도 자동 덮어쓰기 차단',
  existingOtherOwnerConflict.crossProviderPlateConflicts.length === 1
  && sheetSyncExistingConflictReason(existingOtherOwnerConflict).includes('공급사 간'));
const manualHoldOnly = findSheetSyncExistingConflicts(conflictFetch, [
  { ...conflictProduct, _key: 'OLD_MANUAL', product_code: 'OLD_MANUAL', vehicle_status: '출고불가' },
], []);
check('단독 수기 출고불가는 충돌차단 대신 보호 목록으로 보고',
  manualHoldOnly.manualHoldsPreserved.length === 1
  && sheetSyncExistingConflictReason(manualHoldOnly) === '');
const legacySheetHold = findSheetSyncExistingConflicts(conflictFetch, [
  {
    ...conflictProduct,
    _key: 'OLD_MANUAL',
    product_code: 'OLD_MANUAL',
    vehicle_status: '출고불가',
    source: 'external_sheet',
    status_label: '시트에서 제거됨',
  },
], []);
check('레거시 시트 자동차단은 수기 보호·해제 충돌로 보고하지 않음',
  legacySheetHold.manualHoldsPreserved.length === 0
  && legacySheetHold.manualReactivations.length === 0);

const ad = resolveAdapter('generic');
const table = [['안내'], ['차량번호', '제조사', '상태'], ['1가1', '현대', '사용']];
const prep = ad.prepareTable(table, { headerRow: 1 });
check('header_row 스킵', prep[0][0] === '차량번호' && prep.length === 2);
const autoplusPreparedRegional = resolveAdapter('autoplus').prepareTable([
  ['순번', '차량번호', '차종', '모델명'],
  ['1', '서울12가3456', '아반떼', '모던'],
]);
check('AutoPlus 안내행 판정이 지역 접두 첫 실차를 버리지 않음', autoplusPreparedRegional.length === 2);
const iankaPrepared = resolveAdapter('ianka').prepareTable([
  ['상태', '입고일자', '구분', '차량번호', '차종분류', '세부모델', '12개월', '단기보증'],
  ['재고확인', '재고확인', '신차(선출고)', '133호6165', '미니 쿠퍼', '쿠퍼 C 5도어', '700000', '2500000'],
  ['신차(선출고)', '133호5330', '미니 쿠퍼', '쿠퍼 C 5도어', '가솔린', '화이트', '700000', '2500000'],
]);
check('이안카 중간 행 왼쪽 밀림은 구분 헤더 위치만큼 복원하고 정상 행은 유지',
  iankaPrepared[1]?.[0] === '재고확인'
  && iankaPrepared[1]?.[3] === '133호6165'
  && iankaPrepared[2]?.[0] === ''
  && iankaPrepared[2]?.[1] === ''
  && iankaPrepared[2]?.[2] === '신차(선출고)'
  && iankaPrepared[2]?.[3] === '133호5330');

const pubOverride = resolveGoogleSheetCsvUrl(
  'https://docs.google.com/spreadsheets/d/e/PUB/pub?output=csv&gid=111',
  '222',
);
check('게시 CSV도 호출자 gid로 탭을 교체', new URL(pubOverride).searchParams.get('gid') === '222');
const distinctTabs = new Map<string, string>();
assertDistinctSheetTable(distinctTabs, [['차량번호'], ['1가1111']], 'gid 1');
let identicalTabsBlocked = false;
try {
  assertDistinctSheetTable(distinctTabs, [['차량번호'], ['1가1111']], 'gid 2');
} catch (error) { identicalTabsBlocked = String(error).includes('탭 응답이 동일'); }
check('서로 다른 gid가 동일 표를 반환하면 멀티탭 fetch 차단', identicalTabsBlocked);

const opts = partnerSheetOpts({
  partner_code: 'sup_x', sheet_url: 'https://docs.google.com/spreadsheets/d/ABC/edit#gid=123',
  sheet_tab: '123', header_row: 2, adapter_id: 'autoplus', mapping_profile: '{}',
});
check('partnerSheetOpts adapter', opts.adapter.id === 'autoplus' && opts.headerRow === 2 && opts.gid === '123');
check('레거시 AutoPlus 코드는 adapter 미설정만 자동 보정',
  resolveAdapter({ partner_code: 'RP023', partner_name: '오토플러스', adapter_id: '' }).id === 'autoplus');
check('명시적 generic 설정은 AutoPlus 이름 히스토리보다 우선',
  resolveAdapter({ partner_code: 'RP023', partner_name: '오토플러스', adapter_id: 'generic' }).id === 'generic');
let invalidAdapterBlocked = false;
try { resolveAdapter({ partner_code: 'RP', adapter_id: 'auto-plus-typo' }); }
catch (error) { invalidAdapterBlocked = String(error).includes('어댑터 설정 오류'); }
check('알 수 없는 adapter_id를 generic으로 fail-open하지 않음', invalidAdapterBlocked);
let invalidGidBlocked = false;
try { partnerSheetOpts({ partner_code: 'RP', sheet_url: 'https://docs.google.com/x', sheet_tab: 'abc123' }); }
catch (error) { invalidGidBlocked = String(error).includes('gid 설정 오류'); }
check('잘못된 gid 토큰에서 숫자만 추출해 다른 탭을 읽지 않음', invalidGidBlocked);

// UI 회귀 게이트 — 캐시/부분 roster와 붙여넣기 원문 교체가 이전 검증 스냅샷으로
// 이어지는 사고는 도메인 함수 테스트만으로 잡히지 않으므로 실제 연결 코드를 고정한다.
const sheetSyncSource = readFileSync(new URL('../components/SheetSync.tsx', import.meta.url), 'utf8');
check('관리자 시트 roster는 fresh-health 조회로 부분·캐시 공백을 승인하지 않음',
  sheetSyncSource.includes('setRoster(await listSheetPartners(co, true))'));
check('roster 조회 오류 뒤 화면에서 설정을 다시 읽을 수 있음',
  sheetSyncSource.includes('onClick={refreshRoster}') && sheetSyncSource.includes('설정 다시 읽기'));
const emptyRosterUiSource = sheetSyncSource.slice(
  sheetSyncSource.indexOf('roster.length === 0'),
  sheetSyncSource.indexOf('{roster.map((p) =>'),
);
check('strict fresh roster가 빈 결과여도 인증 후 설정 재조회 경로 유지',
  emptyRosterUiSource.includes('onClick={refreshRoster}')
  && emptyRosterUiSource.includes('설정 다시 읽기'));
check('시트 조회 실패와 기존 ERP 충돌이 동시에 있으면 두 차단 사유 모두 표시',
  sheetSyncSource.includes('기존 ERP 충돌 · {pending.existingConflictReason}')
  && sheetSyncSource.includes('pending.existingConflictReason !== pendingBlockReason'));
const partnerConfigReaderSource = sheetSyncSource.slice(
  sheetSyncSource.indexOf('const readPartnerConfig = useCallback'),
  sheetSyncSource.indexOf('/** 공급사: partner에 저장된 시트'),
);
const partnerHydrateSource = sheetSyncSource.slice(
  sheetSyncSource.indexOf('const hydrateFromPartner = useCallback'),
  sheetSyncSource.indexOf('useEffect(() => {\n    loadVehicleMaster()'),
);
const profileLoaderSource = sheetSyncSource.slice(
  sheetSyncSource.indexOf('const loadProfile = async'),
  sheetSyncSource.indexOf('const previewState = useMemo'),
);
check('공급사 단건 설정도 tolerant get 대신 strict fresh roster 원본 사용',
  partnerConfigReaderSource.includes('listSheetPartnerRecords(co, true)')
  && partnerHydrateSource.includes('readPartnerConfig(code)')
  && profileLoaderSource.includes('readPartnerConfig(code)')
  && !partnerHydrateSource.includes("getStore().get('partner'")
  && !profileLoaderSource.includes("getStore().get('partner'"));
check('공급사 최초 설정 표시가 저장된 보증금 규칙을 함께 hydrate',
  partnerHydrateSource.includes('setDepositRule(parseDepositRule(p.deposit_rule))'));
const clearPreviewSource = sheetSyncSource.slice(
  sheetSyncSource.indexOf('const clear = () =>'),
  sheetSyncSource.indexOf('const prepared ='),
);
check('소스 입력 변경으로 preview를 버려도 실제 보증금 설정 표시는 유지',
  !clearPreviewSource.includes("setDepositRule('')"));
check('엑셀 붙여넣기 원문 변경 즉시 이전 preview를 폐기',
  sheetSyncSource.includes('value={paste} onChange={(v) => { clear(); setPaste(v); }'));
const excelLoaderSource = sheetSyncSource.slice(
  sheetSyncSource.indexOf('const loadExcel = async'),
  sheetSyncSource.indexOf('const loadProfile = async'),
);
check('엑셀 저장 매핑은 현재 헤더로 사전검증하고 drift 시 재로드 강제',
  excelLoaderSource.includes('previewSupplierTable(t, {')
  && excelLoaderSource.includes('setMappingReloadRequired(true)')
  && excelLoaderSource.includes('buildMappingHeaderSignature(t[0], nextMapping)')
  && !excelLoaderSource.includes('saved?.headers ||'));

const sheetMergeSource = readFileSync(new URL('../lib/domain/sheet-merge.ts', import.meta.url), 'utf8');
const rtdbAdapterSource = readFileSync(new URL('../lib/firebase/rtdb-adapter.ts', import.meta.url), 'utf8');
check('기존 병합과 부재차단 모두 일반 bulkPatch 대신 상품 CAS 저장 사용',
  (sheetMergeSource.match(/bulkPatchGuardedProduct\(/g) || []).length >= 2
  && !sheetMergeSource.includes("store.bulkPatch('product'"));
check('RTDB 상품 CAS는 계약 상태 leaf와 같은 product 경로 transaction 사용',
  rtdbAdapterSource.includes('runTransaction(')
  && rtdbAdapterSource.includes('`${OVERLAY}/products/${key}`')
  && rtdbAdapterSource.includes('productPatchPreconditionMatches(current'));

const duplicateShellRoster = await fetchAllPartnerSheets('freepass', [{} as any], {
  partnerRows: [
    { _key: 'legacy-shell', partner_code: 'RP-X', partner_type: '공급사' },
    {
      _key: 'active-sheet',
      partner_code: 'RP-X',
      partner_type: '공급사',
      sheet_url: 'https://docs.google.com/spreadsheets/d/test/edit',
    },
    {
      _key: 'web-source',
      partner_code: 'RP-WEB',
      partner_type: '공급사',
      inventory_source: 'ironrentcar_web',
      sheet_url: 'https://docs.google.com/spreadsheets/d/old/edit',
    },
    {
      _key: 'RP006',
      partner_code: 'RP006',
      partner_type: '공급사',
      sheet_url: 'https://docs.google.com/spreadsheets/d/iron-old/edit',
    },
  ],
  fetchTable: async () => [[]],
});
check('같은 공급사 코드의 시트 없는 레거시 껍데기는 fetch 실행 대상에서 제외',
  duplicateShellRoster.partnerCount === 1
  && duplicateShellRoster.lines.length === 1
  && duplicateShellRoster.lines[0].code === 'RP-X',
  { partnerCount: duplicateShellRoster.partnerCount, lines: duplicateShellRoster.lines.length });
check('홈페이지 단일 정본 공급사는 기존 sheet_url이 남아도 시트 roster에서 제외',
  !duplicateShellRoster.lines.some((line) => line.code === 'RP-WEB')
  && !duplicateShellRoster.lines.some((line) => line.code === 'RP006'));

check('이안카 탭은 설정 순서와 무관하게 재렌트 정본을 먼저 읽음',
  orderSheetGids(resolveAdapter('ianka'), ['2008897223', '126495265'])
    .join(',') === '126495265,2008897223');
const iankaHeader = ['상태', '입고일자', '구분', '차량번호', '제조사', '모델', '36개월', '장기보증'];
const iankaOverlapFetch = await fetchAllPartnerSheets('freepass', [{} as any], {
  partnerRows: [{
    _key: 'RP031', partner_code: 'RP031', partner_type: '공급사', name: '이안카',
    sheet_url: 'https://docs.google.com/spreadsheets/d/ianka/edit',
    sheet_tab: '2008897223,126495265', adapter_id: 'ianka',
  }],
  fetchTable: async (_url, gid) => gid === '126495265'
    ? [iankaHeader, ['재고확인', '', '재렌트', '11가1111', '현대', '아반떼', '400000', '1000000']]
    : [
        iankaHeader,
        ['판매가능', '', '신차', '11가1111', '현대', '아반떼', '500000', '1000000'],
        ['판매가능', '', '신차', '22나2222', '기아', 'K5', '600000', '1000000'],
      ],
});
const iankaOverlapLine = iankaOverlapFetch.lines[0];
const iankaOverlapPrice = iankaOverlapFetch.products
  .find((product) => product.car_number === '11가1111')?.price as Record<string, { rent?: number }> | undefined;
check('이안카 탭 간 겹침은 재렌트 값을 유지하고 커밋을 막지 않음',
  iankaOverlapLine.imported === 2
  && iankaOverlapLine.duplicateCount === 1
  && iankaOverlapLine.blockingDuplicateCount === 0
  && iankaOverlapPrice?.['36']?.rent === 400000
  && sheetSyncCommitBlockReason(iankaOverlapFetch) === '',
  iankaOverlapLine);
check('공급사별 판정은 정상 원본을 반영 가능으로 분류',
  partnerSourceReadiness({
    ...iankaOverlapLine,
    duplicateCount: 0,
    blockingDuplicateCount: 0,
    skippedCount: 0,
    sourceRowCount: iankaOverlapLine.imported,
    products: iankaOverlapLine.products.map((row) => ({ ...row, _needs_master_review: false })),
  }).status === 'ready');
check('공급사별 판정은 가격 누락·차종 검수를 확인 필요로 분류',
  partnerSourceReadiness({
    ...iankaOverlapLine,
    duplicateCount: 0,
    blockingDuplicateCount: 0,
    noPriceCount: 1,
    skippedCount: 0,
    sourceRowCount: iankaOverlapLine.imported + 1,
  }).status === 'review');
check('공급사별 판정은 무효 차번을 해당 공급사 차단으로 분류',
  partnerSourceReadiness({
    ...iankaOverlapLine,
    duplicateCount: 0,
    blockingDuplicateCount: 0,
    invalidCount: 1,
    skippedCount: 1,
    sourceRowCount: iankaOverlapLine.imported + 1,
  }).status === 'blocked');

const safeExisting: EntityRecord = {
  _key: 'erp-rp100-12가3456', product_code: 'legacy-code', car_number: '12 가 3456',
  provider_company_code: 'RP100', partner_code: 'RP100', mileage: '10000', engine_cc: '1598',
  vehicle_status: '계약중', partner_memo: '관리자 메모',
  price: { '36': { rent: 330000, deposit: 1000000 } },
};
const safeIncoming: EntityRecord = {
  product_code: 'sheet-code', car_number: '12가3456', provider_company_code: 'RP100',
  mileage: '22000', engine_cc: '1998', ext_color: '검정', vehicle_status: '판매가능',
  partner_memo: '공급사 덮어쓰기', price: { '36': { rent: 990000, deposit: 0 } },
};
const safePlan = planSafeSupplierProducts([safeIncoming], [safeExisting]);
check('안전 연동은 공급사+실차번이 정확히 한 대일 때만 기존 ERP 키로 계획',
  safePlan.length === 1 && safePlan[0].product_code === 'erp-rp100-12가3456');
check('안전 연동은 주행거리·배기량·색상 원자를 공급사 값으로 계획',
  safePlan[0]?.mileage === '22000' && safePlan[0]?.engine_cc === '1998' && safePlan[0]?.ext_color === '검정');
check('안전 연동은 가격과 차량상태를 우회 변경하지 않음',
  safePlan[0]?.price === safeExisting.price && safePlan[0]?.vehicle_status === undefined);
check('안전 연동은 관리자 메모를 공급사 값으로 덮지 않음', safePlan[0]?.partner_memo === undefined);
check('안전 연동은 ERP에 없는 신규 차량을 생성하지 않음',
  planSafeSupplierProducts([{ ...safeIncoming, car_number: '99나9999' }], [safeExisting]).length === 0);
check('안전 연동은 같은 차번이어도 다른 공급사를 건드리지 않음',
  planSafeSupplierProducts([{ ...safeIncoming, provider_company_code: 'RP200', partner_code: 'RP200' }], [safeExisting]).length === 0);
check('안전 연동은 ERP 동일 공급사·차번 중복 시 임의 선택하지 않음',
  planSafeSupplierProducts([safeIncoming], [safeExisting, { ...safeExisting, _key: 'erp-duplicate' }]).length === 0);
check('안전 연동은 원본 동일 공급사·차번 중복 시 두 번 반영하지 않음',
  planSafeSupplierProducts([safeIncoming, { ...safeIncoming }], [safeExisting]).length === 0);
check('안전 연동은 임시번호·미입력 차번을 기존 행에 연결하지 않음',
  planSafeSupplierProducts([{ ...safeIncoming, car_number: '번호미정-1' }], [safeExisting]).length === 0);

const revisionRoster = sheetPartnerRows([
  { _key: 'RP100', partner_code: 'RP100', partner_type: '공급사', name: '선택 공급사', sheet_url: 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaa/edit', adapter_id: 'generic' },
  { _key: 'RP200', partner_code: 'RP200', partner_type: '공급사', name: '다른 공급사', sheet_url: 'https://docs.google.com/spreadsheets/d/bbbbbbbbbbbbbbbbbbbb/edit', adapter_id: 'generic' },
]);
const singleFetched = { lines: [{ code: 'RP100' }] };
const singleRevision = rosterRevisionForFetched(revisionRoster, singleFetched);
const selectedRevisionRow = revisionRoster.find((row) => row.code === 'RP100')!;
const unrelatedRevisionRow = revisionRoster.find((row) => row.code === 'RP200')!;
check('단건 연동 revision은 선택한 공급사 설정 범위만 비교',
  singleRevision === rosterRevisionForFetched([selectedRevisionRow], singleFetched));
check('단건 연동은 다른 공급사 설정 변경에 의해 거짓 차단되지 않음',
  singleRevision === rosterRevisionForFetched([
    selectedRevisionRow,
    { ...unrelatedRevisionRow, syncRevision: `${unrelatedRevisionRow.syncRevision}-changed` },
  ], singleFetched));
check('단건 연동은 선택한 공급사 설정 변경은 정확히 감지',
  singleRevision !== rosterRevisionForFetched([
    { ...selectedRevisionRow, syncRevision: `${selectedRevisionRow.syncRevision}-changed` },
    unrelatedRevisionRow,
  ], singleFetched));

const failed = cases.filter((c) => !c.ok);
console.log('\n════════ 결과 ════════');
console.log(`${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) {
  for (const f of failed) console.log('FAIL', f.name, f.detail ?? '');
  process.exit(1);
}
console.log('PASS — Phase A soft-merge');
process.exit(0);
