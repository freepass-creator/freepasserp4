/**
 * 신차 «옵션 조합 규칙» — 배타(택1) · 선행필수 · 배제.
 *
 * ★★사장님 2026-09-09 「야 **옵션은 명확하게 다 구현하는 게 웰릭스 테이블에 있는데**」
 *
 * 맞는 말씀이다. 원본 `src/components/mobile/StepVehicle.vue` 에 다 있다 —
 *   `getGroup(id)`   그 옵션이 든 배타그룹(그 안에서 «하나만»)
 *   `isEnabled(id)`  `requires` 가 다 켜졌나 · `requires_in_trim` 이 다 켜졌나 · 부모가 «배제»하지 않나
 *   `toggleOption`   배타그룹 안에서 고르면 형제를 «끈다»
 * 그 셋을 그대로 옮긴다. 데이터는 정본(`new_car_trim`)에 실었다
 *   (`scripts/ingest-newcar-options.mts` — 웰릭스 조합지도에서 272줄).
 *
 * ⚠ **여태는 «글»로만 있었다.** 화면은 「고를 수 없는 조합도 골립니다」라고 적어 두고 안 막았다.
 *   안 막으면 «있을 수 없는 차»의 값이 손님 견적서에 찍힌다.
 *
 * ⚠ 조합지도가 «없는» 트림(웰릭스가 모르는 모델 — 스타리아·아이오닉·EV 전 라인·르노)은
 *   지금처럼 평면 목록으로 둔다. 규칙이 없다고 못 고르게 만들지 않는다.
 */

export type OptionDef = { name: string; sub?: string; price: number; requires?: string[] };
export type ExclusiveGroup = { id: string; label: string; members: string[] };

export type OptionSpec = {
  optionsMaster?: Record<string, OptionDef>;
  exclusiveGroups?: ExclusiveGroup[];
  optionExcludes?: Record<string, string[]>;
  availableOptions?: string[];
  /** 「이미 산 엔진」 — 값에 이미 들어 있어 다시 팔지 않는 것. 선행 조건으로는 «충족»으로 본다. */
  impliedOptions?: string[];
};

/** 조합 규칙이 있는가 — 없으면 화면은 평면 목록으로 그린다. */
export const hasRules = (s: OptionSpec | null | undefined): boolean =>
  !!s?.optionsMaster && Object.keys(s.optionsMaster).length > 0;

/** 화면에 세울 옵션 줄들 — 그 트림에서 «고를 수 있는» 것만, 값 큰 것 뒤로. */
export function optionList(s: OptionSpec): { id: string; def: OptionDef }[] {
  const om = s.optionsMaster ?? {};
  /* ⚠ `availableOptions` 가 «있는데 비어 있으면» 그 트림에서 고를 것이 «없다»는 뜻이다.
     예전에는 빈 배열을 «못 받았다»로 읽어 옵션 «전부»를 열어 줬다 — 고를 수 없는 것을 팔게 된다
     (2026-09-09 코덱스 검수). 필드가 아예 «없을» 때만 전부를 보여 준다. */
  /* ★★★**「이미 산 것」은 «팔 물건»이 아니다** — 그 트림의 값에 이미 들어 있다.
     ⚠⚠ 2026-09-09 개발센터 4-AI 관문에서 **Codex 가 잡았다.** 그때까지 `impliedOptions` 는
       `requiresOf` 에서 「선행 충족」으로만 쓰였고, **목록·합계는 아무것도 안 걸렀다.**
       그래서 「3.5 엔진 +246만」이 체크칸으로 그대로 서고, 체크하면 합계에 더해졌다 —
       막았다고 적어 놓고 **한 푼도 안 막고 있었다.**(재현: optionSum(…,{eng35}) = 2,460,000) */
  const implied = new Set(s.impliedOptions ?? []);
  const ids = (Array.isArray(s.availableOptions) ? s.availableOptions : Object.keys(om))
    .filter((id) => om[id] && !implied.has(id));
  return ids.map((id) => ({ id, def: om[id] }));
}

export const groupOf = (s: OptionSpec, id: string): ExclusiveGroup | null =>
  (s.exclusiveGroups ?? []).find((g) => g.members.includes(id)) ?? null;

/** 선행으로 요구되는 것들 — 「이미 산 엔진」은 요구에서 뺀다(이미 갖고 있다). */
export function requiresOf(s: OptionSpec, id: string): string[] {
  const implied = new Set(s.impliedOptions ?? []);
  return (s.optionsMaster?.[id]?.requires ?? []).filter((r) => !implied.has(r));
}

/**
 * 지금 고른 것들 아래에서 이 옵션을 고를 수 있나.
 * ① 선행이 다 켜져 있어야 하고 ② 켜진 어느 옵션도 이것을 «배제»하지 않아야 한다.
 */
