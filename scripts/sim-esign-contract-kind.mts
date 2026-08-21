/**
 * 프리패스 표준계약서 3벌 × 인수/반납 + 보험 주체 + 모바일 페이지 규격 회귀검증.
 * 실행: npx tsx scripts/sim-esign-contract-kind.mts
 */
import {
  CONTRACT_KINDS, PENALTY_RATES, allowsInsuranceSide, findContractKind,
  penaltyAmount, showsInsuranceLimits,
} from '../lib/domain/esign-contract-kind';
import { buildConsentGroups, paginateForMobile } from '../lib/domain/esign-consent-doc';
import { deductibleForAge } from '../lib/domain/esign-standard-terms';
import {
  ALL_TEMPLATES, contractKindFor, findTemplate, sentTemplateOf, standardTemplateSelectionError,
  templatesForContract,
} from '../lib/domain/esign-templates';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};
const r = (o: Record<string, unknown>) => o as unknown as EntityRecord;

// ── 표준계약서 4유형 ──
check('인수/반납 파생 결과 spec는 4개', CONTRACT_KINDS.length === 4, CONTRACT_KINDS.map((k) => k.label));
check('유형 = 구독/렌탈 × 인수형/반납형',
  CONTRACT_KINDS.map((k) => `${k.kind}${k.maturity}`).sort().join('|')
  === ['구독인수형', '구독반납형', '렌탈인수형', '렌탈반납형'].sort().join('|'));
check('구독은 «자동차 구독 계약서»', findContractKind('sub_buyout')!.title === '자동차 구독 계약서');
check('렌탈은 «자동차 장기대여 계약서»', findContractKind('rent_return')!.title === '자동차 장기대여 계약서');
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
  // 약관 제7조제1항제7호의 표준 3회 기준을 계약서 표에도 명시한다(2026-08-11 V10).
  // 픽스처에도 있어야 「사고 다발 해지」 행이 실제와 같은 문장으로 만들어진다.
  accident_termination_count: 3,
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

// ── 표준계약서 3벌 × 인수/반납, 공급사로 안 좁힌다 ──
check('표준계약서는 정확히 3벌', ALL_TEMPLATES.length === 3, ALL_TEMPLATES.map((item) => item.label));
check('렌트 1벌·구독 보험포함 1벌·구독 보험별도 1벌',
  ALL_TEMPLATES.map((item) => `${item.contractKind}:${item.insuranceSide}`).join('|')
  === '렌탈:회사포함|구독:회사포함|구독:고객직접');
check('3벌 모두 인수/반납 선택 가능',
  ALL_TEMPLATES.flatMap((template) => [
    contractKindFor(template, '인수형'), contractKindFor(template, '반납형'),
  ]).length === 6);
const rentTemplate = findTemplate('freepass-rent-standard')!;
const subIncludedTemplate = findTemplate('freepass-subscription-insurance-included')!;
const subSeparateTemplate = findTemplate('freepass-subscription-insurance-separate')!;
check('렌트 표준서식 + 보험포함 정책 조합 통과',
  standardTemplateSelectionError(rentTemplate, contractKindFor(rentTemplate, '반납형'), { insurance_included: '포함(회사 가입)' }) === '');
check('보험 포함 여부 미기재 정책은 프리패스 기본인 보험포함으로 처리',
  standardTemplateSelectionError(rentTemplate, contractKindFor(rentTemplate, '반납형'), {}) === '');
check('구독 보험포함서식 + 보험별도 정책 조합 차단',
  !!standardTemplateSelectionError(subIncludedTemplate, contractKindFor(subIncludedTemplate, '인수형'), { insurance_included: '개인보험형(손님 직접)' }));
check('구독 보험별도서식 + 보험별도 정책 조합 통과',
  standardTemplateSelectionError(subSeparateTemplate, contractKindFor(subSeparateTemplate, '인수형'), { insurance_included: '개인보험형(손님 직접)' }) === '');
check('공급사가 달라도 표준계약서 3벌은 같다',
  templatesForContract(r({ provider_company_code: 'RP023' })).length === 3
  && templatesForContract(r({ provider_company_code: 'RP012' })).length === 3);
