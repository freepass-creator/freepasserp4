import assert from 'node:assert/strict';
import type { EntityRecord } from '../lib/intake/entities';
import { PRODUCT_MASTER_COLUMNS } from '../lib/domain/product-master-sheet';
import {
  applyProductMasterManualGate,
  importProductMasterSheet,
  isolateProductMasterBlockedProviders,
} from '../lib/domain/product-master-import';
import { planDailySheetSync, planProductMasterProviderBatches } from '../lib/domain/sheet-daily-sync';
import { planSheetLiveStatusSync } from '../lib/domain/sheet-live-status';
import { planProductUpsert } from '../lib/domain/sheet-merge';
import type { VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';

const trim: VehicleTrimMasterRecord = {
  trim_row_key: 'mf-test::v01::t01',
  master_id: 'mf-test',
  powertrain_seq: 1,
  trim_seq: 1,
  management_status: '확정',
  verification_status: '확정',
  usage_tier: 'automatic',
  market_status: '중고차',
  origin: '국산',
  maker: '현대',
  model: '아반떼',
  sub_model: '더 뉴 아반떼 CN7',
  powertrain: '가솔린 1.6 2WD',
  trim: '스마트',
  generation_name: '7세대 부분변경',
  development_code: 'CN7',
  production_start: '2023-03',
  production_end: '현재',
  model_year_start: '2023',
  model_year_end: '현재',
  fuel: '가솔린',
  engine_cc: 1598,
  displacement_l: 1.6,
  turbo: false,
  drivetrain: '2WD',
  seats: 5,
  battery_kwh: null,
  trim_aliases: ['스마트'],
  evidence_url: 'https://example.com',
  evidence_note: 'test',
  data_as_of: '2026-08-15',
};

const partners: EntityRecord[] = [
  { _key: 'RP100', partner_code: 'RP100', name: '테스트', partner_type: '공급사' },
  { _key: 'RP023', partner_code: 'RP023', name: '오토플러스', partner_type: '공급사' },
  { _key: 'RP012', partner_code: 'RP012', name: '손오공', partner_type: '공급사' },
];

function row(values: Partial<Record<(typeof PRODUCT_MASTER_COLUMNS)[number], unknown>>): string[] {
  return PRODUCT_MASTER_COLUMNS.map((name) => String(values[name] ?? ''));
}

const standard = row({
  차량번호: '12가3456',
  공급사명: '테스트',
  '공급사 입력 차명': '더 뉴 아반떼 가솔린 스마트',
  '차종마스터 적용값': '더 뉴 아반떼 CN7 · 가솔린 1.6 2WD · 스마트',
  검증상태: '확정',
  옵션: '내비 · 선루프',
  차량상태: '출고가능',
  분류: '중고렌트',
  관리상태: '운영',
  사진링크: 'https://drive.google.com/folder/test',
  입고일자: '2026-08-15',
  '12개월 대여료': '650,000원',
  '12개월 보증금': '1,500,000원',
  정책코드: '(프리패스 기본)',
  차종코드: trim.trim_row_key,
  공급사코드: 'RP100',
  최종갱신: '2026-08-15',
  원천: '테스트 원본',
  '공급사 원문보존': '제조사: 현대 | 연식: 2026 | 연료: 가솔린 | 배기량: 1,598 | 주행거리: 950 | 외장: 흰색 | 내장: 검정 | 최초등록: 2026-01-02',
});
const autoplus = row({
  차량번호: '34나5678', 공급사명: '오토플러스', '공급사 입력 차명': 'EV6',
  '차종마스터 적용값': '더 뉴 아반떼 CN7 · 가솔린 1.6 2WD · 스마트', 검증상태: '확정',
  차량상태: '출고가능', 분류: '미분류', 관리상태: '운영',
  '12개월 대여료': 900000, '12개월 보증금': 1800000,
  '18개월 대여료': 800000, '18개월 보증금': 1600000,
  '18개월 3만km 대여료': 850000, '18개월 3만km 보증금': 1700000,
  정책코드: '(프리패스 기본)', 차종코드: trim.trim_row_key, 공급사코드: 'RP023',
  '공급사 원문보존': '제조사: 기아 | 주행거리: 6.5만km',
});
const sonogong = row({
  차량번호: '56다7890', 공급사명: '손오공', '공급사 입력 차명': '쏘나타',
  검증상태: '미매칭', 검수사유: '차종코드 미매칭', 차량상태: '계약중',
  분류: '구독', 관리상태: '검수필요', '36개월 대여료': 700000, '36개월 보증금': 2100000,
  '인수형 36개월 대여료': 900000, '인수형 36개월 보증금': 2700000,
  정책코드: 'RP012_SUB', 공급사코드: 'RP012',
  '공급사 원문보존': '공급사 제조사: 현대 | 연식: 26MY | 유종: LPG | 배기: 2,000cc | 주행: 1.2만',
});

const fetched = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], standard, autoplus, sonogong],
  partners,
  trimRecords: [trim],
  tabGid: '679088240',
});
assert.equal(fetched.sourceKind, 'product_master');
assert.equal(fetched.sourceScope, 'all');
assert.equal(fetched.products.length, 3);
assert.equal(fetched.lines.length, 3);

