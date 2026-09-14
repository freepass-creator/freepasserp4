/** ERP5 상품 공개 경계 회귀검사. Firebase 접속/쓰기 없음. */
import assert from 'node:assert/strict';
import { providedSheetAdapter } from '../lib/adapters/provided';
import { getSupplierSourceSpec, isIankaOriginalSheet } from '../lib/adapters/source-registry';
import { composeProductFromAtom, exportProductForErp5 } from '../lib/domain/erp5-product-ssot';
import { resolveAutoplusDepositPolicy, SONOGONG_DEPOSIT_POLICY } from '../lib/domain/deposit-policy';
import { depositKind, noDeposit, shopDepositCellText, shopDepositPhrase } from '../lib/domain/product';
import { policyForGuestProduct, sanitizeProductForGuest } from '../lib/domain/public-catalog';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
};

test('상품 필드 값과 보증금 규격을 바꾸지 않는다', () => {
  const source = {
    car_number: '12가3456',
    maker: '제네시스',
    sub_model: 'G80 RG3',
    trim_name: '기본형',
    provider_company_code: 'RP023',
    origin: '국산',
    price: { '48개월': { deposit: '보증금 30%', rent: 770000 } },
  };
  const { data } = exportProductForErp5(source);
  for (const [key, value] of Object.entries(source)) assert.deepEqual(data[key], value);
  assert.deepEqual(data.offer_terms, {
    priceAxes: ['termMonths', 'annualKm'],
    depositPolicy: resolveAutoplusDepositPolicy('제네시스'),
  });
});

test('손오공 구독 규칙은 atom.depositPolicy가 있을 때만 내보낸다', () => {
  const withoutAtom = exportProductForErp5({ car_number: '12가3456', provider_company_code: 'RP012' });
  assert.equal(withoutAtom.data.offer_terms, undefined, '렌트 재고에 구독 보증금 규칙을 추정하면 안 된다');

  const { data } = exportProductForErp5({ car_number: '12가3456', provider_company_code: 'RP012' }, {
    source: { supplierCode: 'SONOGONG', supplierName: '손오공', adapter: 'SonogongAdapter', adapterVersion: '1.0.0' },
    plateNumber: '12가3456',
    rent: { 12: 1_028_000 },
    depositPolicy: SONOGONG_DEPOSIT_POLICY,
    provenance: {},
  });
  assert.deepEqual(data.offer_terms, {
    priceAxes: ['termMonths'],
    depositPolicy: SONOGONG_DEPOSIT_POLICY,
  });
});

test('전용 어댑터의 가격축을 ERP5 공개 원자에 붙인다', () => {
  const { data } = exportProductForErp5({ car_number: '12가3456', provider_company_code: 'RP023' }, {
    source: { supplierCode: 'AUTOPLUS', supplierName: '오토플러스', adapter: 'AutoplusAdapter', adapterVersion: '1.0.0' },
    plateNumber: '12가3456',
    rent: {},
    depositPolicy: resolveAutoplusDepositPolicy('현대'),
    rentVariants: [{ termMonths: 12, annualKm: 20_000, amount: 770_000, sourceHeader: '12개월2만' }],
    provenance: {},
  });
  assert.deepEqual(data.adapter_pricing, {
    sourceCode: 'AUTOPLUS', sourceName: '오토플러스', adapter: 'AutoplusAdapter', adapterVersion: '1.0.0',
    shortDeposit: null, longDeposit: null, depositPolicy: resolveAutoplusDepositPolicy('현대'), rent: {},
    rentVariants: [{ termMonths: 12, annualKm: 20_000, amount: 770_000, sourceHeader: '12개월2만' }],
  });
});

