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
  // 빌드번호·SHA를 클라이언트 번들에 주입 → 메뉴 하단 버전표시(배포 확인용, 자동 증가).
  env: {
    NEXT_PUBLIC_BUILD_NO: BUILD_NO,
    NEXT_PUBLIC_BUILD_SHA: BUILD_SHA,
  },
  // 모바일 SSR 힌트 — 쿠키 없을 때 Sec-CH-UA-Mobile 로 맞춤
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Accept-CH', value: 'Sec-CH-UA-Mobile' },
        { key: 'Critical-CH', value: 'Sec-CH-UA-Mobile' },
      ],
    }];
  },
};
export default nextConfig;
