/**
 * 차종마스터 **파워트레인 축** ↔ 엔카 Badge 정합성.
 *
 * 사장님 지시(2026-08-09): 「애매한 건 엔카 학습하자.」
 *
 * 트림은 `BadgeDetail` 로 맞췄다. 남은 애매함은 **파워트레인 축**이다 —
 * 공급사는 「스탠다드/롱레인지」·「RS/ACTIV」로 적는데 우리 variant 는 용량·구동으로만 갈려 있다.
 * 엔카는 그걸 정확히 `Badge` 자리에 둔다. 그 어휘를 배워 온다.
 *
 *   OUT=tmp/encar/variant-diff.csv npx tsx scripts/audit-variants-vs-encar.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { buildSubIndex, resolveSubModel } from '../lib/domain/vehicle-sub-resolve';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const NOW = Number(process.env.NOW) || 2026;

/**
 * 파워트레인 비교용 접기 — 순서·표기 차이를 지운다.
 * 「가솔린 2.0」과 「2.0 가솔린」, 「AWD」와 「4WD」는 같은 말이다.
 */
const FUEL = /가솔린|디젤|lpg|lpi|하이브리드|전기|수소/gi;
const foldPt = (v: string): string => {
  const t = S(v).toLowerCase()
    .replace(/4wd|사륜/g, 'awd').replace(/2wd|전륜|후륜|fwd|rwd/g, '2wd')
    .replace(/lpi/g, 'lpg')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  // 낱말을 정렬해 순서 차이를 지운다
  return t.split(' ').filter(Boolean).sort().join(' ');
};
/**
 * 그 Badge 가 «연료·배기량·구동» 말고 **무슨 말을 더 담고 있나.**
 *
 * ★순서가 중요하다. 구동 표기를 **숫자보다 먼저** 지워야 한다 —
 *   「2WD」에서 숫자를 먼저 지우면 「WD」라는 찌꺼기가 남는다(1차 시도에서 3만 건이 그랬다).
 * ★그리고 엔카는 BadgeDetail 이 비면 **트림을 Badge 에 실어 보낸다**
 *   (「9인승 프레스티지」). 그건 트림이지 파워트레인이 아니다 — 아래에서 뺀다.
 */
const extraWords = (badge: string): string[] => S(badge)
  .replace(/4wd|2wd|awd|fwd|rwd|사륜|전륜|후륜|xdrive|quattro|4matic\+?|4매틱/gi, ' ')
  .replace(FUEL, ' ')
  .replace(/\d+\s*(인승|도어|인치|my|kwh|km)/gi, ' ')
  .replace(/\d+(\.\d+)?\s*(l|리터|t\b)?/gi, ' ')
  .replace(/터보|하이브리드|일반인\s*구입|렌터카용?|택시형?|자가용|영업용|밴|무사고/gi, ' ')
  .replace(/gdi|tdi|tsi|crdi|vgt|hev|phev|mpi|cvvl|smartstream|스마트스트림/gi, ' ')
  .replace(/[()[\],/·+]/g, ' ')
  .split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 2);

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const cat: Rec[] = JSON.parse(readFileSync('tmp/encar/catalog.json', 'utf8'));
const index = buildSubIndex(entries, NOW);

/** 마스터: 세대 → variant 라벨 */
const mVar = new Map<string, string[]>();
const mMaker = new Map<string, string>();
for (const e of entries) {
  const sub = S(e.sub_model);
  if (!sub) continue;
  mMaker.set(sub, S(e.maker));
  if (!mVar.has(sub)) mVar.set(sub, []);
  const arr = mVar.get(sub)!;
  for (const v of e.variants || []) {
    const label = S(v.label);
    if (label && !arr.includes(label)) arr.push(label);
  }
}

/** 엔카: 세대 → badge → 대수 */
const eVar = new Map<string, Map<string, number>>();
for (const r of cat) {
  const hit = resolveSubModel(index, S(r.maker), S(r.sub_model), Number(r.year_min), Number(r.year_max));
  const sub = hit.sub;
  if (!sub) continue;
  const badge = S(r.badge);
  if (!badge) continue;
  if (!eVar.has(sub)) eVar.set(sub, new Map());
  const m = eVar.get(sub)!;
  m.set(badge, (m.get(badge) || 0) + (Number(r.n) || 0));
}

