import EmbeddedApp from '@/components/EmbeddedApp';

/** 신차렌탈 견적기 — 독립 Vue 앱(welrixtable) 임베드. 탭 타이틀은 레이아웃 기본(브랜드) 유지. */
export default function WelrixPage() {
  return <EmbeddedApp src="https://welrixtable.vercel.app/" title="신차렌탈 견적기" appId="welrix" />;
}
