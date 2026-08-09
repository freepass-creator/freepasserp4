/**
 * 정책관리에 넣은 값이 «계약서까지» 흘러가는지 끝까지 본다.
 *
 * 이 통로가 실제로 끊겨 있었다(2026-08-09) — 발행 시 정책을 안 넘겨서
 * 정책관리를 아무리 채워도 계약서가 빈칸으로 나갔다. 게이트는 정책을 읽는데
 * 정작 계약서로 가는 길이 없었다. 그래서 «게이트 통과»만으로는 안 되고
 * **값이 payload 에 실제로 실렸는지**를 봐야 한다.
 *
 *   npx tsx scripts/check-policy-to-contract.mts
 */
import { chakhandealIssuePayload } from '@/lib/domain/chakhandeal-esign';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import { canIssueContract } from '@/lib/domain/policy-tier';

type Rec = Record<string, unknown>;

/** 표준값을 다 채운 정책 — 정책관리에서 「프리패스 표준값 채우기」를 누른 상태. */
const { next: policy } = applyPolicyDefaults({
  policy_code: 'POL-TEST',
  contract_authoring: '프리패스가 작성',
  annual_mileage: '연 30,000km',
  basic_driver_age: '만 26세 이상',
  personal_driver_scope: '계약자와 배우자 및 직계가족',
  insurance_included: '포함(회사 가입)',
  injury_compensation_limit: '무한',
  property_compensation_limit: '3억원',
});

const contract = {
  contract_code: 'TMP-260809-01',
  customer_name: '홍길동',
  customer_phone: '01055551212',
  policy_code: 'POL-TEST',
  car_number_snapshot: '12가1234',
  maker_snapshot: '제네시스',          // 국산 → 200원
  model_snapshot: 'G80',
  vehicle_name_snapshot: '제네시스 G80 2.5 터보',
  rent_month_snapshot: 48,
  rent_amount_snapshot: 1000000,
  deposit_amount_snapshot: 1000000,
  esign_inputs: {},
} as unknown as Rec;

const gate = canIssueContract(policy);
console.log(`발행 게이트: ${gate.ok ? '통과' : `막힘 — ${gate.reason}`}\n`);

/* 실제 발행 payload 를 만들어 «값이 실렸는지» 본다. */
const payload = chakhandealIssuePayload(
  { memberCompany: 'freepass', templateId: 'rent_buyout' },
  contract,
  policy,
  '회사포함',
) as Rec;

const groups = (payload.consentGroups || []) as { key: string; title: string; rows: { label: string; value: string; article?: string }[] }[];

/** 정책에서 와야 하는 값 — 비어 있으면 통로가 끊긴 것이다. */
const MUST: { label: string; expect: RegExp }[] = [
  { label: '약정 주행거리', expect: /30,000|30000/ },
  { label: '초과 주행요금', expect: /1km당 200원/ },     // 제네시스=국산 → 200원
  { label: '운전자 연령', expect: /26세/ },
  { label: '1년 이내 사고 누적', expect: /3회/ },
  { label: '대인 보상한도', expect: /무한/ },
  { label: '자차 최소 면책금', expect: /500,?000|50만/ },
];

const rows = groups.flatMap((g) => g.rows.map((r) => ({ ...r, group: g.key })));
let bad = 0;
console.log('정책 → 계약서 전달 확인');
console.log('─'.repeat(66));
for (const m of MUST) {
  const row = rows.find((r) => r.label === m.label);
  if (!row) { console.error(`  [없음] ${m.label} — 계약서에 줄이 만들어지지 않았다`); bad += 1; continue; }
  const ok = m.expect.test(row.value);
  if (!ok) bad += 1;
  console.log(`  ${ok ? 'OK ' : '✗  '}${m.label.padEnd(18)}${row.value}${row.article ? `  (${row.article})` : ''}`);
}

console.log(`\n총 ${rows.length}줄 · 조항 배지 ${rows.filter((r) => r.article).length}개`);
console.log(bad ? `\n끊긴 값 ${bad}개 — 정책이 계약서에 안 실린다` : '\n정책값이 계약서까지 흘러간다');
process.exit(bad ? 1 : 0);
