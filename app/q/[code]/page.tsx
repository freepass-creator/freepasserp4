import type { Metadata } from 'next';
import { QuoteView } from './QuoteView';
import { ShopDetailView } from './ShopDetailView';
import { firstProductImage } from '@/lib/domain/product-photos';
import { headers } from 'next/headers';
import { loadGuestQuote } from '@/lib/server/guest-quote';
import { coBrandName, hasBrand, resolveGuestWhitelabel } from '@/lib/whitelabel';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { cheapest } from '@/lib/domain/product';
import { fuelDisplay, yearDisplay } from '@/lib/domain/vehicle-master-match';
import { kmDisplay, man } from '@/lib/format';

/**
 * 손님 대면 **상품 안내**(화이트라벨) — 이 파일은 «서버 껍데기»다. 화면은 `QuoteView`(클라이언트)가 그린다.
 *
 * ★서버로 나눈 이유 = **카톡·문자 미리보기**(사장님 2026-08-22 「손님한테 나가는 공유링크가 freepasserp.com 은
 *   안 떠도 될 것 같고 담당자명이 뜨는 게 나을 것 같음, 우리를 최대한 감춰야 하고」).
 *   미리보기 카드는 **서버가 내려준 og 태그**만 읽는다 — 클라이언트에서 `document.title` 을 바꿔도
 *   카톡은 그 전에 태그를 긁어 가므로 예전에는 루트 레이아웃의 `freepasserp.com — 장기렌터카 영업지원 플랫폼`이
 *   그대로 나갔다(우리 정체가 손님 카톡방에 먼저 뜬다).
 *   여기서 제목=**차량번호 차명**, 설명 2줄(연식·주행·연료 / 기간·월대여료·보증금),
 *   사이트 이름=**담당자**로 덮어쓴다.
 *
 * ⚠ 남는 것: 링크의 **도메인 글자(freepasserp.com)** 자체는 미리보기 카드·주소창에 보인다 —
 *   그건 표기 문제가 아니라 «어느 주소로 여느냐»라서, 지우려면 손님용 도메인을 따로 붙여야 한다(미결).
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { code } = await params;
  const sp = await searchParams;
  // 조각은 통째로 넘긴다 — 가르는 판단은 loadGuestQuote 가 «못 찾았을 때만» 한다(하이픈 품은 상품키 보호).
  const seg = decodeURIComponent(String(code || ''));
  const share = one(sp.a);
  /** 브랜드 도메인이면 못 찾았을 때도 «그 회사 이름»으로 떨어진다 — 「상품 안내」는 노브랜드용이다. */
  const wl = resolveGuestWhitelabel((await headers()).get('host'), one(sp.wl));
  /* ★사이트 이름은 «채널 ✕ freepass» — 탭 제목은 그 «차»가 주인이라 그대로 둔다. */
  const fallbackSite = hasBrand(wl) ? coBrandName(wl) : '상품 안내';

  // 상품이 없거나 읽기에 실패해도 **브랜드가 새면 안 된다** — 중립 문구로 떨어뜨린다.
  // ⚠ title 은 **absolute** 로 준다 — 루트 레이아웃 template(`%s · freepasserp.com`)이 브랜드를 도로 붙인다.
  const neutral: Metadata = {
    title: { absolute: '상품 안내' },
    description: '차량 상품 안내입니다.',
    robots: { index: false, follow: false },
    openGraph: { title: '상품 안내', description: '차량 상품 안내입니다.', siteName: fallbackSite, type: 'website' },
    twitter: { card: 'summary', title: '상품 안내', description: '차량 상품 안내입니다.' },
  };

  try {
    const found = await loadGuestQuote(seg, share);
    if (!found) return neutral;
    const { product, agent } = found;
    /**
     * 미리보기 3줄(사장님 2026-08-22 확정):
     *   제목  **차량번호 차명**
     *   1줄   연식 · 주행 · 연료      ← 차번은 제목이 들었으니 여기서 빼 중복을 없앤다
     *   2줄   기간 · 월대여료 · 보증금  ← 손님이 실제로 묻는 값(최저 기간, 카드가 보여 주는 그 조건)
     * 담당자는 여기 넣지 않는다 — 사이트명 줄이 든다(「연식 나오는 줄에 담당자 정보가 있으면 안 되지」).
     */
    const plate = String(product.car_number || '').trim();
    const vehicle = vehicleNameOf({ kind: 'product', product }, { tier: 'full', fallback: 'none' }) || '차량 상품';
    const name = [plate, vehicle].filter(Boolean).join(' ');
    const specLine = [
      yearDisplay(product.year),
      kmDisplay(product.mileage),
      fuelDisplay(product.fuel_type) || String(product.fuel_type || '').trim(),
    ].filter(Boolean).join(' · ');
    const best = cheapest(product);
    const priceLine = best && best.rent > 0
      ? [`${best.m}개월`, `월 ${man(best.rent)}`, best.deposit > 0 ? `보증 ${man(best.deposit)}` : '무보증'].join(' · ')
      : '';
    const desc = [specLine, priceLine].filter(Boolean).join('\n') || '차량 상품 안내입니다.';
    // 사이트 이름 자리 = 담당자. 우리 브랜드(BRAND)는 손님 화면에 어디에도 쓰지 않는다.
    const who = String(agent?.name || '').trim();
    const siteName = who ? `담당 ${who}` : fallbackSite;
    /*
     * ★★**공유 미리보기 사진은 «카드와 같은 함수»로 고른다**(`firstProductImage`).
     *
     * 사장님 2026-09-08 「카카오톡 붙여넣으면 좀 맞춰서 주라」 · 「규격화 좀 해」.
     * ⚠⚠ 전에는 `image_urls` «배열»일 때만 붙였다. 그런데 원천마다 사진이 담긴 칸이 다르다 —
     *   `image_url`(홑) 인 차, 드라이브 폴더(`photo_link`)인 차가 있다.
     *   그래서 **사진이 있는데도 공유에는 안 나가는 차**가 있었다(실측 — `/q` 응답에 `og:image` 없음).
     *   영업자가 손님한테 «이 차»를 보내는 게 이 화면의 존재 이유인데, 그 링크에 사진이 없었다.
     * ⇒ 목록 카드가 쓰는 그 함수를 그대로 쓴다. 갈리면 「목록엔 사진이 있는데 공유엔 없는」 꼴이 된다.
     * ⚠ 폴더(드라이브)만 있는 차는 서버가 풀어야 나오는데 그건 느려서 «미리보기»에는 안 쓴다 —
     *   그런 차는 사진 없이 나간다(글자 카드). 링크가 안 열리는 것보다 낫다.
     * ★주소는 «절대»여야 한다 — 카톡은 우리 페이지 밖에서 그림을 받아 간다.
     *   루트 레이아웃의 `metadataBase` 가 상대주소를 절대주소로 바꿔 준다.
     */
    const photo = firstProductImage(product);
    const images = photo ? [photo] : [];

    return {
      title: { absolute: name },
      description: desc,
      robots: { index: false, follow: false },
      openGraph: {
        type: 'website',
        title: name,
        // 담당자는 **사이트명 줄**이 든다 — 스펙 줄에 또 붙이면 한 줄에 성격이 다른 두 정보가 섞인다
        // (사장님 2026-08-22 「연식 나오는 줄에 담당자 정보가 있으면 안 되지」).
        description: desc,
        siteName,
        ...(images.length ? { images } : null),
      },
      twitter: { card: images.length ? 'summary_large_image' : 'summary', title: name, description: desc, ...(images.length ? { images } : null) },
    };
  } catch {
    return neutral;
  }
}

