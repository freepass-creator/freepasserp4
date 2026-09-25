import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ShopView } from './ShopView';
import { coBrandName, guestProviderFence, hasBrand, resolveGuestWhitelabel, ogImage, OG_SIZE } from '@/lib/whitelabel';
import { readShopQuick } from '@/lib/server/shop-quick-store';
import { loadGuestListing } from '@/lib/server/guest-listing';
import { readQuery, runShopQuery, type ShopFacets } from '@/lib/shop/query';
import type { FreepassCatalogProduct } from '@/lib/domain/freepass-catalog-contract';

/** 첫 화면을 덮는 카드 수 — 웹 3열×2줄. 이만큼만 서버가 그린다(아래 머리말). */
const FIRST_SCREEN = 6;

/**
 * 가게의 **서버 껍데기**. 화면은 `ShopView`(클라이언트)가 그린다.
 *
 * ★서버로 나눈 이유 둘 — `/q/[code]` 와 같다.
 *   ① **브랜드를 호스트로 정한다.** 클라이언트에서 정하면 브랜드 없는 맨 화면이 한 번 그려진 뒤
 *      머리띠가 뒤늦게 붙는다(globals.css 「칠하는 주체는 CSS 다」와 같은 함정).
 *   ② **카톡·문자 미리보기.** 미리보기 카드는 서버가 내려준 og 태그만 읽는다 —
 *      화이트라벨 도메인으로 나간 링크에 루트 레이아웃의 `freepasserp.com` 이 붙으면
 *      **우리 정체가 손님 카톡방에 먼저 뜬다.**
 *
 * ⚠ 주소가 `/catalog` 가 아니라 `/shop` 인 이유 — `/catalog` 는 노브랜드 프리패스 화면이
 *   쓰던 자리다. 손님 동을 그 안의 분기로 두었다가 조건 축 셋을 잃는 사고가 나서 동을 갈랐다
 *   (2026-09-04). 채널 도메인(uniautofreepass.com)이 붙으면 그 도메인의 `/` 가 여기를 가리킨다.
 */
export const dynamic = 'force-dynamic';

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  const sp = await searchParams;
  const wl = resolveGuestWhitelabel((await headers()).get('host'), one(sp.wl));

  // 노브랜드면 루트 레이아웃 기본값을 그대로 쓴다 — 아무것도 덮지 않는다.
  if (!hasBrand(wl)) return {};

  // ⚠ title 은 **absolute** 로 준다 — 루트 레이아웃 template(`%s · freepasserp.com`)이 브랜드를 도로 붙인다.
  /* ★브라우저 탭·공유 미리보기도 «채널 ✕ freepass» 다(`coBrandName` 머리말). */
  const title = coBrandName(wl);
  const description = `${wl.name} 즉시출고 차량 — 조건별로 골라 보세요.`;
  const og = ogImage(wl);
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    /*
     * ★★**공유 미리보기 그림을 «우리가» 정한다**(`ogImage` 머리말). 안 주면 카카오가
     *   페이지에서 아무 그림이나 주워다 정사각으로 잘라, 간판이 잘린 채 나간다.
     * ★`summary_large_image` — 1200×630 을 주므로 큰 카드로 그리게 한다.
     *   작은 카드로 두면 그 넓은 그림을 다시 정사각으로 자른다.
     */
    openGraph: {
      type: 'website', title, description, siteName: coBrandName(wl),
      ...(og ? { images: [{ url: og, ...OG_SIZE, alt: wl.name }] } : null),
    },
    twitter: { card: og ? 'summary_large_image' : 'summary', title, description, ...(og ? { images: [og] } : null) },
  };
}

