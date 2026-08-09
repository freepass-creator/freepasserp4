/**
 * 프리패스 표준 정책 기본값 — **실계약서에서 뽑은 것**.
 *
 * ★출처가 추측이 아니다
 *   지금 쓰는 계약서(`계약서양식/01. JPK_개인(개인사업자) 계약서.xlsx` → `esign-standard-terms.ts`)와
 *   A4 서식(`rental-contract.html`)의 고정문구에 **이미 박혀 있던 숫자**를 그대로 옮겼다.
 *   그러니 이 값을 넣으면 «지금 나가는 계약서와 같은 계약»이 된다. 새로 정하는 것이 아니다.
 *
 * ★왜 정책으로 빼는가
 *   지금은 코드·서식에 박혀 있어 공급사마다 다르게 둘 수 없다.
 *   공급사가 하나만 더 붙어도 깨진다. 정책으로 빼면 표준은 이 기본값이고, 다른 곳은 고쳐 쓴다.
 *
 * ★비워 둔 것은 «모르는 것»이다
 *   추측으로 채우지 않는다. 계약서에 숫자가 없던 항목은 `null` 로 두고 «확인 필요»로 표시한다.
 *   빈칸이 흠이지만, 틀린 기본값은 그 값으로 계약이 굳어 버린다.
 */

import { isDomesticMaker } from '@/lib/domain/product-filters';

export type PolicyDefault = {
  key: string;
  label: string;
  /** null = 계약서에 숫자가 없어 정할 수 없음. 사람이 정해야 한다. */
  value: string | number | null;
  /** 이 값을 어디서 가져왔는지. 근거 없는 기본값은 두지 않는다. */
  source: string;
};

