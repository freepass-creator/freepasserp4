import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';
import { OPS_PIPELINE_PATH, type OpsPipelineStatus } from '@/lib/ops-status';

/**
 * 관제탑이 읽는 창 — 문서 **하나**만 준다.
 *
 * ★비용이 여기서 갈린다. 매물 전량(1.2MB)을 폴링하면 열 명이 10분마다 봐도 월 50달러쯤
 *   나가지만, 이 2KB 한 줄은 30초마다 봐도 월 몇 천 원이다. 폴링 «주기»가 아니라
 *   읽는 «크기»가 비용을 정한다 — 그래서 자동동기가 미리 요약해 두고 여기선 그것만 읽는다.
 *
 * ⚠ **로그인 뒤에 둔다.** 단계 요약에 공급사 이름·시트 이름이 실린다.
 *   손님에게 열면 우리 공급사 명단이 통째로 새는 길이 된다.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const snap = await firebaseAdminDatabase().ref(OPS_PIPELINE_PATH).get();
    const value = snap.val();
    // 아직 한 번도 안 올라왔으면 «없음»을 분명히 준다 — 빈 객체를 주면 화면이 0 으로 그린다.
    const status: OpsPipelineStatus | null = value && typeof value === 'object' ? value : null;
    return NextResponse.json({ status, serverNow: Date.now() });
  } catch {
    return NextResponse.json({ error: 'ops status unavailable' }, { status: 503 });
  }
}