export default async function ShopPage({ searchParams }: Params) {
  const sp = await searchParams;
  // 호스트가 정본이고 `?wl=` 은 도메인 붙이기 «전» 미리보기용 — 상세(`/q`)와 같은 규칙이다.
  const wl = resolveGuestWhitelabel((await headers()).get('host'), one(sp.wl));
  /*
   * ★★**화면에서 고친 빠른조건은 «서버»가 실어 보낸다**(사장님 2026-09-10 「퀵필터를 수정할 수
   *   있게 해주면 좋겠어」). 클라이언트에서 뒤늦게 받아 오면 **칩 줄이 한 번 그려진 뒤 바뀐다** —
   *   손님 눈에는 화면이 흔들리는 것이고, 머리띠를 서버로 옮긴 이유(위 머리말 ①)와 같은 함정이다.
   * ★고친 적 없는 채널은 `null` 이라 **채널 표의 기본판**이 그대로 선다 — 한 픽셀도 안 바뀐다.
   */
  const quick = await readShopQuick(wl.key);
  /*
   * ★★★**필터·건수는 «서버»가 같이 내려준다 — 손님이 기다리지 않게**(사장님 2026-09-16
   *   「화이트라벨 **새로고침하거나 새로 들어오면 왜 바로 안 열리지**?? · **필터는 바로 열려야지**」).
   *
   * ⚠⚠ 전에는 껍데기가 `wl` 만 넘겼다. 그래서 순서가 「HTML → 브라우저가 목록 요청 → 그제야 필터」였고,
   *   그 사이 왼쪽 기둥이 비어 있었다. 실측(운영) — HTML 1.0초 **+ 목록 1.7초**.
   *   ★상세(`/q`)는 이미 서버가 읽은 것을 넘긴다(「브라우저가 다시 묻지 않게」 · 2026-09-07).
   *     목록만 그 규칙 밖에 있었다.
   *
   * ★**집계만 넘긴다 — 목록 전체는 안 넘긴다.** 행 1592대를 HTML 에 실으면 252KB(압축)가
   *   RSC 페이로드로 한 번 더 붙어 되레 느려진다. 필터가 필요한 것은 «축별 숫자»뿐이고 그건 작다.
   *   카드는 목록 응답이 오면 그린다(캐시가 더워 0.5초).
   * ★★**세는 함수가 같아야 한다** — `loadGuestListing` + `runShopQuery` 로 목록 API 와 «같은 모수»를
   *   쓴다. 따로 세면 필터 숫자와 목록 건수가 갈린다(이 저장소가 겪은 그 사고).
   * ★조건도 **같은 읽개**(`readQuery`)로 읽는다 — 조건이 걸린 링크로 들어와도 서버가 낸 숫자와
   *   브라우저가 낸 숫자가 같다. 안 맞추면 숫자가 한 번 튄다.
   * ⚠ 실패하면 조용히 넘어간다 — 집계는 «먼저 보여 주려고» 있는 곁다리다. 없으면 예전처럼
   *   브라우저가 받아 그린다. 곁다리가 첫 화면을 막으면 안 된다.
   */
  let initial: { facets: ShopFacets; total: number; list: FreepassCatalogProduct[] } | null = null;
  try {
    const { products } = await loadGuestListing({ providerCode: guestProviderFence(wl, one(sp.p)) });
    const q = readQuery(new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v == null ? [] : [[k, v]])) as [string, string][],
    ));
    const { facets, total, list } = runShopQuery(products, q);
    /*
     * ★★★**눈에 보이는 카드까지만 넘긴다 — 사진이 HTML 과 «같이» 출발하게**(사장님 2026-09-16
     *   「**눈에 보이는 사진은 좀 빠르게** 뜨게 해줄 수 있나? **나머지는 그렇다 쳐도**」).
     *
     * ⚠⚠ 실측으로 잡았다 — 사진은 «받는 게» 느린 게 아니었다. 최적화된 그림은 7KB AVIF 에
     *   캐시에서 0.07초다(원본 1.44MB → 7KB). 그런데 **시작이 6.4초**였다:
     *   카드가 그려져야 `<img>` 가 생기고, 카드는 목록 응답을 기다린다. 사진은 그 뒤에 줄을 선다.
     * ⇒ 첫 화면 카드를 **서버가 그려** 보내면, 브라우저가 HTML 을 읽는 순간 그림을 받기 시작한다.
     *
     * ★**`FIRST_SCREEN`(6장)만.** 「나머지는 그렇다 쳐도」 하셨다 — 아래로 스크롤해야 보이는 카드는
     *   지금처럼 목록이 온 뒤에 그린다. 행 하나가 26칸이라 6장이 ~25KB 고, RSC 페이로드에 한 번 더
     *   붙으니 그 두 배다. 12장을 넘기면 HTML 이 50KB 커져 «HTML 이» 늦는다 — 배보다 배꼽이다.
     * ★앞 세 장은 `ShopCard` 가 `priority` 를 건다(그 원자의 `rank`) — 브라우저에 「이게 먼저」라고 말한다.
     */
    initial = { facets, total, list: list.slice(0, FIRST_SCREEN) };
  } catch { /* 곁다리다 — 브라우저가 받아 그린다 */ }

  return <ShopView wl={quick ? { ...wl, quick } : wl} initial={initial} />;
}
