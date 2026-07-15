import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AppBarProvider } from '@/lib/appbar';
import { AuthProvider } from '@/lib/auth-context';
import TopBar from '@/components/TopBar';

export const viewport: Viewport = {
  themeColor: '#1B2A4A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// 화이트라벨 — 자사 브랜드명 노출 금지. 중립 타이틀(배포 시 테넌트명으로 대체).
export const metadata: Metadata = {
  title: '차량 렌탈 검색',
  description: '조건별 차량 검색 · 견적.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: '차량검색' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

// 톱바(웹 내비) + 전폭 콘텐츠 + 하단 탭바(모바일). 웹·모바일 한 벌.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@500;600&display=swap" />
      </head>
      <body>
        <AuthProvider>
          <AppBarProvider>
            <TopBar />
            <div className="fp-main-pad" style={{ minHeight: 'calc(100vh - var(--topbar-h))' }}>{children}</div>
          </AppBarProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
