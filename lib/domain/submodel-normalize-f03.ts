/**
 * 세부모델 정규화 — 후보 생성 후 F03 집합에 있는 형태만 받는다. 추정 없음.
 *
 * ① 모델 ② 연식 ③ 생산기간 겹치는 F03만 원문 대조(영/한 별칭) → 세부모델
 * ④ 그 세부모델 하위에서만 세부트림. 풀에 없으면 기본형.
 * 게이트: 세부모델∈F03 · 연식↔생산기간 · 트림∈그 세부모델 풀(또는 기본형).
 */
import { canonMakerDisplay } from './maker-display';
import { fold, type NameRow } from './encar-work-sheet-match';
import { MODEL_ALIAS } from './code-vs-name';
import extraModelAliases from '../../data/model-aliases.json';
import genHints from '../../data/gen-hints.json';

const S = (v: unknown) => String(v ?? '').trim();

const MAKER_LEAK = [
  '메르세데스벤츠', '메르세데스-벤츠', '메르세데스', '기아자동차', '현대자동차',
  'KG모빌리티', '르노코리아', '르노삼성', '한국지엠', '제네시스',
  '쉐보레', '쌍용', '기아', '현대', '벤츠', 'BMW', '아우디', '테슬라', '미니',
  '폭스바겐', '볼보', '캐딜락', '지프', '포르쉐', 'KGM', '르노', 'BYD', '폴스타',
].sort((a, b) => b.length - a.length);

const CODE_KEEP = new Set(['gt', 'lpg', 'hev', 'ev', 'suv', 'van', 'gdi', 'tdi', 'awd', 'rwd', 'fwd', 'phev']);

/** 기아 N세대→개발코드. 엔카에 세대명이 있을 때만(K5 JF/DL3). 단일세대(K8)는 표에 없음 — GL3 추측 금지. */
const KIA_GEN: Record<string, Record<number, string>> = {
  K5: { 1: 'TF', 2: 'JF', 3: 'DL3' },
  K3: { 2: 'BD', 3: 'BC' },
  K7: { 1: 'VG', 2: 'YG' },
  K9: { 1: 'KH', 2: 'RJ' },
  카니발: { 3: 'YP', 4: 'KA4' },
  쏘렌토: { 3: 'UM', 4: 'MQ4' },
  스포티지: { 4: 'QL', 5: 'NQ5' },
  모닝: { 3: 'JA' },
  니로: { 1: 'DE', 2: 'SG2' },
};

