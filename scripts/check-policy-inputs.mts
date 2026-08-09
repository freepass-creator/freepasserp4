/**
 * 정책 칸 중 «직접 입력(text)»이 얼마나 남았는지 본다.
 *
 * 정책은 한 번 정해 두고 계속 쓰는 값이라, 자유 입력이면 사람마다 다르게 적는다.
 * 「연 12%」·「12%」·「0.12」가 섞이면 계약서에도 그대로 섞여 나간다.
 * **고를 수 있는 것은 다 고르게 한다.** 회사명·전화번호처럼 열거가 불가능한 것만 남긴다.
 *
 *   npx tsx scripts/check-policy-inputs.mts
 */
import { ENTITIES } from '@/lib/intake/entities';

/** 열거할 수 없어 자유 입력이 맞는 칸. */
const FREE_TEXT_OK = new Set([
  'policy_code', 'policy_name', 'provider_company_code',   // 식별자
  'insurer_name', 'insurer_phone',                          // 회사명·번호
]);

const fields = ENTITIES.policy.fields;
const byType: Record<string, number> = {};
for (const f of fields) byType[f.type] = (byType[f.type] || 0) + 1;

console.log(`정책 칸 ${fields.length}개`);
console.log(`  ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);

const free = fields.filter((f) => f.type === 'text' && !FREE_TEXT_OK.has(f.key));
if (!free.length) {
  console.log('직접 입력은 열거 불가능한 칸에만 남아 있음');
  process.exit(0);
}
console.log(`드롭다운으로 바꿀 수 있는 직접 입력 ${free.length}개`);
for (const f of free) console.log(`   ${f.key.padEnd(34)}${f.label}`);
process.exit(1);
