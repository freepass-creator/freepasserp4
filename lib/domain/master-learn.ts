/**
 * 차종마스터 학습 엔진 — **규칙으로 뽑는다. 손으로 적지 않는다.**
 *
 * ★왜 만들었나(사장님 지적 2026-08-09)
 *   「이게 뭐 맞나 딱 하는 게 중요한 게 아니라 로직을 짜야 한다.」
 *   맞다. 앞서 트림 5건·파워트레인 8건을 스크립트에 **손으로 적어 넣었는데**,
 *   결손은 지금만 112건이고 매물이 들어올 때마다 계속 생긴다. 목록은 안 늘어난다.
 *   그래서 «무엇을 넣을지»를 사람이 적는 대신 **판정 규칙**을 여기 둔다.
 *
 * ★근거의 주인 (세대 수명으로 갈린다)
 *   신차로 팔리는 세대 → 신차견적기 · 풀체인지로 밀려난 세대 → 엔카 중고
 *
 * ★축을 가르는 기준 하나
 *   엔카 4단은 제조사 → Model(세대) → **Badge(파워트레인)** → **BadgeDetail(트림)** 이다.
 *   Badge 를 트림 자리로 끌어올리면 「2.5T 가솔린 AWD」가 트림이 된다(실측: 결손이 829건으로 부풀었다).
 *   BadgeDetail 이 비면 **그 차는 트림이 없다는 뜻**이다 — 요즘 제네시스가 그렇다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 엔카 한 조합(중복 제거된 분류 튜플). */
export type EncarTuple = {
  maker: string;
  sub_model: string;
  badge: string;
  badge_detail: string;
  fuel?: string;
  year_min?: number;
  year_max?: number;
  n: number;
};

export type LearnRules = {
  /** 이 대수 미만이면 오등록으로 본다. 한 대짜리 오타가 마스터에 트림을 만든다. */
  minListings: number;
  /** 마스터 범위 — 최근 N년에 «걸치는» 세대만 손본다(단종이 이 안이면 아직 도로에 있다). */
  years: number;
  nowYear: number;
};

export const DEFAULT_RULES: LearnRules = { minListings: 3, years: 10, nowYear: 2026 };

/** 그 세대가 마스터 범위 안인가 — 단종연도가 기준 안이면 살아 있는 차다. */
export function inScope(yearEnd: unknown, rules: LearnRules = DEFAULT_RULES): boolean {
  const end = /^\d{4}$/.test(S(yearEnd)) ? Number(S(yearEnd)) : rules.nowYear;
  return end >= rules.nowYear - rules.years;
}

/**
 * 트림이 아닌 값 — 엔카가 트림 칸에 실어 보내지만 우리 축으로는 다른 것.
 * 인승·개조이력·용도는 트림이 아니다.
 */
const NOT_TRIM = /^\s*(\d+\s*인승|구조변경|특장|하이리무진|리무진|택시|장애인|영업용|자가용|밴|무사고)/;

/**
 * 꼬리표 — 같은 트림을 판매 경로로 나눠 부르는 말.
 * 「트렌디(택시형)」·「트렌디(렌터카)」는 **같은 트림**이다. 우리는 경로를 트림으로 나누지 않는다.
 */
const SALES_TAG = /\s*[（(]\s*(택시형?|렌터카용?|영업용|일반인\s*구입|법인|개인)\s*[)）]\s*/g;

/**
 * 등급 꼬리번호 — 엔카 「비즈니스 1」·「플래티넘Ⅱ」.
 * 마스터는 번호 없이 적는 게 관례라, 번호만 다른 것은 같은 트림으로 본다.
 */
// ⚠ 접기는 소문자로 먼저 내린다 — 그때 전각 로마숫자 「Ⅱ」가 「ⅱ」가 된다(U+2161→U+2171).
//   대문자만 적어 두면 「플래티넘Ⅱ」를 영영 못 잡는다. 유니코드 로마숫자 구간을 통째로 본다.
const GRADE_SUFFIX = /\s*(\d{1,2}|[Ⅰ-ⅿ]{1,4}|[ivx]{1,4})\s*$/i;

