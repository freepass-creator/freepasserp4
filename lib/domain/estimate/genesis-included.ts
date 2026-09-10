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
 * @param variant 그 줄의 «분류»(라인업 이름 + 트림) — 「스포츠 3.5T 기본포함」 같은 단서를 가릴 때 쓴다
 */
export function includedNames(l: GenLineupLike, engine: string, conditionals?: string, variant = ''): string[] {
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
  /* 모델 conditionals — 「뱅올=스포츠 3.5T 기본포함(중복금지)」 꼴.
     ⚠⚠ **「스포츠」를 버리면 안 된다.** 그 단서를 흘려 3.5T «전부»에 적용했더니,
       일반 G80 3.5T 에서 **뱅앤올룹슨 1,900,000원이 목록·토글·합계에서 사라졌다**
       (2026-09-10 개발센터 4-AI 관문 · 독립 Claude A · 실데이터 재현).
       기본 포함이 아닌 것을 「이미 샀다」고 접으면 **팔 물건이 없어진다.**
     ⇒ 마디에 «분류»(스포츠·블랙·라운지·표준)가 적혀 있으면 그 줄이 **그 분류일 때만** 본다. */
  const CLASS = /(스포츠|블랙|라운지|표준|기본)/g;
  for (const clause of S(conditionals).split('·')) {
    if (!/기본\s*포함/.test(clause)) continue;
    if (!engineTokens(engine).some((t) => clause.includes(t))) continue;
    const head = clause.split('=')[1] ?? clause;
    const classes = [...head.matchAll(CLASS)].map((m) => m[1]).filter((c) => c !== '기본');
    if (classes.length && !classes.some((c) => S(variant).includes(c))) continue;
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
 * ⚠ 못 찾으면 `undefined`. 넘겨 짚어 지우면 유료 옵션이 사라진다.
 * @param drive 그 줄의 구동(「AWD」·「2WD」) — 구동이 갈리는 항목을 고를 때 쓴다.
 */
export function matchIncluded(piece: string, names: Record<string, string>, drive = ''): string | undefined {
  const p = N(piece);
  if (p.length < 2) return undefined;
  const cands = Object.entries(names);
  /* ⓪ ★**이름이 «똑같으면» 그것이다.** 이게 없어서 「AWD」가 「드라이빙어시Ⅱ(AWD)」와 겹쳐
     못 찾았고, GV80 블랙에서 **AWD 300만을 다시 팔았다**(2026-09-09 Codex 발견 4). */
  const exact = cands.filter(([, nm]) => N(nm) === p);
  if (exact.length === 1) return exact[0][0];

  /* 구동이 갈리는 항목(「드라이빙어시Ⅱ(2WD)」·「(AWD)」)은 **그 줄의 구동**으로 고른다.
     ⚠ 예전에는 `find()` 가 «첫 값»을 집어 AWD 줄에 **2WD 항목**을 기본포함으로 붙였다 —
       그러면 진짜 필요한 AWD 항목(270만)을 다시 판다. */
  const dk = /AWD|4WD|사륜/i.test(drive) ? 'awd' : /2WD|후륜|전륜/i.test(drive) ? '2wd' : '';
  const driveOf = (nm: string) => (/AWD|4WD|사륜/i.test(nm) ? 'awd' : /2WD|후륜|전륜/i.test(nm) ? '2wd' : '');
  const fit = (list: [string, string][]) => {
    if (list.length <= 1) return list;
    const split = list.filter(([, nm]) => driveOf(nm));
    if (!split.length || !dk) return list;
    const keep = list.filter(([, nm]) => !driveOf(nm) || driveOf(nm) === dk);
    return keep;
  };

  /* ① 별칭표 — 줄임말은 부분일치로 안 잡힌다. */
  for (const [k, fulls] of Object.entries(ALIAS)) {
    if (!p.startsWith(N(k))) continue;
    const suffix = p.slice(N(k).length);              // 「드라Ⅰ」 → 「Ⅰ」
    for (const full of fulls) {
      const hits = fit(cands.filter(([, nm]) => N(nm).startsWith(N(full)) && (!suffix || N(nm).includes(suffix))));
      if (hits.length === 1) return hits[0][0];
    }
  }
  /* ② 부분일치 — «조각이 이름 안에» 있을 때만. 갈리면 «안 고른다»(지우면 유료 옵션이 사라진다). */
  const hits = fit(cands.filter(([, nm]) => N(nm).includes(p)));
  return hits.length === 1 ? hits[0][0] : undefined;
}

/**
 * ★★★**펴 놓은 줄에서 «그 엔진의» 옵션 목록을 다시 잰다.**
 *
 * ⚠⚠ 2026-09-10 개발센터 4-AI 관문 — Codex 발견 3 · 독립 Claude 발견 1(2회차 F 가 안 죽은 것).
 *   웰릭스는 G80 을 「가솔린 2.5/3.5 터보」 **한 덩어리**로 묶어 두어, `availableOptions` 가
 *   **2.5T 목록으로 고정**돼 있었다. 그래서 G80 **3.5T** 줄에서:
 *     · 「20" 피렐리(**2.5T** - 프리뷰 ECS 포함) **300만**」을 살 수 있고
 *     · 정작 「20" 피렐리(**3.5T 전용**) **70만**」과 「스포츠 패키지(3.5T) **560만**」은 **못 산다.**
 *   ⇒ 손님이 **틀린 휠을 4.3배 값**에 사고, 560만짜리는 팔 길이 없다.
 *
 * ★근거는 정본이 옵션마다 적어 둔 «엔진 표기»다 — `sub` 의 「2.5T -」·「3.5T 전용」·「(2.5T)」.
 * ⚠ 엔진을 «안 적은» 옵션은 손대지 않는다 — 원래 목록 그대로 둔다(모르는 것을 고르지 않는다).
 */
/* ★엔진 표기를 «뜻까지» 읽는다 — 뒤따르는 몇 글자가 뜻을 가른다.
   ⚠⚠ 2026-09-11 K9 로 드러난 «거꾸로 읽기». 처음엔 「3.3T」만 떼어 내고 뒤를 안 봐서
     「3.3T **기본**」(= 3.3T 에선 기본 포함이라 **안 판다**)을 「3.3T **전용**」으로 읽었다. 그래서:
       · 3.3T 줄에서 이미 들어 있는 것을 **또 팔고**
       · 3.8 줄에서는 「3.3T 것」이라며 **진짜 유료 99만·79만을 지웠다** — 둘 다 반대다.
     정본이 같은 칸에 「3.8 가솔린 베스트 셀렉션 Ⅰ**만 옵션**」이라고 «판다»고 적어 두었는데도 지웠다.
   ⇒ 「기본」이 붙은 엔진 = 그 엔진에선 **빼고**, 다른 엔진에 대해선 **아무 말도 안 한 것**으로 본다
     (원래 목록을 그대로 둔다 — 모르는 것을 고르지 않는다).
   ⇒ 「전용」·「(2.5T)」·「2.5T -」 처럼 «기본»이 아닌 표기 = 그 엔진 것 → 거기서만 연다. */
const ENGINE_TAG = /([1-6]\.[0-9])\s*T\s*([^,)\]]{0,4})/gi;
/** 표기 뒤 몇 글자가 「기본」이면 «그 엔진에선 기본 포함(안 판다)»는 뜻이다. */
const isStdSense = (follow: string) => /기본/.test(S(follow));

