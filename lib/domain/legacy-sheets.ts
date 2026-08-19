/**
 * **옛 우리 시트(구버전) 명부** — 지금은 어디에서도 읽지 않는 시트. 이름 앞에 「[구버전·폐기]」를 붙이고 첫 탭에 「⚠ 구버전 — 안 씀」 안내를 둔다.
 *
 * ★사장님 2026-08-19 — 「연동중 이런식으로 (표기하고), 구버전 우리 거는 폐기 또는 구버전이라고 안 쓴다고 해 주고, 외부시트는 원본만 알면 되고」
 *   · 여기 적힌 시트는 문패·판매시트·상품마스터·ERP 어느 것도 읽지 않는다(2026-08-18 흡수 끝, absorb-legacy-sheet).
 *   · 공급사 소유 원본(오토플러스·이안카·아이카 시트)은 **여기 적지 않는다** — 외부 시트는 이름을 건드리지 않고 원본으로만 안다(mirror-sources).
 *   · 실측 2026-08-19: 손오공·우리캐피탈·렌트존 옛 시트에 문패 전환(08-18 17:31) 직전까지 공급사가 적고 있었다 → 표기가 없으면 옛 시트로 돌아간다.
 * ★쓰는 곳: scripts/retire-legacy-sheets.mts(이름·안내 탭) · scripts/publish-sheet-map-tab.mts(시트 명부) · sheet-identity(「이 시트는」).
 * ★되돌릴 옛 이름은 `name` 그대로다(tmp/retire-legacy-sheets-log.txt 에도 남는다).
 */
export type LegacySheetKind = '옛 제공시트' | '옛 문패' | '옛 판매시트' | '옛 공급사 상품리스트';
export type LegacySheet = {
  id: string;
  /** 폐기 표기 전 원래 이름 */
  name: string;
  kind: LegacySheetKind;
  /** 공급사코드(제공시트일 때) — 대체 시트는 문패에서 이 코드로 찾는다 */
  code?: string;
  /** 대체 시트 ID(문패로 못 찾는 종류일 때) */
  replacedBy?: string;
  owner: string;
  /** 문패가 이 시트를 그만 읽은 날(KST) */
  retiredOn: string;
  note?: string;
};

export const HUB_CODE_SHEET_ID = '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';   // 문패 「공급사시트정리」(코드가 읽는다)
export const HUB_HUMAN_SHEET_ID = '1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w';  // 허브 「프리패스 공급사시트 정리」(사람이 본다 · ERP sheet_url 동기)
export const SALES_SHEET_ID = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';      // 판매시트 「프리패스 상품리스트」
export const MASTER_SHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';     // 원천대장 「ERP4 차종마스터 원천대장」

