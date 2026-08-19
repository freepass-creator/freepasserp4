'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName } from '@/lib/domain/product';
import { ProductDetail } from '@/components/ProductDetail';
import { C, R, Loading, CenterNote, Btn, FW, FS } from '@/components/ui';
import { haptic } from '@/lib/haptics';

/**
 * 손님 대면 견적서(화이트라벨).
 * Phase2: 사진·요금·조건 손롤 삭제 → ProductDetail(audience=customer).
 * 이 페이지는 귀속(?a=)·상담 CTA·화이트라벨 크롬만 담당.
 *
 * ★데이터는 **서버 API**(`/api/catalog/quote`)에서 받는다. 예전엔 브라우저가 RTDB 를 직접
 *   읽었는데, 규칙이 인증을 요구해서 **비로그인 손님에게는 401 → 항상 빈 화면**이었다
 *   (2026-07-30 QA 「영업 공유 퍼널 전면 불능」 · 2026-08-08 재확인).
 *   규칙을 열면 원가·수수료·회원까지 새므로, 서버가 서비스계정으로 읽고 화이트리스트만 준다.
 */
export default function Quote() {
  const { code } = useParams<{ code: string }>();
  const key = decodeURIComponent(String(code));
  const [p, setP] = useState<EntityRecord | null | undefined>(undefined);
  const [agent, setAgent] = useState<EntityRecord | null>(null);

  useEffect(() => { (async () => {
    const a = typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('a') || localStorage.getItem('fp4_attr'))
      : null;
    if (a && typeof window !== 'undefined') localStorage.setItem('fp4_attr', a);
    try {
      const q = new URLSearchParams({ code: key });
      if (a) q.set('a', a);
      const res = await fetch(`/api/catalog/quote?${q}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({})) as { product?: EntityRecord; agent?: EntityRecord | null };
      setP(res.ok && body.product ? body.product : null);
      setAgent(body.agent || null);
    } catch {
      setP(null);
    }
  })(); /* eslint-disable-next-line */ }, [key]);

  useEffect(() => { if (p) document.title = `${vehicleName(p)} · 렌터카 견적`; }, [p]);

  if (p === undefined) return <Loading />;
  // 판매 가능 여부는 서버가 이미 판정했다(만료·출고불가면 404). 여기서 다시 걸지 않는다.
  if (!p) return <CenterNote>현재 견적 가능한 상품이 아닙니다.</CenterNote>;

  const agentName = agent ? String(agent.name || '') : '';
  const phone = agent
    ? String(agent.phone || agent.mobile || agent.tel || agent.contact || '').replace(/\s/g, '')
    : '';
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '';
  const inverse = 'var(--text-inverse)';

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 18px 28px' }}>
    <main style={{ flex: '1 1 auto', minWidth: 0, maxWidth: 760 }}>
      <div style={{ fontSize: FS.sub, color: C.mute, letterSpacing: '0.04em', marginBottom: 10 }}>대여 견적서</div>
      <ProductDetail p={p} audience="customer" />
      <div style={{ marginTop: 24, padding: '14px 16px', background: C.brand, color: inverse, borderRadius: R }}>
        <div style={{ fontSize: FS.body, fontWeight: FW.title }}>상담 문의</div>
        <div style={{ fontSize: FS.body, marginTop: 4, opacity: 0.9 }}>
          {agentName ? `담당 영업자 ${agentName}에게 연락 주세요.` : '담당 영업자에게 연락 주세요.'}
        </div>
        {telHref ? (
          <div style={{ marginTop: 12 }}>
            <Btn
              href={telHref}
              onClick={() => haptic.nav()}
              style={{ background: C.taupeBg, color: C.brand, borderColor: C.taupeBg, boxShadow: 'none', fontWeight: FW.label }}
            >
              전화하기{phone ? ` · ${phone}` : ''}
            </Btn>
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 14, fontSize: FS.cap, color: C.faint }}>본 견적은 참고용이며 심사·재고에 따라 변동될 수 있습니다.</div>
    </main>
    </div>
  );
}
