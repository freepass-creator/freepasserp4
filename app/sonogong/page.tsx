import EmbeddedApp from '@/components/EmbeddedApp';

/** 중고 픽업구독(견적기) — 독립 Vue 앱(sonogong-estimator) 임베드. 탭 타이틀은 레이아웃 기본(브랜드) 유지. */
export default function SonogongPage() {
  return <EmbeddedApp src="https://sonogong-estimator.vercel.app/" title="중고 픽업구독" appId="sonogong" />;
}
