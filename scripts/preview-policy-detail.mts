/**
 * 상품상세 「자세히보기」에 뜰 계약 조건과, 영업사원이 쓰는 가격표를 미리 본다.
 * 계약 정책을 채운 공급사만 상세가 나온다 — 채운 업체가 더 투명한 상품이 된다.
 *
 *   npx tsx scripts/preview-policy-detail.mts
 */
import {
  contractTermsForDetail, salesLevers, canIssueContract,
  CONTRACT_TERMS_DETAIL_OPEN, type DetailViewer,
} from '@/lib/domain/policy-tier';

const filled: Record<string, unknown> = {
  policy_layer: 'contract',
  over_mileage_rate_per_km: 200,
  late_fee_rate: '연 24%',
  deposit_return_days: 7,
  claim_basis: '잔여 대여료',
  engine_control_overdue_days: 3,
  auto_terminate_overdue_days: 10,
  accident_termination_count: 3,
  renewal_notice_days: 30,
  buyout_notice_days: 30,
  impound_keep_days: 30,
  impound_fee: '일 10,000원',
  insurer_name: 'DB손해보험',
  insurer_phone: '1588-0100',
  designated_garage: '지정 협력 정비공장',
  self_damage_exclusions: '침수·전손·무단운전',
  replacement_car_policy: '미가입 시 미제공',
  gps_installed: '장착',
  // 영업 층
  mileage_upcharge_per_10000km: '1만km당 100,000원',
  age_lowering_cost: '월 55,000원',
  additional_driver_cost: '월 50,000원',
  driver_age_lowering: '만 21세까지',
  deposit_installment: '3회까지',
  screening_criteria: '중신용 이상',
};

const productOnly: Record<string, unknown> = { policy_layer: 'product', annual_mileage: '연 20,000km' };

console.log(`상품상세 「자세히보기」: ${CONTRACT_TERMS_DETAIL_OPEN ? '열림' : '아직 닫힘 — 정책이 다 채워질 때까지 보류'}`);

for (const [name, p] of [['계약 정책까지 채운 업체', filled], ['상품만 공급하는 업체', productOnly]] as const) {
  const gate = canIssueContract(p as Record<string, unknown>);
  console.log(`\n${'═'.repeat(64)}\n${name} — 전자계약 ${gate.ok ? '발송 가능' : '발송 불가'}`);
  if (!gate.ok && gate.reason) console.log(`  ${gate.reason}`);

  // 보는 사람에 따라 달라진다 — 지금은 영업자·관리자만, 그마저도 기능이 열려야 나간다.
  for (const viewer of ['agent', 'provider', 'customer'] as DetailViewer[]) {
    const terms = contractTermsForDetail(p as Record<string, unknown>, { viewer });
    if (!terms.length) {
      console.log(`  [${viewer}] 계약 조건 안 보임`);
      continue;
    }
    console.log(`\n  [${viewer}] 상품상세 「자세히보기」`);
    let g = '';
    for (const t of terms) {
      if (t.group !== g) { console.log(`    [${t.group}]`); g = t.group; }
      console.log(`       ${t.label.padEnd(22)}${t.value}${t.article ? `  (${t.article})` : ''}`);
    }
  }
}

console.log(`\n${'═'.repeat(64)}\n영업 레버 — 손님에게 그대로 보이지 않는다`);
for (const s of salesLevers(filled)) {
  console.log(`  ${s.internal ? '⚠' : ' '} ${s.label.padEnd(20)}${s.value.padEnd(22)}→ ${s.decides}`);
}
