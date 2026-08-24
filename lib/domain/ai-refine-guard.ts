/**
 * 「AI 정제」 치환 사전 — 발행기·fill·카탈로그가 **같이** 읽는다.
 *
 * ⚠ @세부모델 줄이 개발코드만 떼는 매핑이면 **버린다.**
 *   08-23 다른 AI가 `K5 DL3`→`K5` 186줄을 넣어 세대를 뭉갰다.
 *   사전 시트를 다시 오염시켜도 여기가 막는다. 광고 접두(`디 올 뉴 … MX5`→`싼타페 MX5`)는 통과.
 */
import { wouldStripModelCode } from './submodel-code';

const S = (v: unknown) => String(v ?? '').trim();

/** `K5 DL3`→`K5` 처럼 코드를 깎는 줄이면 true. 광고 접두만 빼는 줄은 false. */
export function isForbiddenSubmodelStrip(from: string, to: string): boolean {
  const f = S(from);
  const t = S(to);
  if (!f || !t || f === t) return false;
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
    if (col === '세부모델' && isForbiddenSubmodelStrip(from, to)) {
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
