'use client';
import { useState } from 'react';
import { submitReport, REPORT_REASONS } from '@/lib/domain/report';
import { toast } from '@/components/Toaster';
import { Btn, C, R, Select, Textarea, FS, FW } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';

// 이상매물 제보 — 영업자가 매물 보다 이상하면 클릭. 공급사·관리자에게 전달(관리자 확인처=/data-check).
// 본문 가로폭에 맞춤(maxWidth 제한·가운데 딸랑 금지).
export function ReportButton({ p }: { p: EntityRecord }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try { await submitReport(p, reason, memo.trim()); toast('검수 요청 접수됨 — 관리자·공급사에 전달됩니다', 'ok'); setOpen(false); setMemo(''); }
    catch (e) { toast('요청 실패(규칙 배포 필요): ' + String((e as Error).message || e), 'error'); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: FS.sub, color: C.faint }}>매물 정보·사진이 이상하면 검수를 요청하세요.</span>
        <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>⚑ 검수 요청</Btn>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%', boxSizing: 'border-box',
      border: `1px solid ${C.line}`, borderRadius: R, background: C.warnBg,
      padding: mobile ? 12 : 12, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: FS.sub, fontWeight: FW.head, color: C.warn }}>
        상품 검수 요청
        <span style={{ fontWeight: FW.body, color: C.mute }}> · 공급사·관리자에게 전달</span>
      </div>
      <Select full value={reason} onChange={setReason} options={[...REPORT_REASONS]} />
      <Textarea full rows={2} value={memo} onChange={setMemo}
        placeholder="상세 내용(선택) — 예: 사진이 다른 차량입니다"
        style={{ background: C.taupeBg }} />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Btn size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>취소</Btn>
        <Btn size="sm" onClick={submit} disabled={busy}>{busy ? '접수 중…' : '요청 보내기'}</Btn>
      </div>
    </div>
  );
}
