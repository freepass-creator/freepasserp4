/**
 * 제조사 옵션 «이름에 붙은 규칙»을 떼어 읽는다 — 기아·현대가 **같은 자를 쓴다.**
 *
 * ★★2026-09-09 검수에서 잡혔다. 현대 크롤러에만 `※` 처리를 넣고 기아에는 안 넣어서,
 *   운영 데이터 **16줄 · 옵션 20개**에 규칙 문장이 «이름 안»에 그대로 남아 있었다:
 *     「듀얼 모터 4WD ※ 19인치 휠&타이어 적용 시 듀얼모터 4WD 선택 가능」
 *     「애프터마켓용 컬렉션 * 와이드 선루프, 듀얼 모터 4WD와 동시 선택 불가」
 *     「투톤 컬러 루프 *와이드 선루프 중복 선택 불가 *블랙 익스테리어 선택 불가」
 *   ⇒ 이름이 문장이 되고, 규칙은 «세워지지도» 않았다. 한 곳에 모아 둘이 같이 쓴다.
 *
 * ★모양이 셋이다 — 괄호 「A(B 선택 시 가능)」 · 별표 「A ※ B…」 · 별 「A * B…」.
 *   그리고 **규칙이 여러 개** 붙기도 한다(「*X 불가 *Y 불가」).
 *
 * ⚠ **상대를 못 찾으면 규칙을 만들지 않는다.** 지어낸 배타는 «고를 수 있는 것»을 막는다.
 * ⚠ 자기 자신을 가리키는 문구(「하이패스 선택 시 hi-pass 기능 사용 가능」)는 규칙이 아니라 설명이다.
 */

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_()·,]/g, '');

export type NamedOption = { name: string; price: number; note?: string };

/** 이름에서 «규칙 문구»를 떼어 낸다. 규칙이 여럿이면 다 모은다. */
export function splitNote(raw: string): { name: string; notes: string[] } {
  let t = S(raw);
  const notes: string[] = [];
  // ※ 나 * 뒤는 전부 규칙이다. 여러 번 붙을 수 있어 하나씩 떼어 낸다.
  const star = /\s*[※*]\s*/;
  if (star.test(t)) {
    const parts = t.split(/\s*[※*]\s*/).map((x) => x.trim()).filter(Boolean);
    t = parts.shift() ?? t;
    notes.push(...parts);
  }
  // 「A(B 선택 시 가능)」 — 괄호 안이 «규칙말»일 때만 뗀다(「(9인)」 같은 것은 이름이다).
  const par = /^(.*?)\s*\(([^()]*(?:선택\s*시|불가|필수|가능)[^()]*)\)\s*$/.exec(t);
  if (par) { t = par[1].trim(); notes.push(par[2].trim()); }
  return { name: t, notes };
}

/** 「A 선택 시 (가능)」 → A · 「A(,B)와 동시/중복 선택 불가」 → [A,B] */
export function readRule(note: string): { needs: string[]; bans: string[] } {
  const t = S(note);
  const needs: string[] = []; const bans: string[] = [];
  const ban = /^(.*?)\s*(?:와|과)?\s*(?:동시|중복)\s*(?:선택|적용)?\s*불가/.exec(t)?.[1];
  if (ban) { bans.push(...ban.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)); return { needs, bans }; }
  const need = /^(.*?)\s*(?:적용|선택)\s*시(?:\s*(?:만)?\s*(?:가능|선택\s*가능))?/.exec(t)?.[1];
  if (need) needs.push(...need.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean));
  return { needs, bans };
}

/**
 * 한 트림의 옵션 목록에서 선행·배제를 세운다.
 * ⚠ 상대를 «그 목록 안에서» 찾았을 때만 세운다. 자기 자신은 상대가 아니다.
 */
export function rulesFrom(opts: NamedOption[]): {
  requires: Record<string, string[]>; excludes: Record<string, string[]>;
} {
  const requires: Record<string, string[]> = {};
  const excludes: Record<string, string[]> = {};
  const find = (who: string, self: NamedOption) => {
    const w = N(who);
    if (w.length < 2) return undefined;
    return opts.find((x) => x !== self && (N(x.name).includes(w) || (w.length > 3 && w.includes(N(x.name)))));
  };
  for (const o of opts) {
    for (const note of o.note ? [o.note] : []) {
      const { needs, bans } = readRule(note);
      for (const b of bans) {
        const p = find(b, o);
        if (!p) continue;
        (excludes[o.name] ??= []).push(p.name);
        (excludes[p.name] ??= []).push(o.name);
      }
      for (const n of needs) {
        const p = find(n, o);
        if (p) (requires[o.name] ??= []).push(p.name);
      }
    }
  }
  return { requires, excludes };
}

/**
 * `<li>` 한 덩어리에서 «이름 + 값»을 읽는다 — 기아·현대가 같은 짜임이다.
 * ⚠⚠ **값을 못 읽으면 그 옵션을 버린다.** 예전에는 0 원으로 저장해 «공짜 옵션»이 생겼다
 *   (2026-09-09 코덱스 검수 — 값 앞에 공백이 있거나 태그가 겹치면 0 이 됐다).
 *   0 원짜리 «기본 사양»과 «못 읽은 것»은 구별할 수 없으므로, 못 읽으면 안 싣는 쪽이 안전하다.
 */
export function priceOf(li: string): number | null {
  const m = /class="[^"]*item-price[^"]*"[^>]*>([\s\S]*?)</.exec(li);
  if (!m) return null;
  const digits = m[1].replace(/[^\d]/g, '');
  if (!digits) return null;
  return Number(digits);
}
