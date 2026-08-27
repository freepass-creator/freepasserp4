import { POLICY_VALUE_RULES } from './policy-value-spec';
import { EXT_COLORS, INT_COLORS } from './color-master';

import { FUEL_TYPES, PRODUCT_TYPES, VEHICLE_STATES } from '@/lib/intake/entities';

/**
 * 공급사 **제공시트** 표준 양식 — 공급사가 프리패스에 재고를 주는 시트의 규격 1장.
 *
 * ★현재 ERP 입력 정본은 상품마스터 한 탭이다.
 *   · 이 파일 = 공급사가 참고·제출에 쓰는 표준 양식. 프리패스는 **양식만 배포하고 값은 안 쓴다**.
 *   · 공급사 자료를 확인해 상품마스터를 확정한 뒤 그 한 탭만 ERP에 반영한다.
 *
 * 왜 이 열 구성인가 — 발명이 아니라 **실측으로 굳힌 것**이다(2026-08-08 · 시트 18곳).
 *   차량번호·배차상태·차종·구분·옵션·비고는 이미 15곳 전부가 같은 이름으로 쓰고 있었다.
 *   여기서 하는 일은 셋이다.
 *     ① 이름 흔들림을 하나로  — 유종/연료 · 주행거리/km · 외장색/외장 · 내장색/내장 · 최초등록일/최초등록
 *     ② 아무도 안 쓰던 칸을 세움 — 차대번호 0곳 · 연식 0곳 · **사진링크 0곳**
 *        (사진이 190/287 밖에 안 붙던 이유. 열이 없어 셀에 박힌 링크를 긁고 있었다)
 *     ③ 1곳만 쓰던 칸을 표준으로 — 제조사·세부모델·트림·배기량 (RP004 확장판이 사실상 상위집합)
 *        트림이 없으면 매처가 짧은 이름으로 모델을 잠가 검수로 떨어진다(빌린카 16대 실측).
 *
 * ★헤더 위 정책 3줄이 파서를 안 깨는 이유
 *   `sheet-adapters.looksLikeHeader` 는 «칸 하나가 차량번호 그 자체 + 라벨 3칸 이상» 인 행을
 *   헤더로 본다. 정책 블록에는 「차량번호」라는 라벨이 없으므로 헤더로 오인되지 않고,
 *   `resolveHeaderRow` 가 아래 진짜 헤더행을 찾아낸다. 공급사가 정책을 더 적어 행이 밀려도 같다.
 *   ⚠ 그러므로 정책 라벨에 「차량번호」를 쓰면 안 된다.
 */

/**
 * 머리글 — 헤더 위 1줄. **공급사 단위로 한 번만 정하는 것**만 남긴다.
 * 차마다 달라지는 조건(면책금·연령·면허·정비)은 열로 내려갔다 — 한 곳에서만 말하게 한다.
 *
 * ⚠ 이 줄은 아직 읽어서 저장하지 않는다. 파서는 표만 읽는다.
 */
/** 두 탭이 같은 문서로 보이게 하는 글꼴. 표(Table)가 쓰는 것과 같아야 한다. */
export const FONT = 'Roboto';

export const POLICY_ROWS: { label: string; hint: string; values?: string[] }[][] = [
  [
    { label: '공급사명', hint: '' },
    // ★이 시트를 «고쳐도 되는가»를 가르는 칸. 보관용은 우리가 채우는 거울이라
    //   여기에 손으로 적으면 반영되지 않고 원본과만 어긋난다.
    { label: '재고 출처', hint: '',
      values: ['공급사 입력(수기)', '홈페이지 자동연동', '공급사 시트 연동(보관용)'] },
    { label: '담당자', hint: '' },
    { label: '연락처', hint: '' },
    // 보증금을 «값»으로 주는 곳과 «규칙»으로 주는 곳이 갈린다(손오공=규칙, 대부분=값).
    { label: '보증금 규칙', hint: '',
      values: ['시트의 보증금 칸에 금액 입력', '대여료 × 약정연수 (12개월=1개월치)', '대여료 × 배율 (국산 2 · 수입 3)'] },
  ],
];

/**
 * 정책 열 — **차마다 다를 수 있어서** 열로 내렸다. 선택지는 정책관리에 실제로 있는 값이다
 * (2026-08-08 실측 · 정책 54건). 괄호 안은 그 값을 쓰는 정책 수.
 *
 * ★공급사가 칠 일은 거의 없다 — 재고에 붙은 정책(`policy_code`, 701대 중 493대)에서 미리 채워
 *   내보낸다. 보고 «틀린 것만» 고치면 된다.
 *
 * ⚠ 지금은 이 열을 읽어 정책으로 되돌리지 않는다. 정책의 정본은 ERP 정책관리다.
 *   여기 고친 값이 자동 반영되진 않는다 — 눈으로 확인하고 정책관리에서 고쳐야 한다.
 */
const POLICY_COLUMNS: { name: string; note: string; field?: string; values?: string[] }[] = [
  // ★이 칸이 우선한다. 코드를 적으면 오른쪽을 일일이 채울 필요가 없다.
  { name: '정책코드', note: 'POL-0047 — 적으면 이 정책이 우선. 오른쪽은 그 정책의 내용(참고)' },
  // ── 심사(2026-08-19 사장님) — 영업자 화면 뱃지·상담용. 손님·계약서엔 안 나간다.
  { name: '심사조건', note: '무심사 / 소득확인 / 신용조회', field: 'screening_criteria' },
  // 불가조건 1~4 는 여기 없다 — 넷을 합쳐 disqualification_conditions 하나로(policy-sheet-to-erp.sheetPolicyToErp)

  // ── 자차 ──
  { name: '자차보상한도', note: '무엇을 기준으로 보상하나', field: 'own_damage_compensation', values: ['차량가액', '1000만원', '500만원', '400만원'] },
  { name: '자차수리비율', note: '수리비의 몇 %를 고객이 무나 — 보상한도·면책금과 다른 값이다', field: 'own_damage_repair_ratio', values: ['20%', '50%', '100%'] },
  { name: '자차최소면책금', note: '한 건당 최소 부담액', field: 'own_damage_min_deductible', values: ['50만원', '100만원', '30만원', '200만원'] },
  { name: '자차최대면책금', note: '한 건당 최대 부담액', field: 'own_damage_max_deductible', values: ['100만원', '50만원', '400만원'] },
  // ── 대물 ──
  { name: '대물보상한도', note: '', field: 'property_compensation_limit', values: ['1억원', '2억원', '10억원', '5천만원', '3천만원'] },
  { name: '대물면책금', note: '', field: 'property_deductible', values: ['30만원', '50만원', '없음'] },
  // ── 대인·자손·무보험 ──
  // ★대인보상한도가 빠져 있었다 — 계약서 제11조에 들어가는 값인데 안 묻고 있었다(2026-08-11).
  { name: '대인보상한도', note: '계약서 제11조', field: 'injury_compensation_limit', values: ['무한', '1억원', '2억원'] },
  { name: '대인면책금', note: '', field: 'injury_deductible', values: ['30만원', '50만원', '없음'] },
  { name: '자손보상', note: '', field: 'self_body_accident', values: ['1억원', '5,000만원', '1,500만원'] },
  { name: '자손면책금', note: '', field: 'self_body_deductible', values: ['30만원', '50만원', '없음'] },
  { name: '무보험보상', note: '', field: 'uninsured_damage', values: ['2억원', '없음'] },
  { name: '보험료', note: '', field: 'insurance_included', values: ['보험료 포함', '보험료 별도'] },
  // ── 운전자 ──
  { name: '기본운전자연령', note: '', field: 'basic_driver_age', values: ['만 26세 이상', '만 21세 이상'] },
  { name: '연령인하', note: '', field: 'driver_age_lowering', values: ['협의', '만21세', '만23세', '불가'] },
  { name: '최대연령', note: '', field: 'driver_age_upper_limit', values: ['만 65세 이하', '제한없음', '만 70세 이하', '만 60세 이하'] },
  { name: '면허기간', note: '', field: 'license_period', values: ['1년 이상', '제한없음', '2년 이상', '3년 이상'] },
  { name: '개인운전자범위', note: '', field: 'personal_driver_scope', values: ['계약자 본인+직계가족', '계약자 본인만', '계약자 본인+추가운전자', '협의'] },
  { name: '법인운전자범위', note: '', field: 'business_driver_scope', values: ['계약사업자 임직원 및 관계자', '대표자 본인만', '협의'] },
  // ★사장님 2026-08-18 — 「추가운전」은 가능 여부만. 인원·요금은 「추가운전 요금」(「N인까지 · 1인당 월 M만원」).
  // ★「추가운전」 가부 칸은 폐지(2026-08-19) — 「추가운전 인원」(불가 포함)이 게이트이자 ERP allowance_count 다. 「가능」을 인원에 넣으면 0으로 읽히던 문제도 이걸로 끝.
  { name: '추가운전 인원', note: '불가 / 1~5인까지 / 제한없음', field: 'additional_driver_allowance_count' },
  // ── 그 밖의 조건 ──
  // ── 주행 ──
  // 대부분의 공급사는 «정책 한 줄»이면 끝난다 — 기본 주행거리와 1만km 추가 요율.
  // 오토플러스만 매물마다 정액이 달라(실측 54대: 3만·4만·5만 …) 상품리스트에 열을 따로 둔다.
  // ★세 줄 다 ERP 필드가 안 붙어 있었다 — 공급사가 적어도 계약서 제23조가 빈칸이었다(2026-08-11).
  { name: '기본주행', note: '계약서 제23조 · 약정 주행거리', field: 'annual_mileage',
    values: ['연간 2만Km', '연간 3만Km', '연간 1만Km', '무제한', '협의'] },
  { name: '추가주행 금액', note: '정액이면 100000 · 비례면 10%', field: 'mileage_upcharge_per_10000km',
    values: ['10만원', '15만원', '5만원', '10%', '협의'] },
  // 약정을 넘겨 탔을 때 1km 당 얼마 — 계약서 제23조. 국산·수입이 갈린다.
  { name: '초과주행 국산(1km당)', note: '계약서 제23조 · 예: 200', field: 'over_mileage_rate_domestic', values: ['200', '150', '300'] },
  { name: '초과주행 수입(1km당)', note: '계약서 제23조 · 예: 400', field: 'over_mileage_rate_imported', values: ['400', '300', '500'] },
  { name: '정비', note: '', field: 'maintenance_service', values: ['협의', '불포함', '포함'] },
  { name: '대여지역', note: '', field: 'rental_region', values: ['전국', '제주도불가', '협의'] },
  /**
   * ★**카드결제 두 칸 — 한 칸에 「불가」 아니면 수수료율**(사장님 2026-08-21).
   *   대여료와 보증금은 카드 가부가 다르다. 「결제방식」(CMS/카드/이체)은 셋 중 «하나»를 고르는 칸이라
   *   「CMS 가 기본인데 카드도 된다」를 못 담았다 — 천이 카드시트가 그 글자에 /카드/ 를 걸어 O·X 를
   *   지어내고 있었다(CMS 를 고른 곳은 카드가 되든 말든 전부 X).
   *   수수료 칸을 따로 두지 않는다 — 되는지와 얼마 무는지를 공급사가 한 번에 말한다.
   *   「가능」은 옛 값이다(된다는 것만 알고 율은 모름). 새로 적을 때는 율이나 「무료」로.
   */
  { name: '대여료카드결제', note: '불가 / 무료 / 1.5% / 협의 — 대여료를 카드로 낼 수 있나, 수수료는 몇 %', field: 'rental_card_payment', values: ['불가', '무료', '1%', '1.5%', '2%', '협의'] },
  { name: '보증금카드결제', note: '불가 / 무료 / 1.5% / 협의 — 보증금을 카드로 낼 수 있나, 수수료는 몇 %', field: 'deposit_card_payment', values: ['불가', '무료', '1%', '1.5%', '2%', '협의'] },
  { name: '보증금분납', note: '', field: 'deposit_installment', values: ['협의', '가능', '불가능'] },

  // ── 계약서가 쓰는데 안 묻고 있던 것 (2026-08-11 · 사장님 확정) ──
  //   프리패스가 정하는 조항 수치(지연손해금율·보관료·통지기한 등)는 여기서 묻지 않는다.
  //   여기 있는 것은 **공급사마다 갈리는 값**뿐이다.
  { name: '긴급출동', note: '계약서 제14조 · 연 몇 회', field: 'annual_roadside_assistance', values: ['연간 5회', '연간 3회', '무제한', '없음'] },
  { name: '대차 제공', note: '계약서 제5조·제20조 · 사고·정비 중 대차', field: 'replacement_car_policy', values: ['불가', '동급 대차', '협의'] },
  { name: 'GPS 장착', note: '계약서 제24조', field: 'gps_installed', values: ['장착', '미장착'] },
  // 승계는 해지와 다른 길이다 — 해지는 물고 끝내고, 승계는 남은 기간을 새 임차인이 이어받는다.
  { name: '승계 가능여부', note: '계약을 다른 사람에게 넘길 수 있나', field: 'succession_allowed', values: ['가능', '협의', '불가'] },
  { name: '승계수수료', note: '넘길 때 1회 — 불가 / 50~500만원', field: 'succession_fee' },
  { name: '중도해지 위약금 1년미만', note: '계약서 제8조 · 잔여 대여료의 몇 %', field: 'early_termination_rate_under1y', values: ['30%', '20%', '10%'] },
  { name: '중도해지 위약금 1년이상', note: '계약서 제8조', field: 'early_termination_rate_over1y', values: ['20%', '10%', '30%'] },
  { name: '사고 다발 해지기준', note: '계약서 제7조 · 1년 내 과실 50% 이상 3회', field: 'accident_termination_count', values: ['3'] },
  { name: '연령 하향 요금', note: '연령을 내릴 때 월 얼마', field: 'age_lowering_cost', values: ['10만원', '15만원', '20만원', '불가', '협의'] },
  /**
   * ★나이마다 할증이 다르다(사장님 2026-08-21 「21세 23세 금액이 다른 곳이 꽤 있는데 왜 다 같지」).
   *   옛 「프리패스 공급사 상품리스트」 실측 — 손오공·센트로·리더스 21세 10 / 23세 7 · 빌린카 12/7 ·
   *   엘씨 20/15 · 에스에이 15/10 · 경진카 불가/10. 한 칸으로는 이 차이를 못 담아 전부 21세 값으로 나갔다.
   *   비워 두면 「연령 하향 요금」 한 값을 두 나이에 같이 쓴다(예전 그대로).
   */
  { name: '21세+', note: '만 21세까지 낮출 때 월 할증 — 「10만원」 또는 「대여료의 10%」 · 안 되면 「불가」', field: 'age_21_cost', values: ['10만원', '12만원', '15만원', '20만원', '불가', '협의'] },
  { name: '23세+', note: '만 23세까지 낮출 때 월 할증 — 「7만원」 또는 「대여료의 7%」 · 안 되면 「불가」', field: 'age_23_cost', values: ['7만원', '10만원', '15만원', '불가', '협의'] },
  { name: '추가운전 요금', note: '1인당 월 — 「5만원」 / 「대여료의 5%」 / 무료 / 불가', field: 'additional_driver_cost' },
  { name: '탁송비', note: '전액지원 / 일부지원 / 고객부담', field: 'delivery_fee', values: ['전액지원', '일부지원', '고객부담'] },
  // ── 2026-08-19 신설 8 — 계약서 제6·7·24조가 참조하는데 시트에 없던 것. 드롭다운은 policy-value-spec 이 정본.
  { name: '결제방식', note: '계약서 제6조', field: 'payment_method' },
  { name: '납부조건', note: '계약서 제6조 · 건별 확정 기본값', field: 'payment_timing' },
  { name: '월 납부일', note: '계약서 제6조 · CMS 출금일', field: 'payment_due_date' },
  { name: '보증금 반환기한', note: '계약서 제6조 · 「7일」', field: 'deposit_return_days' },
  { name: '무보험면책금', note: '계약서 제11조', field: 'uninsured_deductible' },
  { name: '시동제어 기준일', note: '계약서 제24조 · 「3일」', field: 'engine_control_overdue_days' },
  { name: '차량회수 기준일', note: '계약서 제7조·제24조 · 「10일」', field: 'auto_terminate_overdue_days' },
  { name: '특이사항', note: '영업자 안내 — 손님·계약서엔 안 실림', field: 'sales_notes' },
];
/** 열 이름 → 정책 레코드 필드. 이관 때 연결된 정책에서 미리 채우는 데 쓴다. */
/**
 * 정책 항목의 **드롭다운 목록** — 공급사가 골라 넣게 한다(사장님 2026-08-14 —
 * 「공급사들 입력하는 거에는 드랍다운으로 할 수 있게끔」).
 *
 * ★골라 넣게 하면 표기가 안 갈린다. 실측 2026-08-14: 같은 뜻이 「만 26세 이상」과 「26」,
 *   「10만원」과 「100000」, 「30%」와 「0.3」, 「3회」와 「3」으로 섞여 있었다.
 * ⚠ **막지는 않는다**(strict=false). 목록에 없는 답이 실제로 있다 — 「2회까지」처럼.
 *   막으면 공급사가 못 적고 그냥 비워 둔다. 고르게 «권하되» 손으로도 적을 수 있어야 한다.
 */
