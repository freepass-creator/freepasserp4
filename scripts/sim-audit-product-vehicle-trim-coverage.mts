/**
 * 상품↔차종 커버리지 감사 판정 축 fixture sim.
 * 라이브 Sheet/Firebase 없이 결정 축·blocked 제외·manual 비자동·합계 불변식을 검증한다.
 *
 * 실행: npx tsx scripts/sim-audit-product-vehicle-trim-coverage.mts
 */
import assert from 'node:assert/strict';
import { recognizedDevelopmentCodes } from '../lib/domain/vehicle-master-format';
import {
  isTrustedProductCoverageSourceMode,
  productCoverageReportPath,
} from '../lib/domain/product-master-coverage-audit';
import { PRODUCT_MASTER_COLUMNS } from '../lib/domain/product-master-sheet';
import type { VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';
import {
  assertProductMasterHeader,
  auditProductVehicleTrimCoverage,
  buildSheetsReadonlyJwtClaims,
  classifyProductVehicleCoverage,
  extractSignalsFromRow,
  registrationYearMonth,
  SHEETS_READONLY_SCOPE,
  type ProductVehicleSignals,
} from './audit-product-vehicle-trim-coverage.mts';

const trim = (overrides: Partial<VehicleTrimMasterRecord> & Pick<VehicleTrimMasterRecord, 'trim_row_key'>): VehicleTrimMasterRecord => ({
  master_id: 'mf-test.md-001.sm-a',
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
  production_end: '2026-12',
  model_year_start: '2023',
  model_year_end: '2026',
  fuel: '가솔린',
  engine_cc: 1598,
  displacement_l: 1.6,
  turbo: false,
  drivetrain: '2WD',
  seats: 5,
  battery_kwh: null,
  trim_aliases: ['스마트'],
  evidence_url: 'https://www.hyundai.com/kr/ko/test',
  evidence_note: 'test',
  data_as_of: '2026-08-15',
  ...overrides,
});

const master: VehicleTrimMasterRecord[] = [
  trim({ trim_row_key: 'auto-smart', trim: '스마트', trim_aliases: ['스마트'], trim_seq: 1 }),
  trim({
    trim_row_key: 'auto-modern', trim: '모던', trim_aliases: ['모던'], trim_seq: 2,
    powertrain: '가솔린 1.6 2WD',
  }),
  trim({
    trim_row_key: 'manual-inspire', usage_tier: 'manual', management_status: '검증중',
    verification_status: '1차확인', trim: '인스퍼레이션', trim_aliases: ['인스퍼레이션'], trim_seq: 3,
  }),
  trim({
    trim_row_key: 'blocked-legacy', usage_tier: 'blocked', management_status: '제외',
    verification_status: '1차확인', trim: '프리미엄', trim_aliases: ['프리미엄'], trim_seq: 4,
    production_start: '2020-01', production_end: '2022-12',
  }),
  trim({
    trim_row_key: 'auto-diesel', fuel: '디젤', powertrain: '디젤 1.6 2WD', engine_cc: 1598,
    trim: '모던', trim_aliases: ['모던'], trim_seq: 5,
  }),
  trim({
    trim_row_key: 'auto-awd', drivetrain: '4WD', powertrain: '가솔린 1.6 4WD',
    trim: '모던', trim_aliases: ['모던'], trim_seq: 6,
  }),
  trim({
    trim_row_key: 'auto-7seat', seats: 7, model: '카니발', sub_model: '카니발 KA4',
    master_id: 'mf-test.md-002.sm-ka4', development_code: 'KA4',
    trim: '프레스티지', trim_aliases: ['프레스티지'], trim_seq: 1,
  }),
  trim({
    trim_row_key: 'auto-old-gen', sub_model: '아반떼 AD', development_code: 'AD',
    production_start: '2015-01', production_end: '2020-03',
    trim: '스마트', trim_aliases: ['스마트'], trim_seq: 7,
  }),
];

// 모델명·일반 토큰은 개발코드로 오인하지 않고, 실제 마스터 코드만 인식한다.
assert.deepEqual(recognizedDevelopmentCodes(['SM', 'MD', 'RG3', 'G80'], ['RG3', 'DH']), ['RG3']);
assert.deepEqual(recognizedDevelopmentCodes(['SM', 'MD', 'G80'], ['RG3', 'DH']), []);
assert.deepEqual(recognizedDevelopmentCodes(['dh', 'G80', 'DH'], ['RG3', 'DH']), ['DH']);
assert.deepEqual(recognizedDevelopmentCodes(['RG3', 'DH', 'OTHER'], ['RG3', 'DH']), ['RG3', 'DH']);
assert.deepEqual(recognizedDevelopmentCodes(['G80'], ['', 'RG3']), []);
assert.equal(isTrustedProductCoverageSourceMode('live_sheet'), true);
assert.equal(isTrustedProductCoverageSourceMode('workspace_connector_snapshot'), true);
assert.equal(isTrustedProductCoverageSourceMode('cached_live_report:network_error'), false);
assert.equal(productCoverageReportPath('tmp/coverage.json', 'live_sheet'), 'tmp/coverage.json');
assert.equal(
  productCoverageReportPath('tmp/coverage.json', 'cached_live_report:network_error'),
  'tmp/coverage.cached-diagnostic.json',
);

function row(values: Partial<Record<(typeof PRODUCT_MASTER_COLUMNS)[number], unknown>>): string[] {
  return PRODUCT_MASTER_COLUMNS.map((name) => String(values[name] ?? ''));
}

function signalsFromPartial(
  values: Partial<Record<(typeof PRODUCT_MASTER_COLUMNS)[number], unknown>>,
  rowNumber = 2,
): ProductVehicleSignals {
  const headerIndex = Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, index]));
  const extracted = extractSignalsFromRow(row(values), headerIndex, rowNumber);
  assert.ok(extracted);
  return extracted;
}