/**
 * 세대를 가리키는 말은 트림이 아니다.
 * 엔카가 트림 칸에 세대 표기를 넣는 경우가 있다 — 「2세대」·「WK2」·「970」(파나메라).
 * 그대로 넣으면 마스터에 «세대라는 이름의 트림»이 생긴다(실측 2026-08-09).
 */
const GEN_LIKE = /^([1-9]\s*세대|[A-Z]{1,3}\d{1,3}[A-Z]?|\d{3,4})$/;

/** 우리 규격 트림 표기로 다듬는다. 엔카 표기를 그대로 쓰지 않는다. */
export function normalizeTrim(raw: string): string {
  let t = S(raw).replace(SALES_TAG, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!t || /없음/.test(t)) return '';
  t = t.replace(/^\s*\d+\s*인승\s*/, '').trim();
  if (NOT_TRIM.test(t)) return '';
  if (GEN_LIKE.test(t)) return '';
  return t;
}

/**
 * 영문↔한글 이표기 — 비교할 때만 쓴다.
 * 「GT Line」과 「GT라인」은 같은 트림인데, 접지 않으면 결손과 «우리만»에 **양쪽 계상**된다.
 */
const CMP_WORDS: Array<[RegExp, string]> = [
  [/line/g, '라인'], [/black/g, '블랙'], [/edition/g, '에디션'], [/special/g, '스페셜'],
  [/premium/g, '프리미엄'], [/luxury/g, '럭셔리'], [/signature/g, '시그니처'],
  [/prestige/g, '프레스티지'], [/noblesse/g, '노블레스'], [/exclusive/g, '익스클루시브'],
  [/standard/g, '스탠다드'], [/modern/g, '모던'], [/smart/g, '스마트'], [/trendy/g, '트렌디'],
];

/** 비교용 접기 — 표기 차이를 지운다. 저장은 언제나 마스터 표기로 한다. */
export function foldTrim(raw: string): string {
  let t = S(raw).toLowerCase()
    .replace(/플러스/g, 'plus').replace(/\+/g, 'plus');
  for (const [re, ko] of CMP_WORDS) t = t.replace(re, ko);
  return t.replace(GRADE_SUFFIX, '').replace(/[\s\-_()[\]{}/·.,]/g, '');
}

export type TrimProposal = {
  sub: string;
  trim: string;
  /** 그 트림이 실제로 붙어 나온 파워트레인(엔카 Badge) — 어느 variant 에 넣을지의 근거. */
  badges: string[];
  listings: number;
  why: string;
};

/**
 * 트림 결손 제안 — 규칙만으로 뽑는다.
 *
 * 넣는 조건 넷을 **다 통과**해야 한다:
 *   ① BadgeDetail 에서 왔다(=진짜 트림)  ② 매물 문턱 이상  ③ 세대가 마스터 범위 안
 *   ④ 마스터 그 세대에 **접어서 비교해도** 없다
 */
export function proposeTrims(
  tuples: EncarTuple[],
  masterTrimsOf: (sub: string) => string[],
  yearEndOf: (sub: string) => string,
  subOf: (t: EncarTuple) => string | null,
  rules: LearnRules = DEFAULT_RULES,
): TrimProposal[] {
  const acc = new Map<string, TrimProposal>();
  for (const t of tuples) {
    const sub = subOf(t);
    if (!sub) continue;
    if (!inScope(yearEndOf(sub), rules)) continue;
    const trim = normalizeTrim(t.badge_detail);   // ★Badge 로 폴백하지 않는다
    if (!trim) continue;
    /**
     * ★세대 이름 안에 든 말은 트림이 아니다.
     * 「뉴 티구안 5N」의 「5N」, 「파나메라 970」의 「970」처럼 세대코드가 트림 칸에 온다.
     * 코드 모양을 일일이 정규식으로 적는 대신 «그 말이 세대 이름에 있나»로 가른다 —
     * 모양이 제각각이라 목록으로는 못 따라간다.
     */
    if (foldTrim(sub).includes(foldTrim(trim))) continue;
    const have = new Set(masterTrimsOf(sub).map(foldTrim));
    if (have.has(foldTrim(trim))) continue;
    const key = `${sub}|${foldTrim(trim)}`;
    const hit = acc.get(key) || { sub, trim, badges: [], listings: 0, why: '' };
    hit.listings += Number(t.n) || 0;
    const badge = S(t.badge);
    if (badge && !hit.badges.includes(badge)) hit.badges.push(badge);
    acc.set(key, hit);
  }
  return [...acc.values()]
    .filter((p) => p.listings >= rules.minListings)
    .map((p) => ({ ...p, why: `엔카 BadgeDetail ${p.listings}대 · badge[${p.badges.join(' / ')}]` }))
    .sort((a, b) => b.listings - a.listings);
}

