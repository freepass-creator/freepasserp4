import { NextResponse } from 'next/server';
import {
  hasFrozenFreepassConsentProfile,
  hasFrozenFreepassTemplateState,
  loadFreepassSessionByToken,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import {
  buildFrozenFreepassHtml,
  readStoredFreepassPdf,
  renderFreepassPdf,
} from '@/lib/server/freepass-esign-document';
import { snapshotWithPrivateSubmission } from '@/lib/domain/esign-signed-snapshot';
import { validateFreepassSubmission } from '@/lib/server/freepass-esign-submission';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function pdfDisposition(contractCode: string, kind: 'preview' | 'signed', download: boolean) {
  const suffix = kind === 'signed' ? '완료계약서' : '계약전-미리보기';
  const fallback = `${contractCode}-${kind}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
  const filename = encodeURIComponent(`${contractCode}-${suffix}.pdf`);
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${filename}`;
}

function previewMissing(error: unknown): string[] {
  const message = error instanceof Error ? error.message : '';
  const known: Array<[RegExp, string[]]> = [
    [/비상연락 관계/, ['emergency_relation']], [/비상연락 성명/, ['emergency_name']], [/비상연락처/, ['emergency_phone']],
    [/성명/, ['customer_name']], [/연락처/, ['customer_phone']], [/필수 약관 동의/, ['consents']],
    [/계약 조건/, ['sectionConfirmations']], [/계약 요약/, ['summaryConfirmedAt']], [/약관을 끝까지/, ['agreementReadAt']],
    [/생년월일/, ['customer_birth']], [/운전면허번호/, ['driver_license_no']], [/주민등록번호 뒷자리/, ['id_card_rrn_masked']],
    [/주소/, ['customer_address']], [/세금계산서 사업자/, ['tax_biz_name', 'tax_biz_no', 'tax_ceo', 'tax_biz_type_item', 'tax_email', 'tax_biz_address']],
    [/매출증빙 수단/, ['sales_proof_method']], [/매출증빙용/, ['sales_proof_value']],
    [/법인 서명자/, ['signer_name']], [/법인과의 관계/, ['signer_role']], [/자동이체/, ['cms_holder_name', 'cms_holder_relation', 'cms_holder_phone', 'cms_bank', 'cms_account_no', 'cms_holder_identifier']],
  ];
  return known.find(([pattern]) => pattern.test(message))?.[1] || [];
}

function previewSubmission(payload: EsignRecord, parsed: ReturnType<typeof validateFreepassSubmission>): EsignRecord {
  return {
    customer_name: parsed.name,
    customer_phone: parsed.phone,
    customer_id: S(payload.customer_id),
    customer_birth: parsed.customerBirth,
    customer_address: S(payload.customer_address),
    driver_license_no: S(payload.driver_license_no),
    emergency_relation: parsed.emergencyRelation,
    emergency_name: parsed.emergencyName,
    emergency_phone: parsed.emergencyPhone,
    tax_biz_name: parsed.business.name,
    tax_biz_no: parsed.business.no,
    tax_ceo: parsed.business.ceo,
    tax_biz_type_item: parsed.business.typeItem,
    tax_email: parsed.business.email,
    tax_biz_address: parsed.business.address,
    signer_name: parsed.signerName,
    signer_role: parsed.signerRole,
    additional_drivers: parsed.additionalDrivers,
    // 매출증빙 주민번호·CMS 계좌 등은 미리보기 스냅샷에 넣지 않는다.
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = S((await params).token);
  const loaded = await loadFreepassSessionByToken(token);
  if (!loaded) return json({ ok: false, error: '유효하지 않은 전자계약 링크입니다.' }, 404);
  const { session } = loaded;
  const status = S(session.status);
  if (!['sent', 'opened'].includes(status)) return json({ ok: false, error: '계약서 미리보기는 서명 전 진행 중인 링크에서만 만들 수 있습니다.' }, 409);
  if (Number(session.expiresAt || 0) <= Date.now()) return json({ ok: false, error: '만료된 전자계약 링크입니다.' }, 410);
  if (!hasFrozenFreepassTemplateState(session) || !hasFrozenFreepassConsentProfile(session)) {
    return json({ ok: false, error: '계약서 또는 동의 프로필이 갱신되어 미리보기를 만들 수 없습니다. 담당자에게 새 링크 발행을 요청해 주세요.' }, 409);
  }
  const contractCode = S(session.contractCode);
  const snapshot = session.snapshot as EsignRecord | undefined;
  if (!contractCode || !snapshot) return json({ ok: false, error: '발행 당시 계약서 스냅샷이 없습니다.' }, 409);

  let payload: EsignRecord;
  try {
    const body = await request.json() as { payload?: unknown };
    payload = (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)) ? body.payload as EsignRecord : {};
  } catch {
    return json({ ok: false, error: '미리보기 입력값 형식이 올바르지 않습니다.', missing: [] }, 400);
  }
  let parsed: ReturnType<typeof validateFreepassSubmission>;
  try {
    // 제출과 같은 canonical validator를 쓴다. 미리보기는 서명 전 경로이므로 서명만 예외다.
    parsed = validateFreepassSubmission(payload, snapshot, { requireSignature: false });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : '계약서에 넣을 입력값을 확인해 주세요.', missing: previewMissing(error) }, 422);
  }
  try {
    const previewSnapshot = snapshotWithPrivateSubmission(snapshot, previewSubmission(payload, parsed)) as EsignRecord;
    const html = await buildFrozenFreepassHtml(previewSnapshot, '', '');
    const url = new URL(request.url);
    if (url.searchParams.get('format') === 'html') {
      return new NextResponse(html, { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    const pdf = await renderFreepassPdf(html);
    return new NextResponse(Uint8Array.from(pdf).buffer, {
      status: 200,
      headers: { ...HEADERS, 'Content-Type': 'application/pdf', 'Content-Disposition': pdfDisposition(contractCode, 'preview', true) },
    });
  } catch (error) {
    console.error('[freepass-esign] public input preview failed', contractCode, error instanceof Error ? error.message : 'unknown');
    return json({ ok: false, error: '입력한 내용의 계약서 미리보기를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = S((await params).token);
  const loaded = await loadFreepassSessionByToken(token);
  if (!loaded) return json({ error: '유효하지 않은 전자계약 링크입니다.' }, 404);
  const { hash, session } = loaded;
  const status = S(session.status);
  const url = new URL(request.url);
  const preview = url.searchParams.get('preview') === '1';
  if (status === 'revoked' || Number(session.revokedAt || 0)) {
    return json({ error: '해지된 전자계약 링크입니다.' }, 410);
  }

  const contractCode = S(session.contractCode);
  if (!contractCode) return json({ error: '계약 연결정보가 없습니다.' }, 409);

  if (status !== 'signed') {
    if (!preview) return json({ error: '서명 완료 후 계약서 사본을 받을 수 있습니다.' }, 409);
    if (!['sent', 'opened'].includes(status)) {
      return json({ error: '계약 전 A4 미리보기는 개인정보 제출 전에만 열 수 있습니다.' }, 409);
    }
    if (!hasFrozenFreepassTemplateState(session) || !hasFrozenFreepassConsentProfile(session)) {
      return json({ error: '계약서 또는 동의 프로필이 갱신되어 이 링크로는 A4 미리보기를 열 수 없습니다. 담당자에게 새 링크 발행을 요청해 주세요.' }, 409);
    }
    if (Number(session.expiresAt || 0) <= Date.now()) {
      return json({ error: '만료된 전자계약 링크입니다.' }, 410);
    }
    const snapshot = session.snapshot as EsignRecord | undefined;
    if (!snapshot) return json({ error: '발행 당시 계약서 스냅샷이 없습니다.' }, 409);
    try {
      const html = await buildFrozenFreepassHtml(snapshot, '', '');
      const pdf = await renderFreepassPdf(html);
      return new NextResponse(Uint8Array.from(pdf).buffer, {
        status: 200,
        headers: {
          ...HEADERS,
          'Content-Type': 'application/pdf',
          'Content-Disposition': pdfDisposition(contractCode, 'preview', true),
        },
      });
    } catch (error) {
      console.error('[freepass-esign] public preview pdf failed', contractCode,
        error instanceof Error ? error.message : 'unknown');
      return json({ error: 'A4 계약서 미리보기를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }
  }

  const submission = (await firebaseAdminDatabase()
    .ref(`v4/esign_private/${contractCode}/${hash}`).get()
    .catch(() => null))?.val() as EsignRecord | null;
  if (!submission) return json({ error: '완료 계약서 사본을 찾을 수 없습니다.' }, 404);
  try {
    const pdf = await readStoredFreepassPdf(submission.pdfPath, submission.pdfSha256);
    if (!pdf) return json({ error: '완료 계약서 무결성을 확인하지 못했습니다.' }, 503);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        ...HEADERS,
        'Content-Type': 'application/pdf',
        // 공개 링크에서는 계약서를 iframe으로 열지 않고, 완료본도 항상 내려받게 한다.
        'Content-Disposition': pdfDisposition(contractCode, 'signed', true),
      },
    });
  } catch {
    return json({ error: '완료 계약서 사본을 열지 못했습니다.' }, 503);
  }
}
