/**
 * 세부트림 확정 — **좁혀진 후보 안에서 여러 방법으로 찾는다.**
 *
 * ★전제(2026-08-09 사장님)
 *   모델 → 세부모델 → 파워트레인 → 세부트림 순으로 좁히면 **끝에는 선택지가 몇 개 안 남는다.**
 *   그러니 「못 잡을 이유가 없다」. 지금 못 잡는 건 방법이 하나뿐이어서다 —
 *   문자열 포함 검사 하나로만 보고, 3글자 미만은 아예 건너뛰었다.
 *
 * ★그래서 방법을 늘린다(위에서부터, 먼저 맞는 것을 쓴다)
 *   1. 그대로 포함        「… 4도어 A/T 모던」 ⊃ 「모던」
 *   2. 영문·표기 별칭      Prestige→프레스티지 · Exclusive→익스클루시브 · Signature→시그니처
 *   3. 오탈자 교정        「엑스클루시브」·「프레스티쥐」·「인스퍼레션」
 *   4. 초성               「ㅍㄹㅅㅌㅈ」→프레스티지 · 「ㅇㅅㅋㄹㅅㅂ」→익스클루시브
 *   5. 근접 유사도         편집거리 기반, 후보가 적을수록 문턱을 낮춘다
 *
 * ★후보가 적을수록 과감하게
 *   후보 2개 중 하나를 고르는 것과 20개 중 하나를 고르는 것은 위험이 다르다.
 *   `threshold()` 가 후보 수에 따라 문턱을 조절한다 — 좁혀졌으면 믿는다.
 */

import { isForbiddenAsTrim } from '@/lib/domain/vehicle-field-guards';

const S = (v: unknown): string => String(v ?? '').trim();
/**
 * 비교용 접기.
 *
 * ★「+」는 「Plus」·「플러스」와 같은 말이다.
 *   실측 2026-08-09: 원문 「스탠다드 19인치(E-VALUE+)」가 마스터 트림 「E-Value Plus」에
 *   안 닿았다 — 「+」만 남기고 지우지도 않아 `evalue+` ≠ `evalueplus` 였다.
 *   세 표기를 모두 `plus` 로 모아 같은 말로 만든다(「프리미엄+」=「프리미엄 플러스」).
 */
const flat = (v: string): string => v.toLowerCase()
  .replace(/플러스/g, 'plus')
  .replace(/\+/g, 'plus')
  // X라인·N라인 ↔ X-Line·N Line (엔카/시트 혼용)
  .replace(/라인/g, 'line')
  .replace(/[\s\-_()/·.]/g, '');

/** 영문·외래 표기 → 한글 트림. 공급사가 원문 그대로 적는 경우가 많다. */
export const TRIM_ALIAS: Record<string, string> = {
  prestige: '프레스티지',
  exclusive: '익스클루시브',
  signature: '시그니처',
  noblesse: '노블레스',
  luxury: '럭셔리',
  deluxe: '디럭스',
  smart: '스마트',
  modern: '모던',
  premium: '프리미엄',
  inspiration: '인스퍼레이션',
  standard: '스탠다드',
  trendy: '트렌디',
  calligraphy: '캘리그래피',
  gravity: '그래비티',
  earth: '어스',
  air: '에어',
  light: '라이트',
  business: '비즈니스',
  style: '스타일',
  family: '패밀리',
  millennial: '밀레니얼',
  avantgarde: '아방가르드',
  ultimate: '얼티메이트',
  limited: '리미티드',
  convenience: '컨비니언스',
  leblanc: '르블랑',
  // 실측 2026-08-09: 르노 아르카나 6대가 「GTe Iconic」으로 들어온다(마스터는 「GTe 아이코닉」).
  iconic: '아이코닉',
  // 재고 원문 「Finest」 → 마스터 「파이니스트」(G80 DH)
  finest: '파이니스트',
  // 테슬라 원문 「Long Range」(10호3819) → 「롱 레인지」
  longrange: '롱 레인지',
  'long range': '롱 레인지',
};

