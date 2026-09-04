/**
 * **밖으로 나가는 글에서 «우리끼리 하는 말»을 걷어낸다.**
 *
 * ★사장님 2026-09-04 「야 공급사에 보여지는건 내부 문서가 아닌데
 *   『7월 출고건 환수 · 8월 청구에 반영(사장님 2026-09-04) · 하허호 몫은 태윤 매니저가 선반영』」
 *
 * ★★★**무엇이 새는가.** 그 한 줄에 셋이 들어 있었다 —
 * ```
 * 사람 이름     「사장님」 · 「태윤 매니저」        우리 안에서 누가 정했는지는 상대의 일이 아니다
 * 남의 상호     「하허호」                      ★리더스가 «영업채널 이름»을 볼 이유가 없다
 * 내부 처리 말   「선반영」 · 「8월 청구에 반영」    우리 장부 사정이다
 * ```
 *   ⇒ 특히 «남의 상호»가 새는 것이 사고다. 공급사에게 채널 이름이, 채널에게 공급사 사정이
 *     보이면 그 자리에서 판이 흔들린다. 지급 요율을 가린 것과 같은 이유다.
 *
 * ★**지우지 않고 «갈라 둔다».** 우리 기록에는 그대로 남아야 다음 달에 왜 뺐는지 안다.
 *   원자에는 다 적어 두고, 나가는 종이·시트에는 이 함수를 통과한 말만 싣는다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 이 말이 하나라도 들어 있으면 «우리끼리 하는 말»로 본다. */
const INSIDE = /사장님|매니저|대표님|선반영|반영함|내부|우리\s*쪽|장부|이월하기로|확인대기|태윤|영협|지수/;

/**
 * 밖에 내보낼 말만 남긴다.
 *
 * @param text  원자에 적힌 사유(우리끼리 하는 말이 섞여 있을 수 있다)
 * @param others 이 글에 «있으면 안 되는» 남의 상호들 — 받는 사람 말고 다른 거래처
 * @returns 내보내도 되는 말. 남길 것이 없으면 빈 문자열
 *
 * ★한 조각이라도 걸리면 «그 조각만» 뺀다 — 통째로 지우면 쓸 만한 말까지 사라진다.
 *   조각은 「 · 」로 가른다(우리가 사유를 그렇게 잇는다).
 */
export function outwardText(text: unknown, others: readonly string[] = []): string {
  const parts = S(text).split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  const bad = others.map((o) => S(o)).filter((o) => o.length >= 2);
  const kept = parts.filter((p) => !INSIDE.test(p) && !bad.some((o) => p.includes(o)));
  return kept.join(' · ');
}

/** 이 글에 «나가면 안 되는 것»이 남아 있나 — 붙이기 전에 기계가 본다. */
export const hasInside = (text: unknown, others: readonly string[] = []): boolean => {
  const t = S(text);
  if (!t) return false;
  return INSIDE.test(t) || others.some((o) => S(o).length >= 2 && t.includes(S(o)));
};
