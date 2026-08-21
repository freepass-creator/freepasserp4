/**
 * **엔카 차종마스터 시트 — 차명·제원 사전의 연동 파일.**
 *
 * 정본 문서 ID 는 `ENCAR_MASTER_SHEET_ID`. 라이브 원장 「차종마스터」(mf-) 와 다른 파일이다.
 * stamp 가 이 시트를 읽고, 공급사 「차종마스터」 탭은 IMPORTRANGE 로 같은 파일을 본다.
 */
import { ENCAR_MASTER_SHEET_ID, assertNotLiveVehicleMasterWrite } from './legacy-sheets';

export { ENCAR_MASTER_SHEET_ID };
export const ENCAR_MASTER_TAB = '차종마스터';
export const ENCAR_MASTER_URL = `https://docs.google.com/spreadsheets/d/${ENCAR_MASTER_SHEET_ID}/edit`;
/** 공급사 사본 탭 A1 에 넣는 연동 수식. 원본이 바뀌면 같이 바뀐다. */
export const ENCAR_MASTER_IMPORT_FORMULA = `=IMPORTRANGE("${ENCAR_MASTER_URL}","${ENCAR_MASTER_TAB}!A:AB")`;

export type EncarMasterPayload = { headers: string[]; values: (string | number)[][] };

const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');

export async function loadEncarMasterPayload(
  call: (url: string) => Promise<Record<string, unknown>>,
): Promise<EncarMasterPayload> {
  assertNotLiveVehicleMasterWrite(ENCAR_MASTER_SHEET_ID, 'treat as live master');
  const v = await call(
    `https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${ENCAR_MASTER_TAB}'!A1:AZ5000`)}`,
  ) as { values?: unknown[][] };
  const rows = ((v.values || []) as unknown[][]).map((r) => (r || []).map((c) => S(c)));
  const headers = rows[0] || [];
  if (rows.length < 100 || !headers.some((h) => norm(h) === '원자ID') || !headers.some((h) => norm(h) === '세부트림행키')) {
    throw new Error(`엔카 차종마스터 형태가 다름(줄 ${rows.length}, 헤더 ${headers.slice(0, 8).join('|')})`);
  }
  return { headers, values: rows.slice(1) };
}
