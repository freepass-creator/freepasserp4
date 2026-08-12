/**
 * 계약서 줄에 달린 «조항 배지»가 실제 약관 조문을 가리키는지 본다.
 *
 * 배지는 손님을 그 조문으로 보내는 이정표다. 감으로 달면 엉뚱한 데로 보내
 * 「약관에 있다더니 없더라」가 된다 — 없느니만 못하다.
 *
 *   ① 그 조가 약관에 실제로 있는가
 *   ② 그 조문에 그 줄과 관련된 낱말이 있는가
 *
 *   npx tsx scripts/check-article-badges.mts
 */
import { buildConsentGroups } from '@/lib/domain/esign-consent-doc';
import { AGREEMENT_SECTIONS } from '@/lib/domain/esign-agreement-text';

type Rec = Record<string, unknown>;

const byNo = new Map<string, string>();
for (const s of AGREEMENT_SECTIONS) {
  const no = s.t.match(/제\d+조(?:의\d+)?/)?.[0];
  if (no) byNo.set(no, `${s.t} ${s.b}`);
}

/** 줄 라벨 → 그 조문에 있어야 할 낱말. 배지가 맞는지 이걸로 확인한다. */
const EXPECT: Record<string, RegExp> = {
  대여기간: /계약기간/,
  '월 대여료': /대여료/,
  보증금: /보증금/,
  '대여료 결제주기': /지급|납부/,
  자동이체일: /자동이체|출금/,
  '연체 시': /연체|시동제어|운행제한/,
  '중도해지 위약금': /중도해지/,
  지연손해금: /지연손해금/,
  '보증금 반환': /반환/,
  '면책금(고객부담금)': /면책금|자기부담금/,
  '면허 1년 이하': /면책금|운전자격/,
  '사고 접수': /경찰|신고/,
  '현장 이탈': /현장|미조치/,
  '중과실 자차사고': /중과실|중대한 과실|12대/,
  '사고 다발 시 계약해지 기준': /직전 1년.*과실비율 50% 이상.*3회/,
  '자차 처리 규정': /폐차|멸실|전손/,
  차량번호: /인도|인수/,
  정비상품: /정비/,
  엔진오일: /정비|소모품|관리/,
  대차서비스: /정비|대차/,
  '계약 연장·해지': /연장/,
  검사대행: /정비|검사|관리/,
  서비스품목: /정비/,
  '약정 주행거리': /약정\s*주행거리/,
  '초과주행 요금': /초과주행요금/,
  '운전자 연령': /운전자격|연령/,
  '운전자 범위(개인)': /운전자 범위/,
  '운전자 범위(사업자)': /운전자 범위/,
};

const contract = {
  rent_month_snapshot: 48, rent_amount_snapshot: 1000000, deposit_amount_snapshot: 1000000,
  car_number_snapshot: '12가1234', customer_name: '홍길동', esign_inputs: {},
} as unknown as Parameters<typeof buildConsentGroups>[0];

const policy: Rec = {
  annual_mileage: '연 30,000km', over_mileage_rate_per_km: 200, accident_termination_count: 3,
  basic_driver_age: '만 26세 이상', personal_driver_scope: '계약자와 배우자 및 직계가족',
  business_driver_scope: '법인 임직원', maintenance_service: '기본형',
};

const groups = buildConsentGroups(contract, policy, '회사포함');
const rows = groups.flatMap((g) => g.rows);

let bad = 0;
let checked = 0;
for (const r of rows) {
  if (!r.article) continue;
  checked += 1;
  const body = byNo.get(r.article);
  if (!body) {
    console.error(`  [없는 조] ${r.label} → ${r.article}`);
    bad += 1;
    continue;
  }
  const expect = EXPECT[r.label];
  if (expect && !expect.test(body)) {
    console.error(`  [어긋남] ${r.label} → ${r.article} 에 관련 내용이 없다`);
    bad += 1;
  }
}

/*
 * 같은 값이 두 묶음에 나오면 손님은 «다른 조건인가»를 의심하고,
 * 한쪽만 고치면 두 값이 갈라진다. 라벨이 달라도 같은 값이면 중복이다.
 */
const seen = new Map<string, string[]>();
for (const g of groups) {
  for (const r of g.rows) {
    if (!r.value) continue;
    const k = r.value.trim();
    seen.set(k, [...(seen.get(k) || []), `${g.key}·${r.label}`]);
  }
}
const dups = [...seen.entries()].filter(([, where]) => new Set(where.map((w) => w.split('·')[0])).size > 1);
for (const [value, where] of dups) {
  console.error(`  [중복] ${where.join('  ↔  ')}\n         같은 값: ${value.slice(0, 50)}`);
  bad += 1;
}

const noBadge = rows.filter((r) => !r.article).map((r) => r.label);
console.log(`\n배지 ${checked}개 확인 · 어긋남 ${bad}건`);
if (noBadge.length) console.log(`배지 없는 줄 ${noBadge.length}개: ${noBadge.join(' / ')}`);
process.exit(bad ? 1 : 0);
