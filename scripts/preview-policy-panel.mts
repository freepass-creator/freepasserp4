/** 정책관리 「전자계약」 패널에 실제로 그려질 입력 칸을 확인한다. */
import { ENTITIES } from '@/lib/intake/entities';
import { CONTRACT_LAYER } from '@/lib/domain/policy-tier';

/** 화면(`app/policy/page.tsx`)과 «같은 곳»에서 뽑는다 — 목록을 두 벌로 두면 어긋난다. */
const G_ESIGN = ['contract_authoring', ...CONTRACT_LAYER.map((f) => f.key)];

const fields = ENTITIES.policy.fields.filter((f) => G_ESIGN.includes(f.key));
console.log(`전자계약 패널 입력 칸 ${fields.length} / ${G_ESIGN.length}\n`);
for (const f of fields) {
  console.log(`   ${f.label.padEnd(26)}(${f.type.padEnd(6)}) ${f.note || ''}`);
}

const noted = ENTITIES.policy.fields.filter((f) => f.note).map((f) => f.note!.length);
console.log(`\n설명 ${noted.length}개 · 평균 ${Math.round(noted.reduce((a, b) => a + b, 0) / noted.length)}자 · 최장 ${Math.max(...noted)}자`);
const long = ENTITIES.policy.fields.filter((f) => (f.note?.length || 0) > 30);
if (long.length) {
  console.log(`30자 넘는 설명 ${long.length}개 — 폼 밑 한 줄이므로 더 줄일 것`);
  for (const f of long) console.log(`   ${f.label} — ${f.note}`);
}
const missing = G_ESIGN.filter((k) => !fields.some((f) => f.key === k));
if (missing.length) console.log(`\n없는 키: ${missing.join(', ')}`);
console.log(`\n정책 엔티티 전체 ${ENTITIES.policy.fields.length}개`);