/**
 * ★드롭다운 목록의 정본은 `policy-value-spec.POLICY_VALUE_RULES.allowed` 다(2026-08-18).
 *   예전엔 여기 `values` 와 `policy-sheet-layout` 의 메모가 서로 다른 표기를 권해 20곳 정책 탭이 갈렸다
 *   (「연간 2만Km」 vs 「연 20,000km」·「만21세」 vs 「만 21세까지」). 위 `values` 는 스펙에 없는 항목의 예비값일 뿐이다.
 */
export const POLICY_VALUE_LISTS: Record<string, readonly string[]> = Object.fromEntries([
  ...POLICY_COLUMNS.filter((c) => c.values?.length).map((c) => [c.name, c.values as string[]]),
  ...POLICY_VALUE_RULES.filter((r) => r.allowed.length).map((r) => [r.name, r.allowed]),
]);

export const POLICY_COLUMN_FIELDS: { name: string; field: string }[] =
  POLICY_COLUMNS.filter((c) => c.field).map((c) => ({ name: c.name, field: c.field! }));
export const POLICY_COLUMN_NAMES = POLICY_COLUMNS.map((c) => c.name);

/**
 * 표준 열 — **왼쪽부터 렌트사가 채우는 순서**다.
 *   신원(차번) → 지금 팔 수 있나(상태·구분) → 차 스펙 → 사진·메모 → 돈.
 * 자주 바뀌는 칸(배차상태)을 왼쪽에 두어 매일 손대는 열이 스크롤 밖으로 안 나가게 한다.
 */
/**
 * 앞줄 — **차를 특정하는 것만.** 여기까지 채우면 어느 차인지 정해진다.
 * 매일 손대는 칸(상태)을 왼쪽에 둬서 스크롤 밖으로 안 나가게 한다.
 */
/**
 * ★**차종마스터 칸 — 프리패스가 채운다. 공급사는 손대지 않는다.**
 *   (사장님 2026-08-14 — 「공급사시트에 AI가 작업해주는 칸들을 만들어서 1회성으로 파워트레인
 *    작업해놓고 그걸 갖고 오자」 · 「차종마스터만 그 뒤쪽에 넣어두자는 거고」)
 *
 *   공급사는 지금까지 하던 대로 **「차명(세부모델+트림)」 한 칸에** 적는다.
 *   그 문장을 차종마스터에 걸어 축으로 갈라 놓는 것이 우리 일이고, 그 결과가 이 칸들이다.
 *
 * ★**맨 뒤에 붙인다.** 앞을 재배치하지 않는다 —
 *   공급사가 매일 보는 화면이 바뀌고, 열을 옮기다 값이 밀릴 위험을 지는 값어치가 없다
 *   (실측 2026-08-14: 앞으로 당겼다가 빌린카 정책코드 40칸이 날아갔다).
 * ★**차량번호마다 한 번만** 한다. 이미 값이 있는 칸은 기계가 다시 안 덮는다
 *   (`lib/domain/supplier-ai-columns.planFill`). 한 번 고쳐 놓으면 그 자리에 남는다.
 * ★판매시트는 이 칸을 **그대로 실어 간다.** 발행할 때 다시 추측하지 않는다 —
 *   매주 같은 차를 새로 판단하다가 파워트레인·세부트림이 영영 안 채워졌다.
 * ⚠ 값을 고치려면 그 칸을 **비우고** 다시 채우거나, 손으로 바로 고친다. 비워 두면 기계가 다시 넣는다.
 * ⚠ 제조사는 여기 없다 — 이미 앞에 있고, 공급사가 적어 주는 값이다.
 */
/**
 * ★공급사가 «차 이름»으로 적는 것은 **세 칸뿐**이다(사장님 2026-08-14 —
 *   「공급사한테 입력시키는 건 단순해야 하니까 / 제조사 세부모델(트림) 옵션 이렇게만 입력시키고」).
 *     제조사 · 차명(세부모델+트림) · 옵션
 *   그 셋을 받아 아래 여섯 칸으로 갈라 놓는 것이 우리 일이고, 상품시트는 이 여섯 칸을 실어 간다.
 * ⚠ 「제조사」는 앞에 이미 있어 이름이 겹친다 — 정제본만 「제조사(정제)」로 단다.
 *   한 시트에 같은 이름이 둘이면 열을 이름으로 찾는 스크립트가 엉뚱한 칸을 집는다.
 */
/** 엔카 모델행키(M-0001). 제조사 × 1차모델. 모델까지만 알 때. */
export const ENCAR_MODEL_KEY_COLUMN = '모델행키';
/** 엔카 세부모델행키(SM-0001). 모델행키 + 세부모델. 세대까지 알 때. */
export const ENCAR_SUB_KEY_COLUMN = '세부모델행키';
/** 엔카 세부트림행키(T-0001). 세부모델행키 + 세부트림. 트림까지 알 때. */
export const ENCAR_TRIM_KEY_COLUMN = '세부트림행키';
/** 세부트림행키와 같다. 예전 스크립트 별칭. */
export const ENCAR_TRIM_CODE_COLUMN = ENCAR_TRIM_KEY_COLUMN;
/** 예전 공급사 열 이름. insert 가 세부트림행키로 바꾼다. */
export const ENCAR_OLD_TRIM_CODE_COLUMN = '차종트림코드';
/** @deprecated 공급사에 안 둔다. 원자ID는 차종마스터 수집 시트. 남은 열 지울 때만 쓴다. */
export const ENCAR_MASTER_CODE_COLUMN = '차종마스터코드';
/** @deprecated 공급사에 안 둔다. 제원 칸은 원자 수집 시트. 남은 열 지울 때만 쓴다. */
export const ENCAR_MASTER_LABEL_COLUMN = '마스터표기';
/** 정책코드 다음에 두는 엔카 칸 — 아는 층만 채운다. */
export const ENCAR_CODE_BLOCK = [ENCAR_MODEL_KEY_COLUMN, ENCAR_SUB_KEY_COLUMN, ENCAR_TRIM_KEY_COLUMN] as const;
/**
 * 우리 기본스펙. **글자는 fill 이 차종마스터(vehicle-master.json)에서 박는다.**
 * stamp(엔카)는 행키(M/SM/T)만. 공급사 왼쪽 칸과 이름이 겹치면 정제 이름을 쓴다.
 */
export const ENCAR_SPEC_BLOCK = [
  '원산지',
  '제조사(정제)',
  '모델',
  '세부모델',
  '세부트림',
  '연료(정제)',
  '배기량(정제)',
  '구동방식',
  '인승',
  '차종구분',
  '배터리용량(정제)',
] as const;
/** 예전에 공급사에 넣었다가 원자 시트로 옮긴 칸. insert 스크립트가 지운다. */
export const ENCAR_RETIRED_COLUMNS = [ENCAR_MASTER_CODE_COLUMN, ENCAR_MASTER_LABEL_COLUMN] as const;

export const AI_TAIL_COLUMNS: { name: string; note: string; required?: boolean }[] = [
  /**
   * ★엔카 중고차 코드(2026-08-20). 아는 층만 박는다.
   *   모델만 알면 M, 세대까지면 SM, 트림까지면 T. 원자(U)는 차종마스터에만 둔다.
   */
  { name: ENCAR_MODEL_KEY_COLUMN, note: '★프리패스가 채움 — 모델행키 M-0001. 제조사×1차모델. 모델까지만 알아도 박는다' },
  { name: ENCAR_SUB_KEY_COLUMN, note: '★프리패스가 채움 — 세부모델행키 SM-0001. 모델행키+세부모델. 세대까지 알면 박는다' },
  { name: ENCAR_TRIM_KEY_COLUMN, note: '★프리패스가 채움 — 세부트림행키 T-0001. 세부모델행키+세부트림. 트림까지 알면 박는다' },
  /**
   * ★정제칸 읽는 차례(사장님 2026-08-23) —
   *   원산지 · 제조사 · 모델 · 세부모델 · 세부트림 · 외장 · 내장 · (정제시트만 연식·주행거리) ·
   *   연료 · 배기량 · 구동 · 인승 · 차종구분 · 배터리.
   *   행키 셋은 기계용이라 맨 앞. 차종코드·선택옵션·차종분류·차명은 그 뒤.
   */
  { name: '원산지', note: '★프리패스가 채움 — 국산 · 수입. 모델이 정해지면 박는다' },
  { name: '제조사(정제)', note: '★프리패스가 채움 — 차종마스터 제조사. 르노코리아 · KG모빌리티' },
  { name: '모델', note: '★프리패스가 채움 — 1차모델. 그랜저 · 아반떼. 모델까지만 알아도 박는다' },
  { name: '세부모델', note: '★프리패스가 채움 — 세대. 더 뉴 그랜저 GN7. 세대까지 알면 박는다' },
  { name: '세부트림', note: '★프리패스가 채움 — 트림. 원문에 마스터 트림 글자가 그대로 있을 때만. 비슷하면 빈칸. 모르면 빈칸' },
  { name: '외장색상', note: '★프리패스가 채움 — 공급사 외부색상을 규격 12색으로. 밖이면 기타. 빈 칸은 채우고, 원문과 다르면 다시 맞춘다' },
  { name: '내장색상', note: '★프리패스가 채움 — 공급사 내부색상을 규격 10색으로. 밖이면 기타. 빈 칸은 채우고, 원문과 다르면 다시 맞춘다' },
  { name: '연료(정제)', note: '★프리패스가 채움 — 가솔린 · 디젤 · 하이브리드 · 전기 · 수소 · LPG. 하나로 모일 때만. 트림이 없어도 세부모델에서 하나로 모이면 채운다' },
  { name: '배기량(정제)', note: '★프리패스가 채움 — 차종마스터 cc. 정확값이 하나로 모일 때만. 1591/1598처럼 갈리면 빈칸(1.6·1600으로 추측하지 않음). 트림이 없어도 세부모델에서 하나로 모이면 채운다' },
  { name: '구동방식', note: '★프리패스가 채움 — 2WD · AWD. 세부모델에서 하나로 모일 때만. 갈리면 빈칸(차명으로 추측하지 않음)' },
  /**
   * ★인승 — 2026-08-22 신설(사장님 「구동 뒤에 인승 넣어줘」).
   *   **정제해서 만드는 값이 아니라 원장에 있는 걸 그대로 옮기는 값이다**(사장님 「인승은 정제가 아니고 있는 거 하는 거니까」).
   *   자리는 구동 뒤 · 차종구분 앞(사장님 2026-08-23).
   *   ⚠ 새 칸은 `add-supplier-ai-columns` 가 **표 맨 뒤에 붙인다** — 제자리로 옮기려면 `move-ai-column --col=… --before=…`.
   *   숫자만 적는다(「5인승」이 아니라 「5」) — 판매시트·ERP 가 그대로 읽는다.
   */
  { name: '인승', note: '★프리패스가 채움 — 숫자만(5 · 7 · 9). 원장에 있는 값을 그대로 옮긴다(새로 정제하지 않는다)' },
  { name: '차종구분', note: '하위호환. 정본은 「차종분류」 한 칸. 판매시트는 차종분류(조합값)를 싣는다' },
  { name: '배터리용량(정제)', note: '★프리패스가 채움 — 차종마스터 kWh. 전기·플러그인만. 값이 하나로 모일 때만. 내연은 빈칸이 정상. 트림이 없어도 세부모델에서 하나로 모이면 채운다' },
  { name: '차종크기', note: '하위호환. 정본은 「차종분류」 한 칸(준대형 세단) + 「차종분류코드」' },
  { name: '차종코드', note: '★프리패스가 채움 — ERP 차종코드(mf-…). 엔카 T가 아님. 모델+세부모델+세부트림 조합의 코드' },
  { name: '선택옵션', note: '★프리패스가 채움 — 공급사 「옵션」 원문을 표기 통일한 값' },
  { name: '차종분류', note: '★프리패스가 채움 — 한 칸. 준대형 세단 · 대형 SUV. 크기+구분을 붙이지 않는다' },
  { name: '차종분류코드', note: '★프리패스가 채움 — vc-01… 차종분류 한 칸의 코드. 판매시트는 이 코드가 가리키는 조합 글자를 싣는다' },
  { name: '차명(정제)', note: '★프리패스가 채움 — 모델+세부모델+세부트림을 겹치지 않게 이은 한 칸. 판매시트 차명이 이걸 싣는다' },
];

