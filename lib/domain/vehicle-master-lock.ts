/**
 * **차종마스터·코드 잠금 — 어떤 AI가 와도 이 파일만 보면 된다.**
 *
 * ★사장님 2026-08-21 — 「차종마스터 이제 이거로 확실히 쓸거고 코드관리 확실히 할수 있게끔
 *   다른 AI가 만져도 문제 없게」.
 *
 *   이름 사전 = `public/data/vehicle-master.json` (+ 원천대장 「차종마스터_규격채택」)
 *   트림행키(mf-) 책 = `data/vehicle-trim-key-registry.json` (원천대장 「차종마스터」 탭은 **읽기만**)
 *   엔카 원자 시트 = 중고 시세 행키(M/SM/T)만. 정제칸 이름을 쓰지 않는다.
 *
 * 검사: `npx tsx scripts/check-vehicle-master-lock.mts`
 * 스냅 회귀: `npx tsx scripts/verify-master-pass.mts`
 */
import { MASTER_SHEET_ID } from './legacy-sheets';
import {
  ENCAR_MODEL_KEY_COLUMN,
  ENCAR_OLD_TRIM_CODE_COLUMN,
  ENCAR_SUB_KEY_COLUMN,
  ENCAR_TRIM_KEY_COLUMN,
  REQUEST_COLUMN_NAME,
} from './supplier-template-sheet';

export const VEHICLE_NAME_DICTIONARY = 'public/data/vehicle-master.json';
export const VEHICLE_CODE_REGISTRY = 'data/vehicle-trim-key-registry.json';
export const LIVE_VEHICLE_MASTER_SHEET_ID = MASTER_SHEET_ID;
export const LIVE_VEHICLE_MASTER_TAB = '차종마스터';

/** fill 이 우리 차종마스터에서 박는 칸. stamp(엔카)가 쓰면 A6가 e-트론이 된다. */
export const FILL_OWNED_COLUMNS = [
  '제조사(정제)', '모델', '세부모델', '세부트림',
  '배기량(정제)', '연료(정제)', '구동방식',
  '차종크기', '차종구분', '차종분류', '원산지',
  '차종코드', '연식',
] as const;

/** stamp 가 공급사 시트에 쓸 수 있는 칸 — 엔카 행키 + 점검사항. */
export const STAMP_ALLOWED_COLUMNS = [
  ENCAR_MODEL_KEY_COLUMN,
  ENCAR_SUB_KEY_COLUMN,
  ENCAR_TRIM_KEY_COLUMN,
  ENCAR_OLD_TRIM_CODE_COLUMN,
  REQUEST_COLUMN_NAME,
] as const;

export function isFillOwnedColumn(name: string): boolean {
  return (FILL_OWNED_COLUMNS as readonly string[]).includes(name);
}

export function isStampAllowedColumn(name: string): boolean {
  return (STAMP_ALLOWED_COLUMNS as readonly string[]).includes(name);
}

/** 라이브 원천대장 「차종마스터」 탭에 쓰지 못하게. 상품마스터·규격채택 탭은 이 검사가 통과한다. */
export function assertNotLiveVehicleMasterTabWrite(spreadsheetId: string, rangeOrTab: string, what = 'write') {
  if (String(spreadsheetId || '').trim() !== LIVE_VEHICLE_MASTER_SHEET_ID) return;
  const raw = String(rangeOrTab || '');
  const tab = raw.replace(/^'+|'.*$/g, '').split('!')[0].replace(/''/g, "'").trim();
  if (tab === LIVE_VEHICLE_MASTER_TAB) {
    throw new Error(`refusing to ${what} live ERP 「${LIVE_VEHICLE_MASTER_TAB}」 tab — 이름은 ${VEHICLE_NAME_DICTIONARY}, 코드는 ${VEHICLE_CODE_REGISTRY} (읽기만)`);
  }
}

/** stamp 가 정제칸 이름을 쓰려 하면 즉시 실패 — 다른 AI가 한 줄 넣어도 여기서 막힌다. */
export function assertStampColumnAllowed(name: string) {
  if (isStampAllowedColumn(name)) return;
  throw new Error(`stamp는 엔카 행키(M/SM/T)·점검사항만. 「${name}」은 fill(${VEHICLE_NAME_DICTIONARY}) 몫이다`);
}
