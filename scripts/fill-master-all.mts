/**
 * 차종마스터 전면 보강 — 근거 3축 (웰릭스 · 엔카 · 공급사 원문)
 *
 * 규격:
 *   · 기존 표기 불변 · append-only
 *   · 표기 = 우리 이웃 어투 / TRIM_ALIAS / 한글 우선
 *   · 제원·기본형·세대코드·파워라인·패키지 제외
 *   · 범위 = 단종 2016 이후 세대
 *
 *   npx tsx scripts/fill-master-all.mts           미리보기
 *   APPLY=1 npx tsx scripts/fill-master-all.mts   반영
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isForbiddenAsTrimImport } from '../lib/domain/vehicle-field-guards';
import { realMasterTrims, isNoTrimLabel } from '../lib/domain/vehicle-master-options';
import { TRIM_ALIAS, TRIM_TYPO, similarity } from '../lib/domain/vehicle-trim-resolve';
import { buildSubIndex, resolveSubModel } from '../lib/domain/vehicle-sub-resolve';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const flat = (v: string) => v.toLowerCase()
  .replace(/플러스/g, 'plus').replace(/\+/g, 'plus')
  .replace(/라인/g, 'line')
  .replace(/[\s\-_()/·.]/g, '');
const NOW = 2026;
const FLOOR = 2016;
const MIN_ENCAR = 3;
const MIN_STOCK = 1;
const FILE = 'public/data/vehicle-master.json';
const apply = S(process.env.APPLY) === '1';

const BADGE_NOISE = /^(?:가솔린|디젤|엘피지|lpg|lpi|hev|phev|ev|전기|수소|하이브리드|터보|turbo|gdi|tfsi|tdi|tsi|crdi|awd|4wd|2wd|fwd|rwd|콰트로|quattro|xdrive|4매틱|4matic|인승|도어|밴|van|[0-9]+(?:\.[0-9]+)?(?:t|d|l)?|[0-9]+)$/i;

const masterRaw = JSON.parse(readFileSync(FILE, 'utf8'));
const doc = Array.isArray(masterRaw) ? { entries: masterRaw as Rec[] } : masterRaw as { entries: Rec[] };
const entries = doc.entries || [];
const cat: Rec[] = JSON.parse(readFileSync('tmp/encar/catalog.json', 'utf8'));
let welrix: Rec[] = [];
try {
  welrix = JSON.parse(readFileSync('C:/dev/welrixtable/src/data/vehicles.json', 'utf8'));
} catch { /* optional */ }

const index = buildSubIndex(entries as never, NOW);

type SubBag = {
  maker: string; origin: string; start: number; end: number;
  trims: string[]; variantLabels: string[];
};
const bySub = new Map<string, SubBag>();
for (const e of entries) {
  const sub = S(e.sub_model);
  if (!sub) continue;
  const start = Number(e.year_start) || 0;
  const end = /^\d{4}$/.test(S(e.year_end)) ? Number(e.year_end) : NOW;
  const hit = bySub.get(sub) || {
    maker: S(e.maker), origin: S(e.origin), start, end, trims: [], variantLabels: [],
  };
  hit.start = Math.min(hit.start || start, start || hit.start);
  hit.end = Math.max(hit.end, end);
  if (!hit.maker) hit.maker = S(e.maker);
  if (!hit.origin) hit.origin = S(e.origin);
  for (const t of realMasterTrims((e.trims || []) as never)) {
    if (S(t) && !hit.trims.includes(S(t))) hit.trims.push(S(t));
  }
  for (const v of (e.variants || []) as Rec[]) {
    const lab = S(v.label);
    if (lab && !hit.variantLabels.includes(lab)) hit.variantLabels.push(lab);
    for (const t of realMasterTrims((v.trims || []) as never)) {
      if (S(t) && !hit.trims.includes(S(t))) hit.trims.push(S(t));
    }
  }
  bySub.set(sub, hit);
}

