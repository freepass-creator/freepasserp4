import assert from 'node:assert/strict';
import { autoplusAdapter } from '../lib/adapters/autoplus';
import { iankaAdapter } from '../lib/adapters/ianka';
import { ironAdapter } from '../lib/adapters/iron';
import { providedSheetAdapter } from '../lib/adapters/provided';
import { sonogongAdapter } from '../lib/adapters/sonogong';
import { getSupplierAdapter, hasSupplierAdapter } from '../lib/adapters';
import {
  SUPPLIER_SOURCES,
  getSupplierSourceSpec,
  isIankaOriginalSheet,
  listSupplierSourceSpecs,
} from '../lib/adapters/source-registry';
import {
  calculateDepositFromMonthlyRent,
  depositMultiplierForTerm,
  resolveAutoplusDepositPolicy,
  SONOGONG_DEPOSIT_POLICY,
} from '../lib/domain/deposit-policy';
import { autoplusDepositRuleText, NATIVE_MONEY_BLOCK } from '../lib/domain/sales-published-tabs';
import { evaluateEligibility } from '../lib/domain/product-eligibility';
import { canonSalesTrim } from '../lib/domain/vehicle-master-options';

const ianka5709 = {
  차량번호: '133호5709',
  배차상태: '출고가능',
  제조사: '기아',
  모델: '카니발',
  단기보증: '500,000',
  '1개월': '1,170,000',
  '6개월': '1,140,000',
  '12개월': '1,110,000',
  장기보증: '2,500,000',
  '24개월': '1,080,000',
  '36개월': '1,050,000',
  '48개월': '1,020,000',
  '60개월': '990,000',
};

const got = iankaAdapter.adapt(ianka5709, {
  spreadsheetId: '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs',
  tab: '이안카',
  row: 1,
});

assert.equal(got.atom.plateNumber, '133호5709');
assert.equal(got.atom.shortDeposit, 500_000, '단기보증은 장기보증으로 바뀌면 안 된다');
assert.equal(got.atom.longDeposit, 2_500_000);
assert.equal(got.atom.rent[1], 1_170_000);
assert.equal(got.atom.rent[6], 1_140_000, '6개월도 정식 판매기간이다');
assert.equal(got.atom.rent[12], 1_110_000);
assert.equal(got.atom.rent[24], 1_080_000);
assert.equal(got.atom.rent[36], 1_050_000);
assert.equal(got.atom.rent[48], 1_020_000);
assert.equal(got.atom.rent[60], 990_000);
assert.equal(got.atom.provenance.shortDeposit.sourceHeader, '단기보증');
assert.equal(got.atom.provenance.longDeposit.sourceHeader, '장기보증');
assert.equal(evaluateEligibility(got.atom, 'ATOM').eligible, true);
assert.equal(evaluateEligibility(got.atom, 'F01').eligible, true);

// 아이언 실제 '재고' 스키마 회귀 fixture.
// 원본에는 6개월 열이 없으므로 어댑터가 다른 기간값을 6개월로 추정하면 안 된다.
const iron2330 = ironAdapter.adapt({
  차량번호: '151호2330',
  상태: '즉시출고',
  분류: '신차렌트',
  제조사: '현대',
  모델명: '싼타페',
  '차명(세부모델+트림)': '싼타페 하이브리드 2WD H-PICK 5인승',
  연료: '하이브리드',
  배기량: '1,600',
  장기보증: '4,000,000',
  '36개월': '980,000',
  '48개월': '900,000',
  '60개월': '850,000',
  '72개월': '750,000',
}, {
  spreadsheetId: '1Xm7Nl6yK7DcPQPF6w2OI_0-sphWHFVt2u6IKrYT8S4U',
  tab: '재고',
  row: 12,
});
assert.equal(iron2330.atom.plateNumber, '151호2330');
assert.equal(iron2330.atom.status, '즉시출고');
assert.equal(iron2330.atom.longDeposit, 4_000_000);
assert.equal(iron2330.atom.rent[6], undefined, '원본에 없는 6개월은 생성하지 않는다');
assert.equal(iron2330.atom.rent[24], undefined, '원본에 없는 24개월은 생성하지 않는다');
assert.equal(iron2330.atom.rent[36], 980_000);
assert.equal(iron2330.atom.rent[48], 900_000);
assert.equal(iron2330.atom.rent[60], 850_000);
assert.equal(iron2330.atom.rent[12], undefined);
assert.equal(evaluateEligibility(iron2330.atom, 'F01').eligible, true);
assert.equal(hasSupplierAdapter('IRON'), true);
assert.equal(getSupplierAdapter('iron').adapterName, 'ProvidedSheetAdapter');
assert.equal(getSupplierSourceSpec('RP006').kind, 'refined');
assert.equal(getSupplierSourceSpec('RP006').adapter, 'provided');

