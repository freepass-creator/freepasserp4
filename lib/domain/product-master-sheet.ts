/**
 * 차량번호별 판매상품의 궁극 정본 — 「ERP4 차종마스터 원천대장 / 상품마스터」 규격.
 *
 * 차종마스터는 트림행키가 가리키는 차종 제원, 상품마스터는 실제 차량번호가 가리키는
 * 공급사·상태·정책·가격을 맡는다. 공급사 원문은 AI가 차량번호별 최초 1회만 매칭하며
 * 확정된 차종코드·차명·옵션을 매일 다시 추정하지 않는다.
 */

/**
 * ★코드 규격(50열) 상품마스터 탭 — ERP 일일 동기·발행기·상품마스터 갱신기가 읽는 «기계 표».
 *   2026-08-19 사장님 「상품마스터 탭을 구버전으로 돌리고 상품차종 매칭을 상품마스터로 승격」 → 탭 이름은 「상품마스터_구버전」이 됐지만
 *   ERP 입력은 여전히 이 표다(사람이 보는 「상품마스터」= 옛 「상품 차종매칭」 검토 뷰는 51열이라 ERP 가 못 읽는다 — 헤더 엄격 검사).
 *   그래서 이름이 아니라 **gid(679088240)** 로 고정해 읽는다(서버 fetchProductMasterSheet · 스크립트는 이 상수 이름으로 values 범위를 잡는다).
 */
export const PRODUCT_MASTER_TAB = '상품마스터_구버전';
export const PRODUCT_MASTER_GID = '679088240';
/** 사람이 보는 「상품마스터」(옛 「상품 차종매칭」 검토 뷰) — publish-product-vehicle-match-view-v2 가 기계 표에서 만든다. */
export const PRODUCT_MASTER_VIEW_TAB = '상품마스터';
export const PRODUCT_MASTER_MANUAL_TAB = '공급사 데이터 매뉴얼';
export const PRODUCT_MASTER_COLUMN_MAPPING_TAB = '공급사 열 매핑';
/** 차종마스터와 상품마스터가 함께 있는 ERP4 원천대장. */
export const DEFAULT_PRODUCT_MASTER_SHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';

/** 공급사별 운영 여부와 무관하게 항상 유지하는 전체 기간 축. */
export const PRODUCT_MASTER_PERIODS = [1, 6, 12, 18, 24, 36, 48, 60, 72, 84] as const;

export type ProductMasterPeriod = (typeof PRODUCT_MASTER_PERIODS)[number];
export type ProductMasterManagementState = '운영' | '검수필요' | '중지';
export type ProductMasterVerificationState = '확정' | '검수필요' | '미매칭';

/** 관리자가 원본과 정제 결과를 바로 대조하도록 사람이 보는 열을 먼저 둔다. */
export const PRODUCT_MASTER_BASE_COLUMNS = [
  '차량번호', '공급사명', '공급사 입력 차명', '차종마스터 적용값', '검증상태', '검수사유',
  '옵션', '차량상태', '분류', '관리상태', '사진링크', '입고일자',
] as const;

/** 연동 식별자는 관리자 기본 검수 동선을 방해하지 않도록 표 맨 뒤에 둔다. */
export const PRODUCT_MASTER_SYSTEM_COLUMNS = [
  '정책코드', '차종코드', '공급사코드', '최종갱신', '원천', '공급사 원문보존',
] as const;

/** AI 최초 매칭 뒤 공급사 시트가 다시 덮어쓸 수 없는 차량 정체성 영역. */
export const PRODUCT_MASTER_AI_LOCKED_COLUMNS = [
  '공급사 입력 차명', '차종마스터 적용값', '옵션', '분류', '차종코드', '공급사 원문보존',
] as const;

export const productMasterPriceColumns = PRODUCT_MASTER_PERIODS.flatMap((months) => [
  `${months}개월 대여료`,
  `${months}개월 보증금`,
]);

/**
 * 한 차량 한 줄 규격을 유지하면서도 공급사 고유 가격을 잃지 않는 후행 가격 블록.
 *
 * - 오토플러스: 기본은 연 2만km, 12개월만 연 3만km 예외다. 따라서 12개월은
 *   본 가격 블록을 쓰고 18·24·36개월의 3만km 가격만 뒤에 추가로 보존한다.
 * - 손오공 구독: 본 가격 블록은 반납형, 뒤의 인수형 블록은 36·48·60개월을 보존한다.
 *
 * 이 열들은 공급사 한 곳만을 위한 메모가 아니라, 같은 조건을 쓰는 향후 공급사도 함께
 * 사용하는 공통 데이터 규격이다.
 */
