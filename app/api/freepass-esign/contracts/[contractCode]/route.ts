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
  freepassSignTokenFromUrl,
  hashFreepassSignToken,
  freepassEsignEventUpdates,
  freepassDirectSealMatchesContract,
  hasFrozenFreepassConsentProfile,
  hasFrozenFreepassTemplateState,
  isInactiveFreepassContract,
  loadFreepassEsignBundle,
  makeFreepassSignToken,
  privateEsignFileSha256,
  publicFreepassSignUrl,
  readFreepassDirectContractSeal,
  resolveFreepassSettlementRateBasis,
  sessionHashFromContract,
  sha256,
  validContractCode,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { newId } from '@/lib/domain/ids';
import { decryptRrn } from '@/lib/server/rrn-crypto';
import { snapshotWithPrivateSubmission } from '@/lib/domain/esign-signed-snapshot';
import { createAndStoreFreepassPdf } from '@/lib/server/freepass-esign-document';
import { isEsignTemplateAllowed, isManualOfferTemplateAllowed } from '@/lib/domain/esign-templates';
import { esignIssueBlockers, esignProductAvailabilityBlocker, isIndependentEsignSource } from '@/lib/domain/esign-center';

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
const record = (value: unknown): EsignRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as EsignRecord
  : {};

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

function frozenSessionTemplateId(session: EsignRecord | null): string {
  const snapshot = session?.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '';
  const template = (snapshot as EsignRecord).template;
  if (!template || typeof template !== 'object' || Array.isArray(template)) return '';
  return S((template as EsignRecord).id);
}

/** 봉인 직전 Storage 실물과 제출 때 저장한 SHA-256을 다시 대조한다. */
async function supportingDocumentsIntegrityError(
  contractCode: string,
  hash: string,
  documents: EsignRecord[],
): Promise<string> {
  const root = `esign-private/${contractCode}/${hash}/supporting/`;
  const checks = await Promise.all(documents.map(async (document) => {
    const label = S(document.label) || '첨부서류';
    const path = S(document.path);
    const expected = S(document.sha256).toLowerCase();
    if (!path || !/^[a-f0-9]{64}$/.test(expected) || !path.startsWith(root)) {
      return `${label}의 보안 참조를 확인할 수 없습니다.`;
    }
    const actual = await privateEsignFileSha256(path);
    return actual && actual === expected ? '' : `${label}의 원본 무결성을 다시 확인해 주세요.`;
  }));
  return checks.find(Boolean) || '';
}

/**
 * 과거에 v4 계약 목록에 남긴 raw fps_ 링크는 private 노드로 옮긴다.
 * private 복사와 public 제거는 서로 다른 RTDB 노드라 한 transaction으로 묶을 수 없다.
 * 따라서 각각 현재 token/hash를 다시 확인하는 transaction으로 처리한다. 동시 발행으로
 * 값이 바뀌면 public 값을 지우지 않고 요청을 실패시킨다. hash가 맞지 않는 raw URL은
 * private로 복사하지 않되, 현재 값이라는 것이 확인될 때만 목록에서 제거한다.
 */
