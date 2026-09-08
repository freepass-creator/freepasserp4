import { BRAND, BRAND_DESCRIPTION, BRAND_TAGLINE } from '@/lib/brand';
import { hasBrand, resolveGuestWhitelabel, resolveWhitelabel } from '@/lib/whitelabel';
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
import { VersionWatcher } from '@/components/VersionWatcher';
import ClientErrorReporter from '@/components/ClientErrorReporter';

export const viewport: Viewport = {
  themeColor: '#1B2A4A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // 입력 엔진 SSOT — 키보드가 뜨면 레이아웃 뷰포트를 줄인다(기본 resizes-visual은 줄이지 않음).
  //  · 하단바·컴포저가 키보드 뒤로 숨지 않고 키보드 바로 위에 붙는다
  //  · 포커스된 입력만 위로 올라오고 화면 골격은 그대로
  //  · 전 화면 동일 동작(화면마다 다르게 보이던 원인 제거)
  interactiveWidget: 'resizes-content',
};

/**
 * 플랫폼 = BRAND(ERP·운영자 화면 기본 타이틀). 손님 공개페이지(q/sign)는 각자 title·robots 오버라이드.
 *
 * ★설명을 길게 쓰는 이유
 *   루트는 매물 검색 화면(app/page.tsx)이고 크롤러는 JS 를 실행한다. 설명이 짧고 일반적이면
 *   구글은 그걸 버리고 **본문에서 스스로 만든다** — 실제로 브랜드 검색 결과에
 *   「차량번호, 상태, 구분, 제조사 … 1개월, 12개월」이 떴다. 그 표의 열 제목이다.
 *   그러니 «구글이 쓸 만한 문장»을 주는 것이 유일한 해법이다(140자 안팎).
 */
/**
 * ★★**채널 주소로 들어오면 우리 이름이 아무 데도 안 나간다**(사장님 2026-09-05
 *   「로그인 페이지부터 다른 거야」). 화면 글자만 바꾸는 걸로는 모자란다 —
 *   탭 제목·OG·JSON-LD·매니페스트가 전부 `freepasserp.com` 을 들고 있었다.
 *   겉은 유니오토인데 소스를 열면 우리 이름이 39번 나왔다(2026-09-05 실측).
 * ★노브랜드(= 지금 운영)는 **한 글자도 안 바뀐다** — 아래 기본값이 예전 그대로다.
 * ⚠ 호스트를 보므로 이 레이아웃은 동적이 된다. 이 앱은 이미 거의 모든 층이 동적이라(빌드 표의 ƒ)
 *   실질 손해가 없고, robots·sitemap 은 라우트 핸들러라 영향을 안 받는다.
 */
export async function generateMetadata(): Promise<Metadata> {
  /*
   * ⚠⚠ **손님 라우트면 채널로 떨어진다**(2026-09-06). 호스트만 보던 판정이라 ERP 도메인 안의
   *   손님 화면(`/uniauto`·`/q`·`/shop`)은 노브랜드로 잡혔고, 겉은 유니오토인데
   *   **탭 제목·OG·JSON-LD 에 우리 이름**이 실려 나갔다(사장님 2026-09-06 지적).
   * ★채널 도메인이 붙으면 호스트가 이겨서 이 갈림은 안 탄다 — 그때 지우는 것이 아니라 그대로 둔다
   *   (미리보기 주소는 계속 쓰인다).
   */
  const hdrs = await headers();
  const guest = hdrs.get('x-fp-guest') === '1';
  const wl = guest
    ? resolveGuestWhitelabel(hdrs.get('host'))
    : resolveWhitelabel(hdrs.get('host'));
  if (hasBrand(wl)) {
    const site = wl.hosts[0] || wl.name;
    return {
      metadataBase: new URL(`https://${site}`),
      // 꼬리표(`%s · freepasserp.com`)를 안 붙인다 — 붙이면 «모든 층» 탭에 우리 도메인이 뜬다.
      title: { default: wl.name, template: `%s · ${wl.name}` },
      applicationName: wl.name,
      // 채널 주소가 색인되면 우리 ERP 가 그 회사 이름으로 검색에 뜬다.
      robots: { index: false, follow: false },
      openGraph: { type: 'website', siteName: wl.name, url: `https://${site}`, title: wl.name },
      manifest: '/manifest.webmanifest',
      appleWebApp: { capable: true, statusBarStyle: 'default', title: wl.name },
      icons: ICONS,
    };
  }
  // ── 노브랜드(= 지금 운영). 여기는 예전 그대로다 — 한 글자도 안 바뀐다. ──
  return {
    metadataBase: new URL(`https://${BRAND}`),
    title: {
      default: `${BRAND} — ${BRAND_TAGLINE}`,
      template: `%s · ${BRAND}`,
    },
    description: BRAND_DESCRIPTION,
    applicationName: BRAND,
    openGraph: {
      type: 'website',
      siteName: BRAND,
      url: `https://${BRAND}`,
      title: `${BRAND} — ${BRAND_TAGLINE}`,
      description: BRAND_DESCRIPTION,
    },
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: BRAND },
    icons: ICONS,
  };
}