/**
 * ★상세도 **브랜드 안**에 있어야 한다(사장님 2026-09-04 「껍데기를 좀 제대로 만들어봐」).
 *   전에는 손님이 유니오토 사이트에서 차를 누르면 머리띠·색·담당자가 통째로 사라졌다 —
 *   그 순간 「남의 사이트로 튕겼다」가 된다. 목록과 같은 방식으로 서버가 호스트를 보고 정한다.
 *
 * ★★브랜드가 있으면 **가게 상세**(`ShopDetailView`), 없으면 예전 상품안내 그대로.
 *   갈림을 «여기»(서버 껍데기)에 둔 이유가 둘이다.
 *   ㉠ 주소를 못 바꾼다 — 카톡·문자로 이미 나간 공유링크는 회수할 수 없다.
 *   ㉡ 화면 «안»에서 `if (브랜드)` 로 가르면 두 화면이 원자를 나눠 쓰게 되고, 목록에서 겪은
 *      그 사고(영업자 잣대로 세다 축 셋을 잃음)가 그대로 재현된다. 라우팅에서 가르면 안 섞인다.
 */
export default async function QuotePage({ params, searchParams }: Params) {
  const sp = await searchParams;
  /*
   * 호스트가 정본이고 `?wl=` 은 도메인 붙이기 «전» 미리보기용 — 목록(`/shop`)과 같은 규칙이다.
   * ⚠⚠ **`resolveGuestWhitelabel` 이다**(2026-09-06). 예전 `resolveWhitelabel` 은 ERP 도메인에서
   *   노브랜드로 떨어져, 손님이 주소에서 `?wl=` 만 지우면 **프리패스 「상품 안내」**가 떴다.
   *   손님이 지울 수 있는 값이 브랜드를 정하고 있었다(그 함수 머리말 참고).
   */
  const wl = resolveGuestWhitelabel((await headers()).get('host'), one(sp.wl));
  /*
   * ★★**읽은 것을 화면에 넘긴다 — 브라우저가 다시 묻지 않게**(2026-09-07).
   *   `generateMetadata` 가 방금 같은 값을 읽었고, `cache()` 덕에 여기선 «공짜»다.
   *   넘기지 않으면 브라우저가 `/api/catalog/quote` 로 또 부르고, 그 왕복이 끝나야 화면이 그려진다.
   *   실측 — 통째 읽기 776ms · 그게 한 화면에 두 번이었다.
   * ⚠ 못 찾으면 `null` 을 넘긴다 — 화면이 제 폴백(옛 링크·직접 진입)으로 굴러간다.
   */
  const { code } = await params;
  const found = hasBrand(wl)
    ? await loadGuestQuote(decodeURIComponent(String(code || '')), one(sp.a)).catch(() => null)
    : null;
  return hasBrand(wl) ? <ShopDetailView wl={wl} initial={found} /> : <QuoteView wl={wl} />;
}
