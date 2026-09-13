export type SupplierSourceSpec = {
  code: string;
  name: string;
  spreadsheetId: string;
  tab: string;
  /** 원본에서 금융 필드가 직접 소유되는지. false/미지정 값은 REFINE 단계가 채울 수 있다. */
  financeOwner: 'SOURCE';
};

/**
 * SSOT 원천 레지스트리.
 *
 * 이 파일의 항목은 "어디를 원천으로 볼 것인가"에 대한 운영 계약이다.
 * 공급사별 변환 규칙은 lib/adapters/index.ts 의 전용 SupplierAdapter가 담당한다.
 * 원천 위치와 어댑터를 분리하되 sourceCode로 1:1 연결한다.
 */
export const SUPPLIER_SOURCES: readonly SupplierSourceSpec[] = Object.freeze([
  {
    code: 'IANKA',
    name: '이안카',
    spreadsheetId: '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs',
    tab: '이안카',
    financeOwner: 'SOURCE',
  },
  {
    code: 'IRON',
    name: '아이언',
    spreadsheetId: '1Xm7Nl6yK7DcPQPF6w2OI_0-sphWHFVt2u6IKrYT8S4U',
    tab: '재고',
    financeOwner: 'SOURCE',
  },
]);

export function getSupplierSourceSpec(sourceCode: string): SupplierSourceSpec {
  const code = String(sourceCode || '').trim().toUpperCase();
  const spec = SUPPLIER_SOURCES.find((v) => v.code === code);
  if (!spec) throw new Error(`SSOT: 원천 위치가 등록되지 않았습니다: ${code || '(blank)'}`);
  return spec;
}
