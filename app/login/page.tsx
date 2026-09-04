import type { Metadata } from 'next';
import { headers } from 'next/headers';
import LoginView from './LoginView';
import { hasBrand, resolveWhitelabel } from '@/lib/whitelabel';

/**
 * 현관의 **서버 껍데기**. 화면은 `LoginView`(클라이언트)가 그린다.
 *
 * 사장님 2026-09-05 「손님 페이지는 로그인이 필요 없지, 그냥 유니오토 이름으로 나가잖아.
 * 근데 거기서 로그인을 할 수 있어요. 그러니까 **로그인 페이지부터 다른 거야.**」
 *
 * ★같은 호스트인데 현관만 우리 이름이면, 앞에서 감춘 것이 거기서 다 샌다.
 *   손님이 `uniautofreepass.com` 을 열면 유니오토플랜인데, 로그인 화면에서 `freepasserp.com` 이
 *   뜨는 순간 「아, 프리패스라는 데가 만든 거구나」가 된다.
 * ★브랜드는 **호스트**가 정한다(`?wl=` 은 도메인 붙기 전 미리보기) — 목록·상세와 같은 규칙.
 * ★★탭 제목도 덮는다. 루트 레이아웃이 `%s · freepasserp.com` 을 붙이므로 **absolute** 로 준다 —
 *   안 그러면 화면은 유니오토인데 **브라우저 탭에 우리 도메인이 그대로 뜬다.**
 */
export const dynamic = 'force-dynamic';

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  const sp = await searchParams;
  const wl = resolveWhitelabel((await headers()).get('host'), one(sp.wl));
  // 노브랜드(= 지금 운영)는 루트 레이아웃 기본값을 그대로 쓴다 — 아무것도 덮지 않는다.
  if (!hasBrand(wl)) return {};
  return {
    title: { absolute: wl.name },
    // 현관은 검색에 걸릴 이유가 없다. 채널 주소가 색인되면 우리 ERP 가 그 회사 이름으로 검색에 뜬다.
    robots: { index: false, follow: false },
    openGraph: { type: 'website', title: wl.name, siteName: wl.name },
  };
}

export default async function LoginPage({ searchParams }: Params) {
  const sp = await searchParams;
  const wl = resolveWhitelabel((await headers()).get('host'), one(sp.wl));
  return <LoginView wl={wl} />;
}