// 손오공 보증금은 숫자 칸이 아니라 "월 대여료 × 연수 (최대 ×3)"라는 계산 규칙 자체가 SSOT다.
const sonogong4099 = sonogongAdapter.adapt({
  차량번호: '119더4099',
  판매상태: '출고가능',
  제조사: '기아',
  모델: '카니발',
  '보증금 반납형': '연수×대여료(최대 ×3)',
  '12개월 반납형': '1,028,000',
  '24개월 반납형': '814,000',
  '36개월 반납형': '722,000',
  '48개월 반납형': '680,000',
  '60개월 반납형': '650,000',
}, {
  spreadsheetId: '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA',
  tab: '구독재고',
  row: 2,
});
assert.equal(sonogong4099.atom.depositPolicy?.code, 'SONOGONG_RENT_X_YEARS_MAX3');
assert.equal(sonogong4099.atom.depositPolicy?.label, '월 대여료 × 연수 (최대 ×3)');
assert.equal(sonogong4099.atom.longDeposit, undefined, '계산식 문구를 고정 숫자 보증금으로 오인하면 안 된다');
assert.equal(depositMultiplierForTerm(SONOGONG_DEPOSIT_POLICY, 12), 1);
assert.equal(depositMultiplierForTerm(SONOGONG_DEPOSIT_POLICY, 24), 2);
assert.equal(depositMultiplierForTerm(SONOGONG_DEPOSIT_POLICY, 36), 3);
assert.equal(depositMultiplierForTerm(SONOGONG_DEPOSIT_POLICY, 48), 3);
assert.equal(depositMultiplierForTerm(SONOGONG_DEPOSIT_POLICY, 60), 3);
assert.equal(calculateDepositFromMonthlyRent(SONOGONG_DEPOSIT_POLICY, 12, 1_028_000), 1_028_000);
assert.equal(calculateDepositFromMonthlyRent(SONOGONG_DEPOSIT_POLICY, 24, 814_000), 1_628_000);
assert.equal(calculateDepositFromMonthlyRent(SONOGONG_DEPOSIT_POLICY, 36, 722_000), 2_166_000);
assert.equal(calculateDepositFromMonthlyRent(SONOGONG_DEPOSIT_POLICY, 60, 650_000), 1_950_000);
assert.equal(NATIVE_MONEY_BLOCK.손오공구독.lead?.valueOf({}), '월 대여료 × 연수 (최대 ×3)');
assert.equal(hasSupplierAdapter('SONOGONG'), true);
assert.equal(getSupplierAdapter('sonogong').adapterName, 'SonogongAdapter');
assert.equal(getSupplierSourceSpec('RP012').code, 'SONOGONG');
assert.equal(getSupplierSourceSpec('RP012').tab, '구독재고');
assert.equal(listSupplierSourceSpecs('RP012').map((v) => v.code).join(','), 'SONOGONG,SONOGONG_RENT');
assert.equal(getSupplierAdapter('SONOGONG_RENT').adapterName, 'ProvidedSheetAdapter');

// 오토플러스는 같은 12개월이라도 연 2만/3만 km가 서로 다른 가격 원자다.
// 보증금 규칙도 발행기에서 즉석 생성하지 않고 atom.depositPolicy가 소유한다.
const autoplus0103 = autoplusAdapter.adapt({
  차량번호: '11오0103',
  판매상태: '출고가능',
  분류: '중고렌트',
  제조사: '기아',
  모델명: '니로',
  '차명(세부모델+트림)': '디 올뉴니로EV 에어',
  연료: '전기',
  주행거리: '23,866',
  '12개월2만': '770,000',
  '12개월3만': '800,000',
  '18개월2만': '730,000',
  '18개월3만': '750,000',
  '24개월2만': '690,000',
  '24개월3만': '730,000',
  '36개월2만': '690,000',
  '36개월3만': '730,000',
}, {
  spreadsheetId: '1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0',
  tab: '재고',
  row: 5,
});
assert.equal(autoplus0103.atom.status, '출고가능', '실 F53 판매상태 머리글을 읽어야 한다');
assert.equal(autoplus0103.atom.rent[12], undefined, '12개월2만/3만 중 하나를 12개월 표준가로 추정하지 않는다');
assert.equal(autoplus0103.atom.rentVariants?.length, 8);
assert.deepEqual(autoplus0103.atom.rentVariants?.find((v) => v.sourceHeader === '12개월2만'), {
  termMonths: 12,
  annualKm: 20_000,
  amount: 770_000,
  sourceHeader: '12개월2만',
});
assert.deepEqual(autoplus0103.atom.rentVariants?.find((v) => v.sourceHeader === '18개월3만'), {
  termMonths: 18,
  annualKm: 30_000,
  amount: 750_000,
  sourceHeader: '18개월3만',
});
assert.equal(autoplus0103.atom.depositPolicy?.code, 'AUTOPLUS_DOMESTIC_X2');
assert.equal(autoplus0103.atom.depositPolicy?.label, '국산: 월 대여료×2');
assert.equal(autoplusDepositRuleText('기아'), autoplus0103.atom.depositPolicy?.label, '발행기와 atom이 같은 resolver를 써야 한다');
const domesticPolicy = resolveAutoplusDepositPolicy('기아');
assert.ok(domesticPolicy);
assert.equal(depositMultiplierForTerm(domesticPolicy, 12), 2);
assert.equal(depositMultiplierForTerm(domesticPolicy, 36), 2);
assert.equal(evaluateEligibility(autoplus0103.atom, 'F01').eligible, true, '변형 가격도 판매 가능한 대여료다');
assert.equal(hasSupplierAdapter('AUTOPLUS'), true);
assert.equal(getSupplierAdapter('autoplus').adapterName, 'AutoplusAdapter');

