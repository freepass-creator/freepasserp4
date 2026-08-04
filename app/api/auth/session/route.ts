import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};

/**
 * 배포 후 역할별 smoke가 현재 토큰의 운영 권한 SSOT를 확인하는 읽기 전용 endpoint.
 * uid·이메일·이름은 반환하지 않고 역할과 조직 범위 코드만 노출한다.
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await verifyActiveBearer(request);
  } catch {
    return NextResponse.json(
      { error: 'server auth unavailable' },
      { status: 503, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  if (!actor) {
    return NextResponse.json(
      { error: 'forbidden' },
      { status: 403, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }

  const organizationCode = actor.role === 'admin'
    ? ''
    : (actor.role === 'provider' ? actor.companyCode : actor.agentChannelCode);
  return NextResponse.json({
    role: actor.role,
    rawRole: actor.rawRole,
    organizationCode,
  }, { headers: PRIVATE_RESPONSE_HEADERS });
}
