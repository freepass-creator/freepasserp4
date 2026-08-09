/**
 * 엔카 catalog.json ↔ 우리 차종마스터 대조 → tmp/encar/master-diff.csv
 * 설계: docs/PLAN-ENCAR-LEARN-2026-08-09.md §4
 *
 *   npx tsx scripts/encar-master-diff.mts
 *   npx tsx scripts/encar-master-diff.mts --catalog=tmp/encar/catalog.json
 *
 * 자동 반영 없음. 사람이 CSV를 보고 승인한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';
import { realMasterTrims, isNoTrimLabel } from '../lib/domain/vehicle-master-options';
import { TRIM_TYPO, similarity } from '../lib/domain/vehicle-trim-resolve';

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
const OUT = `${DIR}/master-diff.csv`;
const catalogPath = (() => {
  const arg = process.argv.find((a) => a.startsWith('--catalog='));
  return arg ? arg.split('=')[1] : `${DIR}/catalog.json`;
})();

const MIN_N = 3; // 엔카 3대 미만은 결손으로 올리지 않음

/** Badge에서 트림이 아닌 제원·연료·구동 조각. */
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
  const parts = badge.split(/\s+/).filter(Boolean);
  const kept = parts.filter((p) => !BADGE_NOISE.test(p));
  return kept.join(' ').trim();
}

/** 엔카 한 줄에서 «트림 후보» — BadgeDetail 우선, 없으면 Badge에서 제원 제거. */
function trimOf(t: Tuple): string {
  const detail = S(t.badge_detail);
  if (detail && !isNoTrimLabel(detail)) return normalizeTrimLabel(detail);
  const peeled = peelTrimFromBadge(S(t.badge));
  if (peeled && !isNoTrimLabel(peeled) && peeled !== S(t.badge)) return normalizeTrimLabel(peeled);
  // Badge 전체가 짧은 등급명처럼 보이면 그대로 (「르블랑」·「RS」)
  if (peeled && peeled.length <= 20 && !/\d\.\d/.test(peeled)) return normalizeTrimLabel(peeled);
  return '';
}