const autoplusImport = autoplusAdapter.adapt({
  차량번호: '123가7777',
  판매상태: '출고가능',
  제조사: 'BMW',
  모델명: '520i',
  '12개월2만': '1,000,000',
  '18개월2만': '950,000',
});
assert.equal(autoplusImport.atom.depositPolicy?.code, 'AUTOPLUS_IMPORT_12_X3_18P_X6');
assert.equal(autoplusImport.atom.depositPolicy?.label, '수입: 12개월 대여료×3 · 18개월↑ ×6');
const importPolicy = resolveAutoplusDepositPolicy('BMW');
assert.ok(importPolicy);
assert.equal(depositMultiplierForTerm(importPolicy, 12), 3);
assert.equal(depositMultiplierForTerm(importPolicy, 18), 6);
assert.equal(depositMultiplierForTerm(importPolicy, 36), 6);
assert.equal(autoplusDepositRuleText('BMW'), autoplusImport.atom.depositPolicy?.label);
assert.equal(resolveAutoplusDepositPolicy(''), undefined, '제조사가 없는데 국산 규칙을 추정하면 안 된다');
assert.equal(autoplusDepositRuleText(''), '');

const noRent = iankaAdapter.adapt({
  차량번호: '123가4567',
  배차상태: '출고가능',
  모델: '테스트차량',
});
assert.equal(evaluateEligibility(noRent.atom, 'ATOM').eligible, true, 'SSOT에는 실제 차량을 보존한다');
assert.deepEqual(evaluateEligibility(noRent.atom, 'F01'), {
  eligible: false,
  reasons: ['RENT_MISSING'],
});

const ambiguousStatus = iankaAdapter.adapt({
  차량번호: '123가4568',
  배차상태: '확인중',
  모델: '테스트차량',
  '12개월': '900,000',
});
assert.equal(evaluateEligibility(ambiguousStatus.atom, 'ATOM').eligible, true);
assert.deepEqual(evaluateEligibility(ambiguousStatus.atom, 'F01'), {
  eligible: false,
  reasons: ['STATUS_NOT_EXPLICITLY_SELLABLE'],
});

const unavailable = iankaAdapter.adapt({
  차량번호: '123가4569',
  배차상태: '출고불가',
  모델: '테스트차량',
  '12개월': '900,000',
});
assert.equal(evaluateEligibility(unavailable.atom, 'F01').eligible, false);
assert.ok(evaluateEligibility(unavailable.atom, 'F01').reasons.includes('STATUS_NOT_EXPLICITLY_SELLABLE'));

