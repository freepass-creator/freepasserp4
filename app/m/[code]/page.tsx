'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName } from '@/lib/domain/product';
import { Btn, C } from '@/components/ui';
import { ProductDetail } from '@/components/ProductDetail';
import { ContractRequestForm } from '@/components/ContractRequestForm';
import { ensureRoom, actor, getRole } from '@/lib/domain/deal';

// 매물 상세(전체화면) = ProductDetail 원자 + 하단 액션바(이전·소통·손님공유·계약).
export default function Detail() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const co = getCompanyId();
  const [p, setP] = useState<EntityRecord | null | undefined>(undefined);
  const [cOpen, setCOpen] = useState(false);

  useEffect(() => { (async () => { await seedIfEmpty(co); setP(await getStore().get('product', co, decodeURIComponent(String(code)))); })(); /* eslint-disable-next-line */ }, [code]);

  if (p === undefined) return <div style={{ padding: 40, color: C.faint }}>불러오는 중…</div>;
  if (!p) return <div style={{ padding: 40 }}>매물을 찾을 수 없습니다.</div>;

  const sendLink = () => {
    const url = `${location.origin}/q/${encodeURIComponent(String(p.product_code))}?a=${encodeURIComponent(actor(getRole()).code)}`;
    if (navigator.share) { navigator.share({ title: vehicleName(p), url }).catch(() => {}); return; }
    navigator.clipboard?.writeText(url).then(() => alert('손님용 매물 링크 복사됨\n' + url), () => prompt('링크', url));
  };
  const openChat = async () => { const key = await ensureRoom(p); router.push(`/chat?room=${encodeURIComponent(key)}`); };

  return (
    <>
      <main style={{ maxWidth: 920, margin: '0 auto', padding: '14px 16px 90px' }}>
        {cOpen && <div style={{ marginBottom: 14 }}><ContractRequestForm p={p} onDone={() => setCOpen(false)} onCancel={() => setCOpen(false)} /></div>}
        <ProductDetail p={p} />
      </main>
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 45, background: '#fff', borderTop: `1px solid ${C.line}`, boxShadow: '0 -2px 12px rgba(15,23,42,0.06)' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px calc(8px + env(safe-area-inset-bottom))' }}>
          <Btn variant="ghost" size="sm" onClick={() => router.back()}>← 이전</Btn>
          <span style={{ flex: 1 }} />
          <Btn variant="ghost" size="sm" onClick={openChat}>소통</Btn>
          <Btn variant="ghost" size="sm" onClick={sendLink}>손님공유</Btn>
          <Btn size="sm" onClick={() => setCOpen(true)}>계약</Btn>
        </div>
      </div>
    </>
  );
}
