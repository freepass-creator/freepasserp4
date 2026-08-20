import {
  PRODUCT_MASTER_PERIODS,
  PRODUCT_MASTER_VARIANT_PRICE_COLUMNS,
  productMasterPriceColumns,
} from '@/lib/domain/product-master-sheet';

/**
 * 영업자가 왼쪽에서 차량을 식별하고 곧바로 가격을 보는 상품마스터 개편안.
 *
 * 현행 `상품마스터` A:AZ는 ERP가 엄격하게 읽고 있으므로 이 규격은 별도 탭에서
 * 검증한 뒤 전환한다. 공급사 원문·내부 코드는 버리지 않고 후미 관리영역에 둔다.
 */
export const PRODUCT_MASTER_V2_TAB = '상품마스터_개편';

export const PRODUCT_MASTER_V2_IDENTITY_COLUMNS = [
  '차량번호', '공급사명',
  '제조사', '모델', '세부모델', '세부트림',
  '외장', '내장', '연식', '주행거리(km)', '연료',
] as const;

export const PRODUCT_MASTER_V2_PRICE_COLUMNS = [
  ...productMasterPriceColumns,
  ...PRODUCT_MASTER_VARIANT_PRICE_COLUMNS,
] as const;

/** 대여료 뒤에는 영업자가 상품을 설명할 때 필요한 값만 둔다. */
export const PRODUCT_MASTER_V2_SALES_COLUMNS = [
  '옵션', '배기량(cc)', '차량상태', '상품구분', '영업정책',
] as const;

/** 검수·연동용 값은 영업 동선을 방해하지 않도록 표 맨 뒤에 보존한다. */
export const PRODUCT_MASTER_V2_MANAGEMENT_COLUMNS = [
  '검증상태', '검수사유', '관리상태',
  '사진링크', '입고일자',
  '인승', '구동방식', '파워트레인',
  '정책코드', '차종코드', '공급사코드',
  '최종갱신', '원천', '공급사 원문보존',
] as const;

export const PRODUCT_MASTER_V2_COLUMNS = [
  ...PRODUCT_MASTER_V2_IDENTITY_COLUMNS,
  ...PRODUCT_MASTER_V2_PRICE_COLUMNS,
  ...PRODUCT_MASTER_V2_SALES_COLUMNS,
  ...PRODUCT_MASTER_V2_MANAGEMENT_COLUMNS,
] as const;

export const PRODUCT_MASTER_V2_FROZEN_COLUMNS = 2;
export const PRODUCT_MASTER_V2_FROZEN_ROWS = 1;

export type ProductMasterV2Column = (typeof PRODUCT_MASTER_V2_COLUMNS)[number];

const S = (value: unknown) => String(value ?? '').trim();
const labelKey = (value: unknown) => S(value)
  .normalize('NFC')
  .toLowerCase()
  .replace(/\([^)]*\)/g, '')
  .replace(/[\s_·./-]+/g, '');

export function productMasterV2ColumnIndex(column: ProductMasterV2Column): number {
  return PRODUCT_MASTER_V2_COLUMNS.indexOf(column);
}

export function productMasterV2SourcePairs(rawInfo: unknown): Array<{ label: string; value: string }> {
  return S(rawInfo).split('|').flatMap((part) => {
    const match = part.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
    const value = S(match?.[2]);
    return match && value ? [{ label: S(match[1]), value }] : [];
  });
}

export function productMasterV2SourceValue(
  rawInfo: unknown,
  aliases: readonly string[],
): string {
  const wanted = new Set(aliases.map(labelKey));
  return productMasterV2SourcePairs(rawInfo)
    .find(({ label }) => wanted.has(labelKey(label)))?.value || '';
}

export const PRODUCT_MASTER_V2_SOURCE_ALIASES = {
  maker: ['제조사(정제)', '제조사', '메이커', '브랜드'],
  model: ['모델'],
  subModel: ['세부모델'],
  trim: ['세부트림', '트림'],
  exterior: ['외장색상', '외부색상', '외장', '외장컬러'],
  interior: ['내장색상', '내부색상', '내장', '내장컬러'],
  year: ['연식', '모델연도', 'MY'],
  mileage: ['주행거리', '누적주행거리', '키로수', 'km'],
  fuel: ['연료(정제)', '연료', '유종'],
  displacement: ['배기량(정제)', '배기량', '배기'],
  seats: ['인승', '승차정원'],
  drivetrain: ['구동방식', '구동', '드라이브트레인'],
} as const;

export function productMasterV2Display(value: unknown): string | number {
  return S(value) || '미입력';
}

/** 시트에는 정렬·필터 가능한 실제 km 숫자를 저장하고, 없으면 미입력으로 보인다. */
export function productMasterV2Mileage(value: unknown): number | '미입력' {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  const text = S(value).toLowerCase().replace(/,/g, '');
  if (!text) return '미입력';
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(만)?\s*(?:km|㎞|키로)?/i);
  if (!match) return '미입력';
  const parsed = Number(match[1]) * (match[2] ? 10_000 : 1);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : '미입력';
}

/** 차종마스터 cc를 우선하고, 공급사 값은 명시 단위가 해석 가능한 경우에만 숫자로 쓴다. */
export function productMasterV2Displacement(value: unknown): number | '미입력' {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value < 20 ? value * 1_000 : value);
  }
  const text = S(value).toLowerCase().replace(/,/g, '');
  if (!text) return '미입력';
  const match = text.match(/(\d+(?:\.\d+)?)\s*(cc|㎤|l|리터)?/i);
  if (!match) return '미입력';
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return '미입력';
  if (match[2] === 'l' || match[2] === '리터' || parsed < 20) return Math.round(parsed * 1_000);
  return Math.round(parsed);
}

export function productMasterV2SalesPolicy(policyCode: unknown): string {
  const code = S(policyCode);
  if (!code || /프리패스\s*기본/.test(code)) return '프리패스 기본';
  return code;
}

export function productMasterV2PriceOrderIssues(): string[] {
  const issues: string[] = [];
  for (const months of PRODUCT_MASTER_PERIODS) {
    const rent = productMasterV2ColumnIndex(`${months}개월 대여료`);
    if (rent < 0 || PRODUCT_MASTER_V2_COLUMNS[rent + 1] !== `${months}개월 보증금`) {
      issues.push(`${months}개월 가격쌍 순서`);
    }
  }
  const option = productMasterV2ColumnIndex('옵션');
  const displacement = productMasterV2ColumnIndex('배기량(cc)');
  const lastPrice = productMasterV2ColumnIndex('인수형 60개월 보증금');
  if (!(lastPrice < option && option < displacement)) issues.push('대여료 → 옵션 → 배기량 순서');
  return issues;
}