const FRONT_COLUMNS: { name: string; note: string; required?: boolean }[] = [
  { name: '차량번호', note: '12가3456. 신차로 번호 전이면 비우고 차대번호를 채운다', required: true },
  /**
   * ★**차대번호(VIN) — 번호 나오기 전 신차의 «진짜 신원»**(사장님 2026-08-21 「실제로 출고 확정되면
   *   차량번호 없이 올린다고 · 차량번호 없이 노출 구현할 수 있을 거 같은데 · 그렇게 해야 해」).
   *   VIN 은 번호판이 나오기 전에도 안 바뀐다. 그래서 실번호가 붙는 날 **같은 차로 이어붙일 수 있다**
   *   (`product.vehicleIdentity` 가 실번호 → VIN → 임시번호 순으로 본다).
   * ⚠ VIN 이 없으면 «행 내용»으로 신차를 알아볼 수밖에 없는데, 그러면 시트에서 셀 하나만 고쳐도
   *   식별이 바뀌어 **같은 차가 계약중 하나·출고가능 하나로 둘이 된다**(트윈 중복판매).
   *   실측 2026-08-21: 21곳 중 차대번호를 쓰는 곳이 0 이라 번호미정 신차가 통째로 안 실리고 있었다.
   */
  { name: '차대번호', note: '신차로 번호 전이면 여기를 채운다(17자리). 번호가 나오면 차량번호에 적고 이 칸은 그대로 둔다' },
  /**
   * ★**상품으로 내놓은 날**이다(사장님 2026-08-12). 차를 산 날도, 등록한 날도 아니다.
   *   이 날로부터 며칠째 안 나가는지가 재고일수다 — 오래 서 있는 차를 찾아내는 유일한 근거라
   *   비면 그 차는 «언제부터 안 팔리는지» 영영 알 수 없다.
   *   최초등록일과 헷갈리면 안 된다. 2020년식 중고차를 이번 달에 상품화하면 입고일자는 이번 달이다.
   */
  /**
   * ★입고일자 = «차량번호가 이 시트에 처음 찍힌 날»(사장님 2026-08-19 — 「공급사 시트에 입고일자는 새로 올라온 날짜야, 얼마나 입력했는지 보려고」).
   *   비어 있으면 프리패스가 자동으로 도장 찍는다(stamp-arrival-dates: 처음 본 날 · 옛 줄은 ERP 최초 등록일로 소급). 공급사가 적은 값은 안 덮는다.
   */
  { name: '입고일자', note: '이 시트에 차량번호가 처음 올라온 날(YYYY-MM-DD). 비워 두면 프리패스가 자동으로 적습니다 — 최초등록일이 아닙니다', required: false },
  /**
   * ★점검사항(사장님 2026-08-19 — 「상태 앞에 칸 만들어 주고 거기에 뭐 좀 해 달라, 차명 제대로 입력해라 이런 걸 쓸 거야 · 요청사항은 아니고 점검사항이라고 하자」).
   *   프리패스가 렌트사에게 적는 칸(보라 머리·값 있으면 노란 바탕). 렌트사는 처리하고 답을 적거나 지운다. 기계는 값을 안 덮는다.
   */
  { name: '점검사항', note: '★프리패스가 적는 점검사항(예: 차명·트림 정확히 적어 주세요 · 보증금 채워 주세요). 처리하시면 답을 적거나 지워 주세요' },
  { name: '상태', note: '즉시출고 / 출고가능 / 상품화중 / 출고협의 / 계약중 / 출고불가', required: true },
  { name: '분류', note: '신차렌트 / 중고렌트 / 신차구독 / 중고구독', required: true },
  /**
   * ⚠ **제조사를 여기서 빼지 마라.** 2026-08-14 에 잠깐 AI 칸으로 올렸다가 꼬리로 옮기면서
   *   원래 자리에 안 되돌렸고, 그 사이 만든 아이카 규격화시트에 이 열이 아예 없었다 —
   *   판매시트 아이카 122대의 제조사·모델이 통째로 빈 채로 나갔다.
   *   정제본은 「제조사(정제)」로 따로 있다. 이 칸은 **공급사가 적는 원문**이다.
   */
  { name: '제조사', note: '현대 · 기아 · BMW …' },
  // ★자유입력이 맞다. 실측(2026-08-08 · 올릴 수 있는 409대) 결과 차종 검수는 6대(1.5%)뿐이고
  //   신뢰도 high 가 376대다. 1,754종 드롭다운을 고르게 하는 건 그 1.5% 를 위해 나머지를
  //   괴롭히는 셈이고, 정작 틀린 6대는 드롭다운으로도 못 고친다 —
  //   「BMW 120i」→인피니티 I30 · 「E200」→크라이슬러 200 처럼 «짧은 수입차 이름» 문제라
  //   매칭 쪽에서 풀어야 한다.
  // 중요한 건 목록이 아니라 **긴 이름**이다. 트림까지 한 칸에 이어 쓰면 세대·사양까지 잡힌다.
  //
  // ★열 이름이 「차명(세부모델+트림)」이어야 한다. 「차명」으로 두면 파서가 그 칸을 **model** 로 보내고,
  //   매처가 짧은 이름으로 모델을 잠가 **엉뚱한 세대**를 고른다 —
  //   「쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션」이 1990년대 「쏘나타 II Y3」로 붙었다(실측).
  //   「차명(세부모델+트림)」은 trim_name 으로 가서 문장 전체를 보고 제대로 잡고, 원문도 추가표기로 남는다.
  //   기존 공급사들이 98.5% 맞는 것도 다들 「모델명(트림)」 열을 쓰기 때문이다.
  { name: '차명(세부모델+트림)', note: '더 뉴 아반떼 CN7 1.6 가솔린 인스퍼레이션 — 트림까지 한 칸에', required: true },
  /**
   * ★**열 차례 — 사장님 2026-08-18 확정**: 「차명 · 옵션 · 외부색상 · 내부색상 · 연식 · 주행거리 · 연료 · 배기량 · 대여료 구간」.
   *   (「각 공급사 이제 진짜로 통일하자 · 웰릭스 기준으로 다 맞추고 · 제발 제발」)
   *   20곳 재고탭을 이 차례로 다시 세웠다(`scripts/unify-supplier-columns.mts`, moveDimension — 값·서식·드롭다운이 열과 함께 움직인다).
   * ⚠ 예전(2026-08-13)엔 표(Table)가 드롭다운 칸까지만 덮이게 하려고 옵션·주행거리를 연료 뒤로 보냈다.
   *   이제 옵션·주행거리가 표 안에 들어오므로 주행거리는 표 안에서 천단위 콤마가 안 붙는다 — 사장님이 열 차례를 우선했다.
   */
  { name: '옵션', note: '선루프, 통풍시트 (쉼표로 구분)' },
  { name: '외부색상', note: '흰색 · 검정 …' },
  { name: '내부색상', note: '' },
  { name: '연식', note: '2024' },
  { name: '주행거리', note: '12000 (km, 숫자만)' },
  { name: '연료', note: '가솔린 · 디젤 · 하이브리드 · 전기 · LPG' },
  { name: '배기량', note: '1998 (cc)' },
  // 소비자가 — 파는 값(대여료)이 아니라 차 자체의 값이다. 그래서 차량정보 쪽에 둔다.
  { name: '차량가격', note: '소비자가(원, 숫자만) — 대여료가 아니다' },
  // ★제조사스펙은 **배기량까지**다(사장님 확정 2026-08-11).
  //   인승·구동은 물어보지 않는다 — 차명(세부모델+트림)이 정해지면 차종마스터가 아는 값이고,
  //   공급사에게 한 칸 더 채우게 하는 값어치가 없다. 카니발 9인승 같은 구분도
  //   「차명(세부모델+트림)」에 이미 들어온다.
];

/**
 * 뒷줄 — 요금 다음에 오는 부가정보와 정책.
 * ⚠ 여기 열 이름에 「N개월」 꼴을 쓰면 안 된다 — 파서가 기간 요금 열로 읽어
 *   장기보증 블록에 붙어 버린다.
 */
/**
 * 뒷줄은 **최초등록일·사진링크 둘뿐**이다(사장님 확정 2026-08-11).
 *
 * ★뺀 것과 간 곳
 *   「1만km증액」 → 정책탭 「추가주행 금액」. 같은 값을 두 군데서 받으면 어느 쪽이 맞는지 모른다.
 *   「비고」·「차대번호」 → 안 받는다. 공급사 시트는 제조사스펙과 대여조건만 받는다.
 *     ⚠ 차대번호가 없으면 번호판 나오기 전 신차는 **행 내용으로** 식별한다(임시번호 allocator).
 *       셀 하나만 고쳐도 다른 차로 보이므로, 신차 선출고를 시트로 돌리는 공급사가 생기면
 *       그때 그 공급사에만 칸을 되살린다.
 */
const DETAIL_COLUMNS: { name: string; note: string; required?: boolean }[] = [
  { name: '최초등록일', note: '2024-03-15' },
  { name: '사진링크', note: '드라이브 폴더 또는 이미지 URL — 비면 카탈로그에 사진이 안 붙는다' },
];

/**
 * 기간 표준 — **1 · 12 · 24 · 36 · 48 · 60개월**(2026-08-08 확정 · 2026-08-18 20곳 실측 재확인).
 * 단기보증이 1·12를, 장기보증이 24~60을 관할한다. 파서의 보증 블록 스코프에 맞춘 배치라
 * 순서를 바꾸면 보증금이 엉뚱한 기간에 붙는다.
 * ⚠ 상품마스터의 10기간(1·6·12·18·24·36·48·60·72·84 — `product-master-sheet.PRODUCT_MASTER_PERIODS`)과 다르다.
 *   한때(2026-08-15) 여기까지 10기간으로 넓혔더니 코드 표준(32열)과 살아 있는 20곳 시트(28열)가 갈렸고,
 *   「작성 안내」에 없는 칸이 실렸다. 제공시트 표준은 6기간 + 예비 3칸이다 — 다른 기간은 예비칸 제목을 바꿔 쓴다.
 */
export const SHORT_PERIODS = ['1', '12'] as const;
export const LONG_PERIODS = ['24', '36', '48', '60'] as const;
/** 표준 밖 기간을 렌트사가 직접 적는 여백. 제목을 바꿔 쓰는 칸이라 값이 아니라 «이름»이 자리표시다. */
export const FREE_PERIOD_SLOTS = ['기타기간①', '기타기간②', '기타기간③'] as const;

/** price 키 → 열 이름. `24` → 「24개월」 · `24_2만` → 「24개월2만」(파서가 되읽을 수 있는 표기). */
export const periodColumnName = (key: string) => {
  const [months, km] = key.split('_');
  return `${months}개월${km || ''}`;
};

/**
 * 기간 열의 «주행 기준»을 사람이 읽을 말로.
 *
 * 기간마다 약정주행이 다른 공급사가 있다 — 오토플러스는 12개월만 3만km 기준이고
 * 18·24·36개월은 2만/3만이 따로 있다. 열 이름만으로는 「12개월」이 무슨 주행인지 알 수 없어
 * 영업이 손님에게 잘못 말한다. 헤더 셀 메모로 붙여 둔다(행을 안 먹는다).
 */
export const periodColumnNote = (key: string): string => {
  const [months, km] = key.split('_');
  if (!km) return '월 대여료(원, 숫자만)';
  return `${months}개월 · 약정주행 연 ${km}km 기준 · 월 대여료(원, 숫자만)`;
};

/**
 * 기간 열을 만든다. 표준 10종은 늘 두고, **같은 기간의 주행거리·인수형 변형만** 덧붙인다.
 *
 * 왜 덧붙이나 — 오토플러스는 18개월과 주행 변형(24개월2만·24개월3만)을 쓴다(179대, 실측).
 * 표준 6종에만 우겨넣으면 같은 개월에서 하나만 남고 나머지 요금이 조용히 사라진다.
 * 표준은 «이름과 순서»를 정하는 것이지 있는 값을 버리라는 뜻이 아니다.
 */
