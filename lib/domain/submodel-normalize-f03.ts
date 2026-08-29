/**
 * 세부모델 정규화 — 후보 생성 후 F03 집합에 있는 형태만 받는다. 추정 없음.
 *
 * 벗기는 것: FL·페이스리프트 · 제조사 누출 · F03가 안 쓰는 dev코드.
 * 올 뉴/디 올 뉴/더 뉴/신형: 강제로 안 벗긴다. F03가 non-올뉴 형태를 쓰면(싼타페 MX5)
 * 연식이 그 세대면 그 형태로 매칭. 원문에 없는 올 뉴를 붙이지는 않는다.
 * 여러 후보가 F03에 있으면 연식↔생산기간으로 세대를 가른다. 안 갈리면 검수대기.
 */
import { canonMakerDisplay } from './maker-display';
import { fold, type NameRow } from './encar-work-sheet-match';

const S = (v: unknown) => String(v ?? '').trim();

const MAKER_LEAK = [
  '메르세데스벤츠', '메르세데스-벤츠', '메르세데스', '기아자동차', '현대자동차',
  'KG모빌리티', '르노코리아', '르노삼성', '한국지엠', '제네시스',
  '쉐보레', '쌍용', '기아', '현대', '벤츠', 'BMW', '아우디', '테슬라', '미니',
  '폭스바겐', '볼보', '캐딜락', '지프', '포르쉐', 'KGM', '르노', 'BYD', '폴스타',
].sort((a, b) => b.length - a.length);

const CODE_KEEP = new Set(['gt', 'lpg', 'hev', 'ev', 'suv', 'van', 'gdi', 'tdi', 'awd', 'rwd', 'fwd', 'phev']);

/** 기아만 N세대 → 개발코드. 엔카 괄호는 펼친다. F03형이 정본. */
const KIA_GEN: Record<string, Record<number, string>> = {
  K5: { 1: 'TF', 2: 'JF', 3: 'DL3' },
  K3: { 2: 'BD', 3: 'BC' },
  K7: { 1: 'VG', 2: 'YG' },
  K8: { 1: 'GL3' },
  K9: { 1: 'KH', 2: 'RJ' },
  카니발: { 3: 'YP', 4: 'KA4' },
  쏘렌토: { 3: 'UM', 4: 'MQ4' },
  스포티지: { 4: 'QL', 5: 'NQ5' },
  셀토스: { 1: 'SP2', 2: 'SP2' },
  모닝: { 3: 'JA' },
  레이: { 1: 'TAM' },
  니로: { 1: 'DE', 2: 'SG2' },
  EV6: { 1: 'CV' },
  EV9: { 1: 'MV' },
  EV3: { 1: 'SV' },
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

export const SUB_NORM_RULE = 'sub-norm-r5-source-2026-08-29';

/** 원문 표기 → F03 표기. 승인된 정확 별칭만(산타페=싼타페). */
const SOURCE_ALIAS: [string, string][] = [['산타페', '싼타페']];

export type SubNormTag = '원문직접근거' | '기존정제재검증' | '오매칭의심' | '검수대기';
export type SubNormResult = {
  tag: SubNormTag;
  picked: string;
  candidates: string[];
  inF03: string[];
  yearOk: boolean | null;
  note: string;
};

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

function ymOfPeriod(s: string): number | null {
  const v = S(s);
  if (v === '현재') return 999912;
  if (!v || v === '보류') return null;
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
  const a = ymOfPeriod(start);
  const b = ymOfPeriod(end);
  if (a == null || b == null) return null;
  return year.to >= a && year.from <= b;
}

function subKey(s: string) {
  return fold(s);
}

function foldHay(s: string): string {
  let h = fold(s);
  for (const [a, b] of SOURCE_ALIAS) h = h.split(fold(a)).join(fold(b));
  return h;
}

/** 원문이 고른 F03 세부모델을 직접 지지하나. 연식만 겹치는 것은 안 친다. 괄호·기아 세대→코드 변환 후 형태도 본다.
 *  원문에 없는 올 뉴를 붙이면 안 됨(K7→올 뉴 K7). 원문 광고접두(디 올 뉴 싼타페 MX5)는 F03 `싼타페 MX5`를 지지한다. */
export function sourceSupportsPicked(source: string, picked: string, model: string): boolean {
  for (const form of sourceForms(source, model)) {
    if (sourceSupportsPickedOne(form, picked, model)) return true;
  }
  return sourceSupportsPickedOne(source, picked, model);
}

function sourceSupportsPickedOne(source: string, picked: string, model: string): boolean {
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
    if (isCodeToken(t) || tf.length >= 2) {
      if (!hay.includes(tf)) return false;
    }
  }
  return true;
}

