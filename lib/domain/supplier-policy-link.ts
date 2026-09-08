/**
 * 공급사 «입력 정책» → 매물 자동연결 (데이터 주도 · 코드 하드코딩 없음).
 *
 * ★사장님 2026-09-08 「모든 공급사 이제 정책 입력시킬 거니까, 입력하면 연동 돌 때 들어갈 수 있게끔」
 *   + 「공급사·코드명 다 갈아엎을 거니까 참고해」.
 *   ⇒ 규칙을 **코드 값(RP023…)으로 박지 않는다.** 매물의 `provider_company_code` 와 정책의 `provider_company_code`
 *     를 «값으로 맞대」 연결한다. 공급사 코드를 갈아엎어도 «양쪽을 같이» 갈면 매칭은 그대로 산다.
 *
 * ★★빈칸만 채운다 — 이미 적힌 policy_code 는 절대 안 덮는다(사람이 특약을 정했을 수 있다).
 *
 * 연결 규칙(공급사 하나 안에서):
 *   · 정책이 **1개** → 그걸 붙인다(오플처럼 「정책 1개」인 공급사는 이걸로 끝).
 *   · 정책이 **여럿** → 상품구분(product_type)이 정책명·term에 «담겨 있으면» 그걸로 고른다(손오공 렌트/구독).
 *   · 그래도 못 정하면 → 빈칸(사람이 재고관리 「정책 연결」에서 정한다). 지어내지 않는다.
 */

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

export interface PolicyLite { policy_code: string; provider_company_code: string; policy_name: string; product_types?: string[]; }

/**
 * 상품구분/정책명 → «렌트 or 구독» 버킷 (사장님 2026-09-08 「렌트와 구독 나눠서 번호판으로 정책 매칭하면 되고」).
 *   구독(픽업구독·중고구독·오플구독·오공구독·신차구독) vs 렌트(신차렌트·중고렌트·재렌트). 못 정하면 ''.
 */
export function rentSubBucket(text: unknown): '렌트' | '구독' | '' {
  const s = String(text ?? '');
  if (/구독/.test(s)) return '구독';
  if (/렌트|재렌|재랜/.test(s)) return '렌트';
  return '';
}

/** 정책 원자 배열 → 공급사코드별 그룹(삭제/코드없음 제외). */
export function groupPoliciesByProvider(policies: Rec[]): Map<string, PolicyLite[]> {
  const by = new Map<string, PolicyLite[]>();
  for (const p of policies) {
    if (dead(p)) continue;
    const prov = S(p.provider_company_code);
    const code = S(p.policy_code) || S(p._key);
    if (!prov || !code) continue;   // 공용(provider 없는) 정책은 자동연결 대상 아님 — 사람이 고른다
    const lite: PolicyLite = { policy_code: code, provider_company_code: prov, policy_name: S(p.policy_name) || S(p.term_name), product_types: Array.isArray(p.product_types) ? (p.product_types as string[]).map(S) : undefined };
    (by.get(prov) || by.set(prov, []).get(prov)!).push(lite);
  }
  return by;
}

/**
 * 이 매물이 «자동으로 붙을» 정책코드. 빈칸일 때만. 못 정하면 ''(사람이 정함).
 * @param product 매물 원자(products)
 * @param byProvider groupPoliciesByProvider() 결과
 */
export function autoPolicyCode(product: Rec, byProvider: Map<string, PolicyLite[]>): string {
  if (S(product.policy_code)) return S(product.policy_code);         // 적힌 값이 이긴다 — 안 덮는다
  const prov = S(product.provider_company_code) || S(product.partner_code);
  if (!prov) return '';
  const cands = byProvider.get(prov) || [];
  if (cands.length === 0) return '';                                 // 그 공급사 정책 아직 입력 안 됨
  if (cands.length === 1) return cands[0].policy_code;               // 정책 1개(오플) → 자동
  // 여럿 — «렌트/구독»으로 나눠 번호판(이 매물)의 상품구분과 맞댄다(사장님 2026-09-08 손오공·이안카 모델)
  const bucket = rentSubBucket(product.product_type);
  if (bucket) {
    const byBucket = cands.filter((c) => rentSubBucket((c.product_types || []).join(' ') + ' ' + c.policy_name) === bucket);
    if (byBucket.length === 1) return byBucket[0].policy_code;
  }
  // 그래도 여럿이면 상품구분 정확일치로 한 번 더
  const type = S(product.product_type);
  const byType = cands.filter((c) => (c.product_types && c.product_types.includes(type)) || (type && c.policy_name.includes(type)));
  if (byType.length === 1) return byType[0].policy_code;
  return '';                                                          // 모호 → 사람이 재고관리에서 정한다
}

/** products × policies → 빈칸 매물에 붙일 {car_number/id → policy_code}. 이미 적힌 것·못 정한 것은 뺀다. */
export function planPolicyLinks(products: Array<{ id: string; data: Rec }>, policies: Rec[]): Array<{ id: string; policy_code: string; policy_name: string }> {
  const byProvider = groupPoliciesByProvider(policies);
  const out: Array<{ id: string; policy_code: string; policy_name: string }> = [];
  for (const { id, data } of products) {
    if (dead(data) || S(data.policy_code)) continue;                 // 빈칸만
    const code = autoPolicyCode(data, byProvider);
    if (!code) continue;
    const prov = S(data.provider_company_code) || S(data.partner_code);
    const nm = (byProvider.get(prov) || []).find((c) => c.policy_code === code)?.policy_name || '';
    out.push({ id, policy_code: code, policy_name: nm });
  }
  return out;
}