export function isEnabled(s: OptionSpec, id: string, chosen: ReadonlySet<string>): boolean {
  if (!s.optionsMaster?.[id]) return false;
  /* ★「이미 산 것」은 켜고 끌 것이 아니다 — 켜지면 합계에 또 더해진다. */
  if ((s.impliedOptions ?? []).includes(id)) return false;
  /* ★★그 트림에서 «파는 것»이 아니면 켤 수 없다. 예전에는 `availableOptions` 를 목록에서만 보고
     여기서는 안 봐서, G80 2.5T 줄에서 「20\" 피렐리(3.5T 전용)」를 켜고 **70만원을 받을 수** 있었다
     (2026-09-09 개발센터 4-AI 관문 · Codex 재현). 목록에서 빠진 것이 합계에는 드는 꼴이다. */
  if (Array.isArray(s.availableOptions) && !s.availableOptions.includes(id)) return false;
  for (const r of requiresOf(s, id)) if (!chosen.has(r)) return false;
  for (const [parent, blocked] of Object.entries(s.optionExcludes ?? {})) {
    if (chosen.has(parent) && (blocked ?? []).includes(id)) return false;
  }
  return true;
}

/**
 * 옵션 하나를 켜고 끈다 — **배타그룹 안에서는 하나만** 남는다.
 * ⚠ 끄고 나면 그것을 선행으로 삼던 것들도 같이 꺼야 한다(HTRAC 이 3.5 엔진을 요구하는 꼴).
 *   한 번만 훑으면 사슬(A←B←C)이 남으니 «더 꺼질 것이 없을 때까지» 돈다.
 */
export function toggleOption(s: OptionSpec, id: string, chosen: ReadonlySet<string>): Set<string> {
  const next = new Set(chosen);
  if (next.has(id)) next.delete(id);
  else {
    if (!isEnabled(s, id, next)) return next;
    const g = groupOf(s, id);
    if (g) for (const m of g.members) next.delete(m);   // 택1 — 형제를 끈다
    next.add(id);
  }
  // 더 이상 성립하지 않는 것들을 떨군다.
  /* ⚠ 사슬이 길면 스무 번으로는 못 끝난다 — 옵션 수만큼 돌면 반드시 끝난다
     (한 바퀴에 최소 하나는 꺼지므로). 2026-09-09 코덱스가 25단계 사슬에서 다섯 개가 남는 것을 재현했다. */
  const rounds = Object.keys(s.optionsMaster ?? {}).length + 1;
  for (let i = 0; i < rounds; i++) {
    let dropped = false;
    for (const x of [...next]) {
      if (!isEnabled(s, x, next) || !s.optionsMaster?.[x]) { next.delete(x); dropped = true; }
    }
    if (!dropped) break;
  }
  return next;
}

/** 고른 것들의 값 합 — 「이미 산 엔진」은 값에 이미 들어 있어 안 더한다. */
export function optionSum(s: OptionSpec, chosen: ReadonlySet<string>): number {
  const om = s.optionsMaster ?? {};
  /* ★★**마지막 빗장**이다. 목록·토글을 뚫고 들어와도(저장된 옛 선택·URL·버그) 돈은 안 나간다.
     빗장을 «세 군데» 거는 까닭 — 하나만 걸면 다음 사람이 그 하나를 지나치는 길을 만든다. */
  /* ⚠⚠ **빗장이 반쪽이었다.** 「이미 산 것」만 막고 «그 트림에서 안 파는 것»과 «규칙을 어긴 것»은
     그대로 더했다 — `availableOptions: []` 인데 금지 옵션 70만이 합계에 들었다
     (2026-09-09 개발센터 4-AI 관문 · Codex 발견 3). 마지막 빗장은 **고를 수 있는 것만** 센다. */
  let n = 0;
  for (const id of chosen) {
    if (!isEnabled(s, id, chosen)) continue;   // 이미 산 것 · 안 파는 것 · 선행 미충족 · 배제됨
    n += Number(om[id]?.price) || 0;
  }
  return n;
}

/** 못 고르는 까닭 한 줄 — 화면이 «왜» 안 되는지 말해 준다. */
export function whyBlocked(s: OptionSpec, id: string, chosen: ReadonlySet<string>): string {
  const om = s.optionsMaster ?? {};
  const need = requiresOf(s, id).filter((r) => !chosen.has(r));
  if (need.length) return `선행 필요 — ${need.map((r) => om[r]?.name ?? r).join(' · ')}`;
  for (const [parent, blocked] of Object.entries(s.optionExcludes ?? {})) {
    if (chosen.has(parent) && (blocked ?? []).includes(id)) return `${om[parent]?.name ?? parent} 선택 시 못 고름`;
  }
  return '';
}