/** 아이콘은 브랜드와 무관하게 같다 — 파일 하나를 두 곳에서 적지 않으려고 뽑았다. */
const ICONS = {
  icon: [
    { url: '/icon.svg', type: 'image/svg+xml' },
    { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  ],
  shortcut: '/icon-192.png',
  apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
};

/**
 * 페인트 전 — 쿠키·폭 확정 + 테마(FOUC 방지).
 * 모바일이면 무조건 pending(웹 격자 깜빡임 차단). MobileBoot가 폭=훅 일치 후 해제.
 */
const BP_BOOT = `(function(){try{var ssr=document.documentElement.getAttribute('data-fp-m');var m=window.innerWidth<760;var v=m?'1':'0';document.documentElement.dataset.fpM=v;document.cookie='fp_m='+v+';path=/;max-age=31536000;SameSite=Lax';if(m||((ssr==='0'||ssr==='1')&&v!==ssr))document.documentElement.classList.add('fp-pending-m');var th=localStorage.getItem('fp4_theme')||'light';var dark=th==='dark'||(th==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';var ff=localStorage.getItem('fp4_finder_filter');if(ff==='0')document.documentElement.dataset.fpFilter='0';}catch(e){}})();`;

function resolveSsrMobile(tip: string | undefined, chMobile: string | null): boolean | null {
  if (tip === '1') return true;
  if (tip === '0') return false;
  // 쿠키 없을 때 Client Hint (Accept-CH)
  if (chMobile === '?1') return true;
  if (chMobile === '?0') return false;
  return null;
}

// 톱바 + 전폭 콘텐츠 + 역할별 모바일 하단 탭(tabbar.tsx가 SSOT).
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
        <style dangerouslySetInnerHTML={{ __html: 'html.fp-pending-m .fp-shell{visibility:hidden!important;pointer-events:none!important}html.fp-pending-m,html.fp-pending-m body{background:var(--bg-card,#fff)}' }} />
        <script dangerouslySetInnerHTML={{ __html: BP_BOOT }} />
        {/* 가변(Variable) 빌드 — CSS 스택 1순위가 'Pretendard Variable'인데 static만 불러오면
            그 패밀리가 없어 고정굵기로 폴백하고, FW의 반 단계(550·650)가 600·700으로 올림돼 전체가 더 두꺼워진다.
            dynamic-subset = 유니코드 범위별 분할 로드(한글 용량 절감). */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* CI 워드마크: Exo 2 — 명함과 동일 300(light)·600(bold). 500은 레거시 호환 */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@300;500;600&display=swap" />
      </head>
      <body suppressHydrationWarning>
        {/*
          구조화 데이터 — 구글에게 «이게 무엇인지»를 문장이 아니라 형식으로 말한다.
          본문이 매물 표라 크롤러가 열 제목을 긁어 설명으로 쓰던 것을 대체하는 재료다.
          서버에서 그려지므로 JS 실행 여부와 무관하게 읽힌다.
        */}
        {/*
          ⚠ 채널 주소에서는 **안 내보낸다.** 이 블록은 우리 회사·도메인을 그대로 들고 있어,
            겉이 유니오토여도 소스를 열면 우리 이름이 나온다(2026-09-05 실측 39곳 중 여기가 제일 컸다).
            검색 재료로 넣은 것인데 채널 주소는 애초에 색인시키지 않으므로(robots noindex) 없어도 잃을 게 없다.
        */}
        {/*
          ⚠ **손님 라우트에서도 안 내보낸다**(2026-09-06). 예전엔 «호스트»만 봐서, ERP 도메인 안의
            유니오토 화면(`/uniauto`)에 이 블록이 그대로 붙었다 — 소스를 열면 우리 법인명이 나왔다.
        */}
        {hdrs.get('x-fp-guest') === '1' || hasBrand(resolveWhitelabel(hdrs.get('host'))) ? null : (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: BRAND,
              url: `https://${BRAND}`,
              inLanguage: 'ko',
              description: BRAND_DESCRIPTION,
              publisher: {
                '@type': 'Organization',
                name: process.env.NEXT_PUBLIC_OPERATOR_COMPANY || BRAND,
                url: `https://${BRAND}`,
              },
            }),
          }}
        />
        )}
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
                {/* 배포 자동 반영 — 살아 있는 탭이 새 배포를 감지해 스스로 새로고침(입력 중엔 미룸). */}
                <VersionWatcher />
              </TabBarProvider>
            </AppBarProvider>
          </AuthProvider>
        </MobileBpProvider>
      </body>
    </html>
  );
}
