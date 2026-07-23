import EmbeddedApp from '@/components/EmbeddedApp';

/** 신차렌탈 견적기 — 별도 배포본(welrixmobility.netlify.app)을 그대로 임베드(수정 없이 활용). */
export default function WelrixPage() {
  return <EmbeddedApp src="https://welrixmobility.netlify.app/" title="신차렌탈 견적기" appId="welrix" />;
}
