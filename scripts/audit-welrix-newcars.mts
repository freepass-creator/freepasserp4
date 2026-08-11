/**
 * 웰릭스테이블 신차 → 차종마스터 실결손 (append 후보).
 * 세대 = vehicle-sub-resolve · 트림 = master-learn normalize/fold.
 *
 *   npx tsx scripts/audit-welrix-newcars.mts
 *   APPLY=1 npx tsx scripts/fill-welrix-newcars.mts  (별도)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { buildSubIndex, resolveSubModel } from '../lib/domain/vehicle-sub-resolve';
import { normalizeTrim, foldTrim } from '../lib/domain/master-learn';

const S = (v: unknown) => String(v ?? '').trim();
const WELRIX = process.env.WELRIX || 'C:/dev/welrixtable/src/data/vehicles.json';
const NOW = Number(process.env.NOW) || 2026;

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const rows: any[] = JSON.parse(readFileSync(WELRIX, 'utf8'));
const index = buildSubIndex(entries, NOW);

const stripSeats = (v: string) => S(v)
  .replace(/[·,/]?\s*\d+\s*인승\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

/** 견적기 모델명에서 Hybrid/EV 꼬리 제거 — 세대 이름은 보통 본체만. */
function modelCore(model: string): string {
  return S(model)
    .replace(/\s*(Hybrid|HEV|PHEV|EV|Electric)\s*$/i, '')
    .trim() || S(model);
}

type Gap = {
  maker: string; welrixModel: string; sub: string; trim: string;
  n: number; engines: string[]; neighbors: string[]; how: string;
};
const gaps = new Map<string, Gap>();
const unmapped = new Map<string, { n: number; trims: Set<string>; engines: Set<string> }>();
const mapSamples: Array<{ model: string; sub: string; how: string }> = [];
let matched = 0;
let same = 0;

for (const r of rows) {
  const welrixModel = S(r.model) || S(r.model_name_kr) || S(r.name);
  const trim = normalizeTrim(stripSeats(S(r.trim_detail)));
  if (!welrixModel) continue;
  const maker = S(r.brand) || S(r.maker);
  const hit = resolveSubModel(index, maker, modelCore(welrixModel), NOW, NOW);
  const sub = hit.sub || '';
  if (!sub) {
    const k = `${maker}|${welrixModel}`;
    if (!unmapped.has(k)) unmapped.set(k, { n: 0, trims: new Set(), engines: new Set() });
    const u = unmapped.get(k)!;
    u.n++;
    if (trim) u.trims.add(trim);
    if (S(r.engine_label)) u.engines.add(S(r.engine_label));
    continue;
  }
  if (mapSamples.length < 60) mapSamples.push({ model: welrixModel, sub, how: hit.how });
  matched++;
  if (!trim) continue;
  const info = index.bySub.get(sub)!;
  const ok = info.trims.some((t) => foldTrim(t) === foldTrim(trim));
  if (ok) { same++; continue; }
  // 저장 표기는 이웃 어투 — Honors→아너스 등 fold 동일이면 이미 위에서 잡힘.
  // fold 후 없을 때만 결손. 우리 표기로: Honors는 아너스로 제안.
  let propose = trim;
  if (/^honors$/i.test(trim)) propose = '아너스';
  if (/^premium$/i.test(trim)) propose = '프리미엄';
  if (/^exclusive$/i.test(trim)) propose = '익스클루시브';
  if (/^calligraphy$/i.test(trim)) propose = '캘리그래피';
  if (info.trims.some((t) => foldTrim(t) === foldTrim(propose))) { same++; continue; }

  const key = `${sub}|${foldTrim(propose)}`;
  if (!gaps.has(key)) {
    gaps.set(key, {
      maker: info.maker || maker,
      welrixModel,
      sub,
      trim: propose,
      n: 0,
      engines: [],
      neighbors: info.trims.slice(0, 8),
      how: hit.how,
    });
  }
  const g = gaps.get(key)!;
  g.n++;
  const eng = S(r.engine_label);
  if (eng && g.engines.length < 6 && !g.engines.includes(eng)) g.engines.push(eng);
}

const list = [...gaps.values()].sort((a, b) => b.n - a.n || a.sub.localeCompare(b.sub, 'ko'));
const miss = [...unmapped.entries()].map(([k, v]) => {
  const [maker, model] = k.split('|');
  return { maker, model, n: v.n, trims: [...v.trims], engines: [...v.engines] };
}).sort((a, b) => b.n - a.n);

console.log('■ 웰릭스 신차 → 마스터 실결손\n');
console.log(`  견적 ${rows.length}행 · 세대매칭 ${matched} · 세대못찾음 ${miss.reduce((a, b) => a + b.n, 0)}행`);
console.log(`  트림일치 ${same} · **실결손 ${list.length}종** · 미매핑모델 ${miss.length}종\n`);

console.log('── 세대 매핑 표본');
const seen = new Set<string>();
for (const s of mapSamples) {
  const k = `${s.model}→${s.sub}`;
  if (seen.has(k)) continue;
  seen.add(k);
  if (seen.size > 25) break;
  console.log(`  ${s.model.padEnd(28)} → ${s.sub}  (${s.how})`);
}

console.log('\n── 트림 실결손');
for (const g of list) {
  console.log(`  [${g.n}] ${g.sub} 「${g.trim}」 ← ${g.welrixModel}`);
  console.log(`       eng: ${g.engines.join(' / ') || '-'}`);
  console.log(`       이웃: ${g.neighbors.join(' · ') || '(없음)'}`);
}

if (miss.length) {
  console.log('\n── 세대 미매핑');
  for (const m of miss) {
    console.log(`  [${m.n}] ${m.maker} ${m.model} · ${m.trims.join('/') || '(트림없음)'} · ${m.engines.join('/')}`);
  }
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/welrix-real-gaps.json', JSON.stringify({ list, miss, mapSamples: [...seen] }, null, 2), 'utf8');
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const csv = [
  ['구분', '제조사', '견적모델', '세대', '추가할트림', '견적행수', '파워트레인', '이웃', '매핑'].join(','),
  ...list.map((g) => ['트림결손', g.maker, g.welrixModel, g.sub, g.trim, String(g.n), g.engines.join(' / '), g.neighbors.join(' · '), g.how].map(esc).join(',')),
  ...miss.map((m) => ['세대미매핑', m.maker, m.model, '', m.trims.join(' · '), String(m.n), m.engines.join(' / '), '', ''].map(esc).join(',')),
].join('\r\n');
writeFileSync('tmp/welrix-gap.csv', `\uFEFF${csv}`, 'utf8');
console.log('\n→ tmp/welrix-real-gaps.json · tmp/welrix-gap.csv');
