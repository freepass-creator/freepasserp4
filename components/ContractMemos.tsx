'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { getRole, type Role } from '@/lib/domain/deal';
import { C, actorColor, Textarea } from '@/components/ui';

// 계약 역할별 메모 3슬롯(영업/공급/관리자). 본인 역할 슬롯만 편집, 나머지는 열람. 관리자는 전부 편집.
// 필드: memo_agent / memo_provider / memo_admin (blur 자동저장).
const SLOTS: { slot: Role; label: string }[] = [
  { slot: 'agent', label: '영업' },
  { slot: 'provider', label: '공급' },
  { slot: 'admin', label: '관리자' },
];

export function ContractMemos({ contractCode }: { contractCode: string }) {
  const co = getCompanyId();
  const [role, setRole] = useState<Role>('agent');
  const [memos, setMemos] = useState<Record<string, string>>({ agent: '', provider: '', admin: '' });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const load = async () => {
    const c = await getStore().get('contract', co, contractCode);
    setMemos({ agent: String(c?.memo_agent || ''), provider: String(c?.memo_provider || ''), admin: String(c?.memo_admin || '') });
    setDirty({});
  };
  useEffect(() => { setRole(getRole()); load(); /* eslint-disable-next-line */ }, [contractCode]);
  useEffect(() => { const on = (e: Event) => setRole((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);

  const save = async (slot: string) => { if (!dirty[slot]) return; await getStore().update('contract', co, contractCode, { [`memo_${slot}`]: memos[slot] }); setDirty((d) => ({ ...d, [slot]: false })); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ fontSize: 11.5, fontWeight: 800, color: C.ink }}>메모 <span style={{ fontSize: 10, color: C.faint, fontWeight: 600 }}>· 본인 역할만 편집</span></span>
      {SLOTS.map(({ slot, label }) => {
        const mine = role === slot || role === 'admin';
        const val = memos[slot] || '';
        return (
          <div key={slot}>
            <div style={{ fontSize: 10, fontWeight: 800, color: actorColor(slot), marginBottom: 3 }}>{label}</div>
            {mine ? (
              <Textarea full rows={2} value={val}
                onChange={(v) => { setMemos((m) => ({ ...m, [slot]: v })); setDirty((d) => ({ ...d, [slot]: true })); }}
                onBlur={() => save(slot)} placeholder={`${label} 메모…`}
                style={dirty[slot] ? { background: C.warnBg } : undefined} />
            ) : (
              <div style={{ fontSize: 12, color: val ? C.ink : C.faint, whiteSpace: 'pre-wrap', padding: '5px 8px', border: `1px solid ${C.line2}`, borderRadius: 4, background: '#fafbfc', minHeight: 28 }}>{val || '—'}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
