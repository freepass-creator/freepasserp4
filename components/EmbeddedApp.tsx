'use client';
import { useEffect, useState } from 'react';
import { toast } from '@/components/Toaster';
import { C, FS } from '@/components/ui';

/**
 * 외부 Vue 앱(웰릭스·손오공)을 erp4 전용 라우트 안에 iframe 임베드.
 * 각 앱은 자기 repo·Firebase로 독립 운영 — erp4는 껍데기(메뉴·뒤로가기)만 제공.
 * 높이 = .fp-main-pad(flex 컬럼) 안에서 flex:1 로 꽉 채운다.
 *
 * 원활 연동 (견적기 embed-bridge 프로토콜):
 *  · src 에 ?embed=1&parentOrigin=<erp4 origin> 부여 → 견적기 브리지 활성화 + 신뢰 origin 확정
 *    (견적기 vercel frame-ancestors 에 erp4 도메인이 허용돼 있어야 함)
 *  · postMessage 수신 {ns:appId, type:'quote', payload:{id,url,dealCode,summary}} → 저장/발송 결과 알림(+onQuote)
 */
export default function EmbeddedApp({ src, title, appId, onQuote, prefill }: {
  src: string;
  title: string;
  appId?: string; // 브리지 네임스페이스 ('welrix' | 'sonogong')
  onQuote?: (q: { id?: string; url?: string; dealCode?: string; summary?: string }) => void;
  prefill?: Record<string, string | undefined>;
}) {
  const [loaded, setLoaded] = useState(false);
  const [embedSrc, setEmbedSrc] = useState('');

  useEffect(() => {
    const origin = new URL(src).origin;
    const u = new URL(src);
    u.searchParams.set('embed', '1');
    u.searchParams.set('parentOrigin', window.location.origin);
    if (prefill) for (const [k, v] of Object.entries(prefill)) if (v != null) u.searchParams.set(k, String(v));
    setEmbedSrc(u.toString());

    function onMsg(e: MessageEvent) {
      if (e.origin !== origin) return; // 신뢰 origin(견적기)만
      const m = e.data as { ns?: string; type?: string; payload?: { id?: string; url?: string; dealCode?: string; summary?: string } };
      if (!m || (appId && m.ns !== appId)) return;
      if (m.type === 'quote') {
        const q = m.payload || {};
        toast(`견적 저장됨${q.summary ? ' · ' + q.summary : ''}`, 'ok');
        onQuote?.(q);
      }
      // 'resize' 는 flex:1 full-height 라 불필요 (콘텐츠 스크롤은 iframe 내부에서 처리)
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, appId]);

  return (
    <div style={{ flex: '1 1 0', minHeight: 0, position: 'relative', display: 'flex' }}>
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: C.faint, fontSize: FS.body }}>
          <span style={{ width: 22, height: 22, border: `3px solid ${C.line}`, borderTopColor: C.brand, borderRadius: '50%', animation: 'fp-embed-spin .7s linear infinite' }} />
          {title} 불러오는 중…
          <style>{'@keyframes fp-embed-spin{to{transform:rotate(360deg)}}'}</style>
        </div>
      )}
      {embedSrc && (
        <iframe
          src={embedSrc}
          title={title}
          onLoad={() => setLoaded(true)}
          style={{ flex: 1, minHeight: 0, width: '100%', border: 0, display: 'block' }}
          allow="clipboard-write; fullscreen; geolocation"
        />
      )}
    </div>
  );
}
