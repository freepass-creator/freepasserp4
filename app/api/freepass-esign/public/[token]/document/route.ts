import { NextResponse } from 'next/server';
import {
  loadFreepassSessionByToken,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { readStoredFreepassPdf } from '@/lib/server/freepass-esign-document';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = S((await params).token);
  const loaded = await loadFreepassSessionByToken(token);
  if (!loaded) return json({ error: '유효하지 않은 전자계약 링크입니다.' }, 404);
  const { hash, session } = loaded;
  if (S(session.status) !== 'signed') return json({ error: '서명 완료 후 계약서 사본을 받을 수 있습니다.' }, 409);
  const contractCode = S(session.contractCode);
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
        'Content-Disposition': `inline; filename="${encodeURIComponent(contractCode)}-signed.pdf"`,
      },
    });
  } catch {
    return json({ error: '완료 계약서 사본을 열지 못했습니다.' }, 503);
  }
}