function neighborPool(maker: string): string[] {
  const set = new Set<string>();
  for (const s of bySub.values()) {
    if (s.maker !== maker) continue;
    for (const t of s.trims) set.add(t);
  }
  return [...set];
}

function canonTrim(raw: string): string {
  let t = S(raw)
    .replace(/\(택시형\)|\(렌터카\)|\(자가용\)|\(장애인\)|\(일반인\)|\(렌터카용\)|\(렌트카용\)/g, '')
    .replace(/^렌터카\s*/g, '')
    .replace(/\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/u, '')
    .replace(/\s+[0-9]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  // 붙여쓴 베스트셀렉션
  t = t.replace(/베스트셀렉션/g, '베스트 셀렉션').replace(/스마트셀렉션/g, '스마트 셀렉션');
  let folded = t;
  for (const [en, ko] of Object.entries(TRIM_ALIAS)) {
    if (folded.toLowerCase().includes(en)) folded = folded.replace(new RegExp(en, 'ig'), ko);
  }
  t = folded.replace(/\s+/g, ' ').trim();
  const f = flat(t);
  for (const [w, r] of Object.entries(TRIM_TYPO)) if (flat(w) === f) return r;
  if (f === '비지니스') return '비즈니스';
  if (f === 'hpick' || f === 'h-pick') return 'H-Pick';
  if (/^n\s*line$/i.test(t) || f === 'nline') return 'N라인';
  if (/^gt\s*line$/i.test(t) || f === 'gtline') return 'GT라인';
  if (/^x\s*line$/i.test(t) || f === 'xline') return 'X라인';
  if (/^limited-?x$/i.test(t)) return '리미티드';
  return t;
}

/** 트림 import 차단 SSOT — `vehicle-field-guards.isForbiddenAsTrimImport` */
function isJunk(trim: string): boolean {
  return isForbiddenAsTrimImport(trim);
}

/** 차명·세대명이 트림으로 들어온 것 */
function isModelLeak(trim: string, sub: string, maker: string): boolean {
  const f = flat(trim);
  if (f.length < 2) return true;
  if (flat(sub).includes(f) && f.length >= 2) return true;
  if (f.length >= 3 && flat(sub).includes(f)) return true;
  // 짧은 차명 토큰
  for (const tok of sub.split(/\s+/)) {
    if (tok.length >= 2 && flat(tok) === f) return true;
  }
  if (flat(maker) === f) return true;
  const CARS = /^(현대|기아|제네시스|쉐보레|르노|쌍용|bmw|벤츠|아우디|폭스바겐|볼보|미니|테슬라|포르쉐|렉서스|도요타|토요타|혼다|닛산|지프|푸조|캐딜락|포드|gmc|byd|그랜저|쏘나타|아반떼|싼타페|투싼|코나|셀토스|카니발|스포티지|쏘렌토|모닝|레이|니로|k3|k5|k7|k8|k9|ev6|ev9|아이오닉)$/i;
  if (CARS.test(trim)) return true;
  return false;
}

function ourLabel(raw: string, maker: string, neighbors: string[]): string {
  const c = canonTrim(raw);
  if (!c || isJunk(c)) return '';
  const f = flat(c);
  for (const n of neighbors) if (flat(n) === f) return n;
  for (const n of neighbors) if (similarity(c, n) >= 0.92) return n;
  const pool = neighborPool(maker);
  for (const n of pool) if (flat(n) === f) return n;
  for (const n of pool) if (similarity(c, n) >= 0.92) return n;
  // 신규: 한글 또는 짧은 우리식 코드
  if (/[가-힣]/.test(c) && c.length <= 24) return c;
  if (/^(N라인|GT라인|X라인|H-Pick|SLX|LEX|SE|AMG|JCW)$/i.test(c)) return c;
  if (/^[A-Z]{2,4}$/.test(c) && c.length <= 4) return c; // SLX·LEX·SE
  return '';
}

function peelBadge(badge: string): string {
  return badge.split(/\s+/).filter(Boolean).filter((p) => !BADGE_NOISE.test(p)).join(' ').trim();
}

type Cand = {
  sub: string; trim: string; maker: string;
  encarN: number; stockN: number; welrixN: number;
  sources: Set<string>;
};
const cands = new Map<string, Cand>();

function add(sub: string, rawTrim: string, src: string, n: number) {
  const info = bySub.get(sub);
  if (!info) return;
  if (info.end < FLOOR && info.end > 0) return;
  // 제네시스 + 트림 목록 비어 있음 = 정상 빈 (사장님)
  if (/제네시스/.test(info.maker) && info.trims.length === 0) return;

  const trim = ourLabel(rawTrim, info.maker, info.trims);
  if (!trim) return;
  if (isModelLeak(trim, sub, info.maker)) return;
  if (info.trims.some((t) => flat(t) === flat(trim))) return;

  const key = `${sub}\u0001${flat(trim)}`;
  const prev = cands.get(key) || {
    sub, trim, maker: info.maker, encarN: 0, stockN: 0, welrixN: 0, sources: new Set(),
  };
  prev.sources.add(src);
  if (src === 'encar') prev.encarN += n;
  else if (src === 'stock') prev.stockN += n;
  else if (src === 'welrix') prev.welrixN += n;
  cands.set(key, prev);
}

// ── 1) 엔카 ──
for (const r of cat) {
  const y0 = Number(r.year_min) || 0;
  const y1 = Number(r.year_max) || y0;
  const hit = resolveSubModel(index, S(r.maker), S(r.sub_model), y0 || undefined, y1 || undefined);
  if (!hit.sub) continue;
  const n = Number(r.n) || 1;
  const detail = S(r.badge_detail);
  if (detail && !isNoTrimLabel(detail)) {
    add(hit.sub, detail, 'encar', n);
  } else {
    const peeled = peelBadge(S(r.badge));
    if (peeled) add(hit.sub, peeled, 'encar', n);
  }
}

// ── 2) 웰릭스 ──
for (const r of welrix) {
  const model = S(r.model) || S(r.model_name_kr);
  const trim = S(r.trim_detail).replace(/[·,/]?\s*\d+\s*인승\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!model || !trim) continue;
  const hit = resolveSubModel(index, S(r.brand) || S(r.maker), model, NOW, NOW);
  if (!hit.sub) continue;
  add(hit.sub, trim, 'welrix', 1);
}

// ── 3) 공급사 원문 ──
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

  // 다어 트림 패턴 (낱말 쪼개기 전에)
  const MULTI = [
    /베스트\s*셀렉션/g, /스마트\s*셀렉션/g, /노블레스\s*라이트/g, /노블레스\s*스페셜/g,
    /시그니처\s*블랙/g, /인스퍼레이션\s*N\s*라인/gi, /모던\s*N\s*라인/gi,
    /N\s*라인/gi, /GT\s*라인/gi, /X\s*라인/gi, /H-?PICK/gi,
    /프레스티지\s*플러스/g, /익스클루시브\s*플러스/g, /익스클루시브\s*스페셜/g,
  ];

  for (const p of Object.values(prods) as Rec[]) {
    if (!p || dead(p)) continue;
    const sub = S(p.sub_model);
    if (!sub || !bySub.has(sub)) continue;
    const raw = (p._raw_vehicle || {}) as Rec;
    let text = [raw.trim_name, raw.model, raw.sub_model, p.trim_extra, p.trim_name].map(S).filter(Boolean).join(' ');
    if (!text) continue;

    for (const re of MULTI) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        add(sub, m[0], 'stock', 1);
      }
    }
    // 낱말
    for (const w0 of text.split(/[\s/·,()[\]|+]+/)) {
      const w = S(w0).replace(/^[-+]|[-+]$/g, '');
      if (w.length < 2) continue;
      add(sub, w, 'stock', 1);
    }
  }
} catch (e) {
  console.warn('재고 원문 스킵:', String(e));
}