const codeOnlyPartnerFetch = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], standard],
  partners: [{ _key: 'RP100', partner_code: 'RP100', name: 'RP100', partner_type: '공급사' }],
  trimRecords: [trim],
});
assert.equal(codeOnlyPartnerFetch.lines[0]?.label, '테스트',
  '파트너 name이 코드뿐이면 상품마스터 공급사명을 관리자 표시명으로 쓴다');
const standardProduct = fetched.products.find((item) => item.car_number === '12가3456')!;
assert.equal(standardProduct.maker, '현대');
assert.equal(standardProduct.sub_model, '더 뉴 아반떼 CN7');
assert.equal(standardProduct.variant, '가솔린 1.6 2WD');
assert.equal(standardProduct.trim_name, '스마트');
assert.equal(standardProduct.mileage, 950);
assert.equal(standardProduct.engine_cc, '1598');
assert.equal(standardProduct.options, '내비, 선루프');
assert.deepEqual((standardProduct.price as Record<string, unknown>)['12'], { rent: 650000, deposit: 1500000 });

const staleIdentity: EntityRecord = {
  ...standardProduct,
  maker: '테슬라',
  model: 'Model Y',
  sub_model: 'Model Y',
  catalog_id: 'wrong-master',
  trim_row_key: 'wrong-trim',
  _product_master_identity_authoritative: undefined,
  _sheet_manual_fields: ['catalog_id', 'trim_row_key'],
};
const identityCorrection = planProductUpsert([standardProduct], [staleIdentity]);
assert.equal(identityCorrection.patches.length, 1);
assert.equal(identityCorrection.patches[0].patch.maker, trim.maker);
assert.equal(identityCorrection.patches[0].patch.sub_model, trim.sub_model);
assert.equal(identityCorrection.patches[0].patch.catalog_id, trim.master_id,
  '검증된 상품마스터 코드는 예전 수동 catalog_id 오매칭도 교정한다');
assert.equal(identityCorrection.patches[0].patch.trim_row_key, trim.trim_row_key);

const correctedIdentity = { ...staleIdentity, ...identityCorrection.patches[0].patch };
const legacySupplierAttempt: EntityRecord = {
  ...standardProduct,
  maker: '테슬라',
  model: 'Model Y',
  sub_model: 'Model Y',
};
delete legacySupplierAttempt._product_master_identity_authoritative;
const protectedIdentity = planProductUpsert([legacySupplierAttempt], [correctedIdentity]);
assert.equal(protectedIdentity.patches[0]?.patch.maker, undefined,
  '상품마스터 확정 뒤 공급사 원문은 정제 차종을 다시 덮지 못한다');

const autoplusProduct = fetched.products.find((item) => item.car_number === '34나5678')!;
assert.equal(autoplusProduct.product_type, undefined, '미분류는 ERP 상품유형을 지어내지 않는다');
assert.deepEqual(Object.keys(autoplusProduct.price as object).sort(), ['12_3만', '18_2만', '18_3만']);
assert.equal(autoplusProduct.mileage, 65000);

const sonogongProduct = fetched.products.find((item) => item.car_number === '56다7890')!;
assert.equal(sonogongProduct.product_type, '중고구독');
assert.equal(sonogongProduct._sheet_contract_status, true);
assert.equal(sonogongProduct._needs_master_review, true);
assert.equal(sonogongProduct.maker, '현대');
assert.equal(sonogongProduct.model, '쏘나타');
assert.equal(sonogongProduct.year, '2026');
assert.equal(sonogongProduct.mileage, 12000);
assert.deepEqual((sonogongProduct.price as Record<string, unknown>)['36_인수형'], { rent: 900000, deposit: 2700000 });

