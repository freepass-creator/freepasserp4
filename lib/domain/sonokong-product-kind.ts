export type SonokongProductKind = '중고렌트' | '오공구독' | '픽업구독' | '중고구독' | '';
export type SonokongSalesGroup = '손오공상품' | '픽업구독' | '';

export const SONOKONG_CLASSIFICATION_SCHEMA = 'sonokong-product-v1' as const;

export type SonokongProductClassification = {
  schema: typeof SONOKONG_CLASSIFICATION_SCHEMA;
  /** 손오공 API를 요청할 때 사용한 원천 버킷. */
  source_bucket: string;
  /** 손오공 API 응답이 돌려준 재고 버킷. */
  response_bucket: string;
  /** ERP 계약·가격·검색이 쓰는 세부 상품구분. */
  product_type: SonokongProductKind;
  /** 판매시트와 손오공 화면의 고정 상품 자리. */
  sales_group: SonokongSalesGroup;
};

/** 원천 버킷 → Firestore에 그대로 보존할 명시적 상품 분류. */
export function sonokongProductClassification(input: {
  sourceBucket?: unknown;
  responseBucket?: unknown;
  used?: unknown;
}): SonokongProductClassification {
  const source = String(input.sourceBucket || '').trim();
  const response = String(input.responseBucket || '').trim();
  const productType: SonokongProductKind = source === 'LOW_SONOKONG_DAILY' ? '중고렌트'
    : source === 'LOW_SONOKONG' ? '오공구독'
      : source === 'LOW_TCAR' ? '픽업구독'
        : response === 'TCAR_EXTERNAL' ? '픽업구독'
          : response === 'SON_NO_KONG' ? '오공구독'
            : input.used === true ? '중고구독' : '';
  const salesGroup: SonokongSalesGroup = productType === '픽업구독' ? '픽업구독'
    : productType === '중고렌트' || productType === '오공구독' ? '손오공상품' : '';
  return {
    schema: SONOKONG_CLASSIFICATION_SCHEMA,
    source_bucket: source,
    response_bucket: response,
    product_type: productType,
    sales_group: salesGroup,
  };
}

/** 요청한 손오공 화면 버킷이 상품 갈래의 정본이다. */
export function sonokongProductKind(input: {
  sourceBucket?: unknown;
  responseBucket?: unknown;
  used?: unknown;
}): SonokongProductKind {
  return sonokongProductClassification(input).product_type;
}

export function sonokongUsesErpRentalDeposit(input: {
  sourceBucket?: unknown;
  responseBucket?: unknown;
}): boolean {
  return sonokongProductClassification(input).product_type === '중고렌트';
}

/** 손오공 중고렌트 보증금은 ERP 상세 estimates의 LOW/RENT 값을 그대로 쓴다. */
export function sonokongErpRentalDeposit(input: {
  sourceBucket?: unknown;
  estimateType: 'RENT_RETURN' | 'RENT_BUYOUT';
  deposits?: Record<string, unknown> | null;
}): number | null {
  if (!sonokongUsesErpRentalDeposit({ sourceBucket: input.sourceBucket })) return null;
  const raw = input.deposits?.[input.estimateType];
  if (raw == null || raw === '') return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** 구독/픽업만 규칙 문구를 쓰며 중고렌트는 ERP 숫자를 쓴다. */
export function sonokongDepositNote(input: { sourceBucket?: unknown; responseBucket?: unknown }): string {
  return sonokongUsesErpRentalDeposit(input) ? '' : sonokongDepositRuleText();
}

/** Firestore 명시 분류를 우선하고, 과거 문서는 product_type으로만 하위호환한다. */
export function sonokongSalesGroup(atom: Record<string, unknown>): SonokongSalesGroup {
  const explicit = atom.sonokong_classification as Partial<SonokongProductClassification> | undefined;
  if (explicit?.schema === SONOKONG_CLASSIFICATION_SCHEMA) {
    if (explicit.sales_group === '손오공상품' || explicit.sales_group === '픽업구독') return explicit.sales_group;
    const nestedType = String(explicit.product_type || '').trim();
    if (nestedType === '픽업구독') return '픽업구독';
    if (nestedType === '중고렌트' || nestedType === '오공구독') return '손오공상품';
  }
  const productType = String(atom.product_type || '').trim();
  if (productType === '픽업구독') return '픽업구독';
  if (productType === '중고렌트' || productType === '오공구독') return '손오공상품';
  return '';
}
import { sonokongDepositRuleText } from './sales-published-tabs';
