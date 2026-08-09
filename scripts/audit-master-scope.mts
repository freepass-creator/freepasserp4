/**
 * 차종마스터 범위 점검 — **최근 10년에 걸치는 세대**로 구성돼 있는가.
 *
 * 사장님 기준(2026-08-09): 「기본적으로 10년 이내지만 걸치는 차들로 구성해야 함」.
 * 즉 단종연도가 기준연도 안에 들어오면 그 세대는 살린다(생산은 끝났어도 아직 굴러다닌다).
 *
 *   npx tsx scripts/audit-master-scope.mts            (기준 2026 · 10년)
 *   YEARS=10 NOW=2026 npx tsx scripts/audit-master-scope.mts
 */
import { readFileSync } from 'node:fs';
import { realMasterTrims } from '../lib/domain/vehicle-master-options';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const NOW = Number(process.env.NOW) || 2026;
const YEARS = Number(process.env.YEARS) || 10;
const FLOOR = NOW - YEARS;   // 2016

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: Rec[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

type Sub = { sub: string; maker: string; start: number; end: number; trims: number };
const bySub = new Map<string, Sub>();
for (const e of entries) {
  const sub = S(e.sub_model);
  if (!sub) continue;
  const start = Number(e.year_start) || 0;
  const end = /^\d{4}$/.test(S(e.year_end)) ? Number(e.year_end) : NOW;   // 빈 값 = 현행
  const set = new Set<string>();
  for (const t of realMasterTrims((e.trims || []) as never)) if (S(t)) set.add(S(t));
  for (const v of (e.variants || []) as Rec[]) {
    for (const t of realMasterTrims((v.trims || []) as never)) if (S(t)) set.add(S(t));
  }
  const prev = bySub.get(sub);
  bySub.set(sub, {
    sub, maker: S(e.maker),
    start: prev ? Math.min(prev.start || start, start || prev.start) : start,
    end: prev ? Math.max(prev.end, end) : end,
    trims: (prev?.trims || 0) + set.size,
  });
}

const all = [...bySub.values()];
// 「걸친다」 = 생산 구간이 [FLOOR, NOW] 과 겹친다. 단종이 FLOOR 이후면 아직 도로에 있다.
const inScope = all.filter((s) => s.end >= FLOOR);
const outScope = all.filter((s) => s.end < FLOOR && s.end > 0);
const noYear = all.filter((s) => !s.end);

console.log(`■ 차종마스터 범위 — 기준 ${FLOOR}~${NOW} (최근 ${YEARS}년에 걸치는 세대)\n`);
console.log(`  마스터 세대 총                ${String(all.length).padStart(5)}`);
console.log(`  ★범위 안(단종 ${FLOOR} 이후)     ${String(inScope.length).padStart(5)}   트림 ${inScope.reduce((a, s) => a + s.trims, 0)}개`);
console.log(`   범위 밖(${FLOOR} 전 단종)      ${String(outScope.length).padStart(5)}   트림 ${outScope.reduce((a, s) => a + s.trims, 0)}개  ← 굴릴 일 없는 옛 차`);
console.log(`   연식 정보 없음               ${String(noYear.length).padStart(5)}`);

const noTrim = inScope.filter((s) => !s.trims);
console.log(`\n  범위 안인데 **트림 목록이 비어 있는** 세대   ${noTrim.length}종`);
for (const s of noTrim.slice(0, 15)) console.log(`     ${s.maker.padEnd(8)} ${s.sub.slice(0, 28).padEnd(30)} ${s.start || '?'}~${s.end}`);
if (noTrim.length > 15) console.log(`     … 그 외 ${noTrim.length - 15}종`);

console.log(`\n── 범위 밖 표본(정리 후보)`);
for (const s of outScope.sort((a, b) => a.end - b.end).slice(0, 10)) {
  console.log(`     ${s.maker.padEnd(8)} ${s.sub.slice(0, 28).padEnd(30)} ~${s.end}  트림 ${s.trims}`);
}
console.log(`\n(정리는 제안만 한다 — 마스터에서 지우면 옛 계약·정산의 이름이 깨진다)`);
