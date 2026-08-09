/**
 * 엔카 catalog → 우리식 마스터 보강 **승인용 CSV**
 * 계획: master_fill_from_encar · docs/PLAN-ENCAR-LEARN-2026-08-09.md
 *
 *   npx tsx scripts/encar-master-fill-propose.mts
 *
 * 산출:
 *   tmp/encar/sub-map.csv              — 엔카 Model → 우리 sub
 *   tmp/encar/master-fill-propose.csv  — 트림결손 승인용 (반영 열 빈칸)
 *
 * ★vehicle-master.json 수정 없음 · RTDB 쓰기 없음 · 푸시 없음
 * 세대 대응 SSOT = lib/domain/vehicle-sub-resolve.ts (웰릭스 감사와 동일)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';
import { isForbiddenAsTrimImport } from '../lib/domain/vehicle-field-guards';
import { isNoTrimLabel } from '../lib/domain/vehicle-master-options';
import { TRIM_TYPO, similarity } from '../lib/domain/vehicle-trim-resolve';
import { buildSubIndex, resolveSubModel } from '../lib/domain/vehicle-sub-resolve';

type Rec = Record<string, any>;
type Tuple = {
  maker: string;
  sub_model: string;
  badge: string;
  badge_detail: string;
  fuel: string;
  green: string;
  year_min: number;
  year_max: number;
  n: number;
};

const S = (v: unknown) => String(v ?? '').trim();
const flat = (v: string) => v.toLowerCase().replace(/[\s\-_()/·.]/g, '');
const DIR = 'tmp/encar';
const CATALOG = `${DIR}/catalog.json`;
const SUB_MAP_OUT = `${DIR}/sub-map.csv`;
const PROPOSE_OUT = `${DIR}/master-fill-propose.csv`;
const MIN_N = 3;

const BADGE_NOISE = new RegExp(
  '^(?:'
  + '가솔린|디젤|엘피지|lpg|lpi|hev|phev|ev|전기|수소|하이브리드|가솔린하이브리드'
  + '|터보|turbo|gdi|tci|crdi|vgt|smartstream|스마트스트림'
  + '|이륜|사륜|전륜|후륜|awd|4wd|2wd|fwd|rwd|xdrive|quattro|4매틱|4matic|2매틱'
  + '|오토|수동|자동|at|mt|cvt|dct'
  + '|인승|도어|밴|van|왜건|세단|해치|쿠페'
  + '|[0-9]+(?:\\.[0-9]+)?(?:t|d|l|리터)?'
  + '|[0-9]+$'
  + ')$',
  'i',
);

function peelTrimFromBadge(badge: string): string {
  return badge.split(/\s+/).filter(Boolean).filter((p) => !BADGE_NOISE.test(p)).join(' ').trim();
}

function normalizeTrimLabel(raw: string): string {
  return S(raw)
    .replace(/\(택시형\)|\(렌터카\)|\(자가용\)|\(장애인\)|\(일반인\)/g, '')
    .replace(/\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/u, '')
    .replace(/\s+[0-9]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimOf(t: Tuple): string {
  const detail = S(t.badge_detail);
  if (detail && !isNoTrimLabel(detail) && !isForbiddenAsTrimImport(detail)) return normalizeTrimLabel(detail);
  const peeled = peelTrimFromBadge(S(t.badge));
  if (peeled && !isNoTrimLabel(peeled) && peeled !== S(t.badge) && !isForbiddenAsTrimImport(peeled)) {
    return normalizeTrimLabel(peeled);
  }
  if (peeled && peeled.length <= 20 && !/\d\.\d/.test(peeled) && !isForbiddenAsTrimImport(peeled)) {
    return normalizeTrimLabel(peeled);
  }
  return '';
}

function canonTypo(trim: string): string {
  const f = flat(trim);
  for (const [wrong, right] of Object.entries(TRIM_TYPO)) {
    if (flat(wrong) === f) return right;
  }
  // 흔한 엔카 오탈 — 마스터 정본만 (기존 항목 rename 아님)
  if (f === '비지니스') return '비즈니스';
  return trim;
}

function esc(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

// ── load ──
if (!existsSync(CATALOG)) {
  console.error(`없음: ${CATALOG}`);
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as Tuple[];
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const index = buildSubIndex(entries);
const bySub = index.bySub;

function resolveSub(
  encarMaker: string,
  encarModel: string,
  yearMin?: number,
  yearMax?: number,
) {
  return resolveSubModel(index, encarMaker, encarModel, yearMin, yearMax);
}

/** 이웃 트림 어투로 제안 표기 — 기존 마스터 문자열은 건드리지 않고, 새 칸에 넣을 후보만. */
function proposeOurTrim(encarTrim: string, neighbors: string[]): string {
  const raw = canonTypo(normalizeTrimLabel(encarTrim));
  if (!raw) return '';
  // 이미 이웃과 flat 동일 → 이웃 정본 사용(표기 통일)
  const f = flat(raw);
  for (const n of neighbors) {
    if (flat(n) === f) return n;
  }
  // X-Line → X라인 등 이웃에 비슷한 표기가 있으면 그 어투
  for (const n of neighbors) {
    if (similarity(raw, n) >= 0.9) return n;
  }
  const xline = neighbors.find((n) => /x\s*라인|x라인/i.test(flat(n)) || /x라인/i.test(n));
  if (xline && /^x[-\s]?line$/i.test(raw)) return xline;
  if (/^x[-\s]?line$/i.test(raw) && !xline) return 'X라인';
  // GT Line → 이웃 GT라인
  const gtline = neighbors.find((n) => /gt\s*라인|gt라인/i.test(flat(n)) || /GT라인/.test(n));
  if (gtline && /^gt[-\s]?line$/i.test(raw)) return gtline;
  if (/^gt[-\s]?line$/i.test(raw) && !gtline) return 'GT라인';
  // 기본: 정규화·오탈 교정만 한 한글/우리식 후보 (엔카 원문 영문 장문 금지)
  if (/[A-Za-z]{4,}/.test(raw) && !/^[A-Z]{1,3}\b/.test(raw) && raw.length > 12) {
    // 긴 영문은 제안하지 않음 — 사람이 볼 「원문」열에만
    return '';
  }
  return raw;
}