export function resolveSubmodelToF03(opts: {
  source: string;
  filledSub?: string;
  year: string;
  maker: string;
  model: string;
  names: NameRow[];
}): SubNormResult {
  const source = S(opts.source);
  const filledSub = S(opts.filledSub);
  const empty = (note: string, tag: SubNormTag = '검수대기'): SubNormResult => ({
    tag, picked: '', candidates: [], inF03: [], yearOk: null, note,
  });
  const filledInF03 = (sub: string) => {
    if (!sub) return '';
    const makerDisp = opts.maker ? (canonMakerDisplay(opts.maker) || opts.maker) : '';
    const modelF = fold(opts.model);
    const hit = opts.names.find((r) => {
      if (subKey(r.sub) !== subKey(sub)) return false;
      if (makerDisp) {
        const rm = canonMakerDisplay(r.maker) || r.maker;
        if (fold(rm) !== fold(makerDisp) && fold(r.maker) !== fold(opts.maker)) return false;
      }
      if (modelF && fold(r.model) !== modelF) return false;
      return true;
    });
    return hit?.sub || '';
  };
  const reuseFilled = (note: string): SubNormResult => {
    const got = filledInF03(filledSub);
    if (got) {
      return { tag: '기존정제재검증', picked: got, candidates: [], inF03: [got], yearOk: null, note };
    }
    return empty(note);
  };
  if (!source) return reuseFilled('원문 차명 없음');

  const extraMakers = [...new Set(opts.names.map((r) => r.maker).filter(Boolean))];
  const usedCodes = f03CodeTokens(opts.names.map((r) => r.sub));
  let candidates = [...new Set(sourceForms(source, opts.model).flatMap((f) => submodelCandidates(f, usedCodes, extraMakers)))];
  const modelTok = tokensOf(opts.model);
  if (modelTok.length) {
    const mf = fold(opts.model);
    const more: string[] = [];
    for (const c of candidates) {
      const ct = tokensOf(c);
      if (ct.length > modelTok.length && fold(tidy(ct.slice(0, modelTok.length))) === mf) {
        const rest = tidy(ct.slice(modelTok.length));
        if (rest) more.push(rest);
      }
    }
    if (more.length) candidates = [...new Set([...candidates, ...more])];
  }
  const byFold = new Map<string, NameRow[]>();
  for (const r of opts.names) {
    const k = subKey(r.sub);
    (byFold.get(k) || byFold.set(k, []).get(k)!).push(r);
  }
  const makerDisp = opts.maker ? (canonMakerDisplay(opts.maker) || opts.maker) : '';
  const modelF = fold(opts.model);
  const candFolds = candidates.map((c) => foldHay(c)).filter(Boolean);
  const rowOk = (r: NameRow) => {
    if (makerDisp) {
      const rm = canonMakerDisplay(r.maker) || r.maker;
      if (fold(rm) !== fold(makerDisp) && fold(r.maker) !== fold(opts.maker)) return false;
    }
    if (modelF && fold(r.model) !== modelF) return false;
    return true;
  };
  const hitSubs: { sub: string; rows: NameRow[] }[] = [];
  const seen = new Set<string>();
  for (const r of opts.names) {
    if (!rowOk(r)) continue;
    const sk = subKey(r.sub);
    if (seen.has(sk)) continue;
    if (!candFolds.some((cf) => cf === sk || cf.includes(sk))) continue;
    if (!sourceSupportsPicked(source, r.sub, opts.model)) continue;
    const rows = (byFold.get(sk) || []).filter(rowOk);
    if (!rows.length) continue;
    seen.add(sk);
    hitSubs.push({ sub: rows[0].sub, rows });
  }
  const inF03 = hitSubs.map((h) => h.sub);
  if (!hitSubs.length) {
    return reuseFilled('원문 후보가 F03에 없음');
  }

  const year = yearToRange(opts.year);
  const strippedCode = candidates.some((c) => subKey(c) !== subKey(source)) &&
    tokensOf(source).some((t) => isCodeToken(t));
  const scored = hitSubs.map((h) => {
    const flags = h.rows.map((r) => periodOverlaps(year, r.start, r.end));
    const anyYes = flags.some((x) => x === true);
    const allNo = flags.every((x) => x === false);
    const yearOk = allNo ? false : anyYes ? true : null;
    return { ...h, yearOk };
  });
  const byYear = year ? scored.filter((s) => s.yearOk !== false) : scored;
  const pool = (byYear.length ? byYear : scored).slice().sort((a, b) => fold(b.sub).length - fold(a.sub).length);
  const bestLen = pool.length ? fold(pool[0].sub).length : 0;
  const tied = pool.filter((p) => fold(p.sub).length === bestLen);
  if (tied.length > 1) {
    return reuseFilled(`원문 F03 후보 여럿 ${tied.map((p) => p.sub).join(' · ')}`);
  }
  const one = pool[0];
  if (one.yearOk === false) {
    return {
      tag: '오매칭의심', picked: one.sub, candidates, inF03, yearOk: false,
      note: `연식이 생산기간 밖 「${source}」→「${one.sub}」`,
    };
  }
  if (!sourceSupportsPicked(source, one.sub, opts.model)) {
    return reuseFilled(`원문이 세대를 안 말함 「${source}」≠「${one.sub}」(연식만으로 안 확정)`);
  }
  if (one.yearOk == null && strippedCode) {
    return {
      tag: '오매칭의심', picked: one.sub, candidates, inF03, yearOk: null,
      note: `코드 제거 후 연식 없어 세대 못 가름 「${source}」→「${one.sub}」`,
    };
  }
  return {
    tag: '원문직접근거', picked: one.sub, candidates, inF03, yearOk: one.yearOk,
    note: subKey(source) === subKey(one.sub) ? '원문=F03' : `원문 「${source}」→「${one.sub}」`,
  };
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
  formHas('셀토스 2세대', '셀토스', '셀토스 SP2', '기아 2세대→SP2');
  formHas('더 뉴 카니발', '카니발', '더 뉴 카니발 YP', '올뉴/더뉴 카니발=YP');
  formHas('K5 3세대', 'K5', 'K5 DL3', 'K5 3세대→DL3');
  const names: NameRow[] = [
    { origin: '국산', maker: '현대', model: '쏘나타', sub: '쏘나타 DN8', trim: '인스퍼레이션', start: '2019-03', end: '현재' },
    { origin: '국산', maker: '기아', model: '셀토스', sub: '셀토스 SP2', trim: '트렌디', start: '2019-09', end: '현재' },
    { origin: '국산', maker: '기아', model: '카니발', sub: '더 뉴 카니발 YP', trim: '노블레스', start: '2018-03', end: '2020-10' },
    { origin: '국산', maker: '현대', model: '싼타페', sub: '싼타페 MX5', trim: '익스클루시브', start: '2023-08', end: '현재' },
  ];
  const hit = (src: string, year: string, maker: string, model: string, want: string, label: string) => {
    const r = resolveSubmodelToF03({ source: src, year, maker, model, names });
    if (r.tag !== '원문직접근거' || fold(r.picked) !== fold(want)) {
      bad.push(`${label}: ${r.tag} 「${r.picked}」 (${r.note})`);
    }
  };
  hit('쏘나타 (DN8) 인스퍼레이션', '2021', '현대', '쏘나타', '쏘나타 DN8', '원문 괄호→확정원자');
  hit('셀토스 2세대 트렌디', '2021', '기아', '셀토스', '셀토스 SP2', '원문 세대→확정원자');
  hit('더 뉴 카니발 노블레스', '2019', '기아', '카니발', '더 뉴 카니발 YP', '더뉴 카니발→YP');
  hit('디 올 뉴 싼타페 MX5', '2025', '현대', '싼타페', '싼타페 MX5', '광고접두→F03 MX5');
  const sup = (src: string, picked: string, model: string, want: boolean, label: string) => {
    if (sourceSupportsPicked(src, picked, model) !== want) bad.push(`${label}: ${want ? '지지해야' : '지지하면 안 됨'}`);
  };
  sup('더 뉴 레이 TAM', '더 뉴 레이', '레이', true, '원문 TAM');
  sup('레이 B 21각자', '더 뉴 레이', '레이', false, '레이만으로 더 뉴 레이');
  sup('뉴 G80 2.5 터보', 'G80 RG3', 'G80', false, '뉴 G80≠RG3');
  sup('G80 RG3 FL', 'G80 RG3', 'G80', true, '원문 RG3 FL');
  sup('K7 3.0 LPI', '올 뉴 K7', 'K7', false, 'K7만으로 올 뉴');
  sup('산타페 TM', '싼타페', '싼타페', true, '산타페 별칭');
  sup('디 올 뉴 싼타페 MX5', '싼타페 MX5', '싼타페', true, '광고접두→MX5');
  return bad;
}
