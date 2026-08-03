'use client';
import { useEffect, useRef, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { getRole, type Role } from '@/lib/domain/deal';
import { Btn, ButtonLabel, C, actorColor, Textarea, FW, FS, R, ICON } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { Save } from 'lucide-react';

// 계약 역할별 메모 3슬롯(영업/공급/관리자). 본인 역할 슬롯만 편집, 나머지는 열람. 관리자는 전부 편집.
// 필드: memo_agent / memo_provider / memo_admin (명시적 저장 버튼으로만 저장).
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
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const selectionEpoch = useRef(0);
  const contractCodeRef = useRef(contractCode);
  const revisionRef = useRef<Record<string, number>>({});
  contractCodeRef.current = contractCode;

  const load = async (targetCode: string, epoch: number) => {
    const c = await getStore().get('contract', co, targetCode);
    if (selectionEpoch.current !== epoch || contractCodeRef.current !== targetCode) return;
    setMemos({ agent: String(c?.memo_agent || ''), provider: String(c?.memo_provider || ''), admin: String(c?.memo_admin || '') });
    setDirty({});
    setSaving({});
    revisionRef.current = {};
  };
  useEffect(() => {
    const epoch = ++selectionEpoch.current;
    setRole(getRole());
    setDirty({});
    setSaving({});
    void load(contractCode, epoch);
    return () => {
      if (selectionEpoch.current === epoch) selectionEpoch.current += 1;
    };
    /* eslint-disable-next-line */
  }, [contractCode]);
  useEffect(() => { const on = (e: Event) => setRole((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);

  const save = async (slot: string) => {
    if (!dirty[slot] || saving[slot]) return;
    const targetCode = contractCodeRef.current;
    const epoch = selectionEpoch.current;
    const revision = revisionRef.current[slot] || 0;
    const value = memos[slot];
    setSaving((current) => ({ ...current, [slot]: true }));
    try {
      await getStore().update('contract', co, targetCode, { [`memo_${slot}`]: value });
      if (selectionEpoch.current === epoch
        && contractCodeRef.current === targetCode
        && (revisionRef.current[slot] || 0) === revision) {
        setDirty((current) => ({ ...current, [slot]: false }));
      }
    } catch (e) {
      toast(`메모 저장 실패: ${String((e as Error)?.message || e)}`, 'error');
    } finally {
      if (selectionEpoch.current === epoch && contractCodeRef.current === targetCode) {
        setSaving((current) => ({ ...current, [slot]: false }));
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ fontSize: FS.cap, fontWeight: FW.title, color: C.ink }}>메모 <span style={{ fontSize: FS.micro, color: C.faint, fontWeight: FW.strong }}>· 본인 역할만 편집</span></span>
      {SLOTS.map(({ slot, label }) => {
        const mine = role === slot || role === 'admin';
        const val = memos[slot] || '';
        return (
          <div key={slot}>
            <div style={{ fontSize: FS.micro, fontWeight: FW.label, color: actorColor(slot), marginBottom: 3 }}>{label}</div>
            {mine ? (
              <>
                <Textarea full rows={2} value={val}
                  ariaLabel={`${label} 메모`}
                  onChange={(v) => {
                    revisionRef.current[slot] = (revisionRef.current[slot] || 0) + 1;
                    setMemos((current) => ({ ...current, [slot]: v }));
                    setDirty((current) => ({ ...current, [slot]: true }));
                  }}
                  placeholder={`${label} 메모…`}
                  disabled={saving[slot]}
                  style={dirty[slot] ? { background: C.warnBg } : undefined} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <Btn
                    title={`${label} 메모 저장`}
                    size="sm"
                    variant={dirty[slot] ? 'solid' : 'ghost'}
                    disabled={!dirty[slot] || saving[slot]}
                    onClick={() => { void save(slot); }}
                  >
                    <ButtonLabel icon={<Save size={ICON.md} aria-hidden />}>
                      {saving[slot] ? '저장 중…' : '저장'}
                    </ButtonLabel>
                  </Btn>
                </div>
              </>
            ) : (
              <div style={{ fontSize: FS.sub, color: val ? C.ink : C.faint, whiteSpace: 'pre-wrap', padding: '5px 8px', border: `1px solid ${C.line2}`, borderRadius: R, background: C.head, minHeight: 28 }}>{val || '—'}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