check('유형 미확정 계약에는 임의 기본을 박지 않음', sentTemplateOf(r({})) === null);
check('기발행 구독 보험별도형 복원',
  sentTemplateOf(r({ contract_kind: 'sub_buyout', esign_insurance_side: '고객직접' }))?.id
  === 'freepass-subscription-insurance-separate');
check('모르는 표준계약서는 null', findTemplate('없는유형') === null);
check('렌트 정본만 운영 가능하고 구독 2종은 샘플로 잠긴다',
  ALL_TEMPLATES.filter((t) => !t.isSample).map((t) => t.id).join('|') === 'freepass-rent-standard'
  && ALL_TEMPLATES.filter((t) => t.isSample).length === 2);

// ── 섹션 구성 — 기존 계약서 내용이 다 들어갔는가 ──
const groups = buildConsentGroups(contract, policy, '회사포함');
check('섹션은 8개', groups.length === 8, groups.map((g) => g.title));
check('계약서 구성과 같은 순서',
  groups.map((g) => g.key).join('|') === 'identity|vehicle|rental|payment|driver|insurance|accident|service',
  groups.map((g) => g.key));
const rowsOf = (k: string) => groups.find((g) => g.key === k)!.rows.map((x) => `${x.label}=${x.value}`).join(' / ');
// 실제 계약서에 있는데 빠지기 쉬운 것들 — 빠지면 손님이 모르고 서명한다.
check('연체 시 시동제어가 실린다', rowsOf('payment').includes('시동제어'));
check('지연손해금 연 24%와 법정 한도 문구가 실린다',
  rowsOf('payment').includes('연 24%') && rowsOf('payment').includes('관계 법령상 허용 한도 내'));
check('보증금 반환 조건이 실린다', rowsOf('payment').includes('1주일'));
check('운전자 범위가 실린다', groups.find((g) => g.key === 'driver')!.rows.some((x) => x.label.startsWith('운전자 범위')));
check('중대한 법규위반 사고 기준이 실린다',
  rowsOf('accident').includes('교통사고처리 특례법') && rowsOf('accident').includes('보험·공제약관'));
// 문구가 아니라 **뜻**을 본다 — 정책 원자로 옮기면서 「3회 누적」이
// 「과실 50% 이상 3회 → 계약 해지」로 바뀌었다(2026-08-09). 횟수와 결과가 다 실리면 된다.
check('사고 다발 해지가 실린다',
  rowsOf('accident').includes('3회') && rowsOf('accident').includes('계약 해지'),
  rowsOf('accident').slice(0, 160));
check('보험사가 실린다', rowsOf('accident').includes('렌터카 공제조합'));
check('특약은 정적 문구가 아니라 계약별 합의로 확인한다', !rowsOf('service').includes('GPS') && rowsOf('service').includes('특약사항=없음'));
check('대차 불가가 실린다', rowsOf('service').includes('대차서비스 지원 불가'));
// 과태료 절차는 약관 제16조로 보냈다(IN_AGREEMENT) — 섹션에 있으면 같은 말을 두 번 읽힌다.
check('과태료 절차는 약관으로 보냈다', !rowsOf('service').includes('보증금에서 차감'));
// 면책금은 정책 단일값이 아니라 연령에서 파생된다(계약서 「운전자 연령 선택시 자동입력」).
check('면책금은 연령에서 파생', rowsOf('accident').includes('대인 30만원'), rowsOf('accident').slice(0, 80));
check('연령 모르면 계약 불가 안내', deductibleForAge('').includes('만 21세 미만 계약 불가'));
const selectedTermsGroups = buildConsentGroups(r({
  ...contract,
  driver_age_snapshot: '만 21세 이상',
  annual_mileage_snapshot: '연 4만km',
  special_terms_snapshot: '주말 인도',
  contract_draft: JSON.stringify({ special_terms: '변경 전 초안' }),
}), policy, '회사포함');
const selectedRows = (key: string) => selectedTermsGroups.find((group) => group.key === key)!.rows;
check('고객 동의에는 선택한 약정주행거리가 실린다', selectedRows('rental').some((row) => row.label === '약정 주행거리' && row.value === '연 4만km'));
check('고객 동의에는 선택한 운전자 연령이 실린다', selectedRows('driver').some((row) => row.label === '운전자 연령' && row.value.includes('21')));
check('고객 동의에는 실제 특약 전문이 실린다', selectedRows('service').some((row) => row.label === '특약사항' && row.value === '주말 인도'));

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