const manualTable = [
  ['판정', '공급사', '코드', '현재 누락·주의'],
  ['주의', '테스트 공급사', 'RP100', '원본 대조 완료'],
  ['주의', '오토플러스', 'RP023', '원본 대조 완료'],
  ['주의', '손오공', 'RP012', '원본 대조 완료'],
];
const manualReady = applyProductMasterManualGate(fetched, manualTable);
const dailyPlan = planDailySheetSync({ fetched: manualReady, existing: [], deleted: [], partners, now: 1_000 });
assert.equal(dailyPlan.ok, true, dailyPlan.blockReason);
assert.equal(dailyPlan.creates.length, 3);
assert.equal(dailyPlan.creates.find((item) => item.car_number === '56다7890')?.vehicle_status, '출고불가',
  '상품마스터 계약중은 계약 엔진 락을 만들지 않고 판매만 차단한다');
const dailyPlanSecond = planDailySheetSync({
  fetched: manualReady,
  existing: dailyPlan.creates,
  deleted: [],
  partners,
  now: 2_000,
});
assert.equal(dailyPlanSecond.ok, true, dailyPlanSecond.blockReason);
assert.equal(dailyPlanSecond.creates.length, 0);
assert.equal(dailyPlanSecond.patches.length, 0,
  '상품마스터 계약중의 최초 차단시각을 보존해 같은 원본 2회차 diff가 0이어야 한다');

const statusPlan = planSheetLiveStatusSync({
  fetched: manualReady,
  existing: fetched.products.map((product) => ({ ...product, vehicle_status: '출고협의' })),
  partners,
});
assert.equal(statusPlan.ok, true, statusPlan.blockReason);
assert.ok(statusPlan.patches.some((item) => item.key === 'RP100_12가3456'
  && item.patch.vehicle_status === '출고가능'));

assert.throws(() => importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], standard, standard], partners, trimRecords: [trim],
}), /중복/);
const crossProviderDuplicatePlate = row({
  ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, autoplus[index]])),
  차량번호: '12가3456',
});
const crossProviderDuplicate = applyProductMasterManualGate(importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], standard, crossProviderDuplicatePlate, sonogong],
  partners,
  trimRecords: [trim],
}), manualTable);
const crossProviderBatches = planProductMasterProviderBatches({
  fetched: crossProviderDuplicate,
  existing: [],
  deleted: [],
  partners,
});
assert.equal(crossProviderBatches.find((item) => item.code === 'RP100')?.plan.ok, false);
assert.equal(crossProviderBatches.find((item) => item.code === 'RP023')?.plan.ok, false);
assert.equal(crossProviderBatches.find((item) => item.code === 'RP012')?.plan.ok, true,
  '동일 실차번과 무관한 공급사는 계속 독립 반영할 수 있다');
assert.match(crossProviderBatches.find((item) => item.code === 'RP100')?.plan.blockReason || '', /동일 실차번 1건/,
'공급사가 달라도 같은 실차번은 공급사별 분할 전에 관련 공급사를 모두 차단한다');
const brokenHeader = [...PRODUCT_MASTER_COLUMNS];
[brokenHeader[0], brokenHeader[1]] = [brokenHeader[1], brokenHeader[0]];
assert.throws(() => importProductMasterSheet({
  table: [brokenHeader, standard], partners, trimRecords: [trim],
}), /열 순서/);
assert.throws(() => importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], row({
    ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, standard[index]])),
    '차종마스터 적용값': '레이 · 가솔린 1.0 · 프레스티지',
  })], partners, trimRecords: [trim],
}), /차종코드·적용값 불일치/);
assert.throws(() => importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], row({
    ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, standard[index]])),
    검증상태: '미매칭',
  })], partners, trimRecords: [trim],
}), /미매칭에 차종코드/);
const incomplete = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], row({
    ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, standard[index]])),
    '12개월 보증금': '',
  })], partners, trimRecords: [trim],
});
assert.equal(incomplete.lines[0].noPriceCount, 1);
assert.match(incomplete.lines[0].issueSamples[0], /보증금 미입력/);
assert.deepEqual(incomplete.products[0].price, {}, '보증금 공란을 무보증 0원으로 지어내지 않는다');

