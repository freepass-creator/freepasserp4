export type SupplierSheetKind = 'provided' | 'refined';
export type SupplierAdapterId = 'provided' | 'autoplus' | 'sonogong';

export type SupplierSourceSpec = {
  /** 어댑터 내부 식별자 */
  code: string;
  /** 운영 문패의 공급사 코드 */
  partnerCode: string;
  name: string;
  spreadsheetId: string;
  tab: string;
  /** 제공시트(공급사가 우리 양식에 적음) / 정제시트(원본 미러). 문패는 둘 다 이 ID를 가리킨다. */
  kind: SupplierSheetKind;
  /** 기본 provided. 병적 양식만 autoplus · sonogong. */
  adapter: SupplierAdapterId;
  financeOwner: 'SOURCE';
  pricingMode: 'STANDARD_TERMS' | 'TERM_MILEAGE_VARIANTS';
};

function source(spec: SupplierSourceSpec): SupplierSourceSpec {
  return spec;
}

/**
 * SSOT 원천 레지스트리.
 *
 * 어디를 읽나 = 문패가 가리키는 제공시트·정제시트(docs/SHEET_MAP.md · mirror-sources.ts).
 * 외부 원본 시트는 넣지 않는다 — 정제시트 미러가 옮긴 뒤의 「재고」 탭이 원천이다.
 *
 * 변환 규칙 = 기본 ProvidedSheetAdapter. 전용은 열이 표준이 아닌 두 탭뿐:
 *   오토플러스 정제시트 「재고」(기간×주행) · 손오공 제공시트 「구독재고」(반납형).
 * 손오공 「재고」는 표준 제공시트라 provided. 같은 RP012 두 탭은 code로 가른다.
 *
 * 경진렌트카(RP015) 폐기분·구버전 시트는 넣지 않는다.
 */