export function buildPeriodColumns(usedKeys: string[] = []): { name: string; note: string; required?: boolean }[] {
  const monthOf = (k: string) => Number(k.split('_')[0]) || 0;
  const extra = usedKeys.filter((k) => !SHORT_PERIODS.includes(k as never) && !LONG_PERIODS.includes(k as never));
  const short = [...SHORT_PERIODS, ...extra.filter((k) => monthOf(k) < 24)];
  const long = [...LONG_PERIODS, ...extra.filter((k) => monthOf(k) >= 24)];
  const sortKeys = (ks: string[]) => [...new Set(ks)].sort((a, b) => monthOf(a) - monthOf(b) || a.localeCompare(b));
  return [
    { name: '단기보증', note: '보증금(원). 오른쪽 단기 기간을 관할한다', required: true },
    ...sortKeys(short).map((k) => ({ name: periodColumnName(k), note: periodColumnNote(k) })),
    { name: '장기보증', note: '보증금(원). 오른쪽 장기 기간을 관할한다', required: true },
    ...sortKeys(long).map((k) => ({ name: periodColumnName(k), note: periodColumnNote(k) })),
    // 표준 밖 기간을 파는 렌트사를 위한 여백 3칸.
    // 파서는 **헤더 이름**으로 기간을 잡으므로(`\d+개월` + 선택적 `N만`), 렌트사가 이 칸의
    // «제목»을 「18개월」·「24개월2만」 으로 바꿔 쓰면 그대로 연동된다. 비워 두면 무시된다 —
    // 「기타기간①」 은 어느 패턴에도 안 걸리므로 안전한 자리표시다.
    ...FREE_PERIOD_SLOTS.map((name, i) => ({
      name,
      note: i === 0 ? '다른 기간을 팔면 이 칸의 «제목»을 18개월 처럼 바꿔 쓰세요 (보증금은 장기보증 적용)' : '',
    })),
  ];
}

/**
 * 기본 표준 열 — 기간은 표준 6종만. 공급사별 확장은 `buildColumns` 를 쓴다.
 * ★정책 칸은 **가리키는 칸 하나뿐**이다. 내용은 「정책」 탭이 정의한다 —
 *   같은 조건을 차마다 22칸씩 되풀이하면 한 곳만 고쳐도 나머지가 어긋난다.
 * ⚠ **이 칸을 빼지 마라.** 없으면 `supplier-policy-read.policyFor` 가 «프리패스 기본»으로
 *   떨어져 그 공급사 전 차량의 면책금·추가주행 금액이 실제 계약이 아닌 기본값으로 선다.
 *   2026-08-14 에 잠깐 뺐다가 되돌렸다.
 */
const POLICY_REF_COLUMN: { name: string; note: string; required?: boolean } = {
  name: '정책코드', note: 'POL-0047 — 「정책」 탭에서 그 코드의 조건을 정의한다. 프리패스가 채운다',
};
/**
 * ★**구분선 열** — 사장님 2026-08-18 「정책코드를 차종코드 앞으로 옮겨 주고, 정책코드 앞에 한 줄 넣어서 여기는 손대는 거 아닌 느낌 — 전체 통일」.
 *   이 열 오른쪽(정책코드 · 차종트림코드 · 차종마스터코드 · 정제칸)은 전부 프리패스/AI 칸이다. 이름은 「│」 하나, 값은 없다, 폭 6px, 어두운 색.
 *   읽는 도구는 전부 이름으로 읽으므로 이 열을 무시한다(별칭 없음). 안내 탭에서는 목록에 안 싣는다(`divider`).
 */
export const DIVIDER_COLUMN: { name: string; note: string; required?: boolean; divider: true } = {
  name: '│', note: '여기부터 오른쪽은 프리패스가 채우는 칸입니다 — 손대지 마세요', divider: true,
};
export const isDividerColumn = (name: unknown) => String(name ?? '').trim() === DIVIDER_COLUMN.name;

/** 표준 차례 — 렌트사 칸(차량번호 … 사진링크) │ 정책코드 · 차종트림코드 · 차종마스터코드 · 정제칸. */
export const REQUEST_COLUMN_NAME = '점검사항';
/** 처음 이름(2026-08-19 잠깐 「요청사항」이었다 → 사장님 「요청사항은 아니고 점검사항이라고 하자」). insert-request-column 이 머리글을 갈아 준다. */
export const REQUEST_COLUMN_OLD_NAMES = ['요청사항'];
export const TEMPLATE_COLUMNS = [...FRONT_COLUMNS, ...buildPeriodColumns(), ...DETAIL_COLUMNS, DIVIDER_COLUMN, POLICY_REF_COLUMN];

/**
 * ★★**칸마다 «누가 정본인가»** — 공급사 시트에서 우리 시트로 따라올 것과 안 따라올 것.
 *
 *   사장님 2026-08-15 —
 *     ① 공급사에서 제공하는 시트를 학습해서 **우리만의 시트로 변환한다**
 *     ② 공급사시트에서는 **배차상태만** 확인해서 우리 시트와 차량상태를 맞춘다
 *     ③ **대여료 변동**이 있다면 그 변동에 따라 변경한다
 *
 *   즉 **우리 시트가 기록**이고, 공급사에서 매번 따라가는 것은 «살아 움직이는 값»뿐이다.
 *   예전엔 반대였다 — 우리 칸(정제칸·정책코드)만 지키고 **나머지 전부를 매번 공급사가 덮었다.**
 *   그래서 한 번 정리해 둔 차명·색·연식이 다음 동기화에 원문으로 되돌아갔다.
 *
 * ⚠ 「살아 움직이는 값」의 기준은 **그 차를 팔 수 있는가·얼마인가**가 바뀌는 것이다.
 *   주행거리는 실제로 늘고, 보증금은 대여료와 함께 움직인다 — 그래서 따라간다.
 *   차종·색·연식·차대번호는 안 바뀐다 — 한 번 정리하면 우리 것이다.
 */
export type ColumnOwner = 'live' | 'ours' | 'once';

/**
 * 매번 공급사를 따라간다 — **상태와 대여료값뿐이다**(사장님 2026-08-15 —
 * 「상태랑 대여료값만 확인할거고」).
 * ⚠ 주행거리는 여기 없다 — 세워 둔 차는 주행거리가 안 변하고, 나가면 상태가 바뀐다.
 *   처음 한 번 옮긴 값이 그 차의 기록이다(once).
 * ★보증금(단기·장기)은 대여료와 **한 벌로 움직이는 값**이라 대여료값에 넣었다.
 */
const LIVE_COLUMNS = [
  '상태', '배차상태', '판매상태', '차량상태',
  '단기보증', '장기보증', '보증금',
  '1개월', '6개월', '12개월', '18개월', '24개월',
  '36개월', '48개월', '60개월', '72개월', '84개월',
];

/**
 * 어느 칸이 누구 것인가.
 *  · live — 매번 공급사 값으로 갱신한다(상태·기간별 대여료·보증금)
 *  · ours — 우리가 정한다. 공급사가 못 덮는다(정책코드 · 엔카 코드 2 · 정제칸)
 *  · once — 처음 한 번 옮겨 오고 그 뒤로는 우리 것이다(색·연식·차량가격 …). 제공시트 기준.
 *    정제시트의 차명(세부모델+트림)·옵션은 `MIRROR_FOLLOW_SOURCE` 가 덮어 **원본을 매번 따른다**.
 * ⚠ 기간 대여료는 「기타기간①」처럼 제목을 바꿔 쓰는 칸도 있어 **이름에 «개월»이 들어가면 live** 로 본다.
 */
export function columnOwner(name: unknown): ColumnOwner {
  const n = String(name ?? '').replace(/\s+/g, '');
  if (!n) return 'once';
  if (AI_TAIL_COLUMNS.some((c) => c.name.replace(/\s+/g, '') === n)) return 'ours';
  if (n === POLICY_REF_COLUMN.name.replace(/\s+/g, '')) return 'ours';
  if (n === DIVIDER_COLUMN.name) return 'ours';   // 구분선 — 누구도 값을 안 쓴다
  if (n === REQUEST_COLUMN_NAME) return 'ours';   // 요청사항 — 프리패스가 적는 칸(2026-08-19)
  if (LIVE_COLUMNS.some((c) => c.replace(/\s+/g, '') === n)) return 'live';
  if (/개월/.test(n)) return 'live';          // 기간 대여료 — 기타기간 제목 변경까지 포함
  return 'once';
}

/**
 * 구독 기간 표준 — **12 · 24 · 36 · 48 · 60개월**. 구독에는 단기(1개월)가 없다.
 *
 * ★구독은 요금표가 **두 벌**이다 — 인수형(끝나면 산다)·반납형(끝나면 돌려준다).
 *   한 벌로 접으면 둘 중 하나가 사라진다. 그래서 블록을 나란히 둔다.
 * ★**인수형이 왼쪽, 반납형이 오른쪽**이어야 한다. 같은 기간이 두 블록에 있으면
 *   파서는 «값이 있는 마지막 블록»을 쓰고(`parsePriceColumns`), 실제로 게시하는 건 반납형이다
 *   (실측 375어8056: 종합시트 12개월 907,000 = 개별시트 반납형 값). 순서를 뒤집으면 게시가가 바뀐다.
 * ★열 이름은 **「12개월 인수형」** 꼴이어야 한다 — 파서가 기간을 `^(\d+)개월` 로 잡는다.
 *   「인수형 12개월」로 쓰면 한 칸도 안 읽힌다.
 * ★보증금 열은 자기 **오른쪽** 기간들을 관할한다(블록 스코프). 그래서 각 블록 맨 앞에 둔다.
 */
export const SUBSCRIPTION_PERIODS = ['12', '24', '36', '48', '60'] as const;
export const SUBSCRIPTION_FORMS = [
  { suffix: '인수형', deposit: '보증금 인수형', note: '인수형 — 약정이 끝나면 차를 인수한다' },
  { suffix: '반납형', deposit: '보증금 반납형', note: '반납형 — 약정이 끝나면 차를 반납한다' },
] as const;

export function buildSubscriptionPeriodColumns(usedKeys: string[] = []): { name: string; note: string; required?: boolean }[] {
  const monthOf = (k: string) => Number(k.split('_')[0]) || 0;
  const extra = usedKeys.filter((k) => !SUBSCRIPTION_PERIODS.includes(k as never) && monthOf(k) > 0);
  const periods = [...new Set([...SUBSCRIPTION_PERIODS, ...extra])].sort((a, b) => monthOf(a) - monthOf(b) || a.localeCompare(b));
  return [
    ...SUBSCRIPTION_FORMS.flatMap((form) => [
      { name: form.deposit, note: `${form.note} · 보증금(원). 오른쪽 기간을 관할한다. 「연수×대여료」처럼 규칙을 적어도 된다`, required: true },
      ...periods.map((k) => ({ name: `${periodColumnName(k)} ${form.suffix}`, note: `${form.note} · ${periodColumnNote(k)}` })),
    ]),
    // 표준 밖 기간을 파는 곳을 위한 여백. 맨 오른쪽이라 반납형 보증금이 관할한다.
    ...FREE_PERIOD_SLOTS.map((name, i) => ({
      name,
      note: i === 0 ? '다른 기간을 팔면 이 칸의 «제목»을 「18개월 반납형」 처럼 바꿔 쓰세요' : '',
    })),
  ];
}

/**
 * **재고 탭 이름들.** 기본은 「재고」 한 장이고, 렌트·구독을 같이 파는 곳은 두 장으로 가른다
 * (손오공 2026-08-12 — 상품이 다르면 표도 달라야 한다).
 *
 * ⚠ 우리 시트를 훑는 스크립트는 **이 목록으로** 탭을 찾아야 한다. 「재고」를 코드에 박으면
 *   나눈 공급사를 조용히 건너뛴다 — 사진 연결·빈칸 채우기·개수 세기가 전부 0이 된다.
 */
/**
 * **우리가 만들어 나눠 주는 시트의 이름** — 「<공급사> 프리패스 재고」.
 *
 * ★공급사 이름이 **앞**에 와야 한다(사장님 2026-08-12 — 「브라우저에서 안보이네」).
 *   브라우저 탭은 앞글자만 보여준다. 「프리패스 재고 · 손오공」이면 열 장을 띄워도
 *   전부 「프리패스 재고…」로 보여 어느 업체 시트인지 구분이 안 된다.
 * ⚠ 옛 이름(「프리패스 재고 · 손오공」)도 계속 읽어야 한다 — 한 번에 다 바뀌지 않는다.
 *   찾을 때는 `SHEET_NAME_MATCH`(=「프리패스 재고」 포함)로 걸러 두 형태를 다 잡는다.
 */
export const SHEET_NAME_MATCH = '프리패스 재고';
/**
 * ★시트 이름 규격(사장님 2026-08-18 — 「우리가 제공한 시트랑 정제된 시트 표기 좀 해주고, 언제 배포한 시트인지 앞에 날짜 좀 박자 0818 이렇게」)
 *   「MMDD 공급사 프리패스 재고 [제공]」 — 우리가 만들어 준 시트에 공급사가 직접 적는 곳(= 그 시트가 원본이자 정제시트)
 *   「MMDD 공급사 프리패스 재고 [정제]」 — 공급사 자체 시트·홈페이지를 우리가 옮겨 담는 정제시트(mirror-sources)
 *   날짜 = 배포일(제공: 시트를 만든 날 · 정제: 정제시트로 전환한 날). 검색은 여전히 「프리패스 재고」 부분일치.
 */