assert.equal(registrationYearMonth('2024-06-15'), '2024-06');
assert.equal(registrationYearMonth('2025. 11. 27'), '2025-11');
assert.equal(registrationYearMonth('2026년08월'), '2026-08');
assert.equal(registrationYearMonth('23-06'), '2023-06');
assert.equal(registrationYearMonth('2026'), '', 'bare model year must not become a January registration');
assert.equal(registrationYearMonth('24년'), '2024-01');
assert.equal(registrationYearMonth(''), '');

{
  const direct = signalsFromPartial({
    차량번호: '11가0098',
    '공급사 입력 차명': 'BMW 520i M Spt 가솔린 1,999 최초등록 2025-03',
    '공급사 원문보존': '원본탭: 재고 | 차명(세부모델+트림): 520i M Spt | 연료: 가솔린 | 배기량: 1,999 | 최초등록일: 2025-03 | 제조사(정제): BMW | 세부모델: E34 | 구동: AWD',
  });
  assert.notEqual(direct.trim, 'E34');
  assert.equal(direct.drivetrain, '');
  assert.doesNotMatch(direct.raw_preserved, /E34|AWD/);
  assert.match(direct.raw_preserved_full || '', /E34.*AWD/);
}

assert.throws(
  () => assertProductMasterHeader(['차량번호', '공급사명']),
  /필수 열 없음|열 순서/,
);
assert.throws(
  () => assertProductMasterHeader([...PRODUCT_MASTER_COLUMNS.slice(1), '차량번호']),
  /열 순서/,
);
assert.doesNotThrow(() => assertProductMasterHeader([...PRODUCT_MASTER_COLUMNS]));

// 1) 기존 automatic 코드 역검증 OK → AUTO_UNIQUE
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1001',
    공급사명: '테스트',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트',
    차종코드: 'auto-smart',
    검증상태: '확정',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 스마트',
  }), master);
  assert.equal(result.decision, 'AUTO_UNIQUE');
  assert.equal(result.secondary, '');
  assert.deepEqual(result.candidate_keys, ['auto-smart']);
}

// 2) 기존 manual 코드 역검증 OK → MANUAL_UNIQUE (자동 아님)
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1002',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 인스퍼레이션',
    차종코드: 'manual-inspire',
    검증상태: '검수필요',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 인스퍼레이션',
  }), master);
  assert.equal(result.decision, 'MANUAL_UNIQUE');
  assert.notEqual(result.decision, 'AUTO_UNIQUE');
}

