'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, type EntityRecord } from '@/lib/intake/entities';
import { PaneHead, Btn, FormGrid, C } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';

// 정책관리 = [정책 목록 | 정책 편집]. 스키마 SSOT(ENTITIES.policy) + FormGrid. 정책 수정 → 그 정책 쓰는 매물에 반영(enrich).
export default function PolicyMgmt() {
  const co = getCompanyId();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');

  const load = async () => { const all = await getStore().list('policy', co); setRows(all); return all; };
  const selectP = (p: EntityRecord) => { setSel(String(p.policy_code)); setForm({ ...p }); setDirty(false); };
  const clearSel = () => { setSel(null); setForm({}); setDirty(false); };
  useEffect(() => { (async () => { await seedIfEmpty(co); const all = await load(); if (all.length) selectP(all[0]); })(); /* eslint-disable-next-line */ }, []);

  const onChange = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const save = async () => { if (!String(form.policy_code || '').trim()) { alert('정책코드는 필수입니다.'); return; } await getStore().save('policy', co, [form]); await getStore().update('policy', co, String(form.policy_code), form); setDirty(false); await load(); setSel(String(form.policy_code)); };
  const newP = () => { const c = `POL-${Date.now().toString(36).slice(-5).toUpperCase()}`; setSel(c); setForm({ policy_code: c }); setDirty(true); };

  const shown = (rows || []).filter((p) => !q || [p.policy_name, p.policy_code, p.policy_type, p.screening_criteria].join(' ').toLowerCase().includes(q.toLowerCase()));
  const listEl = shown.length === 0
    ? <div style={{ padding: 24, textAlign: 'center', color: C.faint, fontSize: 12.5 }}>{q ? '검색 결과 없음' : '정책 없음'}</div>
    : <div>{shown.map((p) => {
        const on = String(p.policy_code) === sel;
        return (
          <div key={String(p.policy_code)} onClick={() => selectP(p)} style={{ padding: '11px 14px', borderBottom: `1px solid ${C.line2}`, cursor: 'pointer', background: on ? '#eef4ff' : 'transparent' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{String(p.policy_name || p.policy_code)}</div>
            <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>{[p.policy_code, p.policy_type, p.screening_criteria].filter(Boolean).join(' · ')}</div>
          </div>
        );
      })}</div>;

  const editPane = (
    <>
      <PaneHead title="정책 편집" right={<Btn size="sm" onClick={save} disabled={!dirty}>저장</Btn>} />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '12px 14px' }}>
        {sel ? <FormGrid fields={ENTITIES.policy.fields} form={form} onChange={onChange} cols={2} /> : <div style={{ color: C.faint, fontSize: 12.5 }}>정책을 선택하세요.</div>}
      </div>
    </>
  );
  const panes: WorkPane[] = [{ key: 'edit', title: '정책 편집', node: editPane }];
  return <WorkPage title="정책" listCount={rows ? rows.length : ''} list={rows === null ? <div style={{ padding: 24, color: C.faint }}>불러오는 중…</div> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
    search={{ value: q, onChange: setQ, placeholder: '정책명·코드·심사' }} actions={<Btn size="sm" onClick={newP}>정책 등록</Btn>} />;
}
