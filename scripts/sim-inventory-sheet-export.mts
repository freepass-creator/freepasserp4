import assert from 'node:assert/strict';
import {
  buildInventorySheet,
  dedupeForSales,
  exportRow,
  HEADERS,
} from '../lib/domain/inventory-sheet-export';

const rows = [
  { _key: 'EXT_a', product_code: 'EXT_a', provider_company_code: 'RP004', car_number: '109호3398' },
  {
    _key: 'RP004_109호3398',
    product_code: 'RP004_109호3398',
    provider_company_code: 'RP004',
    car_number: '109호3398',
  },
  { _key: 'RP005_109호3398', provider_company_code: 'RP005', car_number: '109호3398' },
  { _key: 'TMP1', provider_company_code: 'RP004', car_number: '100신0001' },
  { _key: 'TMP2', provider_company_code: 'RP004', car_number: '100신0001' },
];

const deduped = dedupeForSales(rows);
assert.equal(deduped.length, 4, '같은 공급사·같은 실차번호만 한 줄로 줄여야 한다');
assert.ok(deduped.some((row) => row._key === 'RP004_109호3398'), '시트 정식 키를 우선해야 한다');
assert.ok(deduped.some((row) => row._key === 'RP005_109호3398'), '다른 공급사의 같은 차번호는 보존해야 한다');
assert.equal(deduped.filter((row) => row.car_number === '100신0001').length, 2, '임시번호는 합치지 않아야 한다');

const automatic = {
  _key: 'P1',
  product_code: 'P1',
  car_number: '12가3456',
  maker: '기아',
  model: '카니발',
  sub_model: '카니발 KA4',
  variant: '2.2 디젤 9인승 2WD',
  trim_name: '프레스티지',
  seats: '9',
  drive_type: '2WD',
  _snapped: true,
  _snap_defaults: { seats: true, drive_type: true, trim_name: true },
  price: {},
};
/**
 * ★매칭상태·매칭메모는 영업자 시트에 **없어야 한다**(2026-08-09 사장님 지시).
 *
 * 「검수필요 — 차종마스터 누락」은 우리 데이터가 덜 정리됐다는 뜻이지 그 차의 성질이 아니다.
 * 이 시트는 링크만 있으면 열리는 외부 문서라 손님 앞에서 보일 자리가 아니다.
 * 검수는 관리자 화면(`components/SyncPreview.tsx`)이 같은 판정을 그대로 보여준다.
 */
exportRow(automatic, '공급사');
assert.equal(HEADERS.indexOf('매칭상태'), -1, '숨긴 원본에도 매칭상태를 두지 않는다');
assert.equal(HEADERS.indexOf('매칭메모'), -1, '숨긴 원본에도 매칭메모를 두지 않는다');

const built = buildInventorySheet(1, [automatic], () => '공급사');
assert.ok(!built.values[0].includes('매칭상태'), '보이는 표에 매칭상태 열이 없어야 한다');
assert.ok(!built.values[0].includes('매칭메모'), '보이는 표에 매칭메모 열이 없어야 한다');
assert.ok(!built.values[0].includes('인승'), '인승은 파워트레인에 포함하므로 별도 열을 만들면 안 된다');
assert.ok(!built.values[0].includes('구동'), '구동은 파워트레인에 포함하므로 별도 열을 만들면 안 된다');
assert.equal(
  built.values[1][built.values[0].indexOf('파워트레인')],
  '2.2 디젤 9인승 2WD',
  '파워트레인 한 칸에 인승과 구동을 포함한 완성 조합을 표시해야 한다',
);

const localLinked = buildInventorySheet(
  1,
  [automatic],
  () => '공급사',
  undefined,
  'http://localhost:4004',
  { '12가3456': 'https://example.com/car.jpg' },
);
assert.match(String(localLinked.values[1][2]), /^=IMAGE\(/, '로컬 실행도 사진은 표시해야 한다');
assert.doesNotMatch(String(localLinked.values[1][2]), /HYPERLINK/, '공유 시트에 localhost 링크를 만들면 안 된다');

const publicLinked = buildInventorySheet(
  1,
  [automatic],
  () => '공급사',
  undefined,
  'https://freepasserp.com',
  { '12가3456': 'https://example.com/car.jpg' },
);
assert.match(String(publicLinked.values[1][2]), /^=HYPERLINK\("https:\/\/freepasserp\.com\/q\//, '공개 주소는 카탈로그 링크로 연결해야 한다');
assert.match(String(publicLinked.values[1][2]), /IMAGE\(/, '카탈로그 링크 안의 차량 사진을 유지해야 한다');

// 검수 표식이 붙은 매물도 시트에는 «그 사실»이 안 실린다 — 차 정보는 그대로 나간다.
const review = {
  ...automatic,
  _snap_defaults: null,
  _snap_issues: [{ code: 'trim_not_in_master' as const, field: 'trim_name' as const, value: '프레지티지' }],
};
const reviewed = exportRow(review, '공급사');
assert.ok(!reviewed.some((cell) => /검수필요|마스터 누락|공급사 오기/.test(String(cell ?? ''))),
  '검수 사유가 시트로 새어 나가면 안 된다');
assert.equal(reviewed[HEADERS.indexOf('세부트림')], '프레스티지', '차 정보는 그대로 나간다');

console.log('PASS 영업자 시트 · 중복 정식키 우선 · 타 공급사/임시번호 보존 · 검수 표식 비노출');