// 3) blocked 키 참조 → EVIDENCE_BLOCKED + BLOCKED_KEY_REFERENCE
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1003',
    공급사코드: 'RP100',
    '공급사 입력 차명': '아반떼 프리미엄',
    차종코드: 'blocked-legacy',
    검증상태: '확정',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 최초등록: 2021-05-01 | 트림: 프리미엄',
  }), master);
  assert.equal(result.decision, 'EVIDENCE_BLOCKED');
  assert.equal(result.secondary, 'BLOCKED_KEY_REFERENCE');
}

// 4) 코드 의미 충돌 → CODE_CONFLICT
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1004',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7',
    차종코드: 'auto-smart',
    검증상태: '확정',
    '공급사 원문보존': '제조사: 현대 | 연료: 디젤 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 스마트',
  }), master);
  assert.equal(result.decision, 'EVIDENCE_BLOCKED');
  assert.equal(result.secondary, 'CODE_CONFLICT');
  assert.ok(result.contradiction_axes.includes('fuel'));
}

// 5) 미매칭 + 단일 automatic 후보 → AUTO_UNIQUE
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1005',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 스마트',
  }), master);
  assert.equal(result.decision, 'AUTO_UNIQUE');
  assert.deepEqual(result.candidate_keys, ['auto-smart']);
}

// 6) 미매칭 + 단일 manual 후보 → MANUAL_UNIQUE (자동 승격 금지)
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1006',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 인스퍼레이션',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 인스퍼레이션',
  }), master);
  assert.equal(result.decision, 'MANUAL_UNIQUE');
  assert.notEqual(result.decision, 'AUTO_UNIQUE');
  assert.deepEqual(result.candidate_keys, ['manual-inspire']);
}

// 7) blocked만 맞을 상황 — 후보 집합에서 제외되어 NO_CANDIDATE
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1007',
    공급사코드: 'RP100',
    '공급사 입력 차명': '아반떼 AD 프리미엄',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2018-05-01 | 트림: 프리미엄',
  }), master);
  assert.equal(result.decision, 'EVIDENCE_BLOCKED');
  assert.equal(result.secondary, 'NO_CANDIDATE');
  assert.ok(!result.candidate_keys.includes('blocked-legacy'));
}

// 8) 다중 비차단 후보 → MULTI_CANDIDATE
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1008',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01',
  }), master);
  assert.equal(result.decision, 'EVIDENCE_BLOCKED');
  assert.equal(result.secondary, 'MULTI_CANDIDATE');
  assert.ok(result.candidate_keys.length >= 2);
  assert.ok(!result.candidate_keys.includes('blocked-legacy'));
}

// 짧은 개발코드 UM은 Premium의 부분문자열로 인정하지 않는다.
{
  const umOnly = trim({
    trim_row_key: 'sorento-um-premium', maker: '기아', model: '쏘렌토', sub_model: '올 뉴 쏘렌토 UM',
    development_code: 'UM', trim: 'Premium', trim_aliases: ['Premium'], fuel: '가솔린', engine_cc: 1984,
    production_start: '2018-01', production_end: '2020-12',
  });
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가0099',
    '공급사 입력 차명': 'A6(4세대) 40 TFSI Premium Milano · 휘발유 · 최초등록 2019-02-21',
    '공급사 원문보존': '원본탭: 판매차량리스트 | 모델명: A6(4세대) 40 TFSI Premium Milano | 연료: 휘발유 | 최초등록: 2019-02-21',
  }), [umOnly]);
  assert.equal(result.secondary, 'NO_CANDIDATE');
  assert.deepEqual(result.candidate_keys, []);
}

// 8a) 별도 트림 열이 비어도 표시 차명에 마스터 트림 완전명이 있으면 그 트림으로 좁힌다.
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1008-1',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 모던',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 최초등록: 2024-05-01',
  }), master);
  assert.equal(result.decision, 'AUTO_UNIQUE');
  assert.deepEqual(result.candidate_keys, ['auto-modern']);
}

