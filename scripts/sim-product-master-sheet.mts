import assert from 'node:assert/strict';
import {
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_COLUMN_MAPPING_TAB,
  PRODUCT_MASTER_PERIODS,
  PRODUCT_MASTER_VARIANT_PRICE_COLUMNS,
  autoplusDeposit,
  isProductMasterAiLockedColumn,
  isProductMasterLiveColumn,
  isProductMasterRentWatchColumn,
  productMasterManagement,
  productMasterSourceRowInfo,
  productMasterSupplierInfo,
  productMasterSupplierVehicleName,
  productMasterVehicleName,
  productMasterVerification,
  sonogongSubscriptionDeposit,
} from '../lib/domain/product-master-sheet';

const check = (name: string, yes: boolean) => {
  assert.ok(yes, name);
  console.log(`✓ ${name}`);
};

check('공급사 원본의 실제 탭·헤더·열 위치는 별도 열 매핑 탭이 정본',
  PRODUCT_MASTER_COLUMN_MAPPING_TAB === '공급사 열 매핑');

check('기간은 1·6·12·18·24·36·48·60·72·84개월 고정',
  PRODUCT_MASTER_PERIODS.join(',') === '1,6,12,18,24,36,48,60,72,84');
check('각 기간은 대여료 바로 옆에 보증금이 온다', PRODUCT_MASTER_PERIODS.every((months) => {
  const rent = PRODUCT_MASTER_COLUMNS.indexOf(`${months}개월 대여료`);
  return rent >= 0 && PRODUCT_MASTER_COLUMNS[rent + 1] === `${months}개월 보증금`;
}));
check('후행 가격블록도 대여료 바로 옆에 보증금이 온다', PRODUCT_MASTER_VARIANT_PRICE_COLUMNS.every((column, index) => (
  index % 2 === 1 || PRODUCT_MASTER_VARIANT_PRICE_COLUMNS[index + 1] === column.replace('대여료', '보증금')
)));
check('손오공 인수형 36·48·60개월 보증금은 각각 3·4·5개월치',
  sonogongSubscriptionDeposit(1_000_000, 36) === 3_000_000
  && sonogongSubscriptionDeposit(1_000_000, 48) === 4_000_000
  && sonogongSubscriptionDeposit(1_000_000, 60) === 5_000_000);
check('오토플러스 보증금은 국산×2·수입 12개월×3·18개월 이상×6',
  autoplusDeposit({ rent: 1_000_000, months: 12, origin: '국산' }) === 2_000_000
  && autoplusDeposit({ rent: 1_000_000, months: 12, origin: '수입' }) === 3_000_000
  && autoplusDeposit({ rent: 1_000_000, months: 18, origin: '수입' }) === 6_000_000);
check('관리자 첫 화면은 공급사 입력 차명과 차종마스터 적용값을 바로 대조한다',
  PRODUCT_MASTER_COLUMNS.slice(0, 6).join(',')
    === '차량번호,공급사명,공급사 입력 차명,차종마스터 적용값,검증상태,검수사유');
check('정책·차종·공급사 코드는 표 맨 뒤 관리영역에 있다',
  PRODUCT_MASTER_COLUMNS.slice(-6).join(',')
    === '정책코드,차종코드,공급사코드,최종갱신,원천,공급사 원문보존');
