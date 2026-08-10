import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  canManageFreepassEsign,
  freepassStorageBucket,
  loadFreepassEsignBundle,
  sessionHashFromContract,
  validContractCode,
  type EsignRecord,
} from '@/lib/server/freepass-esign';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractCode: string; kind: string }> },
) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!canManageFreepassEsign(actor)) return json({ error: '관리자만 본인확인 자료를 볼 수 있습니다.' }, 403);

  const resolved = await params;
  const contractCode = validContractCode(resolved.contractCode);
  const kind = String(resolved.kind || '');
  if (!contractCode || !['id-card', 'selfie'].includes(kind)) return json({ error: '요청이 올바르지 않습니다.' }, 400);
  const bundle = await loadFreepassEsignBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  const hash = sessionHashFromContract(bundle.contract);
  if (!hash) return json({ error: '전자계약 세션을 찾을 수 없습니다.' }, 404);
  const submission = (await bundle.db.ref(`v4/esign_private/${contractCode}/${hash}`).get()).val() as EsignRecord | null;
  const path = String(kind === 'id-card' ? submission?.idCardPath || '' : submission?.selfiePath || '');
  const contentType = String(kind === 'id-card' ? submission?.idCardContentType || 'image/jpeg' : submission?.selfieContentType || 'image/jpeg');
  if (!path) return json({ error: '첨부된 사진이 없습니다.' }, 404);
  try {
    const [buffer] = await freepassStorageBucket().file(path).download();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { ...PRIVATE_HEADERS, 'Content-Type': contentType },
    });
  } catch {
    return json({ error: '본인확인 자료를 열지 못했습니다.' }, 404);
  }
}