const wellixRow = providedSheetAdapter.adapt({
  차량번호: '12가3456',
  상태: '출고가능',
  분류: '중고렌트',
  제조사: '현대',
  '제조사(정제)': '현대',
  모델: '아반떼',
  세부모델: '더 뉴 아반떼 CN7',
  세부트림: '인스퍼레이션',
  '차명(세부모델+트림)': '더 뉴 아반떼 CN7 1.6 가솔린 인스퍼레이션',
  연료: '가솔린',
  '연료(정제)': '가솔린',
  단기보증: '500,000',
  '1개월': '900,000',
  '12개월': '800,000',
  장기보증: '2,000,000',
  '36개월': '700,000',
  '72개월': '600,000',
}, {
  supplierCode: 'WELLIX',
  supplierName: '웰릭스',
  spreadsheetId: getSupplierSourceSpec('RP013').spreadsheetId,
  tab: '재고',
  row: 4,
});
assert.equal(wellixRow.atom.source.adapter, 'ProvidedSheetAdapter');
assert.equal(wellixRow.atom.rawName, '더 뉴 아반떼 CN7 1.6 가솔린 인스퍼레이션');
assert.equal(wellixRow.atom.maker, '현대');
assert.equal(wellixRow.atom.model, '아반떼');
assert.equal(wellixRow.atom.subModel, '더 뉴 아반떼 CN7');
assert.equal(wellixRow.atom.trim, '인스퍼레이션');
assert.equal(wellixRow.atom.rent[1], 900_000);
assert.equal(wellixRow.atom.rent[6], undefined, '원본에 없는 6개월은 생성하지 않는다');
assert.equal(wellixRow.atom.rent[12], 800_000);
assert.equal(wellixRow.atom.rent[36], 700_000);
assert.deepEqual(wellixRow.atom.rentVariants, [{
  termMonths: 72,
  amount: 600_000,
  sourceHeader: '72개월',
}]);
assert.equal(wellixRow.atom.provenance.maker.sourceHeader, '제조사(정제)');
assert.equal(wellixRow.atom.provenance.rawName.sourceHeader, '차명(세부모델+트림)');
assert.equal(hasSupplierAdapter('RP013'), true);
assert.equal(getSupplierAdapter('RP016').adapterName, 'ProvidedSheetAdapter');
assert.equal(getSupplierAdapter('RP004').adapterName, 'ProvidedSheetAdapter');
assert.equal(getSupplierAdapter('IANKA').adapterName, 'ProvidedSheetAdapter');

const iankaFromProvided = providedSheetAdapter.adapt(ianka5709);
assert.equal(iankaFromProvided.atom.rent[1], 1_170_000);
assert.equal(iankaFromProvided.atom.rent[6], 1_140_000, '헤더가 있으면 6개월도 읽는다');
assert.equal(iankaFromProvided.atom.status, '출고가능');

const ironFromProvided = providedSheetAdapter.adapt({
  차량번호: '151호2330',
  상태: '즉시출고',
  분류: '신차렌트',
  제조사: '현대',
  모델명: '싼타페',
  '차명(세부모델+트림)': '싼타페 하이브리드 2WD H-PICK 5인승',
  장기보증: '4,000,000',
  '36개월': '980,000',
  '72개월': '750,000',
});
assert.equal(ironFromProvided.atom.model, '싼타페');
assert.equal(ironFromProvided.atom.rent[6], undefined);
assert.equal(ironFromProvided.atom.rent[36], 980_000);
assert.equal(ironFromProvided.atom.rentVariants?.[0]?.termMonths, 72);

assert.equal(getSupplierSourceSpec('RP031').spreadsheetId, '1r1EP4oMP9V2iV-G5Q3nNNBHW7ttLMNycipFkfccHvOA');
assert.equal(getSupplierSourceSpec('RP031').tab, '재고');
assert.equal(isIankaOriginalSheet(getSupplierSourceSpec('RP031').spreadsheetId), false);
assert.equal(SUPPLIER_SOURCES.some((spec) => isIankaOriginalSheet(spec.spreadsheetId)), false);
assert.equal(getSupplierSourceSpec('RP004').code, 'AICAR');
assert.equal(SUPPLIER_SOURCES.filter((spec) => spec.adapter === 'provided').length >= 18, true);
assert.equal(SUPPLIER_SOURCES.filter((spec) => spec.adapter === 'autoplus').length, 1);
assert.equal(SUPPLIER_SOURCES.filter((spec) => spec.adapter === 'sonogong').length, 1);
assert.equal(hasSupplierAdapter('RP015'), false, '폐기된 경진렌트카는 원천이 아니다');

assert.equal(canonSalesTrim('제네시스', 'G80', 'G80 RG3', '런칭'), '기본형');
assert.equal(canonSalesTrim('제네시스', 'G80', 'G80 RG3', ''), '기본형');
assert.equal(canonSalesTrim('제네시스', 'G80', 'G80 RG3', 'Black'), 'Black');
assert.equal(wellixRow.atom.policyCode, undefined);
const withPolicy = providedSheetAdapter.adapt({ ...ianka5709, 정책코드: 'POL-0020', 장기보증: '무보증' });
assert.equal(withPolicy.atom.policyCode, 'POL-0020');
assert.equal(withPolicy.atom.longDeposit, 0);

console.log('SSOT adapter/eligibility regression tests: OK');