/** 엔카 접미 정리 — 「비즈니스 1」「스탠다드(택시형)」「베스트 셀렉션 Ⅰ」 */
function normalizeTrimLabel(raw: string): string {
  return S(raw)
    .replace(/\(택시형\)|\(렌터카\)|\(자가용\)|\(장애인\)|\(일반인\)/g, '')
    .replace(/\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/u, '')
    .replace(/\s+[0-9]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimsOfEntry(entry: MasterEntry): string[] {
  const out = new Set<string>();
  for (const t of realMasterTrims(entry.trims)) out.add(S(t));
  for (const v of entry.variants || []) {
    for (const t of realMasterTrims(v.trims)) out.add(S(t));
  }
  return [...out].filter(Boolean);
}

function canonTypo(trim: string): string {
  const f = flat(trim);
  for (const [wrong, right] of Object.entries(TRIM_TYPO)) {
    if (flat(wrong) === f) return right;
  }
  return trim;
}

function findMasterHit(masterTrims: string[], encarTrim: string): { kind: '일치' | '표기차'; master: string } | null {
  const raw = S(encarTrim);
  if (!raw) return null;
  const variants = [...new Set([raw, normalizeTrimLabel(raw), canonTypo(raw), canonTypo(normalizeTrimLabel(raw))])];
  for (const v of variants) {
    const f = flat(v);
    for (const m of masterTrims) {
      if (flat(m) === f) return { kind: flat(m) === flat(raw) ? '일치' : '표기차', master: m };
    }
  }
  // 약한 표기차: 유사도 높고 길이 비슷
  const primary = normalizeTrimLabel(raw);
  const f = flat(primary);
  let best: { master: string; sim: number } | null = null;
  for (const m of masterTrims) {
    const sim = Math.max(similarity(raw, m), similarity(primary, m));
    if (!best || sim > best.sim) best = { master: m, sim };
  }
  if (best && best.sim >= 0.78 && Math.abs(flat(best.master).length - f.length) <= 2) {
    if (flat(best.master) !== f) return { kind: '표기차', master: best.master };
    return { kind: '일치', master: best.master };
  }
  return null;
}

function makerNorm(s: string): string {
  return flat(s)
    .replace(/\(.*?\)/g, '')
    .replace(/메르세데스벤츠|메르세데스-벤츠|mercedesbenz|mercedes-benz/g, '벤츠')
    .replace(/kg모빌리티쌍용|쌍용자동차|쌍용/g, 'kg모빌리티')
    .replace(/쉐보래|한국지엠|gm대우/g, '쉐보레');
}

// ── load ──
if (!existsSync(catalogPath)) {
  console.error(`catalog 없음: ${catalogPath}\n먼저: npx tsx scripts/encar-crawl.mts`);
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Tuple[];
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

const bySub = new Map<string, { maker: string; trims: string[]; entries: MasterEntry[] }>();
const allSubs: Array<{ sub: string; maker: string; nMaker: string; nSub: string; codes: string[] }> = [];
for (const e of entries) {
  const sub = S(e.sub_model);
  if (!sub) continue;
  const hit = bySub.get(sub) || { maker: S(e.maker), trims: [], entries: [] };
  hit.entries.push(e);
  for (const t of trimsOfEntry(e)) if (!hit.trims.includes(t)) hit.trims.push(t);
  bySub.set(sub, hit);
}
for (const [sub, info] of bySub) {
  const codes = [...new Set(info.entries.map((e) => S(e.gen_code).toUpperCase()).filter(Boolean))];
  allSubs.push({
    sub, maker: info.maker, nMaker: makerNorm(info.maker), nSub: flat(sub), codes,
  });
}

/** 엔카 Model → 우리 sub_model. 글자 일치 우선, 없으면 세대코드·접두·유사도. */
function resolveSub(encarMaker: string, encarModel: string): string | null {
  const model = S(encarModel);
  if (!model) return null;
  if (bySub.has(model)) return model;
  // 「쏘나타 디 엣지(DN8)」→「쏘나타 디 엣지 DN8」
  const cleaned = model.replace(/\(([^)]+)\)/g, ' $1 ').replace(/\s+/g, ' ').trim();
  if (cleaned !== model && bySub.has(cleaned)) return cleaned;

  const nModel = flat(cleaned || model);
  if (!nModel) return null;
  const nMaker = makerNorm(encarMaker);
  const pool = allSubs.filter((s) => !nMaker || s.nMaker === nMaker
    || s.nMaker.includes(nMaker) || nMaker.includes(s.nMaker));
  const use = pool.length ? pool : allSubs;

  for (const s of use) if (s.nSub === nModel) return s.sub;

  // 접두: 「트랙스 크로스오버」→「트랙스 크로스오버 9BQC」, 「K8」→「K8 GL3」
  const prefixHits = use.filter((s) => {
    if (s.nSub === nModel) return false;
    if (s.nSub.startsWith(nModel) && s.nSub.length > nModel.length) {
      const rest = s.nSub.slice(nModel.length);
      // 뒤에 세대코드·공백성 토큰만
      return rest.length <= 8 || /^[a-z0-9]{2,6}$/i.test(rest);
    }
    return false;
  }).sort((a, b) => a.nSub.length - b.nSub.length);
  if (prefixHits.length === 1) return prefixHits[0].sub;
  if (prefixHits.length > 1) {
    // 같은 접두면 더 짧은(기본형)보다 재고·연식 신호 없이 코드 붙은 쪽 — 최신 코드 우선은 길이 짧은 접두+코드
    const withCode = prefixHits.filter((s) => s.codes.some((c) => s.nSub.endsWith(flat(c))));
    if (withCode.length === 1) return withCode[0].sub;
    return prefixHits[0].sub;
  }

  // 세대코드가 엔카 모델명에 들어 있으면 그 코드 세대 후보
  const byCode = use.filter((s) => s.codes.some((c) => c.length >= 2 && nModel.includes(flat(c))));
  if (byCode.length === 1) return byCode[0].sub;
  if (byCode.length > 1) {
    byCode.sort((a, b) => similarity(cleaned, b.sub) - similarity(cleaned, a.sub));
    if (similarity(cleaned, byCode[0].sub) >= 0.45) return byCode[0].sub;
  }

  let best: { sub: string; sim: number } | null = null;
  for (const s of use) {
    const sim = similarity(cleaned, s.sub);
    if (!best || sim > best.sim) best = { sub: s.sub, sim };
  }
  if (best && best.sim >= 0.72) return best.sub;
  for (const s of use) {
    if (nModel.includes(s.nSub) || s.nSub.includes(nModel)) {
      if (Math.min(nModel.length, s.nSub.length) / Math.max(nModel.length, s.nSub.length) >= 0.7) {
        return s.sub;
      }
    }
  }
  return null;
}

/** 우리 재고 대수 (세부모델별). Firebase 없으면 0. */
const stockBySub = new Map<string, number>();
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
  for (const p of Object.values(prods) as Rec[]) {
    if (!p || dead(p)) continue;
    const sub = S(p.sub_model);
    if (!sub) continue;
    stockBySub.set(sub, (stockBySub.get(sub) || 0) + 1);
  }
  console.log(`재고 세부모델 ${stockBySub.size}종`);
} catch (err) {
  console.warn('재고 카운트 스킵(우리재고대수=0):', String(err));
}

type Kind = '결손' | '표기차' | '일치' | '우리만';
type Row = {
  kind: Kind;
  maker: string;
  sub: string;
  trim: string;
  encarN: number;
  master: string;
  stock: number;
  note: string;
};

/** 엔카 (resolvedSub, trim) 집계 — 원문 세대명도 보관 */
const encarAgg = new Map<string, {
  maker: string; sub: string; subRaw: string; trim: string; n: number;
}>();
for (const t of catalog) {
  const trim = trimOf(t);
  if (!trim) continue;
  const subRaw = S(t.sub_model);
  const sub = resolveSub(t.maker, subRaw) || subRaw;
  const key = `${sub}\u0001${flat(trim)}`;
  const prev = encarAgg.get(key);
  if (prev) prev.n += t.n;
  else encarAgg.set(key, { maker: S(t.maker), sub, subRaw, trim, n: t.n });
}

const rows: Row[] = [];
const seenEncar = new Set<string>();

for (const hit of encarAgg.values()) {
  const master = bySub.get(hit.sub);
  const stock = stockBySub.get(hit.sub) || 0;
  const key = `${hit.sub}\u0001${flat(hit.trim)}`;
  seenEncar.add(key);
  const mappedNote = hit.sub !== hit.subRaw ? `엔카세대「${hit.subRaw}」→「${hit.sub}」` : '';

  if (!master) {
    if (hit.n < MIN_N) continue;
    rows.push({
      kind: '결손', maker: hit.maker, sub: hit.subRaw, trim: hit.trim,
      encarN: hit.n, master: '', stock,
      note: ['마스터에 세대(sub_model) 없음', mappedNote].filter(Boolean).join(' · '),
    });
    continue;
  }

  const matched = findMasterHit(master.trims, hit.trim);
  if (matched?.kind === '일치') {
    rows.push({
      kind: '일치', maker: hit.maker, sub: hit.sub, trim: hit.trim,
      encarN: hit.n, master: matched.master, stock, note: mappedNote,
    });
  } else if (matched?.kind === '표기차') {
    rows.push({
      kind: '표기차', maker: hit.maker, sub: hit.sub, trim: hit.trim,
      encarN: hit.n, master: matched.master, stock,
      note: [`엔카「${hit.trim}」↔마스터「${matched.master}」(마스터 표기 유지)`, mappedNote].filter(Boolean).join(' · '),
    });
  } else {
    if (hit.n < MIN_N) continue;
    rows.push({
      kind: '결손', maker: hit.maker, sub: hit.sub, trim: hit.trim,
      encarN: hit.n, master: master.trims.slice(0, 4).join(' · '), stock,
      note: [
        master.trims.length ? '마스터 이웃 트림 있음' : '마스터 트림 목록 비어 있음',
        mappedNote,
      ].filter(Boolean).join(' · '),
    });
  }
}

// 우리만 — 마스터 트림이 엔카 집계에 없음
for (const [sub, info] of bySub) {
  const stock = stockBySub.get(sub) || 0;
  for (const trim of info.trims) {
    const key = `${sub}\u0001${flat(trim)}`;
    if (seenEncar.has(key)) continue;
    // 엔카에 같은 flat 이 다른 표기로 있을 수 있음 — 표기차로 이미 잡힌 건 skip
    let covered = false;
    for (const e of encarAgg.values()) {
      if (e.sub !== sub) continue;
      const m = findMasterHit([trim], e.trim);
      if (m) { covered = true; break; }
    }
    if (covered) continue;
    rows.push({
      kind: '우리만', maker: info.maker, sub, trim,
      encarN: 0, master: trim, stock, note: '중고시장 미유통·신차·법인 가능 — 지우지 말 것',
    });
  }
}

rows.sort((a, b) => {
  const rank = (k: Kind) => ({ 결손: 0, 표기차: 1, 일치: 2, 우리만: 3 })[k];
  if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
  if (b.stock !== a.stock) return b.stock - a.stock;
  if (b.encarN !== a.encarN) return b.encarN - a.encarN;
  return a.sub.localeCompare(b.sub, 'ko') || a.trim.localeCompare(b.trim, 'ko');
});

mkdirSync(DIR, { recursive: true });
const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const csv = [
  ['구분', '제조사', '세대(sub_model)', '트림', '엔카매물수', '우리마스터', '우리재고대수', '판정'].join(','),
  ...rows.map((r) => [r.kind, r.maker, r.sub, r.trim, r.encarN, r.master, r.stock, r.note].map(esc).join(',')),
].join('\r\n');
writeFileSync(OUT, `\uFEFF${csv}`, 'utf8');

const count = (k: Kind) => rows.filter((r) => r.kind === k).length;
console.log(`catalog ${catalog.length} tuples`);
console.log(`결손 ${count('결손')} · 표기차 ${count('표기차')} · 일치 ${count('일치')} · 우리만 ${count('우리만')}`);
console.log(`→ ${OUT}`);

// 정답지(계획 §6) — 세대·트림 표기는 접두/정규화로 느슨히
const answers = [
  { sub: '트랙스 크로스오버 9BQC', trim: 'RS' },
  { sub: '더 2026 셀토스 SP3', trim: '베스트 셀렉션' },
  { sub: '쏘나타 디 엣지 DN8', trim: '비즈니스' },
  { sub: 'K8 GL3', trim: '스탠다드' },
];
console.log('\n══ 정답지(결손이어야 함) ══');
for (const a of answers) {
  const hit = rows.find((r) => r.kind === '결손'
    && (r.sub === a.sub || r.sub.includes(a.sub) || a.sub.includes(r.sub) || flat(r.sub).includes(flat(a.sub.split(' ').slice(0, 2).join(' '))))
    && (r.trim === a.trim || flat(r.trim) === flat(a.trim) || flat(r.trim).startsWith(flat(a.trim))));
  console.log(`${hit ? 'OK' : 'MISS'}  ${a.sub} · ${a.trim}${hit ? ` (재고${hit.stock} 엔카${hit.encarN} 표기「${hit.sub}·${hit.trim}」)` : ''}`);
}
const shadow = rows.find((r) => r.kind === '결손' && /아이오닉\s*일렉트릭/.test(r.sub) && /익스클루시브/.test(r.trim));
console.log(`그림자(나오면 안 됨) 더 뉴 아이오닉 일렉트릭+익스클루시브: ${shadow ? 'BAD' : 'OK'}`);

const top = rows.filter((r) => r.kind === '결손').slice(0, 30);
console.log('\n══ 결손 상위 30 ══');
for (const r of top) {
  console.log(`${String(r.stock).padStart(3)}재고 ${String(r.encarN).padStart(5)}엔카  ${r.sub} · ${r.trim}`);
}
