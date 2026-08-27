import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { VerifyView } from './VerifyView';

export const dynamic = 'force-dynamic';

export default async function VerifyPage({ params }: { params: Promise<{ sealHash: string }> }) {
  const sealHash = String((await params).sealHash || '').trim().toLowerCase();
  const valid = /^[a-f0-9]{64}$/.test(sealHash);
  let row: Record<string, unknown> | null = null;
  if (valid) {
    try {
      row = (await firebaseAdminDatabase().ref(`v4/esign_verifications/${sealHash}`).get()).val() as Record<string, unknown> | null;
    } catch {
      row = null;
    }
  }
  const signedAt = Number(row?.signedAt || 0);
  return (
    <VerifyView
      ok={!!row}
      contractCode={String(row?.contractCode || '')}
      signedLabel={signedAt ? new Date(signedAt).toLocaleString('ko-KR') : '—'}
      sealHash={sealHash}
      documentSha256={String(row?.documentSha256 || 'PDF 생성 전')}
    />
  );
}
