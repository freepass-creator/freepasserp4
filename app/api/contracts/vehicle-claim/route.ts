import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { isVehicleClaimStepKey } from '@/lib/domain/vehicle-claim';
import {
  releaseCancelledVehicleClaim,
  transitionVehicleClaim,
  VehicleClaimConflictError,
  vehicleClaimServerEnabled,
} from '@/lib/server/vehicle-claim';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const text = (value: unknown): string => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  if (!vehicleClaimServerEnabled()) return json({ error: '차량 원자 선점 기능이 아직 활성화되지 않았습니다.' }, 503);
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '차량 선점 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);

  let body: { action?: unknown; contractCode?: unknown; key?: unknown; value?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const contractCode = text(body.contractCode);
  if (!contractCode || contractCode.length > 100 || /[.#$\[\]\/]/.test(contractCode)) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }

  try {
    if (body.action === 'release_cancelled') {
      const result = await releaseCancelledVehicleClaim(firebaseAdminDatabase(), actor, contractCode);
      return json({ ok: true, result });
    }
    const key = text(body.key);
    const value = text(body.value);
    if (!isVehicleClaimStepKey(key) || (value !== 'yes' && value !== '')) {
      return json({ error: '차량 선점 단계값이 올바르지 않습니다.' }, 400);
    }
    const result = await transitionVehicleClaim(firebaseAdminDatabase(), actor, { contractCode, key, value });
    return json({ ok: true, result });
  } catch (error) {
    if (error instanceof VehicleClaimConflictError) return json({ error: error.message, owner: error.owner || undefined }, 409);
    console.error('[vehicle-claim] transition failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '차량 원자 선점 처리에 실패했습니다. 다시 시도하세요.' }, 503);
  }
}