async function privatizeLegacySignUrl(
  bundle: LoadedBundle,
  contractCode: string,
  hash: string,
  rawUrl: unknown,
): Promise<void> {
  const legacyUrl = S(rawUrl);
  const token = freepassSignTokenFromUrl(legacyUrl);
  const transferable = !!token && hashFreepassSignToken(token) === hash;
  const initialSession = (await bundle.db.ref(`v4/esign_sessions/${hash}`).get()).val() as EsignRecord | null;
  if (!initialSession || S(initialSession.contractCode) !== contractCode || S(initialSession.provider) !== 'freepass') {
    throw new Error('기존 고객 링크의 세션 연결을 확인하지 못했습니다.');
  }
  const sameToken = (first: unknown, second: unknown) => {
    const a = freepassSignTokenFromUrl(first);
    const b = freepassSignTokenFromUrl(second);
    return !!a && !!b && a === b;
  };
  const privateRef = bundle.db.ref(`v4/esign_private/${contractCode}/${hash}`);
  if (transferable) {
    let privateConflict = false;
    await privateRef.transaction((current) => {
      const row = current && typeof current === 'object' && !Array.isArray(current) ? current as EsignRecord : {};
      const existing = S(row.internal_sign_url);
      if (existing) {
        if (!sameToken(existing, legacyUrl)) privateConflict = true;
        return;
      }
      return { ...row, internal_sign_url: legacyUrl };
    }, undefined, false);
    if (privateConflict) throw new Error('기존 고객 링크의 private 보관값이 달라 이관하지 않았습니다.');
  }

  const contractRef = bundle.db.ref(`v4/contracts/${contractCode}`);
  let contractChanged = false;
  await contractRef.transaction((current) => {
    const row = current && typeof current === 'object' && !Array.isArray(current) ? current as EsignRecord : null;
    if (!row) { contractChanged = true; return; }
    const currentUrl = S(row.esign_sign_url);
    const currentHash = sessionHashFromContract(row);
    if (currentUrl === '' && currentHash === hash) return;
    if (currentUrl !== legacyUrl || currentHash !== hash) { contractChanged = true; return; }
    return { ...row, esign_sign_url: null };
  }, undefined, false);

  const [contractSnap, privateSnap, sessionSnap] = await Promise.all([
    contractRef.get(),
    transferable ? privateRef.child('internal_sign_url').get() : Promise.resolve(null),
    bundle.db.ref(`v4/esign_sessions/${hash}`).get(),
  ]);
  const currentContract = contractSnap.val() as EsignRecord | null;
  const finalSession = sessionSnap.val() as EsignRecord | null;
  if (contractChanged || !currentContract || S(currentContract.esign_sign_url)
    || sessionHashFromContract(currentContract) !== hash
    || !finalSession || S(finalSession.contractCode) !== contractCode || S(finalSession.provider) !== 'freepass'
    || (transferable && !sameToken(privateSnap?.val(), legacyUrl))) {
    throw new Error('기존 고객 링크가 이관 중 변경되어 공개값을 안전하게 정리하지 못했습니다.');
  }
}

type LoadedBundle = NonNullable<Awaited<ReturnType<typeof loadFreepassEsignBundle>>>;

type IssueSources = {
  contract: EsignRecord;
  policy: EsignRecord | null;
  product: EsignRecord | null;
  partner: EsignRecord | null;
  standardTemplateId: string;
  contractKind: string;
  settlementRateBasis: Awaited<ReturnType<typeof resolveFreepassSettlementRateBasis>> | null;
  sealed: boolean;
};

/**
 * v4-only 계약은 UI/RTDB가 만든 projection이 아니라 private direct seal로만 발행한다.
 * legacy 원장이 있는 ERP 계약은 기존 호환 경로를 유지하되, legacy 직접/엑셀 초안은
 * 재검증 없이 봉인하지 않는다.
 */
async function issueSourcesFor(
  bundle: LoadedBundle,
  contractCode: string,
  body: EsignRecord,
): Promise<{ sources: IssueSources | null; error: string }> {
  const sealSnap = await bundle.db.ref(`v4/esign_contract_seals/${contractCode}`).get().catch(() => null);
  const seal = readFreepassDirectContractSeal(sealSnap?.val());
  if (seal) {
    if (seal.contractCode !== contractCode || !freepassDirectSealMatchesContract(bundle.contract, seal.contract)) {
      return { sources: null, error: '서버가 동결한 계약 기준과 현재 계약값이 달라 발행할 수 없습니다. 새 계약서를 만들어 주세요.' };
    }
    return {
      sources: {
        contract: seal.contract,
        policy: seal.policy,
        product: seal.product,
        partner: seal.partner,
        standardTemplateId: seal.templateId,
        contractKind: seal.contractKind,
        settlementRateBasis: seal.settlementRateBasis,
        sealed: true,
      },
      error: '',
    };
  }
  if (!bundle.legacyContractExists || isIndependentEsignSource(bundle.contract)) {
    return { sources: null, error: '이 직접·엑셀 계약 초안은 서버 동결 기준이 없어 발행할 수 없습니다. 새 계약서로 다시 만들어 주세요.' };
  }
  return {
    sources: {
      contract: bundle.contract,
      policy: bundle.policy,
      product: bundle.product,
      partner: bundle.partner,
      standardTemplateId: S(body.standardTemplateId),
      contractKind: S(body.contractKind),
      settlementRateBasis: null,
      sealed: false,
    },
    error: '',
  };
}