/** 채택 문턱: 엔카≥3 또는 웰릭스≥1 또는 (재고≥2) 또는 (재고≥1 & 엔카≥1) */
function accept(c: Cand): boolean {
  // 재고만 있을 때: 너무 짧은 영문·숫자 조각 배제
  if (c.stockN && !c.encarN && !c.welrixN) {
    if (!/[가-힣]/.test(c.trim) && !/^(SLX|LEX|SE|JCW|AMG|N라인|GT라인|X라인|H-Pick)$/i.test(c.trim)) {
      return false;
    }
  }
  if (c.encarN >= MIN_ENCAR) return true;
  if (c.welrixN >= 1) return true;
  if (c.stockN >= 2) return true;
  if (c.stockN >= MIN_STOCK && c.encarN >= 1) return true;
  if (c.stockN >= 1 && /[가-힣]{2,}/.test(c.trim) && c.trim.length <= 12) {
    const pool = neighborPool(c.maker);
    if (pool.some((t) => flat(t).includes(flat(c.trim)) || flat(c.trim).includes(flat(t)))) return true;
  }
  return false;
}

const rows = [...cands.values()].filter(accept)
  .sort((a, b) => (b.encarN + b.stockN * 3 + b.welrixN * 5) - (a.encarN + a.stockN * 3 + a.welrixN * 5)
    || a.sub.localeCompare(b.sub, 'ko'));

