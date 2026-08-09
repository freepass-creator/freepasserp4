'use client';

import { useState } from 'react';
import { FileSignature } from 'lucide-react';
import { getAuthClient } from '@/lib/firebase/client';
import { Btn, ButtonLabel, ICON } from '@/components/ui';
import { confirmDialog, toast } from '@/components/Toaster';

export function ChakhandealEsignButton({
  contractCode, templateId, label = '전자계약 발송', onSent,
}: {
  contractCode: string;
  /** 공급사별 계약서 양식. 미지정이면 서버 기본 양식(CHAKHANDEAL_TEMPLATE_ID). */
  templateId?: string;
  label?: string;
  onSent?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy) return;
    const confirmed = await confirmDialog({
      title: label,
      message: '착한거래에 계약서를 만듭니다. 만들어진 링크를 복사해 손님에게 보내세요.',
      okLabel: '만들기',
    });
    if (!confirmed) return;
    const user = getAuthClient()?.currentUser;
    if (!user) { toast('로그인이 필요합니다.', 'error'); return; }

    setBusy(true);
    try {
      const response = await fetch('/api/chakhandeal/contracts/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contractCode, ...(templateId ? { templateId } : null) }),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `계약서 작성 실패 (${response.status})`);
      toast('계약서를 만들었습니다. 링크를 복사해 손님에게 보내세요.', 'ok');
      await onSent?.();
    } catch (error) {
      toast(error instanceof Error ? error.message : '계약서 작성에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Btn title={label} onClick={send} disabled={busy}>
      <ButtonLabel icon={<FileSignature size={ICON.md} aria-hidden />}>{busy ? '만드는 중…' : label}</ButtonLabel>
    </Btn>
  );
}