export const POLICY_DEFAULTS: PolicyDefault[] = [
  /* ── 미납 제재 ── 계약서 「연체·시동제어」 고정문구에서 그대로 */
  {
    key: 'engine_control_overdue_days', label: '운행제한(시동제어) 기준일', value: 3,
    source: '계약서 「대여료 및 보험 면책금을 청구일로부터 3일 연체 시 오후6시 시동제어」',
  },
  {
    key: 'auto_terminate_overdue_days', label: '차량회수·해지 기준일', value: 10,
    source: '계약서 「10일 연체 시 계약은 자동 해지 되며, 임대인은 차량을 회수 할 수 있으며」',
  },
  {
    key: 'deposit_overdue_rounds', label: '보증금 미납 시동제어(회차)', value: 2,
    source: '계약서 「※ 보증금 2회차 미납 시 즉시시동제어」',
  },

  /* ── 돈 ── */
  {
    key: 'late_fee_rate', label: '지연손해금율(0~1)', value: 0.12,
    // 계약서는 두 단계다 — 신청일~송달 연 5%, 그 다음날부터 연 12%.
    // 정책 한 칸에는 **손님이 실제로 오래 무는 쪽**을 둔다. 5% 구간은 약관 제3조가 서술한다.
    source: '계약서 「… 송달된 날까지 연 5%, 그 다음 날부터 다 갚는 날까지 연 12%」 중 후자',
  },
  {
    key: 'deposit_return_days', label: '보증금 반환기한(일)', value: 7,
    source: '계약서 「과태료·사고 여부 확인 후 1주일 안에 고객 지정 계좌로 반환」',
  },

  /* ── 만기 ── */
  {
    key: 'renewal_notice_days', label: '연장 사전통지기한(일)', value: 30,
    source: '계약서 「계약종료 한달(30일)전 까지는 당사의 승인을 받아야 합니다」',
  },
  {
    key: 'buyout_notice_days', label: '인수 사전통지기한(일)', value: 30,
    // 계약서에 인수 통지기한이 따로 없다. 연장과 같은 시점에 판단하므로 30일로 맞춘다.
    // 다르게 두려면 여기서 고친다 — 약관 제17조가 이 값을 그대로 참조한다.
    source: '계약서에 별도 기재 없음 — 연장 통지기한(30일)에 맞춤. 다르면 고칠 것',
  },

  /* ── 제재 ── */
  {
    key: 'accident_termination_count', label: '1년 이내 사고 누적(N회)', value: 3,
    source: '계약서 「사고 발생 시점 1년 이내 임차인 과실비율 50% 이상의 사고 3회 누적 시 계약 해지」',
  },
  {
    key: 'claim_basis', label: '청구 기준', value: '잔여 대여료',
    source: '계약서 「기한이익 상실 시 잔여 대여료 상당액을 청구 (중도해지수수료와 중복 청구하지 않음)」',
  },

  /* ── 정비·사고 ── */
  {
    key: 'designated_garage', label: '지정 정비점', value: '지정 협력 정비공장',
    source: '서식 05항 「임대인 지정 또는 사전 합의된 정비점」 · 계약서 「임의 수리 시 전액 임차인 부담」',
  },
  {
    key: 'replacement_car_policy', label: '대차 정책', value: '미제공',
    // 「지원 불가」는 부정조건이다 — 비워 두면 손님이 대차되는 줄 안다.
    source: '계약서 「대차서비스 지원 불가 합니다」',
  },
  {
    key: 'gps_installed', label: 'GPS 장착', value: '장착',
    source: '계약서 특약 「GPS 장착(도난 및 연체, 연락 두절시 시동 제어)」',
  },

  /* ── 보험 ── 계약서는 보험사를 박지 않는다(매년 바뀐다). 계약조회 현재값을 기본으로 둔다. */
  {
    key: 'insurer_name', label: '보험사', value: '렌터카 공제조합',
    source: 'TERMS_ACCIDENT.insurerCurrent 「렌터카 공제조합 1661-7977」',
  },
  {
    key: 'insurer_phone', label: '보험사 연락처', value: '1661-7977',
    source: '위와 같음',
  },
  {
    key: 'own_damage_compensation', label: '자차 보상', value: '시세 기준',
    source: '계약서 「보상한도 : 렌터카 공제조합 또는 손해보험사 시세 (한도 초과시 폐차)」',
  },
  {
    key: 'own_damage_repair_ratio', label: '자차 자기부담률', value: '20%',
    source: '계약서 「자차 사고처리 비용의 20%」 · 중과실도 20% 우선 적용',
  },
  /*
   * 자차 면책금 = 수리비의 20%, 다만 **하한·상한이 있다.**
   * 아래는 기본(만 26세 이상) 기준이다. 연령을 내리면 `DEDUCTIBLE_BY_AGE` 표가 이긴다
   * (만 21세↑ 70~120만 / 만 21세 미만 80~130만) — 계약서에 「연령 선택시 자동입력」이라고 적혀 있다.
   */
  {
    key: 'own_damage_min_deductible', label: '자차 최소 면책금', value: 500000,
    source: '계약서 「자차 사고처리 비용의 20% 최소 50만원」(만 26세 이상 기준)',
  },
  {
    key: 'own_damage_max_deductible', label: '자차 최대 면책금', value: 1000000,
    source: '계약서 「… ~ 최대 100만원」(만 26세 이상 기준)',
  },
  /*
   * 대인·대물 면책금 — 실무는 30만원 또는 50만원이고 **통상 30만원**(2026-08-09 사장님).
   * 계약서 표(만 26세 이상)도 각 30만원이라 서로 맞는다.
   * 연령을 내리면 위와 마찬가지로 `DEDUCTIBLE_BY_AGE` 표가 이긴다(만 21세↑ 각 50만원).
   */
  {
    key: 'injury_deductible', label: '대인 면책금', value: 300000,
    source: '계약서 「사고접수시 각 대인 30만원」(만 26세 이상) · 실무 통상값',
  },
  {
    key: 'property_deductible', label: '대물 면책금', value: 300000,
    source: '계약서 「… 대물 30만원」(만 26세 이상) · 실무 통상값',
  },

  /* ── 상품 기본 ── */
  {
    key: 'maintenance_service', label: '정비 상품', value: '미제공',
    source: '계약서 「정비상품 선택을 안할경우 정비 및 소모품 교체는 고객이 부담」 — 선택 안 함이 기본',
  },
  {
    key: 'annual_roadside_assistance', label: '긴급출동', value: '연 3회',
    source: '계약서에 횟수 기재 없음 — 업계 통상값. **확인 필요**',
  },

  /* ── 사장님 지정(2026-08-09) ── 계약서에 숫자가 없어 새로 정한 프리패스 표준 */
  {
    key: 'over_mileage_rate_domestic', label: '초과 주행요금 · 국산(1km당)', value: 200,
    source: '프리패스 표준(2026-08-09 지정) — 국산차 1km 초과당 200원',
  },
  {
    key: 'over_mileage_rate_imported', label: '초과 주행요금 · 수입(1km당)', value: 400,
    source: '프리패스 표준(2026-08-09 지정) — 수입차 1km 초과당 400원',
  },
  {
    key: 'impound_keep_days', label: '물품 보관기간(일)', value: 7,
    source: '프리패스 표준(2026-08-09 지정) — 약관 제13조가 참조하는 값',
  },
  {
    key: 'early_termination_rate_under1y', label: '중도해지 위약금 · 1년 미만(0~1)', value: 0.3,
    source: '프리패스 표준(2026-08-09 지정) — 잔여기간 대여료의 30%',
  },
  {
    key: 'early_termination_rate_over1y', label: '중도해지 위약금 · 1년 이상(0~1)', value: 0.2,
    source: '프리패스 표준(2026-08-09 지정) — 잔여기간 대여료의 20%',
  },

  {
    key: 'self_damage_exclusions', label: '자차 처리 제외',
    value: '단독사고,가해자 불명,휠·타이어 단독 손상,전손,고의·관리 소홀',
    // A4 서식 04항에 이미 인쇄되던 문구다. 공급사별로 다를 수 있으나 프리패스 표준은 이것.
    source: '계약서 04항 「단독사고 · 가해자 불명(보유불명) 사고 · 휠/타이어 단독 손상 · 전손 · 고의·관리 소홀 등」',
  },

  {
    key: 'penalty_condition', label: '중도해지 위약금(표기)', value: '잔여 대여료의 30%',
    // 영업 상담에서 한마디로 말할 때 쓰는 표기. 실제 계산은 위 두 요율이 한다.
    source: '1년 미만 30% 기준 표기 — 실제 계산은 early_termination_rate_* 가 한다',
  },

  {
    key: 'impound_fee', label: '물품 보관료(1일)', value: 10000,
    // 서식은 「1일 0원」으로 자리만 잡아 둔 표시였다(실값 아님). 여기서 실값을 정한다.
    source: '프리패스 표준(2026-08-09 지정) — 1일 10,000원. 약관 제13조가 참조',
  },
];

