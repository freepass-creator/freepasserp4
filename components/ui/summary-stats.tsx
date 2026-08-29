'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, FS, FW, ICON, R_CARD } from './tokens';

/** 계약·정산 등 핵심 수치를 같은 순서와 카드 문법으로 보여 주는 공용 요약 줄. */
export function SummaryStats({ items }: {
  items: Array<{ label: string; value: ReactNode; icon?: LucideIcon }>;
}) {
  const mobile = useIsMobile();
  return (
    <div style={{
      display: 'grid', gap: 8, minWidth: 0,
      gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))`,
    }}>
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} style={{ minWidth: 0, border: `1px solid ${C.line}`, borderRadius: R_CARD, background: C.taupeBg, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, color: C.mute, fontSize: FS.cap, fontWeight: FW.label }}>
            {Icon ? <Icon size={ICON.sm} aria-hidden /> : null}
            <span>{label}</span>
          </div>
          <div style={{ minWidth: 0, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.ink, fontSize: FS.title, fontWeight: FW.head }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}
