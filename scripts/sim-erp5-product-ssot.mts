/** ERP5 상품 원천 대조·공개 경계·ERP4 투영 회귀검사. Firebase/Google 쓰기 없음. */
import assert from 'node:assert/strict';
import {
  composeProductForErp5,
  exportProductForErp5,
  projectErp5ProductForErp4,
  type ProductSourceSpec,
} from '../lib/domain/erp5-product-ssot';
import { resolveAutoplusDepositPolicy, SONOGONG_DEPOSIT_POLICY } from '../lib/domain/deposit-policy';
import {
  applyErp4ProductLock,
  erp4LockPlateKey,
  type Erp4ProductLock,
} from '../lib/domain/erp4-product-lock';
import type { FreepassAtom } from '../lib/domain/supplier-adapter';
import { importProductMasterSheet } from '../lib/domain/product-master-import';
import { PRODUCT_MASTER_COLUMNS } from '../lib/domain/product-master-sheet';
import { erp5VehicleMasterEntryId } from '../lib/domain/erp5-vehicle-master-ssot';
import type { VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn(); passed += 1; console.log(`PASS ${name}`);
};

const spec: ProductSourceSpec = {
  code: 'IANKA', partnerCode: 'RP031', name: '이안카', spreadsheetId: 'source-sheet', tab: '이안카',
};
const atom = (patch: Partial<FreepassAtom> = {}): FreepassAtom => ({
  source: { supplierCode: 'IANKA', supplierName: '이안카', adapter: 'IankaAdapter', adapterVersion: '1.0.0', row: 12 },
  plateNumber: '12가3456',
  status: '출고가능',
  maker: '제네시스',
  model: 'G80',
  rawName: 'G80 RG3 기본형',
  shortDeposit: 1_000_000,
  longDeposit: 2_000_000,
  rent: { 12: 770_000, 24: 690_000 },
  provenance: {},
  ...patch,
});
const google = (patch: Record<string, unknown> = {}) => ({
  product_code: 'RP031_12가3456',
  car_number: '12가3456',
  provider_company_code: 'RP031',
  status_label_raw: '출고가능',
  vehicle_status: '출고가능',
  _product_master_verification: '확정',
  _product_master_identity_authoritative: true,
  _product_master_management: '운영',
  trim_row_key: 'mf-genesis-g80-rg3',
  origin: '국산',
  model: 'G80',
  sub_model: 'G80 RG3',
  trim_name: '기본형',
  _vehicle_master_identity: {
    origin: '국산', maker: '제네시스', model: 'G80', subModel: 'G80 RG3', trim: '기본형',
  },
  price: { 12: { rent: 1, deposit: 1 } },
  ...patch,
});
const compose = (input: { a?: FreepassAtom; g?: Record<string, unknown> | null } = {}) => composeProductForErp5({
  spec,
  atom: input.a || atom(),
  googleProduct: input.g === undefined ? google() : (input.g || undefined),
  googleSheetId: 'master-sheet',
  googleSheetTab: '상품마스터_구버전',
  googleSheetGid: '679088240',
});

test('공급사 상태와 Google 확정값이 맞으면 판매 원자가 된다', () => {
  const result = compose();
  assert.equal(result.id, 'RP031_12가3456');
  assert.equal(result.verificationState, 'verified');
  assert.equal(result.data.source_status_canonical, '출고가능');
  assert.equal(result.data.google_status_canonical, '출고가능');
  assert.equal(result.data.listable, true);
  assert.deepEqual(result.blockingReasons, []);
  assert.equal(result.data.price, undefined, 'Google 숫자 가격은 ERP5 정본에 복사하면 안 됨');
});

