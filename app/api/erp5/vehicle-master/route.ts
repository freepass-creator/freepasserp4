import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import { readActiveErp5VehicleMaster } from '@/lib/server/erp5-admin';

export const dynamic = 'force-dynamic';

/** ERP4가 ERP5의 활성 차종 원자를 조회하는 인증 경계. */
export async function GET(request: Request) {
  try {
    const actor = await verifyActiveBearer(request);
    if (!actor) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    const active = await readActiveErp5VehicleMaster();
    return NextResponse.json(active, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'X-ERP5-Vehicle-Version': active.versionId,
        'X-ERP5-Release': active.releaseId,
      },
    });
  } catch (error) {
    console.error('[api/erp5/vehicle-master]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '차종마스터를 불러오지 못했습니다.' }, { status: 503 });
  }
}
