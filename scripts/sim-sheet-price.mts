/**
 * 공급사 시트 가격 파서 결정성 검증.
 * 실행: npx tsx scripts/sim-sheet-price.mts
 */
import { autoMapHeaders, importSheetTable, parsePriceColumns, rentCell } from '../lib/domain/sheet-import';
import { labelAutoplusHeaderRow } from '../lib/domain/sheet-adapters';
import { prepareAutoplusPromoTable } from '../lib/domain/sheet-autoplus';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type PriceMap = Record<string, { rent: number; deposit: number }> | null;
const failures: string[] = [];
let checks = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail == null ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
};
const price = (headers: string[], cells: string[], maker = '현대', rule: '' | 'months_per_year' | 'rent_multiple' = ''): PriceMap =>
  parsePriceColumns(headers, cells, { maker }, rule);

console.log('══ Sheet price matrix ══\n');

const trailingHeaders = ['1개월', '6개월', '12개월', '24개월', '36개월', '48개월', '60개월', '단기보증', '장기보증'];
const trailingCells = ['750000', '700000', '650000', '600000', '550000', '520000', '500000', '3000000', '5000000'];
const trailing = price(trailingHeaders, trailingCells);
check('STD-TRAILING 후행 단기·장기 보증',
  trailing?.['1']?.deposit === 3_000_000
  && trailing?.['12']?.deposit === 3_000_000
  && trailing?.['24']?.deposit === 5_000_000
  && trailing?.['60']?.deposit === 5_000_000,
  trailing);

const block = price(
  ['단기보증', '1개월', '6개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월'],
  ['3000000', '750000', '700000', '650000', '5000000', '600000', '550000', '520000', '500000'],
);
check('STD-BLOCK 선행 보증 블록도 동일', JSON.stringify(block) === JSON.stringify(trailing), block);

const duplicateLast = price(
  ['보증금', '12개월', '24개월', '보증금', '12개월', '24개월'],
  ['3150000', '1050000', '990000', '2721000', '907000', '850000'],
);
check('DUP-LAST-VALID 같은 기간은 마지막 유효 블록',
  duplicateLast?.['12']?.rent === 907_000 && duplicateLast?.['12']?.deposit === 2_721_000
  && duplicateLast?.['24']?.rent === 850_000 && duplicateLast?.['24']?.deposit === 2_721_000,
  duplicateLast);

const duplicatePartial = price(
  ['보증금', '12개월', '24개월', '보증금', '12개월', '24개월'],
  ['3150000', '1050000', '990000', '-', '', '850000'],
);
check('DUP-PARTIAL 뒤 블록 불완전 시 앞 유효값 유지',
  duplicatePartial?.['12']?.rent === 1_050_000 && duplicatePartial?.['12']?.deposit === 3_150_000
  && duplicatePartial?.['24']?.rent === 990_000 && duplicatePartial?.['24']?.deposit === 3_150_000,
  duplicatePartial);

const partial = price(['12개월', '24개월', '단기보증', '장기보증'], ['650000', '-', '3000000', '5000000']);
check('PARTIAL-KEEP 유효 기간만 수집', !!partial?.['12'] && !partial?.['24'], partial);
check('ALL-BAD-NULL 대여료 전부 무효면 null',
  price(['12개월', '24개월', '보증금'], ['-', '월 50 / 보증 100', '3000000']) === null);
check('DEPOSIT-TEXT 보증 설명문을 숫자로 조합하지 않음',
  price(['보증금', '36개월'], ['12개월 : 1개월치 / 24개월 : 2개월치', '500000']) === null);

const monthsRule = price(['36개월'], ['500000'], '현대', 'months_per_year');
check('RULE-MONTHS 보증열 없어도 명시 규칙만 적용', monthsRule?.['36']?.deposit === 1_500_000, monthsRule);
check('RULE-NONE 보증열·규칙 없으면 fail-closed', price(['36개월'], ['500000']) === null);
const domesticMultiple = price(['36개월'], ['500000'], '현대', 'rent_multiple');
const importMultiple = price(['36개월'], ['500000'], 'BMW', 'rent_multiple');
check('RULE-MULT-DOMESTIC 국내 rent×2', domesticMultiple?.['36']?.deposit === 1_000_000, domesticMultiple);
check('RULE-MULT-IMPORT 수입 rent×3', importMultiple?.['36']?.deposit === 1_500_000, importMultiple);
const importBrands = ['인피니티', '토요타', '혼다', '닛산', '지프', '포드', '캐딜락', '폴스타'];
check('RULE-MULT-IMPORT-MATRIX 주요 수입 브랜드 모두 rent×3',
  importBrands.every((maker) => price(['36개월'], ['500000'], maker, 'rent_multiple')?.['36']?.deposit === 1_500_000));