export type SupplierSheetKind = '제공' | '정제';
export const SHEET_KIND_MARK: Record<SupplierSheetKind, string> = { 제공: '[제공]', 정제: '[정제]' };
/**
 * ★상태 표식(사장님 2026-08-19 — 「현재 쓰고 있는 시트를 알아볼 수 있게 표기해줘 … 연동중 이런식으로,
 *   구버전 우리 거는 폐기 또는 구버전이라고 안 쓴다고 해 주고, 외부시트는 원본만 알면 되고」)
 *   「MMDD 공급사 프리패스 재고 [제공] [연동중]」 — 지금 문패·발행기·상품마스터·ERP 가 읽는 시트(21곳 전부).
 *   옛 우리 시트는 「[구버전·폐기] 원래이름」(앞에 붙인다 — 첫눈에 보이게, 「프리패스 재고」 글자는 넣지 않는다 → 검색에 안 잡힌다).
 *   외부(공급사 소유) 원본 시트는 이름을 건드리지 않는다 — 원본 주소는 mirror-sources 표·「이 시트는」 탭·시트 명부에.
 */
export type SupplierSheetStatus = '연동중';
export const SHEET_STATUS_MARK: Record<SupplierSheetStatus, string> = { 연동중: '[연동중]' };
export const LEGACY_SHEET_PREFIX = '[구버전·폐기] ';
export const supplierSheetName = (label: string, opts: { kind?: SupplierSheetKind; date?: string; status?: SupplierSheetStatus | '' } = {}) => {
  const date = String(opts.date ?? '').trim();
  const kind = opts.kind ? ` ${SHEET_KIND_MARK[opts.kind]}` : '';
  const status = opts.status ? ` ${SHEET_STATUS_MARK[opts.status]}` : '';
  return `${date ? `${date} ` : ''}${String(label ?? '').trim()} ${SHEET_NAME_MATCH}${kind}${status}`;
};
/** 「0818 아이카 프리패스 재고 [정제] [연동중]」 → 「아이카」. 옛 이름(「프리패스 재고 · 아이카」·「아이카 프리패스 재고」)도 같은 답. */
export const supplierSheetLabel = (name: string) => String(name ?? '')
  .replace(`${SHEET_NAME_MATCH} · `, '')          // 옛 이름
  .replace(/\s*[\[(（](제공|정제|연동중)[\])）]\s*/g, ' ')  // 종류·상태 표식
  .replace(new RegExp(`\s*${SHEET_NAME_MATCH}\s*`), ' ')   // 규격 이름
  .replace(/^\s*\d{4}\s+/, '')                     // 앞 날짜(MMDD)
  .replace(/^\s*\d{4}(?=\S)/, '')                  // 「0818아이카」처럼 붙여 쓴 날짜
  .trim();
/** 이름에서 종류·날짜·상태를 읽는다(없으면 빈값). */
export const supplierSheetNameParts = (name: string): { date: string; label: string; kind: SupplierSheetKind | ''; status: SupplierSheetStatus | '' } => {
  const n = String(name ?? '');
  const date = (/^\s*(\d{4})\s*/.exec(n) || [])[1] || '';
  const kind = (/[\[(（](제공|정제)[\])）]/.exec(n) || [])[1] as SupplierSheetKind | undefined;
  const status = (/[\[(（](연동중)[\])）]/.exec(n) || [])[1] as SupplierSheetStatus | undefined;
  return { date, label: supplierSheetLabel(n), kind: kind || '', status: status || '' };
};

export const VEHICLE_TABS = ['재고', '렌트재고', '구독재고', '픽업재고'] as const;
/**
 * 재고 탭인가.
 *
 * ★한 문서에서 **법인별로 재고를 나눠** 쓰기 시작했다(사장님 2026-08-20) —
 *   스타 문서의 「스타재고 · 스카이재고」, 경진 문서의 「경진카재고 · 경진렌트재고」.
 *   그래서 이름을 못박지 않고 **「…재고」로 끝나면 재고 탭**으로 본다.
 *   「재고 작성 안내」처럼 뒤에 말이 더 붙는 탭은 걸리지 않는다(끝에 붙어야 한다).
 */
export const isVehicleTab = (title: string) => /재고$/.test(String(title ?? '').trim());

/** 구독 전용 열 구성 — 렌트와 다른 표다. 단기 없음 · 인수형/반납형 두 벌. */
export const buildSubscriptionColumns = (usedKeys: string[] = []) => [
  ...FRONT_COLUMNS,
  ...buildSubscriptionPeriodColumns(usedKeys),
  POLICY_REF_COLUMN,
  ...DETAIL_COLUMNS,
];

/**
 * 공급사가 실제로 쓰는 기간과 취급 상품을 반영한 열 구성.
 *
 * `hasNewCars` 는 그 공급사가 신차(신차렌트·신차구독)를 파는가다 — 차대번호 칸은
 * 그럴 때만 붙는다. 중고만 파는 곳에 붙이면 영영 빈 칸이 하나 는다.
 */
export const buildColumns = (usedKeys: string[] = []) => [
  ...FRONT_COLUMNS,
  ...buildPeriodColumns(usedKeys),
  POLICY_REF_COLUMN,
  ...DETAIL_COLUMNS,
];


export const ROW_HEADER = 0;          // 0행 헤더 — 바로 아래가 상품이다

export const ROW_DATA = 1;            // 1행부터 상품

/**
 * 값이 정해진 열 → 드롭다운. 오타 하나가 매물 유실이라 입력에서 막는다.
 *
 * ★목록을 여기에 베껴 적지 않는다. ERP 상수를 그대로 끌어 쓴다 —
 *   베껴 두면 ERP 만 바뀌었을 때 시트가 옛 어휘를 계속 권하고, 그 차이는 아무도 못 본다.
 *   제조사는 차종마스터가 정본이라 `buildColumns` 를 부르는 쪽에서 넣어 준다.
 */
export const VALUE_LISTS: Record<string, readonly string[]> = {
  // ★ERP 상태 **여섯 그대로**다(사장님 확정 2026-08-11). 공급사가 쓰는 말과 ERP 가 같아야 한다.
  //   「계약중」을 넣어도 안전한 이유 — 계약금이 들어와 엔진이 잠근 차는
  //   `softMergeProduct` 가 시트의 상태값을 아예 안 받는다(`engineLocked` 이면 건너뛴다).
  //   즉 공급사가 잠긴 차를 「출고가능」으로 되돌려도 잠금이 풀리지 않는다.
  상태: VEHICLE_STATES,
  분류: PRODUCT_TYPES,
  연료: FUEL_TYPES,
  외부색상: EXT_COLORS,
  내부색상: INT_COLORS,
};

/**
 * 연식 — 올해+1(선출고 신차) 부터 **10년 전까지**.
 * 렌터카로 도는 차가 그 안이다. 목록이 길면 고르기만 힘들고, 더 오래된 차는 손으로 치면 된다
 * (`strict: false` 라 목록 밖 값도 들어간다). 손으로 적으면 해가 바뀔 때 낡으므로 계산한다.
 */
export function yearOptions(thisYear: number): string[] {
  return Array.from({ length: 12 }, (_, i) => String(thisYear + 1 - i));
}

/**
 * 시트에 올릴 값 표 — **첫 줄이 헤더, 둘째 줄부터 상품**이다.
 * 안내문을 행으로 두지 않는다. 행이면 사람이 지우다 헤더까지 건드리고, 파서도 한 줄을
 * 매물로 볼 뻔한다. 설명은 헤더 «셀 메모»로 붙인다(buildTemplateFormat).
 */
export function buildTemplateValues(columns = TEMPLATE_COLUMNS): string[][] {
  return [columns.map((c) => c.name)];
}

type Rec = Record<string, unknown>;
const grid = (gid: number, r0: number, r1: number, c0: number, c1: number) =>
  ({ sheetId: gid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });

/**
 * ★머리행 색으로 «누가 적는 칸인가»를 가른다(사장님 2026-08-18 — 「렌트사가 입력하는 줄과 자동으로 입력되는 줄(AI가) 테이블 헤더 색깔 구분」).
 *   · 렌트사가 적는 칸(차량번호~사진링크) = 남색(기본)
 *   · 프리패스/AI 가 적는 칸(정책코드 · 차종트림코드 · 차종마스터코드 · 정제칸) = **보라** — `columnOwner === 'ours'` 와 같은 기준이라 표와 규칙이 안 갈린다.
 */
export const HEADER_OURS_COLOR = { red: 0.36, green: 0.25, blue: 0.55 };
/** 구분선 열 — 머리부터 아래까지 어두운 보라 한 줄(폭 6px). 값 없음. */
export function buildDividerFormat(gid: number, columns: { name: string }[], rowCount = 500): Rec[] {
  const out: Rec[] = [];
  columns.forEach((c, i) => {
    if (!isDividerColumn(c.name)) return;
    out.push({ repeatCell: { range: grid(gid, ROW_HEADER, rowCount, i, i + 1), cell: { userEnteredFormat: { backgroundColor: HEADER_OURS_COLOR, textFormat: { foregroundColor: HEADER_OURS_COLOR, fontSize: 4 } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
    out.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: 6 }, fields: 'pixelSize' } });
  });
  return out;
}
export function buildHeaderOwnerColors(gid: number, columns: { name: string }[]): Rec[] {
  const out: Rec[] = [];
  columns.forEach((c, i) => {
    if (columnOwner(c.name) !== 'ours') return;
    out.push({ repeatCell: {
      range: grid(gid, ROW_HEADER, ROW_HEADER + 1, i, i + 1),
      cell: { userEnteredFormat: { backgroundColor: HEADER_OURS_COLOR } },
      fields: 'userEnteredFormat.backgroundColor',
    } });
  });
  return out;
}

/**
 * 서식 — 「채우는 칸」과 「읽는 칸」이 한눈에 갈려야 렌트사가 헤맬 일이 없다.
 *   정책 라벨=진회색 배경 · 값칸=노랑(여기 쓰라는 뜻) · 헤더=남색 고정 · 필수열=연빨강 헤더 · 예시행=회색 이탤릭.
 */
export function buildTemplateFormat(
  gid: number,
  columns = TEMPLATE_COLUMNS,
  extra: Record<string, readonly string[]> = {},
  /** 표(Table)로 만들 예정이면 개별 데이터확인은 걸지 않는다 —
   *  표의 열 타입이 그걸 소유해서 「typed columns 에는 허용되지 않는다」로 거부된다. */
  opts: { asTable?: boolean } = {},
): Rec[] {
  const width = columns.length;
  const out: Rec[] = [];

  // 헤더 — 남색 바탕 흰 글씨. 필수 열만 밝은 글씨로 구분한다.
  out.push({
    repeatCell: {
      range: grid(gid, ROW_HEADER, ROW_HEADER + 1, 0, width),
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.13, green: 0.20, blue: 0.33 },
          textFormat: { bold: true, fontSize: 10, fontFamily: FONT, foregroundColor: { red: 1, green: 1, blue: 1 } },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });
  out.push(...buildHeaderOwnerColors(gid, columns));
  out.push(...buildDividerFormat(gid, columns));
  for (const [i, c] of columns.entries()) {
    // 보증금 열 제목은 한 톤 죽여 대여료 열이 앞으로 나오게 한다.
    if (/보증/.test(c.name)) {
      out.push({
        repeatCell: {
          range: grid(gid, ROW_HEADER, ROW_HEADER + 1, i, i + 1),
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, fontFamily: FONT, foregroundColor: { red: 0.78, green: 0.82, blue: 0.88 } } } },
          fields: 'userEnteredFormat.textFormat',
        },
      });
    }
    if (c.required) {
      out.push({
        repeatCell: {
          range: grid(gid, ROW_HEADER, ROW_HEADER + 1, i, i + 1),
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, fontFamily: FONT, foregroundColor: { red: 1, green: 0.80, blue: 0.55 } } } },
          fields: 'userEnteredFormat.textFormat',
        },
      });
    }
    // 설명은 «셀 메모»로. 행을 안 먹고, 마우스만 올리면 보인다.
    if (c.note) {
      out.push({
        repeatCell: {
          range: grid(gid, ROW_HEADER, ROW_HEADER + 1, i, i + 1),
          cell: { note: c.note }, fields: 'note',
        },
      });
    }
  }

  out.push({
    updateSheetProperties: {
      properties: { sheetId: gid, gridProperties: { frozenRowCount: ROW_HEADER + 1, frozenColumnCount: 1 } },
      fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    },
  });
  // ★기본 필터를 걸지 않는다. 표(Table)로 바꿀 때 «겹치는 필터가 있으면» 변환이 거부된다
  //   ("please remove the filter that overlaps with the conversion area", 실측 2026-08-08).
  //   표는 열 이름 필터를 스스로 제공하므로 잃는 것도 없다.

  // 값이 정해진 열 → 드롭다운. 오타 하나가 매물 유실이 된다.
  for (const [name, values] of Object.entries(opts.asTable ? {} : { ...VALUE_LISTS, ...extra })) {
    if (!values?.length) continue;
    const c = columns.findIndex((x) => x.name === name);
    if (c < 0) continue;
    out.push({
      setDataValidation: {
        range: grid(gid, ROW_DATA, 500, c, c + 1),
        rule: {
          condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
          showCustomUi: true, strict: false,
        },
      },
    });
  }

  /**
   * ★열 너비는 **칸마다** 정한다. 110 균일로 두면 차명·옵션이 뭉개지고
   *   연식·연료는 남아돈다(사장님 지적 2026-08-11).
   */
  for (const [i, c] of columns.entries()) {
    out.push({
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: columnWidth(c.name) }, fields: 'pixelSize',
      },
    });
  }
  return out;
}

/**
 * 행 높이 — 기본 21px 은 붙어 보여 답답하다(사장님 지적 2026-08-11).
 * 머리행은 조금 더 세워 표 위쪽이 눌리지 않게 한다.
 */