// 8b) 트림은 확정돼도 같은 트림의 인승 축이 비어 있으면 차량행키를 임의 선택하지 않는다.
{
  const seven = master.find((record) => record.trim_row_key === 'auto-7seat')!;
  const nine = trim({
    ...seven,
    trim_row_key: 'auto-9seat',
    seats: 9,
    trim_seq: 2,
  });
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1008-2',
    공급사코드: 'RP100',
    '공급사 입력 차명': '카니발 KA4 프레스티지',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 기아 | 연료: 가솔린 | 배기량: 1598 | 최초등록: 2024-05-01',
  }), [
    { ...seven, maker: '기아' },
    { ...nine, maker: '기아' },
  ]);
  assert.equal(result.secondary, 'MULTI_CANDIDATE');
  assert.deepEqual(result.candidate_keys.sort(), ['auto-7seat', 'auto-9seat']);
}

// 8c) Explicit range/body evidence is applied inside the real classifier.
{
  const baseSignals: ProductVehicleSignals = {
    car_number: 'fixture-range', provider_code: 'RP100', provider_name: 'fixture',
    supplier_vehicle_name: 'Ioniq 5 Long Range', verification: 'unmatched', review_reason: '',
    current_code: '', applied_value: '', maker: 'Hyundai', model_text: 'Ioniq 5 Long Range',
    trim: '', fuel: '', engine_cc: null, drivetrain: '', seats: null,
    first_registration: '2024-05-01', registration_ym: '2024-05', raw_preserved: '',
    row_numbers: [1], input_conflict: false, input_conflict_axes: [],
  };
  const longRange = trim({
    trim_row_key: 'ioniq-long', maker: 'Hyundai', model: 'Ioniq 5',
    sub_model: 'Ioniq 5 Long Range', powertrain: 'Electric 2WD', trim: 'Exclusive',
    fuel: 'Electric', engine_cc: null, production_start: '2023-01', production_end: '2026-12',
  });
  const standard = trim({
    ...longRange, trim_row_key: 'ioniq-standard', sub_model: 'Ioniq 5 Standard',
  });
  const ranged = classifyProductVehicleCoverage(baseSignals, [longRange, standard]);
  assert.equal(ranged.decision, 'AUTO_UNIQUE');
  assert.deepEqual(ranged.candidate_keys, ['ioniq-long']);

  const plain = trim({
    trim_row_key: 'gv80-base', maker: 'Genesis', model: 'GV80', sub_model: 'GV80',
    powertrain: 'Gasoline 2.5 AWD', trim: 'Premium', fuel: 'Gasoline', engine_cc: 2500,
    drivetrain: 'AWD', production_start: '2023-01', production_end: '2026-12',
  });
  const coupe = trim({ ...plain, trim_row_key: 'gv80-coupe', sub_model: 'GV80 Coupe' });
  const body = classifyProductVehicleCoverage({
    ...baseSignals,
    car_number: 'fixture-body', maker: 'Genesis', model_text: 'GV80 Gasoline 2.5 AWD Premium',
    supplier_vehicle_name: 'GV80 Gasoline 2.5 AWD Premium', fuel: 'Gasoline',
    engine_cc: 2500, drivetrain: 'AWD',
  }, [plain, coupe]);
  assert.equal(body.decision, 'AUTO_UNIQUE');
  assert.deepEqual(body.candidate_keys, ['gv80-base']);

  const bodyWithoutBaseGrade = classifyProductVehicleCoverage({
    ...baseSignals,
    car_number: 'fixture-body-ambiguous', maker: 'Genesis', model_text: 'GV80 Gasoline 2.5 AWD',
    supplier_vehicle_name: 'GV80 Gasoline 2.5 AWD', fuel: 'Gasoline',
    engine_cc: 2500, drivetrain: 'AWD',
  }, [plain, coupe]);
  assert.equal(bodyWithoutBaseGrade.secondary, 'MULTI_CANDIDATE');
  assert.deepEqual(bodyWithoutBaseGrade.candidate_keys.sort(), ['gv80-base', 'gv80-coupe']);

  const sportage = trim({
    trim_row_key: 'sportage-lpg', maker: 'Kia', model: 'Sportage', sub_model: 'Sportage NQ5',
    powertrain: 'LPG 2.0 2WD', trim: 'Gravity', fuel: 'LPG', engine_cc: 1999,
    production_start: '2022-01', production_end: '2026-12',
  });
  const numericAfterModel = classifyProductVehicleCoverage({
    ...baseSignals,
    car_number: 'fixture-model-boundary', maker: 'Kia', model_text: 'Sportage 2.0 LPG Gravity',
    supplier_vehicle_name: 'Sportage 2.0 LPG Gravity', fuel: 'LPG', engine_cc: 1999,
  }, [sportage]);
  assert.equal(numericAfterModel.decision, 'AUTO_UNIQUE');
  assert.deepEqual(numericAfterModel.candidate_keys, ['sportage-lpg']);

  const oldSeltos = trim({
    trim_row_key: 'seltos-sp2', maker: 'Kia', model: 'Seltos', sub_model: 'Seltos SP2',
    development_code: 'SP2', powertrain: 'Gasoline 1.6T 2WD', trim: 'Trendy',
    fuel: 'Gasoline', engine_cc: 1598, production_start: '2019-01', production_end: '2025-12',
  });
  const newSeltos = trim({
    ...oldSeltos, trim_row_key: 'seltos-sp3', sub_model: 'All New Seltos SP3',
    development_code: 'SP3', production_start: '2026-01', production_end: '2028-12',
  });
  const generation = classifyProductVehicleCoverage({
    ...baseSignals,
    car_number: 'fixture-generation', maker: 'Kia', model_text: 'Seltos SP3 1.6T Trendy',
    supplier_vehicle_name: 'Seltos SP3 1.6T Trendy', fuel: 'Gasoline', engine_cc: 1598,
    first_registration: '', registration_ym: '',
  }, [oldSeltos, newSeltos]);
  assert.equal(generation.decision, 'AUTO_UNIQUE');
  assert.deepEqual(generation.candidate_keys, ['seltos-sp3']);

  const genesis = trim({
    trim_row_key: 'genesis-g80', maker: 'Genesis', model: 'G80', sub_model: 'G80 RG3',
    development_code: 'RG3', powertrain: 'Gasoline 2.5T AWD', trim: 'Standard',
    fuel: 'Gasoline', engine_cc: 2497, drivetrain: 'AWD',
    production_start: '2020-01', production_end: '2025-12',
  });
  const makerLabelError = classifyProductVehicleCoverage({
    ...baseSignals,
    car_number: 'fixture-maker-label', maker: 'Hyundai', model_text: 'G80 RG3 Gasoline 2.5T AWD',
    supplier_vehicle_name: 'G80 RG3 Gasoline 2.5T AWD', fuel: 'Gasoline', engine_cc: 2497,
    drivetrain: 'AWD', current_code: genesis.trim_row_key, registration_ym: '2022-04',
  }, [genesis]);
  assert.equal(makerLabelError.decision, 'AUTO_UNIQUE');
  assert.deepEqual(makerLabelError.contradiction_axes, []);
}

