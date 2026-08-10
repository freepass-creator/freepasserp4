import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import { canManageFreepassEsign } from '@/lib/server/freepass-esign';
import { importEsignExcel } from '@/lib/domain/esign-excel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_EXCEL_BYTES = 10 * 1024 * 1024;
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '관리자 로그인이 필요합니다.' }, 401); }
  if (!canManageFreepassEsign(actor)) {
    return json({ error: '전자계약 엑셀 가져오기는 관리자만 할 수 있습니다.' }, 403);
  }

  let data: FormData;
  try { data = await request.formData(); }
  catch { return json({ error: '업로드 형식이 올바르지 않습니다.' }, 400); }
  const file = data.get('file');
  if (!(file instanceof File)) return json({ error: '엑셀 파일을 골라 주세요.' }, 400);
  if (!file.size || file.size > MAX_EXCEL_BYTES) {
    return json({ error: '엑셀 파일은 10MB 이하만 불러올 수 있습니다.' }, 413);
  }
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    return json({ error: 'xlsx, xlsm, xls 파일만 불러올 수 있습니다.' }, 415);
  }

  try {
    // 원본 파일은 저장하지 않는다. 메모리에서 계약별 변경값만 추출해 응답한다.
    const result = importEsignExcel(new Uint8Array(await file.arrayBuffer()));
    return json({ ok: true, result });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : '엑셀 계약서를 읽지 못했습니다.',
    }, 422);
  }
}
