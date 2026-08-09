/**
 * 차종마스터 ↔ 웰릭스테이블 신차견적 정합성.
 *
 * 신차는 견적기 근거 · 세대 대응은 엔카와 **같은 기계**
 * (`lib/domain/vehicle-sub-resolve.ts` · 접두+코드 · 서수 · 연식).
 *
 *   OUT=tmp/welrix-gap.csv npx tsx scripts/audit-master-vs-welrix.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { buildSubIndex, resolveSubModel } from '../lib/domain/vehicle-sub-resolve';
// ★규칙은 한 벌이다 — 엔카든 견적기든 «무엇이 트림인가»는 같은 표가 정한다.
import { foldTrim, normalizeTrim } from '../lib/domain/master-learn';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const WELRIX = process.env.WELRIX || 'C:/dev/welrixtable/src/data/vehicles.json';
const NOW = Number(process.env.NOW) || 2026;

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const rows: Rec[] = JSON.parse(readFileSync(WELRIX, 'utf8'));
const index = buildSubIndex(entries, NOW);

/**
 * 견적기는 인승을 트림 칸 **중간**에 넣는다 — 「익스클루시브 · 7인승」.
 * 엔진의 `normalizeTrim` 은 앞머리 인승만 뗀다(엔카가 그 모양이라). 여기서 먼저 걷어낸다.
 */
const stripSeatsAnywhere = (v: string) => S(v)
  .replace(/[·,/]?\s*\d+\s*인승\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
const fold = foldTrim;

type Gap = { maker: string; sub: string; trim: string; n: number; ex: string[]; neighbors: string; how: string };
const gaps = new Map<string, Gap>();
let matched = 0; let same = 0; let noSub = 0;
const unmappedModels = new Map<string, number>();
const mapSamples: Array<{ model: string; sub: string; how: string }> = [];

for (const r of rows) {
  const model = S(r.model) || S(r.model_name_kr) || S(r.name);
  const trim = normalizeTrim(stripSeatsAnywhere(S(r.trim_detail)));
  if (!model || !trim) continue;
  const maker = S(r.brand) || S(r.maker) || '';
  // 신차 = 기준연에 걸리는 세대. 연식으로 구형 TM 등을 민다.
  const hit = resolveSubModel(index, maker, model, NOW, NOW);
  const sub = hit.sub || '';
  if (!sub) {
    noSub++;
    unmappedModels.set(model, (unmappedModels.get(model) || 0) + 1);
    continue;
  }
  if (mapSamples.length < 12 || /싼타페|셀토스|캐스퍼|그랜저|카니발/.test(model)) {
    if (mapSamples.length < 40) mapSamples.push({ model, sub, how: hit.how });
  }
  matched++;
  const info = index.bySub.get(sub)!;
  const set = new Set(info.trims);
  const ok = [...set].some((t) => fold(t) === fold(trim));
  if (ok) { same++; continue; }
  const key = `${sub}|${trim}`;
  if (!gaps.has(key)) {
    gaps.set(key, {
      maker: info.maker || maker, sub, trim, n: 0, ex: [],
      neighbors: info.trims.slice(0, 6).join(' · ') || '(트림 목록 자체가 없음)',
      how: hit.how,
    });
  }
  const g = gaps.get(key)!;
  g.n++;
  if (g.ex.length < 3) g.ex.push(`${S(r.engine_label) || S(r.trim)}`);
}

const list = [...gaps.values()].sort((a, b) => a.sub.localeCompare(b.sub, 'ko') || a.trim.localeCompare(b.trim, 'ko'));
console.log('■ 차종마스터 ↔ 웰릭스테이블 신차견적\n');
console.log(`  견적기 ${rows.length}행 · 세대 매칭됨 ${matched} · 마스터 세대 못 찾음 ${noSub}`);
console.log(`  트림 일치 ${same} · **결손 ${list.length}종**`);
console.log(`  (세대대응 = vehicle-sub-resolve · 신차연식=${NOW})\n`);

console.log('── 세대 매핑 표본');
const seen = new Set<string>();
for (const s of mapSamples) {
  const k = `${s.model}→${s.sub}`;
  if (seen.has(k)) continue;
  seen.add(k);
  if (seen.size > 15) break;
  console.log(`  ${s.model.slice(0, 22).padEnd(24)} → ${s.sub.slice(0, 28)}  (${s.how})`);
}

console.log('\n── 마스터에 없는 신차 트림');
for (const g of list.slice(0, 40)) {
  console.log(`  ${g.sub.slice(0, 24).padEnd(26)} 「${g.trim}」`);
  console.log(`     마스터 이웃: ${g.neighbors}`);
}
if (list.length > 40) console.log(`  … 그 외 ${list.length - 40}종`);

if (unmappedModels.size) {
  console.log(`\n── 견적기에 있는데 마스터 세대를 못 찾은 차 ${unmappedModels.size}종`);
  for (const [m, n] of [...unmappedModels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${m}  (견적 ${n}행)`);
  }
}

const out = S(process.env.OUT) || 'tmp/welrix-gap.csv';
mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const csv = [['구분', '제조사', '세대', '추가할트림', '견적행수', '파워트레인예시', '마스터이웃', '세대매핑근거'].join(','),
  ...list.map((g) => ['신차결손', g.maker, g.sub, g.trim, String(g.n), g.ex.join(' / '), g.neighbors, g.how].map(esc).join(',')),
].join('\r\n');
writeFileSync(out, `\uFEFF${csv}`, 'utf8');
console.log(`\nCSV: ${out}`);
