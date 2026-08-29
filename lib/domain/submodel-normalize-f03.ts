/**
 * 세부모델 정규화 — 후보 생성 후 F03 집합에 있는 형태만 받는다. 추정 없음.
 *
 * 벗기는 것: FL·페이스리프트 · 제조사 누출 · F03가 안 쓰는 dev코드.
 * 벗기지 않는 것: 올 뉴 / 디 올 뉴 / 더 뉴 / 신형 (엔카 실제 모델명).
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

export const SUB_NORM_RULE = 'sub-norm-r4-2026-08-29';

export type SubNormTag = '매칭' | '오매칭의심' | '검수대기';
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

export function resolveSubmodelToF03(opts: {
  raw: string;
  year: string;
  maker: string;
  model: string;
  names: NameRow[];
}): SubNormResult {
  const raw = S(opts.raw);
  const empty = (note: string): SubNormResult => ({
    tag: '검수대기', picked: '', candidates: [], inF03: [], yearOk: null, note,
  });
  if (!raw) return empty('세부모델 빈칸');

  const extraMakers = [...new Set(opts.names.map((r) => r.maker).filter(Boolean))];
  const usedCodes = f03CodeTokens(opts.names.map((r) => r.sub));
  let candidates = submodelCandidates(raw, usedCodes, extraMakers);
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
  const hitSubs: { sub: string; rows: NameRow[] }[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const rows = (byFold.get(subKey(c)) || []).filter((r) => {
      if (makerDisp) {
        const rm = canonMakerDisplay(r.maker) || r.maker;
        if (fold(rm) !== fold(makerDisp) && fold(r.maker) !== fold(opts.maker)) return false;
      }
      if (modelF && fold(r.model) !== modelF) return false;
      return true;
    });
    if (!rows.length) continue;
    const sub = rows[0].sub;
    if (seen.has(subKey(sub))) continue;
    seen.add(subKey(sub));
    hitSubs.push({ sub, rows });
  }
  const inF03 = hitSubs.map((h) => h.sub);
  if (!hitSubs.length) {
    return { tag: '검수대기', picked: '', candidates, inF03, yearOk: null, note: 'F03에 실재 형태 없음' };
  }

  const year = yearToRange(opts.year);
  const strippedCode = candidates.some((c) => subKey(c) !== subKey(raw)) &&
    tokensOf(raw).some((t) => isCodeToken(t));
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
    return {
      tag: '검수대기', picked: '', candidates, inF03: tied.map((p) => p.sub),
      yearOk: null, note: `F03 후보 여럿 ${tied.map((p) => p.sub).join(' · ')}`,
    };
  }
  const one = pool[0];
  if (one.yearOk === false) {
    return {
      tag: '오매칭의심', picked: one.sub, candidates, inF03, yearOk: false,
      note: `연식이 생산기간 밖 「${raw}」→「${one.sub}」`,
    };
  }
  if (one.yearOk == null && strippedCode) {
    return {
      tag: '오매칭의심', picked: one.sub, candidates, inF03, yearOk: null,
      note: `코드 제거 후 연식 없어 세대 못 가름 「${raw}」→「${one.sub}」`,
    };
  }
  return {
    tag: '매칭', picked: one.sub, candidates, inF03, yearOk: one.yearOk,
    note: subKey(raw) === subKey(one.sub) ? '이미 F03' : `「${raw}」→「${one.sub}」`,
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
  expect('디 올 뉴 싼타페 MX5', ['디 올 뉴 싼타페 MX5', '디 올 뉴 싼타페'], '올뉴 보존');
  expect('K5 DL3', ['K5 DL3'], 'DL3 유지');
  expect('G80 DH', ['G80 DH'], 'DH 유지');
  const strippedNew = submodelCandidates('디 올 뉴 싼타페 MX5', used, makers);
  if (strippedNew.some((g) => fold(g) === fold('싼타페 MX5'))) {
    bad.push('디 올 뉴를 벗겨 싼타페 MX5가 되면 안 됨');
  }
  if (submodelCandidates('더 뉴 기아 레이 TAM', used, makers).filter((g) => g !== '더 뉴 기아 레이 TAM').some((g) => /기아/.test(g))) {
    bad.push('제조사 누출이 벗긴 후보에 남음');
  }
  return bad;
}
