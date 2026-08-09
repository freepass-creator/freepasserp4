/**
 * 프리패스 표준계약서 4유형 + 보험 주체 + 모바일 페이지 규격 회귀검증.
 * 실행: npx tsx scripts/sim-esign-contract-kind.mts
 */
import {
  CONTRACT_KINDS, PENALTY_RATES, allowsInsuranceSide, findContractKind,
  penaltyAmount, showsInsuranceLimits,
} from '../lib/domain/esign-contract-kind';
import { buildConsentGroups, paginateForMobile } from '../lib/domain/esign-consent-doc';
import { deductibleForAge } from '../lib/domain/esign-standard-terms';
import { ALL_TEMPLATES, defaultTemplateFor, findTemplate, templatesForContract } from '../lib/domain/esign-templates';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};
const r = (o: Record<string, unknown>) => o as unknown as EntityRecord;

// ── 표준계약서 4유형 ──
check('표준계약서는 4유형', CONTRACT_KINDS.length === 4, CONTRACT_KINDS.map((k) => k.label));
check('유형 = 구독/렌탈 × 인수형/반납형',
  CONTRACT_KINDS.map((k) => `${k.kind}${k.maturity}`).sort().join('|')
  === ['구독인수형', '구독반납형', '렌탈인수형', '렌탈반납형'].sort().join('|'));
check('구독은 «자동차 구독 계약서»', findContractKind('sub_buyout')!.title === '자동차 구독 계약서');
check('렌탈은 «자동차 렌탈(대여) 계약서»', findContractKind('rent_return')!.title === '자동차 렌탈(대여) 계약서');
// 당사자 호칭이 갈린다 — 구독은 회사/계약자, 렌탈은 임대인/임차인(실제 계약서 표기 그대로).
check('구독 당사자 호칭', findContractKind('sub_return')!.party.provider === '회사');
check('렌탈 당사자 호칭', findContractKind('rent_buyout')!.party.customer.startsWith('임차인'));
check('인수형은 인수가격 필수', findContractKind('rent_buyout')!.buyoutPriceRequired);
check('반납형은 인수가격 선택', !findContractKind('sub_return')!.buyoutPriceRequired);

// ── 보험 주체 ──
check('구독은 보험 주체 둘', findContractKind('sub_buyout')!.insuranceSides.length === 2);
check('렌탈은 회사포함 하나', findContractKind('rent_return')!.insuranceSides.join() === '회사포함');
// 렌탈에 «고객직접»을 붙이면 계약서가 틀린다 — 회사가 영업용 보험을 든 상품이다.
check('렌탈에 고객직접 금지', !allowsInsuranceSide(findContractKind('rent_return')!, '고객직접'));
check('구독에 고객직접 허용', allowsInsuranceSide(findContractKind('sub_buyout')!, '고객직접'));
check('회사포함이면 한도 표시', showsInsuranceLimits('회사포함'));
check('고객직접이면 한도 숨김', !showsInsuranceLimits('고객직접'));

// ── 보험 묶음이 주체에 따라 통째로 바뀐다 ──
const contract = r({
  contract_code: 'C-1', customer_name: '홍길동', customer_phone: '01012345678',
  car_number_snapshot: '12가3456', vehicle_name_snapshot: '그랜저',
  rent_month_snapshot: 36, rent_amount_snapshot: 690000, deposit_amount_snapshot: 0,
});
const policy = {
  injury_compensation_limit: '무한', property_compensation_limit: '2억원',
  self_body_accident: '1억5천만원', own_damage_min_deductible: '30만원',
  basic_driver_age: '만 26세이상',
  personal_driver_scope: '[개인기본1] 계약자와 배우자 및 직계가족',
  business_driver_scope: '[법인] 법인의 임직원',
  additional_driver_allowance_count: '1명', additional_driver_cost: '월 55,000원',
  license_period: '1년 이상', maintenance_service: '정비제외',
  penalty_condition: '잔여 대여료의 30%',
};
const insOf = (side: '회사포함' | '고객직접') =>
  buildConsentGroups(contract, policy, side).find((g) => g.key === 'insurance')!;

check('회사포함은 한도가 실린다', insOf('회사포함').rows.some((x) => x.value === '무한'));
// ★가장 위험한 지점 — 회사가 안 든 보험을 든 것처럼 보이면 손님이 보상된다고 믿고 서명한다.
check('고객직접은 한도가 안 실린다',
  !insOf('고객직접').rows.some((x) => x.value === '무한' || x.value === '2억원'),
  insOf('고객직접').rows.map((x) => `${x.label}=${x.value}`));
check('고객직접은 «고객 직접 가입»을 명시', insOf('고객직접').rows.some((x) => x.value === '고객 직접 가입'));
check('회사포함은 «회사 가입»을 명시', insOf('회사포함').rows.some((x) => x.value.startsWith('회사 가입')));
check('고객직접 동의 문구가 다르다', insOf('고객직접').confirmLabel.includes('직접 가입'));

