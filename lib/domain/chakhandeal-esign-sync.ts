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
    esign_supplements: normalizeStoredSupplements(status.supplements),
    esign_supplement_active: normalizeStoredActive(status.supplementActive),
    esign_handover: normalizeStoredHandover(status.handover),
    esign_pending_handover: status.pendingHandover === true,
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

type SupplementRow = { items: string[]; message: string; requestedAt: number | null };

function normalizeStoredSupplements(raw: unknown, max = 40): SupplementRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SupplementRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Rec;
    const items = Array.isArray(r.items)
      ? r.items.map((x) => S(x).slice(0, 60)).filter(Boolean).slice(0, 20)
      : [];
    out.push({
      items,
      message: S(r.message).slice(0, 1000),
      requestedAt: N(r.requestedAt) || null,
    });
    if (out.length >= max) break;
  }
  return out;
}

function normalizeStoredActive(raw: unknown): SupplementRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Rec;
  const items = Array.isArray(r.items)
    ? r.items.map((x) => S(x).slice(0, 60)).filter(Boolean).slice(0, 20)
    : [];
  if (!items.length && !S(r.message)) return null;
  return {
    items,
    message: S(r.message).slice(0, 1000),
    requestedAt: N(r.requestedAt) || null,
  };
}

function normalizeStoredHandover(raw: unknown): Rec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Rec;
  const handover_datetime = S(r.handover_datetime).slice(0, 40);
  const contract_start = S(r.contract_start).slice(0, 40);
  const contract_end = S(r.contract_end).slice(0, 40);
  if (!handover_datetime && !contract_start) return null;
  return {
    handover_datetime,
    contract_start,
    contract_end,
    car_number: S(r.car_number).slice(0, 40),
    vin: S(r.vin).slice(0, 80),
  };
}
