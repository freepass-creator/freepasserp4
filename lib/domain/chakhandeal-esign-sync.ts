type Rec = Record<string, unknown>;

const S = (value: unknown): string => String(value ?? '').trim();
const N = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export type ChakhandealSyncProjection = {
  contractCode: string;
  patch: Rec;
};

/** 착한거래 회원사 상태 응답을 프리패스 v4 계약 오버레이 필드로 투영한다. */
export function projectChakhandealStatus(
  status: Rec,
  contractCode: string,
  now = Date.now(),
): ChakhandealSyncProjection {
  const code = S(contractCode);
  if (!code || S(status.externalRef) !== code) throw new Error('착한거래 외부 계약번호 불일치');

  const remote = S(status.status);
  const expiresAt = N(status.expiresAt);
  const signedAt = N(status.signedAt);
  const openedAt = N(status.openedAt);
  const documentReady = status.documentReady === true;
  const documentSha256 = S(status.documentSha256);
  const isSigned = remote === 'signed'
    && signedAt > 0
    && documentReady
    && /^[a-f0-9]{64}$/i.test(documentSha256)
    && N(status.documentBytes) > 100;
  const isExpired = !isSigned && expiresAt > 0 && expiresAt < now;
  const signStatus = isSigned
    ? '서명완료'
    : isExpired
      ? '만료'
      : remote === 'opened'
        ? '열람'
        : '발행';

  const patch: Rec = {
    esign_provider: 'chakhandeal',
    esign_id: S(status.contractId),
    esign_sign_url: S(status.signUrl),
    esign_verify_url: S(status.verifyUrl),
    esign_seal_hash: S(status.sealHash).slice(0, 256),
    esign_progress: Math.max(0, Math.min(8, N(status.progress))),
    esign_progress_total: Math.max(0, N(status.progressTotal)),
    esign_documents: Array.isArray(status.documents) ? status.documents : [],
    esign_identity: status.identity && typeof status.identity === 'object' ? status.identity : {},
    esign_document_url: S(status.documentUrl),
    esign_document_sha256: documentSha256.slice(0, 128),
    esign_document_bytes: Math.max(0, N(status.documentBytes)),
    sign_status: signStatus,
    sign_consents: status.consents && typeof status.consents === 'object' ? status.consents : {},
    sign_opened_at: openedAt || null,
    sign_signed_at: isSigned ? signedAt : null,
    sign_expires_at: expiresAt || null,
    esign_sync_at: now,
  };
  if (isSigned) {
    patch.signed_pdf_url = `/api/chakhandeal/contracts/${encodeURIComponent(code)}/document`;
  }
  return { contractCode: code, patch };
}
