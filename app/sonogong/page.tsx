import EmbeddedApp from '@/components/EmbeddedApp';

export const metadata = { title: '중고 픽업구독' };

/** 중고 픽업구독(손오공렌터카) — 독립 Vue 앱(sonogong-estimator) 임베드. */
export default function SonogongPage() {
  return <EmbeddedApp src="https://sonogong-estimator.vercel.app/" title="중고 픽업구독" />;
}
