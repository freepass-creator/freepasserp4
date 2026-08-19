import assert from 'node:assert/strict';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';

const header = ['관리상태','검증상태','신차/중고차','원산지','제조사','모델','세부모델','파워트레인','세부트림','트림행키','마스터ID','파워트레인순번','트림순번','세대명','개발코드','생산시작','생산종료','연식시작','연식종료','연료','정확배기량(cc)','표시배기량(L)','터보','구동방식','인승','배터리(kWh)','트림별칭','근거URL','근거메모','데이터기준일'];
const row = (status: string, verification: string, code: string, seq: number) => ['확정', verification, '신차', '국산', '테스트', '모델', '세대', '가솔린 2.0', `트림${seq}`, code, 'mf-test', 1, seq, '1세대', 'T1', '2026-01', '현재', '2026', '현재', '가솔린', '1,999', 2, '예', '2WD', 5, '', '별칭A|별칭B', 'https://example.com', '근거', '2026-08-15'].map((value, index) => index === 0 ? status : value);
const automatic = row('확정', '확정', 'mf-test::v01::t01', 1);
const manual = row('검증중', '1차확인', 'mf-test::v01::t02', 2);
const blocked = row('제외', '미검증', 'mf-test::v01::t03', 3);
const a = buildVehicleTrimMasterArtifact([header, blocked, automatic, manual], 'sheet', '차종마스터');
const b = buildVehicleTrimMasterArtifact([header, manual, blocked, automatic], 'sheet', '차종마스터');

assert.deepEqual(a, b, '행 정렬이 바뀌어도 산출물이 같아야 함');
assert.equal(a.row_count, 3);
assert.equal(a.manual_assignable_count, 1);
assert.equal(a.automatic_assignable_count, 1);
assert.equal(a.blocked_count, 1);
assert.equal(a.records[0].engine_cc, 1999);
assert.deepEqual(a.records[0].trim_aliases, ['별칭A', '별칭B']);
assert.throws(() => buildVehicleTrimMasterArtifact([header, automatic, automatic], 'sheet', '차종마스터'), /중복 트림행키/);
assert.throws(() => buildVehicleTrimMasterArtifact([header, row('정상', '1차확인', 'mf-test::v01::t04', 4)], 'sheet', '차종마스터'), /허용되지 않은 관리상태/);

const headerV2 = [...header, '차체구성', '원문별칭'];
const rayVan = [...row('확정', '확정', 'mf-ray::v01::t01', 1), '2인승 밴', 'The 2026 Ray 가솔린 2인승 밴|레이 밴'];
const v2 = buildVehicleTrimMasterArtifact([headerV2, rayVan], 'sheet', '차종마스터');
assert.equal(v2.records[0].body_configuration, '2인승 밴');
assert.deepEqual(v2.records[0].source_aliases, ['The 2026 Ray 가솔린 2인승 밴', '레이 밴']);
assert.throws(
  () => buildVehicleTrimMasterArtifact([headerV2, [...row('확정', '확정', 'mf-ray::v01::t02', 2), '밴 추정', '']], 'sheet', '차종마스터'),
  /허용되지 않은 차체구성/,
);

const headerNoPt = header.filter((name) => name !== '파워트레인');
const rowNoPt = (status: string, verification: string, code: string, seq: number) => {
  const full = row(status, verification, code, seq);
  return full.filter((_, index) => header[index] !== '파워트레인');
};
const prior = new Map([['mf-test::v01::t01', '가솔린 2.0'], ['mf-test::v01::t02', '가솔린 2.0']]);
const noPt = buildVehicleTrimMasterArtifact(
  [headerNoPt, rowNoPt('확정', '확정', 'mf-test::v01::t01', 1)],
  'sheet',
  '차종마스터',
  { priorPowertrainByKey: prior },
);
assert.equal(noPt.records[0].powertrain, '가솔린 2.0', '파워트레인 열 없이도 prior 라벨을 보존');

console.log('PASS — 상태 3단계·결정적 정렬·정확cc·별칭·중복/비허용상태 차단·파워트레인열선택');
