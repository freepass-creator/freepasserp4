import { NextResponse } from 'next/server';
import {
  loadFreepassSessionByToken,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import {
  buildFrozenFreepassHtml,
  readStoredFreepassPdf,
  renderFreepassPdf,
} from '@/lib/server/freepass-esign-document';

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
  const download = url.searchParams.get('download') === '1';
  if (status === 'revoked') return json({ error: '해지된 전자계약 링크입니다.' }, 410);

  const contractCode = S(session.contractCode);
  if (!contractCode) return json({ error: '계약 연결정보가 없습니다.' }, 409);

  if (status !== 'signed') {
    if (!preview) return json({ error: '서명 완료 후 계약서 사본을 받을 수 있습니다.' }, 409);
    if (!['sent', 'opened'].includes(status)) {
      return json({ error: '계약 전 A4 미리보기는 개인정보 제출 전에만 열 수 있습니다.' }, 409);
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
          'Content-Disposition': pdfDisposition(contractCode, 'preview', false),
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
        'Content-Disposition': pdfDisposition(contractCode, 'signed', download),
      },
    });
  } catch {
    return json({ error: '완료 계약서 사본을 열지 못했습니다.' }, 503);
  }
}
