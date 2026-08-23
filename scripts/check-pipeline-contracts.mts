/** 공급사 상품시트·천이시트 파이프라인의 순수 규칙 회귀검사. Google/ERP는 읽거나 쓰지 않는다. */
import assert from 'node:assert/strict';
import { parsePublishedSalesMapping, SALES_RETIRED_COLUMNS } from '../lib/domain/sales-sheet-mapping';
import { publishedSalesColumns } from '../lib/domain/sales-published-tabs';
import { buildSupplierPreviewValues, compareSheetMatrices, supplierSalesLabel } from '../lib/domain/supplier-preview-parity';

const mapping = parsePublishedSalesMapping([
  ['@매핑', '판매시트 열', '후보'],
  ['', '차량번호', '차량번호'],
  ['', '제조사', '제조사'],
  ['', '모델', '모델명'],
  ['', '차대번호', 'VIN'],
  ['', '단기보증', '단기보증'],
  ['', '1개월', '1개월'],
  ['', '12개월', '12개월'],
  ['', '장기보증', '장기보증'],
  ['', '24개월', '24개월'],
  ['', '36개월', '36개월'],
  ['', '48개월', '48개월'],
  ['', '60개월', '60개월'],
  ['', '차종구분', '차종구분'],
  ['', '세부모델', '세부모델'],
  ['', '세부트림', '세부트림'],
  ['', '옵션', '선택옵션'],
  ['', '공급사', ''],
  ['@매핑끝', '', ''],
]);
assert.deepEqual(mapping.columns.slice(0, 3), ['차량번호', '제조사', '모델']);
// 차대번호(VIN)는 상품리스트에 안 올린다(사장님 2026-08-22) — @매핑에 남아 있어도 발행기가 세우지 않는다.
assert.ok(!mapping.columns.includes('차대번호'));
assert.ok(mapping.retired.includes('차대번호'));
assert.equal(mapping.aliases.모델[0], '모델명');
/**
 * ★공급사 원문 두 칸 — 「2중 보관」(2026-08-23). @매핑에 없으면 **옵션 바로 앞**에 «차명(원문) → 옵션(원문)» 차례로 선다.
 * ⚠ 옛 이름 「차명」은 폐지했다 — `HEADER_ALIASES.차명 = 'model'` 과 겹쳐 왼쪽의 「모델」이 먼저 자리를 잡는 바람에
 *   그 열이 ERP 로 한 번도 못 갔다. 되살리지 마라.
 */
const optAt = mapping.columns.indexOf('옵션');
assert.deepEqual(mapping.columns.slice(optAt - 2, optAt), ['차명(원문)', '옵션(원문)']);
assert.ok(!mapping.columns.includes('차명'));
// `retired` 는 «시트 @매핑에 있었는데 폐지된 것»만 담는다 — 이 붙박이 표엔 「차명」이 없으므로 목록 자체를 본다.
assert.ok(SALES_RETIRED_COLUMNS.includes('차명'));

/**
 * ★**ERP 세부축은 판매시트가 나른다**(사장님 2026-08-22 「ERP 에는 정제를 쓰는 게 맞고 정제만 잘해 두면 되니까」).
 *   ERP 는 공급사 시트를 직접 읽지 않고 **판매시트만** 읽는다(`sheet-daily-sync`). 그래서 이 세 칸이 발행 열에서
 *   빠지는 순간 ERP 세부모델·세부트림·차종구분이 조용히 옛 값에 멈춘다 — 실제로 08-19~08-22 사흘간 그랬다
 *   (ERP 세부모델 33% · 세부트림 19%). 여기서 못 박아 다음에 누가 열을 빼면 검사에서 걸리게 한다.
 */
for (const col of ['세부모델', '세부트림', '차종구분']) {
  assert.ok(mapping.columns.includes(col), `판매시트 발행 열에 「${col}」이 있어야 ERP 가 정제값을 받는다`);
}
// 원문 두 칸은 **공급사 원문 열**을 집는다(정제칸이 아니라) — 정제 조합을 여기 넣으면 2중 보관이 아니라 같은 값 두 번이 된다.
assert.equal(mapping.aliases['차명(원문)']?.[0], '차명(세부모델+트림)');
assert.equal(mapping.aliases['옵션(원문)']?.[0], '옵션');
assert.equal(mapping.aliases['옵션']?.[0], '선택옵션');

assert.throws(() => parsePublishedSalesMapping([
  ['@매핑', '', ''], ['', '차량번호', '차량번호'], ['', '차량번호', '차번'], ['', '공급사', '공급사'], ['@매핑끝', '', ''],
]), /중복 열/);

const sonogong = publishedSalesColumns('손오공구독', mapping.columns);
assert.ok(!sonogong.includes('단기보증'));
assert.ok(!sonogong.includes('1개월'));
assert.ok(sonogong.includes('보증금 반납형'));
assert.ok(sonogong.includes('60개월 인수형'));
assert.ok(sonogong.indexOf('보증금 반납형') > sonogong.indexOf('차종구분'));

const autoplus = publishedSalesColumns('오플구독', mapping.columns);
assert.ok(autoplus.includes('보증금'));
assert.ok(autoplus.includes('12개월 3만km'));
assert.ok(!autoplus.includes('12개월'));

const preview = buildSupplierPreviewValues([
  { prefix: '상품리스트', header: ['공급사', '차량번호', '차대번호'], rows: [['아이카', '차량-1', 'VIN-1']] },
  { prefix: '오플구독', header: ['공급사', '차량번호', '보증금'], rows: [['오토플러스', '차량-2', '규칙']] },
]);
assert.equal(preview.length, 5);
assert.deepEqual(preview[2], []);
assert.equal(compareSheetMatrices(preview, preview.map((row) => [...row, ''])).mismatchedCells, 0);
const shifted = preview.map((row) => [...row]);
shifted[1] = ['아이카', '', '차량-1', 'VIN-1'];
assert.ok(compareSheetMatrices(preview, shifted).mismatchedCells > 0);

assert.equal(supplierSalesLabel('경진'), '경진카');
assert.equal(supplierSalesLabel('경진렌트카'), '경진카');
assert.equal(supplierSalesLabel('J&J'), '제이앤제이렌트카');

console.log('✓ 판매시트 @매핑 파서·갈래 열·공급사 상품시트 행렬·별칭 회귀검사 통과');