test('어댑터의 빈 기간값은 버리고 실제 숫자와 보증금 규격만 보존한다', () => {
  const { data } = exportProductForErp5({ car_number: '12가3456', provider_company_code: 'RP023' }, {
    source: { supplierCode: 'AUTOPLUS', supplierName: '오토플러스', adapter: 'AutoplusAdapter', adapterVersion: '1.0.0' },
    plateNumber: '12가3456',
    rent: { 1: undefined, 12: 770_000 },
    depositPolicy: resolveAutoplusDepositPolicy('현대'),
    rentVariants: [{ termMonths: 12, annualKm: undefined, amount: 770_000, sourceHeader: '12개월' }],
    provenance: {},
  });
  assert.deepEqual(data.adapter_pricing, {
    sourceCode: 'AUTOPLUS', sourceName: '오토플러스', adapter: 'AutoplusAdapter', adapterVersion: '1.0.0',
    shortDeposit: null, longDeposit: null, depositPolicy: resolveAutoplusDepositPolicy('현대'),
    rent: { 12: 770_000 },
    rentVariants: [{ termMonths: 12, amount: 770_000, sourceHeader: '12개월' }],
  });
});

test('제조사가 없는 오토플러스 상품은 국산 보증금 규칙을 추정하지 않는다', () => {
  const { data } = exportProductForErp5({ car_number: '12가3456', provider_company_code: 'RP023' });
  assert.deepEqual(data.offer_terms, { priceAxes: ['termMonths', 'annualKm'] });
});

test('수수료·계약·고객·차대번호는 공개본에서 제외한다', () => {
  const { data, ignoredFields } = exportProductForErp5({
    car_number: '12가3456',
    price: { '48개월': { deposit: 1000000, rent: 700000, fee: 100000, commission: 200000, fee_memo: '비공개' } },
    contract_id: 'con_secret',
    customer_name: '홍길동',
    phone: '010-1234-5678',
    vin: 'KMH...',
    원문: { 메모: '공급사 원문 전체' },
  });
  assert.deepEqual(data.price, { '48개월': { deposit: 1000000, rent: 700000 } });
  assert.deepEqual(ignoredFields, ['contract_id', 'customer_name', 'phone', 'vin', '원문']);
});

test('허용 필드 안의 이메일·전화번호·주민번호는 게시를 막는다', () => {
  assert.throws(() => exportProductForErp5({ car_number: '12가3456', options: '문의 010-1234-5678' }), /개인정보/);
  assert.throws(() => exportProductForErp5({ car_number: '12가3456', location: 'owner@example.com' }), /개인정보/);
  assert.throws(() => exportProductForErp5({ car_number: '12가3456', options: { 메모: '900101-1234567' } }), /개인정보/);
});

test('ERP4 내부 사진 캐시는 제외하고 원본 사진 링크만 보존한다', () => {
  const photoLink = 'https://drive.google.com/drive/folders/public-catalog-source';
  const { data, ignoredFields } = exportProductForErp5({
    car_number: '12가3456',
    photo_link: photoLink,
    photo_cache: {
      src: photoLink,
      urls: ['https://cache.example.test/private/010-1234-5678.jpg'],
      cachedAt: '2026-09-13T00:00:00.000Z',
    },
  });
  assert.equal(data.photo_link, photoLink);
  assert.equal(data.photo_cache, undefined);
  assert.ok(ignoredFields.includes('photo_cache'));
});

test('사진 URL의 차량 식별 숫자는 보존하고 개인정보 매개변수는 차단한다', () => {
  const photoLink = 'https://autoplus.co.kr/vehicle/02-123-4567?carSeq=010-1234-5678&snapshot=900101-1234567';
  const { data } = exportProductForErp5({ car_number: '12가3456', photo_link: photoLink });
  assert.equal(data.photo_link, photoLink);
  assert.throws(() => exportProductForErp5({
    car_number: '12가3456',
    photo_link: 'https://images.example.test/car.jpg?phone=010-1234-5678',
  }), /개인정보/);
  assert.throws(() => exportProductForErp5({
    car_number: '12가3456',
    photo_link: 'https://images.example.test/car.jpg?customerName=홍길동',
  }), /개인정보/);
  assert.throws(() => exportProductForErp5({
    car_number: '12가3456',
    photo_link: '담당자 010-1234-5678',
  }), /개인정보/);
});

