'use client';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName, creditDisplay, vehicleTone, noDeposit, minAge, shortExperience } from '@/lib/domain/product';
import { C } from '@/components/ui';
import { PeriodPrices } from '@/components/PeriodPrices';

// 매물 카드 = 세로형 원자(사진 상단 + 정보 하단). 카드=그리드 배열, 리스트=가로카드 배열.
const TAG: Record<string, [string, string]> = { green: ['#15803d', '#d9f3e1'], amber: ['#9a5b00', '#fbebc4'], blue: ['#1d4ed8', '#dbe7fd'], red: ['#c02418', '#fdd7d1'], teal: ['#0e7490', '#d0eef5'], purple: ['#7c3aed', '#eadffd'], gray: ['#475569', '#eef1f5'] };
function tag(tone: string): CSSProperties {
  const c = TAG[tone] || TAG.gray;
  return { fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 3, color: c[0], background: c[1], whiteSpace: 'nowrap', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' };
}
function CarGlyph() {
  return <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#c4ccd8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 13l1.6-4.2A2 2 0 0 1 8.5 7.5h7A2 2 0 0 1 17.4 8.8L19 13" /><path d="M3 13h18v3.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V13z" /><circle cx="7.5" cy="17.5" r="1.6" /><circle cx="16.5" cy="17.5" r="1.6" /></svg>;
}

export function ProductCard({ p }: { p: EntityRecord }) {
  const st = String(p.vehicle_status || '');
  const cd = creditDisplay(p);
  const photo = p.photo ? String(p.photo) : '';
  const spec = [p.car_number, p.year && `${p.year}년`, p.mileage && `${Number(p.mileage).toLocaleString()}km`, p.fuel_type].filter(Boolean).join(' · ');
  return (
    <Link href={`/m/${encodeURIComponent(String(p.product_code))}`}
      style={{ display: 'block', border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', overflow: 'hidden', textDecoration: 'none', color: 'inherit', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#eef1f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {photo ? <img src={photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <CarGlyph />}
        <span style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span style={tag(vehicleTone(st))}>{st}</span>
          <span style={tag(cd === '소득무관' ? 'green' : 'amber')}>{cd}</span>
          {noDeposit(p) && <span style={tag('blue')}>무보증</span>}
          {minAge(p) > 0 && minAge(p) <= 21 && <span style={tag('teal')}>만{minAge(p)}세</span>}
          {shortExperience(p) && <span style={tag('purple')}>경력무관</span>}
        </span>
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vehicleName(p)}</div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spec}</div>
        {[p.vehicle_class, p.product_type].filter(Boolean).length > 0 &&
          <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.vehicle_class, p.product_type].filter(Boolean).join(' · ')}</div>}
        <div style={{ marginTop: 9, borderTop: `1px solid ${C.line2}`, paddingTop: 8 }}>
          <PeriodPrices p={p} />
        </div>
      </div>
    </Link>
  );
}