function masterHasTrim(neighbors: string[], proposed: string): boolean {
  const f = flat(proposed);
  return neighbors.some((n) => flat(n) === f);
}

// 재고 (읽기만)
const stockBySub = new Map<string, number>();
const stockRawHints: Array<{ sub: string; word: string; n: number }> = [];
try {
  const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
  const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token!;
  const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
  const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
  const seltosBest = new Map<string, number>();
  for (const p of Object.values(prods) as Rec[]) {
    if (!p || dead(p)) continue;
    const sub = S(p.sub_model);
    if (sub) stockBySub.set(sub, (stockBySub.get(sub) || 0) + 1);
    const raw = p._raw_vehicle as Rec | undefined;
    const blob = [raw?.trim_name, raw?.model, raw?.sub_model, p.trim_extra, p.trim_name].map(S).join(' ');
    if (/셀토스/.test(sub + blob) && /베스트\s*셀렉션/.test(blob)) {
      const key = sub || '더 2026 셀토스 SP3';
      seltosBest.set(key, (seltosBest.get(key) || 0) + 1);
    }
  }
  for (const [sub, n] of seltosBest) stockRawHints.push({ sub, word: '베스트 셀렉션', n });
  console.log(`재고 세부모델 ${stockBySub.size}종 · 셀토스+베스트 원문 ${stockRawHints.reduce((a, b) => a + b.n, 0)}대`);
} catch (err) {
  console.warn('재고 읽기 스킵:', String(err));
}

