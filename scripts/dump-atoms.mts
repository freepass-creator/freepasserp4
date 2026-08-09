/**
 * 계약서가 요구하는 원자 전수 목록을 출처별로 찍는다.
 *   npx tsx scripts/dump-atoms.mts
 */
import { FIELD_MAP } from '@/lib/domain/esign-field-map';

const ORDER = ['계약', '재고', '정책', '파트너', '입력', '본인확인', '파생', '고정', '표기', '미정'];

const byFrom = new Map<string, typeof FIELD_MAP>();
for (const f of FIELD_MAP) {
  if (!byFrom.has(f.from)) byFrom.set(f.from, []);
  byFrom.get(f.from)!.push(f);
}

console.log(`총 원자 ${FIELD_MAP.length}개\n`);
console.log('출처별 개수');
for (const k of ORDER) {
  const n = byFrom.get(k)?.length || 0;
  if (n) console.log(`  ${k.padEnd(6)} ${String(n).padStart(3)}개`);
}
console.log('');

for (const k of ORDER) {
  const list = byFrom.get(k);
  if (!list?.length) continue;
  console.log(`===== ${k} (${list.length}) =====`);
  for (const f of list) {
    const bits = [
      f.field.padEnd(30),
      f.label.padEnd(18),
      f.atom ? `atom=${f.atom}` : '',
      f.conditional ? `[${f.conditional}]` : '',
      f.onlyMaturity ? `<${f.onlyMaturity}>` : '',
      f.note ? `— ${f.note}` : '',
    ].filter(Boolean);
    console.log('  ' + bits.join(' '));
  }
  console.log('');
}