/**
 * 통째로 갈아끼울 때만 쓰는 별칭 — «홀로 서면 다른 등급»이 되는 말들.
 *
 * 「sport」를 느슨하게 풀면 BMW 「M 스포츠」가 민등급 「스포츠」로 **깎인다**.
 * 그래서 이 표는 아래 2-a(번역 후 트림 전체가 그대로 있는지)에서만 보고,
 * 2-b의 느슨한 낱말 찾기에는 쓰지 않는다.
 */
export const TRIM_ALIAS_STRICT: Record<string, string> = {
  // 실측 2026-08-09: 캐딜락 XT6 이 「6인승 sport」로 들어온다(마스터는 「스포츠」).
  sport: '스포츠',
  // BMW 원문 「520i M Spt」(109호4100) → 「520i M 스포츠」
  spt: '스포츠',
};

/**
 * 자주 나오는 오탈자·이표기 → 정본. 공급사가 손으로 적어 생긴다.
 * ★실데이터에서 확인된 것만 넣는다(2026-08-09 실측) — 상상으로 늘리면 오탐이 는다.
 */
export const TRIM_TYPO: Record<string, string> = {
  엑스클루시브: '익스클루시브',
  익스클루시부: '익스클루시브',
  익스클루씨브: '익스클루시브',
  프레스티쥐: '프레스티지',
  프리스티지: '프레스티지',
  // 실측: 셀토스 5대가 「프레스지티」로 적혀 있었다(글자 순서 뒤바뀜).
  프레스지티: '프레스티지',
  프래스티지: '프레스티지',
  // 실측 2026-08-09 오탈자 스캔: 골프 8세대.
  프레스트지: '프레스티지',
  인스퍼레션: '인스퍼레이션',
  인스피레이션: '인스퍼레이션',
  // 「인스파레이션」도 흔한 표기다(사장님 지적 2026-08-09).
  인스파레이션: '인스퍼레이션',
  인스퍼레이숀: '인스퍼레이션',
  노불레스: '노블레스',
  노블레쓰: '노블레스',
  시그네처: '시그니처',
  시그니쳐: '시그니처',
  // 실측 2026-08-09 오탈자 스캔: G90.
  시그지쳐: '시그니처',
  시그니져: '시그니처',
  캘리그라피: '캘리그래피',
  스탠더드: '스탠다드',
  스텐다드: '스탠다드',
  트랜디: '트렌디',
  럭쉬리: '럭셔리',
  // 실측: 쏘나타 DN8 9대가 「비지니스」·「비지니스1/2」로 적혀 있었다.
  비지니스: '비즈니스',
  비즈니쓰: '비즈니스',
  셀렉숀: '셀렉션',
  샐렉션: '셀렉션',
  그라비티: '그래비티',
  얼티메이드: '얼티메이트',
};

/**
 * 트림 뒤에 붙는 **등급 번호**. 「비즈니스 2」·「비지니스1」처럼 공급사가 붙여 온다.
 * 마스터 트림에 번호가 없으면 떼고 맞춘다 — 번호 때문에 통째로 못 잡으면 안 된다.
 */
export function stripGradeNumber(text: string): string {
  return S(text).replace(/\s*[0-9]\s*$/, '').trim();
}

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 한글 문자열 → 초성. 「프레스티지」→「ㅍㄹㅅㅌㅈ」 */
export function chosung(text: string): string {
  let out = '';
  for (const ch of S(text)) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code <= 11171) out += CHO[Math.floor(code / 588)];
    else if (/[ㄱ-ㅎ]/.test(ch)) out += ch;
  }
  return out;
}

/** 편집거리(0~1 유사도). */
export function similarity(a: string, b: string): number {
  const x = flat(a);
  const y = flat(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const m = x.length;
  const n = y.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
  }
  return 1 - d[m][n] / Math.max(m, n);
}

/**
 * 후보 수에 따른 유사도 문턱.
 * 2개 중 고르는 건 20개 중 고르는 것보다 안전하다 — 좁혀졌으면 과감하게 붙인다.
 */
