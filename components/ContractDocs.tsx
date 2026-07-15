'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { C } from '@/components/ui';
import { Paperclip, FileText, X } from 'lucide-react';

// 첨부 서류 = 계약별 파일 목록/첨부. (로컬은 메타만 저장 — 실 업로드는 Firebase Storage 후속)
type Att = { name: string; size: number; type: string; at: number };
export function ContractDocs({ contractCode }: { contractCode: string }) {
  const co = getCompanyId();
  const [atts, setAtts] = useState<Att[]>([]);
  const load = async () => { const c = await getStore().get('contract', co, contractCode); setAtts(Array.isArray(c?.attachments) ? (c!.attachments as Att[]) : []); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contractCode]);
  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const now = Date.now();
    const next = [...atts, ...Array.from(files).map((f) => ({ name: f.name, size: f.size, type: f.type, at: now }))];
    await getStore().update('contract', co, contractCode, { attachments: next });
    setAtts(next);
  };
  const remove = async (i: number) => { const next = atts.filter((_, j) => j !== i); await getStore().update('contract', co, contractCode, { attachments: next }); setAtts(next); };
  const sz = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>첨부 서류</span>
        <span style={{ fontSize: 11, color: C.faint }}>{atts.length}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 10px', border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', color: C.ink, fontSize: 11.5, cursor: 'pointer' }}>
          <Paperclip size={13} /> 파일 첨부
          <input type="file" multiple onChange={(e) => onFiles(e.target.files)} style={{ display: 'none' }} />
        </label>
      </div>
      {atts.length === 0 ? <div style={{ fontSize: 11.5, color: C.faint }}>첨부된 서류가 없습니다.</div> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {atts.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff' }}>
              <FileText size={14} color={C.mute} />
              <span style={{ fontSize: 12, color: C.ink, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
              <span style={{ fontSize: 10.5, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{sz(a.size)}</span>
              <button onClick={() => remove(i)} aria-label="삭제" style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.faint, display: 'flex' }}><X size={13} /></button>
            </div>
          ))}
        </div>}
    </div>
  );
}
