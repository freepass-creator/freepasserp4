'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { getAuthClient } from '@/lib/firebase/client';
import { Btn, ButtonLabel, ICON } from '@/components/ui';
import { confirmDialog, toast } from '@/components/Toaster';

/**
 * 서명 링크 만들기(issue). 채널 발송이 아니다 — 응답 signUrl을 복사해 전달한다.
 */
export function ChakhandealEsignButton({
  contractCode,
  standardTemplateId,
  contractKind,
  templateFields,
  label = '서명 링크 만들기',
  onSent,
}: {
  contractCode: string;
  /** 프리패스 표준계약서 3벌 중 관리자가 확정한 한 벌. 외부 템플릿 ID가 아니다. */
  standardTemplateId: string;
  /** 선택한 표준계약서 안의 인수/반납 확정값. */
  contractKind: string;
  /** 직접 입력 덮어쓰기 — 외부 조립값 위에 얹어 templateFields 로 발행 */
  templateFields?: Record<string, string>;
  label?: string;
  onSent?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy) return;
    const confirmed = await confirmDialog({
      title: label,
      message:
        '착한거래에 계약을 발행하고 서명 링크를 만듭니다. 문자·카카오는 보내지 않습니다. 만들어진 링크를 복사해 손님에게 보내세요.',
      okLabel: '링크 만들기',
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
        body: JSON.stringify({
          contractCode,
          standardTemplateId,
          contractKind,
          ...(templateFields && Object.keys(templateFields).length
            ? { templateFields }
            : {}),
        }),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        warnings?: { missingRequired?: { field: string }[] };
      };
      if (!response.ok) throw new Error(body.error || `서명 링크 만들기 실패 (${response.status})`);
      const missing = body.warnings?.missingRequired?.length || 0;
      toast(
        missing
          ? `서명 링크를 만들었습니다. 인쇄칸 ${missing}개가 비어 있습니다 — 링크를 복사해 전달하세요.`
          : '서명 링크를 만들었습니다. 링크를 복사해 손님에게 보내세요.',
        missing ? 'info' : 'ok',
      );
      await onSent?.();
    } catch (error) {
      toast(error instanceof Error ? error.message : '서명 링크 만들기에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Btn title={label} onClick={send} disabled={busy}>
      <ButtonLabel icon={<Link2 size={ICON.md} aria-hidden />}>{busy ? '만드는 중…' : label}</ButtonLabel>
    </Btn>
  );
}