// ── 1) sub-map.csv (+ 연식 다후보 분석) ──
type SubMapRow = {
  encarMaker: string;
  encarModel: string;
  ourSub: string;
  how: string;
  n: number;
  yearMin: number;
  yearMax: number;
  yearDecided: boolean;
  candText: string;
};
const subMap = new Map<string, SubMapRow>();
for (const t of catalog) {
  const encarModel = S(t.sub_model);
  const encarMaker = S(t.maker);
  if (!encarModel) continue;
  const key = `${encarMaker}\u0001${encarModel}`;
  const y0 = t.year_min || 0;
  const y1 = t.year_max || t.year_min || 0;
  const hit = resolveSub(encarMaker, encarModel, y0 || undefined, y1 || undefined);
  const candText = hit.cands.map((c) => (
    `${c.sub}(이름${c.nameScore.toFixed(2)}/연식${c.yearScore.toFixed(2)}:${c.why})`
  )).join(' | ');
  const prev = subMap.get(key);
  if (prev) {
    prev.n += t.n;
    if (t.year_min && (!prev.yearMin || t.year_min < prev.yearMin)) prev.yearMin = t.year_min;
    if (t.year_max && t.year_max > prev.yearMax) prev.yearMax = t.year_max;
    // 연식 구간이 넓어지면 재해석
    const again = resolveSub(encarMaker, encarModel, prev.yearMin || undefined, prev.yearMax || undefined);
    prev.ourSub = again.sub || '';
    prev.how = again.how;
    prev.yearDecided = again.yearDecided;
    prev.candText = again.cands.map((c) => (
      `${c.sub}(이름${c.nameScore.toFixed(2)}/연식${c.yearScore.toFixed(2)}:${c.why})`
    )).join(' | ');
  } else {
    subMap.set(key, {
      encarMaker, encarModel,
      ourSub: hit.sub || '',
      how: hit.how,
      n: t.n,
      yearMin: t.year_min || 0,
      yearMax: t.year_max || 0,
      yearDecided: hit.yearDecided,
      candText,
    });
  }
}
const subMapRows = [...subMap.values()].sort((a, b) => b.n - a.n || a.encarModel.localeCompare(b.encarModel, 'ko'));
writeFileSync(SUB_MAP_OUT, '\uFEFF' + [
  ['엔카제조사', '엔카Model', '우리sub_model', '근거', '연식결정', '후보(이름/연식)', '엔카매물수', '연식min', '연식max'].join(','),
  ...subMapRows.map((r) => [
    r.encarMaker, r.encarModel, r.ourSub, r.how, r.yearDecided ? 'Y' : '',
    r.candText, r.n, r.yearMin, r.yearMax,
  ].map(esc).join(',')),
].join('\r\n'), 'utf8');

// 연식으로 갈라진·다후보 분석 전용
const YEAR_OUT = `${DIR}/sub-map-year-analysis.csv`;
const yearRows = subMapRows.filter((r) => r.yearDecided || (r.candText.split('|').length >= 2 && r.ourSub));
writeFileSync(YEAR_OUT, '\uFEFF' + [
  ['엔카제조사', '엔카Model', '우리sub_model', '근거', '연식결정', '후보(이름/연식)', '엔카매물수', '연식min', '연식max'].join(','),
  ...yearRows.map((r) => [
    r.encarMaker, r.encarModel, r.ourSub, r.how, r.yearDecided ? 'Y' : '',
    r.candText, r.n, r.yearMin, r.yearMax,
  ].map(esc).join(',')),
].join('\r\n'), 'utf8');

const mapped = subMapRows.filter((r) => r.ourSub).length;
const yearDecidedN = subMapRows.filter((r) => r.yearDecided).length;
console.log(`sub-map: ${subMapRows.length}종 · 매핑 ${mapped} · 미매핑 ${subMapRows.length - mapped} · 연식결정 ${yearDecidedN}`);
console.log(`→ ${SUB_MAP_OUT}`);
console.log(`→ ${YEAR_OUT} (${yearRows.length}행 · 다후보/연식분기)`);

// ── 2) 트림 집계 + propose ──
type Agg = {
  maker: string;
  subRaw: string;
  ourSub: string;
  how: string;
  trimRaw: string;
  n: number;
};
const agg = new Map<string, Agg>();
for (const t of catalog) {
  const trimRaw = trimOf(t);
  if (!trimRaw) continue;
  const subRaw = S(t.sub_model);
  const hit = resolveSub(t.maker, subRaw, t.year_min || undefined, t.year_max || undefined);
  const ourSub = hit.sub || '';
  const key = `${ourSub || subRaw}\u0001${flat(trimRaw)}`;
  const prev = agg.get(key);
  if (prev) prev.n += t.n;
  else {
    agg.set(key, {
      maker: S(t.maker), subRaw, ourSub, how: hit.how, trimRaw, n: t.n,
    });
  }
}

type ProposeKind = '트림결손' | '세대미매핑' | '표기차(참고)' | '축결손(참고)' | '엔카근거없음·재고원문만';
type ProposeRow = {
  kind: ProposeKind;
  maker: string;
  ourSub: string;
  proposeTrim: string;
  encarModel: string;
  encarTrim: string;
  encarN: number;
  stock: number;
  neighbors: string;
  note: string;
  apply: string;
};

const rows: ProposeRow[] = [];

