'use client';
import type { EntityRecord } from '@/lib/intake/entities';
import type { Role } from '@/lib/domain/deal';
import { man } from '@/lib/format';
import { C, FS, FW, NUM } from '@/components/ui';

export function SettlementSummary({ settlements, role }: { settlements: EntityRecord[]; role: Role }) {
  if (!settlements.length) return null;
  const sum = (pred: (s: EntityRecord) => boolean, value: (s: EntityRecord) => unknown) =>
    settlements.filter(pred).reduce((total, settlement) => total + (Number(value(settlement)) || 0), 0);
  const amount = (s: EntityRecord) => role === 'agent' ? s.agent_payout : s.fee_amount;
  const cells: [string, number, string][] = [
    ['대기', sum((s) => String(s.settlement_status) === '정산대기', amount), C.warn],
    ['완료', sum((s) => String(s.settlement_status) === '정산완료', amount), C.ok],
    ['환수', sum((s) => String(s.settlement_status).includes('환수'), (s) => s.clawback_amount), C.danger],
    ...(role === 'admin' ? [['순수익', sum((s) => String(s.settlement_status) === '정산완료', (s) => s.net_amount), C.brand] as [string, number, string]] : []),
  ];
  return <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, background: C.head, position: 'sticky', top: 0, zIndex: 2 }}>
    {cells.map(([label, value, color], index) => <div key={label} style={{ flex: 1, padding: '7px 8px', borderLeft: index ? `1px solid ${C.line2}` : 'none', textAlign: 'center' }}>
      <div style={{ fontSize: FS.micro, color: C.mute, fontWeight: FW.strong }}>{label}</div>
      <div style={{ fontSize: FS.body, fontWeight: FW.head, color, fontFamily: NUM }}>{man(value)}</div>
    </div>)}
  </div>;
}
