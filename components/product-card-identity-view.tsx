'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { C, NUM, FW, FS } from '@/components/ui';
import { cardTitle } from '@/components/product-card-identity';

export function Plate({ p }: { p: EntityRecord }) {
  if (!p.car_number) return null;
  return (
    <span style={{
      fontSize: FS.cap, fontWeight: FW.strong, color: C.ink, fontFamily: NUM,
      letterSpacing: '-0.2px', whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{String(p.car_number)}</span>
  );
}

export function CardTitle({ p, narrow, size }: {
  p: EntityRecord;
  narrow?: boolean;
  size?: number;
}) {
  const fontSize = size ?? FS.title;
  const text = cardTitle(p, !!narrow);
  return (
    <div title={text} style={{
      fontSize, fontWeight: FW.title, color: C.ink, lineHeight: 1.2,
      minWidth: 0, width: '100%',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{text}</div>
  );
}