// ── 중도해지 요율 ──
check('인수형이 1년 이상에서 더 싸다', PENALTY_RATES.인수형.overOneYear < PENALTY_RATES.반납형.overOneYear);
check('1년 미만은 양쪽 30%', PENALTY_RATES.인수형.underOneYear === 0.30 && PENALTY_RATES.반납형.underOneYear === 0.30);
check('11개월은 30% 적용', penaltyAmount('반납형', 10_000_000, 11).rate === 0.30);
check('12개월은 20% 적용', penaltyAmount('반납형', 10_000_000, 12).rate === 0.20);
check('인수형 12개월은 10%', penaltyAmount('인수형', 10_000_000, 12).rate === 0.10);
check('위약금 계산', penaltyAmount('반납형', 10_000_000, 24).amount === 2_000_000);
check('잔여액 0이면 0원', penaltyAmount('반납형', 0, 24).amount === 0);

// ── 양식 목록 = 표준 4종, 공급사로 안 좁힌다 ──
check('양식은 표준 4종', ALL_TEMPLATES.length === 4);
check('공급사가 달라도 같은 목록',
  templatesForContract(r({ provider_company_code: 'RP023' })).length === 4
  && templatesForContract(r({ provider_company_code: 'RP012' })).length === 4);
check('기본은 렌탈 반납형', defaultTemplateFor(r({})).id === 'rent_return');
check('계약에 유형이 박혀 있으면 그것', defaultTemplateFor(r({ contract_kind: 'sub_buyout' })).id === 'sub_buyout');
check('모르는 양식은 null', findTemplate('없는양식') === null);
check('양식 전부 샘플 표시', ALL_TEMPLATES.every((t) => t.isSample));

// ── 섹션 구성 — 기존 계약서 내용이 다 들어갔는가 ──
const groups = buildConsentGroups(contract, policy, '회사포함');
check('섹션은 8개', groups.length === 8, groups.map((g) => g.title));
check('계약서 구성과 같은 순서',
  groups.map((g) => g.key).join('|') === 'identity|vehicle|rental|payment|driver|insurance|accident|service',
  groups.map((g) => g.key));
const rowsOf = (k: string) => groups.find((g) => g.key === k)!.rows.map((x) => `${x.label}=${x.value}`).join(' / ');
// 실제 계약서에 있는데 빠지기 쉬운 것들 — 빠지면 손님이 모르고 서명한다.
check('연체 시 시동제어가 실린다', rowsOf('payment').includes('시동제어'));
check('지연손해금이 실린다', rowsOf('payment').includes('연 12%'));
check('보증금 반환 조건이 실린다', rowsOf('payment').includes('1주일'));
check('운전자 범위가 실린다', groups.find((g) => g.key === 'driver')!.rows.some((x) => x.label.startsWith('운전자 범위')));
check('중과실 12대가 실린다', rowsOf('accident').includes('중앙선 침범'));
check('사고 다발 해지가 실린다', rowsOf('accident').includes('3회 누적'));
check('보험사가 실린다', rowsOf('accident').includes('렌터카 공제조합'));
check('GPS 특약이 실린다', rowsOf('service').includes('GPS'));
check('대차 불가가 실린다', rowsOf('service').includes('대차서비스 지원 불가'));
// 과태료 절차는 약관 제18조로 보냈다(IN_AGREEMENT) — 섹션에 있으면 같은 말을 두 번 읽힌다.
check('과태료 절차는 약관으로 보냈다', !rowsOf('service').includes('보증금에서 차감'));
// 면책금은 정책 단일값이 아니라 연령에서 파생된다(계약서 「운전자 연령 선택시 자동입력」).
check('면책금은 연령에서 파생', rowsOf('accident').includes('대인 30만원'), rowsOf('accident').slice(0, 80));
check('연령 모르면 가장 보수적인 값', deductibleForAge('').includes('대인 60만원'));

// ── 화면 규격 — 1섹션 = 1화면, 쪼개지 않는다 ──
const pages = paginateForMobile(groups);
check('화면 수 = 값 있는 섹션 수', pages.length === groups.filter((g) => g.rows.length).length,
  pages.map((p) => `${p.title}:${p.rows.length}`));
check('섹션을 쪼개지 않는다', pages.every((p) => {
  const g = groups.find((x) => x.key === p.key)!;
  return p.rows.length === g.rows.length;
}));
check('모든 화면에 확인 문구가 있다', pages.every((p) => !!p.confirmLabel));
check('단계 표시가 1부터 끝까지', pages.map((p) => p.step).join(',') === pages.map((_, i) => i + 1).join(','));
check('단계 라벨 형식', pages[0].stepLabel === `1 / ${pages.length}`, pages[0].stepLabel);
// 긴 섹션은 스크롤 끝에 닿아야 확인이 눌린다 — 안 읽고 누르는 걸 막는 유일한 장치다.
check('긴 섹션은 통독 강제', pages.find((p) => p.key === 'accident')!.requireReadThrough);
check('짧은 섹션은 통독 강제 안 함', !pages.find((p) => p.key === 'identity')!.requireReadThrough);
check('행 순서가 보존된다',
  pages.flatMap((p) => p.rows.map((x) => x.label)).join('|')
  === groups.filter((g) => g.rows.length).flatMap((g) => g.rows.map((x) => x.label)).join('|'));
// 값이 하나도 없는 섹션에서 «확인»을 누르게 하면 안 된다.
check('빈 섹션은 화면을 만들지 않는다',
  paginateForMobile([{ ...groups[0], rows: [] }, groups[1]]).length === 1);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