check('RULE-MULT-UNKNOWN 미확정 브랜드를 국산으로 추정하지 않음',
  price(['36개월'], ['500000'], '미확인브랜드', 'rent_multiple') === null);
const importInRawModel = parsePriceColumns(
  ['36개월'],
  ['500000'],
  { _snapped: true, _raw_vehicle: { maker: '', model: 'BMW 120i' } },
  'rent_multiple',
);
check('RULE-MULT-RAW-MODEL 제조사 칸 없이 원문 모델에 적힌 수입 브랜드는 ×3',
  importInRawModel?.['36']?.deposit === 1_500_000,
  importInRawModel);

const won = price(['12개월', '단기보증'], ['650000원', '3000000원']);
const manwon = price(['12개월', '단기보증'], ['65만원', '300만원']);
const legacy = price(['12개월', '단기보증'], ['65', '300']);
const canonical = JSON.stringify({ '12': { rent: 650000, deposit: 3000000 } });
check('UNIT-WON 원 suffix 원 단위 원자', JSON.stringify(won) === canonical, won);
check('UNIT-MANWON 만원 suffix 원 단위 원자', JSON.stringify(manwon) === canonical, manwon);
check('UNIT-LEGACY 무단위 만원 원자도 동일 정규화', JSON.stringify(legacy) === canonical, legacy);
check('UNIT-SMALL-WON 명시적 소액 원은 10,000배 확대하지 않고 거부',
  price(['12개월', '단기보증'], ['65원', '300원']) === null);
check('RENT-STRICT 범위·형식 경계',
  rentCell('-500000') === 0
  && rentCell('월 500000 / 보증 2000000') === 0
  && rentCell('9만원') === 0
  && rentCell('2001만원') === 0
  && rentCell('10만원') === 100_000
  && rentCell('2000만원') === 20_000_000);

const autoHeader = labelAutoplusHeaderRow(Array.from({ length: 15 }, (_, i) => i === 9 ? '차량가격' : ''));
check('AUTO-LABEL col11~14 = 12·24·36·48개월',
  autoHeader.slice(11, 15).join('|') === '12개월|24개월|36개월|48개월', autoHeader.slice(9, 15));
const autoCells = Array.from({ length: 15 }, () => '');
autoCells[9] = '99999999';
autoCells[11] = '650000'; autoCells[12] = '600000'; autoCells[13] = '550000'; autoCells[14] = '500000';
const autoPrice = price(autoHeader, autoCells, '현대', 'rent_multiple');
check('AUTO-PRICE 차량가격 col9 무시·가격 4열만 수집',
  Object.keys(autoPrice || {}).join('|') === '12|24|36|48'
  && autoPrice?.['12']?.rent === 650_000
  && autoPrice?.['12']?.deposit === 1_300_000,
  autoPrice);

const promoRow = Array.from({ length: 15 }, () => '');
promoRow[1] = '12가3456'; promoRow[11] = '650000';
const promoHeader = [
  '순번', '차량번호', '차종', '모델명(트림풀명)', '색상', '연료',
  '최초등록일', '주행거리', '판매상태', '가격', '', '', '', '', '',
];
const promo = prepareAutoplusPromoTable([['안내'], promoHeader, promoRow]);
check('AUTO-PROMO 프로모션도 같은 4개 가격 라벨',
  promo.length === 2 && promo[0].slice(11, 15).join('|') === '12개월|24개월|36개월|48개월');
const promoMapping = autoMapHeaders(promo[0]);
check('AUTO-PROMO 차종·모델명은 모델·트림으로 각각 고정 매핑',
  promoMapping.model === 2 && promoMapping.trim_name === 3,
  promoMapping);

const shiftedDownPromo = prepareAutoplusPromoTable([
  ['상단 배너'],
  ['', '공급사 안내'],
  promoHeader,
  [],
  ['이미지 링크를 먼저 확인하세요'],
  [],
  promoRow,
]);
check('AUTO-PROMO 헤더 아래 안내·빈 행이 끼어도 첫 차량 블록을 찾아 읽음',
  shiftedDownPromo.length === 2 && shiftedDownPromo[1]?.[1] === '12가3456');

