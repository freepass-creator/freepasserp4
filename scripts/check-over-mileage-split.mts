/**
 * 초과 주행요금이 «국산·수입»으로 제대로 갈리는지 본다.
 * 한 칸으로 두면 수입차 계약에 국산 요율(200원)이 찍혀 손님이 절반만 낸다.
 */
import { chakhandealIssuePayload } from '@/lib/domain/chakhandeal-esign';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';

type Rec = Record<string, unknown>;

const { next: policy } = applyPolicyDefaults({
  policy_code: 'P', contract_authoring: '프리패스가 작성', annual_mileage: '연 30,000km',
});

const CASES: { maker: string; expect: string }[] = [
  { maker: '제네시스', expect: '200' },
  { maker: '현대', expect: '200' },
  { maker: '기아', expect: '200' },
  { maker: 'KGM', expect: '200' },
  { maker: '르노코리아', expect: '200' },
  { maker: '쉐보레', expect: '200' },
  { maker: 'BMW', expect: '400' },
  { maker: '벤츠', expect: '400' },
  { maker: '테슬라', expect: '400' },
  { maker: '아우디', expect: '400' },
];

let bad = 0;
console.log('제조사      초과 주행요금        판정');
console.log('─'.repeat(52));
for (const cse of CASES) {
  const contract = {
    contract_code: 'T', customer_name: '홍길동', maker_snapshot: cse.maker,
    rent_month_snapshot: 48, rent_amount_snapshot: 1000000, esign_inputs: {},
  } as unknown as Rec;
  const payload = chakhandealIssuePayload(
    { memberCompany: 'freepass', templateId: 'rent_buyout' }, contract, policy, '회사포함',
  ) as Rec;
  const groups = (payload.consentGroups || []) as { rows: { label: string; value: string }[] }[];
  const row = groups.flatMap((g) => g.rows).find((r) => r.label === '초과 주행요금');
  const value = row?.value || '(없음)';
  const ok = value.includes(cse.expect);
  if (!ok) bad += 1;
  console.log(`${cse.maker.padEnd(10)}${value.padEnd(20)}${ok ? `OK ${cse.expect === '200' ? '국산' : '수입'}` : '✗ 어긋남'}`);
}
console.log(bad ? `\n어긋남 ${bad}건` : '\n국산·수입이 제대로 갈린다');
process.exit(bad ? 1 : 0);