export const PRODUCT_MASTER_VARIANT_PRICE_COLUMNS = [
  '18개월 3만km 대여료', '18개월 3만km 보증금',
  '24개월 3만km 대여료', '24개월 3만km 보증금',
  '36개월 3만km 대여료', '36개월 3만km 보증금',
  '인수형 36개월 대여료', '인수형 36개월 보증금',
  '인수형 48개월 대여료', '인수형 48개월 보증금',
  '인수형 60개월 대여료', '인수형 60개월 보증금',
] as const;

export const PRODUCT_MASTER_COLUMNS = [
  ...PRODUCT_MASTER_BASE_COLUMNS,
  ...productMasterPriceColumns,
  ...PRODUCT_MASTER_VARIANT_PRICE_COLUMNS,
  ...PRODUCT_MASTER_SYSTEM_COLUMNS,
] as const;

/** 손오공 구독: 기간별 월대여료 × 약정연수. */
export function sonogongSubscriptionDeposit(rent: unknown, months: unknown): number {
  const monthlyRent = Number(rent);
  const termMonths = Number(months);
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) return 0;
  if (!Number.isFinite(termMonths) || termMonths < 12 || termMonths % 12 !== 0) return 0;
  return monthlyRent * (termMonths / 12);
}

/**
 * 오토플러스 공지사항 보증금표.
 * 국산은 12개월 이상 ×2, 수입은 12개월 ×3·18개월 이상 ×6이다.
 */
export function autoplusDeposit(input: {
  rent?: unknown;
  months?: unknown;
  origin?: unknown;
}): number {
  const rent = Number(input.rent);
  const months = Number(input.months);
  const origin = String(input.origin ?? '').trim().toLowerCase();
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(months) || months < 12) return 0;
  if (origin === '국산' || origin === 'domestic') return rent * 2;
  if (origin === '수입' || origin === 'import' || origin === 'imported') {
    return rent * (months >= 18 ? 6 : 3);
  }
  return 0;
}

const S = (value: unknown) => String(value ?? '').trim();

const meaningfulSourceValue = (value: unknown): string => {
  const text = S(value);
  return /^(?:-|―|—|미입력|미제공|null|undefined)$/i.test(text) ? '' : text;
};

const columnLabel = (index: number): string => {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

/**
 * 차량번호가 있는 공급사 원본 행을 일부 열만 골라 버리지 않고 통째로 보존한다.
 *
 * 빈 헤더도 열 문자를 붙여 유실하지 않으며, 셀 안의 `|`는 구분자와 충돌하지 않게
 * 슬래시로 바꾼다. 가격·보험·메모도 원본 증빙이므로 제외하지 않는다.
 */
export function productMasterSourceRowInfo(input: {
  tab?: unknown;
  headers: readonly unknown[];
  row: readonly unknown[];
}): string {
  const duplicateCounts = new Map<string, number>();
  const parts = S(input.tab) ? [`원본탭: ${S(input.tab)}`] : [];
  const width = Math.max(input.headers.length, input.row.length);
  for (let index = 0; index < width; index += 1) {
    const value = meaningfulSourceValue(input.row[index]);
    if (!value) continue;
    const base = S(input.headers[index]) || `열 ${columnLabel(index)}`;
    const count = (duplicateCounts.get(base) || 0) + 1;
    duplicateCounts.set(base, count);
    const label = count === 1 ? base : `${base}(${columnLabel(index)})`;
    parts.push(`${label}: ${value.replace(/\s*\|\s*/g, ' / ')}`);
  }
  return parts.join(' | ');
}

/** 차종코드가 가리키는 모델명·파워트레인·세부트림만 사람이 보는 한 칸으로 합친다. */
export function productMasterVehicleName(parts: {
  maker?: unknown;
  model?: unknown;
  subModel?: unknown;
  powertrain?: unknown;
  trim?: unknown;
}): string {
  const modelName = S(parts.subModel) || S(parts.model);
  return [modelName, parts.powertrain, parts.trim]
    .map(S)
    .filter(Boolean)
    .join(' · ');
}

/** 정규화 제조사와 공급사 원문을 한 칸에 보존하되 둘의 출처를 섞지 않는다. */
export function productMasterSupplierInfo(input: {
  maker?: unknown;
  rawInfo?: unknown;
}): string {
  const maker = S(input.maker) || '미입력';
  const rawInfo = S(input.rawInfo)
    .replace(/^제조사\s*:[^|]*\|\s*/, '')
    .replace(/^차명\s*:/, '공급사 차명:');
  return [`제조사: ${maker}`, rawInfo].filter(Boolean).join(' | ');
}

/**
 * 관리자 대조열에는 공급사가 실제로 준 차명과 차종 판별 신호를 함께 보여 준다.
 * 원본 행 전체는 `공급사 원문보존`에 남기고, 여기서는 제조사·차종·모델/트림·연료·
 * 배기량·연식/최초등록만 추려 차종마스터 적용값과 바로 비교할 수 있게 한다.
 */
export function productMasterSupplierVehicleName(rawInfo: unknown): string {
  const text = S(rawInfo);
  if (!text.includes(':')) return text;

  const pairs = text.split('|').map((part) => {
    const match = part.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
    return match ? { label: S(match[1]), value: meaningfulSourceValue(match[2]) } : null;
  }).filter((pair): pair is { label: string; value: string } => Boolean(pair?.value));

  const values = (pattern: RegExp) => pairs
    .filter(({ label }) => pattern.test(label.replace(/\s+/g, '')))
    .map(({ value }) => value);
  const compact = (value: string) => value.replace(/[\s·._()\[\]-]+/g, '').toLowerCase();
  const identity: string[] = [];
  const addIdentity = (value: string) => {
    const normalized = compact(value);
    if (!normalized) return;
    const covering = identity.findIndex((item) => compact(item).includes(normalized));
    if (covering >= 0) return;
    const covered = identity.findIndex((item) => normalized.includes(compact(item)));
    if (covered >= 0) identity.splice(covered, 1, value);
    else identity.push(value);
  };

  values(/^(?:공급사)?(?:제조사|메이커|브랜드)$/i).forEach(addIdentity);
  const contextNames = values(/^(?:공급사)?차종(?:분류)?$/i);
  const suppliedNames = values(/^(?:공급사)?(?:차명(?:\([^)]*\))?|차량명|상품명|모델명(?:\([^)]*\))?)$/i);
  const fallbackNames = values(/^(?:모델|세부모델|트림)$/i);
  [...contextNames, ...(suppliedNames.length ? suppliedNames : fallbackNames)].forEach(addIdentity);

  const result = [...identity];
  const joined = () => compact(result.join(' '));
  const addSignal = (label: string, value: string) => {
    if (!value || joined().includes(compact(value))) return;
    result.push(label ? `${label} ${value}` : value);
  };
  values(/^(?:연료|유종)$/i).slice(0, 1).forEach((value) => addSignal('', value));
  values(/^(?:배기량|배기)$/i).slice(0, 1).forEach((value) => addSignal('배기', value));
  values(/^(?:연식|모델연도|my)$/i).slice(0, 1).forEach((value) => addSignal('연식', value));
  values(/^(?:최초등록|최초등록일)$/i).slice(0, 1).forEach((value) => addSignal('최초등록', value));
  values(/^(?:구동|구동방식|드라이브트레인)$/i).slice(0, 1).forEach((value) => addSignal('', value));
  values(/^(?:인승|승차정원)$/i).slice(0, 1).forEach((value) => addSignal('', value));

  return result.join(' · ') || text.split('|').map(S).find(Boolean) || '';
}

