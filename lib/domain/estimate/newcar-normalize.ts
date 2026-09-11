/**
 * 신차마스터 «이름 정제» — 제조사마다 제각각인 표기를 한 규격으로 모은다.
 *
 * ★★사장님 2026-09-09 「**여기도 SSOT 에서 제대로 갖고와야 한다**」 · 「**제대로 쌓아올려봐**」
 *
 * ⚠⚠ **이름이 지저분하면 어느 원천과도 못 붙는다.** 2026-09-09 실측 —
 *   웰릭스 조합지도(옵션 배타·선행·배제)와 맞대 보니 우리 트림 438 중 **완전일치가 118(27%)** 뿐이었다.
 *   붙지 않은 까닭이 데이터가 없어서가 아니라 «이름»이었다:
 *     · 기아 `sub_model` 이 영문 슬러그(`carnival`·`ev3`)
 *     · 연료 어순이 뒤집힘 — 기아 「3.5 가솔린」 ↔ 현대 「가솔린 3.5」
 *     · 같은 뜻 다른 말 — 「전기모터」·「전기차」·「EV」 / 「1.6T-GDi」·「1.6 T-GDi(N라인)」·「1.6 터보」
 *     · 배기량이 없는 「하이브리드」 84줄
 *
 * ★규격(현대 표기를 따른다): **`{연료} {배기량}{ 터보}`**
 *     「가솔린 2.5」 · 「가솔린 1.6 터보」 · 「하이브리드 1.6 터보」 · 「LPG 3.5」 · 「전기」 · 「디젤 2.2」
 *   ⚠ **없는 배기량을 지어내지 않는다** — 원천이 안 주면 「하이브리드」로 둔다.
 *
 * ★★탭 라벨이 늘 «연료»인 것은 아니다(기아 공식 실측) —
 *     「9인승」·「7인승」·「9인승 하이루프」(카니발=좌석) · 「2WD」·「4WD」(EV9=구동) · 「1.0 가솔린(밴)」(모닝=차종)
 *   ⇒ 연료로 읽을 수 있는 만큼만 연료로 읽고, **나머지는 트림 꼬리로 옮긴다.**
 *     안 옮기면 같은 트림명이 값만 다른 채로 두 줄이 된다(EV9 「라이트 롱레인지」 6,987 ↔ 7,354).
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 연료 갈래 — 화면·엔진이 쓰는 `engineFuel()` 과 같은 낱말을 쓴다. */
const FUEL_WORDS: [RegExp, string][] = [
  [/수소/, '수소'],
  [/전기|electric|^ev\d?$|전기모터|전기차/i, '전기'],
  [/플러그인|phev/i, '플러그인 하이브리드'],
  [/하이브리드|hev/i, '하이브리드'],
  [/lpg|lpi/i, 'LPG'],
  [/디젤|diesel/i, '디젤'],
  [/가솔린|gasoline|gdi/i, '가솔린'],
];

/** 배기량 — 「2.5」·「1.6」. 「19인치」·「48V」 같은 숫자는 안 걸린다(소수점 한 자리만 본다). */
export function displacementOf(label: string): string {
  return /(?:^|[^0-9.])([1-6]\.[0-9])(?![0-9])/.exec(S(label))?.[1] ?? '';
}

/**
 * 라벨 하나를 **연료**와 **트림 꼬리**로 가른다.
 * `evHint` 는 모델이 전기차임을 아는 경우(슬러그가 `ev*`)에만 넘긴다 — 「2WD」만 보고는 전기인지 모른다.
 */
export function splitAxis(label: string, evHint = false): { fuel: string; trimSuffix: string } {
  const raw = S(label);
  if (!raw) return { fuel: '', trimSuffix: '' };

  let word = '';
  for (const [re, w] of FUEL_WORDS) { if (re.test(raw)) { word = w; break; } }
  if (!word && evHint) word = '전기';

  const disp = word === '전기' || word === '수소' ? '' : displacementOf(raw);
  const turbo = /터보|turbo|t-gdi|\d\.\dT\b/i.test(raw) ? ' 터보' : '';
  const fuel = word ? `${word}${disp ? ` ${disp}` : ''}${turbo}` : '';

  /**
   * 연료로 안 읽힌 «축»은 트림 꼬리로 옮긴다 — 좌석(9인승)·구동(2WD·전자식4WD)·차종(밴).
   * ⚠ 이미 트림 이름에 들어 있으면 부르는 쪽이 안 붙인다(`withSuffix` 가 겹침을 막는다).
   */
  const bits: string[] = [];
  /* ⚠ 숫자를 «다» 잡는다 — `\d인승` 은 「11인승」에서 「1인승」만 떼어 좌석 수를 바꿔 버린다
     (2026-09-09 코덱스 검수에서 잡혔다. 카니발·스타리아에 11인승이 실제로 있다). */
  for (const m of raw.matchAll(/(\d{1,2}인승?|전자식\s*4WD|2WD|4WD|AWD|하이루프|밴)/gi)) bits.push(S(m[1]).replace(/\s+/g, ''));
  // 「1인승 밴」처럼 둘이 붙어 오면 통째로 한 꼬리다.
  const trimSuffix = [...new Set(bits)].join(' ');
  return { fuel, trimSuffix };
}

/** 트림 이름에 꼬리를 붙인다 — 이미 들어 있으면 안 붙인다(「프레스티지(9인)」에 「9인승」을 또 붙이지 않게). */
export function withSuffix(trim: string, suffix: string): string {
  const t = S(trim);
  if (!suffix) return t;
  const flat = t.replace(/\s/g, '');
  const parts = suffix.split(' ').filter((s) => s && !flat.includes(s.replace(/승$/, '')));
  if (!parts.length) return t;
  /* ⚠ 이름에 이미 괄호가 있으면 «그 안»에 합친다 — 안 그러면 「노블레스(9인승)(하이루프)」가 된다. */
  const m = /^(.*)\(([^()]*)\)\s*$/.exec(t);
  if (m) return `${m[1].trim()}(${[m[2].trim(), ...parts].filter(Boolean).join(' ')})`;
  return `${t}(${parts.join(' ')})`;
}

/**
 * 연료 라벨을 규격으로 모은다 — 이미 실려 있는 값을 «다시 적는» 용도.
 * 「1.6 가솔린 터보」→「가솔린 1.6 터보」 · 「전기모터」·「전기차」·「EV」→「전기」 ·
 * 「가솔린 1.6T-GDi」·「가솔린 1.6 T-GDi(N라인)」→「가솔린 1.6 터보」
 * ⚠ 못 읽으면 **원문 그대로 둔다** — 지어내지 않는다.
 */
export function canonFuel(label: string): string {
  const { fuel } = splitAxis(label);
  return fuel || S(label);
}

/** 기아 슬러그(`carnival`)를 한글 모델명으로 — 별칭표(`data/model-aliases.json`)가 정본이다. */
export function koFromAliases(aliases: Record<string, string[]>, slug: string): string {
  const n = (s: string) => S(s).toLowerCase().replace(/[\s\-_()·]/g, '');
  const want = n(slug);
  for (const [ko, arr] of Object.entries(aliases ?? {})) {
    if (n(ko) === want) return ko;
    for (const a of arr ?? []) if (n(a) === want) return ko;
  }
  return S(slug);
}
