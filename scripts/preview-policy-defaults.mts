/**
 * 계약서에서 뽑은 정책 기본값을 눈으로 확인한다.
 * 값을 넣기 전에 «어디서 나온 숫자인지»를 사람이 보고 승인해야 한다.
 *
 *   npx tsx scripts/preview-policy-defaults.mts
 */
import { POLICY_DEFAULTS, applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import { canIssueContract } from '@/lib/domain/policy-tier';

const decided = POLICY_DEFAULTS.filter((d) => d.value !== null);
const pending = POLICY_DEFAULTS.filter((d) => d.value === null);

console.log(`계약서에서 뽑은 기본값 ${decided.length}개\n${'='.repeat(78)}`);
for (const d of decided) {
  console.log(`\n${d.label}  =  ${d.value}`);
  console.log(`   ← ${d.source}`);
}

console.log(`\n${'='.repeat(78)}`);
console.log(`계약서에 숫자가 없어 «정해야 하는» 것 ${pending.length}개\n`);
for (const d of pending) {
  console.log(`  ${d.label}`);
  console.log(`     ${d.source}\n`);
}

/* 기본값만 넣으면 전자계약을 보낼 수 있는가 */
const base = { contract_authoring: '프리패스가 작성' } as Record<string, unknown>;
const { next, filled, pending: stillEmpty } = applyPolicyDefaults(base);
const gate = canIssueContract(next);

console.log('='.repeat(78));
console.log(`기본값 ${filled.length}개를 넣으면 → 전자계약 ${gate.ok ? '발송 가능' : '발송 불가'}`);
if (!gate.ok) {
  console.log(`   남는 것 ${gate.missing.length}개: ${gate.missing.map((m) => m.label).join(' · ')}`);
}
console.log(`   (그중 «정해야 하는» 것 ${stillEmpty.length}개)`);