export const SUPPLIER_SOURCES: readonly SupplierSourceSpec[] = Object.freeze([
  source({
    code: 'GYEONGJIN', partnerCode: 'RP016', name: '경진카',
    spreadsheetId: '1j7EHDQ0r2Yp7ho-SzNWW-vK4zUNX_YAqRWernxUI_4M', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'LEADERS', partnerCode: 'RP008', name: '리더스',
    spreadsheetId: '1JSp425v3khurklA_KvaqRDcbCLyA26NTte5cQYiJBXg', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'BILINKA', partnerCode: 'PT-0026', name: '빌린카',
    spreadsheetId: '1036j-xoQtu-nzWOcfky8MmtSRrvPhRls16E7n49iFVA', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'CENTRO', partnerCode: 'RP017', name: '센트로',
    spreadsheetId: '108K5cWzDa_BBR-LNFxfvbdMc7y5_dzrngzAswuUFRCc', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'SONOGONG', partnerCode: 'RP012', name: '손오공',
    spreadsheetId: '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA',
    tab: '구독재고',
    kind: 'provided', adapter: 'sonogong', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'SONOGONG_RENT', partnerCode: 'RP012', name: '손오공',
    spreadsheetId: '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'STAR', partnerCode: 'RP033', name: '스타',
    spreadsheetId: '1_Jg1B3pxUDswxTzRc0aXyiZIngTo2hxp1obw-vfamK8', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'SA', partnerCode: 'PT-0023', name: '에스에이',
    spreadsheetId: '14zSwpuCBPMA-yHm1Hx4DYJT0ll4Hwf9cFiVQf5HIzBY', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'WOORI', partnerCode: 'RP020', name: '우리캐피탈',
    spreadsheetId: '1BXrvasCW_bzarBvWUkokE129Jm1NuwE0FNAiaXTQfNE', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'WELLIX', partnerCode: 'RP013', name: '웰릭스',
    spreadsheetId: '1T9az8BfEpM-QUllo5Sr2VxOcJBy3UvXPAvkuGy4C6hI', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'JNJ', partnerCode: 'RP030', name: '제이앤제이렌트카',
    spreadsheetId: '15roFPFPWA3M5k9HLnjgrJ7ojB_Kjc9GG6ghqmUEHs6g', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'PACIFIC', partnerCode: 'RP022', name: '퍼시픽',
    spreadsheetId: '11j_HKRHQzyGPr7a6Snnm2wgXzRgBTC8g0_UjSTJWqHQ', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'KH', partnerCode: 'RP010', name: 'KH',
    spreadsheetId: '1LSAyQ36MrUXispVFSm_8l5G-RtsxY1HF6wVUDJ8TFds', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'RENTZONE', partnerCode: 'PT-0001', name: '렌트존',
    spreadsheetId: '1_yf_MLj4AcmiAziWFFknk1w_yQBDJOe3HeiIWUuQBTM', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'SWITCHPLAN', partnerCode: 'RP014', name: '스위치플랜',
    spreadsheetId: '1I-suagPHvPoBE4dhX5yP1nmPWA6m7tDl74kTtyVfA1c', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'ECORENT', partnerCode: 'RP032', name: '에코렌트카',
    spreadsheetId: '13XdqnJKodx5pa95o66N_8ViwsZykL_DDgK0I69oo3X8', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'YEONKA', partnerCode: 'RP011', name: '연카',
    spreadsheetId: '1PpWoj3N22GRA2paO_UHDosXSDHWcLfIB4nPuITgAVlw', tab: '재고',
    kind: 'provided', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'AICAR', partnerCode: 'RP004', name: '아이카',
    spreadsheetId: '1-2ptJgwzPBVgDWMkyedjtVxcSXrNtepEQM0YgAVpYtI', tab: '재고',
    kind: 'refined', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'IRON', partnerCode: 'RP006', name: '아이언',
    spreadsheetId: '1Xm7Nl6yK7DcPQPF6w2OI_0-sphWHFVt2u6IKrYT8S4U', tab: '재고',
    kind: 'refined', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
  source({
    code: 'AUTOPLUS', partnerCode: 'RP023', name: '오토플러스',
    spreadsheetId: '1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0', tab: '재고',
    kind: 'refined', adapter: 'autoplus', financeOwner: 'SOURCE', pricingMode: 'TERM_MILEAGE_VARIANTS',
  }),
  source({
    code: 'IANKA', partnerCode: 'RP031', name: '이안카',
    spreadsheetId: '1r1EP4oMP9V2iV-G5Q3nNNBHW7ttLMNycipFkfccHvOA', tab: '재고',
    kind: 'refined', adapter: 'provided', financeOwner: 'SOURCE', pricingMode: 'STANDARD_TERMS',
  }),
]);

const IANKA_ORIGINAL_SHEET = '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs';

export function findSupplierSourceSpec(sourceCode: string): SupplierSourceSpec | undefined {
  const code = String(sourceCode || '').trim().toUpperCase();
  if (!code) return undefined;
  return SUPPLIER_SOURCES.find((v) => v.code === code || v.partnerCode === code);
}

/** 같은 문패 코드의 탭을 모두 돌려준다(손오공 구독재고 + 재고). */
export function listSupplierSourceSpecs(sourceCode: string): SupplierSourceSpec[] {
  const code = String(sourceCode || '').trim().toUpperCase();
  if (!code) return [];
  return SUPPLIER_SOURCES.filter((v) => v.code === code || v.partnerCode === code);
}

export function getSupplierSourceSpec(sourceCode: string): SupplierSourceSpec {
  const spec = findSupplierSourceSpec(sourceCode);
  if (!spec) throw new Error(`SSOT: 원천 위치가 등록되지 않았습니다: ${String(sourceCode || '').trim().toUpperCase() || '(blank)'}`);
  return spec;
}

export function findSourceHeaderRow(values: string[][], pricingMode: SupplierSourceSpec['pricingMode']): number {
  const cell = (v: unknown) => String(v ?? '').trim();
  for (let index = 0; index < Math.min(values.length, 40); index += 1) {
    const headers = values[index].map(cell);
    if (!headers.includes('차량번호') && !headers.includes('차번')) continue;
    const standard = headers.filter((header) => /^(?:단기보증|장기보증|금액보증금|\d+개월(?:\s*반납형)?)$/.test(header)).length;
    if (pricingMode === 'STANDARD_TERMS' && standard >= 4) return index;
    if (pricingMode === 'TERM_MILEAGE_VARIANTS' && headers.filter((header) => /^\d+개월\s*\d+만$/.test(header)).length >= 2) {
      return index;
    }
  }
  return -1;
}

/** 이안카 외부 원본 ID. 문패·어댑터 원천이 아니다 — 회귀 검사에서 쓰지 말라고 막아 둔다. */
export function isIankaOriginalSheet(spreadsheetId: string): boolean {
  return String(spreadsheetId || '').trim() === IANKA_ORIGINAL_SHEET;
}
