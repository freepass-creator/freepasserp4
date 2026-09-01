'use client';

import { Message, WorkRow, WorkTable } from '@/components/ui';
import { C, FS, FW } from '@/components/ui/tokens';
import { GUEST_W } from '@/lib/guest-layout';

export function VerifyView({
  ok,
  contractCode,
  signedLabel,
  sealHash,
  documentSha256,
}: {
  ok: boolean;
  contractCode: string;
  signedLabel: string;
  sealHash: string;
  documentSha256: string;
}) {
  return (
    <main style={{ maxWidth: GUEST_W, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ fontSize: FS.page, fontWeight: FW.head, margin: '0 0 12px', color: C.ink }}>프리패스 전자계약 검증</h1>
      {ok ? (
        <>
          <Message variant="success">프리패스에서 봉인한 전자계약입니다.</Message>
          <WorkTable title="봉인 정보">
            <WorkRow label="계약번호">{contractCode}</WorkRow>
            <WorkRow label="서명 확정">{signedLabel}</WorkRow>
            <WorkRow label="봉인 해시">{sealHash}</WorkRow>
            <WorkRow label="문서 해시">{documentSha256}</WorkRow>
          </WorkTable>
        </>
      ) : (
        <Message variant="danger">확인되지 않는 봉인 해시입니다.</Message>
      )}
    </main>
  );
}