// 9) 제조사 모순은 점수 감점이 아니라 탈락
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1009',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 기아 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 스마트',
  }), master);
  assert.equal(result.secondary, 'NO_CANDIDATE');
}

// 10) 연료·구동·인승 모순 탈락 / 공란은 모순 아님
{
  const fuelDrop = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1010',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 모던',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 디젤 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 모던',
  }), master);
  assert.equal(fuelDrop.decision, 'AUTO_UNIQUE');
  assert.deepEqual(fuelDrop.candidate_keys, ['auto-diesel']);

  const driveDrop = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1011',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 모던',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 4WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 모던',
  }), master);
  assert.deepEqual(driveDrop.candidate_keys, ['auto-awd']);

  const seatDrop = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1012',
    공급사코드: 'RP100',
    '공급사 입력 차명': '카니발 KA4 프레스티지 7인승',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 7 | 최초등록: 2024-05-01 | 트림: 프레스티지',
  }), master);
  assert.deepEqual(seatDrop.candidate_keys, ['auto-7seat']);

  const blankOk = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1013',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 트림: 스마트 | 최초등록: 2024-05-01',
  }), master);
  assert.equal(blankOk.decision, 'AUTO_UNIQUE');
  assert.deepEqual(blankOk.candidate_keys, ['auto-smart']);
}

// 11) 기간 경계 — 등록월이 생산기간 밖이면 탈락
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1014',
    공급사코드: 'RP100',
    '공급사 입력 차명': '아반떼 AD 스마트',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2018-05-01 | 트림: 스마트',
  }), master);
  assert.equal(result.decision, 'AUTO_UNIQUE');
  assert.deepEqual(result.candidate_keys, ['auto-old-gen']);
}