/** 미매칭 행에 정제 차명을 써서 확정처럼 보이게 하지 않는다. */
export function productMasterVerification(input: {
  trimCode?: unknown;
  masterFound: boolean;
  masterManagement?: unknown;
  masterVerification?: unknown;
}): ProductMasterVerificationState {
  if (!S(input.trimCode) || !input.masterFound) return '미매칭';
  return S(input.masterManagement) === '확정' && S(input.masterVerification) === '확정'
    ? '확정'
    : '검수필요';
}

export function productMasterManagement(input: {
  providerCode?: unknown;
  trimCode?: unknown;
  masterFound: boolean;
  vehicleStatus?: unknown;
  reviewReasons?: unknown[];
}): ProductMasterManagementState {
  if (/판매완료|삭제|종료/.test(S(input.vehicleStatus))) return '중지';
  if (!S(input.providerCode) || !S(input.trimCode) || !input.masterFound || input.reviewReasons?.length) {
    return '검수필요';
  }
  return '운영';
}

/** 차량번호별 대여료 변경 감시 대상. 차종 재매칭과 무관한 숫자 원자만 허용한다. */
export function isProductMasterRentWatchColumn(column: unknown): boolean {
  const name = S(column).replace(/\s+/g, '');
  return /^\d+개월대여료$/.test(name)
    || /^(?:18|24|36)개월3만km대여료$/.test(name)
    || /^인수형(?:36|48|60)개월대여료$/.test(name);
}

export function isProductMasterAiLockedColumn(column: unknown): boolean {
  const name = S(column).replace(/\s+/g, '');
  return PRODUCT_MASTER_AI_LOCKED_COLUMNS.some((item) => item.replace(/\s+/g, '') === name);
}

/**
 * 별도 재고·계약 운영 레이어에서 반복 반영할 수 있는 칸의 허용목록.
 * 이 허용은 차종 매칭을 다시 실행해도 된다는 뜻이 아니다.
 */
export function isProductMasterLiveColumn(column: unknown): boolean {
  const name = S(column).replace(/\s+/g, '');
  return name === '차량상태'
    || name === '정책코드'
    || /^\d+개월(?:대여료|보증금)$/.test(name)
    || /^(?:18|24|36)개월3만km(?:대여료|보증금)$/.test(name)
    || /^인수형(?:36|48|60)개월(?:대여료|보증금)$/.test(name);
}
