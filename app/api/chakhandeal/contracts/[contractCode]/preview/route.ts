import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import { firestoreAdminRef } from '@/lib/server/firestore-ref-shim';
import { fetchChakhandealDraftPreview, getChakhandealConfig } from '@/lib/server/chakhandeal-esign';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

/**
 * GET /api/chakhandeal/contracts/{contractCode}/preview?save=0|1
 * 관리자만. 저장된 esign_id 로 착한거래 서명 전 A4 초안 HTML을 프록시한다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ contractCode: string }> }) {
  const config = getChakhandealConfig();
  if (!config) return json({ error: '착한거래 전자계약 연동 준비 중입니다.' }, 503);

  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  if (actor.role !== 'admin' || actor.rawRole !== 'admin') {
    return json({ error: '관리자만 계약서 초안을 열 수 있습니다.' }, 403);
  }

  const contractCode = S((await params).contractCode);
  if (!contractCode || contractCode.length > 100 || /[.#$\[\]\/\u0000-\u001f\u007f]/.test(contractCode)) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }

  const save = new URL(request.url).searchParams.get('save') === '1';

  /*
   * ★파이어스토어를 읽는다(2026-09-05 · 「위험 낮은 거부터」). 심이 `contracts` → `contract` 로 옮긴다.
   * ⚠ v3(`contracts`)·v4(`v4/contracts`) 두 겹으로 읽던 것을 **한 겹**으로 줄였다 —
   *   파이어스토어에는 둘이 이미 합쳐져 들어가 있다(문서 121건). 두 번 읽으면 같은 문서를 두 번 본다.
   */
  const db = firestoreAdminRef();
  const snap = await db.ref(`v4/contracts/${contractCode}`).get();
  const contract = (snap.val() as Record<string, unknown> | null) || {};
  const contractId = S(contract.esign_id);
  if (!contractId) return json({ error: '착한거래 계약 식별자가 없습니다.' }, 409);

  try {
    const html = await fetchChakhandealDraftPreview(config, contractId, { save });
    return new NextResponse(html, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: number }).status) || 502
      : 502;
    const message = error instanceof Error ? error.message : '계약서 초안을 불러오지 못했습니다.';
    if (status === 409) return json({ error: message }, 409);
    console.error('[chakhandeal-esign] preview proxy failed', contractCode, message);
    return json({ error: '계약서 초안을 불러오지 못했습니다.' }, 502);
  }
}
