'use client';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { useFirstPhoto } from '@/components/use-product-photos';
import { C } from '@/components/ui';
import { badges, Identity, SpecLine, OptionChips, PriceRows, CarGlyph, specLine, productOptions } from '@/components/product-card-atoms';

// 리스트 뷰 = 가로형 카드+엑셀 하이브리드. 세로카드와 같은 공용 원자(연장선 디자인).
// 원자 구성은 모바일·데스크톱 동일, 표현만 상이:
//  · 데스크톱 = 가로 길이를 활용 → 윗단[사진|신원·뱃지|가격] + 아랫단 전폭 가로띠[스펙 · 옵션 주우욱]
//  · 모바일 = 좁으니 세로 스택[사진+신원·뱃지 / 스펙 / 옵션 / 가격]
export function ProductRowCard({ p }: { p: EntityRecord; period?: number }) {
  const mobile = useIsMobile();
  const photo = useFirstPhoto(p);
  const href = `/m/${encodeURIComponent(String(p.product_code))}`;
  const cardStyle = { border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff', padding: 10, textDecoration: 'none', color: 'inherit', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' } as CSSProperties;
  const photoBox = (w: number, h: number | 'stretch') => (
    <div style={{ width: w, flex: `0 0 ${w}px`, ...(h === 'stretch' ? { alignSelf: 'stretch', minHeight: 66 } : { height: h }), borderRadius: 4, background: '#eef1f5', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {photo ? <img src={photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <CarGlyph />}
    </div>
  );
  const badgeRow = <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{badges(p)}</div>;
  const spec = specLine(p);
  const hasDetail = !!spec || productOptions(p).length > 0;

  // 모바일 = 세로 스택. 좁으니 원자를 위→아래로.
  if (mobile) {
    return (
      <Link href={href} style={{ display: 'block', ...cardStyle }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {photoBox(88, 62)}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}><Identity p={p} size={13.5} />{badgeRow}</div>
          </div>
          <SpecLine p={p} />
          <OptionChips p={p} />
          <div style={{ paddingTop: 8, borderTop: `1px solid ${C.line2}` }}><PriceRows p={p} wrap align="flex-start" limit={3} /></div>
        </div>
      </Link>
    );
  }

  // 데스크톱(웹) = 가로 폭 활용. [사진] [신원 1줄 / 뱃지 / 가격 옆으로 쭉 / 스펙·옵션].
  // 가격 = "개월 대여료 보증" 한 단위를 옆으로 쭉 나열(있는 기간 다, 1~60개월도 wrap으로 흡수).
  return (
    <Link href={href} style={{ display: 'flex', gap: 12, alignItems: 'stretch', ...cardStyle }}>
      {photoBox(116, 'stretch')}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
        <Identity p={p} size={14} inline />
        {badgeRow}
        <PriceRows p={p} wrap />
        {hasDetail && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            {spec && <span style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>{spec}</span>}
            <OptionChips p={p} />
          </div>
        )}
      </div>
    </Link>
  );
}
