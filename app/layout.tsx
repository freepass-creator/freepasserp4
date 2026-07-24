import { BRAND } from '@/lib/brand';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { AppBarProvider } from '@/lib/appbar';
import { AuthProvider } from '@/lib/auth-context';
import { TabBarProvider } from '@/lib/tabbar';
import { MobileBpProvider, MobileBoot } from '@/lib/use-mobile';
import TopBar from '@/components/TopBar';
import AppTabBar from '@/components/AppTabBar';
import { Toaster } from '@/components/Toaster';
import ClientErrorReporter from '@/components/ClientErrorReporter';

export const viewport: Viewport = {
  themeColor: '#1B2A4A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// 플랫폼 = BRAND(ERP·운영자 화면 기본 타이틀). 손님 공개페이지(q/catalog/sign)는 각자 화이트라벨 title 오버라이드.
export const metadata: Metadata = {
  title: { default: BRAND, template: `%s · ${BRAND}` },
  description: `${BRAND} — 렌터카 중개 플랫폼.`,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: BRAND },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

/**
 * 페인트 전 — 쿠키·폭 확정 + 테마(FOUC 방지).
 * 모바일이면 무조건 pending(웹 격자 깜빡임 차단). MobileBoot가 폭=훅 일치 후 해제.
 */
const BP_BOOT = `(function(){try{var m=window.innerWidth<760;var v=m?'1':'0';document.documentElement.dataset.fpM=v;document.cookie='fp_m='+v+';path=/;max-age=31536000;SameSite=Lax';var ssr=document.documentElement.getAttribute('data-fp-m');if(m||((ssr==='0'||ssr==='1')&&v!==ssr))document.documentElement.classList.add('fp-pending-m');var th=localStorage.getItem('fp4_theme')||'light';var dark=th==='dark'||(th==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';}catch(e){}})();`;

function resolveSsrMobile(tip: string | undefined, chMobile: string | null): boolean | null {
  if (tip === '1') return true;
  if (tip === '0') return false;
  // 쿠키 없을 때 Client Hint (Accept-CH)
  if (chMobile === '?1') return true;
  if (chMobile === '?0') return false;
  return null;
}

// 톱바 + 전폭 콘텐츠 + 모바일 하단 탭(상품·문의·계약·설정).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const hdrs = await headers();
  const tip = jar.get('fp_m')?.value;
  const ssrMobile = resolveSsrMobile(tip, hdrs.get('sec-ch-ua-mobile'));
  const dataFpM = ssrMobile == null ? undefined : ssrMobile ? '1' : '0';
  // SSR 모바일이면 pending도 같이 — 부트 스크립트가 같은 클래스를 붙여 hydration mismatch 방지.
  // 쿠키 없이 폭만 모바일인 경우엔 스크립트만 추가 → suppressHydrationWarning.
  const htmlClass = ssrMobile ? 'fp-pending-m' : undefined;

  return (
    <html lang="ko" data-fp-m={dataFpM} className={htmlClass} suppressHydrationWarning>
      <head>
        {/* 크리티컬 마스크 인라인 — globals.css(dev=JS주입, 페인트 늦음) 로드 전이라도 pending 마스크가
            페인트 전에 걸리게. 부트스크립트가 모바일 감지→fp-pending-m 붙이면 데스크톱 콘텐츠가 안 그려짐(FOUC 차단). */}
        <style dangerouslySetInnerHTML={{ __html: 'html.fp-pending-m .fp-shell{visibility:hidden!important;pointer-events:none!important}html.fp-pending-m,html.fp-pending-m body{background:#fff}' }} />
        <script dangerouslySetInnerHTML={{ __html: BP_BOOT }} />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* CI 워드마크: Exo 2 — 명함과 동일 300(light)·600(bold). 500은 레거시 호환 */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@300;500;600&display=swap" />
      </head>
      <body suppressHydrationWarning>
        <MobileBpProvider ssrMobile={ssrMobile}>
          <AuthProvider>
            <AppBarProvider>
              <TabBarProvider>
                <MobileBoot />
                <ClientErrorReporter />
                <div className="fp-shell">
                  <TopBar />
                  <main className="fp-main-pad">{children}</main>
                  <AppTabBar />
                </div>
                <Toaster />
              </TabBarProvider>
            </AppBarProvider>
          </AuthProvider>
        </MobileBpProvider>
      </body>
    </html>
  );
}