export function buildRowHeights(gid: number, rowCount = 500): Rec[] {
  return [
    {
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'ROWS', startIndex: ROW_HEADER, endIndex: ROW_HEADER + 1 },
        properties: { pixelSize: 34 }, fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'ROWS', startIndex: ROW_DATA, endIndex: rowCount },
        properties: { pixelSize: 28 }, fields: 'pixelSize',
      },
    },
  ];
}

/**
 * 줄무늬(교차 배경) — 표(Table)를 걷어내면서 같이 사라진 것을 우리가 되살린다.
 *
 * 행이 200줄 넘어가면 줄무늬 없이는 눈이 옆줄로 샌다. 표가 주던 것과 같은 톤으로 둔다.
 */
export function buildBanding(gid: number, columnCount: number, rowCount = 500, startColumn = 0): Rec[] {
  return [{
    addBanding: {
      bandedRange: {
        range: grid(gid, ROW_HEADER, rowCount, startColumn, columnCount),
        rowProperties: {
          headerColorStyle: { rgbColor: { red: 0.13, green: 0.20, blue: 0.33 } },
          firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
          secondBandColorStyle: { rgbColor: { red: 0.97, green: 0.97, blue: 0.98 } },
        },
      },
    },
  }];
}

/**
 * **한 판 전체에 같은 글꼴**을 건다.
 *
 * 표(Table)를 쓰면 표가 덮은 칸만 Roboto 가 되고 금액 칸은 기본 글꼴로 남아
 * 같은 시트인데 두 문서처럼 보인다(사장님 지적 2026-08-11). 표를 걷어냈으므로
 * 우리가 직접 전 구간에 건다.
 */
export function buildBaseFont(gid: number, columnCount: number, rowCount = 500): Rec[] {
  return [{
    repeatCell: {
      range: grid(gid, 0, rowCount, 0, columnCount),
      cell: { userEnteredFormat: { textFormat: { fontSize: 10, fontFamily: FONT }, verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(textFormat,verticalAlignment)',
    },
  }];
}

/** 칸마다 필요한 만큼. 긴 글이 들어오는 칸만 넓히고 나머지는 좁혀 한 화면에 더 담는다. */
export function columnWidth(name: string): number {
  if (isDividerColumn(name)) return 6;
  if (name === '차명(세부모델+트림)') return 300;
  if (name === '옵션') return 240;
  if (name === '사진링크') return 200;
  if (/보증|개월/.test(name)) return 100;
  if (/^기타기간/.test(name)) return 100;
  // 날짜 칸은 같은 너비로 — 「2026-08-12」가 안 잘리는 최소치다. 입고일자와 최초등록일은 같은 꼴이다.
  if (name === '차량번호' || name === '정책코드' || name === '최초등록일' || name === '입고일자') return 104;
  if (name === ENCAR_MODEL_KEY_COLUMN || name === ENCAR_SUB_KEY_COLUMN || name === ENCAR_TRIM_KEY_COLUMN) return 110;
  if (name === '원산지' || name === '구동방식' || name === '차종크기' || name === '차종구분' || name === '차종분류코드') return 100;
  if (name === '차종분류') return 140;
  if (name === '차명(정제)') return 280;
  if (name === '모델' || name === '세부모델') return 160;
  if (name === '세부트림') return 140;
  /**
   * ★칩(드롭다운) 칸 — **가장 긴 값이 잘리지 않을 만큼만**(사장님 확정 2026-08-11).
   *   칩 여백과 화살표가 자리를 먹으므로 글자수만으로는 모자란다. 실측으로 잡은 값이다.
   *   상태·분류·제조사는 가장 긴 값이 4자(즉시출고·신차렌트·제네시스), 연료만 5자(하이브리드).
   */
  if (name === '제조사' || name === '상태' || name === '분류') return 112;
  if (name === '주행거리' || name === '배기량') return 88;
  if (name === '차량가격') return 108;
  if (/색상$/.test(name)) return 104;
  if (name === '연료') return 124;   // 「하이브리드」 5자
  if (name === '연식') return 92;
  return 100;
}

/**
 * **값마다 색을 달리한다** — 상태·분류·제조사.
 *
 * 표(Table)의 드롭다운 칩은 API 로 색을 못 준다. 조건부서식으로 칸 배경을 칠하면
 * 칩에도 그 색이 실린다. 상태 색은 ERP 화면과 같은 뜻으로 맞춘다(`VEHICLE_STATUS_TONES`) —
 * 시트에서 빨강인 차가 ERP 에서 초록이면 아무도 안 믿는다.
 */
const TONE: Record<string, { fg: [number, number, number] }> = {
  green: { fg: [0.09, 0.45, 0.20] },
  blue: { fg: [0.11, 0.31, 0.60] },
  amber: { fg: [0.60, 0.42, 0.03] },
  orange: { fg: [0.66, 0.33, 0.04] },
  red: { fg: [0.70, 0.12, 0.12] },
  gray: { fg: [0.28, 0.30, 0.34] },
  violet: { fg: [0.42, 0.24, 0.70] },
  teal: { fg: [0.05, 0.44, 0.42] },
  magenta: { fg: [0.72, 0.10, 0.55] },
};

/** 상태 → ERP 와 같은 뜻의 색. */
const STATUS_TONE: Record<string, keyof typeof TONE> = {
  즉시출고: 'green', 출고가능: 'green', 상품화중: 'amber', 출고협의: 'blue', 계약중: 'orange', 출고불가: 'red',
};
/**
 * 연료 여섯 — 기름·전기가 눈에 바로 갈리게(사장님 요청 2026-08-11).
 * 화석연료는 따뜻한 색, 전동화는 찬 색으로 묶는다.
 */
const FUEL_TONE: Record<string, keyof typeof TONE> = {
  가솔린: 'red', 디젤: 'gray', LPG: 'amber', 하이브리드: 'teal', 전기: 'blue', 수소: 'violet',
};
/**
 * 색상 — **그 색으로 쓴다**(사장님 요청 2026-08-11). 「블루」가 파랗게 보이면 읽지 않아도 안다.
 * ⚠ 화이트·베이지·민트처럼 옅은 색은 흰 바탕에서 안 보인다 — 읽을 수 있을 만큼 눌러서 쓴다.
 *   여기 값은 «그 색의 이름»이 아니라 «그 색을 흰 바탕에서 읽히게 만든 값»이다.
 */
const COLOR_INK: Record<string, [number, number, number]> = {
  화이트: [0.45, 0.47, 0.52],   // 흰 글자는 안 보인다 — 회색으로 눌러 쓴다
  블랙: [0.10, 0.11, 0.13],
  그레이: [0.42, 0.45, 0.50],
  실버: [0.55, 0.58, 0.63],
  레드: [0.72, 0.11, 0.14],
  블루: [0.11, 0.35, 0.75],
  네이비: [0.10, 0.18, 0.45],
  브라운: [0.42, 0.26, 0.13],
  베이지: [0.62, 0.50, 0.30],   // 원색 그대로면 흰 바탕에서 흐리다
  민트: [0.05, 0.52, 0.45],
  크레용: [0.58, 0.42, 0.20],
  기타: [0.35, 0.37, 0.42],
};
/** 분류 넷 — 신차/중고를 색으로, 렌트/구독을 진하기로 가른다. */
// ★분류 색은 상태 색(green·amber·blue·orange·red)과 겹치지 않는다(사장님 2026-08-18 — 「출고협의 옆에 중고구독 — 색깔이 비슷하면 안 되지」).
//   예전 신차렌트 blue(=출고협의)·중고구독 amber(=상품화중)가 겹쳤다.
export const TYPE_TONE: Record<string, keyof typeof TONE> = {
  신차렌트: 'magenta', 중고렌트: 'teal', 중고구독: 'violet', 신차구독: 'gray',
};
/** 분류 칸만 다시 칠할 때(색 규칙 변경) — 조건부서식을 맨 앞(index 0)에 넣어 옛 규칙보다 먼저 맞게 한다. */
export function buildTypeChipColorRules(gid: number, columns: { name: string }[], rowCount = 500): Rec[] {
  const col = columns.findIndex((c) => String(c.name ?? '').trim() === '분류');
  if (col < 0) return [];
  return Object.entries(TYPE_TONE).map(([v, tone], i) => inkRuleFor(gid, col, v, TONE[tone].fg, i, rowCount));
}

/**
 * **제조사는 브랜드 컬러로 쓴다**(사장님 요청 2026-08-11).
 *
 * 색 돌려쓰기(팔레트 순환)로는 「기아가 왜 파랑이냐」가 된다. 브랜드가 쓰는 색을 그대로 쓰되,
 * **흰 바탕에서 읽히도록** 눌렀다 — 르노 노랑·쉐보레 금색은 원색 그대로면 안 보인다.
 * 옛 표기(KG모빌리티·쌍용·르노삼성)도 같은 색으로 묶는다. 시트에는 KGM 으로 고른다.
 */
const MAKER_INK: Record<string, [number, number, number]> = {
  현대: [0.00, 0.17, 0.37],        // #002C5F
  기아: [0.73, 0.09, 0.17],        // #BB162B
  제네시스: [0.42, 0.35, 0.24],     // 브론즈
  르노: [0.70, 0.53, 0.00],        // 노랑을 눌러 금색으로
  르노코리아: [0.70, 0.53, 0.00],
  르노삼성: [0.70, 0.53, 0.00],
  쉐보레: [0.72, 0.53, 0.04],      // #B8860B
  KGM: [0.05, 0.20, 0.36],        // 딥 네이비
  KG모빌리티: [0.05, 0.20, 0.36],
  쌍용: [0.05, 0.20, 0.36],
  벤츠: [0.20, 0.22, 0.24],        // 실버-블랙
  BMW: [0.00, 0.40, 0.69],        // #0066B1
  아우디: [0.73, 0.04, 0.19],      // #BB0A30
  테슬라: [0.80, 0.00, 0.00],      // #CC0000
  미니: [0.10, 0.10, 0.10],
  폭스바겐: [0.00, 0.12, 0.31],    // #001E50
  볼보: [0.00, 0.19, 0.34],        // #003057
  캐딜락: [0.55, 0.12, 0.25],
  지프: [0.16, 0.31, 0.20],        // 딥 그린
  포르쉐: [0.69, 0.17, 0.16],
  BYD: [0.14, 0.35, 0.60],
  폴스타: [0.25, 0.28, 0.30],
};

/**
 * **입력 구간을 배경으로 가른다**(사장님 요청 2026-08-11).
 *
 * 한 줄에 26칸이라 어디까지가 차 정보이고 어디부터 돈인지 눈으로 안 갈린다.
 * 아주 옅은 바탕색으로 세 구간을 나눈다 — 진하면 글자가 죽고 칩 색과 싸운다.
 *   ① 차량정보  차량번호~배기량        흰 바탕(그대로)
 *   ② 대여료    보증금·기간별 요금      따뜻한 미색
 *   ③ 부가정보  정책코드·최초등록일·사진링크  찬 회색
 */
export function buildSectionBanding(
  gid: number,
  columns: { name: string }[],
  rowCount = 500,
  skipUntil = 0,
): Rec[] {
  /**
   * ★**줄무늬 색으로** 구간을 가른다(사장님 확정 2026-08-12).
   *   구간을 통으로 한 색으로 칠하면 줄무늬가 죽어 어느 줄을 보는지 놓친다.
   *   줄무늬는 그대로 두고 «두 번째 줄 색»만 구간마다 달리한다.
   *     차량정보  흰 / 회색      (표가 자기 구간을 스스로 칠한다 — skipUntil 까지는 건너뛴다)
   *     대여료    흰 / 옅은 노랑
   *     기본조건·부가  흰 / 회색   보증금은 파는 값이 아니라 한 번 정하는 조건이라 이쪽이다
   */
  /**
   * 세 가지 톤 — 보증금은 요금도 기본조건도 아닌 **제 몫**이다(사장님 확정 2026-08-12).
   *   요금   옅은 노랑   파는 값
   *   보증금 옅은 파랑   한 번 받는 돈 — 요금과 헷갈리면 안 된다
   *   그 밖  옅은 회색   차 정보·정책·부가
   */
  const RENT: [number, number, number] = [1.00, 0.97, 0.85];
  const DEPOSIT: [number, number, number] = [0.92, 0.95, 0.99];
  const BASE: [number, number, number] = [0.97, 0.97, 0.98];
  /**
   * ★구독은 요금표가 **두 벌**이다 — 인수형(끝나면 산다)·반납형(끝나면 돌려준다).
   *   둘을 같은 색으로 두면 열 이름을 한 칸씩 읽어야 어느 블록인지 안다.
   *   같은 «요금»이되 톤을 갈라, 블록이 바뀌는 자리가 눈에 띄게 한다.
   *     인수형  옅은 노랑    (기본 요금색)
   *     반납형  옅은 초록    끝나면 돌려주는 쪽
   *   보증금도 자기 블록 색을 따라간다 — 블록 스코프(자기 오른쪽 기간을 관할)를 눈으로 잇는다.
   */
  const RENT_RETURN: [number, number, number] = [0.90, 0.97, 0.91];
  const DEPOSIT_RETURN: [number, number, number] = [0.87, 0.95, 0.89];
  // 「12개월 인수형」처럼 꼬리표가 붙은 기간 열도 요금이다 — `개월$` 로 끝을 물면 구독 탭이 통째로 회색이 된다.
  /**
   * 꼬리표가 없는 「기타기간①」은 **바로 앞 블록에 딸린다.**
   * 구독 시트에서 여백 칸은 맨 오른쪽이라 «반납형 보증금이 관할»하는데(블록 스코프),
   * 색이 인수형으로 잡히면 눈과 규칙이 어긋난다. 직전 꼬리표를 물려받는다.
   */
  let lastForm = '';
  const kindOf = (n: string) => {
    const form = /반납형/.test(n) ? '-ret' : /인수형/.test(n) ? '-buy' : '';
    if (form) lastForm = form;
    const use = form || (/^기타기간/.test(n) ? lastForm : '');
    if (/보증/.test(n)) return `dep${use}`;
    if (/\d+개월|^기타기간/.test(n)) return `rent${use}`;
    return 'base';
  };
  const toneOf = (k: string): [number, number, number] => (
    k === 'rent-ret' ? RENT_RETURN
      : k === 'dep-ret' ? DEPOSIT_RETURN
        : k.startsWith('rent') ? RENT
          : k.startsWith('dep') ? DEPOSIT
            : BASE);
  const out: Rec[] = [];
  const band = (from: number, to: number, rgb: [number, number, number]) => {
    if (to <= from) return;
    out.push({
      addBanding: {
        bandedRange: {
          range: grid(gid, ROW_HEADER, rowCount, from, to),
          rowProperties: {
            headerColorStyle: { rgbColor: { red: 0.13, green: 0.20, blue: 0.33 } },
            firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
            secondBandColorStyle: { rgbColor: { red: rgb[0], green: rgb[1], blue: rgb[2] } },
          },
        },
      },
    });
  };
  let from = -1; let kind = '';
  const flush = (to: number) => { if (from >= 0 && kind) band(from, to, toneOf(kind)); from = -1; kind = ''; };
  columns.forEach((c, i) => {
    if (i < skipUntil) return;                 // 표가 칠하는 구간은 손대지 않는다
    const k = kindOf(c.name);
    if (k !== kind) { flush(i); kind = k; from = i; }
  });
  flush(columns.length);
  return out;
}

/** 값 하나를 «그 색 글자»로 칠하는 조건부서식 한 줄. 색상 칸과 제조사 칸이 같이 쓴다. */
function inkRuleFor(gid: number, col: number, value: string, rgb: [number, number, number], index: number, rowCount: number): Rec {
  return {
    addConditionalFormatRule: {
      index,
      rule: {
        ranges: [grid(gid, ROW_DATA, rowCount, col, col + 1)],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
          format: { textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: rgb[0], green: rgb[1], blue: rgb[2] } } } },
        },
      },
    },
  };
}

