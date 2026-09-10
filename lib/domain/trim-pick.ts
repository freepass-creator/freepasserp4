/**
 * **세부트림 고르기 — 한 벌.** 마스터 trims 풀에서만 고르고, 못 고르면 「기본형」.
 *
 * > 매뉴얼 `docs/차종명명-정제-매뉴얼.md` §3 「세부트림 없으면 「기본형」」 ·
 * >  §3-1 ④ 「원문에 없거나 풀에 없으면 → 「기본형」」 · 사장님 2026-09-08 「G80 RG3 도 기본형으로 채워라」
 *
 * ⚠⚠ 실측 2026-09-10 — 이 규칙이 «치유 스크립트 안»에만 있었고, 그 치유는 **RTDB(`v4/products`)에 쓴다.**
 *   그런데 원자 SSOT 는 **Firestore `products`** 다. 그래서 규칙은 있는데 SSOT 에는 안 닿아
 *   **세부트림이 121대 비어 있었고, 「기본형」인 차가 원자에 «한 대도» 없었다.**
 *   ⇒ 규칙을 여기로 뗀다. 어느 길에서 부르든 «같은 답»이 나오게.
 *
 * ★**지어내지 않는다.** 마스터 풀에 있는 이름만 고른다.
 * ★**세부모델이 비면 손대지 않는다** — 그건 정말 «모른다»다. 「기본형」은 모른다가 아니라
 *   **「그 세대에 트림 구분이 없다」는 답**이다(공급사 원문도 실제로 「기본형」이라 적는다).
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 한↔영·철자 정규화 — 원문과 마스터 트림 «양쪽에» 같은 함수를 쓴다. */
const TR: [RegExp, string][] = [
  [/비지니스/g, '비즈니스'], [/iconic/gi, '아이코닉'], [/\bsport\b/gi, '스포츠'], [/premium/gi, '프리미엄'], [/standard/gi, '스탠다드'],
  [/signature/gi, '시그니처'], [/luxury/gi, '럭셔리'], [/prestige/gi, '프레스티지'], [/exclusive/gi, '익스클루시브'], [/modern/gi, '모던'],
  [/inspiration/gi, '인스퍼레이션'], [/noblesse/gi, '노블레스'], [/limited/gi, '리미티드'], [/dynamic/gi, '다이나믹'], [/smart/gi, '스마트'],
];
export const normTrim = (s: string): string => {
  let x = S(s).toLowerCase();
  for (const [r, v] of TR) x = x.replace(r, v);
  return x.replace(/[\s()/\-·.]/g, '');
};

/** 「(세부등급 없음)」은 트림 이름이 아니다 — 풀에서 뺀다. */
const 이름아님 = (t: string) => !S(t) || S(t) === '(세부등급 없음)';

/**
 * 차종마스터 → 「세부모델 → 트림 목록(긴 것 먼저)」.
 * ★긴 것부터 대조해야 «가장 구체적인» 트림이 잡힌다(「스탠다드」보다 「렌터카 스탠다드」).
 */
export function buildTrimPool(master: unknown): Map<string, string[]> {
  const rows = (Array.isArray(master) ? master : ((master as { entries?: unknown[] })?.entries || [])) as Record<string, any>[];
  const out = new Map<string, string[]>();
  for (const e of rows) {
    const set = new Set<string>();
    for (const t of (e.trims || [])) if (!이름아님(t)) set.add(S(t));
    for (const v of (e.variants || [])) for (const t of (v?.trims || [])) if (!이름아님(t)) set.add(S(t));
    if (set.size) {
      const key = S(e.sub_model);
      const merged = new Set([...(out.get(key) || []), ...set]);
      out.set(key, [...merged].sort((a, b) => b.length - a.length));
    }
  }
  return out;
}

/**
 * 세부트림을 고른다.
 *   · 세부모델이 비면 `''`(손대지 않는다 — 진짜 모른다)
 *   · 풀에서 원문과 맞는 이름이 있으면 그 이름
 *   · 없으면 **「기본형」**
 */
export function pickTrim(subModel: unknown, rawName: unknown, pool: Map<string, string[]>): string {
  const sub = S(subModel);
  if (!sub) return '';
  const raw = normTrim(S(rawName));
  for (const t of (pool.get(sub) || [])) {
    const tn = normTrim(t);
    if (tn.length >= 2 && raw.includes(tn)) return t;   // 긴 것부터 → 가장 구체적
  }
  return '기본형';
}
