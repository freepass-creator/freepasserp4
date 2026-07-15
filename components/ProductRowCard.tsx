'use client';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName, creditDisplay, vehicleTone, noDeposit, minAge, shortExperience } from '@/lib/domain/product';
import { C } from '@/components/ui';
import { PeriodPrices } from '@/components/PeriodPrices';

// 리스트 뷰 원자 = 가로로 긴 카드(썸네일 좌 + 신원/스펙 + 우측 대여료). 각지게(radius 4).
const TAG: Record<string, [string, string]> = { green: ['#15803d', '#d9f3e1'], amber: ['#9a5b00', '#fbebc4'], blue: ['#1d4ed8', '#dbe7fd'], red: ['#c02418', '#fdd7d1'], teal: ['#0e7490', '#d0eef5'], purple: ['#7c3aed', '#eadffd'], gray: ['#475569', '#eef1f5'] };
function tag(tone: string): CSSProperties {
  const c = TAG[tone] || TAG.gray;
  return { fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, color: c[0], background: c[1], whiteSpace: 'nowrap', flex: '0 0 auto' };
}
function CarGlyph() {
  return <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#c4ccd8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 13l1.6-4.2A2 2 0 0 1 8.5 7.5h7A2 2 0 0 1 17.4 8.8L19 13" /><path d="M3 13h18v3.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V13z" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" /></svg>;
}

export function ProductRowCard({ p, period }: { p: EntityRecord; period: number }) {
  const st = String(p.vehicle_status || '');
  const cd = creditDisplay(p);
  const photo = p.photo ? String(p.photo) : '';
  const spec = [p.car_number, p.year && `${p.year}년`, p.mileage && `${Number(p.mileage).toLocaleString()}km`, p.fuel_type, p.vehicle_class].filter(Boolean).join(' · ');
  return (
    <Link href={`/m/${encodeURIComponent(String(p.product_code))}`}
      style={{ display: 'flex', gap: 12, alignItems: 'center', border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', padding: 10, textDecoration: 'none', color: 'inherit', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
      <div style={{ width: 116, height: 80, flex: '0 0 116px', borderRadius: 4, background: '#eef1f5', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {photo ? <img src={photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <CarGlyph />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={tag(vehicleTone(st))}>{st}</span>
          <span style={tag(cd === '소득무관' ? 'green' : 'amber')}>{cd}</span>
          {noDeposit(p) && <span style={tag('blue')}>무보증</span>}
          {minAge(p) > 0 && minAge(p) <= 21 && <span style={tag('teal')}>만{minAge(p)}세</span>}
          {shortExperience(p) && <span style={tag('purple')}>경력무관</span>}
          <span style={{ fontSize: 14.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vehicleName(p)}</span>
        </div>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spec}</div>
      </div>
      <div style={{ flex: '0 0 190px', width: 190 }}>
        <PeriodPrices p={p} />
      </div>
    </Link>
  );
}
