import type { MetadataRoute } from 'next';

// PWA 매니페스트 — 화이트라벨. 자사 브랜드 노출 금지, 중립명(배포 시 테넌트별 대체).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '차량 렌탈 검색',
    short_name: '차량검색',
    description: '조건별 차량 검색 · 견적.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#1B2A4A',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
