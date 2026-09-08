/**
 * 원자 «해소기» (SSOT) — 한 매물(product)에 정책·회사명·상품구분·요금을 «한 곳에서» 붙인다.
 *
 * ★사장님 2026-09-08 「원자를 적용하는 데 비효율 없냐 → join을 한 곳으로 모으고 소비처가 그걸 읽게」.
 *   그동안 정책·회사명·요금 조인이 materialize(상품리스트) · /spring(샘) · finder(상품찾기)에 «제각각» 있어
 *   하나 고치면 나머지가 안 따라와 갈렸다(원천지도가 경고한 그 문제). 여기 «하나»로 모은다.
 *   각 소비처는 이 결과(ResolvedAtom)를 «자기 모양으로 포맷만» 한다(시트=69칸 · 샘=상세 · 카드=요약).
 *
 * 조립 재료(이미 있는 leaf 들 — 새 로직 안 만든다):
 *   · 상품구분  = canonProductType (product.ts)
 *   · 회사명    = companyAlias (identity.ts)  ← 코드 아니라 «이름»
 *   · 정책      = autoPolicyCode(공급사 매칭·빈칸이면 회사 정책) + joinPolicy(코드→정책, 제로패딩 폴백)
 *   · 요금      = fareTable / lowestRent (atom-health.ts)
 */
import { canonProductType } from './product';
import { companyAlias } from './identity';
import { autoPolicyCode, groupPoliciesByProvider, type PolicyLite } from './supplier-policy-link';
import { joinPolicy, fareTable, lowestRent, type FareTable } from './atom-health';

const S = (v: unknown) => String(v ?? '').trim();

/** 해소에 필요한 참조 묶음 — 매물마다 다시 만들지 않게 한 번 만들어 넘긴다. */
export interface AtomRefs {
  policyByCode: Map<string, Record<string, unknown>>;   // policy_code → 정책 문서 (joinPolicy 용)
  byProvider: Map<string, PolicyLite[]>;                // 공급사코드 → 그 회사 정책들 (autoPolicyCode 용)
  providerNames?: Map<string, string>;                  // 공급사코드 → 회사명(보조; product.provider_name 우선)
}

/** 매물에 붙는 «해소된 원자» — 소비처는 이걸 포맷만 한다. */
export interface ResolvedAtom {
  productType: string;                                  // 상품구분 (7캐논)
  company: string;                                      // 회사명 (코드 아님)
  policyCode: string;                                   // 적힌 값 | 회사 정책 자동해소
  policyName: string;
  policy: Record<string, unknown> | null;               // 조인된 정책 문서 (없으면 null)
  fare: FareTable;
  lowestRent: number;
}

/** policies·partners 배열 → AtomRefs. 한 번 만들어 여러 매물에 쓴다. */
export function buildAtomRefs(
  policies: Array<Record<string, unknown>>,
  providerNames?: Map<string, string>,
): AtomRefs {
  const policyByCode = new Map<string, Record<string, unknown>>();
  for (const p of policies) { const c = S(p.policy_code) || S(p._key); if (c) policyByCode.set(c, p); }
  return { policyByCode, byProvider: groupPoliciesByProvider(policies), providerNames };
}

/** 한 매물 → 해소된 원자. «정책·회사·상품·요금을 붙이는 유일한 곳». */
export function resolveAtom(p: Record<string, unknown>, refs: AtomRefs): ResolvedAtom {
  const provCode = S(p.provider_company_code) || S(p.partner_code);
  const rawName = S(p.provider_name) || refs.providerNames?.get(provCode) || provCode;
  const policyCode = autoPolicyCode(p, refs.byProvider);          // 적힌 값 우선 · 없으면 회사 정책(1개→자동·렌트/구독)
  const policy = policyCode ? joinPolicy(refs.policyByCode, policyCode) : null;
  return {
    productType: canonProductType(p.product_type),
    company: companyAlias(rawName) || rawName,
    policyCode,
    policyName: policy ? (S(policy.policy_name) || S(policy.term_name)) : '',
    policy,
    fare: fareTable(p.price),
    lowestRent: lowestRent(p.price),
  };
}
