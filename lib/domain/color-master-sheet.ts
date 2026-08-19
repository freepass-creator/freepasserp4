/**
 * **원천대장 「색상마스터」 탭** — 색상 규격의 «사람이 만지는 자리».
 *
 * ★사장님 2026-08-19 — 「색상은 내가 예전 차종마스터에서 딱 정해 놓은 거 있는데 그거 벗어나면 기타로 · 색상마스터 탭을 하나 만들어서 운용해야 하나??」
 *   · 규격색(외장 12 · 내장 10, 그 밖은 기타)은 코드 `color-master.ts` 가 정본이다 — 탭은 그 목록을 «보여 주고», 별칭은 «받아 준다».
 *   · 탭 구성(한 장, 4열): 구분 | 원문(별칭) | 규격색 | 비고
 *       @규격  … 규격색 한 줄씩(외장/내장 어디에 쓰는지 · 글자색 hex)
 *       @별칭  … 원문 표기 → 규격색. 코드 기본 별칭 + **사람이 더 적은 줄(비고 「사람」)** — 사람 줄은 다시 찍어도 지키고, 코드보다 이긴다.
 *       @미매칭 … 최근 공급사 시트에서 규격에 못 맞춰 「기타」로 간 원문(횟수 · 어느 시트) — 여기서 규격색을 적어 @별칭으로 옮기면 다음 채움부터 반영.
 *   · 읽는 쪽: fill-supplier-ai-columns(정제칸 외장색상/내장색상) · publish-origin-tab(외장/내장) 이 `loadColorMasterAliases` 로 @별칭을 얹는다.
 * ★쓰는 쪽: scripts/publish-color-master-tab.mts (dry-run 기본, --apply).
 */
import { DEFAULT_PRODUCT_MASTER_SHEET_ID } from './product-master-sheet';
import { registerColorAliases } from './color-master';

export const COLOR_MASTER_TAB = '색상마스터';
export const COLOR_MASTER_SHEET_ID = DEFAULT_PRODUCT_MASTER_SHEET_ID;
export const COLOR_MASTER_HEADER = ['구분', '원문(별칭)', '규격색', '비고'] as const;
export const COLOR_MASTER_MARKS = { spec: '@규격', alias: '@별칭', unmatched: '@미매칭' } as const;

const S = (v: unknown) => String(v ?? '').trim();

/** 탭 값 → @별칭 줄(원문→규격색). 마크 줄부터 다음 마크 전까지. */
export function parseColorMasterAliases(values: readonly unknown[][]): [string, string][] {
  const rows = values.map((r) => (r || []).map(S));
  const out: [string, string][] = [];
  let inAlias = false;
  for (const r of rows) {
    const mark = r[0];
    if (mark === COLOR_MASTER_MARKS.alias) { inAlias = true; continue; }
    if (mark && mark.startsWith('@')) { inAlias = false; continue; }
    if (!inAlias) continue;
    if (r[1] && r[2]) out.push([r[1], r[2]]);
  }
  return out;
}

/** 원천대장 「색상마스터」 @별칭을 읽어 코드 별칭 위에 얹는다. 탭이 없으면 0. api = Sheets values GET 호출자. */
export async function loadColorMasterAliases(api: (url: string) => Promise<Record<string, unknown>>): Promise<number> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${COLOR_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${COLOR_MASTER_TAB}'!A1:D2000`)}`;
  const res = await api(url) as { values?: unknown[][] };
  const pairs = parseColorMasterAliases(res.values || []);
  return registerColorAliases(pairs);
}