const promoRow2 = [...promoRow];
promoRow2[1] = '34나5678';
const stalePromoRow = [...promoRow];
stalePromoRow[1] = '99하9999';
const promoBlock = prepareAutoplusPromoTable([
  ['상단 공지'],
  promoHeader,
  promoRow,
  promoRow2,
  [],
  stalePromoRow,
]);
check('AUTO-PROMO 헤더 바로 아래 연속 블록만 읽고 하단 과거 이력은 제외',
  promoBlock.length === 3
  && promoBlock[1]?.[1] === '12가3456'
  && promoBlock[2]?.[1] === '34나5678'
  && !promoBlock.some((row) => row[1] === '99하9999'));

const shiftedPromoRow = [...promoRow];
shiftedPromoRow[1] = '';
shiftedPromoRow[2] = '12가3456';
let shiftedPromoBlocked = false;
try {
  prepareAutoplusPromoTable([promoHeader, shiftedPromoRow]);
} catch (error) {
  shiftedPromoBlocked = String(error).includes('차량번호 열 이동 감지');
}
check('AUTO-PROMO 헤더 아래 차량번호 열 이동은 저장 전 차단', shiftedPromoBlocked);

/**
 * 아이카 배치 — 기간 열은 36·48·60개월만 두고 짧은 건 「월렌트」 한 칸, 보증 열은 「장기보증」 하나.
 * 그 하나가 단기까지 관할해야 월렌트만 있는 차가 올라온다(2026-08-12 · 57호9876 제네시스 G70).
 */
const monthly = importSheetTable([
  ['차량번호', '제조사', '모델', '월렌트', '장기보증', '36개월'],
  ['12가3456', '현대', '아반떼', '900000', '1000000', ''],
], { providerCode: 'RP', entries: [{} as never] });
check('AICA-MONTHLY 「월렌트」는 1개월 요금 · 보증 열이 하나면 그 하나가 단기도 관할',
  (monthly.products[0]?.price as Record<string, { rent: number; deposit: number }> | undefined)?.['1']?.rent === 900_000
  && (monthly.products[0]?.price as Record<string, { rent: number; deposit: number }> | undefined)?.['1']?.deposit === 1_000_000,
  monthly.products[0]?.price);

const noPrice = importSheetTable([
  ['차량번호', '제조사', '모델', '12개월', '보증금'],
  ['12가3456', '현대', '아반떼', '-', '3000000'],
], { providerCode: 'RP', entries: [{} as never] });
/**
 * ★규칙이 바뀌었다(사장님 2026-08-12 — 「요금이 없어도 올리자」).
 *   예전엔 가격이 하나도 없으면 그 차를 **버렸다**. 그래서 공급사 시트에는 있는데 ERP 에 없는
 *   차가 생겼고 「시트 = ERP = 엑셀」이 어긋났다(아이카 14 · 손오공 12 · 리더스 2 · 경진카 1).
 *   이제는 **올리되 가격을 비운다.** 지키는 건 그대로다 — **없는 값을 지어내지 않는다.**
 *   몇 대가 그런지 세는 것(noPriceCount·증빙)도 그대로다. 조용히 넘기면 「다 됐다」로 보인다.
 */
check('IMPORT-NOPRICE 가격이 전부 무효여도 올리되 가격은 비우고 증빙을 남긴다',
  noPrice.imported === 1
  && !Object.keys((noPrice.products[0]?.price || {}) as Record<string, unknown>).length
  && noPrice.noPriceCount === 1
  && noPrice.issueSamples.some((item) => item.includes('가격없음')),
  noPrice.issueSamples);

