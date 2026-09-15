export type InventorySourceKind = 'google_sheet' | 'website' | 'erp_api';

export type InventorySourceSpec = {
  partnerCode: string;
  name: string;
  kind: InventorySourceKind;
  sourceUrl: string;
  adapterId: string;
  spreadsheetId?: string;
  sharedWith?: readonly string[];
  projection?: { spreadsheetId: string; tabs?: readonly string[] };
  channels: readonly string[];
  hold?: readonly string[];
};

export type PolicySourceSpec = {
  partnerCode: string;
  spreadsheetId: string;
  sourceUrl: string;
  tabTitle: '운영정책';
};

const sheet = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/**
 * 프리패스 차량 재고의 단일 원천 레지스트리.
 *
 * 아이언·오토플러스는 자사 홈페이지, 손오공은 자사 ERP API,
 * 아이카·이안카는 각사 원본 시트를 정본으로 사용한다.
 * `partner.sheet_url`, 공급사 허브, 정제시트는 소비용 사본이며 이 표를 덮지 못한다.
 */
export const INVENTORY_SOURCES: readonly InventorySourceSpec[] = Object.freeze([
  { partnerCode: 'RP004', name: '아이카', kind: 'google_sheet', adapterId: 'aica', spreadsheetId: '1LqWVs2o1-wpPqFiYkOjcQldmIXqtBMKYp0A1SKEir5w', sourceUrl: sheet('1LqWVs2o1-wpPqFiYkOjcQldmIXqtBMKYp0A1SKEir5w'), projection: { spreadsheetId: '1-2ptJgwzPBVgDWMkyedjtVxcSXrNtepEQM0YgAVpYtI' }, channels: ['inventory', 'policy'] },
  { partnerCode: 'RP006', name: '아이언', kind: 'website', adapterId: 'iron', sourceUrl: 'https://www.ironrentcar.com', projection: { spreadsheetId: '1Xm7Nl6yK7DcPQPF6w2OI_0-sphWHFVt2u6IKrYT8S4U', tabs: ['재고'] }, channels: ['new', 'used'] },
  { partnerCode: 'RP008', name: '리더스', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1JSp425v3khurklA_KvaqRDcbCLyA26NTte5cQYiJBXg', sourceUrl: sheet('1JSp425v3khurklA_KvaqRDcbCLyA26NTte5cQYiJBXg'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP010', name: 'KH', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1LSAyQ36MrUXispVFSm_8l5G-RtsxY1HF6wVUDJ8TFds', sourceUrl: sheet('1LSAyQ36MrUXispVFSm_8l5G-RtsxY1HF6wVUDJ8TFds'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP011', name: '연카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1PpWoj3N22GRA2paO_UHDosXSDHWcLfIB4nPuITgAVlw', sourceUrl: sheet('1PpWoj3N22GRA2paO_UHDosXSDHWcLfIB4nPuITgAVlw'), channels: ['inventory', 'policy'] },
  // ★hold 해소(2026-09-15 실측, lib/domain/sonokong-product-kind.ts): API에 「렌트」 전용 버킷은 없다.
  //   버킷은 TCAR_EXTERNAL·SON_NO_KONG 둘뿐(전수 296건 = 244+52). SON_NO_KONG 안에 렌트(중고렌트)가
  //   섞여 있고, 렌트 여부는 차량번호(하·허·호 = 한국 렌터카 번호판 글자)로 가른다 — 원천의 `중고`
  //   플래그는 사용감을 뜻할 뿐 렌트 등록 여부와 무관했다(자세한 경위는 그 파일 주석).
  { partnerCode: 'RP012', name: '손오공', kind: 'erp_api', adapterId: 'sonogong', sourceUrl: 'https://sokrc.com/api', projection: { spreadsheetId: '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA', tabs: ['구독재고', '픽업재고'] }, channels: ['LOW_SONOKONG', 'LOW_TCAR'] },
  { partnerCode: 'RP013', name: '웰릭스', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1T9az8BfEpM-QUllo5Sr2VxOcJBy3UvXPAvkuGy4C6hI', sourceUrl: sheet('1T9az8BfEpM-QUllo5Sr2VxOcJBy3UvXPAvkuGy4C6hI'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP014', name: '스위치플랜', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1I-suagPHvPoBE4dhX5yP1nmPWA6m7tDl74kTtyVfA1c', sourceUrl: sheet('1I-suagPHvPoBE4dhX5yP1nmPWA6m7tDl74kTtyVfA1c'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP015', name: '경진렌트카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1j7EHDQ0r2Yp7ho-SzNWW-vK4zUNX_YAqRWernxUI_4M', sourceUrl: sheet('1j7EHDQ0r2Yp7ho-SzNWW-vK4zUNX_YAqRWernxUI_4M'), sharedWith: ['RP016'], channels: ['inventory', 'policy'] },
  { partnerCode: 'RP016', name: '경진카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1j7EHDQ0r2Yp7ho-SzNWW-vK4zUNX_YAqRWernxUI_4M', sourceUrl: sheet('1j7EHDQ0r2Yp7ho-SzNWW-vK4zUNX_YAqRWernxUI_4M'), sharedWith: ['RP015'], channels: ['inventory', 'policy'] },
  { partnerCode: 'RP017', name: '센트로', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '108K5cWzDa_BBR-LNFxfvbdMc7y5_dzrngzAswuUFRCc', sourceUrl: sheet('108K5cWzDa_BBR-LNFxfvbdMc7y5_dzrngzAswuUFRCc'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP018', name: '스타', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1_Jg1B3pxUDswxTzRc0aXyiZIngTo2hxp1obw-vfamK8', sourceUrl: sheet('1_Jg1B3pxUDswxTzRc0aXyiZIngTo2hxp1obw-vfamK8'), sharedWith: ['RP033'], channels: ['inventory', 'policy'] },
  { partnerCode: 'RP020', name: '우리캐피탈렌터카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1BXrvasCW_bzarBvWUkokE129Jm1NuwE0FNAiaXTQfNE', sourceUrl: sheet('1BXrvasCW_bzarBvWUkokE129Jm1NuwE0FNAiaXTQfNE'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP021', name: '빌린카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1036j-xoQtu-nzWOcfky8MmtSRrvPhRls16E7n49iFVA', sourceUrl: sheet('1036j-xoQtu-nzWOcfky8MmtSRrvPhRls16E7n49iFVA'), sharedWith: ['PT-0026'], channels: ['inventory', 'policy'] },
  { partnerCode: 'RP022', name: '퍼시픽', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '11j_HKRHQzyGPr7a6Snnm2wgXzRgBTC8g0_UjSTJWqHQ', sourceUrl: sheet('11j_HKRHQzyGPr7a6Snnm2wgXzRgBTC8g0_UjSTJWqHQ'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP023', name: '오토플러스', kind: 'website', adapterId: 'autoplus-reborn', sourceUrl: 'https://www.reborncar.co.kr', projection: { spreadsheetId: '1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0', tabs: ['재고'] }, channels: ['rent'], hold: ['차량별 선택옵션 여부가 입증되지 않은 공통 옵션 목록은 원자 옵션으로 쓰지 않음'] },
  { partnerCode: 'RP030', name: 'J&J렌트카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '15roFPFPWA3M5k9HLnjgrJ7ojB_Kjc9GG6ghqmUEHs6g', sourceUrl: sheet('15roFPFPWA3M5k9HLnjgrJ7ojB_Kjc9GG6ghqmUEHs6g'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP031', name: '이안카', kind: 'google_sheet', adapterId: 'ianka', spreadsheetId: '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs', sourceUrl: sheet('1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs'), projection: { spreadsheetId: '1r1EP4oMP9V2iV-G5Q3nNNBHW7ttLMNycipFkfccHvOA', tabs: ['재고'] }, channels: ['inventory', 'policy'] },
  { partnerCode: 'RP032', name: '에코렌트카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '13XdqnJKodx5pa95o66N_8ViwsZykL_DDgK0I69oo3X8', sourceUrl: sheet('13XdqnJKodx5pa95o66N_8ViwsZykL_DDgK0I69oo3X8'), channels: ['inventory', 'policy'] },
  { partnerCode: 'RP033', name: '스카이렌트카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1_Jg1B3pxUDswxTzRc0aXyiZIngTo2hxp1obw-vfamK8', sourceUrl: sheet('1_Jg1B3pxUDswxTzRc0aXyiZIngTo2hxp1obw-vfamK8'), sharedWith: ['RP018'], channels: ['inventory', 'policy'] },
  { partnerCode: 'RP034', name: '마음카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1uq22EKUeEgNK_C3nJyFSxxFWwlttog0Qs-NrNZZhc-s', sourceUrl: sheet('1uq22EKUeEgNK_C3nJyFSxxFWwlttog0Qs-NrNZZhc-s'), channels: ['inventory', 'policy'] },
  { partnerCode: 'PT-0001', name: '렌트존', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1_yf_MLj4AcmiAziWFFknk1w_yQBDJOe3HeiIWUuQBTM', sourceUrl: sheet('1_yf_MLj4AcmiAziWFFknk1w_yQBDJOe3HeiIWUuQBTM'), channels: ['inventory', 'policy'] },
  { partnerCode: 'PT-0023', name: 'SA렌터카', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '14zSwpuCBPMA-yHm1Hx4DYJT0ll4Hwf9cFiVQf5HIzBY', sourceUrl: sheet('14zSwpuCBPMA-yHm1Hx4DYJT0ll4Hwf9cFiVQf5HIzBY'), channels: ['inventory', 'policy'] },
  { partnerCode: 'PT-0026', name: '엘씨', kind: 'google_sheet', adapterId: 'generic-sheet', spreadsheetId: '1036j-xoQtu-nzWOcfky8MmtSRrvPhRls16E7n49iFVA', sourceUrl: sheet('1036j-xoQtu-nzWOcfky8MmtSRrvPhRls16E7n49iFVA'), sharedWith: ['RP021'], channels: ['inventory', 'policy'] },
]);

const BY_CODE = new Map(INVENTORY_SOURCES.map((source) => [source.partnerCode, source]));

export function getInventorySource(partnerCode: string): InventorySourceSpec {
  const code = String(partnerCode || '').trim().toUpperCase();
  const source = BY_CODE.get(code);
  if (!source) throw new Error(`SSOT: 등록되지 않은 재고 원천입니다: ${code || '(blank)'}`);
  return source;
}

export function inventorySourceLocationCount(): number {
  return new Set(INVENTORY_SOURCES.map((source) => source.sourceUrl)).size;
}

/**
 * 정책 원문 위치. 공급사가 직접 쓰는 프리패스 제공시트의 「운영정책」 탭이 정본이다.
 * 외부 원본 시트를 재고 정본으로 쓰는 아이카·이안카와 홈페이지/API 공급사는
 * projection 시트가 정책 입력 원천이다. 재고 원천과 정책 원천을 같은 주소라고 추정하지 않는다.
 */
export function getPolicySource(partnerCode: string): PolicySourceSpec {
  const source = getInventorySource(partnerCode);
  const spreadsheetId = source.kind === 'google_sheet' && source.channels.includes('policy')
    && source.spreadsheetId && !source.projection
    ? source.spreadsheetId
    : source.projection?.spreadsheetId;
  if (!spreadsheetId) throw new Error(`SSOT: 정책 원천 위치가 등록되지 않았습니다: ${source.partnerCode}`);
  return { partnerCode: source.partnerCode, spreadsheetId, sourceUrl: sheet(spreadsheetId), tabTitle: '운영정책' };
}

export function policySourceLocationCount(): number {
  return new Set(INVENTORY_SOURCES.map((source) => getPolicySource(source.partnerCode).spreadsheetId)).size;
}

export function matchesSharedSourceTab(sourceName: string, tabName: string): boolean {
  const key = (value: string) => String(value || '')
    .replace(/주식회사|\(주\)|㈜|재고/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  const source = key(sourceName);
  const tab = key(tabName);
  return Boolean(source && tab && (source.includes(tab) || tab.includes(source)));
}
