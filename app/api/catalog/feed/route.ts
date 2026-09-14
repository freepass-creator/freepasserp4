import { NextResponse } from 'next/server';
import { readWhitelabelCatalogFromErp5 } from '@/lib/server/whitelabel-erp5-catalog';
import { sanitizeAgentForGuest, sanitizeProductForGuest } from '@/lib/domain/public-catalog';
import { isListableProduct } from '@/lib/domain/product';
import { matchAgentByShareCode } from '@/lib/domain/product-share';
import type { EntityRecord } from '@/lib/intake/entities';
import { companyAlias } from '@/lib/domain/identity';
import { guestProviderFence, resolveGuestWhitelabel } from '@/lib/whitelabel';
import { createPublicPolicyResolver } from '@/lib/server/public-policy-resolver';

export const dynamic = 'force-dynamic';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/**
 * 손님 공개 카탈로그 — `/catalog` 이 쓴다. **인증 없이** 호출된다.
 *
 * `/api/catalog/quote` 와 같은 원칙: 브라우저에 RTDB 권한을 주지 않고 서버가 서비스계정으로
 * 읽어 화이트리스트만 통과시킨다. 예전 `/catalog` 는 브라우저에서 products **와 partners 전량**을
 * 직접 읽어, 규칙을 열어 해결했다면 공급사 명단까지 통째로 샜을 구조였다.
 *
 *   ?p={공급사코드}  그 공급사 매물만 — 화이트라벨 카탈로그(brand 에 회사명)
 *   ?a={영업 user_code}  담당 영업자 연락처(이름·전화만)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  /*
   * ★★**공급사 울타리는 «서버»가 정한다 — 손님이 준 `?p=` 를 믿지 않는다.**
   *
   * ⚠⚠ 2026-09-10 코덱스 검토에서 운영 재현 —
   *   `/api/catalog/feed?p=RP023&wl=eancar` 가 **오토플러스 71대**를 이안카 채널로 내려 줬다.
   *   이 줄이 `?p=` 를 그대로 믿고 있었기 때문이다. 이안카에 「이안카 차만」이라 약속해 놓고
   *   주소 한 줄로 남의 재고가 서던 자리다.
   * ⇒ 호스트(+ 미리보기 `?wl=`)로 채널을 풀고, 그 채널이 제 코드를 가졌으면 **그것이 이긴다**
   *   (`guestProviderFence` — 판정은 표 한 곳에 있다).
   * ★코드가 없는 채널에서만 `?p=` 가 산다 — 그 채널은 이미 재고 전체를 파는 곳이라
   *   거기서 `?p=` 는 울타리가 아니라 «추림»이다.
   */
  const wl = resolveGuestWhitelabel(request.headers.get('host'), url.searchParams.get('wl'));
  const providerCode = guestProviderFence(wl, url.searchParams.get('p'));
  const share = S(url.searchParams.get('a'));

  try {
    /*
     * ★★**파이어스토어만 읽는다**(사장님 2026-09-05 「**RTDB 안 쓴다니까?** 파이어스토어만 갖고 와」).
     *   컬렉션 이름은 이관 규격을 따른다 — 재고 `products` · 정책 **`policy`** · 공급사 `partner` ·
     *   사용자 `user`(RTDB 시절 `v4/products`·`policies`·`partners`·`users` 자리).
     * ★실측(2026-09-05) — products 1,375 · policy 81 · partner 64 · user 168.
     *   손님 목록 기준으로 파이어스토어 729대 · RTDB 721대이고 **RTDB 에만 있는 차는 0대**다.
     *   즉 파이어스토어가 최신이고 상위집합이다.
     * ⚠ 문서 id 는 «차번»이고 RTDB 키는 「공급사_차번」이었다 — 그래서 키는 `_key || product_code || id`
     *   차례로 잡는다. 이미 나간 공유 링크(`/q/RP012_122두8108`)는 `product_code` 로 계속 열린다.
     */
    // 기본 공통 목록은 재고·정책만 필요하다. 채널/영업자 링크일 때만 추가 원자를 읽는다.
    const src = await readWhitelabelCatalogFromErp5({
      includePartners: !!providerCode,
      includeUsers: !!share,
    });
    const resolvePolicy = createPublicPolicyResolver(
      Object.values(src.policies).filter((v): v is Rec => !!v && typeof v === 'object'),
    );

    const products: EntityRecord[] = [];
    for (const [docKey, p] of Object.entries(src.products)) {
      const key = S(p?._key) || S(p?.product_code) || docKey;
      if (!p || typeof p !== 'object' || dead(p)) continue;
      if (providerCode && S(p.provider_company_code) !== providerCode && S(p.partner_code) !== providerCode) continue;
      const merged = { ...p, _key: key, product_code: S(p.product_code) || key } as EntityRecord;
      // 목록에 실을 수 있는 것만 — 판정은 앱과 같은 SSOT 를 쓴다.
      if (!isListableProduct(merged)) continue;
      const policy = resolvePolicy(p);
      products.push(sanitizeProductForGuest(key, p, policy.policy));
    }

    // 화이트라벨 — 공급사를 지정했을 때만 그 회사 이름을 준다(전체 파트너 목록은 내보내지 않는다).
    //  ★실데이터는 이름이 `name` 에 있고 `partner_code` 가 빈 레코드도 있다(RP004 실측 2026-08-08)
    //   → 코드는 child 키까지 보고, 이름은 세 필드를 다 훑는다. 안 그러면 브랜드가 조용히 빈다.
    let brand = '';
    if (providerCode) {
      const hit = Object.entries(src.partners)
        .map(([k, v]) => ({ ...(v || {}), _id: k } as Rec)).find((x) => x && (
          S(x._id) === providerCode || S(x.partner_code) === providerCode || S(x.company_code) === providerCode
        ));
      // 손님이 보는 이름에 법인격을 붙이지 않는다 — 표기 SSOT 는 companyAlias.
      brand = companyAlias(S(hit?.partner_name || hit?.company_name || hit?.name), hit?.alias);
    }

    let agent = null;
    if (share) {
      const rows = Object.entries(src.users)
        .map(([k, v]) => ({ ...(v || {}), _key: S(v?._key) || k, uid: S(v?.uid) || k })) as EntityRecord[];
      agent = sanitizeAgentForGuest(matchAgentByShareCode(rows, share) as Rec | null);
    }

    return NextResponse.json(
      { count: products.length, products, brand, agent },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('[catalog/feed]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '카탈로그를 불러오지 못했습니다.' }, { status: 503 });
  }
}