export function buildChipColors(
  gid: number,
  columns: { name: string }[],
  makers: readonly string[] = [],
  rowCount = 500,
): Rec[] {
  const out: Rec[] = [];
  const rule = (col: number, value: string, tone: keyof typeof TONE, index: number) => ({
    addConditionalFormatRule: {
      index,
      rule: {
        ranges: [grid(gid, ROW_DATA, rowCount, col, col + 1)],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
          /**
           * ★**글자 색만** 바꾼다(사장님 확정 2026-08-11). 배경을 칠하면 칩(알약)의
           *   제 모양이 뭉개진다 — 칩은 그대로 두고 글자만 색으로 갈라야 깔끔하다.
           */
          format: {
            textFormat: {
              bold: true,
              foregroundColorStyle: { rgbColor: { red: TONE[tone].fg[0], green: TONE[tone].fg[1], blue: TONE[tone].fg[2] } },
            },
          },
        },
      },
    },
  });
  let i = 0;
  const colOf = (name: string) => columns.findIndex((c) => c.name === name);
  const statusCol = colOf('상태');
  if (statusCol >= 0) for (const [v, tone] of Object.entries(STATUS_TONE)) out.push(rule(statusCol, v, tone, i++));
  const typeCol = colOf('분류');
  if (typeCol >= 0) for (const [v, tone] of Object.entries(TYPE_TONE)) out.push(rule(typeCol, v, tone, i++));
  const fuelCol = colOf('연료');
  if (fuelCol >= 0) for (const [v, tone] of Object.entries(FUEL_TONE)) out.push(rule(fuelCol, v, tone, i++));
  // 색상 두 칸 — 팔레트에 없는 색은 그냥 둔다(억지 색을 지어내지 않는다).
  const inkRule = (col: number, value: string, rgb: [number, number, number], index: number) => inkRuleFor(gid, col, value, rgb, index, rowCount);
  for (const colName of ['외부색상', '내부색상']) {
    const c = colOf(colName);
    if (c < 0) continue;
    for (const [v, rgb] of Object.entries(COLOR_INK)) out.push(inkRule(c, v, rgb, i++));
  }
  // 제조사는 수가 많다 — 색을 돌려 쓰되 같은 회사는 늘 같은 색이 되게 이름 순서로 고정한다.
  const makerCol = colOf('제조사');
  if (makerCol >= 0) {
    // 브랜드 색이 있는 것만 칠한다. 없는 브랜드는 그냥 둔다 — 억지 색을 지어내지 않는다.
    const painted = new Set<string>();
    for (const m of makers) { const rgb = MAKER_INK[m]; if (rgb) { out.push(inkRuleFor(gid, makerCol, m, rgb, i++, rowCount)); painted.add(m); } }
    // 옛 표기로 적힌 값도 같은 색으로 — 「KG모빌리티」가 검은 글씨로 남으면 KGM 과 달라 보인다.
    for (const [m, rgb] of Object.entries(MAKER_INK)) if (!painted.has(m)) out.push(inkRuleFor(gid, makerCol, m, rgb, i++, rowCount));
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 「정책」 탭 — 공급사가 쓰는 정책을 **코드 한 줄에 하나씩** 적는다.
//
// 상품리스트는 정책코드로 «가리키기만» 하고 내용은 여기서 정의한다. 조건이 바뀌면 여기 한 줄만
// 고치면 되고, 그 코드를 쓰는 차가 몇 대든 함께 바뀐다.
// 맨 끝 「특이사항」은 공급사가 자기 사정을 자유롭게 적는 칸이다 — 우리 어휘로 못 담는 것들
// (예: "탁송 제주 불가", "주말 출고 불가", "선납 시 할인").
// ────────────────────────────────────────────────────────────────────────────

/**
 * **프리패스 기본 정책** — 정책탭 맨 앞에 세로로 서는 한 열.
 *
 * ★빈칸을 두지 않는다(사장님 확정 2026-08-11). 공급사가 «뭘 적으라는 거냐»를 묻지 않게
 *   모든 줄에 우리 값을 세워 둔다. 같으면 그대로, 다른 것만 자기 열에 적으면 된다.
 *
 * 값의 출처는 둘뿐이다.
 *   ① 계약서 조항에서 나온 것 — `policy-defaults.POLICY_DEFAULTS`(시동제어 3일 · 자동해지 10일 ·
 *      지연손해금 연 12% · 사고 3회 · 대차 미제공 · GPS 장착 …). 여기 있으면 그것을 쓴다.
 *   ② 조항에 없는 것 — **지금 정책 32건의 최빈값**을 표준으로 세웠다(2026-08-11 실측).
 *      괄호 안이 그 비율이다. 절반을 못 넘는 것은 «가장 흔한 값»일 뿐이니 사장님이 보고 고치면 된다.
 *
 * ⚠ 이 열은 **읽지 않는다**. 공급사 정책이 아니라 우리가 보여 주는 기준이다.
 */
export const FREEPASS_STANDARD: Record<string, string> = {
  자차보상한도: '차량가액',                    // 사장님 확정 2026-08-11
  대물보상한도: '1억원',                      // 78%
  대인보상한도: '무한',                       // 100%
  자손보상: '1억원',                         // 50%
  자손면책금: '30만원',                       // 34% — 대인·대물 면책과 같은 자리로 맞춤
  무보험보상: '없음',                         // 사장님 확정 2026-08-11 — 무보험차상해 없음이 프리패스 표준(실측도 50%로 최다)
  기본운전자연령: '만 26세 이상',                // 78%
  연령인하: '만21세',                        // 41%
  최대연령: '만 65세 이하',                    // 47%
  면허기간: '제한없음',                       // 44%
  개인운전자범위: '계약자 본인+직계가족',           // 66%
  법인운전자범위: '임직원',                     // 옛 「계약사업자 임직원 및 관계자」 69% (표기 규격 2026-08-18)
  추가운전: '가능',                          // 옛 「1인」 69% → 가능 여부만(2026-08-18)
  기본주행: '연 20,000km',                   // 44% (표기 규격 2026-08-18)
  '추가주행 금액': '10만원',                   // 47%
  대여지역: '전국',                          // 72%
  보증금카드결제: '협의',                      // 가능·협의 동률 — 협의가 덜 위험하다
  보증금분납: '가능',                         // 59%
  '연령 하향 요금': '10만원',                  // 38%
  '추가운전 요금': '1인까지 · 1인당 월 5만원', // 옛 「1인」+「월 5만원」(2026-08-18 규격)
  탁송비: '일부지원',                          // 옛 「협의」 53% → 사장님 2026-08-19 세 값
  // 회사마다 다를 수밖에 없는 칸 — 표준을 세우는 대신 «누가 적는 칸인지»를 적어 둔다.
};

/**
 * 공급사 제공시트의 정책 탭 이름 — 사장님 2026-08-19 「탭은 렌트재고 · 구독재고 · 운영정책 · 공지사항 · 회사정보만」.
 * 옛 이름 「정책」도 계속 읽는다(아직 안 바꾼 시트가 있다). 쓰는 쪽은 `policyTabTitle(titles)` 로 실제 제목을 고른다.
 */
export const POLICY_TAB_NAME = '운영정책';
export const POLICY_TAB_ALIASES: readonly string[] = ['운영정책', '정책'];
/**
 * 정책 탭인가.
 *
 * ★**정책 탭은 한 장이다**(사장님 2026-08-21 「정책은 한탭만 있으면 되지 · 정책탭은 하나만 두자 ·
 *   정책명으로 구분하면 되고 어차피 코드가 들어가니까」).
 *   08-20에는 법인마다 갈라 적었다(「스타운영정책 · 스카이운영정책」…). 탭이 늘어 규격이 흐트러졌고,
 *   자리로 읽던 판독기가 열 하나에 죽는 일도 그 사이에서 났다. 08-21 「운영정책」 한 장으로 합쳤다.
 *   **회사는 탭이 아니라 정책코드·정책명이 가른다** — 차는 재고 탭의 정책코드로 제 정책을 찾아간다.
 *   합치기 전 실측: 여섯 탭 열 차이 0 · 팔 수 있는 차의 정책코드 빈 칸 0(merge-policy-tabs.mts).
 * ⚠ 옛 이름(「…운영정책」)도 계속 정책 탭으로 본다 — 아직 안 합친 문서가 있을 수 있다.
 */
export const isPolicyTabTitle = (title: unknown): boolean => {
  const t = String(title ?? '').trim();
  return t === '정책' || /운영정책$/.test(t);
};
export const policyTabTitle = (titles: unknown[]): string | undefined => POLICY_TAB_ALIASES.find((a) => titles.some((t) => String(t ?? '').trim() === a));
export const COMPANY_INFO_TAB_NAME = '회사정보';
/**
 * 공급사에게 보이는 탭 = 재고 탭(이름은 시트마다 「재고」·「렌트재고」·「구독재고」 등 — 건드리지 않는다) + 아래 셋.
 * 숨기는 것은 «우리(AI)가 보는 탭»만(`SUPPLIER_HIDDEN_TABS`). 모르는 탭은 손대지 않는다 — 재고 탭을 숨기면 사고다(2026-08-19 dry-run에서 「재고」가 숨김 대상으로 잡혔었다).
 */
export const SUPPLIER_VISIBLE_TABS: readonly string[] = [POLICY_TAB_NAME, '공지사항', COMPANY_INFO_TAB_NAME];
export const SUPPLIER_HIDDEN_TABS: readonly string[] = ['AI 인계', 'AI 정제', '정책 작성법', '작성 안내', '정제시트 안내', 'AI 운영 매뉴얼', '이 시트는', '안내'];
const POLICY_BLANK_COLS = 3;      // 새 정책을 적을 빈 칸

/**
 * ★**우리가 만든 «재고가 아닌» 탭들.** 발행기가 이걸 재고표로 읽으려다 실패하면
 *   「못 읽은 것」으로 세어져, 진짜 구멍이 그 소음에 묻힌다.
 *   *실측 2026-08-14*: 문패를 우리 제공시트로 넘긴 순간 「못 읽은 것」이 1건 → 8건이 됐다.
 *   늘어난 7건이 전부 「정책」 탭이었다 — 하나도 진짜 문제가 아니었다.
 * ⚠ 공급사별 `@제외` 규칙으로 막지 마라. 이건 **모든 제공시트에 있는 우리 탭**이라
 *   공급사가 늘 때마다 규칙을 또 적어야 하고, 안 적은 곳은 조용히 소음을 낸다.
 */
// 「정책 작성법」은 2026-08-18 정책 표기 매뉴얼 탭 — 재고표가 아니다(publish-policy-guide 가 찍는다).
export const SHEET_IDENTITY_TAB = '이 시트는';
export const LEGACY_NOTICE_TAB = '⚠ 구버전 — 안 씀';
/** 공급사 시트 안 「상품시트」 탭 — 발행된 판매시트에서 그 공급사 줄을 그대로 옮긴 사본(사장님 2026-08-19 「공급사가 입력하는 거랑 상품시트에 올라갈 거를 미리 똑같이」). 재고 탭이 아니다. */
export const SUPPLIER_PREVIEW_TAB = '상품시트';
/** 공급사 시트마다 붙이는 「차종마스터」 사본 탭(사장님 2026-08-19 「공급사시트에 차종마스터 탭을 다 붙여 넣고」) — 정본은 엔카 차종마스터, publish-vehicle-master-tab 이 통째로 다시 쓴다. */
export const VEHICLE_MASTER_COPY_TAB = '차종마스터';
export const OUR_NON_INVENTORY_TABS = [...POLICY_TAB_ALIASES, COMPANY_INFO_TAB_NAME, 'AI 인계', 'AI 정제', '정책 작성법', '작성 안내', '정제시트 안내', '공지사항', 'AI 운영 매뉴얼', SHEET_IDENTITY_TAB, LEGACY_NOTICE_TAB, SUPPLIER_PREVIEW_TAB, VEHICLE_MASTER_COPY_TAB];
export const isOurNonInventoryTab = (title: unknown) =>
  OUR_NON_INVENTORY_TABS.some((t) => String(title ?? '').trim() === t);

/**
 * 「정책」 탭은 **세로가 항목, 가로가 정책**이다.
 *
 * 정책은 공급사당 두어 개인데 항목은 스무 개가 넘는다. 정책을 행으로 두면 오른쪽으로 한없이
 * 흘러 한 정책을 다 보려면 스크롤을 해야 한다. 뒤집으면 한 화면에서 정책끼리 «세로로 비교»된다.
 *
 * 맨 아래 「특이사항」은 우리 항목으로 못 담는 조건을 자유롭게 적는 칸이다
 * (예: 주말 출고 불가 · 제주 탁송 불가 · 선납 할인).
 */
/**
 * 정책 탭에 싣는 줄.
 *
 * ★`field`(ERP 정책 필드) 가 없다고 빼면 안 된다. 주행 조건(기본주행·추가주행 방식·금액)은
 *   ERP 정책에 대응 필드가 아직 없지만 **공급사가 반드시 답해야 하는 값**이다.
 *   빼면 물어볼 자리가 사라져 아무도 안 적는다(실측 2026-08-08: 세 줄이 통째로 누락됐다).
 *   미리 채워 줄 수는 없을 뿐이고, 물어보는 것과 채워 주는 것은 다른 일이다.
 */
export const POLICY_TAB_FIELD_ROWS: { name: string; values?: string[] }[] = [
  { name: '정책명' },
  ...POLICY_COLUMNS.filter((c) => c.name !== '정책코드').map((c) => ({ name: c.name, values: c.values })),
  { name: '특이사항' },
];

export function buildPolicyTabValues(policies: Record<string, string>[]): string[][] {
  const cols = policies.length + POLICY_BLANK_COLS;
  const row = (label: string, pick: (p: Record<string, string>) => string) => [
    label,
    ...policies.map(pick),
    ...Array(POLICY_BLANK_COLS).fill(''),
  ];
  return [
    row('정책코드', (p) => String(p['정책코드'] ?? '')),
    ...POLICY_TAB_FIELD_ROWS.map((f) => row(f.name, (p) => String(p[f.name] ?? ''))),
  ].map((r) => r.slice(0, cols + 1));
}

export function buildPolicyTabFormat(gid: number, policyCount: number): Rec[] {
  const width = policyCount + POLICY_BLANK_COLS + 1;
  const rows = POLICY_TAB_FIELD_ROWS.length + 1;         // 정책코드 줄 + 항목들
  const out: Rec[] = [];

  // 첫 줄(정책코드) — 남색 바탕 흰 글씨.
  out.push({
    repeatCell: {
      range: grid(gid, 0, 1, 0, width),
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.13, green: 0.20, blue: 0.33 },
          textFormat: { bold: true, fontSize: 10, fontFamily: FONT, foregroundColor: { red: 1, green: 1, blue: 1 } },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });
  // 첫 칸(항목 이름) — 회색 굵게.
  out.push({
    repeatCell: {
      range: grid(gid, 1, rows, 0, 1),
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.90, green: 0.91, blue: 0.93 },
          textFormat: { bold: true, fontSize: 10, fontFamily: FONT }, verticalAlignment: 'MIDDLE',
          horizontalAlignment: 'LEFT',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)',
    },
  });
  // 값 칸 — 재고 탭과 같은 규격(10pt · 가운데 세로정렬 · 줄무늬 없음).
  // 두 탭의 글자 크기가 다르면 같은 시트인데 다른 문서처럼 보인다.
  out.push({
    repeatCell: {
      range: grid(gid, 1, rows, 1, width),
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: { fontSize: 10, fontFamily: FONT },
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)',
    },
  });
  // 한 줄 걸러 옅은 회색 — 가로로 눈이 미끄러지지 않게. 재고 탭 줄무늬와 같은 색.
  for (let r = 2; r < rows; r += 2) {
    out.push({
      repeatCell: {
        range: grid(gid, r, r + 1, 0, width),
        cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.97, blue: 0.98 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  // 항목마다 «가로 한 줄» 드롭다운.
  for (const [i, f] of POLICY_TAB_FIELD_ROWS.entries()) {
    if (!f.values?.length) continue;
    out.push({
      setDataValidation: {
        range: grid(gid, i + 1, i + 2, 1, width),
        rule: {
          condition: { type: 'ONE_OF_LIST', values: f.values.map((v) => ({ userEnteredValue: v })) },
          showCustomUi: true, strict: false,
        },
      },
    });
  }

  // 특이사항 줄은 줄바꿈 — 잘려 보이면 안 적는다.
  out.push({
    repeatCell: {
      range: grid(gid, rows - 1, rows, 1, width),
      cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
      fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)',
    },
  });

  out.push({
    updateSheetProperties: {
      properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
      fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    },
  });
  out.push({
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: rows },
      properties: { pixelSize: 28 }, fields: 'pixelSize',
    },
  });
  out.push({
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 150 }, fields: 'pixelSize',
    },
  });
  out.push({
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: width },
      properties: { pixelSize: 220 }, fields: 'pixelSize',
    },
  });
  return out;
}

