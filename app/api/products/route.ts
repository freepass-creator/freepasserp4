import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * 로그인 ERP용 상품 원본.
 *
 * 브라우저 RTDB SDK가 연결 복구 중 오래된 로컬 스냅샷을 성공값처럼 반환해도 상품찾기는
 * 공급사 동기화가 쓴 현재 v4/products를 읽어야 한다. private 원가 노드는 읽지 않는다.
 */
export async function GET(request: Request) {
  try {
    const actor = await verifyActiveBearer(request);
    if (!actor) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    const value = (await firebaseAdminDatabase().ref('v4/products').get()).val() || {};
    return NextResponse.json(value, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[api/products]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '상품을 불러오지 못했습니다.' }, { status: 503 });
  }
}
