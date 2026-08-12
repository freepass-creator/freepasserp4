import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  canManageFreepassEsign,
  buildFreepassIssueSnapshot,
  loadFreepassEsignBundle,
  sessionHashFromContract,
  validContractCode,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { snapshotWithPrivateSubmission } from '@/lib/domain/esign-signed-snapshot';
import {
  buildFrozenFreepassHtml,
  createAndStoreFreepassPdf,
  readStoredFreepassPdf,
  renderFreepassPdf,
} from '@/lib/server/freepass-esign-document';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractCode: string }> },
) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!canManageFreepassEsign(actor)) return json({ error: '관리자만 계약서 문서를 열 수 있습니다.' }, 403);

  const contractCode = validContractCode((await params).contractCode);
  if (!contractCode) return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  const bundle = await loadFreepassEsignBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  const url = new URL(request.url);
  const draft = url.searchParams.get('draft') === '1';
  const format = url.searchParams.get('format') === 'pdf' ? 'pdf' : 'html';

  if (draft && String(bundle.contract.esign_provider || '') !== 'freepass') {
    let previewSnapshot: EsignRecord;
    try {
      previewSnapshot = buildFreepassIssueSnapshot({
        contract: bundle.contract,
        policy: bundle.policy,
        product: bundle.product,
        partner: bundle.partner,
        standardTemplateId: String(bundle.contract.standard_template_id || ''),
        contractKind: String(bundle.contract.contract_kind || ''),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'A4 계약서 초안을 만들 수 없습니다.' }, 409);
    }
    const previewHtml = await buildFrozenFreepassHtml(previewSnapshot, '', '');
    if (format === 'html') {
      return new NextResponse(previewHtml, {
        status: 200,
        headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    try {
      const previewPdf = await renderFreepassPdf(previewHtml);
      return new NextResponse(Uint8Array.from(previewPdf).buffer, {
        status: 200,
        headers: {
          ...PRIVATE_HEADERS,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${encodeURIComponent(contractCode)}-draft.pdf"`,
        },
      });
    } catch {
      return json({ error: '이 서버에는 A4 PDF 생성용 Chrome이 없습니다. HTML 미리보기를 사용해 주세요.' }, 503);
    }
  }
  if (String(bundle.contract.esign_provider || '') !== 'freepass') {
    return json({ error: '프리패스에서 발행한 전자계약이 아닙니다.' }, 409);
  }
  const hash = sessionHashFromContract(bundle.contract);
  if (!hash) return json({ error: '전자계약 세션을 찾을 수 없습니다.' }, 404);
  const [sessionSnap, privateSnap] = await Promise.all([
    bundle.db.ref(`v4/esign_sessions/${hash}`).get(),
    bundle.db.ref(`v4/esign_private/${contractCode}/${hash}`).get().catch(() => null),
  ]);
  const session = sessionSnap.val() as EsignRecord | null;
  const submission = privateSnap?.val() as EsignRecord | null;
  const snapshot = session?.snapshot as EsignRecord | undefined;
  if (!session || !snapshot) return json({ error: '발행 당시 계약서 스냅샷이 없습니다.' }, 409);

  if (!draft && String(session.status || '') !== 'signed') {
    return json({ error: '서명 완료 후 완료본을 만들 수 있습니다.' }, 409);
  }
  const signature = draft ? '' : String(submission?.signature || '');
  if (!draft && !signature) return json({ error: '완료본에 넣을 서명이 없습니다.' }, 409);
  const documentSnapshot = draft ? snapshot : snapshotWithPrivateSubmission(snapshot, submission);

  if (format === 'pdf' && !draft && submission?.pdfPath) {
    try {
      const stored = await readStoredFreepassPdf(submission.pdfPath, submission.pdfSha256);
      if (stored) return new NextResponse(stored, {
          status: 200,
          headers: {
            ...PRIVATE_HEADERS,
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${encodeURIComponent(contractCode)}-signed.pdf"`,
          },
        });
    } catch { /* 저장본이 없으면 아래에서 한 번 다시 만든다 */ }
  }

  const html = await buildFrozenFreepassHtml(documentSnapshot, signature, String(session.sealHash || ''));
  if (format === 'html') {
    return new NextResponse(html, {
      status: 200,
      headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  let pdf: Uint8Array;
  let archived: Awaited<ReturnType<typeof createAndStoreFreepassPdf>> | null = null;
  try {
    if (draft) {
      pdf = await renderFreepassPdf(html);
    } else {
      archived = await createAndStoreFreepassPdf({
          contractCode,
          hash,
          snapshot: documentSnapshot,
          signature,
          sealHash: String(session.sealHash || ''),
        });
      pdf = archived.pdf;
    }
  } catch (error) {
    console.error('[freepass-esign] pdf render failed', contractCode, error instanceof Error ? error.message : 'unknown');
    return json({ error: '이 서버에는 A4 PDF 생성용 Chrome이 없습니다. 미리보기에서 인쇄 → PDF 저장을 사용해 주세요.' }, 503);
  }
  if (archived) {
    try {
      const documentSha256 = archived.documentSha256;
      await Promise.all([
        bundle.db.ref(`v4/esign_private/${contractCode}/${hash}`).update({
          pdfPath: archived.pdfPath,
          pdfSha256: documentSha256,
        }),
        bundle.db.ref(`v4/contracts/${contractCode}`).update({
          esign_document_sha256: documentSha256,
        }),
        session?.sealHash
          ? bundle.db.ref(`v4/esign_verifications/${String(session.sealHash)}`).update({ documentSha256 })
          : Promise.resolve(),
      ]);
    } catch (error) {
      console.warn('[freepass-esign] pdf archive failed', contractCode, error instanceof Error ? error.message : 'unknown');
    }
  }
  return new NextResponse(Uint8Array.from(pdf).buffer, {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(contractCode)}-${draft ? 'draft' : 'signed'}.pdf"`,
    },
  });
}