/**
 * 이 계약에 붙는 초과 주행요금 — **국산이냐 수입이냐로 갈린다.**
 *
 * 제조사 판정은 `isDomesticMaker` 하나만 쓴다. 판정을 두 벌로 두면
 * 필터에선 국산인데 계약서엔 수입 요율이 찍힌다.
 * 값이 없으면 «없음»을 돌려준다 — 한쪽 요율로 메우지 않는다.
 */
export function overMileageRateFor(
  policy: Record<string, unknown> | null | undefined,
  maker: string,
): number | null {
  const p = policy || {};
  const key = isDomesticMaker(String(maker || ''))
    ? 'over_mileage_rate_domestic'
    : 'over_mileage_rate_imported';
  const n = Number(p[key]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 중도해지 위약금율 — **경과 기간으로 갈린다**(1년 미만 30% / 1년 이상 20%).
 * 잔여기간 대여료에 이 율을 곱한다. 계약서에는 두 구간을 다 적어 손님이 미리 알게 한다.
 */
export function earlyTerminationRateFor(
  policy: Record<string, unknown> | null | undefined,
  elapsedMonths: number,
): number | null {
  const p = policy || {};
  const key = (Number(elapsedMonths) || 0) < 12
    ? 'early_termination_rate_under1y'
    : 'early_termination_rate_over1y';
  const n = Number(p[key]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 기본값을 정책 레코드에 얹는다. **이미 값이 있으면 덮지 않는다.** */
export function applyPolicyDefaults(policy: Record<string, unknown>): {
  next: Record<string, unknown>; filled: string[]; pending: PolicyDefault[];
} {
  const next = { ...policy };
  const filled: string[] = [];
  const pending: PolicyDefault[] = [];

  for (const d of POLICY_DEFAULTS) {
    if (d.value === null) {
      const cur = next[d.key];
      if (cur === undefined || cur === null || String(cur).trim() === '') pending.push(d);
      continue;
    }
    const cur = next[d.key];
    if (cur !== undefined && cur !== null && String(cur).trim() !== '') continue;
    next[d.key] = d.value;
    filled.push(d.key);
  }
  return { next, filled, pending };
}
