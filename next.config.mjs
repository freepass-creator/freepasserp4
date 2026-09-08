import { execSync } from 'node:child_process';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** 빌드 시점 git 정보 — 누가(태윤이든) 커밋/배포해도 빌드마다 자동 갱신(수동 버전 안 건드림). */
function sh(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}
// 빌드번호 = git 커밋수(매 커밋 +1, 자동 증가). Vercel 얕은클론 등으로 못 구하면 짧은 SHA로 폴백.
const BUILD_NO = sh('git rev-list --count HEAD');
const BUILD_SHA = sh('git rev-parse --short HEAD') || (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);

/** @param {string} phase @returns {import('next').NextConfig} */
const nextConfig = (phase) => ({
  reactStrictMode: true,
  /*
   * ★★**사진은 «필요한 크기로 줄여» 내보낸다** — 손님 화면이 느린 첫째 이유였다.
   *
   * 사장님 2026-09-08 「이거 돈 안 들지???」 · 「**안 느려지게 이런 사이트 통상 하는 방법으로**」.
   * ⚠ 실측(운영 2026-09-08) — 카드 사진이 **원본 PNG 그대로** 나갔다. 한 장이 **1,437,249 bytes**.
   *   그걸 카드의 **330px 칸**에 그렸다. 목록 첫 화면에 카드가 60장이다.
   *   ⇒ 손님 한 명이 스크롤하면 수십 MB. 느린 것도 돈이 드는 것도 여기 하나였다
   *     (목록·상세 API 는 이미 CDN 120초 캐시라 파이어스토어 읽기는 손님 수와 무관하다).
   *
   * ★고치는 법도 «통상»이다 — Next 의 이미지 최적화에 태운다. AVIF/WebP 로 바꾸고
   *   화면 폭에 맞는 크기만 내려보낸다(`sizes`). 새로 들일 라이브러리가 없다.
   * ★`minimumCacheTTL` 30일 — 매물 사진은 안 바뀐다. 짧게 두면 같은 사진을 매달 다시 굽는다
   *   (Vercel 은 «구운 횟수»로 셈한다 — 오래 둘수록 싸다).
   * ⚠ 원격 호스트는 «화이트리스트»다. 여기 없는 호스트의 절대주소는 최적화가 **거부**된다 —
   *   그래서 화면 쪽(`ShopPhoto`)이 「최적화 못 하는 주소면 원본 그대로」로 떨어지게 짜여 있다.
   *   대부분은 `/api/img` 프록시를 타므로 **동일 오리진 상대주소**라 이 목록과 무관하다.
   */
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 2592000,
    remotePatterns: [
      { protocol: 'https', hostname: '**.firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: '**.firebasestorage.app' },
    ],
  },
  // Playwright 자체 브라우저는 Vercel 함수에 포함되지 않는다. 전자계약 PDF 함수만
  // @sparticuz/chromium의 서버리스 실행파일 묶음을 추적·배포한다.
  serverExternalPackages: ['@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/freepass-esign/**/*': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './public/contract-template/rental-contract.html',
      './public/fonts/*.woff2',
    ],
  },
  // 개발 서버와 production build를 동시에/번갈아 실행해도 산출물을 공유하지 않는다.
  // 보조 서버는 NEXT_DIST_DIR=.next-qa처럼 명시해 각자 더 분리할 수 있다.
  distDir: process.env.NEXT_DIST_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
  // 빌드번호·SHA를 클라이언트 번들에 주입 → 메뉴 하단 버전표시(배포 확인용, 자동 증가).
  env: {
    NEXT_PUBLIC_BUILD_NO: BUILD_NO,
    NEXT_PUBLIC_BUILD_SHA: BUILD_SHA,
    /**
     * ★배포 도장 — 빌드할 때마다 반드시 바뀐다(git 과 무관). 우리는 커밋 없이 작업트리째 CLI 배포하므로
     *   BUILD_NO/SHA 는 배포 간에 같을 수 있다(사장님 2026-08-22 「캐시를 무력화하면서 개선해야지」).
     *   VersionWatcher 가 /api/version 의 이 값과 자기 번들 값을 견줘 다르면 스스로 새로고침한다.
     */
    NEXT_PUBLIC_BUILD_STAMP: new Date().toISOString(),
  },
  // 모바일 SSR 힌트 — 쿠키 없을 때 Sec-CH-UA-Mobile 로 맞춤
  async headers() {
    return [{
      // 손님 링크(견적·전자서명)는 **뿌리는 것**이지 찾아지는 것이 아니다.
      //  페이지 metadata 의 noindex 와 겹쳐 두는 이유 — 그건 HTML 을 파싱해야 보이지만
      //  헤더는 **응답 자체에 붙어** HTML 아닌 응답·리다이렉트에도 따라간다.
      //  robots.txt 는 크롤링만 줄일 뿐 색인을 못 막는다. 셋을 같이 쓴다.
      //  ★서명 페이지는 주민번호·면허·서명이 들어가는 입력창이다. 한 겹으로 두지 않는다.
      source: '/:section(q|sign)/:rest*',
      headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
      ],
    }, {
      source: '/:path*',
      headers: [
        { key: 'Accept-CH', value: 'Sec-CH-UA-Mobile' },
        { key: 'Critical-CH', value: 'Sec-CH-UA-Mobile' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(self "https://sonogong-estimator.vercel.app" "https://welrixmobility.netlify.app")',
        },
      ],
    }];
  },
});
export default nextConfig;
