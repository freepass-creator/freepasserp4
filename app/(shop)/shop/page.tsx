import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ShopView } from './ShopView';
import { coBrandName, hasBrand, resolveGuestWhitelabel, ogImage, OG_SIZE } from '@/lib/whitelabel';

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
  return <ShopView wl={wl} />;
}
