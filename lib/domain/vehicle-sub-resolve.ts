/**
 * 엔카·견적기 → 우리 sub_model 세대 대응 기계 (SSOT).
 *
 * docs/PLAN-ENCAR-LEARN-2026-08-09.md:
 *   접두+코드 · 서수→gen_code · **연식 겹침**으로 동점 해소.
 *   엔카용으로 만든 것을 웰릭스 신차견적에도 **그대로** 쓴다.
 */
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import { realMasterTrims } from '@/lib/domain/vehicle-master-options';
import { similarity } from '@/lib/domain/vehicle-trim-resolve';

const S = (v: unknown) => String(v ?? '').trim();
export const flatSub = (v: string) => v.toLowerCase().replace(/[\s\-_()/·.]/g, '');

export function makerNorm(s: string): string {
  return flatSub(s)
    .replace(/\(.*?\)/g, '')
    .replace(/메르세데스벤츠|메르세데스-벤츠|mercedesbenz|mercedes-benz/g, '벤츠')
    .replace(/kg모빌리티쌍용|쌍용자동차|쌍용/g, 'kg모빌리티')
    .replace(/쉐보래|한국지엠|gm대우|쉐보레gm대우/g, '쉐보레');
}

export type SubInfo = {
  maker: string;
  model: string;
  trims: string[];
  codes: string[];
  yearStart: number;
  yearEnd: number;
};

export type SubIndex = {
  bySub: Map<string, SubInfo>;
  allSubs: Array<{
    sub: string; maker: string; model: string; nMaker: string; nSub: string; codes: string[];
  }>;
  genOrder: Map<string, string[]>;
};

export type SubCand = {
  sub: string;
  nameScore: number;
  yearScore: number;
  yearLabel: string;
  why: string;
};

export type SubMapHit = {
  sub: string | null;
  how: string;
  cands: SubCand[];
  yearDecided: boolean;
};

function trimsOfEntry(entry: MasterEntry): string[] {
  const out = new Set<string>();
  for (const t of realMasterTrims(entry.trims)) out.add(S(t));
  for (const v of entry.variants || []) {
    for (const t of realMasterTrims(v.trims)) out.add(S(t));
  }
  return [...out].filter(Boolean);
}

function buildGenOrder(entries: MasterEntry[]): Map<string, string[]> {
  const firstYear = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const g = S(e.gen_code);
    const ys = Number(e.year_start);
    if (!g || !Number.isFinite(ys)) continue;
    let mm = firstYear.get(e.model);
    if (!mm) { mm = new Map(); firstYear.set(e.model, mm); }
    const prev = mm.get(g);
    if (prev == null || ys < prev) mm.set(g, ys);
  }
  const order = new Map<string, string[]>();
  for (const [model, gm] of firstYear) {
    order.set(model, [...gm.entries()].sort((a, b) => a[1] - b[1]).map(([g]) => g));
  }
  return order;
}

export function buildSubIndex(entries: MasterEntry[], nowYear = 2026): SubIndex {
  const bySub = new Map<string, SubInfo>();
  for (const e of entries) {
    const sub = S(e.sub_model);
    if (!sub) continue;
    const hit = bySub.get(sub) || {
      maker: S(e.maker), model: S(e.model), trims: [], codes: [],
      yearStart: Number(e.year_start) || 9999,
      yearEnd: /\d{4}/.test(String(e.year_end)) ? Number(e.year_end) : 0,
    };
    if (!hit.model) hit.model = S(e.model);
    for (const t of trimsOfEntry(e)) if (!hit.trims.includes(t)) hit.trims.push(t);
    const code = S(e.gen_code).toUpperCase();
    if (code && !hit.codes.includes(code)) hit.codes.push(code);
    const ys = Number(e.year_start) || 0;
    const ye = /\d{4}/.test(String(e.year_end)) ? Number(e.year_end) : nowYear;
    if (ys && ys < hit.yearStart) hit.yearStart = ys;
    if (ye && ye > hit.yearEnd) hit.yearEnd = ye;
    bySub.set(sub, hit);
  }
  const allSubs = [...bySub.entries()].map(([sub, info]) => ({
    sub, maker: info.maker, model: info.model,
    nMaker: makerNorm(info.maker), nSub: flatSub(sub), codes: info.codes,
  }));
  return { bySub, allSubs, genOrder: buildGenOrder(entries) };
}

