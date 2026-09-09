/**
 * ★★★**그 구성에 «이미 들어 있는» 것** — 정본이 적어 둔 말을 읽는다.
 *
 * ⚠⚠ 2026-09-09 개발센터 4-AI 관문에서 **Codex 가 잡았다**(#4). 제네시스를 엔진 × 구동으로
 *   펴면서 «펴기 전» 옵션 조건을 그대로 복사해, 기본 포함인 것을 **또 팔고** 있었다:
 *     · G80 3.5T — `choices[3.5T].note` 「ECS·19인치 콘티 기본」인데
 *       「프리뷰 전자제어 서스펜션」을 고르면 **+110만**
 *     · GV80 블랙 — `baseConfig` 「2.5T·**AWD**·…·뱅올·컨비니언스 **기본포함**」인데
 *       AWD 를 고르면 **+300만**
 *   ⇒ 「이름에 AWD 가 없으면 진짜 옵션」이라는 규칙이 **기본구성 정보와 충돌**했다.
 *     구동 그룹이 «없는» 라인업은 구동이 base 에 박혀 있는 것이지 «없는» 것이 아니다.
 *
 * ★읽는 자리 셋 — 전부 정본이 «사람 말»로 적어 둔 곳이다:
 *   ① 라인업 `baseConfig` 의 「… 기본포함」 뒤 목록 + 앞부분의 축(AWD·22인치)
 *   ② 엔진 선택지의 `note` 「ECS·19인치 콘티 기본」
 *   ③ 모델 `options.conditionals` 의 「X 기본포함」
 *
 * ⚠⚠ **넘겨 짚으면 «유료 옵션이 사라진다»** — Codex #7 에서 겪은 그대로다.
 *   그래서 여기서 나오는 것은 «이름 조각»이고, 실제로 지울지는 부르는 쪽이
 *   `matchIncluded()` 로 **확실할 때만** 정한다(두 글자 이상 · 별칭표에 있는 것만).
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 정본이 줄여 쓴 말 → 옵션 사전의 «제 이름». 줄임말은 부분일치로 안 잡힌다. */
const ALIAS: Record<string, string[]> = {
  ecs: ['프리뷰 전자제어 서스펜션', '전자제어 서스펜션'],
  뱅올: ['뱅앤올룹슨'],
  드라: ['드라이빙어시'],
  헤드업: ['헤드업 디스플레이'],
  콘티: ['콘티넨탈'],
  후석컴포트: ['후석컴포트 패키지', '2열 컴포트 패키지'],
  컨비니언스: ['컨비니언스 패키지'],
  빌트인캠: ['빌트인캠', '빌트인 캠'],
};

/** 「기본포함」·「기본」 앞의 목록을 조각으로 끊는다. 「드라Ⅰ·Ⅱ」 처럼 로마숫자만 남는 조각을 붙여 준다. */
function piecesOf(text: string): string[] {
  const t = S(text);
  if (!t) return [];
  /* 「… 기본포함」·「… 기본 적용」·「… 기본」 앞까지가 목록이다. */
  const m = /(.*?)\s*기본\s*(?:포함|적용)?/.exec(t);
  const listed = m ? m[1] : t;
  const raw = listed.split(/[·,]/).map((x) => S(x)).filter(Boolean);
  const out: string[] = [];
  for (const p of raw) {
    /* 「Ⅱ」 처럼 로마숫자만 남은 조각은 앞 조각의 «줄기»에 붙인다(「드라Ⅰ」 → 「드라Ⅱ」). */
    if (/^[ⅠⅡⅢIVX]+$/.test(p) && out.length) {
      const prev = out[out.length - 1];
      out.push(prev.replace(/[ⅠⅡⅢIVX]+$/, '') + p);
      continue;
    }
    out.push(p);
  }
  return out;
}

export type GenLineupLike = {
  base?: number; baseConfig?: string;
  exclusiveGroups?: { group?: string; choices?: { label?: string; name?: string; note?: string }[]; options?: { label?: string; name?: string; note?: string }[] }[];
};

