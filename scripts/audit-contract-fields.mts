/**
 * 계약서 «칸» 전수 감사 — 종이 계약서를 전자계약으로 대체할 때 빠지는 칸이 없어야 한다.
 *
 * 두 템플릿(rental · individual)의 data-field 합집합을 기준으로,
 * ① FIELD_MAP 에 아예 없는 칸  ② 있어도 수집 경로가 «미정»인 칸  을 뽑는다.
 *
 *   npx tsx scripts/audit-contract-fields.mts
 */
import { readFileSync } from 'node:fs';
import { FIELD_MAP } from '@/lib/domain/esign-field-map';

const DIR = 'C:/dev/freepasserp4/public/contract-template';
const FILES = ['rental-contract.html', 'contract-individual.html'];

/** JS 템플릿 문자열에서 새어나온 가짜 필드 제외. */
const JUNK = /^'|\+/;

const perFile = new Map<string, Set<string>>();
for (const f of FILES) {
  const html = readFileSync(`${DIR}/${f}`, 'utf8');
  const set = new Set<string>();
  for (const m of html.matchAll(/data-field="([^"]+)"/g)) {
    const name = m[1];
    if (!JUNK.test(name)) set.add(name);
  }
  perFile.set(f, set);
}

const union = new Set<string>();
for (const s of perFile.values()) for (const k of s) union.add(k);

const mapped = new Map(FIELD_MAP.map((f) => [f.field, f]));

console.log('계약서 칸 (data-field)');
for (const [f, s] of perFile) console.log(`  ${f.padEnd(26)} ${s.size}개`);
console.log(`  ${'합집합'.padEnd(24)} ${union.size}개`);
console.log(`  ${'FIELD_MAP 등록'.padEnd(22)} ${FIELD_MAP.length}개\n`);

const unmapped = [...union].filter((k) => !mapped.has(k)).sort();
const undecided = [...union].filter((k) => mapped.get(k)?.from === '미정').sort();

console.log(`===== ① FIELD_MAP 에 아예 없는 칸 — ${unmapped.length}개 =====`);
for (const k of unmapped) {
  const only = FILES.filter((f) => perFile.get(f)!.has(k));
  console.log(`  ${k.padEnd(30)} (${only.map((f) => f.split('-')[0]).join(',')})`);
}

console.log(`\n===== ② 등록됐지만 수집 경로가 «미정» — ${undecided.length}개 =====`);
for (const k of undecided) {
  const f = mapped.get(k)!;
  console.log(`  ${k.padEnd(30)} ${f.label}${f.conditional ? ` [${f.conditional}]` : ''}`);
}

console.log(`\n===== 종합 =====`);
console.log(`  계약서 칸 합집합            ${union.size}`);
console.log(`  → 채울 경로가 있는 칸        ${union.size - unmapped.length - undecided.length}`);
console.log(`  → **못 채우는 칸**           ${unmapped.length + undecided.length}  (①${unmapped.length} + ②${undecided.length})`);

// FIELD_MAP 에는 있는데 두 템플릿 어디에도 없는 칸(참고)
const orphan = FIELD_MAP.filter((f) => !union.has(f.field)).map((f) => f.field);
if (orphan.length) console.log(`\n(참고) FIELD_MAP 에만 있고 템플릿에 없는 칸 ${orphan.length}개: ${orphan.join(', ')}`);
