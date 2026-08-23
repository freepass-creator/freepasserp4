import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { ContractSettlementSealError, freezeContractSettlementTerms } from '@/lib/server/contract-settlement-seal';
import { validContractCode } from '@/lib/server/freepass-esign';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request, context: { params: Promise<{ contractCode: string }> }) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '약정 기준 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);

  const { contractCode: rawCode } = await context.params;
  const contractCode = validContractCode(rawCode);
  if (!contractCode) return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  let body: { rentMonth?: unknown; customerName?: unknown; customerPhone?: unknown; completeAgreement?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const rentMonth = Number(body.rentMonth);
  if (!Number.isInteger(rentMonth) || rentMonth <= 0 || rentMonth > 120) {
    return json({ error: '약정 기간이 올바르지 않습니다.' }, 400);
  }
  if (body.completeAgreement !== true) {
    return json({ error: '기간만 동결할 수 없습니다. 손님 정보까지 입력한 약정작성완료로 진행해 주세요.' }, 400);
  }

  try {
    const result = await freezeContractSettlementTerms({
      db: firebaseAdminDatabase(), actor, contractCode, rentMonth,
      customerName: typeof body.customerName === 'string' ? body.customerName : '',
      customerPhone: typeof body.customerPhone === 'string' ? body.customerPhone : '',
      completeAgreement: body.completeAgreement === true,
    });
    return json({ ok: true, reused: result.reused, contractPatch: result.contractPatch });
  } catch (error) {
    if (error instanceof ContractSettlementSealError) return json({ error: error.message }, 409);
    console.error('[contract-term-freeze] failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '약정 기준 동결에 실패했습니다. 다시 시도해 주세요.' }, 503);
  }
}
