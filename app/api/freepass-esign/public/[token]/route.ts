import { NextResponse } from 'next/server';
import {
  FREEPASS_ESIGN_REQUIRED_CONSENTS,
  appendFreepassEsignEvent,
  loadFreepassEsignBundle,
  loadFreepassSessionByToken,
  sha256,
  uploadPrivateEsignFile,
  type EsignRecord,
} from '@/lib/server/freepass-esign';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PUBLIC_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};
// 두 장과 서명 데이터를 합쳐 일반 서버리스 요청 제한 안에 머물도록 한다.
const MAX_IMAGE_BYTES = 1_500_000;
const S = (value: unknown) => String(value ?? '').trim();
const PROGRESS_KEYS = new Set([
  'summary', 'privacy', 'identity', 'vehicle', 'rental', 'payment', 'driver',
  'insurance', 'accident', 'service', 'agreement', 'signature',
]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PUBLIC_HEADERS });
}

function publicStatus(status: string) {
  if (status === 'pending_review') return '검토대기';
  if (status === 'signed') return '서명완료';
  if (status === 'revoked') return '해지';
  return status;
}

function imageFile(value: FormDataEntryValue | null, label: string): File {
  if (!(value instanceof File) || !value.size) throw new Error(`${label} 사진을 첨부해 주세요.`);
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(value.type)) throw new Error(`${label}는 사진 파일만 가능합니다.`);
  if (value.size > MAX_IMAGE_BYTES) throw new Error(`${label}는 1.5MB 이하로 첨부해 주세요.`);
  return value;
}

function extension(file: File) {
  if (/png/i.test(file.type)) return 'png';
  if (/webp/i.test(file.type)) return 'webp';
  if (/hei[cf]/i.test(file.type)) return 'heic';
  return 'jpg';
}

function record(value: unknown): EsignRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : {};
}

function requestEvidence(request: Request, sessionHash: string) {
  const forwarded = S(request.headers.get('x-forwarded-for')).split(',')[0].trim();
  const ip = forwarded || S(request.headers.get('x-real-ip')) || 'unknown';
  return {
    ipHash: sha256(`${sessionHash}:${ip}`),
    userAgent: S(request.headers.get('user-agent')).slice(0, 300),
  };
}

function progressCount(progress: EsignRecord) {
  if (progress.agreement) return 6;
  if (progress.insurance) return 5;
  if (progress.rental || progress.payment || progress.driver) return 4;
  if (progress.vehicle) return 3;
  if (progress.identity) return 2;
  if (progress.privacy) return 1;
  return 0;
}

function validateServerProgress(session: EsignRecord) {
  const snapshot = record(session.snapshot);
  const progress = record(session.progress);
  const groups = Array.isArray(snapshot.consentGroups) ? snapshot.consentGroups : [];
  const required = new Set([
    'summary', 'privacy', 'identity', 'agreement',
    ...groups.map((group) => S(record(group).key)).filter(Boolean),
  ]);
  const missing = [...required].filter((key) => !Number(progress[key] || 0));
  if (missing.length) throw new Error('서버에 확인 기록이 남지 않은 계약 단계가 있습니다. 처음부터 다시 확인해 주세요.');
}