/**
 * 파워트레인 «사양명(라인)» 어휘 — 용량·구동이 아닌 말로 파워트레인을 부르는 것들.
 * 이 말이 Badge 에 있는데 우리 variant 라벨엔 없으면, 그 축을 담을 자리가 없다는 뜻이다.
 */
export const LINE_VOCAB = ['롱레인지', '스탠다드', '퍼포먼스', 'RS', 'ACTIV', 'GT'] as const;
const LINE_RE: Record<string, RegExp> = {
  롱레인지: /롱\s*레인지|long\s*range/i,
  스탠다드: /스탠\s*다드|스탠\s*더드|standard/i,
  퍼포먼스: /퍼포먼스|performance/i,
  RS: /(^|[^a-z])rs([^a-z]|$)/i,
  ACTIV: /(^|[^a-z])activ(e)?([^a-z]|$)|액티브/i,
  // 「GT라인」은 트림이다 — 뒤에 라인/Line 이 붙으면 라인 어휘가 아니다.
  GT: /(^|[^a-z])gt(?!\s*(라인|line))([^a-z]|$)/i,
};

/** 그 글에 들어 있는 라인 어휘. 원문·마스터 라벨 양쪽을 같은 잣대로 읽는다. */
export function linesIn(text: unknown): string[] {
  const t = S(text);
  if (!t) return [];
  return LINE_VOCAB.filter((k) => LINE_RE[k].test(t));
}

export type VariantProposal = {
  sub: string;
  line: string;
  badges: string[];
  listings: number;
  /** 그 라인 아래 실제로 붙는 트림(엔카 BadgeDetail). 축만 만들면 트림이 빈 채로 남는다. */
  trims: string[];
  why: string;
};

/**
 * 파워트레인 축 결손 제안 — 「그 라인을 담을 variant 가 우리에게 있나」만 본다.
 * 용량·구동 조합 차이는 여기서 다루지 않는다(그건 표기 차이지 축 결손이 아니다).
 */
export function proposeVariants(
  tuples: EncarTuple[],
  masterVariantLabelsOf: (sub: string) => string[],
  yearEndOf: (sub: string) => string,
  subOf: (t: EncarTuple) => string | null,
  rules: LearnRules = DEFAULT_RULES,
): VariantProposal[] {
  const acc = new Map<string, VariantProposal>();
  for (const t of tuples) {
    const sub = subOf(t);
    if (!sub) continue;
    if (!inScope(yearEndOf(sub), rules)) continue;
    const lines = linesIn(t.badge);
    if (!lines.length) continue;
    /**
     * ★세대 이름에 이미 든 라인 어휘는 «축 결손»이 아니다.
     * 「3시리즈 GT F34」의 GT 는 그 차의 이름이지 파워트레인 라인이 아니다 —
     * 빼지 않으면 BMW GT 계열이 통째로 결손으로 잡힌다(실측 2026-08-09).
     */
    const ours = masterVariantLabelsOf(sub);
    const covered = new Set([...ours.flatMap((l) => linesIn(l)), ...linesIn(sub)]);
    for (const line of lines) {
      if (covered.has(line)) continue;
      const key = `${sub}|${line}`;
      const hit = acc.get(key) || { sub, line, badges: [], listings: 0, trims: [], why: '' };
      hit.listings += Number(t.n) || 0;
      const badge = S(t.badge);
      if (badge && !hit.badges.includes(badge)) hit.badges.push(badge);
      const trim = normalizeTrim(t.badge_detail);
      if (trim && !hit.trims.includes(trim)) hit.trims.push(trim);
      acc.set(key, hit);
    }
  }
  return [...acc.values()]
    .filter((p) => p.listings >= rules.minListings)
    .map((p) => ({ ...p, why: `엔카 Badge ${p.listings}대 · [${p.badges.join(' / ')}]` }))
    .sort((a, b) => b.listings - a.listings);
}
