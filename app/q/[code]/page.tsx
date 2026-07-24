'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getStore, peekCached } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName } from '@/lib/domain/product';
import { matchAgentByShareCode } from '@/lib/domain/product-share';
import { ProductDetail } from '@/components/ProductDetail';
import { C, R, Loading, CenterNote, Btn, FW, FS } from '@/components/ui';
import { haptic } from '@/lib/haptics';

/**
 * 손님 대면 견적서(화이트라벨).
 * Phase2: 사진·요금·조건 손롤 삭제 → ProductDetail(audience=customer).
 * 이 페이지는 귀속(?a=)·상담 CTA·화이트라벨 크롬만 담당.
 */
export default function Quote() {
  const { code } = useParams<{ code: string }>();
  const co = getCompanyId();
  const key = decodeURIComponent(String(code));
  const [p, setP] = useState<EntityRecord | null | undefined>(() => peekCached('product', co, key) ?? undefined);
  const [agent, setAgent] = useState<EntityRecord | null>(null);

  useEffect(() => { (async () => {
    await seedIfEmpty(co);
    const a = typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('a') || localStorage.getItem('fp4_attr')) : null;
    if (a) {
      if (typeof window !== 'undefined') localStorage.setItem('fp4_attr', a);
      const users = await getStore().list('user', co);
      setAgent(matchAgentByShareCode(users, a));
    }
    setP(await getStore().get('product', co, key));
  })(); /* eslint-disable-next-line */ }, [key]);

  useEffect(() => { if (p) document.title = `${vehicleName(p)} · 렌터카 견적`; }, [p]);

  if (p === undefined) return <Loading />;
  if (!p) return <CenterNote>견적을 찾을 수 없습니다.</CenterNote>;

  const agentName = agent ? String(agent.name || '') : '';
  const phone = agent
    ? String(agent.phone || agent.mobile || agent.tel || agent.contact || '').replace(/\s/g, '')
    : '';
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '';

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: '18px 18px 28px' }}>
      <div style={{ fontSize: FS.sub, color: C.mute, letterSpacing: '0.04em', marginBottom: 10 }}>대여 견적서</div>
      <ProductDetail p={p} audience="customer" />
      <div style={{ marginTop: 24, padding: '14px 16px', background: C.brand, color: '#fff', borderRadius: R }}>
        <div style={{ fontSize: FS.body, fontWeight: FW.title }}>상담 문의</div>
        <div style={{ fontSize: FS.body, marginTop: 4, opacity: 0.9 }}>
          {agentName ? `담당 영업자 ${agentName}에게 연락 주세요.` : '담당 영업자에게 연락 주세요.'}
        </div>
        {telHref ? (
          <div style={{ marginTop: 12 }}>
            <Btn
              href={telHref}
              onClick={() => haptic.nav()}
              style={{ background: '#fff', color: C.brand, borderColor: '#fff', boxShadow: 'none', fontWeight: FW.label }}
            >
              전화하기{phone ? ` · ${phone}` : ''}
            </Btn>
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 14, fontSize: FS.cap, color: C.faint }}>본 견적은 참고용이며 심사·재고에 따라 변동될 수 있습니다.</div>
    </main>
  );
}