for (const a of agg.values()) {
  if (a.n < MIN_N) continue;
  if (!a.ourSub) {
    rows.push({
      kind: '세대미매핑',
      maker: a.maker,
      ourSub: '',
      proposeTrim: '',
      encarModel: a.subRaw,
      encarTrim: a.trimRaw,
      encarN: a.n,
      stock: 0,
      neighbors: '',
      note: a.how,
      apply: '',
    });
    continue;
  }
  const info = bySub.get(a.ourSub);
  if (!info) {
    rows.push({
      kind: '세대미매핑',
      maker: a.maker,
      ourSub: a.ourSub,
      proposeTrim: '',
      encarModel: a.subRaw,
      encarTrim: a.trimRaw,
      encarN: a.n,
      stock: stockBySub.get(a.ourSub) || 0,
      neighbors: '',
      note: 'resolve는 됐으나 bySub 없음',
      apply: '',
    });
    continue;
  }
  const proposed = proposeOurTrim(a.trimRaw, info.trims);
  if (!proposed) {
    // 긴 영문 등 — 축/파워 혼입 가능, 참고만
    rows.push({
      kind: '표기차(참고)',
      maker: a.maker,
      ourSub: a.ourSub,
      proposeTrim: '',
      encarModel: a.subRaw,
      encarTrim: a.trimRaw,
      encarN: a.n,
      stock: stockBySub.get(a.ourSub) || 0,
      neighbors: info.trims.slice(0, 8).join(' · '),
      note: '제안표기 보류(영문장문·혼입 가능)',
      apply: '',
    });
    continue;
  }
  if (masterHasTrim(info.trims, proposed)) {
    // 이미 있음 — 승인 CSV에 안 넣음 (일치)
    continue;
  }
  // 인승·구동이 트림에 붙은 엔카 표기 → 축결손 참고(이번 반영 대상 아님)
  if (/^\d{1,2}\s*인승/.test(proposed) || /\b[24]WD\b/i.test(proposed) || /사륜|전륜|후륜/.test(proposed)) {
    rows.push({
      kind: '축결손(참고)',
      maker: info.maker || a.maker,
      ourSub: a.ourSub,
      proposeTrim: proposed,
      encarModel: a.subRaw,
      encarTrim: a.trimRaw,
      encarN: a.n,
      stock: stockBySub.get(a.ourSub) || 0,
      neighbors: info.trims.slice(0, 8).join(' · '),
      note: '인승·구동은 variant 축 · 1단계 트림 append 대상 아님',
      apply: '',
    });
    continue;
  }
  // 엔진·배지 코드형 (E220d · 530i · TFSI …) — 파워트레인 축
  if (
    /^(?:[A-Z]{1,3}\d{2,3}[a-z]?)\b/i.test(proposed)
    || /\b(?:tfsi|tdi|tdi|gdi|t-gdi|crdi|mhev|phev)\b/i.test(proposed)
    || /\d\.\d\s*(?:t|d)?\b/i.test(proposed) && proposed.length <= 8
  ) {
    rows.push({
      kind: '축결손(참고)',
      maker: info.maker || a.maker,
      ourSub: a.ourSub,
      proposeTrim: proposed,
      encarModel: a.subRaw,
      encarTrim: a.trimRaw,
      encarN: a.n,
      stock: stockBySub.get(a.ourSub) || 0,
      neighbors: info.trims.slice(0, 8).join(' · '),
      note: '엔진·배지 코드 = 파워트레인 축 · 1단계 트림 append 대상 아님',
      apply: '',
    });
    continue;
  }
  // 표기차: flat 다르지만 유사도 매우 높으면 참고
  let typoNeighbor = '';
  for (const n of info.trims) {
    if (similarity(proposed, n) >= 0.85) { typoNeighbor = n; break; }
  }
  if (typoNeighbor && flat(typoNeighbor) !== flat(proposed)) {
    rows.push({
      kind: '표기차(참고)',
      maker: a.maker,
      ourSub: a.ourSub,
      proposeTrim: typoNeighbor,
      encarModel: a.subRaw,
      encarTrim: a.trimRaw,
      encarN: a.n,
      stock: stockBySub.get(a.ourSub) || 0,
      neighbors: info.trims.slice(0, 8).join(' · '),
      note: `엔카「${a.trimRaw}」↔마스터「${typoNeighbor}」(마스터 표기 유지·추가 금지)`,
      apply: '',
    });
    continue;
  }
  rows.push({
    kind: '트림결손',
    maker: info.maker || a.maker,
    ourSub: a.ourSub,
    proposeTrim: proposed,
    encarModel: a.subRaw,
    encarTrim: a.trimRaw,
    encarN: a.n,
    stock: stockBySub.get(a.ourSub) || 0,
    neighbors: info.trims.slice(0, 8).join(' · '),
    note: [
      a.subRaw !== a.ourSub ? `엔카「${a.subRaw}」→「${a.ourSub}」(${a.how})` : a.how,
      '빈 칸 append만 · 기존 표기 불변',
    ].filter(Boolean).join(' · '),
    apply: '',
  });
}

