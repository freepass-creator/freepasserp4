import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { firebaseAdminApp, firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { selfServeActivationDecision } from '@/lib/domain/self-serve-activation';
import { newId } from '@/lib/domain/ids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};

function bearerToken(request: Request): string {
  return request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
}
/**
 * 승인제였던 시기에 생성된 미배정 자가가입 계정만 개인 영업자로 전환한다.
 * Firebase ID token의 uid와 프로필 uid를 다시 맞추고 transaction 안에서 조건을 재검사한다.
 */
export async function POST(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: PRIVATE_HEADERS });
  }

  let uid = '';
  // ★자동 통과 판정에 쓰는 이메일은 «토큰에서 꺼낸 것»이어야 한다.
  //   프로필에 적힌 이메일을 쓰면 아무나 우리 도메인이라 적고 들어온다.
  let verified: { email?: string; emailVerified?: boolean } = {};
  try {
    const decoded = await getAuth(firebaseAdminApp()).verifyIdToken(token);
    if (decoded.firebase?.sign_in_provider === 'anonymous') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: PRIVATE_HEADERS });
    }
    uid = decoded.uid;
    verified = { email: decoded.email, emailVerified: decoded.email_verified === true };
  } catch (error) {
    const code = String((error as { code?: unknown })?.code || '');
    const status = code.startsWith('auth/') ? 401 : 503;
    return NextResponse.json(
      { error: status === 401 ? 'unauthorized' : 'server auth unavailable' },
      { status, headers: PRIVATE_HEADERS },
    );
  }

  const profileRef = firebaseAdminDatabase().ref(`users/${uid}`);
  let deniedReason = 'not_eligible';
  const issuedUserCode = newId('user');
  try {
    const result = await profileRef.transaction((current) => {
      const decision = selfServeActivationDecision(current as Record<string, unknown> | null, uid, verified);
      deniedReason = decision.reason;
      if (!decision.eligible) return;
      const workspace = decision.reason === 'workspace_member';
      const previousUserCode = String((current as Record<string, unknown> | null)?.user_code || '').trim();
      // 기존 user_code는 RTDB Rules의 역할별 query.equalTo에도 쓰인다. 값을 즉시 바꾸면
      // 과거 계약·정산이 권한상 사라지므로 기존 값은 유지하고 신규 계정만 usr_ 코드를 발급한다.
      const userCode = previousUserCode || issuedUserCode;
      const currentRole = String((current as Record<string, unknown> | null)?.role || '').trim();
      return {
        ...current,
        // 공급사로 신청했어도 실제 소속 확인 전에는 개인 영업자 최소 권한만 부여한다.
        // ★워크스페이스 자동 통과는 «승인»까지다 — 이미 배정된 역할은 지키되, 없으면 최소 권한.
        //   도메인만으로 admin 을 주면 메일 하나로 전 회사 금액이 열린다.
        role: workspace && currentRole ? currentRole : 'agent',
        status: 'active',
        user_code: userCode,
        self_activated_at: Date.now(),
        self_activation_source: decision.reason,
      };
    }, undefined, false);

    if (!result.committed) {
      return NextResponse.json(
        { error: 'not eligible', reason: deniedReason },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json(
      { activated: true, status: 'active' },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: 'activation unavailable' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