/**
 * 이 구성에 이미 들어 있다고 «정본이 말한» 이름 조각들.
 * @param l      라인업(또는 모델 본체)
 * @param engine 그 줄이 고른 엔진 라벨(「가솔린 3.5T」)
 * @param conditionals 모델 `options.conditionals` 문자열(있으면)
 */
export function includedNames(l: GenLineupLike, engine: string, conditionals?: string): string[] {
  const out: string[] = [];
  const bc = S(l.baseConfig);
  if (bc) {
    /* 「… . 헤드업·드라Ⅰ·Ⅱ·… 기본포함」 — 마침표 뒤가 «포함 목록»이다. */
    const tail = bc.includes('. ') ? bc.slice(bc.indexOf('. ') + 2) : '';
    if (/기본\s*(?:포함|적용)/.test(tail)) out.push(...piecesOf(tail));
    /* 앞부분의 «축» — 구동 그룹이 없는 라인업은 구동이 여기 박혀 있다(GV80 블랙 = AWD). */
    const head = bc.includes('. ') ? bc.slice(0, bc.indexOf('. ')) : bc;
    const drive = /(AWD|4WD|2WD|후륜|전륜|사륜)/i.exec(head)?.[1];
    const hasDriveGroup = (l.exclusiveGroups ?? []).some((g) => /구동/.test(S(g.group)));
    if (drive && !hasDriveGroup) out.push(drive);
  }
  /* 고른 엔진의 note — 「ECS·19인치 콘티 기본」·「20인치·코퍼브레이크 기본」 */
  for (const g of l.exclusiveGroups ?? []) {
    if (!/엔진|모터/.test(S(g.group))) continue;
    for (const c of (g.choices ?? g.options ?? [])) {
      const lab = S(c.label ?? c.name);
      if (!lab || !sameEngine(lab, engine)) continue;
      if (S(c.note)) out.push(...piecesOf(S(c.note)));
    }
  }
  /* 모델 conditionals — 「뱅올=스포츠 3.5T 기본포함(중복금지)」 꼴. 엔진이 언급된 마디만 본다. */
  for (const clause of S(conditionals).split('·')) {
    if (!/기본\s*포함/.test(clause)) continue;
    if (!engineTokens(engine).some((t) => clause.includes(t))) continue;
    const name = /^\s*([^=]+)=/.exec(clause)?.[1];
    if (name) out.push(S(name));
  }
  return [...new Set(out.filter((x) => x.length >= 2))];
}

/** 「가솔린 3.5T」 ↔ 「가솔린 3.5 터보」 — 배기량이 같으면 같은 엔진으로 본다. */
const dispOf = (s: string) => /([1-6]\.[0-9])/.exec(S(s))?.[1] ?? '';
function sameEngine(a: string, b: string): boolean {
  const x = dispOf(a); const y = dispOf(b);
  return !!x && !!y && x === y;
}
const engineTokens = (engine: string) => [dispOf(engine), dispOf(engine) + 'T'].filter(Boolean);

const N = (s: string) => S(s).toLowerCase().replace(/[\s\-_()·.]/g, '');

/**
 * 이름 조각 하나가 옵션 사전의 어느 항목인가 — **확실할 때만** 답한다.
 * ⚠ 못 찾으면 `undefined`. 넘겨 짚어 지우면 유료 옵션이 사라진다(Codex #7 의 교훈).
 */
export function matchIncluded(piece: string, names: Record<string, string>): string | undefined {
  const p = N(piece);
  if (p.length < 2) return undefined;
  const cands = Object.entries(names);
  /* ① 별칭표가 먼저다 — 줄임말은 부분일치로 안 잡힌다. */
  for (const [k, fulls] of Object.entries(ALIAS)) {
    if (!p.startsWith(N(k))) continue;
    const suffix = p.slice(N(k).length);              // 「드라Ⅰ」 → 「Ⅰ」
    for (const full of fulls) {
      const hit = cands.find(([, nm]) => N(nm).startsWith(N(full)) && (!suffix || N(nm).includes(suffix)));
      if (hit) return hit[0];
    }
  }
  /* ② 그 다음이 부분일치 — «조각이 이름 안에» 있을 때만(반대는 위험하다). */
  const hits = cands.filter(([, nm]) => N(nm).includes(p));
  return hits.length === 1 ? hits[0][0] : undefined;
}
