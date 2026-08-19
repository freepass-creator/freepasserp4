import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detailSections } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const product = {
  product_code: 'veh_detail_priority',
  maker: '현대',
  model: '그랜저',
  trim_name: '프리미엄',
  options: '스마트 크루즈, 통풍시트',
  ext_color: '검정',
  int_color: '브라운',
  year: 2025,
  mileage: 12000,
  engine_cc: 2497,
  fuel_type: '가솔린',
  price: { '36': { rent: 780000, deposit: 3000000 } },
  _policy: {
    basic_driver_age: '만 21세 이상',
    annual_mileage: '연 2만km',
    injury_compensation_limit: '무한',
  },
} as EntityRecord;

const sections = detailSections(product, 'agent');
assert.deepEqual(
  sections.slice(0, 4).map(({ title }) => title),
  ['차량스펙', '대여료조건', '보험조건', '계약조건'],
  '상세 읽기 순서(사진 다음)가 바뀌었습니다.',
);
assert.equal(sections[0]?.hint, '제조사 기준');

const vehicle = sections[0];
assert.equal(vehicle.kind, 'kv');
if (vehicle.kind === 'kv') {
  const labels = vehicle.rows.map(([label]) => label);
  assert.ok(labels.includes('차량'));
  assert.ok(labels.includes('연식 · 주행'));
  assert.ok(labels.includes('동력'));
  assert.ok(labels.includes('색상'));
  assert.deepEqual(vehicle.chips, ['스마트 크루즈', '통풍시트']);
}

console.log('PASS product detail responsive information priority');

const detailSource = readFileSync(new URL('../components/ProductDetail.tsx', import.meta.url), 'utf8');
const priceSource = readFileSync(new URL('../components/ProductPriceTable.tsx', import.meta.url), 'utf8');
const detailPageSource = readFileSync(new URL('../app/m/[code]/page.tsx', import.meta.url), 'utf8');
const assistSource = readFileSync(new URL('../components/ProductAssistPanel.tsx', import.meta.url), 'utf8');
assert.match(detailSource, /aria-label="보험 보장한도와 면책금"/, '보험 비교표의 접근성 이름이 없습니다.');
assert.match(priceSource, /aria-label="기간별 대여료와 보증금"/, '기간별 요금표의 접근성 이름이 없습니다.');
assert.doesNotMatch(detailSource, /priceAside/, '가격이 다시 우측 패널 분기로 분리됐습니다.');
assert.doesNotMatch(assistSource, /ProductPriceTable/, '업무 보조패널에 가격이 다시 중복됐습니다.');
assert.match(detailPageSource, /role === 'provider'/, '공급사 문의 보조패널 진입 조건이 사라졌습니다.');

console.log('PASS product detail uses tables only for comparable price and insurance data');
