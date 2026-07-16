'use client';
import Link from 'next/link';
import { type EntityRecord } from '@/lib/intake/entities';
import { useFirstPhoto } from '@/components/use-product-photos';
import { C } from '@/components/ui';
import { badges, Identity, SpecLine, PriceHeadline, CarGlyph } from '@/components/product-card-atoms';

// 매물 카드 = 세로형(사진 상단+뱃지 오버레이 / 신원 2줄·스펙·가격 하단). 가로카드와 같은 공용 원자 → 연장선 디자인.
// 원자 범위: 신원(제조사·세부모델/파워트레인·세부트림)+스펙까지. 옵션은 그리드 간결 위해 생략(가로카드에서 전부).
export function ProductCard({ p }: { p: EntityRecord }) {
  const photo = useFirstPhoto(p);
  return (
    <Link href={`/m/${encodeURIComponent(String(p.product_code))}`}
      style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff', overflow: 'hidden', textDecoration: 'none', color: 'inherit', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#eef1f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {photo ? <img src={photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <CarGlyph size={46} />}
        <span style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>{badges(p, true)}</span>
      </div>
      <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <Identity p={p} size={14} />
        <SpecLine p={p} />
        <div style={{ marginTop: 'auto', borderTop: `1px solid ${C.line2}`, paddingTop: 8 }}><PriceHeadline p={p} /></div>
      </div>
    </Link>
  );
}