function unwrapParens(s: string): string {
  return S(s)
    .replace(/[（(]([^）)]*)[）)]/g, ' $1 ')
    .replace(/[()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandKiaGen(model: string, text: string): string {
  const table = KIA_GEN[model];
  let s = S(text);
  if (table) s = s.replace(/(\d+)\s*세대/g, (_, n) => table[Number(n)] || `${n}세대`);
  if (model === '카니발' && /^(올 뉴|더 뉴) 카니발(?:\s|$)/.test(s) && !/(YP|KA4)/.test(s)) {
    s = s.replace(/^(올 뉴|더 뉴) 카니발/, '$1 카니발 YP');
  }
  return s;
}

/** 원문 → F03형 후보(괄호 펼침·기아 세대코드). 원문 자체도 남긴다. */
export function sourceForms(raw: string, model: string): string[] {
  const src = S(raw);
  if (!src) return [];
  const out = new Set<string>();
  const push = (s: string) => { if (s) out.add(s); };
  push(src);
  const unwrapped = unwrapParens(src);
  push(unwrapped);
  push(expandKiaGen(model, src));
  push(expandKiaGen(model, unwrapped));
  return [...out];
}

export const SUB_NORM_RULE = 'sub-norm-r8-review-2026-08-29';

/** 원문 표기 → F03 표기. 산타페=싼타페 · RAV4=라브4 · E클래스=E-클래스. */
const SOURCE_ALIAS: [string, string][] = [
  ['산타페', '싼타페'],
  ['라브4', 'RAV4'],
  ['rav4', 'RAV4'],
  ['e클래스', 'E-클래스'],
  ['e-class', 'E-클래스'],
  ['e class', 'E-클래스'],
  ['s클래스', 'S-클래스'],
  ['c클래스', 'C-클래스'],
];

const GEN_HINTS: Record<string, Record<string, string>> = {
  'E-클래스': { '5세대': 'E-클래스 W213', '6세대': 'E-클래스 W214' },
  'C-클래스': { '4세대': 'C-클래스 W205', '5세대': 'C-클래스 W206' },
  쿠퍼: { '4세대C': '쿠퍼 C 4세대', '4세대S': '쿠퍼 S 4세대' },
  컨트리맨: { '3세대S': '쿠퍼 S 컨트리맨 3세대' },
  '2시리즈': { 그란쿠페: '2시리즈 그란쿠페 F44' },
};

export type SubNormTag = '원문직접근거' | '기존정제재검증' | '오매칭의심' | '검수대기';
export type SubNormResult = {
  tag: SubNormTag;
  picked: string;
  model: string;
  trim: string;
  maker: string;
  candidates: string[];
  inF03: string[];
  yearOk: boolean | null;
  note: string;
};

const HYUNDAI_GENESIS = new Set(['현대', '제네시스'].map(fold));

/** 원문 제조사 현대 ↔ F03 제네시스(G90 등). 모델·연식이 가리면 제조사 글자 때문에 F03를 버리지 않는다. */
export function makersAlign(a: string, b: string): boolean {
  const da = fold(canonMakerDisplay(a) || a);
  const db = fold(canonMakerDisplay(b) || b);
  if (!da || !db) return false;
  if (da === db || fold(a) === fold(b)) return true;
  return HYUNDAI_GENESIS.has(da) && HYUNDAI_GENESIS.has(db);
}

const PH = { 디올뉴: '\uE001', 올뉴: '\uE002', 더뉴: '\uE003', 신형: '\uE004' };

function protectPhrases(s: string): string {
  return S(s)
    .replace(/디\s*올\s*뉴/g, PH.디올뉴)
    .replace(/올\s*뉴/g, PH.올뉴)
    .replace(/더\s*뉴/g, PH.더뉴)
    .replace(/신형/g, PH.신형);
}
function restorePhrases(s: string): string {
  return S(s)
    .replace(new RegExp(PH.디올뉴, 'g'), '디 올 뉴')
    .replace(new RegExp(PH.올뉴, 'g'), '올 뉴')
    .replace(new RegExp(PH.더뉴, 'g'), '더 뉴')
    .replace(new RegExp(PH.신형, 'g'), '신형')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProtected(tok: string): boolean {
  return tok === PH.디올뉴 || tok === PH.올뉴 || tok === PH.더뉴 || tok === PH.신형;
}

function tokensOf(s: string): string[] {
  return protectPhrases(s).split(/\s+/).filter(Boolean);
}

function isCodeToken(tok: string): boolean {
  if (isProtected(tok)) return false;
  const u = tok.replace(/[()（）]/g, '');
  const f = fold(u);
  if (CODE_KEEP.has(f)) return false;
  if (/^(fl|페이스리프트)$/i.test(u) || /^f\/l$/i.test(u)) return false;
  return /^[A-Za-z]{1,3}\d{1,2}$/.test(u) || /^[A-Za-z]{2,4}$/.test(u);
}

function isFlToken(tok: string): boolean {
  const u = tok.replace(/[()（）]/g, '');
  return /^(fl|페이스리프트)$/i.test(u) || /^f\/l$/i.test(u);
}

function isMakerToken(tok: string, extraMakers: string[]): boolean {
  if (isProtected(tok)) return false;
  const f = fold(tok);
  return MAKER_LEAK.some((m) => fold(m) === f) || extraMakers.some((m) => fold(m) === f);
}

export function f03CodeTokens(subs: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const sub of subs) {
    for (const t of tokensOf(sub)) {
      if (isCodeToken(t)) out.add(fold(t));
    }
  }
  return out;
}

function tidy(tokens: string[]): string {
  return restorePhrases(tokens.filter(Boolean).join(' '));
}

/** FL·제조사누출은 항상 벗긴 뒤, F03가 안 쓰는 코드만 벗긴 조합. 올 뉴류는 토큰으로 안 지움. */
export function submodelCandidates(raw: string, usedCodes: Set<string>, extraMakers: string[] = []): string[] {
  const src = S(raw);
  if (!src) return [];
  const base = tokensOf(src);
  const noFl = base.filter((t) => !isFlToken(t));
  const noMaker = noFl.filter((t) => !isMakerToken(t, extraMakers));
  const firstName = noMaker.findIndex((t) => !isProtected(t) && !isFlToken(t) && !isMakerToken(t, extraMakers));
  const keepUsedCodes = noMaker.filter((t, i) => {
    if (i === firstName) return true;
    if (!isCodeToken(t)) return true;
    return usedCodes.has(fold(t));
  });
  const dropInfixCodes = noMaker.filter((t, i) => {
    if (i === firstName) return true;
    if (isProtected(t) || isFlToken(t) || isMakerToken(t, extraMakers)) return true;
    return !isCodeToken(t);
  });
  const variants = new Set<string>();
  const push = (toks: string[]) => {
    const s = tidy(toks);
    if (s) variants.add(s);
  };
  push(base);
  push(noFl);
  push(noMaker);
  push(keepUsedCodes);
  push(dropInfixCodes);
  return [...variants];
}

function ymOfPeriod(s: string, role: 'start' | 'end' = 'end'): number | null {
  const v = S(s);
  if (v === '현재') return 999912;
  if (v === '보류') return role === 'end' ? 999912 : null;
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

export function yearToRange(yearRaw: string): { from: number; to: number } | null {
  const blob = S(yearRaw);
  const y = /(\d{4})/.exec(blob);
  if (!y) return null;
  const n = Number(y[1]);
  if (n < 1990 || n > 2035) return null;
  const m = /(\d{4})\s*[.\-/]\s*(\d{1,2})/.exec(blob);
  if (m) {
    const mm = Math.min(12, Math.max(1, Number(m[2])));
    const ym = n * 100 + mm;
    return { from: ym, to: ym };
  }
  return { from: n * 100 + 1, to: n * 100 + 12 };
}

function periodOverlaps(year: { from: number; to: number } | null, start: string, end: string): boolean | null {
  if (!year) return null;
  const a = ymOfPeriod(start, 'start');
  const b = ymOfPeriod(end, 'end');
  if (a == null || b == null) return null;
  return year.to >= a && year.from <= b;
}

function isEvName(s: string): boolean {
  const f = fold(s);
  return /일렉트릭|전기|evx/.test(f) || /(^|[^a-z0-9])ev([^a-z0-9]|$)/.test(f);
}
function isHevName(s: string): boolean {
  const f = fold(s);
  return f.includes('하이브리드') || /(^|[^a-z0-9])hev([^a-z0-9]|$)/.test(f);
}
function sourceIsEv(s: string): boolean {
  const f = foldHay(s);
  return /일렉트릭|전기/.test(f) || /(^|[^a-z0-9])ev([^a-z0-9]|$)/.test(f);
}
function sourceIsHev(s: string): boolean {
  const f = foldHay(s);
  return /하이브리드|hev|hybrid/.test(f);
}

/** 1차 검수: 같은 모델 F03 확정 중 연식 겹치는 세부모델이 하나면 그걸 쓴다. 2차(트림·제원)는 여기 안 함. */
function yearUniqueSub(opts: {
  source: string;
  year: string;
  model: string;
  names: NameRow[];
  rowOk: (r: NameRow) => boolean;
}): { sub: string; rows: NameRow[] } | null {
  if (!fold(opts.model)) return null;
  const year = yearToRange(opts.year);
  if (!year) return null;
  const overlap = opts.names.filter((r) => opts.rowOk(r) && periodOverlaps(year, r.start, r.end) === true);
  if (!overlap.length) return null;
  const bySub = new Map<string, NameRow[]>();
  for (const r of overlap) {
    const k = subKey(r.sub);
    (bySub.get(k) || bySub.set(k, []).get(k)!).push(r);
  }
  let uniq = [...bySub].map(([, rows]) => ({ sub: rows[0].sub, rows }));
  if (sourceIsEv(opts.source)) uniq = uniq.filter((u) => isEvName(u.sub));
  else uniq = uniq.filter((u) => !isEvName(u.sub));
  if (sourceIsHev(opts.source)) {
    const hev = uniq.filter((u) => isHevName(u.sub));
    if (hev.length) uniq = hev;
  } else {
    const ice = uniq.filter((u) => !isHevName(u.sub));
    if (ice.length) uniq = ice;
  }
  return uniq.length === 1 ? uniq[0] : null;
}

function powerFilterSubs(source: string, pool: { sub: string }[]): { sub: string }[] {
  let uniq = pool;
  if (sourceIsEv(source)) uniq = uniq.filter((u) => isEvName(u.sub));
  else uniq = uniq.filter((u) => !isEvName(u.sub));
  if (sourceIsHev(source)) {
    const hev = uniq.filter((u) => isHevName(u.sub));
    if (hev.length) uniq = hev;
  } else {
    const ice = uniq.filter((u) => !isHevName(u.sub));
    if (ice.length) uniq = ice;
  }
  return uniq;
}

function distinctiveMention(source: string, sub: string, model: string): boolean {
  const hay = foldHay(source);
  const hay0 = fold(source);
  const modelF = fold(model);
  const rest = tokensOf(sub).filter((t) => {
    if (isProtected(t) || isFlToken(t)) return false;
    const tf = fold(t);
    if (modelF && tf === modelF) return false;
    if (isCodeToken(t)) return false;
    return tf.length >= 2;
  });
  if (!rest.length) return false;
  return rest.every((t) => hay.includes(fold(t)) || hay0.includes(fold(t)));
}

function uniqueSubsSorted(rows: NameRow[]): string[] {
  const seen = new Set<string>();
  const pairs = rows
    .map((r) => ({ sub: r.sub, start: ymOfPeriod(r.start, 'start') || 0 }))
    .sort((a, b) => a.start - b.start);
  const out: string[] = [];
  for (const p of pairs) {
    const k = subKey(p.sub);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p.sub);
  }
  return out;
}

function yearsToTry(sheet: string, source: string): string[] {
  const out: string[] = [];
  const push = (y: string) => {
    if (yearToRange(y) && !out.some((x) => fold(x) === fold(y))) out.push(y);
  };
  const sheetN = Number((/(\d{4})/.exec(S(sheet)) || [])[1] || 0);
  const srcYears = [...source.matchAll(/20\d{2}/g)].map((m) => m[0]);
  const srcMy = [...source.matchAll(/(\d{2})\s*MY/gi)].map((m) => String(2000 + Number(m[1])));
  if (sheetN >= 2001 && sheetN <= 2035) push(sheet);
  for (const y of [...srcYears, ...srcMy]) push(y);
  if (sheetN && !out.length) push(sheet);
  if (yearToRange(sheet) && !out.some((x) => fold(x) === fold(sheet))) out.push(sheet);
  return out;
}

function pickByGenPhrase(source: string, model: string, overlap: NameRow[], allOfModel: NameRow[]): string {
  const pool = uniqueSubsSorted(overlap);
  if (!pool.length) return '';
  const n = Number((/(\d+)\s*세대/.exec(source) || [])[1] || 0);
  const hints = { ...(GEN_HINTS[model] || {}), ...((genHints as Record<string, Record<string, string>>)[model] || {}) };
  if (n && hints[`${n}세대`]) {
    const want = hints[`${n}세대`];
    if (pool.some((s) => fold(s) === fold(want))) return want;
  }
  const hay = fold(source);
  const spaced = spacedHay(source);
  if (fold(model) === fold('쿠퍼') && n === 4) {
    const key = /(?:^|[^a-z])c(?:[^a-z]|$)/.test(hay.replace(fold('쿠퍼'), '')) ? '4세대C' : (/s/.test(hay) ? '4세대S' : '');
    if (key && hints[key] && pool.some((s) => fold(s) === fold(hints[key]))) return hints[key];
    const c = pool.find((s) => fold(s).includes('쿠퍼c4'));
    if (c) return c;
  }
  if (fold(model) === fold('컨트리맨') && n === 3 && (latinTokenIn(spaced, 's') || /(?:^|[^a-z])s(?:[^a-z]|$)/.test(hay))) {
    if (hints['3세대S'] && pool.some((s) => fold(s) === fold(hints['3세대S']))) return hints['3세대S'];
  }
  if (fold(model) === fold('2시리즈') && /그란쿠페/.test(source)) {
    const gk = pool.filter((s) => /그란쿠페/.test(s) && !/전기|일렉트릭/.test(s));
    if (gk.length === 1) return gk[0];
    if (hints.그란쿠페 && pool.some((s) => fold(s) === fold(hints.그란쿠페))) return hints.그란쿠페;
  }
  const all = uniqueSubsSorted(allOfModel);
  if (n && all.length >= n) {
    const nth = all[n - 1];
    if (pool.some((s) => fold(s) === fold(nth))) return nth;
  }
  const latest = /디\s*올\s*뉴|올\s*뉴|신형|the\s*all-?new|all\s*new/i.test(source);
  const theNew = /더\s*뉴|the\s*new/i.test(source);
  if (latest) return pool[pool.length - 1] || '';
  if (theNew) {
    const tn = pool.filter((s) => /더\s*뉴/.test(s));
    if (tn.length === 1) return tn[0];
    if (tn.length > 1) return uniqueSubsSorted(overlap.filter((r) => /더\s*뉴/.test(r.sub))).slice(-1)[0] || '';
    const di = pool.filter((s) => /디\s*올\s*뉴/.test(s) && !isEvName(s));
    if (di.length === 1) return di[0];
  }
  if (/올\s*뉴/.test(source)) {
    const allNew = pool.filter((s) => /올\s*뉴/.test(s) && !/디\s*올\s*뉴/.test(s));
    if (allNew.length === 1) return allNew[0];
  }
  return '';
}

function shortLatinDigit(fm: string): boolean {
  return /^[a-z]{1,2}\d{1,2}[a-z]?$/.test(fm);
}

/** fold는 공백을 지워서 BMW X1 → bmwx1 이 된다. 짧은 라틴 모델은 원문 토큰으로 본다. */
function spacedHay(source: string): string {
  return S(source).toLowerCase().replace(/[-_·./()[\]（）]/g, ' ').replace(/\s+/g, ' ').trim();
}

function latinTokenIn(hay: string, tok: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${tok}([^a-z0-9]|$)`).test(hay);
}

function hayHasModel(hay: string, model: string, spaced = ''): boolean {
  const fm = fold(model);
  if (fm.length < 2) return false;
  const hitLatin = (tok: string) => (spaced && latinTokenIn(spaced, tok))
    || (hay.includes(tok) && new RegExp(`(^|[^a-z0-9])${tok}`).test(hay));
  if (shortLatinDigit(fm)) {
    if (hitLatin(fm)) return true;
  } else if (hay.includes(fm) || hay.includes(foldHay(model))) {
    return true;
  }
  for (const a of [...(MODEL_ALIAS[model] || []), ...((extraModelAliases as Record<string, string[]>)[model] || [])]) {
    const fa = fold(a);
    if (fa.length < 2) continue;
    if (fa.length < 4 && !/[가-힣]/.test(a) && !/\d/.test(a) && !/^(ray|k8|k5|k3|k7|k9|xt6)$/.test(fa)) continue;
    if (shortLatinDigit(fa)) {
      if (hitLatin(fa)) return true;
      continue;
    }
    if (hay.includes(fa)) return true;
  }
  return false;
}

function subKey(s: string) {
  return fold(s);
}

function foldHay(s: string): string {
  let h = fold(s);
  const pairs = [...SOURCE_ALIAS];
  for (const [model, aliases] of Object.entries(MODEL_ALIAS)) {
    for (const a of aliases) {
      if (fold(a).length < 4 && !/[가-힣]/.test(a)) continue;
      pairs.push([a, model]);
    }
  }
  for (const [a, b] of pairs) {
    const fa = fold(a);
    const fb = fold(b);
    if (fa && fb && fa !== fb) h = h.split(fa).join(fb);
  }
  return h;
}

/** 그 모델 F03 세부모델에 붙은 개발코드. 하나뿐이면 단일세대 잉여(K8 GL3) — 원문에 없어도 같은 차. */
function f03CodesOfModel(names: NameRow[], model: string): Set<string> {
  const modelF = fold(model);
  const out = new Set<string>();
  for (const r of names) {
    if (modelF && fold(r.model) !== modelF) continue;
    for (const t of tokensOf(r.sub)) {
      if (!isCodeToken(t)) continue;
      const tf = fold(t);
      if (modelF && tf === modelF) continue;
      out.add(tf);
    }
  }
  return out;
}

function isSingleGenF03Code(tf: string, model: string, names: NameRow[]): boolean {
  if (!names.length) return false;
  const codes = f03CodesOfModel(names, model);
  return codes.size <= 1 && codes.has(tf);
}

/** 원문이 고른 F03 세부모델을 직접 지지하나. 연식만 겹치는 것은 안 친다. 괄호·기아 세대→코드 변환 후 형태도 본다.
 *  원문에 없는 올 뉴를 붙이면 안 됨(K7→올 뉴 K7). 원문 광고접두(디 올 뉴 싼타페 MX5)는 F03 `싼타페 MX5`를 지지한다.
 *  F03 단일세대 잉여코드(K8 GL3)는 원문에 없어도 지지 — 검수대기로 안 뺌. K5 JF/DL3는 원문·세대명이 가려야 함. */
export function sourceSupportsPicked(source: string, picked: string, model: string, names: NameRow[] = []): boolean {
  for (const form of sourceForms(source, model)) {
    if (sourceSupportsPickedOne(form, picked, model, names)) return true;
  }
  return sourceSupportsPickedOne(source, picked, model, names);
}

function sourceSupportsPickedOne(source: string, picked: string, model: string, names: NameRow[]): boolean {
  const hay = foldHay(source);
  const pick = foldHay(picked);
  if (!hay || !pick) return false;
  if (hay.includes(pick)) return true;
  const modelF = fold(model);
  for (const t of tokensOf(picked)) {
    if (isFlToken(t) || isMakerToken(t, [])) continue;
    if (isProtected(t)) {
      if (!hay.includes(fold(restorePhrases(t)))) return false;
      continue;
    }
    const tf = fold(t);
    if (modelF && tf === modelF) {
      if (!hay.includes(tf)) return false;
      continue;
    }
    if (isCodeToken(t) && isSingleGenF03Code(tf, model, names)) continue;
    if (isCodeToken(t) || tf.length >= 2) {
      if (!hay.includes(tf)) return false;
    }
  }
  return true;
}

const NOT_TRIM = new Set(['d', 'gdi', 'tgdi', 'e', 'lpg', 'hev', 'ev', 'rwd', 'fwd', 'awd', '2wd', '4wd', 'wd', 'at', 'mt', 'dct', 'ivt']);

function sourceTrimTokens(source: string): string[] {
  return unwrapParens(source)
    .replace(/_/g, ' ')
    .split(/[\s,/]+/)
    .map((t) => fold(t))
    .filter(Boolean);
}

function trimPartTokens(trim: string): string[] {
  return unwrapParens(trim).split(/\s+/).map((t) => fold(t)).filter((t) => t && !NOT_TRIM.has(t));
}

function trimInSource(source: string, trim: string): boolean {
  const tf = fold(trim);
  if (!tf || tf === fold('기본형') || NOT_TRIM.has(tf)) return false;
  const hayToks = sourceTrimTokens(source);
  const hayJoin = hayToks.join('');
  const parts = trimPartTokens(trim);
  if (!parts.length) return false;
  return parts.every((p) => {
    if (p.length <= 3 && /^[a-z0-9]+$/.test(p)) return hayToks.includes(p);
    return hayToks.includes(p) || hayJoin.includes(p);
  });
}

/** ④ 확정 세부모델의 트림 풀에서만. 없으면 기본형. 짧은 라틴은 토큰 일치(CN7≠N, E-TECH≠ECH). */
export function pickTrimInSub(source: string, sub: string, names: NameRow[], maker: string, model: string): string {
  if (!sub) return '';
  const makerF = fold(canonMakerDisplay(maker) || maker);
  const modelF = fold(model);
  let trims = [...new Set(names.filter((r) => {
    if (subKey(r.sub) !== subKey(sub)) return false;
    if (modelF && fold(r.model) !== modelF) return false;
    if (makerF && !makersAlign(r.maker, maker)) return false;
    return !!r.trim;
  }).map((r) => r.trim))];
  if (sourceIsHev(source)) {
    const hev = trims.filter((t) => isHevName(t));
    if (hev.length) trims = hev;
  } else {
    const ice = trims.filter((t) => !isHevName(t));
    if (ice.length) trims = ice;
  }
  const hits = trims.filter((t) => trimInSource(source, t));
  hits.sort((a, b) => fold(b).length - fold(a).length);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1 && fold(hits[0]).length > fold(hits[1]).length) return hits[0];
  return '기본형';
}

/** ① F03 모델 집합에서 원문에 있는 것만. 둘 이상 같은 길이면 빈칸. */
export function extractModelFromSource(source: string, names: NameRow[], maker: string): string {
  const hay = foldHay(source);
  const hay0 = fold(source);
  const spaced = spacedHay(source);
  if (!hay && !hay0 && !spaced) return '';
  const makerDisp = maker ? (canonMakerDisplay(maker) || maker) : '';
  const byMaker = (r: NameRow) => !makerDisp || makersAlign(r.maker, maker);
  const modelsOf = (pred: (r: NameRow) => boolean) => [...new Set(names.filter(pred).map((r) => r.model).filter(Boolean))];
  const collect = (models: string[]) => {
    const hits: string[] = [];
    for (const m of models) {
      if (hayHasModel(hay, m, spaced) || hayHasModel(hay0, m, spaced)) hits.push(m);
    }
    hits.sort((a, b) => fold(b).length - fold(a).length);
    return hits;
  };
  let hits = collect(modelsOf(byMaker));
  if (!hits.length && makerDisp) hits = collect(modelsOf(() => true));
  if (!hits.length) return '';
  if (hits.length > 1 && fold(hits[0]).length === fold(hits[1]).length && fold(hits[0]) !== fold(hits[1])) return '';
  return hits[0];
}

function sourceForMatch(raw: string): string {
  return S(raw).replace(/(\d+)\s*게대/g, '$1세대');
}

export function resolveSubmodelToF03(opts: {
  source: string;
  filledSub?: string;
  year: string;
  maker: string;
  model: string;
  names: NameRow[];
  /** 모델 추출용. 세부모델 매칭은 names(확정)만. */
  modelCatalog?: NameRow[];
}): SubNormResult {
  const source = sourceForMatch(opts.source);
  const none = (note: string, keepModel = '', tag: SubNormTag = '검수대기'): SubNormResult => {
    const makerPool = opts.modelCatalog?.length ? opts.modelCatalog : opts.names;
    const ms = keepModel
      ? [...new Set(makerPool.filter((r) => fold(r.model) === fold(keepModel)).map((r) => canonMakerDisplay(r.maker) || r.maker).filter(Boolean))]
      : [];
    return {
      tag, picked: '', model: keepModel, trim: '', maker: ms.length === 1 ? ms[0] : '', candidates: [], inF03: [], yearOk: null, note,
    };
  };
  if (!source) return none('원문 차명 없음');
  const catalog = opts.modelCatalog?.length ? opts.modelCatalog : opts.names;
  const model = S(opts.model) || extractModelFromSource(source, catalog, opts.maker);
  if (!fold(model)) return none('① 모델 없음');

  const extraMakers = [...new Set(opts.names.map((r) => r.maker).filter(Boolean))];
  const usedCodes = f03CodeTokens(opts.names.map((r) => r.sub));
  const candidates = [...new Set(sourceForms(source, model).flatMap((f) => submodelCandidates(f, usedCodes, extraMakers)))];
  const makerDisp = opts.maker ? (canonMakerDisplay(opts.maker) || opts.maker) : '';
  const modelF = fold(model);
  const f03MakerOf = (picked: string) => {
    const ms = [...new Set(opts.names
      .filter((r) => subKey(r.sub) === subKey(picked))
      .map((r) => canonMakerDisplay(r.maker) || r.maker)
      .filter(Boolean))];
    return ms.length === 1 ? ms[0] : (canonMakerDisplay(opts.maker) || opts.maker || '');
  };
  const done = (picked: string, note: string, yearOk = true): SubNormResult => ({
    tag: '원문직접근거',
    picked,
    model,
    trim: pickTrimInSub(source, picked, opts.names, opts.maker, model),
    maker: f03MakerOf(picked),
    candidates,
    inF03: [picked],
    yearOk,
    note,
  });
  const rowOkMaker = (r: NameRow) => {
    if (makerDisp && !makersAlign(r.maker, opts.maker)) return false;
    if (modelF && fold(r.model) !== modelF) return false;
    return true;
  };
  const rowOkModel = (r: NameRow) => !modelF || fold(r.model) === modelF;

  const pickFrom = (rowOk: (r: NameRow) => boolean, yearRaw: string): SubNormResult | 'empty-overlap' => {
    const unique = yearUniqueSub({ source, year: yearRaw, model, names: opts.names, rowOk });
    if (unique) return done(unique.sub, `1차연식 「${source}」→「${unique.sub}」`);
    const year = yearToRange(yearRaw);
    const overlap = opts.names.filter((r) => rowOk(r) && periodOverlaps(year, r.start, r.end) === true);
    if (!overlap.length) return 'empty-overlap';
    const seen = new Set<string>();
    const pool: { sub: string }[] = [];
    for (const r of overlap) {
      const k = subKey(r.sub);
      if (seen.has(k)) continue;
      seen.add(k);
      pool.push({ sub: r.sub });
    }
    const powered = powerFilterSubs(source, pool);
    const use = powered;
    if (!use.length) return none(`③ 원문 대조 못 가름 ${pool.map((p) => p.sub).join(' · ')}`, model);
    const overlapUse = overlap.filter((r) => use.some((p) => subKey(p.sub) === subKey(r.sub)));
    if (/디\s*올\s*뉴|신형|the\s*all-?new|all\s*new/i.test(source)) {
      const genEarly = pickByGenPhrase(source, model, overlapUse, opts.names.filter(rowOk));
      if (genEarly) return done(genEarly, `세대표현 「${source}」→「${genEarly}」`);
    }
    const hits = use.filter((p) => sourceSupportsPicked(source, p.sub, model, opts.names));
    hits.sort((a, b) => fold(b.sub).length - fold(a.sub).length);
    if (hits.length === 1 || (hits.length > 1 && fold(hits[0].sub).length > fold(hits[1].sub).length)) {
      return done(hits[0].sub, `1차원문 「${source}」→「${hits[0].sub}」`);
    }
    const mentioned = use.filter((p) => distinctiveMention(source, p.sub, model));
    if (mentioned.length === 1) return done(mentioned[0].sub, `원문특징 「${source}」→「${mentioned[0].sub}」`);
    const gen = pickByGenPhrase(source, model, overlapUse, opts.names.filter(rowOk));
    if (gen) return done(gen, `세대표현 「${source}」→「${gen}」`);
    return none(`③ 원문 대조 못 가름 ${use.map((p) => p.sub).join(' · ')}`, model);
  };

  const years = yearsToTry(opts.year, source);
  if (!years.length) return none('② 연식 없음', model);

  const tryRows = [rowOkMaker, rowOkModel];
  for (const y of years) {
    for (const rowOk of tryRows) {
      const got = pickFrom(rowOk, y);
      if (got !== 'empty-overlap') return got;
    }
  }
  return none('연식↔생산기간 겹침 0', model);
}

export function selfCheckSubNorm(): string[] {
  const bad: string[] = [];
  const used = new Set(['mx5', 'dl3', 'dh', 'rg3', 'sp2']);
  const makers = ['기아', '현대', '제네시스'];
  const expect = (raw: string, want: string[], label: string) => {
    const got = submodelCandidates(raw, used, makers);
    for (const w of want) {
      if (!got.some((g) => fold(g) === fold(w))) bad.push(`${label}: 후보에 「${w}」없음 (${got.join(' / ')})`);
    }
  };
  expect('더 뉴 기아 레이 TAM', ['더 뉴 레이'], '제조사+미사용코드');
  expect('쏘나타 DN8 디 엣지', ['쏘나타 디 엣지'], '미사용 DN8');
  expect('G80 RG3 FL', ['G80 RG3'], 'FL');
  expect('싼타페 MX5', ['싼타페 MX5'], 'F03 코드 유지');
  expect('디 올 뉴 싼타페 MX5', ['디 올 뉴 싼타페 MX5', '디 올 뉴 싼타페'], '올뉴 후보 유지');
  expect('K5 DL3', ['K5 DL3'], 'DL3 유지');
  expect('G80 DH', ['G80 DH'], 'DH 유지');
  if (submodelCandidates('더 뉴 기아 레이 TAM', used, makers).filter((g) => g !== '더 뉴 기아 레이 TAM').some((g) => /기아/.test(g))) {
    bad.push('제조사 누출이 벗긴 후보에 남음');
  }
  const formHas = (src: string, model: string, want: string, label: string) => {
    if (!sourceForms(src, model).some((g) => fold(g) === fold(want))) bad.push(`${label}: F03형 「${want}」없음`);
  };
  formHas('쏘나타 (DN8)', '쏘나타', '쏘나타 DN8', '괄호 펼침');
  if (sourceForms('셀토스 2세대', '셀토스').some((g) => fold(g).includes('sp2'))) {
    bad.push('셀토스 2세대에 SP2 추측 — F03 확정은 셀토스/더 뉴 셀토스');
  }
  formHas('더 뉴 카니발', '카니발', '더 뉴 카니발 YP', '올뉴/더뉴 카니발=YP');
  formHas('K5 3세대', 'K5', 'K5 DL3', 'K5 3세대→DL3');
  if (sourceForms('K8 1세대', 'K8').some((g) => fold(g).includes('gl3'))) {
    bad.push('K8 1세대에 GL3 추측 — 단일세대는 코드 없음');
  }
  const names: NameRow[] = [
    { origin: '국산', maker: '현대', model: '쏘나타', sub: '쏘나타 DN8', trim: '인스퍼레이션', start: '2019-03', end: '현재' },
    { origin: '국산', maker: '기아', model: '셀토스', sub: '셀토스', trim: '트렌디', start: '2019-07', end: '2022-07' },
    { origin: '국산', maker: '기아', model: '셀토스', sub: '더 뉴 셀토스', trim: '트렌디', start: '2022-07', end: '2026-01' },
    { origin: '국산', maker: '기아', model: '카니발', sub: '더 뉴 카니발 YP', trim: '노블레스', start: '2018-03', end: '2020-10' },
    { origin: '국산', maker: '현대', model: '싼타페', sub: '싼타페 MX5', trim: '익스클루시브', start: '2023-08', end: '현재' },
    { origin: '국산', maker: '현대', model: '싼타페', sub: '싼타페 TM', trim: '프레스티지', start: '2018-02', end: '2020-06' },
    { origin: '국산', maker: '현대', model: '싼타페', sub: '더 뉴 싼타페', trim: '프리미엄', start: '2020-06', end: '2023-08' },
    { origin: '국산', maker: '기아', model: '레이', sub: '더 뉴 레이', trim: '럭셔리', start: '2017-12', end: '2022-08' },
    { origin: '국산', maker: '기아', model: '레이', sub: '더 뉴 기아 레이', trim: '프레스티지', start: '2022-08', end: '현재' },
    { origin: '국산', maker: '기아', model: 'K5', sub: 'K5 DL3', trim: '프레스티지', start: '2019-11', end: '2023-10' },
    { origin: '국산', maker: '기아', model: 'K5', sub: '더 뉴 K5 DL3', trim: '프레스티지', start: '2023-10', end: '현재' },
    { origin: '수입', maker: '토요타', model: 'RAV4', sub: 'RAV4', trim: '기본형', start: '2019-04', end: '현재' },
    { origin: '국산', maker: '기아', model: '카니발', sub: '카니발 KA4', trim: '노블레스', start: '2020-08', end: '2023-11' },
    { origin: '국산', maker: '기아', model: '카니발', sub: '더 뉴 카니발 KA4', trim: '노블레스', start: '2023-11', end: '현재' },
    { origin: '수입', maker: '벤츠', model: 'E-클래스', sub: 'E-클래스 W213', trim: '기본형', start: '2016-01', end: '2024-01' },
    { origin: '수입', maker: '벤츠', model: 'E-클래스', sub: 'E-클래스 W214', trim: '기본형', start: '2024-01', end: '현재' },
    { origin: '국산', maker: '현대', model: 'i30', sub: 'i30', trim: '스타일', start: '2016-01', end: '현재' },
    { origin: '국산', maker: '현대', model: '그랜저', sub: '더 뉴 그랜저 IG', trim: '프리미엄', start: '2019-11', end: '2022-11' },
    { origin: '국산', maker: '기아', model: 'K8', sub: 'K8', trim: '노블레스', start: '2021-04', end: '2024-08' },
    { origin: '국산', maker: '기아', model: 'K8', sub: '더 뉴 K8', trim: '노블레스', start: '2024-08', end: '현재' },
    { origin: '국산', maker: '현대', model: '아반떼', sub: '아반떼 CN7', trim: 'N', start: '2020-04', end: '2023-04' },
    { origin: '국산', maker: '현대', model: '아반떼', sub: '아반떼 CN7', trim: '스마트', start: '2020-04', end: '2023-04' },
    { origin: '국산', maker: '르노', model: '그랑 콜레오스', sub: '그랑 콜레오스', trim: 'ECH 에스프리 알핀', start: '2024-01', end: '현재' },
    { origin: '국산', maker: '르노', model: '그랑 콜레오스', sub: '그랑 콜레오스', trim: '에스프리 알핀', start: '2024-01', end: '현재' },
    { origin: '국산', maker: '기아', model: 'K5', sub: 'K5 DL3', trim: 'GT', start: '2019-11', end: '2023-10' },
    { origin: '국산', maker: '기아', model: 'K5', sub: 'K5 DL3', trim: 'GT-Line', start: '2019-11', end: '2023-10' },
    { origin: '국산', maker: '기아', model: '니로', sub: '디 올 뉴 니로 EV', trim: '에어', start: '2022-04', end: '현재' },
    { origin: '국산', maker: '기아', model: '니로', sub: '디 올 뉴 니로 EV', trim: '트렌디', start: '2022-04', end: '현재' },
    { origin: '국산', maker: '기아', model: 'K5', sub: 'K5 JF', trim: '프레스티지', start: '2015-07', end: '2019-12' },
    { origin: '국산', maker: '기아', model: 'K8', sub: 'K8 GL3', trim: '노블레스', start: '2021-04', end: '2024-07' },
    { origin: '국산', maker: '기아', model: 'K8', sub: '더 뉴 K8 GL3', trim: '노블레스', start: '2024-08', end: '현재' },
    { origin: '국산', maker: '제네시스', model: 'G90', sub: 'G90', trim: '프레스티지', start: '2018-11', end: '2021-12' },
    { origin: '국산', maker: '제네시스', model: 'G90', sub: 'G90 RS4', trim: '3.5 터보 AWD', start: '2021-12', end: '현재' },
    { origin: '수입', maker: 'BMW', model: 'X1', sub: 'X1 F48', trim: 'sDrive18d', start: '2016-01', end: '2023-02' },
    { origin: '수입', maker: 'BMW', model: 'X1', sub: 'X1 U11', trim: 'sDrive20i', start: '2023-03', end: '현재' },
    { origin: '수입', maker: '미니', model: '컨트리맨', sub: '쿠퍼 S 컨트리맨 3세대', trim: '기본형', start: '2024-06', end: '현재' },
    { origin: '수입', maker: '미니', model: '컨트리맨', sub: '쿠퍼 컨트리맨', trim: '기본형', start: '2011-03', end: '현재' },
    { origin: '수입', maker: '미니', model: '컨트리맨', sub: '쿠퍼 SD 컨트리맨', trim: '기본형', start: '2011-05', end: '현재' },
    { origin: '국산', maker: 'KGM', model: '토레스', sub: '토레스 EVX', trim: 'T5', start: '2023-01', end: '현재' },
    { origin: '국산', maker: 'KGM', model: '토레스', sub: '더 뉴 토레스', trim: 'T5', start: '2025-01', end: '현재' },
  ];
  const hit = (src: string, year: string, maker: string, model: string, want: string, label: string) => {
    const r = resolveSubmodelToF03({ source: src, year, maker, model, names });
    if (r.tag !== '원문직접근거' || fold(r.picked) !== fold(want)) {
      bad.push(`${label}: ${r.tag} 「${r.picked}」 (${r.note})`);
    }
  };
  hit('쏘나타 (DN8) 인스퍼레이션', '2021', '현대', '쏘나타', '쏘나타 DN8', '원문 괄호→확정원자');
  hit('셀토스 2세대 트렌디', '2021', '기아', '셀토스', '셀토스', '연식유일 셀토스');
  hit('더 뉴 카니발 노블레스', '2019', '기아', '카니발', '더 뉴 카니발 YP', '더뉴 카니발→YP');
  hit('디 올 뉴 싼타페 MX5', '2025', '현대', '싼타페', '싼타페 MX5', '광고접두→F03 MX5');
  hit('디 올뉴 싼타페 가솔린 2.5', '2025', '현대', '싼타페', '싼타페 MX5', '연식유일 디올뉴→MX5');
  hit('디 올뉴 싼타페 가솔린 2.5', '2019', '현대', '싼타페', '싼타페 TM', '연식유일 디올뉴→TM');
  hit('레이 27MY 가솔린 1.0 프레스티지', '2026', '기아', '레이', '더 뉴 기아 레이', '연식유일 레이27MY');
  hit('기아_신형K5_2.0 가솔린_프레스티지', '2024', '기아', 'K5', '더 뉴 K5 DL3', '연식유일 신형K5');
  hit('라브4 2.5 가솔린', '2021', '토요타', 'RAV4', 'RAV4', '별칭 라브4→RAV4');
  hit('라브4 2.5 가솔린', '2021', '토요타', '', 'RAV4', '① 모델추출 라브4');
  hit('E클래스 E250', '2020', '벤츠', '', 'E-클래스 W213', '① 모델추출 E클래스');
  hit('벤츠 E클래스(6세대) E200 아방가르드', '2024', '벤츠', '', 'E-클래스 W214', '6세대→W214');
  hit('기아_신형 카니발_9인승 디젤_노블레스', '2023', '기아', '카니발', '더 뉴 카니발 KA4', '신형카니발2023→더뉴KA4');
  hit('신형 카니발(KA4) 9인승 디젤 시그니처', '2023', '기아', '카니발', '더 뉴 카니발 KA4', '신형+KA4→더뉴KA4');
  hit('현대_더 뉴그랜저IG_LPi 3.0_렌터카 프리미엄', '2022', '현대', '', '더 뉴 그랜저 IG', '그랜저IG≠i30');
  hit('더 뉴K8 2.5 GDI 노블레스', '2026', '기아', '', '더 뉴 K8 GL3', '더뉴K8');
  hit('K8 노블레스', '2022', '기아', 'K8', 'K8 GL3', 'F03 K8 GL3 허용오류 매칭');
  hit('더 뉴 K8 노블레스', '2025', '기아', 'K8', '더 뉴 K8 GL3', '원문 더 뉴 K8 → F03 더 뉴 K8 GL3');
  hit('G90 자가용 세단 5인승 5.0 프레스티지', '2019', '현대', '', 'G90', '원문제조사현대→F03 G90');
  hit('더 뉴 카니발 노블레스', '2020', '기아', '카니발', '더 뉴 카니발 YP', '겹침구간은 원문(YP)');
  hit('BMW X1 2세대', '2021', 'BMW', '', 'X1 F48', '① X1 토큰+연식유일');
  hit('컨트리맨 3세대 2.0 S', '2025', '미니', '', '쿠퍼 S 컨트리맨 3세대', '컨트리맨 3세대S');
  hit('컨트리맨(3세대) 2.0 S ALL4 클래식', '2025', '미니', '', '쿠퍼 S 컨트리맨 3세대', '컨트리맨 S ALL4');
  hit('벤츠 E클래스(6게대) E200 아방가르드', '2024', '벤츠', '', 'E-클래스 W214', '게대오타→세대');
  hit('신형 카니발(KA4) 9인승 디젤 시그니처', '2023', '기아', '카니발', '더 뉴 카니발 KA4', '신형+KA4→더뉴KA4');
  {
    const r = resolveSubmodelToF03({ source: '뉴 토레스 1.5 GDI 터보 2WD T5', year: '2026', maker: 'KGM', model: '토레스', names });
    if (r.tag === '원문직접근거' && /evx/i.test(r.picked)) bad.push(`가솔린 토레스를 EVX로: 「${r.picked}」`);
  }
  {
    const r = resolveSubmodelToF03({ source: '카니발 9인승', year: '2020', maker: '기아', model: '카니발', names });
    if (r.tag === '원문직접근거') bad.push(`겹침 무원문: ${r.tag} 「${r.picked}」 — 연식유일로 찍으면 안 됨`);
  }
  const trimHit = (src: string, year: string, maker: string, model: string, wantTrim: string, label: string) => {
    const r = resolveSubmodelToF03({ source: src, year, maker, model, names });
    if (r.trim !== wantTrim) bad.push(`${label}: 트림 「${r.trim}」≠「${wantTrim}」`);
  };
  trimHit('쏘나타 (DN8) 인스퍼레이션', '2021', '현대', '쏘나타', '인스퍼레이션', '④ 트림 풀');
  trimHit('디 올뉴 싼타페 가솔린 2.5', '2025', '현대', '싼타페', '기본형', '④ 풀에 없으면 기본형');
  trimHit('아반떼 CN7 자가용 가솔린 1.6 법인전용 A/T 런칭(.)', '2021', '현대', '아반떼', '기본형', '④ CN7≠트림 N');
  trimHit('그랑 콜레오스 하이브리드 1.5 2WD E-TECH 에스프리 알핀', '2026', '르노', '그랑 콜레오스', '에스프리 알핀', '④ E-TECH≠ECH');
  trimHit('K5 GT-Line', '2021', '기아', 'K5', 'GT-Line', '④ GT-Line≠GT');
  trimHit('기아_디 올뉴니로EV_에어_', '2023', '기아', '니로', '에어', '④ 원문 에어');
  const sup = (src: string, picked: string, model: string, want: boolean, label: string) => {
    if (sourceSupportsPicked(src, picked, model, names) !== want) bad.push(`${label}: ${want ? '지지해야' : '지지하면 안 됨'}`);
  };
  sup('더 뉴 레이 TAM', '더 뉴 레이', '레이', true, '원문 TAM');
  sup('레이 B 21각자', '더 뉴 레이', '레이', false, '레이만으로 더 뉴 레이');
  sup('뉴 G80 2.5 터보', 'G80 RG3', 'G80', false, '뉴 G80≠RG3');
  sup('G80 RG3 FL', 'G80 RG3', 'G80', true, '원문 RG3 FL');
  sup('K7 3.0 LPI', '올 뉴 K7', 'K7', false, 'K7만으로 올 뉴');
  sup('산타페 TM', '싼타페', '싼타페', true, '산타페 별칭');
  sup('디 올 뉴 싼타페 MX5', '싼타페 MX5', '싼타페', true, '광고접두→MX5');
  sup('K8 노블레스', 'K8 GL3', 'K8', true, '단일세대 F03 GL3은 원문 없이도 같은 차');
  sup('K5 시그니처', 'K5 DL3', 'K5', false, 'K5는 세대명·코드 없이 DL3 추측 금지');
  return bad;
}