check('차명은 모델명·파워트레인·세부트림만 한 칸', productMasterVehicleName({
  maker: '테슬라', model: 'Model Y', subModel: 'Model Y', powertrain: '전기', trim: 'RWD',
}) === 'Model Y · 전기 · RWD');
check('세부모델이 없으면 모델명을 사용한다', productMasterVehicleName({
  maker: '기아', model: 'K7', powertrain: 'LPG 3.0', trim: '프레스티지',
}) === 'K7 · LPG 3.0 · 프레스티지');
check('제조사와 공급사 원문은 한 칸에서 출처를 구분한다', productMasterSupplierInfo({
  maker: '현대', rawInfo: '차명: 더 뉴 아반떼 CN7 LPG 1.6 스마트 | 연식: 2026',
}) === '제조사: 현대 | 공급사 차명: 더 뉴 아반떼 CN7 LPG 1.6 스마트 | 연식: 2026');
check('제조사를 확정할 수 없으면 미입력으로 표시한다', productMasterSupplierInfo({
  rawInfo: '차명: 2.5 26MY 베스트 셀렉션 2WD',
}) === '제조사: 미입력 | 공급사 차명: 2.5 26MY 베스트 셀렉션 2WD');
check('원본 행은 차량번호 기준으로 빈칸 외 모든 열을 헤더와 함께 보존한다', productMasterSourceRowInfo({
  tab: '시트1',
  headers: ['차량번호', '차종', '모델명(트림)', '유종', '', '12개월', '무보험'],
  row: ['34호9093', 'K7', '', 'LPG', '메모|원문', '620,000', '없음'],
}) === '원본탭: 시트1 | 차량번호: 34호9093 | 차종: K7 | 유종: LPG | 열 E: 메모 / 원문 | 12개월: 620,000 | 무보험: 없음');
check('관리자 대조열은 차명과 공급사가 준 판별 신호를 함께 보여 준다', productMasterSupplierVehicleName(
  '원본탭: 시트1 | 차량번호: 34호9093 | 차종: K7 | 모델명(트림): 미입력 | 유종: LPG | 최초등록일: 18-10-18 | 주행거리: 171,693',
) === 'K7 · LPG · 최초등록 18-10-18');
check('괄호 설명이 다른 모델명 열도 상세 모델로 인식한다', productMasterSupplierVehicleName(
  '원본탭: 판매차량리스트 | 차량번호: 282나2079 | 차종: BMW X1 | 모델명(트림풀네임): X1(2세대) 20i xDrive x라인 스페셜에디션 | 연료: 휘발유',
) === 'BMW X1 · X1(2세대) 20i xDrive x라인 스페셜에디션 · 휘발유');
check('공급사 차명 열이 있으면 뒤쪽 정제 모델 열이 관리자 대조값을 덮지 않는다', productMasterSupplierVehicleName(
  '원본탭: 재고 | 차량번호: 104호3665 | 제조사: 제네시스 | 차명(트림): GV80 3.0 디젤 2WD 5인승 기본형 | 연료: 디젤 | 배기량: 2,996 | 최초등록일: 20-5-22 | 모델: GV80 | 세부모델: GV80 JX1 | 파워트레인: 디젤 3.0 AWD',
) === '제네시스 · GV80 3.0 디젤 2WD 5인승 기본형 · 배기 2,996 · 최초등록 20-5-22');
check('차명 열 없이 차종분류·세부모델·트림을 주는 공급사도 빠짐없이 요약한다', productMasterSupplierVehicleName(
  '원본탭: 이안카 | 차량번호: 133호6165 | 차종분류: 미니 쿠퍼 | 세부모델: 쿠퍼 c 5도어 | 연료: 가솔린 | 트림: 쿠퍼 C 5도어 | 최초등록: 26년3월 | 제조사: 미니 | 배기량: 1,998',
) === '미니 쿠퍼 · 쿠퍼 c 5도어 · 가솔린 · 배기 1,998 · 최초등록 26년3월');
check('이미 차명에 포함된 연료는 대조열에 중복하지 않는다', productMasterSupplierVehicleName(
  '제조사: 현대 | 공급사 차명: 더 뉴 아반떼 CN7 LPG 1.6 스마트 | 연식: 2026 | 연료: LPG',
) === '현대 · 더 뉴 아반떼 CN7 LPG 1.6 스마트 · 연식 2026');
check('차종코드 없는 행은 미매칭', productMasterVerification({
  trimCode: '', masterFound: false,
}) === '미매칭');
check('차종마스터 확정/확정만 상품 확정', productMasterVerification({
  trimCode: 'mf-001::v01::t01', masterFound: true, masterManagement: '확정', masterVerification: '확정',
}) === '확정');
check('공급사코드 또는 차종코드가 없으면 검수필요', productMasterManagement({
  providerCode: '', trimCode: 'x', masterFound: true, vehicleStatus: '출고가능',
}) === '검수필요');
check('가격 검수사유가 있으면 코드가 맞아도 검수필요', productMasterManagement({
  providerCode: 'RP004', trimCode: 'x', masterFound: true, vehicleStatus: '출고가능', reviewReasons: ['보증금 미입력'],
}) === '검수필요');
check('반복 반영은 상태·정책·기간 대여료/보증금만',
  ['차량상태', '정책코드', '18개월 대여료', '84개월 보증금', '24개월 3만km 대여료', '인수형 60개월 보증금'].every(isProductMasterLiveColumn)
  && ['차량번호', '차종코드', '차종마스터 적용값', '옵션', '주행거리'].every((x) => !isProductMasterLiveColumn(x)));
check('가격 변경 감시는 차량번호별 대여료 원자만 비교한다',
  ['1개월 대여료', '84개월 대여료', '24개월 3만km 대여료', '인수형 60개월 대여료'].every(isProductMasterRentWatchColumn)
  && ['차량상태', '정책코드', '12개월 보증금', '차종코드', '옵션'].every((x) => !isProductMasterRentWatchColumn(x)));
check('AI 최초 확정 영역은 이후 공급사 자동 재매칭에서 잠근다',
  ['공급사 입력 차명', '차종마스터 적용값', '옵션', '분류', '차종코드', '공급사 원문보존'].every(isProductMasterAiLockedColumn)
  && ['차량상태', '12개월 대여료'].every((x) => !isProductMasterAiLockedColumn(x)));

console.log('\nPASS: 상품마스터 기간·분류·소유권 규격');
