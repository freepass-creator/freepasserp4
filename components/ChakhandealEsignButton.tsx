'use client';

import { useState } from 'react';
import { FileSignature } from 'lucide-react';
import { getAuthClient } from '@/lib/firebase/client';
import { Btn, ButtonLabel, ICON } from '@/components/ui';
import { confirmDialog, toast } from '@/components/Toaster';

export function ChakhandealEsignButton({ contractCode, onSent }: { contractCode: string; onSent?: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy) return;
    const confirmed = await confirmDialog({
      title: '전자계약 발송',
      message: '착한거래에서 고객 연락처로 전자계약 서명 요청을 발송합니다.',
      okLabel: '발송',
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
        body: JSON.stringify({ contractCode }),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `발송 실패 (${response.status})`);
      toast('착한거래 전자계약을 발송했습니다.', 'ok');
      await onSent?.();
    } catch (error) {
      toast(error instanceof Error ? error.message : '전자계약 발송에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Btn title="착한거래 전자계약 발송" onClick={send} disabled={busy}>
      <ButtonLabel icon={<FileSignature size={ICON.md} aria-hidden />}>{busy ? '발송 중…' : '전자계약 발송'}</ButtonLabel>
    </Btn>
  );
}
