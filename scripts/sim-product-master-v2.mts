import assert from 'node:assert/strict';
import {
  PRODUCT_MASTER_V2_COLUMNS,
  PRODUCT_MASTER_V2_FROZEN_COLUMNS,
  PRODUCT_MASTER_V2_IDENTITY_COLUMNS,
  PRODUCT_MASTER_V2_MANAGEMENT_COLUMNS,
  PRODUCT_MASTER_V2_PRICE_COLUMNS,
  PRODUCT_MASTER_V2_SALES_COLUMNS,
  productMasterV2Displacement,
  productMasterV2Mileage,
  productMasterV2PriceOrderIssues,
  productMasterV2SalesPolicy,
  productMasterV2SourceValue,
} from '../lib/domain/product-master-v2';

const check = (name: string, yes: boolean) => {
  assert.ok(yes, name);
  console.log(`✓ ${name}`);
};

check('상품 왼쪽은 차번·공급사 뒤 영업자 지정 식별 순서',
  PRODUCT_MASTER_V2_IDENTITY_COLUMNS.join(',')
    === '차량번호,공급사명,제조사,모델,세부모델,세부트림,외장,내장,연식,주행거리(km),연료');
check('기간별 대여료·보증금이 옵션보다 모두 앞선다',
  PRODUCT_MASTER_V2_COLUMNS.indexOf(PRODUCT_MASTER_V2_PRICE_COLUMNS.at(-1)!)
    < PRODUCT_MASTER_V2_COLUMNS.indexOf('옵션'));
check('가격 뒤는 옵션·배기량·영업상태·구분·정책만 보인다',
  PRODUCT_MASTER_V2_SALES_COLUMNS.join(',') === '옵션,배기량(cc),차량상태,상품구분,영업정책');
check('인승·구동·파워트레인과 코드는 후미 관리영역',
  ['인승', '구동방식', '파워트레인', '정책코드', '차종코드', '공급사코드']
    .every((column) => PRODUCT_MASTER_V2_MANAGEMENT_COLUMNS.includes(column as never)));
check('차량번호·공급사 두 열만 고정', PRODUCT_MASTER_V2_FROZEN_COLUMNS === 2);
check('모든 가격쌍 및 대여료→옵션→배기량 순서에 오류 없음', productMasterV2PriceOrderIssues().length === 0);
check('공급사 원문에서 색상·주행거리 별칭을 읽는다',
  productMasterV2SourceValue(
    '원본탭: 재고 | 외부색상: 화이트 | 내부색상: 블랙 | 주행거리: 1,234km',
    ['외장색상', '외부색상'],
  ) === '화이트'
  && productMasterV2SourceValue(
    '원본탭: 재고 | 외부색상: 화이트 | 내부색상: 블랙 | 주행거리: 1,234km',
    ['주행거리'],
  ) === '1,234km');
check('주행거리는 1천 단위 축약 없이 원래 km 숫자로 저장',
  productMasterV2Mileage('999km') === 999
  && productMasterV2Mileage('1,000km') === 1_000
  && productMasterV2Mileage('1.2만km') === 12_000);
check('배기량은 cc 숫자로 통일하고 공란은 미입력',
  productMasterV2Displacement('1,598cc') === 1598
  && productMasterV2Displacement('2.5L') === 2500
  && productMasterV2Displacement('') === '미입력');
check('정책은 영업자에게 프리패스 기본명 또는 실제 코드 한 칸만 노출',
  productMasterV2SalesPolicy('(프리패스 기본)') === '프리패스 기본'
  && productMasterV2SalesPolicy('POL-0043') === 'POL-0043');

const duplicates = PRODUCT_MASTER_V2_COLUMNS.filter((column, index) =>
  PRODUCT_MASTER_V2_COLUMNS.indexOf(column) !== index);
check('개편 열 이름 중복 0', duplicates.length === 0);

console.log(`\nPASS: 상품마스터 개편 ${PRODUCT_MASTER_V2_COLUMNS.length}열 규격`);
