import { NextResponse } from 'next/server';
import { projectChakhandealStatus } from '@/lib/domain/chakhandeal-esign-sync';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  getChakhandealConfig,
  getChakhandealContractStatus,
  recordChakhandealHandover,
} from '@/lib/server/chakhandeal-esign';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

/**
 * POST /api/chakhandeal/contracts/{contractCode}/handover
 * body: { handover_datetime: "YYYY-MM-DD" }
 * 관리자만. 서명 완료 계약의 인도일 보완.
 */
export async function POST(request: Request, { params }: { params: Promise<{ contractCode: string }> }) {
  const config = getChakhandealConfig();
  if (!config) return json({ error: '착한거래 전자계약 연동 준비 중입니다.' }, 503);

  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  if (actor.role !== 'admin' || actor.rawRole !== 'admin') {
    return json({ error: '관리자만 인도일을 보완할 수 있습니다.' }, 403);
  }

  const contractCode = S((await params).contractCode);
  if (!contractCode || contractCode.length > 100 || /[.#$\[\]\/\u0000-\u001f\u007f]/.test(contractCode)) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }

  let handover_datetime = '';
  let car_number = '';
  let vin = '';
  try {
    const body = await request.json() as {
      handover_datetime?: unknown;
      date?: unknown;
      car_number?: unknown;
      vin?: unknown;
    };
    handover_datetime = S(body.handover_datetime || body.date).slice(0, 40);
    car_number = S(body.car_number).slice(0, 40);
    vin = S(body.vin).slice(0, 80);
  } catch {
    return json({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(handover_datetime)) {
    return json({ error: '인도일(YYYY-MM-DD)이 필요합니다.' }, 400);
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
  if (!contractId) return json({ error: '착한거래 계약 식별자가 없습니다.' }, 409);
  if (S(contract.sign_status) !== '서명완료') {
    return json({ error: '계약 서명이 끝난 뒤에 인도일을 보완할 수 있습니다.' }, 409);
  }

  try {
    const recorded = await recordChakhandealHandover(config, contractId, {
      handover_datetime,
      car_number,
      vin,
    });
    const status = await getChakhandealContractStatus(config, contractId);
    const projection = projectChakhandealStatus(status, contractCode);
    await db.ref(`v4/contracts/${contractCode}`).update(projection.patch);
    return json({
      ok: true,
      handover: recorded.handover,
      pendingHandover: recorded.pendingHandover,
      patch: projection.patch,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '인도일을 저장하지 못했습니다.';
    const status = typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: number }).status)
      : 0;
    console.error('[chakhandeal-esign] handover failed', contractCode, msg);
    if (status === 400 || status === 409 || /인도일|서명/.test(msg)) {
      return json({ error: msg }, status || 400);
    }
    return json({ error: '인도일을 저장하지 못했습니다.' }, 502);
  }
}