const masterBase = {
  year_start: '2020', year_end: '2026', variants: [], trims: [],
} satisfies Partial<MasterEntry>;
const masterDomestic: MasterEntry = {
  ...masterBase,
  id: 'hyundai_avante_cn7', maker: '현대', model: '아반떼', sub_model: '아반떼 CN7',
  gen_code: 'hyundai_avante_cn7', origin: '국산',
};
const masterImport: MasterEntry = {
  ...masterBase,
  id: 'infiniti_q50_v37', maker: '인피니티', model: 'Q50', sub_model: 'Q50 V37',
  gen_code: 'infiniti_q50_v37', origin: '수입',
};
const originHeaders = ['차량번호', '제조사', '모델', '36개월'];
const domesticByMaster = importSheetTable([
  originHeaders,
  ['12가3456', '', '아반떼', '500000'],
], { providerCode: 'RP', entries: [masterDomestic], depositRule: 'rent_multiple' });
const importByMaster = importSheetTable([
  originHeaders,
  ['34나5678', '', 'Q50', '500000'],
], { providerCode: 'RP', entries: [masterImport], depositRule: 'rent_multiple' });
check('RULE-MULT-MASTER-DOMESTIC 제조사 공란도 마스터 origin=국산이면 ×2',
  (domesticByMaster.products[0]?.price as Record<string, { deposit: number }> | undefined)?.['36']?.deposit === 1_000_000,
  domesticByMaster.products[0]?.price);
check('RULE-MULT-MASTER-IMPORT 제조사 공란도 마스터 origin=수입이면 ×3',
  (importByMaster.products[0]?.price as Record<string, { deposit: number }> | undefined)?.['36']?.deposit === 1_500_000,
  importByMaster.products[0]?.price);
check('MASTER-ORIGIN은 금액 판정에만 쓰고 기존 재고를 대량 수정할 저장 필드로 남기지 않음',
  domesticByMaster.products[0]?.origin === undefined && importByMaster.products[0]?.origin === undefined);
const ambiguousDomestic: MasterEntry = {
  ...masterDomestic,
  id: 'domestic_x', model: 'X', sub_model: 'X 국내', gen_code: 'domestic_x',
};
const ambiguousImport: MasterEntry = {
  ...masterImport,
  id: 'import_x', model: 'X', sub_model: 'X 수입', gen_code: 'import_x',
};
const ambiguousOrigin = (entries: MasterEntry[], plate: string) => importSheetTable([
  originHeaders,
  [plate, '', 'X', '500000'],
], { providerCode: 'RP', entries, depositRule: 'rent_multiple' });
const ambiguousForward = ambiguousOrigin([ambiguousDomestic, ambiguousImport], '56다7890');
const ambiguousReverse = ambiguousOrigin([ambiguousImport, ambiguousDomestic], '78라9012');
/**
 * ★fail-closed 의 대상은 **금액**이지 그 차가 아니다(2026-08-12 규칙 변경 이후).
 *   같은 모델명이 국산·수입 마스터에 함께 있으면 배율을 못 정한다 — 그때 보증금을 지어내지 않는다.
 *   차는 올라오되 **가격이 비어 있어야** 한다. 마스터 배열 순서가 금액을 바꾸면 안 된다는 게 요지다.
 */
check('RULE-MULT-MASTER-AMBIGUOUS 국산·수입 동명모델은 마스터 배열 순서와 무관하게 가격 fail-closed',
  ambiguousForward.imported === 1 && ambiguousForward.noPriceCount === 1
  && !Object.keys((ambiguousForward.products[0]?.price || {}) as Record<string, unknown>).length
  && ambiguousReverse.imported === 1 && ambiguousReverse.noPriceCount === 1
  && !Object.keys((ambiguousReverse.products[0]?.price || {}) as Record<string, unknown>).length,
  { forward: ambiguousForward.products[0]?.price, reverse: ambiguousReverse.products[0]?.price });

const canonicalDomestic: MasterEntry = {
  ...masterDomestic,
  id: 'kia_k5_dl3', maker: '기아', model: 'K5', sub_model: 'K5 DL3', gen_code: 'kia_k5_dl3',
};
const blankMakerDomestic = importSheetTable([
  originHeaders,
  ['90가1234', '', 'K5 HEV', '500000'],
], { providerCode: 'RP', entries: [canonicalDomestic], depositRule: 'rent_multiple' });
check('RULE-MULT-CANONICAL-CONSENSUS 제조사 없는 모델도 정식 모델 후보 제조국이 하나면 ×2',
  (blankMakerDomestic.products[0]?.price as Record<string, { deposit: number }> | undefined)?.['36']?.deposit === 1_000_000,
  blankMakerDomestic.products[0]?.price);

console.log(`\n${checks - failures.length}/${checks} PASS`);
if (failures.length) {
  console.error('FAIL:', failures.join(', '));
  process.exit(1);
}
console.log('PASS — sheet price matrix');
process.exit(0);