/**
 * 탭을 다시 쓸 때 **옛 서식을 지운다.**
 *
 * values clear 는 값만 지운다 — 서식·드롭다운·셀메모는 남는다. 배치가 바뀌면(헤더가 4행에서
 * 0행으로 내려오는 식) 옛 헤더색·설명행 회색이 엉뚱한 데이터 줄에 그대로 붙어
 * "헤더 밑에 헤더가 하나 더 있는" 화면이 된다(실측 2026-08-08).
 */
export function resetSheetRequests(gid: number): Rec[] {
  const all = { sheetId: gid, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 80 };
  return [
    // ★남아 있는 기본 필터가 표(Table) 변환을 막는다 —
    //   "데이터를 표로 변환하기 전에 변환 영역과 겹치는 필터를 삭제하세요"(실측 2026-08-11).
    //   표가 안 붙으면 드롭다운이 «칩»이 아니라 화살표로만 뜬다.
    { clearBasicFilter: { sheetId: gid } },
    { repeatCell: { range: all, cell: {}, fields: 'userEnteredFormat' } },
    { repeatCell: { range: all, cell: {}, fields: 'note' } },
    { setDataValidation: { range: all } },
    { updateSheetProperties: {
        properties: { sheetId: gid, gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 } },
        fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    } },
  ];
}


/**
 * 구글시트 **「표(Table)」** 로 만든다 — 드롭다운이 «칩(알약)» 으로 뜨는 유일한 길이다.
 *
 * 일반 데이터확인(`setDataValidation`)은 화살표로만 나온다. 규칙에 표시 스타일을 담는 자리가
 * 아예 없다(`DataValidationRule` = strict·condition·showCustomUi·inputMessage, 실측 2026-08-08).
 * 표의 열 타입 `DROPDOWN` 이 칩 렌더링을 맡는다. 덤으로 머리행 고정·줄무늬·열 이름 필터가 딸려온다.
 */
/**
 * 표가 덮는 열 수 — **마지막 드롭다운 열까지**.
 * 그 오른쪽(금액·기간·정책코드·사진링크)은 표 밖에 두어 숫자서식이 살아 있게 한다.
 */
export function tableWidth(columns: { name: string }[]): number {
  /**
   * 표는 **드롭다운 칸까지만** 덮는다(사장님 확정 2026-08-11 — 배기량까지 넓혔다가 되돌렸다).
   *
   * 표 안에서는 숫자서식이 통째로 무시된다. 실측: 같은 `136885` 를 넣으면
   * 표 안 주행거리는 「136885」, 표 밖 보증금은 「136,885」로 보인다.
   * 배기량까지 덮으면 진한 경계선은 스펙과 돈 사이로 옮겨 가지만, 그 대가로
   * **공급사가 주행거리를 칠 때마다 맨숫자로 남는다**. 선 한 줄보다 그게 크다.
   *
   * 그래서 숫자 칸을 만나면 거기서 멈춘다 — 그 오른쪽은 전부 표 밖이어야 콤마가 산다.
   */
  let last = -1;
  for (const [i, c] of columns.entries()) {
    const isDropdown = !!VALUE_LISTS[c.name] || /^(제조사|연식)$/.test(c.name);
    if (isDropdown) last = i;
    if (/보증|개월|주행거리|배기량|^기타기간/.test(c.name)) break;
  }
  return last + 1;
}

export function buildTableRequest(
  gid: number,
  columns = TEMPLATE_COLUMNS,
  extra: Record<string, readonly string[]> = {},
  rowCount = 500,
  /**
   * 표 이름 — **한 문서 안에서 겹치면 안 된다.**
   * 「재고」로 고정해 뒀더니 같은 파일에 「인수형」 탭을 만들 때 이름이 겹쳐
   * 구글이 「Internal error」로 거절했다(실측 2026-08-12). 탭마다 다른 이름을 준다.
   */
  name = '재고',
): Rec {
  const lists: Record<string, readonly string[]> = { ...VALUE_LISTS, ...extra };
  return {
    addTable: {
      table: {
        name,
        // ★표는 **드롭다운 칸까지만** 씌운다(2026-08-11).
        //   구글 표 안에서는 셀 숫자서식이 통째로 무시된다 — 표 밖 같은 셀은 「900,000」,
        //   표 안은 열 타입을 DOUBLE 로 바꿔도 「900000」이다(대조 실험으로 확인).
        //   금액·주행 칸을 표 밖에 두면 **칩 드롭다운과 천단위 콤마를 둘 다** 가진다.
        range: { sheetId: gid, startRowIndex: ROW_HEADER, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: tableWidth(columns) },
        rowsProperties: {
          headerColorStyle: { rgbColor: { red: 0.13, green: 0.20, blue: 0.33 } },
          firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
          secondBandColorStyle: { rgbColor: { red: 0.97, green: 0.97, blue: 0.98 } },
        },
        columnProperties: columns.slice(0, tableWidth(columns)).map((c, i) => {
          const values = lists[c.name];
          if (values?.length) {
            return {
              columnIndex: i,
              columnName: c.name,
              columnType: 'DROPDOWN',
              dataValidationRule: {
                condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
              },
            };
          }
          /**
           * 금액·주행은 **글자**로 둔다.
           *
           * 표(Table)에서는 열 타입만 표시를 정한다 — `repeatCell` 숫자서식이 통째로 무시된다
           * (실측 2026-08-08). DOUBLE 은 「1070000」로 붙어 자리수를 눈으로 세야 하고,
           * CURRENCY 는 「₩1,070,000.00」로 소수점까지 강제한다.
           * 글자로 두고 우리가 「1,070,000」을 써 넣으면 제일 읽기 쉽다.
           * 재유입은 문제없다 — 파서가 숫자 아닌 글자를 걷어내고 읽는다(sim-atom-pipeline 로 지킨다).
           * 대신 시트 안에서 숫자 정렬·합계는 못 한다. 공급사가 그걸 하는 칸이 아니다.
           */
          return { columnIndex: i, columnName: c.name, columnType: 'TEXT' };
        }),
      },
    },
  };
}


/**
 * 숫자 칸 **우측 정렬** — 표를 만든 «뒤»에 건다.
 *
 * 표에서는 숫자서식(`numberFormat`)이 통째로 무시되므로 쉼표는 값에 넣어 두고(글자 열),
 * 정렬만 서식으로 맞춘다. 자리수가 세로로 떨어져야 금액을 눈으로 비교할 수 있다.
 */
export function buildNumberFormats(gid: number, columns = TEMPLATE_COLUMNS, rowCount = 500): Rec[] {
  const out: Rec[] = [];
  for (const [i, c] of columns.entries()) {
    // ★열 전체에 **숫자 서식**을 건다. 2026-08-11 까지 오른쪽 정렬만 걸어서,
    //   콤마는 «원래 값에 콤마가 들어 있던 행»에만 보였다. 공급사가 새로 친 900000 은
    //   맨숫자로 남아 자리수를 눈으로 세야 했다(사장님 지적).
    //   ROW_DATA~rowCount 전 구간에 걸어야 «앞으로 칠 행»도 함께 걸린다.
    const money = /보증|개월|주행거리|배기량|증액|차량가격|^기타기간/.test(c.name);
    // 연식은 콤마를 넣으면 안 된다 — 2024 가 2,024 가 된다.
    const plain = /연식/.test(c.name);
    if (!money && !plain) continue;
    /**
     * ★**대여료는 굵게, 보증금은 보통 굵기** — 글자색은 둘 다 검정(사장님 2026-08-11 굵기 · 2026-08-19 「폰트 그냥 검정색으로」).
     *   금액 칸이 열 몇 개씩 나란히 서 있으면 어느 게 매달 내는 돈이고 어느 게 한 번 내는
     *   돈인지 눈으로 안 갈린다. 굵기로 가른다 — 파는 값이 대여료이므로 그쪽을 세운다.
     */
    const rent = /\d+개월|^기타기간/.test(c.name);   // 「12개월 인수형」 같은 꼬리표 붙은 열도 요금이다
    const deposit = /보증/.test(c.name);
    out.push({
      repeatCell: {
        range: grid(gid, ROW_DATA, rowCount, i, i + 1),
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'RIGHT',
            numberFormat: { type: 'NUMBER', pattern: money ? '#,##0' : '0' },
            // ★글자는 검정(사장님 2026-08-19 「기간별 대여료 폰트 그냥 검정색으로」) — 보증금 회색 글자는 뺐다. 굵기만 대여료 굵게·보증금 보통.
            textFormat: {
              fontSize: 10, fontFamily: FONT, bold: rent,
              foregroundColorStyle: { rgbColor: { red: 0, green: 0, blue: 0 } },
            },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat,textFormat)',
      },
    });
  }
  return out;
}
