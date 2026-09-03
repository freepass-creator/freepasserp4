import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await verifyActiveBearer(request);
    if (!actor) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 });
  }
  /**
   * 이 경로는 예전에 브라우저 폴링이 판매시트 동기화와 상품 전체 transaction을
   * 직접 실행하던 통로였다. 상태의 정본 반영은 hourly-sync만 수행한다. 이 API는
   * 레거시 호출자를 깨지 않도록 마지막 서버 결과만 얇게 반환하며 절대 동기화를
   * 시작하지 않는다.
   */
  try {
    const snapshot = await firebaseAdminDatabase().ref('v4/system_status/sheet_live_status').get();
    const value = snapshot.val() as Record<string, unknown> | null;
    const statuses = value?.statuses && typeof value.statuses === 'object' && !Array.isArray(value.statuses)
      ? value.statuses
      : {};
    return NextResponse.json({
      ok: true,
      status: String(value?.status || 'unavailable'),
      syncedAt: Number(value?.finished_at || 0),
      statuses,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'sync status unavailable' }, { status: 503 });
  }
}

