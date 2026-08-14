import { execSync } from 'node:child_process';

/** 빌드 시점 git 정보 — 누가(태윤이든) 커밋/배포해도 빌드마다 자동 갱신(수동 버전 안 건드림). */
function sh(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}
// 빌드번호 = git 커밋수(매 커밋 +1, 자동 증가). Vercel 얕은클론 등으로 못 구하면 짧은 SHA로 폴백.
const BUILD_NO = sh('git rev-list --count HEAD');
const BUILD_SHA = sh('git rev-parse --short HEAD') || (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Playwright 자체 브라우저는 Vercel 함수에 포함되지 않는다. 전자계약 PDF 함수만
  // @sparticuz/chromium의 서버리스 실행파일 묶음을 추적·배포한다.
  serverExternalPackages: ['@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/freepass-esign/**/*': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },
  // 병렬 QA 서버가 기본 개발 서버의 .next 산출물을 덮어쓰지 않도록
  // 보조 서버는 NEXT_DIST_DIR=.next-qa처럼 별도 디렉터리를 지정할 수 있다.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // 빌드번호·SHA를 클라이언트 번들에 주입 → 메뉴 하단 버전표시(배포 확인용, 자동 증가).
  env: {
    NEXT_PUBLIC_BUILD_NO: BUILD_NO,
    NEXT_PUBLIC_BUILD_SHA: BUILD_SHA,
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
};
export default nextConfig;
