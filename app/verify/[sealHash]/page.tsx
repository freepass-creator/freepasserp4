import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { C, FS, FW, NUM } from '@/components/ui/tokens';

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
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ fontSize: FS.page, fontWeight: FW.head, margin: '0 0 12px' }}>프리패스 전자계약 검증</h1>
      {row ? (
        <>
          <p style={{ color: C.ok, fontWeight: FW.head }}>프리패스에서 봉인한 전자계약입니다.</p>
          <dl style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, marginTop: 24 }}>
            <dt>계약번호</dt><dd style={{ margin: 0 }}>{String(row.contractCode || '')}</dd>
            <dt>서명 확정</dt><dd style={{ margin: 0 }}>{signedAt ? new Date(signedAt).toLocaleString('ko-KR') : '—'}</dd>
            <dt>봉인 해시</dt><dd style={{ margin: 0, wordBreak: 'break-all', fontFamily: NUM }}>{sealHash}</dd>
            <dt>문서 해시</dt><dd style={{ margin: 0, wordBreak: 'break-all', fontFamily: NUM }}>{String(row.documentSha256 || 'PDF 생성 전')}</dd>
          </dl>
        </>
      ) : (
        <p style={{ color: C.danger, fontWeight: FW.head }}>확인되지 않는 봉인 해시입니다.</p>
      )}
    </main>
  );
}
