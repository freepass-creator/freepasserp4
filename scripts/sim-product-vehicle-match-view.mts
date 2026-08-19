import assert from 'node:assert/strict';
import {
  classifyProductVehicleMatchView,
  PRODUCT_VEHICLE_MATCH_STATUS_STYLES,
  summarizeProductVehicleMatchView,
} from '../lib/domain/product-vehicle-match-view';

let passed = 0;
const test = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

test('엄격 확정코드 정상만 운영 확정', () => {
  const result = classifyProductVehicleMatchView(
    { category: '확정 코드 정상', current_code: 'permanent-key', current_axis_conflict: false },
    { hierarchy_category: '계층 단일매칭' },
  );
  assert.equal(result.operatorStatus, '확정');
  assert.equal(result.codeStatus, '차종코드 확정');
  assert.equal(result.hierarchyStatus, '계층 후보 있음');
});

for (const category of ['다중 자동후보', '안전 후보 없음', '수동후보 있음', '원천 입력 충돌', '확정 코드 명시축 불일치']) {
  test(`계층이 연결돼도 ${category}는 확인 필요`, () => {
    const result = classifyProductVehicleMatchView(
      { category, current_code: 'candidate-key', current_axis_conflict: category === '확정 코드 명시축 불일치' },
      { hierarchy_category: '계층 단일매칭' },
    );
    assert.equal(result.operatorStatus, '확인 필요');
    assert.equal(result.codeStatus, '검토 필요');
    assert.match(result.reviewReason, new RegExp(category));
  });
}

test('기본트림·연식 추론은 엄격 감사 통과 전 확정하지 않음', () => {
  for (const hierarchyCategory of ['계층 기본트림 보완', '연식 세부모델 추정매칭', '기존 확정코드 교차연결']) {
    const result = classifyProductVehicleMatchView(
      { category: '다중 자동후보' },
      { hierarchy_category: hierarchyCategory },
    );
    assert.equal(result.operatorStatus, '확인 필요');
    assert.equal(result.hierarchyStatus, '계층 후보 있음');
  }
});

test('명시축 불일치는 확정 카테고리 문자열보다 우선 차단', () => {
  const result = classifyProductVehicleMatchView(
    { category: '확정 코드 정상', current_code: 'permanent-key', current_axis_conflict: true },
    { hierarchy_category: '계층 단일매칭' },
  );
  assert.equal(result.operatorStatus, '확인 필요');
  assert.match(result.reviewReason, /명시 식별축 불일치/);
});

test('엄격 확정키는 독립 계층 감사가 미해결이어도 현재키 계층으로 표시', () => {
  const result = classifyProductVehicleMatchView(
    { category: '확정 코드 정상', current_code: 'permanent-key', current_axis_conflict: false },
    { hierarchy_category: '계층 무매칭' },
  );
  assert.equal(result.operatorStatus, '확정');
  assert.equal(result.hierarchyStatus, '계층 후보 있음');
});

test('요약은 엄격 코드와 계층 지표를 별도로 보존', () => {
  const rows = [
    classifyProductVehicleMatchView({ category: '확정 코드 정상', current_code: 'a' }, { hierarchy_category: '계층 단일매칭' }),
    classifyProductVehicleMatchView({ category: '다중 자동후보' }, { hierarchy_category: '계층 단일매칭' }),
    classifyProductVehicleMatchView({ category: '안전 후보 없음' }, { hierarchy_category: '계층 무매칭' }),
  ];
  assert.deepEqual(summarizeProductVehicleMatchView(rows), {
    total: 3,
    strictConfirmed: 1,
    strictReview: 2,
    hierarchyLinked: 2,
    hierarchyReview: 1,
    strictConfirmedWithoutHierarchy: 0,
  });
});

test('상품 운영상태·차량상태 색상은 값별로 빠짐없이 구분', () => {
  const styleKeys = PRODUCT_VEHICLE_MATCH_STATUS_STYLES.map((style) => `${style.header}|${style.value}`);
  assert.equal(new Set(styleKeys).size, 8);
  assert.deepEqual(new Set(PRODUCT_VEHICLE_MATCH_STATUS_STYLES
    .filter((style) => style.header === '상품 운영상태').map((style) => style.value)), new Set(['운영', '검수필요']));
  const vehicleStyles = PRODUCT_VEHICLE_MATCH_STATUS_STYLES.filter((style) => style.header === '차량상태');
  assert.deepEqual(new Set(vehicleStyles.map((style) => style.value)),
    new Set(['즉시출고', '출고가능', '상품화중', '출고협의', '계약중', '출고불가']));
  assert.equal(new Set(vehicleStyles.map((style) => style.background)).size, 6);
  for (const style of PRODUCT_VEHICLE_MATCH_STATUS_STYLES) {
    assert.match(style.background, /^#[0-9A-F]{6}$/);
    assert.match(style.foreground, /^#[0-9A-F]{6}$/);
  }
});

console.log(`product vehicle match view sim: ${passed}/${passed} PASS`);
