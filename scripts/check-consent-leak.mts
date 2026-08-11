/**
 * 손님 화면(`buildConsentGroups`)에 «있으면 안 되는 것»이 남았는지 본다.
 *   - 내부 심사 기준 (우리가 이 사람을 어떻게 평가했는지)
 *   - 「~ 가능」 같은 영업 단계 표현 (계약은 이미 확정됐다)
 *   - 값과 다른 라벨
 *
 *   npx tsx scripts/check-consent-leak.mts
 */
import { buildConsentGroups } from '@/lib/domain/esign-consent-doc';

type Rec = Record<string, unknown>;

const contract = {
  rent_month_snapshot: 48,
  rent_amount_snapshot: 1000000,
  deposit_amount_snapshot: 1000000,
  customer_name: '홍길동',
  esign_inputs: {},
} as unknown as Parameters<typeof buildConsentGroups>[0];

const policy: Rec = {
  annual_mileage: '연 30,000km',
  mileage_upcharge_per_10000km: '1만km당 100,000원',
  // 국산·수입이 갈린다. 한 칸짜리 옛 키(over_mileage_rate_per_km)를 쓰면
  // 계약서에 값이 안 실려 「약관이 참조하는 값이 없다」로 잡힌다.
  over_mileage_rate_domestic: 200,
  over_mileage_rate_imported: 400,
  accident_termination_count: 3,
  rental_region: '전국',
  screening_criteria: '중신용 이상',
  deposit_installment: '3회 분납 가능',
  basic_driver_age: '만 26세 이상',
  driver_age_lowering: '만 21세까지 하향 가능',
  age_lowering_cost: '월 55,000원',
  additional_driver_cost: '월 50,000원',
  personal_driver_scope: '계약자와 배우자 및 직계가족',
};

const groups = buildConsentGroups(contract, policy, '회사포함');

const RULES: { re: RegExp; why: string }[] = [
  { re: /심사\s*기준|중신용|저신용|고신용/, why: '내부 심사 기준 — 본인에게 보여주면 안 된다' },
  { re: /대여\s*지역/, why: '상품 안내지 이 계약의 조건이 아니다' },
  { re: /가능/, why: '「~ 가능」은 영업 단계의 말 — 계약은 확정값만' },
];

/*
 * 「초과 주행요금」은 있어야 한다 — 약관 제16조가 「계약서에 정한 1km당 초과주행 요금」을
 * 그대로 참조하므로, 이 값이 비면 그 조문이 공중에 뜬다.
 * 다만 «1km당»이 아니면 상향 가격표(1만km당)가 잘못 들어온 것이다.
 */
const MUST: { label: string; re: RegExp; why: string }[] = [
  { label: '초과주행 요금', re: /1km당/, why: '단위가 «1km당»이 아니다 — 상향 가격표(1만km당)가 잘못 들어왔을 수 있다' },
];

let bad = 0;
for (const g of groups) {
  for (const r of g.rows) {
    const text = `${r.label} ${r.value}`;
    for (const rule of RULES) {
      if (rule.re.test(text)) {
        console.error(`  [남음] ${g.key} · ${text}\n         → ${rule.why}`);
        bad += 1;
      }
    }
  }
}

for (const m of MUST) {
  const row = groups.flatMap((g) => g.rows).find((r) => r.label === m.label);
  if (!row) {
    console.error(`  [없음] ${m.label} — 약관이 참조하는 값이 계약서에 없다`);
    bad += 1;
  } else if (!m.re.test(row.value)) {
    console.error(`  [의심] ${m.label} = ${row.value}\n         → ${m.why}`);
    bad += 1;
  }
}

for (const g of groups) {
  if (!['rental', 'driver', 'accident'].includes(g.key)) continue;
  console.log(`\n[${g.title}]`);
  for (const r of g.rows) {
    console.log(`   ${r.label.padEnd(16)}${r.value}${r.article ? `  (${r.article})` : ''}`);
  }
}

console.log(bad ? `\n누출 ${bad}건 — 고쳐야 한다` : '\n누출 0건');
process.exit(bad ? 1 : 0);