function validateSubmission(payload: EsignRecord, snapshot: EsignRecord) {
  const name = S(payload.customer_name);
  const phone = S(payload.customer_phone).replace(/\D/g, '');
  const signature = S(payload.signature);
  const consents = Array.isArray(payload.consents) ? payload.consents.map(S) : [];
  if (!name || name.length > 40) throw new Error('성명은 1~40자로 입력해 주세요.');
  if (phone.length < 10 || phone.length > 11) throw new Error('연락처를 정확히 입력해 주세요.');
  if (!signature.startsWith('data:image/png;base64,') || signature.length > 600000) {
    throw new Error('전자서명을 다시 입력해 주세요.');
  }
  if (!FREEPASS_ESIGN_REQUIRED_CONSENTS.every((key) => consents.includes(key))) {
    throw new Error('필수 약관 동의가 누락되었습니다.');
  }
  const confirmations = record(payload.sectionConfirmations);
  const groups = Array.isArray(snapshot.consentGroups) ? snapshot.consentGroups : [];
  const missing = groups
    .map((group) => S(record(group).key))
    .filter((key) => key && !Number(confirmations[key] || 0));
  if (missing.length) throw new Error('확인하지 않은 계약 조건이 있습니다.');
  if (!Number(payload.summaryConfirmedAt || 0)) throw new Error('계약 요약을 먼저 확인해 주세요.');
  if (!Number(payload.agreementReadAt || 0)) throw new Error('약관을 끝까지 읽고 동의해 주세요.');
  for (const [key, limit] of [
    ['customer_id', 30], ['customer_address', 200], ['driver_license_no', 50],
    ['emergency_name', 40], ['emergency_phone', 30],
  ] as const) {
    if (S(payload[key]).length > limit) throw new Error('입력값이 너무 깁니다.');
  }
  return { name, phone, signature, consents, confirmations };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = S((await params).token);
  const loaded = await loadFreepassSessionByToken(token);
  if (!loaded) return json({ error: '유효하지 않은 전자계약 링크입니다.' }, 404);
  const { hash, session } = loaded;
  const now = Date.now();
  const status = S(session.status);
  if (status === 'revoked') return json({ status: '해지', error: '해지된 전자계약 링크입니다.' }, 410);
  if (Number(session.expiresAt || 0) <= now && !['pending_review', 'signed'].includes(status)) {
    return json({ status: '만료', error: '만료된 전자계약 링크입니다.' }, 410);
  }
  if (status === 'pending_review' || status === 'signed') {
    return json({
      ok: true,
      status: publicStatus(status),
      documentUrl: status === 'signed'
        ? `/api/freepass-esign/public/${encodeURIComponent(token)}/document`
        : '',
    });
  }
  if (!['sent', 'opened'].includes(status)) {
    return json({ error: '지금은 전자계약을 열 수 없습니다.' }, 409);
  }

  const contractCode = S(session.contractCode);
  if (!contractCode) return json({ error: '계약 연결정보가 없습니다.' }, 409);
  const db = (await loadFreepassEsignBundle(contractCode))?.db;
  if (!db) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  if (!Number(session.openedAt || 0)) {
    await Promise.all([
      db.ref(`v4/esign_sessions/${hash}`).update({ status: 'opened', openedAt: now }),
      db.ref(`v4/contracts/${contractCode}`).update({ sign_status: '열람', esign_opened_at: now }),
      appendFreepassEsignEvent(contractCode, 'opened', requestEvidence(request, hash)),
    ]);
  }
  return json({
    ok: true,
    status: '진행중',
    expiresAt: Number(session.expiresAt || 0),
    rejectReason: S(session.rejectReason),
    supplementItems: Array.isArray(session.supplementItems) ? session.supplementItems.map(S) : [],
    progress: record(session.progress),
    snapshot: session.snapshot || null,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = S((await params).token);
  const loaded = await loadFreepassSessionByToken(token);
  if (!loaded) return json({ error: '유효하지 않은 전자계약 링크입니다.' }, 404);
  const { hash, session } = loaded;
  const now = Date.now();
  if (!['sent', 'opened'].includes(S(session.status)) || Number(session.expiresAt || 0) <= now) {
    return json({ error: '이미 제출했거나 만료된 링크입니다.' }, 409);
  }

  const contentType = S(request.headers.get('content-type')).toLowerCase();
  if (contentType.includes('application/json')) {
    let body: EsignRecord;
    try { body = await request.json() as EsignRecord; }
    catch { return json({ error: '진행정보 형식이 올바르지 않습니다.' }, 400); }
    const step = S(body.step);
    if (S(body.action) !== 'progress' || !PROGRESS_KEYS.has(step)) {
      return json({ error: '기록할 전자계약 단계가 올바르지 않습니다.' }, 400);
    }
    const contractCode = S(session.contractCode);
    const bundle = await loadFreepassEsignBundle(contractCode);
    if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
    const progressTx = await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
      if (!current || !['sent', 'opened'].includes(S(current.status))) return;
      if (Number(current.expiresAt || 0) <= Date.now()) return;
      const writes = Number(current.progressWrites || 0);
      if (writes >= 64) return;
      const progress = record(current.progress);
      return {
        ...current,
        status: 'opened',
        progress: { ...progress, [step]: progress[step] || Date.now() },
        progressWrites: writes + 1,
        lastProgressAt: Date.now(),
      };
    }, undefined, false);
    if (!progressTx.committed) return json({ error: '진행정보를 더 이상 기록할 수 없습니다.' }, 409);
    const nextSession = record(progressTx.snapshot.val());
    const progress = record(nextSession.progress);
    await bundle.db.ref(`v4/contracts/${contractCode}`).update({
      sign_status: '진행중',
      esign_progress: progressCount(progress),
      esign_last_progress_at: now,
    });
    return json({ ok: true, progress });
  }

  let payload: EsignRecord;
  let idCard: File;
  let selfie: File;
  try {
    const form = await request.formData();
    payload = JSON.parse(S(form.get('payload'))) as EsignRecord;
    idCard = imageFile(form.get('idCard'), '신분증');
    selfie = imageFile(form.get('selfie'), '본인 셀카');
    validateSubmission(payload, record(session.snapshot));
    validateServerProgress(session);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '제출 내용을 확인해 주세요.' }, 400);
  }

  const contractCode = S(session.contractCode);
  const bundle = await loadFreepassEsignBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);

  const claim = await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
    if (!current || !['sent', 'opened'].includes(S(current.status))) return;
    if (Number(current.expiresAt || 0) <= Date.now()) return;
    return { ...current, status: 'submitting', submittingAt: Date.now() };
  }, undefined, false);
  if (!claim.committed) return json({ error: '이미 제출 중이거나 처리된 계약입니다.' }, 409);

  try {
    const [idBytes, selfieBytes] = await Promise.all([
      idCard.arrayBuffer().then((value) => new Uint8Array(value)),
      selfie.arrayBuffer().then((value) => new Uint8Array(value)),
    ]);
    const root = `esign-private/${contractCode}/${hash}`;
    const [idAsset, selfieAsset] = await Promise.all([
      uploadPrivateEsignFile(`${root}/id-card.${extension(idCard)}`, idBytes, idCard.type),
      uploadPrivateEsignFile(`${root}/selfie.${extension(selfie)}`, selfieBytes, selfie.type),
    ]);
    const claimedSession = record(claim.snapshot.val());
    const progress = record(claimedSession.progress);
    const parsed = validateSubmission(payload, record(claimedSession.snapshot));
    const consentTimes: EsignRecord = {
      identity_verified: now,
      identity: Number(progress.identity || 0) || now,
      vehicle: Number(progress.vehicle || 0) || now,
      rental: Number(progress.rental || 0) || now,
      payment: Number(progress.payment || 0) || now,
      driver: Number(progress.driver || 0) || now,
      insurance: Number(progress.insurance || 0) || now,
      accident: Number(progress.accident || 0) || now,
      service: Number(progress.service || 0) || now,
      documents: now,
      agreement: Number(progress.agreement || 0) || now,
    };
    for (const key of parsed.consents) consentTimes[key] = now;
    const submission: EsignRecord = {
      status: 'pending_review',
      submittedAt: now,
      customer_name: parsed.name,
      customer_phone: parsed.phone,
      customer_id: S(payload.customer_id),
      customer_address: S(payload.customer_address),
      driver_license_no: S(payload.driver_license_no),
      emergency_name: S(payload.emergency_name),
      emergency_phone: S(payload.emergency_phone),
      signature: parsed.signature,
      signatureSha256: sha256(parsed.signature),
      consentTimes,
      clientConfirmations: parsed.confirmations,
      evidence: requestEvidence(request, hash),
      idCardPath: idAsset.path,
      idCardSha256: idAsset.sha256,
      idCardContentType: idAsset.contentType,
      selfiePath: selfieAsset.path,
      selfieSha256: selfieAsset.sha256,
      selfieContentType: selfieAsset.contentType,
    };
    await Promise.all([
      bundle.db.ref(`v4/esign_private/${contractCode}/${hash}`).set(submission),
      bundle.db.ref(`v4/esign_sessions/${hash}`).update({
        status: 'pending_review', submittedAt: now, submittingAt: null,
      }),
      bundle.db.ref(`v4/contracts/${contractCode}`).update({
        sign_status: '검토대기',
        esign_progress: 7,
        esign_submitted_at: now,
        sign_consents: consentTimes,
        sign_rejected_at: null,
        sign_reject_reason: null,
        esign_documents: [
          { key: 'id_card', label: '신분증', submittedAt: now, sha256: idAsset.sha256 },
          { key: 'selfie', label: '본인 셀카', submittedAt: now, sha256: selfieAsset.sha256 },
        ],
        esign_identity: {
          idCardSha256: idAsset.sha256,
          selfieSha256: selfieAsset.sha256,
          submittedAt: now,
          verifiedAt: 0,
        },
      }),
      appendFreepassEsignEvent(contractCode, 'submitted', requestEvidence(request, hash)),
    ]);
    return json({ ok: true, status: '검토대기' });
  } catch (error) {
    await bundle.db.ref(`v4/esign_sessions/${hash}`).update({
      status: Number(session.openedAt || 0) ? 'opened' : 'sent',
      submittingAt: null,
    }).catch(() => {});
    console.error('[freepass-esign] public submit failed', contractCode, error instanceof Error ? error.message : 'unknown');
    return json({ error: '본인확인 자료와 서명을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }
}
