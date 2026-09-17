import 'server-only';

import { readWhitelabelCatalogFromErp5 } from '@/lib/server/whitelabel-erp5-catalog';
import { sanitizeAgentForGuest, sanitizeProductForGuest } from '@/lib/domain/public-catalog';
import { isListableProduct } from '@/lib/domain/product';
import { matchAgentByShareCode } from '@/lib/domain/product-share';
import { companyAlias } from '@/lib/domain/identity';
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/**
 * **손님 목록 한 벌 — «세는 곳»을 한 곳으로 모은다.**
 *
 * ★★★사장님 2026-09-16 「화이트라벨 **새로고침하거나 새로 들어오면 왜 바로 안 열리지**?? ·
 *   **필터는 바로 열려야지**」.
 *
 * ⚠⚠ **왜 떼어냈나.** 이 셈이 `app/api/catalog/feed/route.ts` «안»에만 있었다. 필터를 서버가
 *   같이 그리려면 서버 껍데기(`app/(shop)/shop/page.tsx`)도 같은 목록을 알아야 하는데,
 *   그때 이 로직을 **한 번 더 적으면** 두 곳이 갈린다.
 *   ★이 저장소가 그 사고를 이미 겪었다 — 「모수를 영업자 잣대로 세다 축 셋을 잃음」(`lib/shop/query`
 *     머리말) · 「대수가 두 군데서 세어져 어느 숫자도 못 믿게 된다」(CLAUDE.md).
 *   ⇒ **필터가 세는 모수와 목록이 세는 모수는 같은 함수에서 나와야 한다.**
 *
 * ★비싼 읽기는 아래 `readWhitelabelCatalogFromErp5` 가 60초 쥔다 — 그래서 껍데기가 이걸 또 불러도
 *   Firestore 를 두 번 읽지 않는다(그 머리말 참고).
 */
export async function loadGuestListing(options: { providerCode?: string; share?: string } = {}): Promise<{
  products: EntityRecord[];
  /** 화이트라벨 — 공급사를 지정했을 때만 그 회사 이름. */
  brand: string;
  agent: ReturnType<typeof sanitizeAgentForGuest> | null;
}> {
  const providerCode = S(options.providerCode);
  const share = S(options.share);

  /*
   * ★★**파이어스토어만 읽는다**(사장님 2026-09-05 「**RTDB 안 쓴다니까?** 파이어스토어만 갖고 와」).
   *   컬렉션 이름은 이관 규격을 따른다 — 재고 `products` · 정책 **`policy`** · 공급사 `partner` ·
   *   사용자 `user`(RTDB 시절 `v4/products`·`policies`·`partners`·`users` 자리).
   * ⚠ 문서 id 는 «차번»이고 RTDB 키는 「공급사_차번」이었다 — 그래서 키는 `_key || product_code || id`
   *   차례로 잡는다. 이미 나간 공유 링크(`/q/RP012_122두8108`)는 `product_code` 로 계속 열린다.
   * ★Firestore 장애는 오래된 RTDB 자료로 숨기지 않는다 — 부르는 쪽이 503 으로 드러낸다.
   *   그래야 웹과 모바일이 서로 다른 원장을 보고 다른 재고를 표시하는 일이 없다.
   */
  const src = await readWhitelabelCatalogFromErp5({ includePartners: !!providerCode, includeUsers: !!share });
  const policies = Object.entries(src.policies).map(([policyKey, value]) => ({ ...(value || {}), _key: policyKey } as Rec));

  const products: EntityRecord[] = [];
  for (const [docKey, p] of Object.entries(src.products)) {
    const key = S(p?._key) || S(p?.product_code) || docKey;
    if (!p || typeof p !== 'object' || dead(p)) continue;
    if (providerCode && S(p.provider_company_code) !== providerCode && S(p.partner_code) !== providerCode) continue;
    const merged = { ...p, _key: key, product_code: S(p.product_code) || key } as EntityRecord;
    // 목록에 실을 수 있는 것만 — 판정은 앱과 같은 SSOT 를 쓴다.
    if (!isListableProduct(merged)) continue;
    const policy = policies.find((value) => S(value.policy_code) === S(p.policy_code) || S(value._key) === S(p.policy_code)) || null;
    products.push(sanitizeProductForGuest(key, p, policy));
  }

  /*
   * 화이트라벨 — 공급사를 지정했을 때만 그 회사 이름을 준다(전체 파트너 목록은 내보내지 않는다).
   *  ★실데이터는 이름이 `name` 에 있고 `partner_code` 가 빈 레코드도 있다(RP004 실측 2026-08-08)
   *   → 코드는 child 키까지 보고, 이름은 세 필드를 다 훑는다. 안 그러면 브랜드가 조용히 빈다.
   */
  let brand = '';
  if (providerCode) {
    const hit = Object.entries(src.partners)
      .map(([id, value]) => ({ ...(value || {}), _id: id } as Rec)).find((x) => x && (
        S(x._id) === providerCode || S(x.partner_code) === providerCode || S(x.company_code) === providerCode
      ));
    // 손님이 보는 이름에 법인격을 붙이지 않는다 — 표기 SSOT 는 companyAlias.
    brand = companyAlias(S(hit?.partner_name || hit?.company_name || hit?.name), hit?.alias as string | undefined);
  }

  let agent: ReturnType<typeof sanitizeAgentForGuest> | null = null;
  if (share) {
    const rows = Object.entries(src.users)
      .map(([id, value]) => ({ ...(value || {}), _key: S(value?._key) || id, uid: S(value?.uid) || id })) as EntityRecord[];
    agent = sanitizeAgentForGuest(matchAgentByShareCode(rows, share) as Rec | null);
  }

  return { products, brand, agent };
}
