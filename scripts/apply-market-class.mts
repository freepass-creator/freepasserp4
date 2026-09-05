/**
 * 차종마스터 신차/중고 구분값(사장님 2026-09-05 「최신세대=신차, 풀체인지되면 중고로」).
 *   year_end 가 4자리 연도 = 생산종료 → 중고마스터. 아니면(「현재」 등) 현행생산 → 신차마스터.
 *   신차 견적기는 market_class='신차'를 끌어다 쓰고, 그 중 new_car_trim 있는 것은 크롤 실가 사용.
 * 기본 드라이런. --apply 로 public/data/vehicle-master.json 갱신.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const APPLY = process.argv.includes('--apply');
const path = 'public/data/vehicle-master.json';
const raw = JSON.parse(readFileSync(path, 'utf8'));
const entries: any[] = Array.isArray(raw) ? raw : raw.entries;
const isYear = (v: unknown) => /^\d{4}$/.test(String(v ?? '').trim());
let sinche = 0, junggo = 0;
for (const e of entries) {
  const cls = isYear(e.year_end) ? '중고' : '신차';
  e.market_class = cls;
  cls === '신차' ? sinche++ : junggo++;
}
console.log(`차종마스터 ${entries.length} · 신차 ${sinche} · 중고 ${junggo}`);
// 검산: 싼타페 세대별 구분
console.log('\n싼타페 검산:');
for (const e of entries.filter((x) => /싼타페/.test(String(x.sub_model)) && x.gen_code)) {
  console.log(`  ${String(e.sub_model).padEnd(18)} ${e.year_start}~${e.year_end}  → ${e.market_class}`);
}
if (APPLY) { writeFileSync(path, JSON.stringify(raw, null, 2)); console.log('\n✓ vehicle-master.json 갱신'); }
else console.log('\n(드라이런 — --apply 로 씀)');
