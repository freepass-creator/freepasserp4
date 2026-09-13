/**
 * **공급사 원천을 «어느 주소에서» 읽는가 — 한 곳에서 정한다.**
 *
 * ⚠⚠ 2026-09-08 실측 사고 —
 *   직접수집이 `partner.sheet_url` 을 원천으로 삼았는데, 그 값이 **2026-08-15 에 폐기된 옛 제공시트**였다.
 *   웰릭스(RP013)는 그 뒤 24일 동안 죽은 시트를 읽었다. 옛 시트의 차명 열 이름이 「차명(트림)」이라
 *   별칭에도 안 걸려 차명이 «비었고», 남은 제조사 한 마디(「기아」)가 차명 자리에 앉았다.
 *   매칭기는 그걸 보고 **K8 을 「모닝」, 카니발을 「스포티지」** 로 붙였다.
 *   → 틀린 차 이름은 매칭기 잘못이 아니라 **주소가 틀린 것**이었다.
 *
 * ★**문패(공급사시트정리)가 정본이다.** 공급사가 시트를 갈아 끼우면 문패만 바뀐다 —
 *   `partner.sheet_url` 은 ERP 화면용 사본이라 늦고, 실제로 11개 공급사가 폐기 주소에 멈춰 있었다.
 *
 * ```
 * ① MIRROR_SOURCES  정제시트로 연동한 곳(아이카·오토플러스·이안카·아이언) — 표가 답
 * ② 문패             그 밖 전부 — 코드로 찾는다        ★여기가 정본
 * ③ partner.sheet_url  문패에 없을 때만 (마지막 수단)
 * ⛔ 폐기 명단에 있는 주소는 «어느 단계에서 나왔든» 쓰지 않는다 — 죽은 시트를 읽느니 멈추는 게 낫다
 * ```
 */
import { isLegacySheetId, legacySheetsForCode } from './legacy-sheets';

const S = (v: unknown) => String(v ?? '').trim();
/** 구글시트 주소·ID 어느 쪽을 줘도 ID 로. */
export const sheetIdOf = (v: unknown) => {
  const s = S(v);
  return (s.match(/\/spreadsheets\/d\/([-\w]{25,})/)?.[1] || (/^[-\w]{25,}$/.test(s) ? s : '')) || '';
};

/** 문패 격자(머리행 포함) → 공급사코드 → 시트ID. 「공급사코드」·「시트주소」 열 이름으로 읽는다. */
export function hubSourceMap(rows: string[][]): Map<string, string> {
  const out = new Map<string, string>();
  const N = (v: unknown) => S(v).replace(/\s+/g, '');
  let ci = -1, si = -1;
  for (const r of rows.slice(0, 5)) {
    const c = r.findIndex((x) => /공급사코드|코드/.test(N(x)));
    const s = r.findIndex((x) => /시트주소|시트|주소/.test(N(x)));
    if (c >= 0 && s >= 0) { ci = c; si = s; break; }
  }
  if (ci < 0 || si < 0) return out;
  for (const r of rows) {
    const code = S(r[ci]); const id = sheetIdOf(r[si]);
    if (!code || !id || !/^(RP|PT)/i.test(code)) continue;
    out.set(code.toUpperCase(), id);
  }
  return out;
}

export type SourcePick = { id: string; from: '문패' | 'partner.sheet_url'; };

/**
 * 공급사 하나의 원천 주소를 고른다. 폐기 주소면 **던진다** — 조용히 죽은 시트를 읽지 않는다.
 * @param hub  `hubSourceMap()` 결과
 * @param fallback  `partner.sheet_url` (문패에 없을 때만)
 */
export function pickSupplierSource(code: string, hub: Map<string, string>, fallback?: unknown): SourcePick {
  const C = S(code).toUpperCase();
  const hubId = hub.get(C) || '';
  const fbId = sheetIdOf(fallback);
  const pick: SourcePick | null = hubId ? { id: hubId, from: '문패' } : (fbId ? { id: fbId, from: 'partner.sheet_url' } : null);
  if (!pick) throw new Error(`${C}: 원천 주소가 없다 — 문패(공급사시트정리)에도 partner.sheet_url 에도 없다.`);
  if (isLegacySheetId(pick.id)) {
    const dead = legacySheetsForCode(C).find((l) => l.id === pick.id);
    throw new Error(
      `${C}: 원천이 «폐기된 시트»다 — ${pick.from} 의 ${pick.id}`
      + (dead ? ` (${dead.name} · ${dead.retiredOn} 폐기)` : '')
      + `\n  죽은 시트를 읽으면 차명·상태가 통째로 틀어진다(2026-09-08 웰릭스 실측: K8→모닝).`
      + `\n  고칠 곳 = 문패 「공급사시트정리」의 그 줄. 고친 뒤 partner.sheet_url 도 같이 맞춘다.`);
  }
  return pick;
}