function yearOverlap(info: SubInfo, yMin: number, yMax: number): { score: number; label: string } {
  const a0 = info.yearStart || 0;
  const a1 = (info.yearEnd && info.yearEnd < 9000) ? info.yearEnd : 9999;
  if (!yMin && !yMax) return { score: 0, label: '연식없음' };
  const b0 = yMin || yMax;
  const b1 = yMax || yMin;
  if (!b0) return { score: 0, label: '연식없음' };
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
  const encarSpan = Math.max(1, b1 - b0 + 1);
  let score = Math.min(1, overlap / encarSpan);
  const mid = Math.round((b0 + b1) / 2);
  const inMid = mid >= a0 && mid <= a1;
  if (inMid) score = Math.max(score, 0.85);
  if (overlap <= 0) score = 0;
  return {
    score,
    label: `${a0}~${a1 === 9999 ? '현재' : a1}∩${b0}${b0 !== b1 ? '~' + b1 : ''}→${score.toFixed(2)}${inMid ? '+중점' : ''}`,
  };
}

function nameScoreFor(
  cleaned: string,
  nModel: string,
  s: SubIndex['allSubs'][0],
  bySub: Map<string, SubInfo>,
): { score: number; why: string } {
  if (s.nSub === nModel) return { score: 1, why: '정규화일치' };
  if (bySub.has(cleaned) && s.sub === cleaned) return { score: 1, why: '글자일치' };
  const sim = similarity(cleaned, s.sub);
  if (s.codes.some((c) => c.length >= 2 && nModel.includes(flatSub(c)))) {
    return { score: Math.max(0.7, sim), why: `코드:${s.codes.join('|')}` };
  }
  if (s.nSub.startsWith(nModel) && s.nSub.length > nModel.length) {
    const rest = s.nSub.slice(nModel.length);
    // 접미가 세대코드일 때만 (TM·CN7·SP2). 「니로」+「플러스de」는 다른 차다.
    if (/^[a-z0-9]{2,8}$/i.test(rest)) {
      return { score: 0.75 + Math.min(0.15, sim * 0.2), why: '접두+코드' };
    }
  }
  // 견적기 「싼타페」→「디 올 뉴 싼타페 MX5」: master.model 키가 같으면
  // 접두가 길어도 후보로 연다 — 연식이 현행 세대를 고른다.
  if (flatSub(s.model) === nModel) {
    const ratio = nModel.length / Math.max(s.nSub.length, nModel.length);
    return { score: 0.50 + Math.min(0.25, ratio * 0.5), why: '모델키일치' };
  }
  if (nModel.includes(s.nSub) || s.nSub.includes(nModel)) {
    const ratio = Math.min(nModel.length, s.nSub.length) / Math.max(nModel.length, s.nSub.length);
    if (ratio >= 0.55) return { score: 0.55 + ratio * 0.3, why: '포함' };
  }
  if (sim >= 0.45) return { score: sim, why: `유사도${sim.toFixed(2)}` };
  return { score: 0, why: '' };
}

/**
 * @param yearMin/yearMax 엔카 매물 연식 구간, 또는 신차견적이면 기준연(예: 2026)
 */