test('실제 상품마스터 importer가 공급사 표시명과 분리한 차종마스터 FK를 만든다', () => {
  const trim: VehicleTrimMasterRecord = {
    trim_row_key: 'mf-genesis-g80-rg3', master_id: 'genesis-g80-rg3', powertrain_seq: 1, trim_seq: 1,
    management_status: '확정', verification_status: '확정', usage_tier: 'automatic', market_status: '중고차',
    origin: '국산', maker: '제네시스', model: 'G80', sub_model: 'G80 RG3', powertrain: '가솔린 2.5', trim: '기본형',
    generation_name: 'RG3', development_code: 'RG3', production_start: '2020', production_end: '',
    model_year_start: '2020', model_year_end: '', fuel: '가솔린', engine_cc: 2497, displacement_l: 2.5,
    turbo: true, drivetrain: '2WD', seats: 5, battery_kwh: null, trim_aliases: [], evidence_url: '', evidence_note: '', data_as_of: '2026-09-14',
  };
  const row = Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((column) => [column, ''])) as Record<string, string>;
  Object.assign(row, {
    '차량번호': '12가3456', '공급사명': '이안카', '공급사 입력 차명': '공급사표시G80',
    '차종마스터 적용값': 'G80 RG3 · 가솔린 2.5 · 기본형', '검증상태': '확정', '관리상태': '운영',
    '차량상태': '출고가능', '차종코드': trim.trim_row_key, '공급사코드': 'RP031', '원천': '이안카',
    '공급사 원문보존': '제조사: 제네시스 | 모델명: 공급사표시G80 | 차명: G80 RG3 기본형',
    '12개월 대여료': '770000', '12개월 보증금': '1000000',
  });
  const imported = importProductMasterSheet({
    table: [PRODUCT_MASTER_COLUMNS as unknown as string[], PRODUCT_MASTER_COLUMNS.map((column) => row[column])],
    partners: [{ _key: 'RP031', partner_code: 'RP031', name: '이안카' }], trimRecords: [trim],
  }).products[0] as Record<string, unknown>;
  assert.equal(imported.model, '공급사표시G80', '화면 표시 model은 공급사 원문을 유지');
  const result = composeProductForErp5({
    spec, atom: atom(), googleProduct: imported,
    googleSheetId: 'master-sheet', googleSheetTab: '상품마스터_구버전',
  });
  assert.equal(result.data.vehicle_master_entry_id, erp5VehicleMasterEntryId({
    origin: '국산', maker: '제네시스', model: 'G80', subModel: 'G80 RG3', trim: '기본형',
  }));
  assert.ok(!result.blockingReasons.includes('VEHICLE_MASTER_IDENTITY_INCOMPLETE'));
});

test('상태 충돌은 원자를 보존하되 노출과 활성화를 막는다', () => {
  const result = compose({ g: google({ status_label_raw: '판매완료', vehicle_status: '출고불가' }) });
  assert.equal(result.verificationState, 'conflict');
  assert.equal(result.data.listable, false);
  assert.ok(result.blockingReasons.includes('STATUS_CONFLICT:출고가능:출고불가'));
});

test('공급사 상태 공란을 출고협의로 추정하지 않는다', () => {
  const result = compose({ a: atom({ status: '' }), g: google({ status_label_raw: '', vehicle_status: '' }) });
  assert.equal(result.data.source_status_canonical, '');
  assert.equal(result.data.listable, false);
  assert.ok(result.blockingReasons.includes('SOURCE_STATUS_MISSING'));
});

test('Google 상품마스터가 없으면 source-only draft로 닫는다', () => {
  const result = compose({ g: null });
  assert.equal(result.data.listable, false);
  assert.ok(result.blockingReasons.includes('GOOGLE_MASTER_MISSING'));
});

test('Google 검증상태가 확정이 아니면 노출하지 않는다', () => {
  const result = compose({ g: google({ _product_master_verification: '검수필요' }) });
  assert.equal(result.data.listable, false);
  assert.match(result.blockingReasons.join('|'), /GOOGLE_MASTER_NOT_CONFIRMED/);
});

test('고정 보증금은 ERP4 화면 투영 때 기간별 숫자로 만든다', () => {
  const result = compose();
  const projected = projectErp5ProductForErp4(result.data, result.id);
  assert.deepEqual(projected.price, {
    12: { rent: 770_000, deposit: 1_000_000 },
    24: { rent: 690_000, deposit: 2_000_000 },
  });
});

