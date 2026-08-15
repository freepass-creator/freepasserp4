import { NextResponse } from 'next/server';
import {
  loadFreepassSessionByToken,
  uploadPrivateEsignFile,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { normalizeEsignRequiredDocuments } from '@/lib/domain/esign-required-documents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_SUPPORTING_DOCUMENT_BYTES = 5_000_000;
const HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};
const S = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): EsignRecord => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : {}
);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function extension(contentType: string) {
  if (contentType === 'application/pdf') return 'pdf';
  if (/png/i.test(contentType)) return 'png';
  if (/webp/i.test(contentType)) return 'webp';
  if (/hei[cf]/i.test(contentType)) return 'heic';
  return 'jpg';
}

function allowedContentType(value: string) {
  return value === 'application/pdf' || /^image\/(jpeg|png|webp|heic|heif)$/i.test(value);
}

function originalFileName(value: string, fallback: string) {
  try { return S(decodeURIComponent(value)).slice(0, 120) || fallback; }
  catch { return fallback; }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; docKey: string }> },
) {
  const resolved = await params;
  const token = S(resolved.token);
  const docKey = S(resolved.docKey);
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(docKey)) {
    return json({ error: '첨부서류 항목이 올바르지 않습니다.' }, 400);
  }
  const loaded = await loadFreepassSessionByToken(token);
  if (!loaded) return json({ error: '유효하지 않은 전자계약 링크입니다.' }, 404);
  const { hash, session } = loaded;
  const status = S(session.status);
  if (Number(session.revokedAt || 0) || !['sent', 'opened'].includes(status)) {
    return json({ error: '지금은 첨부서류를 제출할 수 없습니다.' }, 409);
  }
  if (Number(session.expiresAt || 0) <= Date.now()) {
    return json({ error: '만료된 전자계약 링크입니다.' }, 410);
  }
  const snapshot = record(session.snapshot);
  const requested = normalizeEsignRequiredDocuments(snapshot.requiredDocuments)
    .find((document) => document.key === docKey);
  if (!requested) return json({ error: '이 계약에서 요청하지 않은 첨부서류입니다.' }, 400);

  const contentType = S(request.headers.get('content-type')).toLowerCase().split(';')[0];
  if (!allowedContentType(contentType)) {
    return json({ error: '사진(JPG·PNG·WEBP·HEIC) 또는 PDF만 첨부할 수 있습니다.' }, 415);
  }
  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > MAX_SUPPORTING_DOCUMENT_BYTES) {
    return json({ error: '첨부서류는 파일당 5MB 이하여야 합니다.' }, 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_SUPPORTING_DOCUMENT_BYTES) {
    return json({ error: '첨부서류는 파일당 5MB 이하여야 합니다.' }, 413);
  }
  const contractCode = S(session.contractCode);
  if (!contractCode) return json({ error: '계약 연결정보가 없습니다.' }, 409);
  const originalName = originalFileName(request.headers.get('x-file-name') || '', requested.label);
  const asset = await uploadPrivateEsignFile(
    `esign-private/${contractCode}/${hash}/supporting/${docKey}.${extension(contentType)}`,
    bytes,
    contentType,
  );

  const { firebaseAdminDatabase } = await import('@/lib/server/firebase-admin');
  const savedAt = Date.now();
  const saved = await firebaseAdminDatabase().ref(`v4/esign_sessions/${hash}`).transaction((current) => {
    if (!current || Number(current.revokedAt || 0)) return;
    if (!['sent', 'opened'].includes(S(current.status)) || Number(current.expiresAt || 0) <= Date.now()) return;
    const liveSnapshot = record(current.snapshot);
    if (!normalizeEsignRequiredDocuments(liveSnapshot.requiredDocuments).some((row) => row.key === docKey)) return;
    return {
      ...current,
      supportingUploads: {
        ...record(current.supportingUploads),
        [docKey]: {
          key: docKey,
          label: requested.label,
          originalName,
          path: asset.path,
          sha256: asset.sha256,
          size: asset.size,
          contentType: asset.contentType,
          uploadedAt: savedAt,
        },
      },
    };
  }, undefined, false);
  if (!saved.committed) return json({ error: '계약 상태가 변경되어 첨부서류를 저장하지 못했습니다.' }, 409);
  return json({ ok: true, key: docKey, label: requested.label, originalName, size: asset.size });
}