test('차번 없는 레코드는 게시를 막는다', () => {
  assert.throws(() => exportProductForErp5({ maker: '현대' }), /car_number/);
});

test('제공시트 원자는 ERP4 products를 복사하지 않고 조합한다', () => {
  const spec = getSupplierSourceSpec('RP013');
  const adapted = providedSheetAdapter.adapt({
    차량번호: '12가3456',
    상태: '출고가능',
    분류: '중고렌트',
    '제조사(정제)': '현대',
    모델: '아반떼',
    세부모델: '더 뉴 아반떼 CN7',
    세부트림: '인스퍼레이션',
    '차명(세부모델+트림)': '더 뉴 아반떼 CN7 1.6 가솔린 인스퍼레이션',
    '12개월': '800,000',
    장기보증: '2,000,000',
  }, { supplierCode: spec.code, supplierName: spec.name, spreadsheetId: spec.spreadsheetId, tab: spec.tab, row: 4 });
  const composed = composeProductFromAtom(spec, adapted.atom, adapted.issues);
  assert.equal(composed.id, 'WELLIX__12가3456');
  assert.equal(composed.data.car_number, '12가3456');
  assert.equal(composed.data.provider_company_code, 'RP013');
  assert.equal(composed.data.maker, '현대');
  assert.equal(composed.data.model, '아반떼');
  assert.equal(composed.data.sub_model, '더 뉴 아반떼 CN7');
  assert.equal(composed.data.supplier_vehicle_name, '더 뉴 아반떼 CN7 1.6 가솔린 인스퍼레이션');
  assert.equal((composed.data.adapter_pricing as { adapter: string }).adapter, 'ProvidedSheetAdapter');
  assert.equal((composed.data.source_evidence as { tab: string; spreadsheetId: string }).tab, '재고');
  assert.equal((composed.data.source_evidence as { spreadsheetId: string }).spreadsheetId, spec.spreadsheetId);
  assert.equal(composed.listable, true);
  assert.equal(composed.data.vin, undefined);
  assert.deepEqual(composed.data.price, { '12': { rent: 800_000 } }, '12개월은 단기보증이 비면 보증금 키를 안 붙인다');
});

test('이안카 조합 원천은 정제시트이지 외부 원본이 아니다', () => {
  const spec = getSupplierSourceSpec('RP031');
  assert.equal(spec.spreadsheetId, '1r1EP4oMP9V2iV-G5Q3nNNBHW7ttLMNycipFkfccHvOA');
  assert.equal(spec.tab, '재고');
  assert.equal(isIankaOriginalSheet(spec.spreadsheetId), false);
  const adapted = providedSheetAdapter.adapt({
    차량번호: '133호5709',
    상태: '출고가능',
    모델: '카니발',
    '12개월': '1,110,000',
  });
  const composed = composeProductFromAtom(spec, adapted.atom);
  assert.equal((composed.data.source_evidence as { spreadsheetId: string }).spreadsheetId, spec.spreadsheetId);
  assert.equal((composed.data.source_evidence as { supplierCode: string }).supplierCode, 'IANKA');
});