console.log(`■ 전면 보강 후보 ${rows.length}종 (3축 · 규격 필터 후)\n`);
console.log('  encar≥3 | welrix≥1 | stock≥2 | stock+encar');
const bySrc = { e: 0, w: 0, s: 0, mix: 0 };
for (const r of rows) {
  if (r.welrixN) bySrc.w++;
  else if (r.encarN >= MIN_ENCAR && r.stockN) bySrc.mix++;
  else if (r.encarN >= MIN_ENCAR) bySrc.e++;
  else bySrc.s++;
}
console.log(`  분류 엔카단독≈${bySrc.e} 웰릭스=${bySrc.w} 재고=${bySrc.s} 혼합=${bySrc.mix}\n`);

console.log('── 상위 50');
for (const r of rows.slice(0, 50)) {
  const src = [...r.sources].join('+');
  console.log(
    `E${String(r.encarN).padStart(4)} S${String(r.stockN).padStart(3)} W${r.welrixN}  `
    + `${r.sub.slice(0, 28).padEnd(30)} 「${r.trim}」  (${src})`,
  );
}

mkdirSync('tmp/encar', { recursive: true });
const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/encar/master-fill-all.csv', `\uFEFF${[
  ['제조사', '세대', '추가트림', '엔카', '재고원문', '웰릭스', '근거'].join(','),
  ...rows.map((r) => [
    r.maker, r.sub, r.trim, r.encarN, r.stockN, r.welrixN, [...r.sources].join('+'),
  ].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n→ tmp/encar/master-fill-all.csv (${rows.length}행)`);

if (!apply) {
  console.log('\n(미리보기 — APPLY=1 로 반영)');
  process.exit(0);
}

let added = 0;
const touched = new Set<string>();
for (const r of rows) {
  const targets = entries.filter((e) => S(e.sub_model) === r.sub);
  for (const e of targets) {
    if (!Array.isArray(e.trims)) e.trims = [];
    if (!(e.trims as string[]).some((t) => flat(S(t)) === flat(r.trim))) {
      (e.trims as string[]).push(r.trim);
      added++;
      touched.add(r.sub);
    }
    for (const v of (e.variants || []) as Rec[]) {
      if (!Array.isArray(v.trims)) v.trims = [];
      // variant에 트림이 이미 있거나, 세대 rollup만 있는 빈 variant에도 넣음
      if ((v.trims as string[]).some((t) => flat(S(t)) === flat(r.trim))) continue;
      // 세부등급 없음만 있던 variant도 실제 등급 추가
      (v.trims as string[]).push(r.trim);
      added++;
    }
  }
}

copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`\n반영 완료: 칸 +${added} · 세대 ${touched.size}종 · 백업 ${FILE}.bak`);
