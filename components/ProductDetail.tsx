'use client';
import { useState, type CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName, priceList, detailSections } from '@/lib/domain/product';
import { won, C } from '@/components/ui';

// 매물 상세 본문 = 공통 원자(사진·라이트박스 · 전기간 요금표 · 정책 섹션). 고밀도(여백 절제).
// /m 전체페이지 + 소통 4단의 우패널이 같이 씀(새로 만들지 않고 이 원자를 끌어다 씀).
export function ProductDetail({ p }: { p: EntityRecord }) {
  const [lb, setLb] = useState<number | null>(null);
  const photos: string[] = Array.isArray(p.photos) ? (p.photos as unknown[]).map(String) : p.photo ? [String(p.photo)] : [];
  const secs = detailSections(p, 36);
  const prices = priceList(p);
  const lab: CSSProperties = { width: 84, flex: '0 0 84px', color: C.mute, fontSize: 12 };
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 2px' }}>{vehicleName(p)}</h1>
      <div style={{ fontSize: 12, color: C.mute, marginBottom: 8 }}>{[p.car_number, p.vehicle_status, p.product_type].filter(Boolean).join(' · ')}</div>

      {photos.length ? (
        <div onClick={() => setLb(0)} style={{ position: 'relative', aspectRatio: '16 / 9', background: '#eef1f5', borderRadius: 4, overflow: 'hidden', cursor: 'zoom-in' }}>
          <img src={photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {photos.length > 1 && <span style={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(0,0,0,0.62)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 3 }}>사진 {photos.length}장</span>}
        </div>
      ) : (
        <div style={{ aspectRatio: '16 / 9', background: '#eef1f5', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 12.5 }}>사진 준비중</div>
      )}

      <div style={{ marginTop: 10, border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, tableLayout: 'fixed' }}>
          <thead><tr>{['기간', '월대여료', '보증금'].map((h, i) => <th key={i} style={{ width: '33.33%', padding: '5px 10px', textAlign: i ? 'right' : 'left', background: C.head, borderBottom: '1px solid var(--border)', fontSize: 11, color: '#33415a', fontWeight: 700 }}>{h}</th>)}</tr></thead>
          <tbody>{prices.length === 0 ? <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: C.faint }}>가격 문의</td></tr> :
            prices.map((pr, i) => (
              <tr key={i} style={{ borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
                <td style={{ padding: '5px 10px' }}>{pr.m}개월</td>
                <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 800, color: C.brand, fontFamily: 'var(--font-mono)' }}>{won(pr.rent)}</td>
                <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{won(pr.deposit)}</td>
              </tr>
            ))}</tbody>
        </table>
      </div>

      {secs.map((sec) => (
        <div key={sec.title} style={{ marginTop: 11 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 4 }}>{sec.title}</div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff' }}>
            {sec.rows.map(([k, v], i) => (
              <div key={i} style={{ display: 'flex', padding: '4px 10px', borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
                <span style={lab}>{k}</span>
                <span style={{ fontSize: 12, color: (v == null || v === '') ? '#cbd5e1' : C.ink, fontVariantNumeric: 'tabular-nums' }}>{(v == null || v === '') ? '—' : String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {lb !== null && photos[lb] && (
        <div onClick={() => setLb(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <img src={photos[lb]} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          <button onClick={(e) => { e.stopPropagation(); setLb(null); }} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 22, cursor: 'pointer' }}>×</button>
          {photos.length > 1 && (<>
            <button onClick={(e) => { e.stopPropagation(); setLb((lb - 1 + photos.length) % photos.length); }} aria-label="이전 사진" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: 22, border: 'none', background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 26, cursor: 'pointer' }}>‹</button>
            <button onClick={(e) => { e.stopPropagation(); setLb((lb + 1) % photos.length); }} aria-label="다음 사진" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: 22, border: 'none', background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 26, cursor: 'pointer' }}>›</button>
          </>)}
        </div>
      )}
    </div>
  );
}
