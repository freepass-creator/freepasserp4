import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

/**
 * 영업자 상품리스트는 ERP의 입력 정본이다. 역방향 덮어쓰기는 운영자의 확정 편집을
 * 지울 수 있으므로 폐쇄한다. 과거 클라이언트가 호출해도 조용히 덮지 않고 명시적으로 막는다.
 */
export async function POST(request: Request) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  // 전 공급사 재고가 한 장에 나가므로 관리자만 허용한다.
  if (actor.role !== 'admin') return json({ error: '관리자만 내보낼 수 있습니다.' }, 403);

  return json({ error: '영업자 상품리스트는 ERP 입력 정본입니다. ERP→시트 덮어쓰기는 사용할 수 없습니다.' }, 409);
}