// 4a) 기존 코드 역검증은 공급사 문맥의 순서·5 Door 표기를 근거로 허용
{
  const tesla = trim({
    trim_row_key: 'auto-model-y-premium-rwd',
    maker: '테슬라',
    model: '모델 Y',
    sub_model: 'New Model Y Premium',
    development_code: 'Y',
    powertrain: '전기 RWD',
    trim: 'Premium RWD',
    trim_aliases: [],
    fuel: '전기',
    engine_cc: null,
    drivetrain: 'RWD',
    production_start: '2025-02',
    production_end: '현재',
  });
  const reordered = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1004-1',
    공급사코드: 'RP100',
    '공급사 입력 차명': '테슬라 모델 Y RWD Premium',
    차종코드: tesla.trim_row_key,
    검증상태: '확정',
    '공급사 원문보존': '제조사: 테슬라 | 연료: 전기 | 구동: RWD | 최초등록: 2026년08월 | 트림: RWD Premium',
  }), [tesla]);
  assert.equal(reordered.decision, 'AUTO_UNIQUE');
  assert.deepEqual(reordered.contradiction_axes, []);

  const mini = trim({
    trim_row_key: 'auto-mini-5door-classic',
    maker: '미니',
    model: '쿠퍼',
    sub_model: '쿠퍼 C F66/F65',
    development_code: 'F66/F65',
    powertrain: '가솔린 2.0',
    trim: '5도어 클래식',
    trim_aliases: [],
    engine_cc: 1998,
    production_start: '2024-03',
    production_end: '현재',
  });
  const contextual = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1004-2',
    공급사코드: 'RP100',
    '공급사 입력 차명': '미니 쿠퍼(4세대) 2.0 C 5 Door 클래식',
    차종코드: mini.trim_row_key,
    검증상태: '확정',
    '공급사 원문보존': '제조사: 미니 | 연료: 가솔린 | 배기량: 1998 | 최초등록: 2025. 11. 27 | 트림: 클래식',
  }), [mini]);
  assert.equal(contextual.decision, 'AUTO_UNIQUE');
  assert.deepEqual(contextual.contradiction_axes, []);
}

// 4b) 모델 뒤 세대·인승 숫자는 모델번호 충돌이 아니지만 실제 기간 충돌은 유지
{
  const bmw = trim({
    trim_row_key: 'auto-bmw-g30',
    maker: 'BMW',
    model: '5시리즈',
    sub_model: '5시리즈 G30',
    development_code: 'G30',
    trim: '520i 럭셔리',
    trim_aliases: [],
    production_start: '2017-02',
    production_end: '2023-09',
  });
  const generationLabel = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1004-3',
    공급사코드: 'RP100',
    '공급사 입력 차명': 'BMW 5시리즈(7세대) 520i Luxury',
    차종코드: bmw.trim_row_key,
    검증상태: '확정',
    '공급사 원문보존': '제조사: BMW | 최초등록: 23-06',
  }), [bmw]);
  assert.equal(generationLabel.decision, 'AUTO_UNIQUE');

  const xt6 = trim({
    trim_row_key: 'auto-xt6',
    maker: '캐딜락',
    model: 'XT6',
    sub_model: 'XT6',
    development_code: '',
    trim: 'SPORT',
    trim_aliases: [],
    seats: 6,
    production_start: '2020-03',
    production_end: '2024-12',
  });
  const lateRegistration = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1004-4',
    공급사코드: 'RP100',
    '공급사 입력 차명': '캐딜락 XT6 6인승 sport',
    차종코드: xt6.trim_row_key,
    검증상태: '확정',
    '공급사 원문보존': '제조사: 캐딜락 | 최초등록: 26-04',
  }), [xt6]);
  assert.equal(lateRegistration.decision, 'AUTO_UNIQUE');
  assert.notEqual(lateRegistration.secondary, 'CODE_CONFLICT');
  assert.deepEqual(lateRegistration.contradiction_axes, []);

  const beforeProduction = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1004-5',
    공급사코드: 'RP100',
    '공급사 입력 차명': '캐딜락 XT6 6인승 sport',
    차종코드: xt6.trim_row_key,
    검증상태: '확정',
    '공급사 원문보존': '제조사: 캐딜락 | 최초등록: 19-12',
  }), [xt6]);
  assert.equal(beforeProduction.secondary, 'CODE_CONFLICT');
  assert.deepEqual(beforeProduction.contradiction_axes, ['period']);

  const uncodedLateRegistration = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1004-6',
    공급사코드: 'RP100',
    '공급사 입력 차명': '캐딜락 XT6 6인승 sport',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 캐딜락 | 최초등록: 26-04',
  }), [xt6]);
  assert.equal(uncodedLateRegistration.secondary, 'NO_CANDIDATE');
}

