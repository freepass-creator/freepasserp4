/**
 * **원천대장 「색상마스터」 탭** — 색상 규격의 «사람이 만지는 자리».
 *
 * ★사장님 2026-08-19 — 「색상은 내가 예전 차종마스터에서 딱 정해 놓은 거 있는데 그거 벗어나면 기타로 · 색상마스터 탭을 하나 만들어서 운용해야 하나??」
 *   · 규격색(외장 12 · 내장 10, 그 밖은 기타)은 코드 `color-master.ts` 가 정본이다 — 탭은 그 목록을 «보여 주고», 별칭은 «받아 준다».
 *   · 탭 구성 — **외장·내장을 세로로 가른다.** 드롭다운은 각 블록 「규격색」 열을 갖다 쓴다.
 *       @외장 / @내장           … 규격색 세로 목록(외장 12 · 내장 10, 그 밖은 기타)
 *       @외장별칭 / @내장별칭   … 공급사 원문 → 그쪽 규격색. 사람 줄(비고 「사람」)은 다시 찍어도 지킴
 *       @미매칭                 … 재고 원문이 규격에 못 맞춘 것. 규격색을 적어 별칭으로 옮기면 다음 채움부터 반영
 *   · 읽는 쪽: fill-supplier-ai-columns(정제칸 외장색상/내장색상) · publish-origin-tab(외장/내장) 이 `loadColorMasterAliases` 로 @별칭을 얹는다.
 * ★쓰는 쪽: scripts/publish-color-master-tab.mts (dry-run 기본, --apply).
 */
import { DEFAULT_PRODUCT_MASTER_SHEET_ID } from './product-master-sheet';
import { registerColorAliases } from './color-master';

export const COLOR_MASTER_TAB = '색상마스터';
export const COLOR_MASTER_SHEET_ID = DEFAULT_PRODUCT_MASTER_SHEET_ID;
export const COLOR_MASTER_HEADER = ['규격색', '원문(별칭)', '→규격색', '비고'] as const;
export const COLOR_MASTER_MARKS = {
  spec: '@규격',
  ext: '@외장',
  int: '@내장',
  extAlias: '@외장별칭',
  intAlias: '@내장별칭',
  alias: '@별칭',
  unmatched: '@미매칭',
} as const;
export const COLOR_MASTER_ALIAS_MARKS = new Set<string>([
  COLOR_MASTER_MARKS.alias,
  COLOR_MASTER_MARKS.extAlias,
  COLOR_MASTER_MARKS.intAlias,
]);

const S = (v: unknown) => String(v ?? '').trim();

/** 탭 값 → @별칭 줄(원문→규격색). 마크 줄부터 다음 마크 전까지. */
export function parseColorMasterAliases(values: readonly unknown[][]): [string, string][] {
  const rows = values.map((r) => (r || []).map(S));
  const out: [string, string][] = [];
  let inAlias = false;
  for (const r of rows) {
    const mark = r[0];
    if (COLOR_MASTER_ALIAS_MARKS.has(mark)) { inAlias = true; continue; }
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
