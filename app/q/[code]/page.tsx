import type { Metadata } from 'next';
import { QuoteView } from './QuoteView';
import { headers } from 'next/headers';
import { loadGuestQuote } from '@/lib/server/guest-quote';
import { hasBrand, resolveWhitelabel } from '@/lib/whitelabel';
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
  const wl = resolveWhitelabel((await headers()).get('host'), one(sp.wl));
  const fallbackSite = hasBrand(wl) ? wl.name : '상품 안내';

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
    const images = Array.isArray(product.image_urls) ? (product.image_urls as string[]).slice(0, 1) : [];

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
 */
export default async function QuotePage({ searchParams }: Params) {
  const sp = await searchParams;
  // 호스트가 정본이고 `?wl=` 은 도메인 붙이기 «전» 미리보기용 — 목록(`/catalog`)과 같은 규칙이다.
  const wl = resolveWhitelabel((await headers()).get('host'), one(sp.wl));
  return <QuoteView wl={wl} />;
}
