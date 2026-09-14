import { getInventorySource, type InventorySourceKind } from '../domain/inventory-source-registry';

export type SupplierSourceSpec = {
  /** 어댑터 내부 식별자 */
  code: string;
  /** 운영 문패의 공급사 코드 */
  partnerCode: string;
  name: string;
  sourceKind: InventorySourceKind;
  sourceUrl: string;
  /** 어댑터 회귀검사에 넣는 시트. 실제 원천과 다르면 PROJECTION이다. */
  spreadsheetRole: 'SOURCE' | 'PROJECTION';
  spreadsheetId: string;
  tab: string;
  financeOwner: 'SOURCE';
  pricingMode: 'STANDARD_TERMS' | 'TERM_MILEAGE_VARIANTS';
};

/**
 * 정규화 어댑터의 시트 입력 레지스트리.
 *
 * 실제 원천 위치는 inventory-source-registry.ts 하나만 정본이다. 이 파일의 시트는
 * 전용 어댑터 회귀검사/발행 대조 입력이며 홈페이지·ERP를 원천 시트로 가장하지 않는다.
 * 공급사별 변환 규칙은 lib/adapters/index.ts 의 전용 SupplierAdapter가 담당한다.
 * 원천 위치와 어댑터를 분리하되 sourceCode로 1:1 연결한다.
 */
export const SUPPLIER_SOURCES: readonly SupplierSourceSpec[] = Object.freeze([
  {
    code: 'IANKA',
    partnerCode: 'RP031',
    name: '이안카',
    sourceKind: getInventorySource('RP031').kind,
    sourceUrl: getInventorySource('RP031').sourceUrl,
    spreadsheetRole: 'SOURCE',
    spreadsheetId: '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs',
    tab: '이안카',
    financeOwner: 'SOURCE',
    pricingMode: 'STANDARD_TERMS',
  },
  {
    code: 'IRON',
    partnerCode: 'RP006',
    name: '아이언',
    sourceKind: getInventorySource('RP006').kind,
    sourceUrl: getInventorySource('RP006').sourceUrl,
    spreadsheetRole: 'PROJECTION',
    spreadsheetId: '1Xm7Nl6yK7DcPQPF6w2OI_0-sphWHFVt2u6IKrYT8S4U',
    tab: '재고',
    financeOwner: 'SOURCE',
    pricingMode: 'STANDARD_TERMS',
  },
  {
    code: 'AUTOPLUS',
    partnerCode: 'RP023',
    name: '오토플러스',
    sourceKind: getInventorySource('RP023').kind,
    sourceUrl: getInventorySource('RP023').sourceUrl,
    spreadsheetRole: 'PROJECTION',
    spreadsheetId: '1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0',
    tab: '재고',
    financeOwner: 'SOURCE',
    pricingMode: 'TERM_MILEAGE_VARIANTS',
  },
  {
    code: 'SONOGONG',
    partnerCode: 'RP012',
    name: '손오공',
    sourceKind: getInventorySource('RP012').kind,
    sourceUrl: getInventorySource('RP012').sourceUrl,
    spreadsheetRole: 'PROJECTION',
    spreadsheetId: '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA',
    // 반납형 기간별 가격과 규칙형 보증금의 원천. 렌트재고·픽업재고와 섞지 않는다.
    tab: '구독재고',
    financeOwner: 'SOURCE',
    pricingMode: 'STANDARD_TERMS',
  },
]);

export function getSupplierSourceSpec(sourceCode: string): SupplierSourceSpec {
  const code = String(sourceCode || '').trim().toUpperCase();
  const spec = SUPPLIER_SOURCES.find((v) => v.code === code || v.partnerCode === code);
  if (!spec) throw new Error(`SSOT: 원천 위치가 등록되지 않았습니다: ${code || '(blank)'}`);
  return spec;
}
