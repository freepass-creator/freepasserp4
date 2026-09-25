import { NextResponse } from 'next/server';
import { loadGuestListing } from '@/lib/server/guest-listing';
import { guestProviderFence, resolveGuestWhitelabel } from '@/lib/whitelabel';
import { FREEPASS_CATALOG_CONTRACT_VERSION } from '@/lib/domain/freepass-catalog-contract';

export const dynamic = 'force-dynamic';
const S = (v: unknown) => String(v ?? '').trim();

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
    /*
     * 상품·정책·공급사·영업자는 모두 Firestore 컬렉션에서만 읽는다.
     * Firestore 장애는 오래된 RTDB 자료로 숨기지 않고 503으로 드러낸다. 그래야 웹과
     * 모바일이 서로 다른 원장을 보고 다른 재고를 표시하는 일이 없다.
     */
    /*
     * 공개 목록은 ERP5 Firestore 검증 발행본만 읽는다. 실패 시 다른 원장으로 우회하지 않는다.
     *
     * ★★**세는 일은 `loadGuestListing` 한 곳이다**(2026-09-16 여기서 떼어냈다).
     *   서버 껍데기(`app/(shop)/shop/page.tsx`)가 **필터 집계를 같이 그리려고** 같은 목록을
     *   알아야 했는데, 거기에 이 셈을 한 번 더 적으면 두 곳이 갈린다 — 이 저장소가 겪은 그 사고다
     *   (「대수가 두 군데서 세어져 어느 숫자도 못 믿게 된다」 · 「모수를 영업자 잣대로 세다 축 셋을 잃음」).
     * ★비싼 읽기는 카탈로그 읽개가 60초 쥔다 — 껍데기가 또 불러도 Firestore 를 두 번 안 읽는다.
     */
    const { products, brand, agent } = await loadGuestListing({ providerCode, share });

    return NextResponse.json(
      { contractVersion: FREEPASS_CATALOG_CONTRACT_VERSION, count: products.length, products, brand, agent },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[catalog/feed]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '카탈로그를 불러오지 못했습니다.' }, { status: 503 });
  }
}
