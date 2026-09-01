import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { SettlementIssuanceError } from '@/lib/domain/settlement-issuance';
import { issueSettlementFromServer } from '@/lib/server/settlement-issuance';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const text = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request, context: { params: Promise<{ contractCode: string }> }) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '정산 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);

  const { contractCode: rawCode } = await context.params;
  const contractCode = text(rawCode);
  if (!contractCode || contractCode.length > 100 || /[.#$\[\]\/]/.test(contractCode)) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }

  try {
    const result = await issueSettlementFromServer(firebaseAdminDatabase(), actor, contractCode);
    return json({ ok: true, code: result.code, reused: result.reused });
  } catch (error) {
    if (error instanceof SettlementIssuanceError) {
      const message = error.message;
      const forbidden = /권한/.test(message);
      return json({ error: message }, forbidden ? 403 : 409);
    }
    console.error('[settlement] issue failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '정산 생성에 실패했습니다. 다시 시도하세요.' }, 503);
  }
}