/** 세대별 «트림으로 아는 말» — 마스터 트림 + 엔카 BadgeDetail 어휘. */
const knownTrimWords = new Map<string, Set<string>>();
const addKnown = (sub: string, text: string) => {
  if (!sub || !S(text) || /없음/.test(text)) return;
  if (!knownTrimWords.has(sub)) knownTrimWords.set(sub, new Set());
  const set = knownTrimWords.get(sub)!;
  for (const w of S(text).split(/[\s()[\],/·]+/)) if (w.length >= 2) set.add(w.toLowerCase());
};
for (const e of entries) {
  const sub = S(e.sub_model);
  for (const t of e.trims || []) addKnown(sub, S(t));
  for (const v of e.variants || []) for (const t of v.trims || []) addKnown(sub, S(t));
}
for (const r of cat) {
  const hit = resolveSubModel(index, S(r.maker), S(r.sub_model), Number(r.year_min), Number(r.year_max));
  if (hit.sub) addKnown(hit.sub, S(r.badge_detail));
}

type Row = { kind: string; maker: string; sub: string; badge: string; n: number; words: string; ours: string };
const rows: Row[] = [];
let same = 0; let missing = 0; let vocab = 0;

for (const [sub, badges] of eVar) {
  const ours = mVar.get(sub) || [];
  const oursFold = new Set(ours.map(foldPt));
  const maker = mMaker.get(sub) || '';
  for (const [badge, n] of badges) {
    if (n < 3) continue;                       // 오등록 방지 — 트림 때와 같은 문턱
    if (oursFold.has(foldPt(badge))) { same++; continue; }
    /**
     * ★트림으로 이미 아는 말은 뺀다.
     * 마스터 그 세대의 트림 목록 + 엔카가 그 세대의 BadgeDetail 로 쓰는 말.
     * 둘 중 하나에 있으면 그건 트림이지 «담을 자리가 없는 파워트레인 어휘»가 아니다.
     */
    const known = knownTrimWords.get(sub) || new Set<string>();
    const words = extraWords(badge).filter((w) => !known.has(w.toLowerCase()));
    if (words.length) {
      // ★우리 축에 «담을 자리가 없는 말» — 스탠다드/롱레인지/RS/ACTIV 같은 것
      vocab++;
      rows.push({ kind: '★우리 축에 없는 어휘', maker, sub, badge, n, words: words.join(' · '), ours: ours.join(' | ') });
    } else {
      missing++;
      rows.push({ kind: '조합 결손(연료·배기·구동)', maker, sub, badge, n, words: '', ours: ours.join(' | ') });
    }
  }
}

console.log('■ 파워트레인 축 — 마스터 variant ↔ 엔카 Badge\n');
console.log(`  엔카 세대 ${eVar.size}종 대조 (매물 3대 이상 Badge 만)\n`);
console.log(`  일치                     ${String(same).padStart(5)}`);
console.log(`  조합 결손(연료·배기·구동)   ${String(missing).padStart(5)}   ← 같은 축인데 그 조합이 마스터에 없음`);
console.log(`  ★우리 축에 없는 어휘        ${String(vocab).padStart(5)}   ← 배터리사양·라인 등, 담을 자리가 없다\n`);

/** 어떤 «말»이 반복해서 못 담기는가 — 이게 축을 늘릴 근거다. */
const wordTally = new Map<string, { n: number; ex: string[] }>();
for (const r of rows.filter((x) => x.kind === '★우리 축에 없는 어휘')) {
  for (const w of r.words.split(' · ')) {
    if (!wordTally.has(w)) wordTally.set(w, { n: 0, ex: [] });
    const g = wordTally.get(w)!;
    g.n += r.n;
    if (g.ex.length < 3) g.ex.push(`${r.sub}「${r.badge}」`);
  }
}
console.log('── 못 담는 말 상위 20 (엔카 매물 수 기준)');
for (const [w, g] of [...wordTally.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
  console.log(`  ${String(g.n).padStart(6)}대  「${w}」`);
  console.log(`          ${g.ex.join(' · ')}`);
}

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [['구분', '제조사', '세대', '엔카Badge', '엔카매물수', '못담는말', '우리variant'].join(','),
    ...rows.sort((a, b) => b.n - a.n).map((r) => [r.kind, r.maker, r.sub, r.badge, String(r.n), r.words, r.ours].map(esc).join(',')),
  ].join('\r\n');
  writeFileSync(out, `﻿${csv}`, 'utf8');
  console.log(`\nCSV: ${out} (${rows.length}행)`);
}
