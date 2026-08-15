import { NextResponse } from 'next/server';
import { BearerTokenError, verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  FREEPASS_ESIGN_CONSENT_VERSION,
  FREEPASS_ESIGN_TTL_MS,
  buildFreepassIssueSnapshot,
  canonicalFreepassSignUrl,
  canAccessFreepassEsignContract,
  canManageFreepassEsign,
  canReviewFreepassEsign,
  eventRows,
  hashFreepassSignToken,
  freepassEsignEventUpdates,
  loadFreepassEsignBundle,
  makeFreepassSignToken,
  publicFreepassSignUrl,
  sessionHashFromContract,
  sha256,
  validContractCode,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { snapshotWithPrivateSubmission } from '@/lib/domain/esign-signed-snapshot';
import { createAndStoreFreepassPdf } from '@/lib/server/freepass-esign-document';
import { isEsignTemplateAllowed } from '@/lib/domain/esign-templates';
import { esignIssueBlockers, isIndependentEsignSource } from '@/lib/domain/esign-center';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const APPROVAL_CLAIM_TIMEOUT_MS = 2 * 60 * 1_000;
const REJECTION_CLAIM_TIMEOUT_MS = 30_000;
const ISSUE_CLAIM_TIMEOUT_MS = 30_000;

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function childUpdates(prefix: string, values: EsignRecord): EsignRecord {
  const updates: EsignRecord = {};
  for (const [key, value] of Object.entries(values)) updates[`${prefix}/${key}`] = value;
  return updates;
}

type ActorResult = Awaited<ReturnType<typeof verifyActiveBearer>>;

async function activeActor(request: Request): Promise<{
  actor: ActorResult;
  authUnavailable: boolean;
  tokenError: string;
  tokenDetail: string;
}> {
  try {
    return {
      actor: await verifyActiveBearer(request, { throwTokenError: true }),
      authUnavailable: false,
      tokenError: '',
      tokenDetail: '',
    };
  } catch (error) {
    if (error instanceof BearerTokenError) {
      return {
        actor: null,
        authUnavailable: false,
        tokenError: error.authCode,
        tokenDetail: error.detail,
      };
    }
    return { actor: null, authUnavailable: true, tokenError: '', tokenDetail: '' };
  }
}

function actorError(result: Awaited<ReturnType<typeof activeActor>>): Response | null {
  if (result.authUnavailable) {
    return json({ error: '서버에서 로그인 권한을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 503);
  }
  if (result.tokenError) {
    return json({
      error: `로그인 토큰 검증에 실패했습니다. (${result.tokenError}: ${result.tokenDetail})`,
    }, 401);
  }
  if (!result.actor) {
    return json({ error: '로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' }, 401);
  }
  if (!canManageFreepassEsign(result.actor)) {
    return json({ error: '전자계약 링크는 프리패스 관리자·직원 계정에서 생성할 수 있습니다.' }, 403);
  }
  return null;
}

function activeSession(session: EsignRecord | null, now = Date.now()) {
  if (!session) return false;
  return ['sent', 'opened'].includes(S(session.status))
    && !Number(session.revokedAt || 0)
    && Number(session.expiresAt || 0) > now;
}

type LoadedBundle = NonNullable<Awaited<ReturnType<typeof loadFreepassEsignBundle>>>;

async function stateResponse(
  contractCode: string,
  includePrivateReview = false,
  loadedBundle?: LoadedBundle,
) {
  const bundle = loadedBundle || await loadFreepassEsignBundle(contractCode);
  if (!bundle) return null;
  const hash = sessionHashFromContract(bundle.contract);
  const [sessionSnap, privateSnap, eventsSnap] = hash ? await Promise.all([
    bundle.db.ref(`v4/esign_sessions/${hash}`).get().catch(() => null),
    bundle.db.ref(`v4/esign_private/${contractCode}/${hash}`).get().catch(() => null),
    bundle.db.ref(`v4/esign_events/${contractCode}`).get().catch(() => null),
  ]) : [null, null, await bundle.db.ref(`v4/esign_events/${contractCode}`).get().catch(() => null)];
  const session = sessionSnap?.val() as EsignRecord | null;
  const submission = privateSnap?.val() as EsignRecord | null;
  const additionalDrivers = Array.isArray(submission?.additional_drivers)
    ? submission.additional_drivers.slice(0, 3).map((value, index) => {
      const driver = value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : {};
      return {
        name: S(driver.name),
        relation: S(driver.relation),
        phone: S(driver.phone),
        driverLicenseNo: !!S(driver.driver_license_no),
        license: !!S(driver.licensePath),
        assetUrl: includePrivateReview && driver.licensePath
          ? `/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}/asset/additional-driver-license-${index + 1}`
          : '',
      };
    })
    : [];
  const supportingDocuments = Array.isArray(submission?.supporting_documents)
    ? submission.supporting_documents.slice(0, 6).map((value) => {
      const document = value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : {};
      const key = S(document.key);
      return {
        key,
        label: S(document.label),
        required: document.required !== false,
        originalName: S(document.originalName),
        submitted: !!S(document.path),
        assetUrl: includePrivateReview && key
          ? `/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}/asset/supporting-${encodeURIComponent(key)}`
          : '',
      };
    })
    : [];
  return {
    contract: {
      ...bundle.contract,
      esign_sign_url: canonicalFreepassSignUrl(bundle.contract.esign_sign_url),
    },
    snapshot: session?.snapshot || null,
    session: session ? {
      status: S(session.status),
      issuedAt: Number(session.issuedAt || 0),
      openedAt: Number(session.openedAt || 0),
      submittedAt: Number(session.submittedAt || 0),
      approvedAt: Number(session.approvedAt || 0),
      expiresAt: Number(session.expiresAt || 0),
      rejectReason: S(session.rejectReason),
      progress: session.progress && typeof session.progress === 'object' ? session.progress : {},
      supplementItems: Array.isArray(session.supplementItems) ? session.supplementItems.map(S) : [],
      supplements: Array.isArray(session.supplements) ? session.supplements : [],
    } : null,
    submission: submission ? {
      status: S(submission.status),
      customerName: S(submission.customer_name),
      customerPhone: S(submission.customer_phone),
      driverLicenseNo: !!S(submission.driver_license_no),
      signature: includePrivateReview ? S(submission.signature) : '',
      signatureSha256: includePrivateReview ? S(submission.signatureSha256) : '',
      idCard: !!S(submission.idCardPath),
      selfie: !!S(submission.selfiePath),
      additionalDrivers,
      supportingDocuments,
      assetUrls: includePrivateReview ? {
        idCard: submission.idCardPath ? `/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}/asset/id-card` : '',
        selfie: submission.selfiePath ? `/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}/asset/selfie` : '',
      } : {},
    } : null,
    events: eventRows(eventsSnap?.val()),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractCode: string }> },
) {
  const result = await activeActor(request);
  const denied = actorError(result);
  if (denied) return denied;
  const contractCode = validContractCode((await params).contractCode);
  if (!contractCode) return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  const bundle = await loadFreepassEsignBundle(contractCode);
  if (!bundle || !canAccessFreepassEsignContract(result.actor, bundle.contract)) {
    return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  }
  const state = await stateResponse(contractCode, canReviewFreepassEsign(result.actor), bundle);
  return state ? json({ ok: true, ...state }) : json({ error: '계약을 찾을 수 없습니다.' }, 404);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ contractCode: string }> },
) {
  const result = await activeActor(request);
  const denied = actorError(result);
  if (denied) return denied;
  const actor = result.actor!;
  const contractCode = validContractCode((await params).contractCode);
  if (!contractCode) return json({ error: '계약번호가 올바르지 않습니다.' }, 400);

  let body: EsignRecord;
  try { body = await request.json() as EsignRecord; }
  catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const action = S(body.action);
  let bundle = await loadFreepassEsignBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  let contract = bundle.contract;
  if (!canAccessFreepassEsignContract(actor, contract)) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  if (S(contract.contract_status) === '계약취소') return json({ error: '취소 계약은 전자계약을 진행할 수 없습니다.' }, 409);

  if (action === 'issue') {
    /**
     * ★샘플 계약서는 운영에서 나가지 않는다.
     * 기본 렌트 v1.0만 정본이며 구독 2종은 아직 `sample-v1`이다. 선택한 서식을 기준으로
     * 발행 문마다 잠가야 샘플 문안이 손님에게 나가는 우회가 생기지 않는다.
     */
    if (!isEsignTemplateAllowed(process.env.VERCEL_ENV, body.standardTemplateId)) {
      return json({ error: '표준계약서 최종 승인 전이라 운영 발행이 잠겨 있습니다.' }, 503);
    }
    if (S(contract.sign_status) === '서명완료') {
      return json({ error: '완료 계약서는 변경하거나 다시 발송할 수 없습니다. 새 회차 계약서를 만드세요.' }, 409);
    }
    if (S(contract.esign_provider) === 'chakhandeal' && S(contract.esign_id)) {
      return json({ error: '이미 착한거래로 발행된 계약입니다. 기존 진행내역에서 마무리해 주세요.' }, 409);
    }
    const blocked = esignIssueBlockers(contract, bundle.partner, bundle.policy);
    if (blocked.length) {
      const independent = isIndependentEsignSource(contract);
      return json({
        error: independent
          ? `계약서 필수값을 확인해 주세요: ${blocked.map((row) => row.message).join(' · ')}`
          : blocked.map((row) => row.message).join(' · '),
        blocked,
      }, 409);
    }

    const currentHash = sessionHashFromContract(contract);
    let currentSession: EsignRecord | null = null;
    if (currentHash) {
      currentSession = (await bundle.db.ref(`v4/esign_sessions/${currentHash}`).get().catch(() => null))?.val() as EsignRecord | null;
      if (activeSession(currentSession) && S(contract.esign_sign_url)) {
        return json({ ok: true, reused: true, signUrl: canonicalFreepassSignUrl(contract.esign_sign_url), ...(await stateResponse(contractCode, canReviewFreepassEsign(actor)) || {}) });
      }
    }

    // 한 계약에서 두 직원이 동시에 눌러도 고객 링크는 하나만 발행한다.
    const issueClaimId = hashFreepassSignToken(makeFreepassSignToken());
    const issueClaimAt = Date.now();
    const issueClaimRef = bundle.db.ref(`v4/esign_issue_claims/${contractCode}`);
    const issueClaim = await issueClaimRef.transaction((current) => {
      const row = current && typeof current === 'object' && !Array.isArray(current)
        ? current as EsignRecord
        : {};
      const claimedAt = Number(row.claimedAt || 0);
      if (S(row.claimId) && claimedAt > Date.now() - ISSUE_CLAIM_TIMEOUT_MS) return;
      return { claimId: issueClaimId, claimedAt: issueClaimAt, claimedBy: actor.uid };
    }, undefined, false);
    const claimedIssue = issueClaim.snapshot.val() as EsignRecord | null;
    if (!issueClaim.committed || S(claimedIssue?.claimId) !== issueClaimId) {
      return json({ error: '다른 사용자가 이 계약의 링크를 생성하고 있습니다. 잠시 후 다시 확인해 주세요.' }, 409);
    }
    const releaseIssueClaim = async () => {
      await issueClaimRef.transaction((current) => {
        if (!current || S(current.claimId) !== issueClaimId) return;
        return null;
      }, undefined, false).catch(() => {});
    };

    try {
      // 잠금을 잡은 뒤 최신 계약·세션을 다시 읽어 발행 중 변경을 반영한다.
      const refreshedBundle = await loadFreepassEsignBundle(contractCode);
      if (!refreshedBundle || !canAccessFreepassEsignContract(actor, refreshedBundle.contract)) {
        return json({ error: '계약을 찾을 수 없습니다.' }, 404);
      }
      bundle = refreshedBundle;
      contract = refreshedBundle.contract;
      if (S(contract.contract_status) === '계약취소') {
        return json({ error: '취소 계약은 전자계약을 진행할 수 없습니다.' }, 409);
      }
      if (S(contract.sign_status) === '서명완료') {
        return json({ error: '완료 계약서는 변경하거나 다시 발송할 수 없습니다. 새 회차 계약서를 만드세요.' }, 409);
      }
      if (S(contract.esign_provider) === 'chakhandeal' && S(contract.esign_id)) {
        return json({ error: '이미 착한거래로 발행된 계약입니다. 기존 진행내역에서 마무리해 주세요.' }, 409);
      }
      const refreshedBlocked = esignIssueBlockers(contract, bundle.partner, bundle.policy);
      if (refreshedBlocked.length) {
        return json({ error: refreshedBlocked.map((row) => row.message).join(' · '), blocked: refreshedBlocked }, 409);
      }
      const refreshedHash = sessionHashFromContract(contract);
      currentSession = refreshedHash
        ? (await bundle.db.ref(`v4/esign_sessions/${refreshedHash}`).get().catch(() => null))?.val() as EsignRecord | null
        : null;
      if (activeSession(currentSession) && S(contract.esign_sign_url)) {
        return json({ ok: true, reused: true, signUrl: canonicalFreepassSignUrl(contract.esign_sign_url), ...(await stateResponse(contractCode, canReviewFreepassEsign(actor), bundle) || {}) });
      }
      const currentStatus = S(currentSession?.status);
      if (['submitting', 'pending_review', 'approving', 'rejecting'].includes(currentStatus)) {
        return json({ error: '고객 제출 또는 관리자 확인이 진행 중인 계약은 새 링크를 만들 수 없습니다.' }, 409);
      }

    const standardTemplateId = S(body.standardTemplateId);
    const contractKind = S(body.contractKind);
    const templateFields: Record<string, string> = {};
    if (body.templateFields && typeof body.templateFields === 'object' && !Array.isArray(body.templateFields)) {
      for (const [key, value] of Object.entries(body.templateFields as EsignRecord)) {
        const k = S(key);
        const v = S(value);
        if (k && k.length <= 80 && v.length <= 500) templateFields[k] = v;
      }
    }

    let snapshot;
    try {
      snapshot = buildFreepassIssueSnapshot({
        contract,
        policy: bundle.policy,
        product: bundle.product,
        partner: bundle.partner,
        standardTemplateId,
        contractKind,
        templateFields,
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : '계약서 조합을 확정하지 못했습니다.' }, 409);
    }

    const revision = Math.max(1, Number(contract.esign_revision || 0) + 1);
    snapshot = { ...snapshot, revision };
    const token = makeFreepassSignToken();
    const hash = hashFreepassSignToken(token);
    const now = Date.now();
    const expiresAt = now + FREEPASS_ESIGN_TTL_MS;
    const requestOrigin = new URL(request.url).origin;
    const signUrl = publicFreepassSignUrl(token, requestOrigin);
    const esignId = `fp_${hash.slice(0, 24)}`;
    try {
      const sessionValue: EsignRecord = {
        provider: 'freepass',
        esignId,
        contractCode,
        status: 'sent',
        issuedAt: now,
        expiresAt,
        issuedBy: actor.uid,
        revision,
        snapshot,
      };
      const contractUpdate: EsignRecord = {
        esign_provider: 'freepass',
        esign_id: esignId,
        esign_session_hash: hash,
        esign_sign_url: signUrl,
        standard_template_id: standardTemplateId,
        esign_standard_template_label: S(snapshot.template.label),
        esign_template_id: standardTemplateId,
        esign_template_version: S(snapshot.template.version),
        esign_contract_kind: contractKind,
        contract_kind: contractKind,
        esign_maturity: S(snapshot.contractKind.maturity),
        esign_insurance_side: S(snapshot.contractKind.insuranceSide),
        sign_status: '발행',
        sign_sent_at: now,
        sign_expires_at: expiresAt,
        sign_revoked_at: null,
        sign_rejected_at: null,
        sign_reject_reason: null,
        esign_progress: 0,
        esign_revision: revision,
        is_draft: '아니오',
        unsigned_pdf_url: `/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}/document?format=pdf&draft=1`,
      };
      const replacedHash = sessionHashFromContract(contract);
      const replacedSessionUpdates = replacedHash && replacedHash !== hash && currentSession
        && !['revoked', 'signed'].includes(S(currentSession.status))
        ? childUpdates(`esign_sessions/${replacedHash}`, {
          status: 'revoked', revokedAt: now, supersededBy: hash,
        })
        : {};
      await bundle.db.ref('v4').update({
        ...replacedSessionUpdates,
        [`esign_sessions/${hash}`]: sessionValue,
        ...childUpdates(`contracts/${contractCode}`, contractUpdate),
        ...freepassEsignEventUpdates(contractCode, 'issued', { actorUid: actor.uid, esignId }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      console.error('[freepass-esign] issue persistence failed', contractCode, detail);
      return json({
        error: process.env.NODE_ENV === 'development'
          ? `전자계약 링크 저장에 실패했습니다: ${detail}`
          : '전자계약 링크를 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      }, 503);
    }
    return json({ ok: true, signUrl, ...(await stateResponse(contractCode, canReviewFreepassEsign(actor)) || {}) });
    } finally {
      await releaseIssueClaim();
    }
  }

  const hash = sessionHashFromContract(contract);
  if (!hash) return json({ error: '프리패스 전자계약 발행 이력이 없습니다.' }, 409);
  const [sessionSnap, privateSnap] = await Promise.all([
    bundle.db.ref(`v4/esign_sessions/${hash}`).get(),
    bundle.db.ref(`v4/esign_private/${contractCode}/${hash}`).get().catch(() => null),
  ]);
  const session = sessionSnap.val() as EsignRecord | null;
  const submission = privateSnap?.val() as EsignRecord | null;
  if (!session) return json({ error: '전자계약 세션을 찾을 수 없습니다.' }, 404);

  if (action === 'revoke') {
    if (S(session.status) === 'signed' || S(contract.sign_status) === '서명완료') {
      return json({ error: '완료 계약서는 링크를 해지하거나 변경할 수 없습니다.' }, 409);
    }
    const now = Date.now();
    const revokeClaim = await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
      if (!current || Number(current.revokedAt || 0)) return;
      if (!['sent', 'opened'].includes(S(current.status))) return;
      return { ...current, status: 'revoked', revokedAt: now, revokedBy: actor.uid };
    }, undefined, false);
    const revokedSession = revokeClaim.snapshot.val() as EsignRecord | null;
    if (!revokeClaim.committed || S(revokedSession?.status) !== 'revoked' || Number(revokedSession?.revokedAt || 0) !== now) {
      const status = S(session.status);
      const error = status === 'submitting'
        ? '고객이 계약을 제출하고 있어 지금은 링크를 해지할 수 없습니다.'
        : ['pending_review', 'approving'].includes(status)
          ? '고객 제출 후에는 링크를 해지할 수 없습니다. 관리자가 보완 요청 또는 승인을 진행해 주세요.'
          : '현재 상태에서는 링크를 해지할 수 없습니다.';
      return json({ error }, 409);
    }
    // 해지 중 새 링크가 발행됐으면 이전 세션만 닫고 새 계약 상태는 건드리지 않는다.
    await bundle.db.ref(`v4/contracts/${contractCode}`).transaction((current) => {
      if (!current || S(current.esign_session_hash) !== hash) return;
      if (S(current.sign_status) === '서명완료') return;
      return { ...current, sign_status: '미발송', sign_revoked_at: now, esign_progress: 0 };
    }, undefined, false);
    await bundle.db.ref('v4').update(
      freepassEsignEventUpdates(contractCode, 'revoked', { actorUid: actor.uid, sessionHash: hash }),
    );
    return json({ ok: true, ...(await stateResponse(contractCode, canReviewFreepassEsign(actor)) || {}) });
  }

  if (action === 'reject') {
    if (!canReviewFreepassEsign(actor)) return json({ error: '관리자만 전자계약 보완을 요청할 수 있습니다.' }, 403);
    const now = Date.now();
    const staleRejection = S(session.status) === 'rejecting'
      && Number(session.rejectingAt || 0) > 0
      && Number(session.rejectingAt || 0) <= now - REJECTION_CLAIM_TIMEOUT_MS;
    if ((S(session.status) !== 'pending_review' && !staleRejection) || !submission) {
      return json({ error: '검토대기 서명이 없습니다.' }, 409);
    }
    const rejectionClaimId = hashFreepassSignToken(makeFreepassSignToken());
    const rejectionClaim = await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
      if (!current) return current;
      const currentStatus = S(current.status);
      const staleRejection = currentStatus === 'rejecting'
        && Number(current.rejectingAt || 0) > 0
        && Number(current.rejectingAt || 0) <= Date.now() - REJECTION_CLAIM_TIMEOUT_MS;
      if (currentStatus !== 'pending_review' && !staleRejection) return;
      return {
        ...current,
        status: 'rejecting',
        rejectingAt: now,
        rejectingBy: actor.uid,
        rejectionClaimId,
      };
    }, undefined, false);
    const claimedRejection = rejectionClaim.snapshot.val() as EsignRecord | null;
    if (!rejectionClaim.committed
      || S(claimedRejection?.status) !== 'rejecting'
      || S(claimedRejection?.rejectionClaimId) !== rejectionClaimId) {
      return json({ error: '다른 관리자가 이미 승인 또는 보완 요청을 처리하고 있습니다.' }, 409);
    }
    const releaseRejectionClaim = async () => {
      await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
        if (!current || S(current.rejectionClaimId) !== rejectionClaimId) return;
        const next = { ...current, status: 'pending_review' };
        delete next.rejectingAt;
        delete next.rejectingBy;
        delete next.rejectionClaimId;
        return next;
      }, undefined, false).catch(() => {});
    };
    const reason = S(body.reason).slice(0, 200);
    const allowedItems = new Set(['identity', 'documents', 'contract', 'agreement', 'signature']);
    const items = (Array.isArray(body.items) ? body.items : [])
      .map(S)
      .filter((item) => allowedItems.has(item));
    if (!items.length) items.push('identity', 'signature');
    const supplements = Array.isArray(session.supplements) ? [...session.supplements] : [];
    supplements.push({ items, reason, requestedAt: now, requestedBy: actor.uid });
    try {
      await bundle.db.ref('v4').update({
        ...childUpdates(`esign_sessions/${hash}`, {
          status: 'sent', rejectReason: reason, rejectedAt: now, expiresAt: now + FREEPASS_ESIGN_TTL_MS,
          supplementItems: items, supplements, progress: {}, progressWrites: 0,
          rejectingAt: null, rejectingBy: null, rejectionClaimId: null,
          ...(items.includes('documents') ? { supportingUploads: null } : {}),
        }),
        ...childUpdates(`esign_private/${contractCode}/${hash}`, {
          status: 'rejected', rejectedAt: now, rejectReason: reason, supplementItems: items,
        }),
        ...childUpdates(`contracts/${contractCode}`, {
          sign_status: '반려', sign_rejected_at: now, sign_reject_reason: reason,
          sign_signed_at: null, esign_progress: 0, esign_supplement_items: items,
        }),
        ...freepassEsignEventUpdates(contractCode, 'rejected', { actorUid: actor.uid, reason, items }),
      });
    } catch (error) {
      await releaseRejectionClaim();
      console.error('[freepass-esign] rejection persistence failed', contractCode, error instanceof Error ? error.message : 'unknown');
      return json({ error: '보완 요청 상태를 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }
    return json({ ok: true, ...(await stateResponse(contractCode, true) || {}) });
  }

  if (action === 'approve') {
    if (!canReviewFreepassEsign(actor)) return json({ error: '관리자만 전자계약을 최종 승인할 수 있습니다.' }, 403);
    const now = Date.now();
    const staleApproval = S(session.status) === 'approving'
      && Number(session.approvingAt || 0) > 0
      && Number(session.approvingAt || 0) <= now - APPROVAL_CLAIM_TIMEOUT_MS;
    if ((S(session.status) !== 'pending_review' && !staleApproval) || !submission || !S(submission.signature)) {
      return json({ error: '검토대기 서명과 본인확인 자료가 모두 있어야 승인할 수 있습니다.' }, 409);
    }
    if (!S(submission.idCardPath) || !S(submission.selfiePath)) {
      return json({ error: '운전면허증 또는 셀카가 누락되었습니다.' }, 409);
    }
    const approvalClaimId = hashFreepassSignToken(makeFreepassSignToken());
    const approvalClaim = await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
      // Admin SDK transaction의 첫 로컬 값이 null인 경우 서버 값으로 재시도하게 한다.
      if (!current) return current;
      const currentStatus = S(current.status);
      const currentStale = currentStatus === 'approving'
        && Number(current.approvingAt || 0) > 0
        && Number(current.approvingAt || 0) <= Date.now() - APPROVAL_CLAIM_TIMEOUT_MS;
      if (currentStatus !== 'pending_review' && !currentStale) return;
      return {
        ...current,
        status: 'approving',
        approvingAt: now,
        approvingBy: actor.uid,
        approvalClaimId,
      };
    }, undefined, false);
    const claimedSession = approvalClaim.snapshot.val() as EsignRecord | null;
    if (!approvalClaim.committed
      || !claimedSession
      || S(claimedSession?.status) !== 'approving'
      || S(claimedSession?.approvalClaimId) !== approvalClaimId) {
      return json({ error: '다른 관리자가 이미 승인 처리 중이거나 완료한 계약입니다.' }, 409);
    }
    const releaseApprovalClaim = async () => {
      await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
        if (!current) return current;
        if (S(current.status) !== 'approving' || S(current.approvalClaimId) !== approvalClaimId) return;
        const next = { ...current, status: 'pending_review' };
        delete next.approvingAt;
        delete next.approvingBy;
        delete next.approvalClaimId;
        return next;
      }, undefined, false).catch(() => {});
    };
    const consentTimes = submission.consentTimes && typeof submission.consentTimes === 'object'
      ? submission.consentTimes as EsignRecord
      : {};
    const completedConsents = { ...consentTimes, identity_verified: now, signed: now };
    const signedSnapshot = snapshotWithPrivateSubmission(claimedSession.snapshot as EsignRecord, submission);
    const sealedSupportingDocuments = Array.isArray(submission.supporting_documents)
      ? submission.supporting_documents.map((value) => {
        const document = value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : {};
        return { key: S(document.key), sha256: S(document.sha256) };
      }).filter((document) => document.key && document.sha256)
      : [];
    const sealHash = sha256(JSON.stringify({
      snapshot: signedSnapshot,
      submittedAt: submission.submittedAt,
      signatureSha256: submission.signatureSha256,
      idCardSha256: submission.idCardSha256,
      selfieSha256: submission.selfieSha256,
      supportingDocuments: sealedSupportingDocuments,
      consents: completedConsents,
      approvedAt: now,
    }));
    const verifyUrl = `${new URL(request.url).origin}/verify/${sealHash}`;
    let archived;
    try {
      archived = await createAndStoreFreepassPdf({
        contractCode,
        hash,
        snapshot: signedSnapshot,
        signature: S(submission.signature),
        sealHash,
      });
    } catch (error) {
      await releaseApprovalClaim();
      console.error('[freepass-esign] approval pdf failed', contractCode, error instanceof Error ? error.message : 'unknown');
      return json({ error: '완료 계약서 PDF를 만들지 못해 승인하지 않았습니다. PDF 서버 설정을 확인해 주세요.' }, 503);
    }
    const sessionUpdate: EsignRecord = {
        status: 'signed', approvedAt: now, sealHash, supplementItems: null,
        approvingAt: null, approvingBy: null, approvalClaimId: null,
    };
    const privateUpdate: EsignRecord = {
        status: 'approved', approvedAt: now, sealHash,
        pdfPath: archived.pdfPath,
        pdfSha256: archived.documentSha256,
    };
    const verification: EsignRecord = {
        provider: 'freepass', contractCode, signedAt: now, sealHash,
        documentSha256: archived.documentSha256,
        supportingDocuments: sealedSupportingDocuments,
    };
    const contractUpdate: EsignRecord = {
        sign_status: '서명완료',
        sign_signed_at: now,
        sign_consents: completedConsents,
        sign_consent_version: FREEPASS_ESIGN_CONSENT_VERSION,
        esign_progress: 8,
        esign_identity: {
          idCardSha256: S(submission.idCardSha256),
          selfieSha256: S(submission.selfieSha256),
          verifiedAt: now,
        },
        esign_seal_hash: sealHash,
        esign_verify_url: verifyUrl,
        esign_document_sha256: archived.documentSha256,
        esign_document_url: `/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}/document?format=pdf`,
        signed_pdf_url: `/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}/document?format=pdf`,
    };
    // 고객 완료화면·관리자 상태·PDF 무결성 정보는 하나라도 빠지면 안 되므로 RTDB 한 번의 다중경로 갱신으로 확정한다.
    try {
      await bundle.db.ref('v4').update({
        ...childUpdates(`esign_sessions/${hash}`, sessionUpdate),
        ...childUpdates(`esign_private/${contractCode}/${hash}`, privateUpdate),
        [`esign_verifications/${sealHash}`]: verification,
        ...childUpdates(`contracts/${contractCode}`, contractUpdate),
        ...freepassEsignEventUpdates(contractCode, 'approved', { actorUid: actor.uid, sealHash }),
      });
    } catch (error) {
      await releaseApprovalClaim();
      console.error('[freepass-esign] approval persistence failed', contractCode, error instanceof Error ? error.message : 'unknown');
      return json({ error: '완료 계약서 상태를 안전하게 저장하지 못했습니다. 다시 승인해 주세요.' }, 503);
    }
    return json({ ok: true, ...(await stateResponse(contractCode, true) || {}) });
  }

  return json({ error: '지원하지 않는 작업입니다.' }, 400);
}
