'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName, priceList, creditDisplay, policyOf } from '@/lib/domain/product';
import { useProductPhotos } from '@/components/use-product-photos';
import { won, C, Loading } from '@/components/ui';

// 손님 대면 견적서(화이트라벨). 영업자가 링크로 전달. ERP 크롬 없이 깔끔한 제안 산출물.
export default function Quote() {
  const { code } = useParams<{ code: string }>();
  const [p, setP] = useState<EntityRecord | null | undefined>(undefined);
  const [agent, setAgent] = useState<EntityRecord | null>(null);
  const [main, setMain] = useState(0);
  const co = getCompanyId();
  useEffect(() => { (async () => {
    await seedIfEmpty(co);
    // 영업자 귀속(?a=) — 손님이 어느 파트너에 귀속되는지 추적. 첫 진입 시 지속 저장(고객 뺏김 구조적 제거).
    const a = typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('a') || localStorage.getItem('fp4_attr')) : null;
    if (a) { if (typeof window !== 'undefined') localStorage.setItem('fp4_attr', a); const users = await getStore().list('user', co); setAgent(users.find((u) => String(u.user_code) === a) || null); }
    setP(await getStore().get('product', co, decodeURIComponent(String(code))));
  })(); /* eslint-disable-next-line */ }, [code]);
  // 손님 공개 화면 = 화이트라벨. 탭 제목을 차량명으로(플랫폼 브랜드 노출 차단).
  useEffect(() => { if (p) document.title = `${vehicleName(p)} · 렌터카 견적`; }, [p]);
  const photos = useProductPhotos((p ?? {}) as EntityRecord); // 드라이브 폴더 포함 해석(hook은 조건부 반환 전에 호출)

  if (p === undefined) return <Loading />;
  if (!p) return <div style={{ padding: 40 }}>견적을 찾을 수 없습니다.</div>;

  const prices = priceList(p);
  const pol = policyOf(p);
  const g = (k: string) => String(pol[k] || '');
  const row = (k: string, v: unknown) => (
    <div style={{ display: 'flex', padding: '9px 0', borderTop: `1px solid ${C.line2}` }}>
      <span style={{ width: 96, flex: '0 0 96px', color: C.mute, fontSize: 13 }}>{k}</span>
      <span style={{ fontSize: 13, color: C.ink }}>{v == null || v === '' ? '—' : String(v)}</span>
    </div>
  );

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: '18px 18px 60px' }}>
      <div style={{ fontSize: 12, color: C.mute, letterSpacing: '0.04em' }}>대여 견적서</div>
      <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em', margin: '4px 0 2px' }}>{vehicleName(p)}</h1>
      <div style={{ fontSize: 13, color: C.mute }}>{[p.year && `${p.year}년`, p.fuel_type, p.mileage && `${Number(p.mileage).toLocaleString()}km`, creditDisplay(p)].filter(Boolean).join(' · ')}</div>

      {(() => { const mi = Math.min(main, Math.max(0, photos.length - 1));
        return photos.length ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ aspectRatio: '16 / 9', background: '#eef1f5', borderRadius: 6, overflow: 'hidden' }}>
              <img src={photos[mi]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            {photos.length > 1 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6, overflowX: 'auto' }}>
                {photos.map((ph, i) => <button key={i} onClick={() => setMain(i)} aria-label={`사진 ${i + 1}`} style={{ flex: '0 0 auto', width: 72, height: 46, borderRadius: 4, overflow: 'hidden', border: `2px solid ${i === mi ? C.brand : 'transparent'}`, padding: 0, cursor: 'pointer', background: '#eef1f5' }}><img src={ph} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></button>)}
              </div>
            )}
          </div>
        ) : (
          <div style={{ aspectRatio: '16 / 9', background: '#eef1f5', borderRadius: 6, marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 13 }}>사진 준비중</div>
        ); })()}

      <div style={{ marginTop: 18, fontSize: 13, fontWeight: 800 }}>기간별 대여료</div>
      <div style={{ marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
          <thead><tr>{['대여기간', '월 대여료', '보증금'].map((h, i) => <th key={i} style={{ padding: '10px 14px', textAlign: i ? 'right' : 'left', background: C.head, fontSize: 12, color: '#33415a', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
          <tbody>{prices.map((pr, i) => (
            <tr key={i} style={{ borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
              <td style={{ padding: '11px 14px', fontWeight: 600 }}>{pr.m}개월</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 800, color: C.brand, fontFamily: 'var(--font-mono)' }}>{won(pr.rent)}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{won(pr.deposit)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div style={{ marginTop: 20, fontSize: 13, fontWeight: 800 }}>대여 조건</div>
      <div style={{ marginTop: 2 }}>
        {row('심사', creditDisplay(p))}
        {row('약정 주행거리', g('annual_mileage'))}
        {row('결제방식', g('payment_method'))}
        {row('가능 연령', g('basic_driver_age'))}
        {row('보험', [g('injury_compensation_limit') && `대인 ${g('injury_compensation_limit')}`, g('own_damage_compensation') && `자차 ${g('own_damage_compensation')}`, g('insurance_included')].filter(Boolean).join(' · '))}
        {row('정비', g('maintenance_service'))}
        {row('대여지역', g('rental_region'))}
      </div>

      <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--brand)', color: '#fff', borderRadius: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>상담 문의</div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>{agent ? `담당 영업자 ${String(agent.name)}에게 연락 주세요.` : '담당 영업자에게 연락 주세요.'}</div>
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: C.faint }}>본 견적은 참고용이며 심사·재고에 따라 변동될 수 있습니다.</div>
    </main>
  );
}
