/**
 * 「AI 정제」 치환 사전 — 발행기·fill·카탈로그가 **같이** 읽는다.
 *
 * ⚠ @모델·@세부모델·@세부트림 줄이 라이브 이름을 깎으면 **버린다.**
 *   08-23 다른 AI가 `K5 DL3`→`K5` 186줄을 넣어 세대를 뭉갰다.
 *   09-01 같은 사전이 `디 올 뉴 싼타페 MX5`→`싼타페 MX5` 로 라이브 행을 지웠다(아이카 109호5391).
 *   사전 시트를 다시 오염시켜도 여기가 막는다.
 */
import { wouldStripModelCode } from './submodel-code';

const S = (v: unknown) => String(v ?? '').trim();
const AD_PREFIX = /디\s*올\s*뉴|더\s*올\s*뉴|더\s*뉴|올\s*뉴|더\s*2026/;
const NAME_COLS = new Set(['모델', '세부모델', '세부트림']);

/** 라이브 행의 광고 접두를 F03 짧은 이름으로 깎는 줄. */
export function isForbiddenAdPrefixStrip(from: string, to: string): boolean {
  const f = S(from);
  const t = S(to);
  if (!f || !t || f === t) return false;
  return AD_PREFIX.test(f) && !AD_PREFIX.test(t);
}

/** `K5 DL3`→`K5` 또는 `디 올 뉴 싼타페 MX5`→`싼타페 MX5` 처럼 라이브 이름을 깎는 줄. */
export function isForbiddenSubmodelStrip(from: string, to: string): boolean {
  const f = S(from);
  const t = S(to);
  if (!f || !t || f === t) return false;
  if (isForbiddenAdPrefixStrip(f, t)) return true;
  // `to` 를 모델 이름으로 보면 K5 는 남고 DL3 만 코드로 보인다.
  if (wouldStripModelCode(f, t, '') === t) return true;
  if (wouldStripModelCode(f, '', '') === t) return true;
  return false;
}

export function substFromAiRefineRows(rows: string[][]): { map: Map<string, string>; skipped: number } {
  const map = new Map<string, string>();
  let skipped = 0;
  for (const r of rows || []) {
    const kind = S(r[0]);
    const from = S(r[1]);
    const to = S(r[2]);
    if (!kind.startsWith('@') || kind === '@설명' || !from || !to) continue;
    const col = kind.slice(1);
    if (NAME_COLS.has(col) && isForbiddenSubmodelStrip(from, to)) {
      skipped++;
      continue;
    }
    map.set(`${col}|${from}`, to);
  }
  return { map, skipped };
}

export function applyAiRefineSubst(map: Map<string, string>, col: string, val: string): string {
  return map.get(`${col}|${S(val)}`) ?? S(val);
}
