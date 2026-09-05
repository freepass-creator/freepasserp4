/**
 * 신차 트림(제조사 추출) ↔ 차종마스터 매칭기 — 사장님 2026-09-05 「맞는지」 검증.
 *   제조사는 「더 뉴 그랜저」(개발코드 없음), 우리 차종마스터는 「더 뉴 그랜저 GN7」(GN7=우리 규칙).
 *   ⇒ maker+model+연료로 좁히고, sub_model 에서 «개발코드(gen_code)를 뗀 것»이 제조사 modelDisplay 와 맞는지,
 *      그 세부모델의 trims 에 신차 trim 이 있는지 본다. 매칭율·안 맞는 것을 리포트(읽기전용).
 */
import { readFileSync } from 'node:fs';
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s()·]/g, '');

const seed = JSON.parse(readFileSync('data/new-car/hyundai.json', 'utf8')) as { trims: any[] };
const m = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as any;
const master = (Array.isArray(m) ? m : m.entries || []) as any[];

// 세부모델에서 개발코드(gen_code) 꼬리를 뗀 «표시명»
const baseSub = (e: any) => {
  const sm = S(e.sub_model); const gc = S(e.gen_code);
  return gc && sm.endsWith(gc) ? sm.slice(0, sm.length - gc.length).trim() : sm;
};

// ★크롤러가 주는 필드는 carType(제조사 원문명). 여기서 연료를 떼 «표시명」으로 쓴다(Codex #8: modelDisplay 는 안 만들어짐).
const stripFuel = (s: unknown) => S(s).replace(/\s*(플러그인\s*)?(하이브리드|hybrid|electric|일렉트릭|전기|ev|hev|phev)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
let matched = 0, trimMiss = 0, modelMiss = 0;
const misses: string[] = [];
for (const t of seed.trims) {
  const disp = stripFuel(t.carType);
  // 후보 = 같은 제조사(마스터 model 이 carType 과 다를 수 있어 maker 만으로 좁히고 세부모델 base 로 맞춘다)
  const cands = master.filter((e) => !e.retired && N(e.maker) === N(t.maker));
  // ★세대 순서 의존 제거(Codex #7): gen_code 로 «정렬»해 배열 순서와 무관하게 결정적으로 고른다.
  const baseHits = cands.filter((e) => N(baseSub(e)) === N(disp)).sort((a, b) => S(a.gen_code).localeCompare(S(b.gen_code)));
  if (!baseHits.length) { modelMiss++; if (misses.length < 30) misses.push(`✗모델 «${disp} ${t.trim}» — 차종마스터에 base일치 세부모델 없음`); continue; }
  const withTrim = baseHits.filter((e) => (e.trims || []).map(N).includes(N(t.trim)));
  const hit = withTrim[0] || baseHits[0];
  if (withTrim.length) { matched++; if (withTrim.length > 1 && misses.length < 30) misses.push(`⚠세대중복 «${disp} ${t.trim}» → ${withTrim.map((e: any) => S(e.gen_code) || S(e.sub_model)).join('/')} 모두 보유(신차=최신세대 확정 필요)`); }
  else { trimMiss++; if (misses.length < 30) misses.push(`△트림 «${disp} ${t.trim}» → 세부모델 «${S(hit.sub_model)}»(후보 ${baseHits.length}세대) 트림풀에 없음`); }
}
const total = seed.trims.length;
console.log(`신차 트림 ${total} · ✅완전매칭 ${matched} · △트림누락 ${trimMiss} · ✗모델미스 ${modelMiss} → 매칭율 ${(matched / total * 100).toFixed(0)}%`);
console.log('\n안 맞는 것:');
misses.forEach((x) => console.log('  ' + x));
process.exit(0);
