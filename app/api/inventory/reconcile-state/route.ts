import { NextResponse } from 'next/server';
import { verifyAdminBearer } from '@/lib/server/firebase-admin';
import { readSheetReconcileState } from '@/lib/server/sheet-reconcile-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 시트 검증용 재고 스냅샷 — 브라우저가 `v4/products` 전량(약 8MB)을 직접 읽던 자리를 대신한다.
 *
 * 브라우저 RTDB `get()` 에는 타임아웃이 없어 한 번 늦어지면 검증이 영영 안 끝났다.
 * 여기로 옮기면 호출부가 평범한 `fetch` 가 되고, 상한을 걸 수 있다.
 *
 * fail-closed: 읽기가 실패하면 503 으로 끊고 **부분 결과를 절대 내려보내지 않는다.**
 * 재고 일부만 받은 채 판정하면 시트에 있는 차가 「ERP 에 없음」으로 오판돼
 * 멀쩡한 매물이 대량 출고불가가 된다.
 */
export async function GET(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch (error) {
    return NextResponse.json(
      { error: 'server auth unavailable', detail: String((error as Error)?.message || error) },
      { status: 503 },
    );
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const companyId = new URL(request.url).searchParams.get('company')?.trim() || '';
  if (!companyId) return NextResponse.json({ error: 'company 필요' }, { status: 400 });

  try {
    const payload = await readSheetReconcileState(companyId);
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'reconcile state unavailable', detail: String((error as Error)?.message || error) },
      { status: 503 },
    );
  }
}