const reviewWithoutTrimCode = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], row({
    ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, sonogong[index]])),
    검증상태: '검수필요',
  })],
  partners,
  trimRecords: [trim],
});
assert.equal(reviewWithoutTrimCode.products.length, 1);
assert.equal(reviewWithoutTrimCode.products[0]?._needs_master_review, true);
assert.match(reviewWithoutTrimCode.lines[0]?.issueSamples[0] || '', /검수필요 차종코드 없음/,
  '검수필요·코드없음은 전체 연동을 막지 않고 차종을 지어내지 않은 채 검수 메타로 남긴다');
assert.throws(() => importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], row({
    ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, sonogong[index]])),
    검증상태: '확정',
  })],
  partners,
  trimRecords: [trim],
}), /확정 차량의 차종코드 누락/);

const scoped = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], standard, autoplus, sonogong],
  partners,
  trimRecords: [trim],
  providerCodes: ['RP100'],
});
const scopedReady = applyProductMasterManualGate(scoped, manualTable);
assert.equal(scoped.sourceScope, 'providers');

const invalidOtherProvider = row({
  ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, autoplus[index]])),
  차량번호: '잘못된차량번호',
});
const isolatedRetry = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], standard, invalidOtherProvider],
  partners,
  trimRecords: [trim],
  providerCodes: ['RP100'],
});
assert.equal(isolatedRetry.products.length, 1);
assert.equal(isolatedRetry.products[0]?.provider_company_code, 'RP100',
  '공급사 단건 재시도는 범위 밖 공급사의 깨진 행을 엄격 파싱 전에 격리한다');

const scopedPlan = planDailySheetSync({
  fetched: scopedReady,
  existing: [standardProduct, autoplusProduct],
  deleted: [],
  partners,
  now: 2_000,
});
assert.equal(scopedPlan.ok, true, scopedPlan.blockReason);
assert.ok(!scopedPlan.patches.some((item) => item.key === autoplusProduct._key
  && item.patch.vehicle_status === '출고불가'),
'공급사 선택연동은 선택하지 않은 공급사를 부재처리하지 않는다');

const legacyProvider = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], row({
    ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, standard[index]])),
    공급사명: '레거시 공급사',
    공급사코드: 'PT-0001',
  })],
  partners,
  trimRecords: [trim],
  knownProviderCodes: ['PT-0001'],
});
assert.equal(legacyProvider.lines[0].partnerRecordMissing, true,
  '기존 상품에만 남은 공급사코드는 조회 결과에 명시한다');
const legacyProviderPlan = planDailySheetSync({
  fetched: applyProductMasterManualGate(legacyProvider, [
    ['판정', '공급사', '코드', '현재 누락·주의'],
    ['주의', '렌트존', 'PT-0001', '원본 대조 완료'],
  ]),
  existing: [],
  deleted: [],
  partners,
  now: 3_000,
});
assert.equal(legacyProviderPlan.ok, false);
assert.match(legacyProviderPlan.blockReason, /ERP 공급사 정본 없음\(PT-0001\)/,
  '활성 공급사 정본이 없는 상품은 상품·상태 반영을 fail-closed 한다');

const manualBlocked = applyProductMasterManualGate(fetched, [
  ['판정', '공급사', '코드', '현재 누락·주의'],
  ['주의', '테스트 공급사', 'RP100', '원본 대조 완료'],
  ['검수필요', '오토플러스', 'RP023', '원본 재조회 전 자동 상태·가격 갱신 금지'],
  ['주의', '손오공', 'RP012', '원본 대조 완료'],
]);
const manualBlockedPlan = planDailySheetSync({
  fetched: manualBlocked,
  existing: [],
  deleted: [],
  partners,
  now: 4_000,
});
assert.equal(manualBlockedPlan.ok, true, manualBlockedPlan.blockReason);
assert.equal(manualBlockedPlan.creates.length, 3,
  '공급사 원본 자동반영 금지는 정제 완료된 상품마스터 → ERP를 다시 막지 않는다');