export const LEGACY_SHEETS: LegacySheet[] = [
  // 문패가 2026-08-14 21:10 에 [제공] 시트로 넘어간 곳(tmp/hub-switch-log.txt)
  { id: '17ptJasUHfkTsTAPV7n09biOUxwON69ga_boY7Lj1YQI', name: '퍼시픽', kind: '옛 제공시트', code: 'RP022', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-14' },
  { id: '1uxcBiaf9YUokWY6pA6cSQF5dWC_NhAbWzch6rFNPxks', name: '경진렌트카', kind: '옛 제공시트', code: 'RP015', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-14' },
  { id: '1zglJo10nM_oilYzLdk9XAe3SMVPkVf5fd8a3vF1yXHo', name: '경진카', kind: '옛 제공시트', code: 'RP016', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-14' },
  { id: '1BLoZxJ_5n0N9P4S4tkw6otj0trqGSDpe35jRT9DVs0k', name: 'KH', kind: '옛 제공시트', code: 'RP010', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-14' },
  { id: '1iVCesNhymbW8SsvHU0MysRmsVHGb2PtXzA5c30xqm0I', name: '센트로', kind: '옛 제공시트', code: 'RP017', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-14' },
  { id: '1Iroh8oZFMqCgTQHwNXp0gOxa-SYOCOgqwcwPCgJzJaA', name: '빌린카', kind: '옛 제공시트', code: 'RP021', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-14' },
  { id: '1tVEVEZY-6e9y2Gz89eXnIRvsScFv7Y7sAiWw7hr_OFY', name: 'J&J렌트카', kind: '옛 제공시트', code: 'RP030', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-14' },
  // 2026-08-15
  { id: '1hfXngq7GcXRF2u7OhmH39PqERQK34r6hq9dfSoI2Sy0', name: '웰릭스', kind: '옛 제공시트', code: 'RP013', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-15' },
  // 2026-08-18 15:27 (정제시트 전환) — 아이언은 홈페이지가 정본, 이 시트는 보관용이었다
  { id: '1fUC8sok_XKmpgDAvRRi6HEbeAkY-Rbvrt-th8j8G7Ms', name: '아이언', kind: '옛 제공시트', code: 'RP006', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-18', note: '아이언은 ironrentcar.com 이 정본 — 이 시트는 보관용이었고 정제시트로 대체' },
  // 2026-08-18 17:31 (구버전 흡수 6곳)
  { id: '1vBTcj1MpKt44Bzclvgjm23OXFEIY-1hp_g5Wu3bztsQ', name: '손오공 상품화 시트(공급사입력)', kind: '옛 제공시트', code: 'RP012', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-18', note: '렌트 탭 옛 값은 새 시트에 흡수(08-18)' },
  { id: '1JzkGriOncxVC0CiQlL18uiHW-iyzvMNyJkJN4BPGoqI', name: '리더스', kind: '옛 제공시트', code: 'RP008', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-18' },
  { id: '1IP7uES-NrxS58JK9UCtD3ppGZGeSL9STpT2jHJO5JIM', name: '스타', kind: '옛 제공시트', code: 'RP018', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-18' },
  { id: '1IFV4_rNq4hW_KornQpz1ppBWbziCyklTo6oOH0BaUc8', name: '렌트존', kind: '옛 제공시트', code: 'PT-0001', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-18' },
  { id: '1V4dqn5e8dtTLjX_wnHx5wOup0arU3TAtsvEvuh0sisY', name: '우리캐피탈렌터카', kind: '옛 제공시트', code: 'RP020', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-18' },
  { id: '1C5rRLQOPyFM3UoVfIHN79fud099H6m-_QOtUnlFykvo', name: 'SA렌터카', kind: '옛 제공시트', code: 'PT-0023', owner: 'tbag4783@gmail.com', retiredOn: '2026-08-18' },
  // 문패·판매시트 옛 것
  { id: '1rjRptCmXLzIFo147hxt0LYtdgZScgchmTvsrkzc32B8', name: '공급사시트정리', kind: '옛 문패', replacedBy: HUB_CODE_SHEET_ID, owner: 'pyh@teamjpk.com', retiredOn: '2026-08-14', note: '2026-08-10 만든 사본 — 코드는 1TVeVXyJ… 문패만 읽는다' },
  { id: '1G0tPyFI4JIfc-Ijd5qJNbgPGzcs2Ek5hQJwDHuml8VU', name: '프리패스 상품리스트', kind: '옛 판매시트', replacedBy: SALES_SHEET_ID, owner: 'dudguq@gmail.com', retiredOn: '2026-08-14', note: '옛 내보내기 시트(「시트1」) — 지금 판매시트와 이름이 같아 헷갈렸다(2026-08-19 ERP 「구글시트 열기」 링크 사고)' },
  { id: '1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg', name: '프리패스 공급사 상품리스트', kind: '옛 공급사 상품리스트', replacedBy: SALES_SHEET_ID, owner: 'freepassmobility@gmail.com', retiredOn: '2026-08-10', note: '공급사별 탭 24개(2024~) — 지금은 공급사마다 「프리패스 재고」 시트 한 장 + 판매시트로 갈라졌다' },
];

export const isLegacySheetId = (id: string) => LEGACY_SHEETS.some((l) => l.id === id);
export const legacySheetsForCode = (code: string) => LEGACY_SHEETS.filter((l) => l.code === code);

/** 외부(공급사 소유) 원본 — 이름을 건드리지 않는다. 지금 미러가 읽는 원본은 mirror-sources 가 정본이고, 여기는 «옛 외부 원본»만 적는다. */
export const EXTERNAL_LEGACY_ORIGINS: { id: string; name: string; code: string; owner: string; note: string }[] = [
  { id: '1AVW2uFy94qLPV4TU-MsgYMIDLrfC6KZhfxVjoFw7sH0', name: '아이카 옛 원본(「아이카종합」 탭)', code: 'RP004', owner: '아이카', note: '2026-08-10 정본이었으나 08-18 부터 「(수정본)아이카 장기차량 리스트」(1LqWVs2o…)를 원본으로 미러' },
];
