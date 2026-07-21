/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