const isolatedManualBlock = isolateProductMasterBlockedProviders(manualBlocked);
assert.equal(isolatedManualBlock.blocked.length, 0);
assert.equal(isolatedManualBlock.fetched.products.some((item) => item.provider_company_code === 'RP023'), true);
const isolatedManualPlan = planDailySheetSync({
  fetched: isolatedManualBlock.fetched,
  existing: [],
  deleted: [],
  partners,
  now: 5_000,
});
assert.equal(isolatedManualPlan.ok, true, isolatedManualPlan.blockReason);
assert.equal(isolatedManualPlan.creates.length, 3,
  '정제 상품마스터의 모든 공급사를 같은 스냅샷으로 ERP에 연결한다');

const providerBatches = planProductMasterProviderBatches({
  fetched: manualReady,
  existing: [{
    ...standardProduct,
    price: {
      ...(standardProduct.price as Record<string, unknown>),
      12: { rent: 650_001, deposit: 1_500_000 },
      24: { rent: 600_000, deposit: 1_200_000 },
    },
  }],
  deleted: [],
  partners,
  now: 6_000,
});
assert.equal(providerBatches.length, 3);
assert.equal(providerBatches.find((item) => item.code === 'RP100')?.plan.ok, true,
  '상품마스터 표준기간을 갱신하되 표에 없는 기존 가격기간은 지우지 않고 보존한다');
assert.match(providerBatches.find((item) => item.code === 'RP100')?.plan.notes.join(' '), /기존 가격기간.*보존/);
assert.equal(providerBatches.find((item) => item.code === 'RP023')?.plan.ok, true,
  '한 공급사의 가격 충돌이 다른 공급사의 독립 계획을 막지 않는다');
assert.ok(providerBatches.every((item) => item.fetched.sourceScope === 'providers'
  && item.fetched.lines.length === 1),
'공급사별 계획은 범위 밖 공급사를 부재처리하지 않는다');

// ── 오더 C: 코드→채택이름 / 결정 3축 표시 / artifact fallback
const adoptedNameFetch = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], standard],
  partners,
  trimRecords: [trim],
  adopted: new Map([[trim.trim_row_key, {
    maker: '현대', model: '아반떼(채택)', sub_model: '더 뉴 아반떼 CN7(채택)', trim: '스마트(채택)', status: '규격구조채택',
  }]]),
});
const adoptedProduct = adoptedNameFetch.products[0]!;
assert.equal(adoptedProduct.model, '아반떼(채택)', '코드→규격채택 모델명');
assert.equal(adoptedProduct.sub_model, '더 뉴 아반떼 CN7(채택)');
assert.equal(adoptedProduct.trim_name, '스마트(채택)');
assert.equal(adoptedProduct._product_master_name_adopted, true);
assert.equal(adoptedProduct._product_master_identity_authoritative, true);

const artifactFallbackFetch = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], standard],
  partners,
  trimRecords: [trim],
  adopted: new Map(), // 채택 탭에 키 없음 → artifact 이름
});
assert.equal(artifactFallbackFetch.products[0]!.model, '아반떼', '채택 없으면 artifact 모델');
assert.equal(artifactFallbackFetch.products[0]!._product_master_name_adopted, false);

const unmatchedRow = row({
  ...Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, standard[index]])),
  차종코드: '',
  검증상태: '미매칭',
  관리상태: '검수필요',
  '차종마스터 적용값': '',
  검수사유: '미매칭',
});
const reviewDecisionFetch = importProductMasterSheet({
  table: [[...PRODUCT_MASTER_COLUMNS], unmatchedRow],
  partners,
  trimRecords: [trim],
  decisions: [{
    car_number: '12가3456',
    provider: 'RP100',
    supplier_text: '테스트',
    maker: '현대',
    model: '아반떼',
    sub_model: '아반떼 CN7',
    trim: '인스퍼레이션',
    trim_row_key: '',
    decision: 'TRIPLE',
    master_action: '',
    basis: 'sim',
  }],
});
const reviewProduct = reviewDecisionFetch.products[0]!;
assert.equal(reviewProduct._product_master_identity_authoritative, false, '결정 3축은 자동확정 아님');
assert.equal((reviewProduct._review_identity as EntityRecord).sub_model, '아반떼 CN7');
assert.equal((reviewProduct._review_identity as EntityRecord).trim_name, '인스퍼레이션');
const { vehicleName } = await import('../lib/domain/product');
assert.match(vehicleName(reviewProduct), /아반떼 CN7/, '상품찾기 표시가 _review_identity 3축을 씀');

console.log('PASS: 상품마스터 → ERP 파서 3공급사 · 상태/가격/차종코드 · 실패차단 · 채택이름/3축결정');
