import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 로컬 검토용 표준계약서 PDF. 실제 고객 발송 링크와는 분리한다. */
export async function GET() {
  try {
    const pdfPath = path.join(
      process.cwd(),
      'public',
      'contract-template',
      'freepass-standard-rental-contract-v1-review.pdf',
    );
    const pdf = await readFile(pdfPath);

    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="freepass-standard-rental-contract-v1-review.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return Response.json(
      { message: '샘플 계약서 PDF를 먼저 생성해 주세요.' },
      { status: 404 },
    );
  }
}