export function resolveSubModel(
  index: SubIndex,
  maker: string,
  modelName: string,
  yearMin?: number,
  yearMax?: number,
): SubMapHit {
  const { bySub, allSubs, genOrder } = index;
  const model = S(modelName);
  if (!model) return { sub: null, how: '빈이름', cands: [], yearDecided: false };
  if (bySub.has(model)) return { sub: model, how: '글자일치', cands: [], yearDecided: false };

  const cleaned = model.replace(/\(([^)]+)\)/g, ' $1 ').replace(/\s+/g, ' ').trim();
  if (cleaned !== model && bySub.has(cleaned)) {
    return { sub: cleaned, how: '괄호펼침', cands: [], yearDecided: false };
  }

  const nMaker = makerNorm(maker);
  const pool = allSubs.filter((s) => !nMaker || s.nMaker === nMaker
    || s.nMaker.includes(nMaker) || nMaker.includes(s.nMaker));
  const use = pool.length ? pool : allSubs;
  const nModel = flatSub(cleaned);
  const y0 = yearMin || 0;
  const y1 = yearMax || yearMin || 0;

  const cands: SubCand[] = [];
  const pushCand = (sub: string, nameSc: number, why: string) => {
    if (cands.some((c) => c.sub === sub)) return;
    const info = bySub.get(sub);
    if (!info) return;
    const yo = yearOverlap(info, y0, y1);
    cands.push({
      sub, nameScore: nameSc, yearScore: yo.score, yearLabel: yo.label, why,
    });
  };

  const ord = /([1-9])\s*세대/.exec(cleaned);
  if (ord) {
    const n = Number(ord[1]);
    const baseName = cleaned.replace(/더\s*뉴\s*/g, '').replace(/올\s*뉴\s*/g, '')
      .replace(/\s*[1-9]\s*세대.*/, '').replace(/\s+/g, ' ').trim();
    const nBase = flatSub(baseName);
    const modelKeys = [...new Set(use.map((s) => s.model).filter(Boolean))];
    let bestModel = '';
    let bestSim = 0;
    for (const mk of modelKeys) {
      const sim = Math.max(similarity(baseName, mk), flatSub(mk) === nBase ? 1 : 0);
      if (sim > bestSim) { bestSim = sim; bestModel = mk; }
    }
    if (bestModel && bestSim >= 0.5) {
      const order = genOrder.get(bestModel) || [];
      const code = order[n - 1];
      if (code) {
        const wantNew = /더\s*뉴|the\s*new/i.test(model);
        for (const s of use.filter((x) => x.model === bestModel && x.codes.includes(code.toUpperCase()))) {
          const bonus = /더\s*뉴|디\s*올/.test(s.sub) === wantNew ? 0.05 : 0;
          pushCand(s.sub, 0.9 + bonus, `서수${n}세대→${bestModel}/${code}`);
        }
      }
      for (const s of use.filter((x) => x.model === bestModel)) {
        pushCand(s.sub, 0.4, `동모델연식후보:${bestModel}`);
      }
    }
  }

  for (const s of use) {
    const ns = nameScoreFor(cleaned, nModel, s, bySub);
    if (ns.score >= 0.45) pushCand(s.sub, ns.score, ns.why);
  }

  if (cands.length < 2) {
    const token = cleaned.replace(/더\s*뉴|올\s*뉴|디\s*올\s*뉴|the\s*new/ig, '').trim().split(/\s+/)[0] || '';
    const nTok = flatSub(token);
    if (nTok.length >= 2) {
      for (const s of use) {
        if (flatSub(s.model) === nTok || s.nSub.includes(nTok)) {
          pushCand(s.sub, 0.35, `모델토큰+연식개방:${token}`);
        }
      }
    }
  }

  if (!cands.length) return { sub: null, how: '미매핑', cands: [], yearDecided: false };

  cands.sort((a, b) => {
    const sa = a.nameScore * 0.65 + a.yearScore * 0.35;
    const sb = b.nameScore * 0.65 + b.yearScore * 0.35;
    if (sb !== sa) return sb - sa;
    if (b.yearScore !== a.yearScore) return b.yearScore - a.yearScore;
    // 신차(연식=현재) 동점이면 더 새 세대
    return b.nameScore - a.nameScore;
  });

  const top = cands[0];
  const second = cands[1];
  const topMix = top.nameScore * 0.65 + top.yearScore * 0.35;
  const yearDecided = !!(second
    && top.yearScore > second.yearScore + 0.15
    && Math.abs(top.nameScore - second.nameScore) < 0.25
    && top.yearScore >= 0.5);

  const how = yearDecided
    ? `${top.why}+연식결정(${top.yearLabel})`
    : (top.yearScore >= 0.5 && top.nameScore < 0.85
      ? `${top.why}+연식가점(${top.yearLabel})`
      : top.why);

  if (topMix < 0.4 && top.yearScore < 0.5) {
    return { sub: null, how: `미매핑(최고${topMix.toFixed(2)})`, cands, yearDecided: false };
  }
  return { sub: top.sub, how, cands: cands.slice(0, 5), yearDecided };
}
