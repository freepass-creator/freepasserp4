'use client';
import { useState } from 'react';

/**
 * 외부 Vue 앱(웰릭스·손오공)을 erp4 전용 라우트 안에 iframe 임베드.
 * 각 앱은 자기 repo·Firebase로 독립 운영 — erp4는 껍데기(메뉴·뒤로가기)만 제공.
 * 높이 = .fp-main-pad(flex 컬럼) 안에서 flex:1 로 꽉 채운다.
 */
export default function EmbeddedApp({ src, title }: { src: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div style={{ flex: '1 1 0', minHeight: 0, position: 'relative', display: 'flex' }}>
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#868e96', fontSize: 13 }}>
          <span style={{ width: 22, height: 22, border: '3px solid #d5d8dc', borderTopColor: '#1B2A4A', borderRadius: '50%', animation: 'fp-embed-spin .7s linear infinite' }} />
          {title} 불러오는 중…
          <style>{'@keyframes fp-embed-spin{to{transform:rotate(360deg)}}'}</style>
        </div>
      )}
      <iframe
        src={src}
        title={title}
        onLoad={() => setLoaded(true)}
        style={{ flex: 1, minHeight: 0, width: '100%', border: 0, display: 'block' }}
        allow="clipboard-write; fullscreen; geolocation"
      />
    </div>
  );
}