export function threshold(candidateCount: number): number {
  /**
   * ★문턱을 낮추면 «다른 말»이 붙는다(실측 2026-08-09).
   *   0.75 에서 「아이오닉」이 「아이코닉」으로, 「레인지」가 「롱 레인지」로 붙었다.
   *   앞의 1~4단계(포함·별칭·오탈자·초성)가 정확한 경로이고, 유사도는 **마지막 보험**이다.
   *   보험이 과하면 사고를 만든다 — 못 잡는 것보다 틀리게 잡는 게 나쁘다.
   */
  if (candidateCount <= 2) return 0.82;
  if (candidateCount <= 5) return 0.86;
  if (candidateCount <= 10) return 0.90;
  return 0.93;
}

export type TrimHit = { trim: string; how: '그대로' | '별칭' | '오탈자' | '초성' | '유사도'; score: number };

/**
 * 좁혀진 후보 안에서 트림을 찾는다.
 * `text` 는 그 차를 설명하는 모든 글(원문 트림칸·차명칸·옵션 등)을 이어 붙인 것.
 */
export function resolveTrim(text: string, candidates: string[]): TrimHit | null {
  const cands = candidates.map(S).filter((t) => t && !isForbiddenAsTrim(t));
  if (!cands.length || !S(text)) return null;
  const blob = flat(text);
  const blobCho = chosung(text);

  /**
   * 합성어 접두 오탐 방어 — 「스마트스트림 … 모던」에서 「스마트」가
   * 「스마트스트림」접두로 이기면 안 된다(실측 2026-08-09 · 아반떼 CN7).
   * 합성어를 가린 뒤에도 후보가 남아 있을 때만 포함 매칭을 인정한다.
   */
  const COMPOUND_NOISE = [
    '스마트스트림', 'smartstream', '스마트키', '스마트크루즈', '스마트센스',
    '전기모터', '가솔린터보', '디젤터보', '디자인셀렉션', 'designselection',
  ];
  const blobBare = COMPOUND_NOISE.reduce((b, n) => b.split(flat(n)).join(' '), blob);

  const included = (ft: string): boolean => {
    if (ft.length < 2) return false;
    if (!blob.includes(ft)) return false;
    // 합성어 안에서만 보이면 탈락
    if (!blobBare.includes(ft) && COMPOUND_NOISE.some((n) => flat(n).includes(ft) && blob.includes(flat(n)))) {
      return false;
    }
    return true;
  };

  /**
   * 파워트레인 접두가 붙은 마스터 트림 — 원문에 접두·본등급이 떨어져 있어도 인정.
   * 실측: 「… E-Tech 1.5 터보 아이코닉 2WD」↔ 마스터「E-TECH 아이코닉」(그랑 콜레오스 ×11).
   * flat 후 `etech아이코닉`은 연속 부분문자열이 아니라 포함 검사가 실패한다.
   */
  const POWERTRAIN_TRIM_PREFIX = /^(?:etech|gte|tce|lpe|lpi)/;
  const trimCoreFlat = (ft: string): string => {
    if (!POWERTRAIN_TRIM_PREFIX.test(ft)) return ft;
    const core = ft.replace(POWERTRAIN_TRIM_PREFIX, '');
    return core.length >= 2 ? core : ft;
  };
  const includedCand = (t: string): boolean => {
    const ft = flat(t);
    if (included(ft)) return true;
    const core = trimCoreFlat(ft);
    if (core === ft) return false;
    // 접두 자체도 원문에 있을 때만(E-Tech·GTe…) — 접두 없이 본등급만으로 다른 계열 트림을 올리지 않음
    const prefix = ft.slice(0, ft.length - core.length);
    return !!prefix && blob.includes(prefix) && included(core);
  };

  /**
   * 패키지·옵션 조각 — 같은 원문에 본등급(스탠다드·시그니처…)이 있으면 진다.
   * 실측: 「스탠다드 19인치(E-VALUE+)」→ E-Value Plus 로 등급을 덮어씀(아이오닉5).
   */
  const isPackageLike = (t: string): boolean => {
    const f = flat(t);
    // 단독 조각만 — 「프리미엄 초이스」전체는 본등급으로 둔다
    if (/^(evalueplus|패키지|디자인|셀렉션|세단|초이스|베스트|plus)$/i.test(f)) return true;
    if (/베스트셀렉션|스마트셀렉션|디자인셀렉션|^evalue/i.test(f)) return true;
    return false;
  };

  /**
   * 구동 표기만인 트림 — 본등급(롱 레인지·퍼포먼스…)과 같이 있으면 진다.
   * 실측: 「Model 3 Premium Long Range RWD」(10호3819)에서 오른쪽 RWD 가
   * 「롱 레인지」를 덮어 RWD 로 굳었다.
   * 「프리미엄 롱레인지 RWD」처럼 끝에 구동만 붙은 노드도 본등급이 있으면 진다.
   */
  const isDrivetrainLike = (t: string): boolean => {
    const f = flat(t);
    if (/^(rwd|awd|fwd|2wd|4wd|후륜|전륜|사륜|4륜|후륜구동|전륜구동|사륜구동)$/i.test(f)) return true;
    return /(rwd|awd|fwd|2wd|4wd|후륜구동|전륜구동|사륜구동)$/i.test(f);
  };

  // 긴 트림부터 본다 — 「프리미엄 플러스」가 있는데 「프리미엄」을 먼저 집으면 안 된다.
  const sorted = [...cands].sort((a, b) => flat(b).length - flat(a).length);

  const pickFromHits = (hits: string[], hay: string, how: TrimHit['how'], score: number): TrimHit | null => {
    if (!hits.length) return null;
    const core = hits.filter((t) => !isPackageLike(t) && !isDrivetrainLike(t));
    let pool = core.length ? core : hits.filter((t) => !isPackageLike(t));
    if (!pool.length) pool = hits;
    pool = pool.filter((t) => !pool.some((o) => o !== t
      && flat(o).includes(flat(t))
      && flat(o).length > flat(t).length));
    let best = pool[0];
    let bestAt = -1;
    for (const t of pool) {
      const at = hay.lastIndexOf(flat(t));
      if (at > bestAt || (at === bestAt && flat(t).length > flat(best).length)) {
        bestAt = at;
        best = t;
      }
    }
    return best ? { trim: best, how, score } : null;
  };

  /** 영문 별칭을 먼저 풀어 둔 블롭 — 「M Spt」→「M 스포츠」가 「520i」부분일치에 먹히지 않게. */
  let aliased = blob;
  for (const [en, k] of [...Object.entries(TRIM_ALIAS), ...Object.entries(TRIM_ALIAS_STRICT)]) {
    const fe = flat(en);
    if (fe && aliased.includes(fe)) aliased = aliased.split(fe).join(flat(k));
  }

  // 1-a. 별칭 치환 후 포함 (Long Range·M Spt …)
  if (aliased !== blob) {
    const hit = pickFromHits(
      sorted.filter((t) => {
        const ft = flat(t);
        if (ft.length >= 2 && aliased.includes(ft)) return true;
        const core = trimCoreFlat(ft);
        if (core === ft) return false;
        const prefix = ft.slice(0, ft.length - core.length);
        return !!prefix && aliased.includes(prefix) && aliased.includes(core);
      }),
      aliased,
      '별칭',
      0.97,
    );
    if (hit) return hit;
  }

  // 1-b. 원문 그대로 포함 — 후보가 여럿이면 패키지 강등 · 짧은⊂긴 제거 · 오른쪽 우선
  // (E-TECH/GTe 접두 트림은 접두·본등급이 원문에 흩어져 있어도 포함으로 본다)
  {
    const hit = pickFromHits(
      sorted.filter((t) => includedCand(t)),
      blob,
      '그대로',
      1,
    );
    if (hit) return hit;
  }

  /**
   * 2~3단계는 «원문에 없는 말을 덧붙이면 안 된다».
   *
   * 「시그니처」라고만 적힌 원문에 후보 「시그니처 블랙」을 붙이면 **없는 등급을 파는 것**이다.
   * 그래서 별칭·오탈자로 바꾼 뒤에는 **정확히 같은 트림**을 먼저 찾고,
   * 없을 때만 그 말을 포함하는 트림을 본다(그 경우도 후보가 하나뿐일 때만).
   */
  const pickByWord = (word: string): string | null => {
    const exact = sorted.find((t) => flat(t) === flat(word));
    if (exact) return exact;
    const partial = sorted.filter((t) => flat(t).includes(flat(word)));
    return partial.length === 1 ? partial[0] : null;
  };

  // 2-b. 영문·외래 표기 별칭 — 낱말 하나로 후보를 가린다
  for (const [en, ko] of Object.entries(TRIM_ALIAS)) {
    if (!blob.includes(flat(en)) && !blob.includes(en)) continue;
    const hit = pickByWord(ko);
    if (hit) return { trim: hit, how: '별칭', score: 0.95 };
  }

  // 3. 오탈자 교정 — 「프레스지티」·「비지니스」
  for (const [typo, real] of Object.entries(TRIM_TYPO)) {
    if (!blob.includes(flat(typo))) continue;
    const hit = pickByWord(real);
    if (hit) return { trim: hit, how: '오탈자', score: 0.9 };
  }

  /**
   * 3-b. 등급 번호를 떼고 다시 본다 — 「비지니스2」→「비즈니스」.
   * 공급사가 같은 트림에 번호를 붙여 오는데 마스터엔 번호가 없다.
   * 번호 하나 때문에 통째로 못 잡는 건 아깝다.
   */
  for (const word of S(text).split(/[\s/·,()]+/)) {
    const base = stripGradeNumber(word);
    if (base.length < 2 || base === word) continue;
    const fixed = TRIM_TYPO[base] || base;
    const hit = pickByWord(fixed);
    if (hit) return { trim: hit, how: '오탈자', score: 0.88 };
  }

  /**
   * 4. 초성 — 「ㅍㄹㅅㅌㅈ」처럼 적어 오는 경우.
   *
   * ★숫자·영문이 든 트림에는 쓰지 않는다.
   *   초성은 한글만 보므로 「E200 아방가르드」와 「E300 아방가르드」가 똑같아진다 —
   *   그대로 두면 **등급을 올려 붙인다**(실측 2026-08-09 · 벤츠 E-클래스).
   *   그런 트림은 숫자가 등급 자체라 초성으로 가릴 수 없다.
   */
  if (blobCho.length >= 3) {
    for (const t of sorted) {
      if (/[0-9A-Za-z]/.test(t)) continue;
      const tc = chosung(t);
      if (tc.length >= 3 && blobCho.includes(tc)) return { trim: t, how: '초성', score: 0.85 };
    }
  }

  /**
   * 5. 근접 유사도 — **마지막 보험**이다. 앞 단계가 정확한 경로다.
   *
   * 원문의 «마지막 낱말들»이 트림일 가능성이 높다. 다만 모델명·세대명은 후보에서 뺀다 —
   * 「E클래스」가 트림 「E 클래식」에, 「아이오닉」이 「아이코닉」에 붙는 사고가 난다(실측 2026-08-09).
   */
  const MODELISH = /클래스|시리즈|아이오닉|아반떼|쏘나타|그랜저|카니발|싼타페|스포티지|셀토스|팰리세이드|투싼|코나|레이|모닝|니로|스팅어|제네시스/;
  const words = S(text).split(/[\s/·,]+/)
    .filter((w) => w.length >= 2 && !MODELISH.test(w));
  const tail = words.slice(-4);
  let best: TrimHit | null = null;
  const min = threshold(cands.length);
  for (const t of sorted) {
    for (const w of tail) {
      const score = similarity(w, t);
      if (score >= min && (!best || score > best.score)) best = { trim: t, how: '유사도', score };
    }
  }
  return best;
}
