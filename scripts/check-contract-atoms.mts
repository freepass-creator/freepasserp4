/**
 * 손님 계약 화면(consentGroups)에 실린 항목이 «계약서 원자»인지 대조한다.
 * 계약서 원자 목록에 없는 항목 = 계약서에 없는 것 = 상품 안내·정책이 샌 것.
 *
 *   npx tsx scripts/check-contract-atoms.mts
 */
import { readFileSync } from 'node:fs';
import { FIELD_MAP } from '@/lib/domain/esign-field-map';

const PAYLOAD = 'C:/dev/chakhandeal/lib/testForms/freepass-issue-payload.json';
// Windows/Excel 계열 도구가 UTF-8 BOM을 붙여도 계약 원자 감사를 계속할 수 있어야 한다.
const payload = JSON.parse(readFileSync(PAYLOAD, 'utf8').replace(/^\uFEFF/, ''));

const norm = (s: string) => String(s || '').replace(/\s|\(.*?\)/g, '');
const atomLabels = new Set(FIELD_MAP.map((f) => norm(f.label)));

console.log(`계약서 원자 ${FIELD_MAP.length}개 기준 대조\n`);

let hit = 0;
const miss: { group: string; label: string; value: string }[] = [];

for (const g of payload.consentPages || []) {
  for (const r of g.rows || []) {
    if (atomLabels.has(norm(r.label))) hit += 1;
    else miss.push({ group: g.title, label: r.label, value: String(r.value).slice(0, 46) });
  }
}

console.log(`계약서 원자에 있는 항목  ${hit}개`);
console.log(`계약서 원자에 없는 항목  ${miss.length}개\n`);
console.log('===== 계약서에 없는데 손님 화면에 실린 것 =====');
for (const m of miss) console.log(`  [${m.group}] ${m.label}  |  ${m.value}`);

// 출처가 «정책»인 원자 — 계약 시점에 확정돼야 하는 것들
console.log('\n===== 출처가 «정책»인 계약서 원자 (계약 시 확정되어야 함) =====');
for (const f of FIELD_MAP.filter((x) => x.from === '정책')) {
  console.log(`  ${f.label.padEnd(16)} ← ${f.atom}`);
}