test('오토플러스 국산·수입 보증금 정책은 숫자가 아니라 규칙으로 저장하고 읽을 때 계산한다', () => {
  const autoSpec = { ...spec, code: 'AUTOPLUS', partnerCode: 'RP023', name: '오토플러스' };
  const make = (maker: string) => composeProductForErp5({
    spec: autoSpec,
    atom: atom({
      source: { supplierCode: 'AUTOPLUS', supplierName: '오토플러스', adapter: 'AutoplusAdapter', adapterVersion: '1.0.0', row: 2 },
      maker,
      depositPolicy: resolveAutoplusDepositPolicy(maker),
      shortDeposit: undefined,
      longDeposit: undefined,
      rent: {},
      rentVariants: [
        { termMonths: 12, annualKm: 30_000, amount: 770_000, sourceHeader: '12개월3만' },
        { termMonths: 24, annualKm: 20_000, amount: 690_000, sourceHeader: '24개월2만' },
      ],
    }),
    googleProduct: google({
      product_code: 'RP023_12가3456',
      provider_company_code: 'RP023',
      maker,
      origin: maker === 'BMW' ? '수입' : '국산',
    }),
    googleSheetId: 'master-sheet', googleSheetTab: '상품마스터_구버전',
  });
  const domestic = make('제네시스');
  assert.equal((domestic.data.adapter_pricing as any).depositPolicy.code, 'AUTOPLUS_DOMESTIC_X2');
  assert.deepEqual(projectErp5ProductForErp4(domestic.data).price, {
    '12_3만': { rent: 770_000, deposit: 1_540_000 },
    '24_2만': { rent: 690_000, deposit: 1_380_000 },
  });
  const imported = make('BMW');
  assert.equal((imported.data.adapter_pricing as any).depositPolicy.code, 'AUTOPLUS_IMPORT_12_X3_18P_X6');
  assert.deepEqual(projectErp5ProductForErp4(imported.data).price, {
    '12_3만': { rent: 770_000, deposit: 2_310_000 },
    '24_2만': { rent: 690_000, deposit: 4_140_000 },
  });
});

test('오토플러스 제조사 국산·수입 충돌은 보증금 오류를 막고 활성화를 차단한다', () => {
  const result = composeProductForErp5({
    spec: { ...spec, code: 'AUTOPLUS', partnerCode: 'RP023', name: '오토플러스' },
    atom: atom({
      source: { supplierCode: 'AUTOPLUS', supplierName: '오토플러스', adapter: 'AutoplusAdapter', adapterVersion: '1.0.0' },
      maker: '현대',
      depositPolicy: resolveAutoplusDepositPolicy('현대'),
      shortDeposit: undefined,
      longDeposit: undefined,
      rent: {},
      rentVariants: [{ termMonths: 24, annualKm: 20_000, amount: 1_000_000, sourceHeader: '24개월2만' }],
    }),
    googleProduct: google({ product_code: 'RP023_12가3456', provider_company_code: 'RP023', maker: 'BMW', origin: '수입' }),
    googleSheetId: 'master-sheet',
    googleSheetTab: '상품마스터_구버전',
  });
  assert.equal(result.verificationState, 'needs-review');
  assert.equal(result.data.listable, false);
  assert.ok(result.blockingReasons.includes('MAKER_CONFLICT:현대:BMW'));
  assert.ok(result.blockingReasons.includes('AUTOPLUS_DEPOSIT_CLASS_CONFLICT'));
});

test('손오공은 월대여료×연수, 최대 3개월 정책 원자를 보존한다', () => {
  const data = exportProductForErp5({ car_number: '12가3456', provider_company_code: 'RP012' }, atom({
    source: { supplierCode: 'SONOGONG', supplierName: '손오공', adapter: 'SonogongAdapter', adapterVersion: '1.0.0' },
    depositPolicy: SONOGONG_DEPOSIT_POLICY,
    rent: { 36: 600_000, 48: 550_000 },
    shortDeposit: undefined,
    longDeposit: undefined,
  })).data;
  assert.equal((data.adapter_pricing as any).depositPolicy.code, 'SONOGONG_RENT_X_YEARS_MAX3');
  assert.deepEqual(projectErp5ProductForErp4(data).price, {
    36: { rent: 600_000, deposit: 1_800_000 },
    48: { rent: 550_000, deposit: 1_650_000 },
  });
});

test('수수료·계약·고객·차대번호·Google 가격은 공개본에서 제외한다', () => {
  const { data, ignoredFields } = exportProductForErp5({
    car_number: '12가3456',
    price: { 12: { rent: 700_000, deposit: 1_000_000, fee: 100_000 } },
    contract_id: 'con_secret', customer_name: '홍길동', phone: '010-1234-5678', vin: 'KMH...',
  });
  assert.equal(data.price, undefined);
  assert.deepEqual(ignoredFields, ['contract_id', 'customer_name', 'phone', 'price', 'vin']);
});

