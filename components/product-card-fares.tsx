'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { cheapest, priceAt, priceList } from '@/lib/domain/product';
import { man } from '@/lib/format';
import { C, R, NUM, FW, FS } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';

export function PriceMini({ m, rent, deposit = 0, on = false }: {
  m: number;
  rent: number;
  deposit?: number;
  on?: boolean;
  compact?: boolean;
}) {
  const mobile = useIsMobile();
  const tip = `${m}개월 · 월 ${man(rent)} · ${deposit > 0 ? `보증 ${man(deposit)}` : '무보증'}`;
  return (
    <div
      title={tip}
      style={{
        boxSizing: 'border-box', flex: '0 0 auto',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center',
        gap: 2, padding: mobile ? '6px 9px' : '5px 8px',
        borderRadius: R,
        background: on ? C.selected : C.head,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: mobile ? FS.cap : FS.micro, fontWeight: FW.strong, color: on ? C.brand : C.mute, lineHeight: 1.1 }}>{m}개월</span>
      <span style={{
        fontSize: mobile ? FS.sub : FS.cap,
        fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.head, letterSpacing: '-0.02em', lineHeight: 1.1,
        color: on ? C.brand : C.ink,
      }}>
        <span style={{ fontSize: FS.micro, fontFamily: 'inherit', fontWeight: FW.strong, color: C.faint }}>월 </span>
        {man(rent)}
      </span>
      <span style={{ fontSize: FS.micro, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong, color: C.faint, lineHeight: 1.1 }}>
        보증 {deposit > 0 ? man(deposit) : '없음'}
      </span>
    </div>
  );
}

function PriceFareCards({ all, focusMonth }: {
  all: { m: number; rent: number; deposit: number }[];
  focusMonth: number;
}) {
  return (
    <div
      aria-label="기간별 대여료·보증금"
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'stretch',
        gap: 4, width: '100%',
      }}
    >
      {all.map((price) => (
        <PriceMini
          key={price.m}
          m={price.m}
          rent={price.rent}
          deposit={price.deposit}
          on={price.m === focusMonth}
          compact
        />
      ))}
    </div>
  );
}

export function PriceFare({ p, focusMonth, compact = false }: {
  p: EntityRecord;
  focusMonth?: number;
  compact?: boolean;
}) {
  const mobile = useIsMobile();
  const all = priceList(p);
  const focus = focusMonth && focusMonth > 0 ? priceAt(p, focusMonth) : cheapest(p);
  if (!all.length || !focus) {
    return <span style={{ fontSize: mobile ? FS.sub : FS.cap, color: C.faint }}>가격문의</span>;
  }
  if (compact) return <PriceFareCards all={all} focusMonth={focus.m} />;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 5, width: '100%' }}>
      {all.map((price) => (
        <PriceMini key={price.m} m={price.m} rent={price.rent} deposit={price.deposit} on={price.m === focus.m} />
      ))}
    </div>
  );
}
