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
  'additional_driver', 'insurance', 'accident', 'service', 'agreement', 'signature',
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
  const additionalDriverPolicy = record(snapshot.additionalDriverPolicy);
  if (Number(additionalDriverPolicy.limit || 0) > 0) required.add('additional_driver');
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
    ['customer_id', 30], ['customer_address', 200],
    ['driver_license_no', 30],
    ['emergency_name', 40], ['emergency_phone', 30],
  ] as const) {
    if (S(payload[key]).length > limit) throw new Error('입력값이 너무 깁니다.');
  }
  const customerId = S(payload.customer_id).replace(/\D/g, '');
  if (customerId.length !== 13) throw new Error('주민등록번호 13자리를 정확히 입력해 주세요.');
  if (!S(payload.driver_license_no)) throw new Error('운전면허번호를 입력해 주세요.');
  if (!S(payload.customer_address)) throw new Error('계약서에 기재할 주소를 입력해 주세요.');
  const additionalDriverPolicy = record(snapshot.additionalDriverPolicy);
  const additionalDriverLimit = Math.max(0, Math.min(3, Number(additionalDriverPolicy.limit || 0)));
  const rawAdditionalDrivers = Array.isArray(payload.additional_drivers) ? payload.additional_drivers : [];
  if (rawAdditionalDrivers.length > additionalDriverLimit) {
    throw new Error(`추가 운전자는 최대 ${additionalDriverLimit}명까지 등록할 수 있습니다.`);
  }
  const additionalDrivers = rawAdditionalDrivers.map((value, index) => {
    const driver = record(value);
    const driverName = S(driver.name);
    const relation = S(driver.relation);
    const driverPhone = S(driver.phone).replace(/\D/g, '');
    const driverLicenseNo = S(driver.driver_license_no);
    if (!driverName || driverName.length > 40) throw new Error(`추가 운전자 ${index + 1}의 성명을 확인해 주세요.`);
    if (!relation || relation.length > 30) throw new Error(`추가 운전자 ${index + 1}의 관계를 확인해 주세요.`);
    if (driverPhone.length < 10 || driverPhone.length > 11) throw new Error(`추가 운전자 ${index + 1}의 연락처를 확인해 주세요.`);
    if (!driverLicenseNo || driverLicenseNo.length > 30) throw new Error(`추가 운전자 ${index + 1}의 면허번호를 확인해 주세요.`);
    if (!Number(driver.consentAt || 0)) throw new Error(`추가 운전자 ${index + 1}의 개인정보 제공 동의가 필요합니다.`);
    return {
      name: driverName,
      relation,
      phone: driverPhone,
      driver_license_no: driverLicenseNo,
      consentAt: Number(driver.consentAt),
    };
  });
  return { name, phone, signature, consents, confirmations, additionalDrivers };
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
  const bundle = await loadFreepassEsignBundle(contractCode);
  const db = bundle?.db;
  if (!bundle || !db) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  let snapshot = record(session.snapshot);
  const landlord = record(snapshot.landlord);
  if (!S(landlord.companyName)) {
    const companyName = S(bundle.partner?.company_name || bundle.partner?.name || bundle.partner?.partner_name);
    if (companyName) {
      // 기존 발행본에 누락된 임대인명만 한 번 보완해 이후 회사명 변경의 영향을 받지 않게 동결한다.
      await db.ref(`v4/esign_sessions/${hash}/snapshot/landlord`).set({ companyName });
      snapshot = { ...snapshot, landlord: { companyName } };
    }
  }
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
    snapshot,
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
    const savedProgress = record(session.progress);
    if (Number(savedProgress[step] || 0) > 0) {
      return json({ ok: true, progress: savedProgress, reused: true });
    }
    const progress = { ...savedProgress, [step]: now };
    const writes = Object.keys(progress).filter((key) => PROGRESS_KEYS.has(key)).length;
    await Promise.all([
      // 상태 필드는 건드리지 않는다. 관리자 해지와 동시에 들어와도 revoked를 opened로 되살리지 않는다.
      bundle.db.ref(`v4/esign_sessions/${hash}`).update({
        [`progress/${step}`]: now,
        progressWrites: writes,
        lastProgressAt: now,
      }),
      bundle.db.ref(`v4/contracts/${contractCode}`).update({
        sign_status: '진행중',
        esign_progress: progressCount(progress),
        esign_last_progress_at: now,
      }),
    ]);
    return json({ ok: true, progress });
  }

  let payload: EsignRecord;
  let idCard: File;
  let selfie: File;
  let additionalDriverLicenses: File[];
  try {
    const form = await request.formData();
    payload = JSON.parse(S(form.get('payload'))) as EsignRecord;
    idCard = imageFile(form.get('idCard'), '신분증');
    selfie = imageFile(form.get('selfie'), '본인 셀카');
    const parsed = validateSubmission(payload, record(session.snapshot));
    additionalDriverLicenses = parsed.additionalDrivers.map((_, index) => imageFile(
      form.get(`additionalDriverLicense${index + 1}`),
      `추가 운전자 ${index + 1} 운전면허증`,
    ));
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
    const [idBytes, selfieBytes, additionalDriverLicenseBytes] = await Promise.all([
      idCard.arrayBuffer().then((value) => new Uint8Array(value)),
      selfie.arrayBuffer().then((value) => new Uint8Array(value)),
      Promise.all(additionalDriverLicenses.map((file) => file.arrayBuffer().then((value) => new Uint8Array(value)))),
    ]);
    const root = `esign-private/${contractCode}/${hash}`;
    const [idAsset, selfieAsset, additionalDriverAssets] = await Promise.all([
      uploadPrivateEsignFile(`${root}/id-card.${extension(idCard)}`, idBytes, idCard.type),
      uploadPrivateEsignFile(`${root}/selfie.${extension(selfie)}`, selfieBytes, selfie.type),
      Promise.all(additionalDriverLicenses.map((file, index) => uploadPrivateEsignFile(
        `${root}/additional-driver-${index + 1}-license.${extension(file)}`,
        additionalDriverLicenseBytes[index],
        file.type,
      ))),
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
      additional_drivers: parsed.additionalDrivers.map((driver, index) => ({
        ...driver,
        licensePath: additionalDriverAssets[index].path,
        licenseSha256: additionalDriverAssets[index].sha256,
        licenseContentType: additionalDriverAssets[index].contentType,
      })),
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
        customer_name: parsed.name,
        customer_phone: parsed.phone,
        additional_driver: parsed.additionalDrivers.length ? `${parsed.additionalDrivers.length}인 지정` : '없음',
        sign_status: '검토대기',
        esign_progress: 7,
        esign_submitted_at: now,
        sign_consents: consentTimes,
        sign_rejected_at: null,
        sign_reject_reason: null,
        esign_documents: [
          { key: 'driver_license', label: '운전면허증', submittedAt: now, sha256: idAsset.sha256 },
          { key: 'selfie', label: '본인 셀카', submittedAt: now, sha256: selfieAsset.sha256 },
          ...additionalDriverAssets.map((asset, index) => ({
            key: `additional_driver_license_${index + 1}`,
            label: `추가 운전자 ${index + 1} 운전면허증`,
            submittedAt: now,
            sha256: asset.sha256,
          })),
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
