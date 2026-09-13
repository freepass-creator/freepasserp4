/** ERP5 상품 공개 경계 회귀검사. Firebase 접속/쓰기 없음. */
import assert from 'node:assert/strict';
import { exportProductForErp5 } from '../lib/domain/erp5-product-ssot';
import { resolveAutoplusDepositPolicy, SONOGONG_DEPOSIT_POLICY } from '../lib/domain/deposit-policy';

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

test('손오공은 기간축과 3개월 상한 정책 원자를 내보낸다', () => {
  const { data } = exportProductForErp5({ car_number: '12가3456', provider_company_code: 'RP012' });
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

console.log(`ERP5 PRODUCT SSOT ${passed}/${passed} PASS`);
