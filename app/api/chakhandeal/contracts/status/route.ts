import { NextResponse } from 'next/server';
import { projectChakhandealStatus } from '@/lib/domain/chakhandeal-esign-sync';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { getChakhandealConfig, getChakhandealContractStatus } from '@/lib/server/chakhandeal-esign';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  const config = getChakhandealConfig();
  if (!config) return json({ error: '착한거래 전자계약 연동 준비 중입니다.' }, 503);

  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  if (actor.role !== 'admin') return json({ error: '관리자만 전자계약 상태를 동기화할 수 있습니다.' }, 403);

  let contractCodes: string[] = [];
  try {
    const body = await request.json() as { contractCodes?: unknown };
    contractCodes = Array.isArray(body.contractCodes)
      ? [...new Set(body.contractCodes.map(S).filter(Boolean))]
      : [];
  } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!contractCodes.length || contractCodes.length > 50) {
    return json({ error: '계약번호는 한 번에 1~50개까지 조회할 수 있습니다.' }, 400);
  }
  if (contractCodes.some((code) => code.length > 100 || /[.#$\[\]\/\u0000-\u001f\u007f]/.test(code))) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }

  const db = firebaseAdminDatabase();
  const results = await Promise.all(contractCodes.map(async (contractCode) => {
    try {
      const [overlaySnap, legacySnap] = await Promise.all([
        db.ref(`v4/contracts/${contractCode}`).get(),
        db.ref(`contracts/${contractCode}`).get(),
      ]);
      const contract = {
        ...((legacySnap.val() as Record<string, unknown> | null) || {}),
        ...((overlaySnap.val() as Record<string, unknown> | null) || {}),
      };
      const contractId = S(contract.esign_id);
      if (!contractId) return { contractCode, ok: false, error: '착한거래 계약 식별자가 없습니다.' };

      const status = await getChakhandealContractStatus(config, contractId);
      const projection = projectChakhandealStatus(status, contractCode);
      await db.ref(`v4/contracts/${contractCode}`).update(projection.patch);
      return { contractCode, ok: true, patch: projection.patch };
    } catch (error) {
      console.error('[chakhandeal-esign] status sync failed', contractCode, error instanceof Error ? error.message : 'unknown');
      return { contractCode, ok: false, error: '상태 동기화 실패' };
    }
  }));

  return json({ ok: true, results });
}
