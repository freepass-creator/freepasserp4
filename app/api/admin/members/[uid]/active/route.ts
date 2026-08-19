import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { firebaseAdminApp, firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};

export async function POST(
  request: Request,
  context: { params: Promise<{ uid: string }> },
): Promise<Response> {
  let admin: { uid: string } | null = null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: '인증 서버를 확인할 수 없습니다' }, { status: 503, headers: PRIVATE_HEADERS });
  }
  if (!admin) return NextResponse.json({ error: '관리자 권한이 필요합니다' }, { status: 403, headers: PRIVATE_HEADERS });

  const { uid: rawUid } = await context.params;
  const uid = String(rawUid || '').trim();
  if (!uid || uid.length > 128 || /[.#$\[\]/]/.test(uid)) {
    return NextResponse.json({ error: '회원 식별자가 올바르지 않습니다' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  if (uid === admin.uid) {
    return NextResponse.json({ error: '현재 로그인한 관리자 계정은 여기서 중지할 수 없습니다' }, { status: 409, headers: PRIVATE_HEADERS });
  }

  const body = await request.json().catch(() => null) as { active?: unknown } | null;
  if (typeof body?.active !== 'boolean') {
    return NextResponse.json({ error: '사용상태 값이 올바르지 않습니다' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const active = body.active;
  const auth = getAuth(firebaseAdminApp());
  const profileRef = firebaseAdminDatabase().ref(`users/${uid}`);
  const patch = {
    is_active: active ? '예' : '아니오',
    account_state_updated_at: Date.now(),
    account_state_updated_by: admin.uid,
  };

  try {
    if (!active) {
      // 모든 서버 API와 RTDB 규칙이 확인하는 운영 프로필을 먼저 닫는다.
      // Auth 토큰 회수에 장애가 나도 이미 발급된 토큰이 운영 권한을 유지하지 못한다.
      await profileRef.update(patch);
      try {
        await auth.updateUser(uid, { disabled: true });
        await auth.revokeRefreshTokens(uid);
      } catch (error) {
        // 가입계정이 없는 레거시 프로필은 운영 프로필 차단만으로 중지 완료다.
        if (String((error as { code?: unknown })?.code || '') !== 'auth/user-not-found') throw error;
      }
    } else {
      // 재개는 Auth를 먼저 열되 운영 프로필은 마지막에 연다. 중간 실패 시 API/RLS는
      // 계속 비활성 프로필을 보며, Auth도 다시 닫아 split-state를 남기지 않는다.
      try {
        await auth.updateUser(uid, { disabled: false });
        await profileRef.update(patch);
      } catch (error) {
        await profileRef.update({ is_active: '아니오' }).catch(() => undefined);
        await auth.updateUser(uid, { disabled: true }).catch(() => undefined);
        await auth.revokeRefreshTokens(uid).catch(() => undefined);
        throw error;
      }
    }
    return NextResponse.json({ uid, active }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const code = String((error as { code?: unknown })?.code || '');
    const notFound = code === 'auth/user-not-found';
    return NextResponse.json(
      { error: notFound ? 'Firebase 가입계정을 찾을 수 없습니다' : '회원 사용상태를 변경하지 못했습니다' },
      { status: notFound ? 404 : 503, headers: PRIVATE_HEADERS },
    );
  }
}