// 12) 차량번호 외 식별 원자가 없으면 후보가 1개여도 자동확정하지 않음
{
  const noEvidence = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가116',
    공급사코드: 'RP100',
    검증상태: '미매칭',
  }), [master[0]!]);
  assert.equal(noEvidence.decision, 'MANUAL_UNIQUE');
  assert.equal(noEvidence.backlog, '원자 부족');
  assert.notEqual(noEvidence.decision, 'AUTO_UNIQUE');

  const modelOnly = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가117',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트',
    검증상태: '미매칭',
  }), [master[0]!]);
  assert.equal(modelOnly.decision, 'MANUAL_UNIQUE');

  const corroborated = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가118',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대',
  }), [master[0]!]);
  assert.equal(corroborated.decision, 'MANUAL_UNIQUE');

  const technicallyCorroborated = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가119',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린',
  }), [master[0]!]);
  assert.equal(technicallyCorroborated.decision, 'AUTO_UNIQUE');
}

// 13) 입력 신호 충돌 → EVIDENCE_BLOCKED (후보 탐색 전)
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1015',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 전기 EV',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 최초등록: 2024-05-01 | 트림: 스마트',
  }), master);
  assert.equal(result.decision, 'EVIDENCE_BLOCKED');
  assert.equal(result.backlog, '입력 자체 충돌');
}

// 14) 숫자 모델 접두 포함은 양성 모델 근거가 아님 (아이오닉 ↔ 아이오닉6)
{
  const generic = trim({
    trim_row_key: 'generic-ioniq',
    model: '아이오닉',
    sub_model: '아이오닉',
    development_code: '',
  });
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1016',
    공급사코드: 'RP100',
    '공급사 입력 차명': '아이오닉6 롱레인지',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대',
  }), [generic]);
  assert.equal(result.decision, 'EVIDENCE_BLOCKED');
  assert.equal(result.secondary, 'NO_CANDIDATE');
}

// 15) 플레이스홀더와 0은 식별 근거나 모순으로 쓰지 않음
{
  const result = classifyProductVehicleCoverage(signalsFromPartial({
    차량번호: '11가1017',
    공급사코드: 'RP100',
    '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트',
    검증상태: '미매칭',
    '공급사 원문보존': '제조사: 현대 | 연료: N/A | 배기량: 0 | 구동: 미정 | 인승: 0 | 트림: 스마트',
  }), [master[0]!]);
  assert.equal(result.decision, 'AUTO_UNIQUE');
}

// 16) 라이브 JWT는 위임 주체 + readonly 단일 scope만 허용
{
  const claims = buildSheetsReadonlyJwtClaims({
    issuer: 'service-account@example.invalid',
    subject: 'delegated-user@example.invalid',
    audience: 'https://oauth2.example.invalid/token',
    now: 1_700_000_000,
  });
  assert.equal(claims.scope, SHEETS_READONLY_SCOPE);
  assert.equal(claims.sub, 'delegated-user@example.invalid');
  assert.equal(claims.exp, 1_700_003_600);
  assert.throws(() => buildSheetsReadonlyJwtClaims({
    issuer: 'service-account@example.invalid',
    subject: '',
    audience: 'https://oauth2.example.invalid/token',
    now: 1_700_000_000,
  }), /GOOGLE_WORKSPACE_SUBJECT/);
}

