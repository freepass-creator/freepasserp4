import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

// PWA 매니페스트 — 플랫폼 BRAND(운영자 앱). 손님 공개페이지는 화이트라벨 오버라이드.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND,
    short_name: BRAND,
    description: `${BRAND} — 렌터카 중개 플랫폼.`,
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