// 엔카 0 · 재고 원문만 (셀토스 베스트 등)
for (const h of stockRawHints) {
  const sub = bySub.has(h.sub) ? h.sub
    : (resolveSub('기아', h.sub).sub || h.sub);
  const info = bySub.get(sub);
  const neighbors = info?.trims || [];
  if (masterHasTrim(neighbors, h.word)) continue;
  const dup = rows.some((r) => r.kind === '트림결손' && r.ourSub === sub && flat(r.proposeTrim) === flat(h.word));
  if (dup) continue;
  rows.push({
    kind: '엔카근거없음·재고원문만',
    maker: info?.maker || '기아',
    ourSub: sub,
    proposeTrim: h.word,
    encarModel: '',
    encarTrim: h.word,
    encarN: 0,
    stock: h.n,
    neighbors: neighbors.slice(0, 8).join(' · '),
    note: '엔카 catalog 0건 · 우리 재고 원문에만 있음 — 승인 전 엔카/공식 확인',
    apply: '',
  });
}

rows.sort((a, b) => {
  const rank = (k: ProposeKind) => (
    { 트림결손: 0, '엔카근거없음·재고원문만': 1, '축결손(참고)': 2, 세대미매핑: 3, '표기차(참고)': 4 }[k]
  );
  if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
  if (b.stock !== a.stock) return b.stock - a.stock;
  if (b.encarN !== a.encarN) return b.encarN - a.encarN;
  return a.ourSub.localeCompare(b.ourSub, 'ko') || a.proposeTrim.localeCompare(b.proposeTrim, 'ko');
});

writeFileSync(PROPOSE_OUT, '\uFEFF' + [
  ['구분', '제조사', '우리세대(sub_model)', '제안트림', '엔카Model', '엔카트림원문', '엔카매물수', '우리재고대수', '마스터이웃', '판정', '반영'].join(','),
  ...rows.map((r) => [
    r.kind, r.maker, r.ourSub, r.proposeTrim, r.encarModel, r.encarTrim,
    r.encarN, r.stock, r.neighbors, r.note, r.apply,
  ].map(esc).join(',')),
].join('\r\n'), 'utf8');

const count = (k: ProposeKind) => rows.filter((r) => r.kind === k).length;
console.log(`propose: 트림결손 ${count('트림결손')} · 축결손 ${count('축결손(참고)')} · 세대미매핑 ${count('세대미매핑')} · 표기차 ${count('표기차(참고)')} · 재고원문만 ${count('엔카근거없음·재고원문만')}`);
console.log(`→ ${PROPOSE_OUT}`);

// ── 3) 정답지 ──
const answers = [
  { sub: '트랙스 크로스오버 9BQC', trim: 'RS' },
  { sub: '더 2026 셀토스 SP3', trim: '베스트 셀렉션' },
  { sub: '쏘나타 디 엣지 DN8', trim: '비즈니스' },
  { sub: 'K8 GL3', trim: '스탠다드' },
];
console.log('\n══ 정답지(트림결손 또는 재고원문만) ══');
for (const a of answers) {
  const hit = rows.find((r) => (
    (r.kind === '트림결손' || r.kind === '엔카근거없음·재고원문만')
    && (r.ourSub === a.sub || r.ourSub.includes(a.sub) || a.sub.includes(r.ourSub))
    && (r.proposeTrim === a.trim || flat(r.proposeTrim) === flat(a.trim))
  ));
  console.log(`${hit ? 'OK' : 'MISS'}  ${a.sub} · ${a.trim}${hit ? ` [${hit.kind} 재고${hit.stock} 엔카${hit.encarN}]` : ''}`);
}
const shadow = rows.find((r) => r.kind === '트림결손'
  && /아이오닉.*일렉트릭/.test(r.ourSub) && /익스클루시브/.test(r.proposeTrim));
console.log(`그림자 아이오닉일렉트릭+익스클루시브 결손이면 안 됨: ${shadow ? 'BAD' : 'OK'}`);

console.log('\n══ 트림결손 상위 20 (재고优先) ══');
for (const r of rows.filter((x) => x.kind === '트림결손').slice(0, 20)) {
  console.log(`${String(r.stock).padStart(3)}재고 ${String(r.encarN).padStart(5)}엔카  ${r.ourSub} · ${r.proposeTrim}`);
}

// 마스터 미수정 확인 메시지
console.log('\nvehicle-master.json: 이 스크립트는 쓰지 않음 (승인 후 append-only).');