test('어댑터는 시트 원자를 변환하지 않고 배치한다', () => {
  const spec = getSupplierSourceSpec('RP004');
  const emptyDep = providedSheetAdapter.adapt({
    차량번호: '104호9572',
    상태: '출고협의',
    분류: '중고렌트',
    '제조사(정제)': '제네시스',
    모델: 'G80',
    세부모델: 'G80 RG3',
    세부트림: '런칭',
    '48개월': '1,350,000',
    정책코드: 'POL-0047',
  }, { supplierCode: spec.code, supplierName: spec.name, spreadsheetId: spec.spreadsheetId, tab: spec.tab });
  assert.equal(emptyDep.atom.longDeposit, undefined);
  assert.equal(emptyDep.atom.trim, '런칭');
  assert.equal(emptyDep.atom.policyCode, 'POL-0047');
  const composed = composeProductFromAtom(spec, emptyDep.atom);
  assert.equal(composed.data.trim_name, '런칭', '시트 세부트림을 기본형으로 바꾸지 않는다');
  assert.equal(composed.data.policy_code, 'POL-0047');
  assert.deepEqual(composed.data.price, { '48': { rent: 1_350_000 } });
  assert.equal(Object.prototype.hasOwnProperty.call((composed.data.price as object as Record<string, object>)['48'], 'deposit'), false);

  const zeroDep = providedSheetAdapter.adapt({
    차량번호: '104호9572',
    상태: '출고가능',
    분류: '중고렌트',
    '제조사(정제)': '제네시스',
    모델: 'G80',
    세부모델: 'G80 RG3',
    세부트림: '기본형',
    '48개월': '1,350,000',
    장기보증: '무보증',
  });
  assert.equal(zeroDep.atom.trim, '기본형');
  assert.equal(zeroDep.atom.longDeposit, 0);
  const placed = composeProductFromAtom(spec, zeroDep.atom);
  assert.equal(placed.data.trim_name, '기본형');
  assert.deepEqual(placed.data.price, { '48': { rent: 1_350_000, deposit: 0 } });
});

test('시트에 없는 정책코드는 규칙으로 채우지 않는다', () => {
  const spec = getSupplierSourceSpec('SONOGONG_RENT');
  const adapted = providedSheetAdapter.adapt({
    차량번호: '12가9999',
    상태: '출고가능',
    분류: '중고렌트',
    모델: '아반떼',
    '36개월': '700,000',
  });
  const composed = composeProductFromAtom(spec, adapted.atom);
  assert.equal(composed.data.policy_code, undefined);
});

test('손님 카탈로그는 빈 보증금을 0으로 접지 않고 화이트라벨과 같은 원자를 쓴다', () => {
  const zero = sanitizeProductForGuest('veh_zero', {
    product_code: 'veh_zero',
    car_number: '12가3456',
    price: { 36: { rent: 650_000, deposit: 0 } },
  });
  assert.equal((zero.price as Record<string, { deposit?: number }>)['36'].deposit, 0);
  const missing = sanitizeProductForGuest('veh_missing', {
    product_code: 'veh_missing',
    car_number: '104호9572',
    price: { 48: { rent: 1_350_000 } },
  });
  assert.equal((missing.price as Record<string, { rent: number }>)['48'].rent, 1_350_000);
  assert.equal(Object.prototype.hasOwnProperty.call((missing.price as object as Record<string, object>)['48'], 'deposit'), false);
  assert.equal(depositKind(undefined), 'missing');
  assert.equal(depositKind(0), 'zero');
  assert.equal(shopDepositPhrase(undefined, String), '미입력');
  assert.equal(shopDepositPhrase(0, String), '보증금 없음');
  assert.equal(shopDepositCellText(0, String), '없음');
  assert.equal(noDeposit({ price: { 48: { rent: 1_350_000 } } } as never), false);
  assert.equal(noDeposit({ price: { 48: { rent: 1_350_000, deposit: 0 } } } as never), true);
  assert.equal(policyForGuestProduct(
    { policy_code: '', provider_company_code: 'RP012', product_type: '중고렌트' },
    { 'POL-0046': { policy_code: 'POL-0046', policy_name: '손오공 렌트' } },
  ), null, '화면에서 빈 정책코드를 규칙으로 채우지 않는다');
  assert.equal(policyForGuestProduct(
    { policy_code: 'POL-0047', provider_company_code: 'RP004', product_type: '중고렌트' },
    { 'fp-pol-0047': { policy_code: 'POL-0047', policy_name: '프리패스 공통 렌트', insurance_included: '포함' } },
  )?.policy_name, '프리패스 공통 렌트', '키와 코드가 달라도 적힌 정책코드를 찾는다');
});

console.log(`ERP5 PRODUCT SSOT ${passed}/${passed} PASS`);