test('허용 필드 안의 개인정보와 사진 URL 개인정보 매개변수를 차단한다', () => {
  assert.throws(() => exportProductForErp5({ car_number: '12가3456', options: '문의 010-1234-5678' }), /개인정보/);
  assert.throws(() => exportProductForErp5({ car_number: '12가3456', location: 'owner@example.com' }), /개인정보/);
  assert.throws(() => exportProductForErp5({ car_number: '12가3456', photo_link: 'https://images.test/car.jpg?phone=010-1234-5678' }), /개인정보/);
});

test('원천 provenance 안의 VIN 키도 재귀 공개 경계에서 제거한다', () => {
  const result = compose({ a: atom({ provenance: {
    vin: { sourceHeader: '차대번호', sourceValue: 'KMHSECRET' },
    status: { sourceHeader: '상태', sourceValue: '출고가능' },
  } }) });
  const provenance = (result.data.source_evidence as any).provenance;
  assert.equal(provenance.vin, undefined);
  assert.equal(provenance.status.sourceValue, '출고가능');
});

test('camelCase 개인정보 키도 재귀 공개 경계에서 제거한다', () => {
  const result = compose({ a: atom({ provenance: {
    customerName: { sourceHeader: '고객명', sourceValue: '홍길동' },
    phoneNumber: { sourceHeader: '연락처', sourceValue: '010-1234-5678' },
    vehicleIdentificationNumber: { sourceHeader: '차대번호', sourceValue: 'KMHSECRET' },
    status: { sourceHeader: '상태', sourceValue: '출고가능' },
  } }) });
  const provenance = (result.data.source_evidence as any).provenance;
  assert.equal(provenance.customerName, undefined);
  assert.equal(provenance.phoneNumber, undefined);
  assert.equal(provenance.vehicleIdentificationNumber, undefined);
  assert.equal(provenance.status.sourceValue, '출고가능');
});

test('한글 개인정보 키도 허용 중첩 객체에서 제거한다', () => {
  const result = compose({ a: atom({ provenance: {
    '고객명': { sourceHeader: '고객명', sourceValue: '홍길동' },
    '계약자명': { sourceHeader: '계약자명', sourceValue: '김철수' },
    '담당자': { sourceHeader: '담당자', sourceValue: '이영희' },
    status: { sourceHeader: '상태', sourceValue: '출고가능' },
  } }) });
  const provenance = (result.data.source_evidence as any).provenance;
  assert.equal(provenance['고객명'], undefined);
  assert.equal(provenance['계약자명'], undefined);
  assert.equal(provenance['담당자'], undefined);
  assert.equal(provenance.status.sourceValue, '출고가능');
});

test('ERP4 계약 락은 원천 증거를 바꾸지 않고 운영 상태만 덮는다', () => {
  const locks = new Map<string, Erp4ProductLock>([
    ['RP031_12가3456', { vehicle_status: '출고불가', locked_by_contract: 'CT-1' }],
  ]);
  const projected = applyErp4ProductLock({
    product_code: 'RP031_12가3456',
    vehicle_status: '출고가능',
    status: '출고가능',
    source_status_canonical: '출고가능',
    listable: true,
  }, 'unused', locks);
  assert.equal(projected.vehicle_status, '출고불가');
  assert.equal(projected.status, '출고불가');
  assert.equal(projected.listable, false);
  assert.equal(projected.locked_by_contract, 'CT-1');
  assert.equal(projected.source_status_canonical, '출고가능');
});

test('ERP3와 ERP5 상품키가 달라도 같은 차번의 계약 락을 전부 적용한다', () => {
  const lock: Erp4ProductLock = { vehicle_status: '계약중', locked_by_contract: 'CT-2' };
  const locks = new Map<string, Erp4ProductLock>([[erp4LockPlateKey('12 가 3456'), lock]]);
  const projected = applyErp4ProductLock({
    product_code: 'RP023_12가3456',
    provider_company_code: 'RP023',
    car_number: '12가3456',
    vehicle_status: '출고가능',
    status: '출고가능',
    listable: true,
  }, 'new-erp5-key', locks);
  assert.equal(projected.vehicle_status, '계약중');
  assert.equal(projected.status, '계약중');
  assert.equal(projected.locked_by_contract, 'CT-2');
  assert.equal(projected.listable, true, '계약중은 ERP4 기존 규칙대로 마크 노출');
});

console.log(`ERP5 PRODUCT SSOT ${passed}/${passed} PASS`);
