'use client';
import { useState } from 'react';
import { submitReport, REPORT_REASONS } from '@/lib/domain/report';
import { toast } from '@/components/Toaster';
import { Btn, C } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';

// 이상매물 제보 — 영업자가 매물 보다 이상하면 클릭. 공급사·관리자에게 전달(관리자 확인처=/data-check).
export function ReportButton({ p, compact }: { p: EntityRecord; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try { await submitReport(p, reason, memo.trim()); toast('확인 요청 접수됨 — 관리자·공급사에 전달됩니다', 'ok'); setOpen(false); setMemo(''); }
    catch (e) { toast('요청 실패(규칙 배포 필요): ' + String((e as Error).message || e), 'error'); }
    finally { setBusy(false); }
  };

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: compact ? 11 : 12, color: C.mute, background: 'none', border: `1px solid ${C.line}`, borderRadius: 4, padding: compact ? '2px 8px' : '4px 10px', cursor: 'pointer' }}>
      ⚑ 확인 요청
    </button>
  );
  const inp: React.CSSProperties = { width: '100%', padding: '6px 8px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 12.5, boxSizing: 'border-box' };
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff7ed', padding: 10, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 340 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9a3412' }}>이상해 보여요 — 확인 요청 <span style={{ fontWeight: 400, color: C.faint }}>· 공급사·관리자에게 전달</span></div>
      <select value={reason} onChange={(e) => setReason(e.target.value)} style={inp}>
        {REPORT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="상세 내용(선택) — 예: 사진이 다른 차량입니다" rows={2} style={{ ...inp, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Btn size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>취소</Btn>
        <Btn size="sm" onClick={submit} disabled={busy}>{busy ? '접수 중…' : '요청 보내기'}</Btn>
      </div>
    </div>
  );
}