// 17) 전체 표 감사 — 고유 차량번호마다 1판정 + 합계 불변식
{
  const table = [
    [...PRODUCT_MASTER_COLUMNS],
    row({
      차량번호: '21나2001', 공급사명: 'A', 공급사코드: 'RP1',
      '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트', 검증상태: '확정', 차종코드: 'auto-smart',
      '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 스마트',
    }),
    row({
      차량번호: '21나2002', 공급사명: 'A', 공급사코드: 'RP1',
      '공급사 입력 차명': '더 뉴 아반떼 CN7 인스퍼레이션', 검증상태: '미매칭',
      '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 인스퍼레이션',
    }),
    row({
      차량번호: '21나2003', 공급사명: 'A', 공급사코드: 'RP1',
      '공급사 입력 차명': '더 뉴 아반떼 CN7', 검증상태: '미매칭',
      '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01',
    }),
    row({
      차량번호: '21나2004', 공급사명: 'A', 공급사코드: 'RP1',
      '공급사 입력 차명': '아반떼 프리미엄', 검증상태: '확정', 차종코드: 'blocked-legacy',
      '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 최초등록: 2021-05-01 | 트림: 프리미엄',
    }),
    row({
      차량번호: '21나2005', 공급사명: 'A', 공급사코드: 'RP1',
      '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트', 검증상태: '확정', 차종코드: 'auto-smart',
      '공급사 원문보존': '제조사: 현대 | 연료: 디젤 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 스마트',
    }),
    row({
      차량번호: '21나2006', 공급사명: 'A', 공급사코드: 'RP1',
      '공급사 입력 차명': '없는차종 XYZ', 검증상태: '미매칭',
      '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 최초등록: 2024-05-01 | 트림: 유니콘',
    }),
    // 중복 차량번호 — 마지막 유효 신호로 병합되어 고유 1건
    row({
      차량번호: '21나2001', 공급사명: 'A', 공급사코드: 'RP1',
      '공급사 입력 차명': '더 뉴 아반떼 CN7 스마트', 검증상태: '확정', 차종코드: 'auto-smart',
      '공급사 원문보존': '제조사: 현대 | 연료: 가솔린 | 배기량: 1598 | 구동: 2WD | 인승: 5 | 최초등록: 2024-05-01 | 트림: 스마트',
    }),
  ];

  const report = auditProductVehicleTrimCoverage({
    table,
    trimRecords: master,
    source: { mode: 'fixture', header_columns: 50, source_rows: 0, unique_plates: 0 },
  });

  assert.equal(report.totals.unique_plates, 6);
  assert.equal(
    report.totals.AUTO_UNIQUE + report.totals.MANUAL_UNIQUE + report.totals.EVIDENCE_BLOCKED,
    report.totals.unique_plates,
  );
  assert.equal(
    report.totals.NO_CANDIDATE
      + report.totals.MULTI_CANDIDATE
      + report.totals.BLOCKED_KEY_REFERENCE
      + report.totals.CODE_CONFLICT,
    report.totals.EVIDENCE_BLOCKED,
  );
  assert.equal(report.invariants.primary_sum_matches_unique, true);
  assert.equal(report.invariants.secondary_subset_of_evidence, true);

  const byPlate = Object.fromEntries(report.vehicles.map((vehicle) => [vehicle.car_number, vehicle]));
  assert.equal(byPlate['21나2001']?.decision, 'AUTO_UNIQUE');
  assert.equal(byPlate['21나2002']?.decision, 'MANUAL_UNIQUE');
  assert.equal(byPlate['21나2003']?.secondary, 'MULTI_CANDIDATE');
  assert.equal(byPlate['21나2004']?.secondary, 'BLOCKED_KEY_REFERENCE');
  assert.equal(byPlate['21나2005']?.secondary, 'CODE_CONFLICT');
  assert.equal(byPlate['21나2006']?.secondary, 'NO_CANDIDATE');

  assert.equal(report.totals.AUTO_UNIQUE, 1);
  assert.equal(report.totals.MANUAL_UNIQUE, 1);
  assert.equal(report.totals.EVIDENCE_BLOCKED, 4);
  assert.equal(report.totals.MULTI_CANDIDATE, 1);
  assert.equal(report.totals.BLOCKED_KEY_REFERENCE, 1);
  assert.equal(report.totals.CODE_CONFLICT, 1);
  assert.equal(report.totals.NO_CANDIDATE, 1);
}

console.log('PASS sim-audit-product-vehicle-trim-coverage');
