import EmbeddedApp from '@/components/EmbeddedApp';

export const metadata = { title: '웰릭스 신차 견적기' };

/** 웰릭스 신차 견적기 — 독립 Vue 앱(welrixtable) 임베드. */
export default function WelrixPage() {
  return <EmbeddedApp src="https://welrixtable.vercel.app/" title="웰릭스 신차 견적기" />;
}