export function availableForEngine(
  om: Record<string, { name?: string; sub?: string }>,
  available: string[] | undefined,
  engine: string,
): string[] | undefined {
  const mine = /([1-6]\.[0-9])/.exec(S(engine))?.[1];
  if (!mine || !om) return available;
  const had = new Set(available ?? Object.keys(om));
  const out: string[] = [];
  for (const [id, o] of Object.entries(om)) {
    const text = `${S(o.name)} ${S(o.sub)}`;
    const std = new Set<string>();     // 「N.NT 기본」 — 그 엔진에선 기본 포함이라 «안 판다»
    const excl = new Set<string>();    // 「N.NT 전용」·「(N.NT)」 — 그 엔진 «것»이다
    for (const m of text.matchAll(ENGINE_TAG)) {
      const follow = S(m[2]);
      /* ⚠ 「G 2.5 **T-GDI**+8단 습식DCT」 — 이건 엔진 «이름»이지 「어느 엔진에서 파느냐」가 아니다.
         이걸 「2.5T 전용」으로 읽으면 「2.5 터보 퍼포먼스 200만」이 **1.6T 줄에서 사라진다** —
         그건 1.6T 에서 2.5T 로 «올리는» 옵션이라 정확히 거기서 판다
         (현대 공식가 쏘나타 N Line 1.6T 3,726만 → 2.5T 3,926만, 차이가 정확히 200만). */
      if (/^-\s*GD/i.test(follow)) continue;
      /* ⚠ 「(1.6T 가솔린 / HEV)」 — 빗금으로 «연료를 나열» 말은 「그 엔진 전용」이 아니다.
         1.6T 가솔린«과» HEV 둘 다라는 뜻이라, 「1.6 전용」으로 줄여 읽으면 HEV 줄에서 HTRAC 203만이 사라진다.
         ⚠ 오늘 데이터에서 이 꼴로 실제로 지워지는 줄은 **0개**다(실측). 그래도 두는 까닭은
           ① 그 문자열이 지금 데이터에 **실제로 있고**(HTRAC 의 sub),
           ② 이 가지는 «지우지 않는» 쪽으로만 움직이기 때문이다. §39 가 그 «읽기»를 직접 재다.
         ★연료말이 들어간 빗금만 본다 — 「18/19"」 같은 치수 나열은 여기 해당 없다(좌우 어느 쪽으로도 답이 같다). */
      if (/\/\s*(HEV|EV|가솔린|디젤|LPG|하이브리드|전기)/i.test(follow)
        || /(HEV|EV|가솔린|디젤|LPG|하이브리드|전기)\s*\//i.test(follow)) continue;
      (isStdSense(follow) ? std : excl).add(m[1]);
    }
    if (std.has(mine)) continue;                                    // 내 엔진에 기본 포함 → 안 판다
    if (!excl.size) { if (had.has(id)) out.push(id); continue; }    // 전용 표기가 없다 → 원래 목록 그대로
    if (excl.has(mine)) out.push(id);                               // 내 엔진 전용 → «없던 것도» 연다
    // 다른 엔진 «전용»만 적혀 있으면 뺀다(넣지 않는다)
  }
  return out;
}
