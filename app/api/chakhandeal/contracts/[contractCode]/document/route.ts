import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { fetchChakhandealContractPdf, getChakhandealConfig } from '@/lib/server/chakhandeal-esign';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

export async function GET(request: Request, { params }: { params: Promise<{ contractCode: string }> }) {
  const config = getChakhandealConfig();
  if (!config) return json({ error: '착한거래 전자계약 연동 준비 중입니다.' }, 503);

  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  if (actor.role !== 'admin') return json({ error: '관리자만 계약서 PDF를 열 수 있습니다.' }, 403);

  const contractCode = S((await params).contractCode);
  if (!contractCode || contractCode.length > 100 || /[.#$\[\]\/]/.test(contractCode)) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }

  const db = firebaseAdminDatabase();
  const [overlaySnap, legacySnap] = await Promise.all([
    db.ref(`v4/contracts/${contractCode}`).get(),
    db.ref(`contracts/${contractCode}`).get(),
  ]);
  const contract = {
    ...((legacySnap.val() as Record<string, unknown> | null) || {}),
    ...((overlaySnap.val() as Record<string, unknown> | null) || {}),
  };
  const contractId = S(contract.esign_id);
  const expectedSha256 = S(contract.esign_document_sha256);
  if (!contractId || S(contract.sign_status) !== '서명완료' || !expectedSha256) {
    return json({ error: '서명 완료 PDF가 아직 준비되지 않았습니다.' }, 409);
  }

  try {
    const pdf = await fetchChakhandealContractPdf(config, contractId);
    const actualSha256 = createHash('sha256').update(pdf.bytes).digest('hex');
    if (!sameHash(expectedSha256, actualSha256) || (pdf.sha256 && !sameHash(pdf.sha256, actualSha256))) {
      console.error('[chakhandeal-esign] PDF integrity mismatch', contractCode, contractId);
      return json({ error: '계약서 PDF 무결성 확인에 실패했습니다.' }, 502);
    }
    const body = pdf.bytes.buffer.slice(
      pdf.bytes.byteOffset,
      pdf.bytes.byteOffset + pdf.bytes.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(body, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${contractCode}.pdf"`,
        'Content-Length': String(pdf.bytes.length),
        'X-Contract-Document-SHA256': actualSha256,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[chakhandeal-esign] PDF proxy failed', contractCode, error instanceof Error ? error.message : 'unknown');
    return json({ error: '계약서 PDF를 불러오지 못했습니다.' }, 502);
  }
}
