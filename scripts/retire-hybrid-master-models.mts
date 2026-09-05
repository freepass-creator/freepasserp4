/**
 * 차종마스터 «하이브리드» 세부모델 정리 — 사장님 2026-09-05.
 *   「연료(가솔린·디젤·하이브리드)는 fuel_type 으로 구분. 세부모델엔 안 넣는다.
 *    전기전용 모델명(EV6·아이오닉5/6/9 등)은 예외 — 그게 정체다.」
 *
 * ★삭제가 아니라 «비활성»(retired:true) — 되돌릴 수 있게. 원자는 0대가 쓰므로 재매핑 없음.
 * ★고유 트림 보존이 핵심(사장님 지적) — 비우기 «전에» 하이브리드 고유 트림을 base 로 병합.
 *   base 가 없으면(쏘나타·아이오닉…) «개명»(하이브리드 뗌)해서 그 항목을 base 로 삼는다(트림째).
 * 기본 드라이런 · --apply 로 public/data/vehicle-master.json 저장.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s()]/g, '');
const HYB = /\s*(플러그인\s*)?(하이브리드|hev|phev)\s*/i;
const baseName = (sm: string) => sm.replace(HYB, ' ').replace(/\s+/g, ' ').trim();

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as any;
const arr = (Array.isArray(raw) ? raw : raw.entries || []) as any[];
const trimsOf = (e: any): string[] => (Array.isArray(e?.trims) ? e.trims : []);

const hybEntries = arr.filter((e) => HYB.test(S(e.sub_model)) && !/일렉트릭|전기|\bev\b|ev\d|아이오닉\s*[569]/i.test(S(e.sub_model)));
console.log(`하이브리드 세부모델 항목 ${hybEntries.length}개 처리\n`);

let merged = 0, renamed = 0, retired = 0;
for (const h of hybEntries) {
  const base = baseName(S(h.sub_model));
  // 같은 제조사·모델·base 세부모델의 base 항목(하이브리드 아닌 것)
  const baseEntries = arr.filter((e) => e !== h && N(e.maker) === N(h.maker) && N(e.model) === N(h.model) && N(e.sub_model) === N(base) && !HYB.test(S(e.sub_model)));
  const hTrims = trimsOf(h);
  if (baseEntries.length) {
    // 고유 트림을 첫 base 항목에 병합(합집합)
    const target = baseEntries[0];
    const have = new Set(trimsOf(target).map(N));
    const add = hTrims.filter((t) => !have.has(N(t)));
    if (add.length) { target.trims = [...trimsOf(target), ...add]; merged += add.length; }
    h.retired = true; h._retiredReason = `연료축 분리(hybrid→fuel_type) · 트림 ${add.length}개 «${base}»로 병합`;
    retired++;
    console.log(`  «${S(h.sub_model)}» → base «${base}» 존재 · 트림 ${add.length}개 병합 → retired`);
  } else {
    // base 없음 → 개명(하이브리드 뗌). 트림째 base 로 승격.
    console.log(`  «${S(h.sub_model)}» → base 없음 · «${base}»로 개명(트림 ${hTrims.length}개 유지)`);
    h.sub_model = base;
    if (S(h.title)) h.title = S(h.title).replace(HYB, ' ').replace(/\s+/g, ' ').trim();
    renamed++;
  }
}
console.log(`\n요약: retired ${retired} · 개명 ${renamed} · 트림 병합 ${merged}개. (삭제 0 · 원자 변경 0)`);

if (!APPLY) { console.log('\n[드라이런] --apply 로 json 저장.'); process.exit(0); }
writeFileSync('public/data/vehicle-master.json', JSON.stringify(raw, null, 1));
console.log('✓ public/data/vehicle-master.json 저장 (RTDB 재발행은 publish-master-to-rtdb 별도)');
process.exit(0);
