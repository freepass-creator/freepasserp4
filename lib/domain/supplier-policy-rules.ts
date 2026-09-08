import type { EntityRecord } from '@/lib/intake/entities';

/**
 * **공급사 × 상품구분 → 정책** 규칙표(SSOT).
 *
 * ★왜 «칸»이 아니라 «규칙»인가 (사장님 2026-09-04
 *   「이제 정제 칸을 채울 필요 없이 우리가 그냥 원문을 파이어스토어에다가 채우기로 했잖아」)
 *   전에는 공급사 시트의 「정책코드」 칸을 누군가 채워야 그 차에 조건이 붙었다. 안 채우면
 *   **팔 수 있다고 떠 있는데 보험·연령·주행을 아무도 모르는 차**가 된다 — 실측 2026-09-04
 *   손오공 610대 중 246대가 그랬고, 그중 232대가 「픽업구독」 한 칸이었다.
 *   정책이 «상품구분으로 정해지는» 공급사에게 칸을 채우게 하는 것은 사람에게 기계 일을 시키는 것이다.
 *   ⇒ 규칙을 여기 한 곳에 적고, 원자를 만들 때 규칙이 채운다. 칸은 더 이상 필요 없다.
 *
 * ★★**빈칸만 채운다. 이미 적힌 값은 절대 안 덮는다.**
 *   적힌 값은 사람이 정한 것일 수 있다(그 차만 특약이 다르다든지). 규칙이 그것을 덮으면
 *   계약서 조항이 조용히 바뀐다 — 정책은 보험·연령·주행·면책이 실리는 값이다.
 *
 * ★넓히는 법 — 아래 표에 줄을 더한다. 무엇을 더할지는 **지어내지 말고**
 *   `npm run audit:policy-rules` 로 「지금 그 공급사가 실제로 무엇을 쓰고 있나」를 보고 정한다.
 *   한 칸에 정책이 하나뿐이면 그게 곧 규칙이고, 여럿이면 사람이 정해야 한다.
 */

/** 상품구분 하나에 대한 정책. `null` = 규칙 없음(사람이 정해야 한다). */
export type PolicyRule = Record<string, string>;

export const SUPPLIER_POLICY_RULES: Record<string, PolicyRule> = {
  /**
   * 손오공렌터카 — 사장님 2026-09-04 「손오공 구독은 정책이 다 똑같아. 렌트와 구독 정책 딱 두 개 있어.」
   * 실측도 같다: 픽업구독 281대가 이미 POL-0020 하나만 쓰고, 중고렌트는 POL-0046 이다.
   * ⚠ `FP-RP012-RENT`(손오공 · 프리패스 공통 렌트)를 쓰는 24대가 따로 있다. 무엇인지 확인 전이라
   *   규칙에 넣지 않았다 — **빈칸만 채우므로 그 24대는 건드리지 않는다.**
   */
  RP012: {
    픽업구독: 'POL-0020',
    중고구독: 'POL-0020',
    중고렌트: 'POL-0046',
  },
};

/** 그 공급사·그 상품구분에 정해진 정책이 있나. 없으면 빈 문자열. */
export function policyByRule(supplierCode: unknown, productType: unknown): string {
  const c = String(supplierCode ?? '').trim();
  const t = String(productType ?? '').trim();
  if (!c || !t) return '';
  return SUPPLIER_POLICY_RULES[c]?.[t] || '';
}

/**
 * 이 매물의 정책코드 — **적힌 값이 이긴다.** 비어 있을 때만 규칙이 채운다.
 * 원자를 만드는 쪽(Firestore 미러 등)이 이 함수를 쓴다.
 */
export function resolvePolicyCode(p: EntityRecord): string {
  const written = String(p.policy_code ?? '').trim();
  if (written) return written;
  return policyByRule(p.provider_company_code || p.partner_code, p.product_type);
}
