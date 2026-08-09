/**
 * 정책 칸에 설명(`note`)이 다 붙었는지 본다.
 *
 * 정책은 «한 번 정해 두고 계속 쓰는» 값이라 그 화면에 자주 오지 않는다.
 * 설명이 없으면 다음에 왔을 때 「이게 뭐였더라」가 되고, 그러면 아예 안 채운다.
 * 안 채운 칸은 계약서에서 빈칸이 되고, 약관 조문이 공중에 뜬다.
 *
 *   npx tsx scripts/check-policy-notes.mts
 */
import { ENTITIES } from '@/lib/intake/entities';

/** 이름만으로 뜻이 분명해 설명이 없어도 되는 칸. */
const SELF_EVIDENT = new Set([
  'policy_code', 'policy_name', 'provider_company_code', 'policy_type',
  'credit_grade', 'basic_driver_age', 'driver_age_lowering', 'driver_age_upper_limit',
  'annual_mileage', 'payment_method', 'rental_region', 'delivery_fee',
  'deposit_card_payment', 'insurance_included', 'personal_driver_scope', 'business_driver_scope',
  'additional_driver_allowance_count', 'maintenance_service', 'age_lowering_cost', 'additional_driver_cost',
  'insurer_name', 'insurer_phone', 'is_active',
]);

const fields = ENTITIES.policy.fields;
const missing = fields.filter((f) => !f.note && !SELF_EVIDENT.has(f.key));

console.log(`정책 칸 ${fields.length}개 · 설명 있음 ${fields.filter((f) => f.note).length}개`);
if (missing.length) {
  console.log(`\n설명이 없는 칸 ${missing.length}개 — 다음에 와서 「이게 뭐였더라」가 된다`);
  for (const f of missing) console.log(`   ${f.key.padEnd(34)}${f.label}`);
} else {
  console.log('\n설명이 필요한 칸에 전부 붙어 있음');
}
process.exit(missing.length ? 1 : 0);
