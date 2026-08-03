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
    // SVG 만으로는 안드로이드 홈화면 추가·스토어 제출에서 아이콘이 비거나 반려된다.
    //  래스터 192/512 를 같이 싣는다(public/icon.svg 에서 생성 — scripts/build-icons.mjs).
    //  maskable 은 **여백을 준 별도 파일**이어야 한다. 같은 이미지를 재사용하면 런처가 원형으로
    //  잘라낼 때 차 아이콘 가장자리가 먹힌다(안전영역 규격상 가장자리 10%가 잘릴 수 있다).
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
