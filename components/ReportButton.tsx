'use client';
import { useState } from 'react';
import { submitReport, REPORT_REASONS } from '@/lib/domain/report';
import { toast } from '@/components/Toaster';
import { Btn, ButtonLabel, C, Select, Textarea, FS, FW, ICON, Modal } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';
import { Flag, Send } from 'lucide-react';

// 이상매물 제보 — 영업자가 매물 보다 이상하면 클릭. 공급사·관리자에게 전달(관리자 확인처=/data-check).
// 본문 가로폭에 맞춤(maxWidth 제한·가운데 딸랑 금지).
export function ReportButton({ p }: { p: EntityRecord }) {
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
      <Btn title="상품 검수 요청" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <ButtonLabel icon={<Flag size={ICON.md} aria-hidden />}>검수 요청</ButtonLabel>
      </Btn>
    );
  }

  return (
    <Modal
      open
      title="상품 검수 요청"
      meta="공급사·관리자에게 전달"
      onClose={() => { if (!busy) setOpen(false); }}
      width={480}
      footer={(
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Btn title="검수 요청 취소" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>취소</Btn>
          <Btn title={busy ? '검수 요청 접수 중' : '검수 요청 보내기'} size="sm" onClick={submit} disabled={busy}>
            <ButtonLabel icon={<Send size={ICON.md} aria-hidden />}>{busy ? '접수 중…' : '요청 보내기'}</ButtonLabel>
          </Btn>
        </div>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: FS.sub, fontWeight: FW.body, color: C.mute }}>
          매물 정보나 사진에서 발견한 문제를 선택해 주세요.
        </div>
        <Select full value={reason} onChange={setReason} options={[...REPORT_REASONS]} />
        <Textarea full rows={3} value={memo} onChange={setMemo}
          placeholder="상세 내용(선택) — 예: 사진이 다른 차량입니다"
          style={{ background: C.taupeBg }} />
      </div>
    </Modal>
  );
}