function issueBlockersFor(sources: IssueSources, currentContract: EsignRecord, currentProduct: EsignRecord | null) {
  const blocked = esignIssueBlockers(sources.contract, sources.partner, sources.policy, sources.product);
  // seal 안의 차량은 발행 근거, live 차량은 재고/선점 상태 확인용이다. 둘을 섞으면
  // 공급사가 product_type을 바꿔 수수료 기준을 바꾸거나, 반대로 이미 선점된 차를 발행할 수 있다.
  const liveAvailability = esignProductAvailabilityBlocker(currentContract, currentProduct);
  if (liveAvailability && !blocked.some((row) => row.key === liveAvailability.key)) blocked.push(liveAvailability);
  return blocked;
}

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
  // 구 direct/excel 초안은 public projection만으로 만들던 시절의 자료일 수 있다. 현재
  // 발행기는 private seal이 없는 이 초안을 재사용하지 않으므로, UI가 빈번한 409 대신
  // 처음부터 새 계약서 작성으로 안내할 수 있게 같은 판정을 내려준다.
  const requiresServerSeal = !bundle.legacyContractExists || isIndependentEsignSource(bundle.contract);
  const directSealSnap = requiresServerSeal
    ? await bundle.db.ref(`v4/esign_contract_seals/${contractCode}`).get().catch(() => null)
    : null;
  const directSeal = readFreepassDirectContractSeal(directSealSnap?.val());
  const reissueRequiresNewContract = requiresServerSeal
    && (!directSeal || !freepassDirectSealMatchesContract(bundle.contract, directSeal.contract));
  // fps_ 토큰은 완료 PDF까지 여는 bearer credential이다. 계약 목록 노드에는 보관하지 않고
  // 서버 전용 private 노드에서만 꺼내 권한을 통과한 API 응답으로 전달한다.
  const protectedSignUrl = canonicalFreepassSignUrl(S(submission?.internal_sign_url));
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
      esign_sign_url: protectedSignUrl,
    },
    snapshot: session?.snapshot || null,
    session: session ? {
      status: S(session.status),
      // 프런트는 이 서버 판정만 보고 고객 링크를 복사·미리보기 한다. template/consent
      // 동결 조건을 UI가 따로 흉내 내면 누락된 구형 snapshot을 살아 있는 링크로 오인할 수 있다.
      customerLinkUsable: hasFrozenFreepassTemplateState(session) && hasFrozenFreepassConsentProfile(session),
      reissueRequiresNewContract,
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
  if (isInactiveFreepassContract(contract)) return json({ error: '취소 또는 폐기된 계약은 전자계약을 진행할 수 없습니다.' }, 409);
  // 고객 모바일 화면 점검용 레코드는 공개 화면만 확인한다. 이 경로에서 발행·승인·PDF·인도 같은
  // 운영 후속 처리가 이어지면 안 된다. 실제 계약과 같은 화면을 보되, 업무 데이터로 승격하지 않는다.
  if (contract.is_test === true || S(contract.is_test) === 'true') {
    return json({ error: '모바일 화면 점검용 계약은 발행·승인·인도 처리할 수 없습니다.' }, 409);
  }

  if (action === 'issue') {
    /**
     * ★샘플 계약서는 운영에서 나가지 않는다.
     * 기본 렌트 v1.0만 정본이며 구독 2종은 아직 `sample-v1`이다. 선택한 서식을 기준으로
     * 발행 문마다 잠가야 샘플 문안이 손님에게 나가는 우회가 생기지 않는다.
     */
    if (S(contract.sign_status) === '서명완료') {
      return json({ error: '완료 계약서는 변경하거나 다시 발송할 수 없습니다. 새 회차 계약서를 만드세요.' }, 409);
    }
    if (S(contract.esign_provider) === 'chakhandeal' && S(contract.esign_id)) {
      return json({ error: '이미 착한거래로 발행된 계약입니다. 기존 진행내역에서 마무리해 주세요.' }, 409);
    }
    let currentSession: EsignRecord | null = null;

    // 기존 링크 private 이관까지 이 claim 아래에서만 한다. 같은 계약의 병렬 발행이
    // raw URL/private/session을 바꾸는 사이에 stale 값을 옮기지 않게 한다.
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
      if (isInactiveFreepassContract(contract)) {
        return json({ error: '취소 또는 폐기된 계약은 전자계약을 진행할 수 없습니다.' }, 409);
      }
      if (S(contract.sign_status) === '서명완료') {
        return json({ error: '완료 계약서는 변경하거나 다시 발송할 수 없습니다. 새 회차 계약서를 만드세요.' }, 409);
      }
      if (S(contract.esign_provider) === 'chakhandeal' && S(contract.esign_id)) {
        return json({ error: '이미 착한거래로 발행된 계약입니다. 기존 진행내역에서 마무리해 주세요.' }, 409);
      }
      const refreshedHash = sessionHashFromContract(contract);
      currentSession = refreshedHash
        ? (await bundle.db.ref(`v4/esign_sessions/${refreshedHash}`).get().catch(() => null))?.val() as EsignRecord | null
        : null;
      if (activeSession(currentSession)
        && hasFrozenFreepassTemplateState(currentSession)
        && hasFrozenFreepassConsentProfile(currentSession)) {
        const reusableTemplateAllowed = S(contract.manual_offer_id)
          ? isManualOfferTemplateAllowed(process.env.VERCEL_ENV, frozenSessionTemplateId(currentSession))
          : isEsignTemplateAllowed(process.env.VERCEL_ENV, frozenSessionTemplateId(currentSession));
        if (!reusableTemplateAllowed) {
          return json({ error: '표준계약서 최종 승인 전이라 운영 발행이 잠겨 있습니다.' }, 503);
        }
        try { await privatizeLegacySignUrl(bundle, contractCode, refreshedHash, contract.esign_sign_url); }
        catch { return json({ error: '기존 고객 링크를 안전한 보관소로 옮기지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503); }
        const state = await stateResponse(contractCode, canReviewFreepassEsign(actor), bundle);
        const signUrl = S(state?.contract?.esign_sign_url);
        if (signUrl) return json({ ok: true, reused: true, signUrl, ...(state || {}) });
      }
      const refreshedSources = await issueSourcesFor(bundle, contractCode, body);
      if (!refreshedSources.sources) return json({ error: refreshedSources.error }, 409);
      const sources = refreshedSources.sources;
      const issueTemplateAllowed = S(sources.contract.manual_offer_id)
        ? isManualOfferTemplateAllowed(process.env.VERCEL_ENV, sources.standardTemplateId)
        : isEsignTemplateAllowed(process.env.VERCEL_ENV, sources.standardTemplateId);
      if (!issueTemplateAllowed) {
        return json({ error: '표준계약서 최종 승인 전이라 운영 발행이 잠겨 있습니다.' }, 503);
      }
      const refreshedBlocked = issueBlockersFor(
        sources,
        contract,
        sources.sealed ? bundle.v4Product : bundle.product,
      );
      if (refreshedBlocked.length) {
        return json({ error: refreshedBlocked.map((row) => row.message).join(' · '), blocked: refreshedBlocked }, 409);
      }
      const currentStatus = S(currentSession?.status);
      if (['submitting', 'pending_review', 'approving', 'rejecting'].includes(currentStatus)) {
        return json({ error: '고객 제출 또는 관리자 확인이 진행 중인 계약은 새 링크를 만들 수 없습니다.' }, 409);
      }

    const standardTemplateId = sources.standardTemplateId;
    const contractKind = sources.contractKind;
    const templateFields: Record<string, string> = {};
    if (!sources.sealed && body.templateFields && typeof body.templateFields === 'object' && !Array.isArray(body.templateFields)) {
      for (const [key, value] of Object.entries(body.templateFields as EsignRecord)) {
        const k = S(key);
        const v = S(value);
        if (k && k.length <= 80 && v.length <= 500) templateFields[k] = v;
      }
    }

    let snapshot;
    try {
      snapshot = buildFreepassIssueSnapshot({
        contract: sources.contract,
        policy: sources.policy,
        product: sources.product,
        partner: sources.partner,
        standardTemplateId,
        contractKind,
        templateFields,
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : '계약서 조합을 확정하지 못했습니다.' }, 409);
    }

    let settlementRateBasis;
    try {
      settlementRateBasis = sources.settlementRateBasis || await resolveFreepassSettlementRateBasis({
        db: bundle.db,
        contract: sources.contract,
        product: sources.product,
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : '정산 기준을 동결하지 못했습니다.' }, 409);
    }

    const revision = Math.max(1, Number(contract.esign_revision || 0) + 1);
    snapshot = { ...snapshot, revision };
    const token = makeFreepassSignToken();
    const hash = hashFreepassSignToken(token);
    const now = Date.now();
    const expiresAt = now + FREEPASS_ESIGN_TTL_MS;
    const requestOrigin = new URL(request.url).origin;
    const signUrl = publicFreepassSignUrl(token, requestOrigin);
    // 공개 fps_ 토큰/해시는 보안 식별자이고, 내부 전자계약 회차는 별도 esg_ 코드로 관리한다.
    const esignId = newId('esign');
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
        // 고객 bearer 링크는 public contract 노드에 평문 저장하지 않는다.
        esign_sign_url: null,
        standard_template_id: standardTemplateId,
        esign_standard_template_label: S(snapshot.template.label),
        esign_template_id: standardTemplateId,
        esign_template_version: S(snapshot.template.version),
        esign_contract_kind: contractKind,
        contract_kind: contractKind,
        esign_maturity: S(snapshot.contractKind.maturity),
        esign_insurance_side: S(snapshot.contractKind.insuranceSide),
        // 상품구분·요율은 계약을 만든 브라우저 값이 아니라 발행 서버가 다시 읽은 기준값으로
        // 동결한다. private 요율이 하나라도 비어 있으면 금액을 추정하지 않고 정산만 보류한다.
        product_type_snapshot: settlementRateBasis.productType,
        settlement_rate_status: settlementRateBasis.status,
        ...(settlementRateBasis.status === 'sealed' ? {
          fee_rate_snapshot: settlementRateBasis.feeRate,
          payout_rate_snapshot: settlementRateBasis.payoutRate,
          settlement_rate_sealed_at: now,
          settlement_rate_sealed_by: 'freepass-esign-server',
        } : {
          fee_rate_snapshot: null,
          payout_rate_snapshot: null,
          settlement_rate_sealed_at: null,
          settlement_rate_sealed_by: null,
        }),
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
        [`esign_private/${contractCode}/${hash}`]: {
          internal_sign_url: signUrl,
          issuedAt: now,
          settlement_rate_basis: {
            product_type: settlementRateBasis.productType,
            fee_rate: settlementRateBasis.feeRate,
            payout_rate: settlementRateBasis.payoutRate,
            status: settlementRateBasis.status,
            sealed_at: now,
          },
        },
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
    if (!hasFrozenFreepassTemplateState(session) || !hasFrozenFreepassConsentProfile(session)) {
      return json({ error: '계약서 또는 동의 프로필이 갱신되어 이 링크로는 최종 승인할 수 없습니다. 고객 자료를 확인한 뒤 새 링크를 발행해 주세요.' }, 409);
    }
    const now = Date.now();
    const staleApproval = S(session.status) === 'approving'
      && Number(session.approvingAt || 0) > 0
      && Number(session.approvingAt || 0) <= now - APPROVAL_CLAIM_TIMEOUT_MS;
    if ((S(session.status) !== 'pending_review' && !staleApproval) || !submission || !S(submission.signature)) {
      return json({ error: '검토대기 서명과 본인확인 자료가 모두 있어야 승인할 수 있습니다.' }, 409);
    }
    const corporateCustomer = S(record(record(session.snapshot).templateState).ct) === '법인';
    if (!corporateCustomer && (!S(submission.idCardPath) || !S(submission.selfiePath))) {
      return json({ error: '운전면허증 또는 얼굴 사진이 누락되었습니다.' }, 409);
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
    const freshApprovalBundle = await loadFreepassEsignBundle(contractCode);
    if (!freshApprovalBundle || !canAccessFreepassEsignContract(actor, freshApprovalBundle.contract)) {
      await releaseApprovalClaim();
      return json({ error: '계약을 다시 확인하지 못해 승인하지 않았습니다.' }, 404);
    }
    const availabilityBlocker = esignProductAvailabilityBlocker(
      freshApprovalBundle.contract,
      freshApprovalBundle.product,
    );
    if (availabilityBlocker) {
      await releaseApprovalClaim();
      return json({ error: availabilityBlocker.message, blocked: [availabilityBlocker] }, 409);
    }
    const issueSnapshot = claimedSession.snapshot && typeof claimedSession.snapshot === 'object' && !Array.isArray(claimedSession.snapshot)
      ? claimedSession.snapshot as EsignRecord
      : {};
    const snapshotKind = issueSnapshot.contractKind && typeof issueSnapshot.contractKind === 'object' && !Array.isArray(issueSnapshot.contractKind)
      ? issueSnapshot.contractKind as EsignRecord
      : {};
    const snapshotLandlord = issueSnapshot.landlord && typeof issueSnapshot.landlord === 'object' && !Array.isArray(issueSnapshot.landlord)
      ? issueSnapshot.landlord as EsignRecord
      : {};
    const snapshotFields = issueSnapshot.templateFields && typeof issueSnapshot.templateFields === 'object' && !Array.isArray(issueSnapshot.templateFields)
      ? issueSnapshot.templateFields as EsignRecord
      : {};
    // 보증인이 있는 계약은 보증인 본인의 전자서명까지 갖춰야 한다. 현재 고객 링크는
    // 임차인 서명만 수집하므로, 서명 없는 보증 약정이 완료 PDF에 섞여 나가지 않게 막는다.
    const hasGuarantor = [
      'guarantor_name', 'guarantor_rrn', 'guarantor_phone', 'guarantor_address',
      'guarantor_relation', 'guarantor_occupation', 'guarantee_limit', 'guarantee_period',
    ]
      .some((key) => !!S(snapshotFields[key]));
    if (hasGuarantor && !S(submission.guarantorSignature)) {
      await releaseApprovalClaim();
      return json({ error: '연대보증인이 있는 계약은 보증인 본인의 전자서명 완료 후 승인할 수 있습니다.' }, 409);
    }
    const requiresCustomerInsuranceEvidence = S(snapshotKind.insuranceSide) === '고객직접'
      || (Array.isArray(issueSnapshot.requiredDocuments) && issueSnapshot.requiredDocuments.some((value) => {
        const document = value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : {};
        return S(document.key) === 'customer_insurance_certificate';
      }));
    const rawSupportingDocuments = Array.isArray(submission.supporting_documents)
      ? submission.supporting_documents.map((value) => (
        value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : {}
      ))
      : [];
    const supportingIntegrityError = await supportingDocumentsIntegrityError(contractCode, hash, rawSupportingDocuments);
    if (supportingIntegrityError) {
      await releaseApprovalClaim();
      return json({ error: `${supportingIntegrityError} 고객에게 보완 요청 후 다시 승인해 주세요.` }, 409);
    }
    const insuranceCertificate = rawSupportingDocuments.find((document) => S(document.key) === 'customer_insurance_certificate');
    let customerInsuranceEvidence: EsignRecord | null = null;
    if (requiresCustomerInsuranceEvidence) {
      const certificate = insuranceCertificate;
      if (!S(snapshotLandlord.companyName)) {
        await releaseApprovalClaim();
        return json({ error: '보험별도 계약의 질권자(임대인 상호)가 봉인되지 않아 승인할 수 없습니다. 새 링크를 발행해 주세요.' }, 409);
      }
      if (!certificate || !S(certificate.path) || !S(certificate.sha256)) {
        await releaseApprovalClaim();
        return json({ error: '보험별도 계약은 자동차보험 가입증명서를 제출해야 승인할 수 있습니다.' }, 409);
      }
      if (body.customerInsuranceEvidenceConfirmed !== true) {
        await releaseApprovalClaim();
        return json({ error: '가입증명서에서 회사 질권 설정을 확인한 뒤 승인해 주세요.' }, 409);
      }
      customerInsuranceEvidence = {
        certificateKey: 'customer_insurance_certificate',
        sha256: S(certificate.sha256),
        lienholder: S(snapshotLandlord.companyName),
        verifiedAt: now,
        verifiedBy: actor.uid,
      };
    }
    const consentTimes = submission.consentTimes && typeof submission.consentTimes === 'object'
      ? submission.consentTimes as EsignRecord
      : {};
    const completedConsents = { ...consentTimes, identity_verified: now, signed: now };
    const signedSubmission = customerInsuranceEvidence
      ? { ...submission, customer_insurance_evidence: customerInsuranceEvidence }
      : submission;
    // 주민번호는 계약자 식별값으로 수집하지 않는다. 매출증빙을 위해 선택한 RRN
    // 암호문은 private 제출자료에만 남고 PDF/봉인 스냅샷에는 절대 합성하지 않는다.
    /* ★봉인본에만 주민등록번호 원문이 들어간다 — 여기서만 푼다.
       저장은 암호문이고, 이 한 줄 밖으로는 원문이 나가지 않는다.
       암호문이 아니면(법인등록번호·암호화 이전 계약) 그대로 돌려준다. */
    const signedSnapshot = snapshotWithPrivateSubmission(issueSnapshot, {
      ...(signedSubmission as Record<string, unknown>),
      customer_id: decryptRrn((signedSubmission as Record<string, unknown>).customer_id),
    });
    const sealedSupportingDocuments = rawSupportingDocuments
      .map((document) => {
        return { key: S(document.key), sha256: S(document.sha256) };
      }).filter((document) => document.key && document.sha256);
    const sealHash = sha256(JSON.stringify({
      snapshot: signedSnapshot,
      submittedAt: submission.submittedAt,
      signatureSha256: submission.signatureSha256,
      idCardSha256: submission.idCardSha256,
      selfieSha256: submission.selfieSha256,
      supportingDocuments: sealedSupportingDocuments,
      customerInsuranceEvidence,
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
        ...(customerInsuranceEvidence ? { customer_insurance_evidence: customerInsuranceEvidence } : {}),
    };
    const verification: EsignRecord = {
        provider: 'freepass', contractCode, signedAt: now, sealHash,
        documentSha256: archived.documentSha256,
        supportingDocuments: sealedSupportingDocuments,
        ...(customerInsuranceEvidence ? { customerInsuranceEvidence } : {}),
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
        ...(customerInsuranceEvidence ? {
          esign_customer_insurance_verified_at: now,
          esign_customer_insurance_verified_by: actor.uid,
          esign_customer_insurance_certificate_sha256: S(customerInsuranceEvidence.sha256),
        } : {}),
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
        ...freepassEsignEventUpdates(contractCode, 'approved', {
          actorUid: actor.uid,
          sealHash,
          ...(customerInsuranceEvidence ? { customerInsuranceEvidenceConfirmed: true } : {}),
        }),
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
