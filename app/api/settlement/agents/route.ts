/**
 * **접수할 때 고를 영업담당자 명부.** 읽기만 한다. 관리자만.
 *
 * ★사장님 2026-08-26 「영업채널 영업자명 이렇게 해야하고 그리고 각각 영업자한테 코드를
 *   부여해야할거 같어 / 동명이인 거르려면」.
 *
 * ★★**사람이 이름을 타이핑하게 두지 않는다.** 고르게 하고 코드는 기계가 채운다 —
 *   ERP5 코드 규격이 그렇게 적어 뒀고, 실측으로도 그게 맞았다:
 *   손으로 적던 정책코드가 296대 빈칸이었고, 원장 영업담당자는 동명이인이 셋이나 됐다.
 *   **입구를 안 고치면 새 줄마다 같은 문제가 다시 생긴다.**
 * ★고르면 «영업채널»도 같이 따라온다. 사람과 회사는 다른 축이지만, 사람을 고르면 회사가 정해진다.
 * ⚠ 같은 이름이 여럿이면 화면에서 구분되게 채널을 붙여 보여 준다 — 코드는 안 보인다(사람이 못 읽는다).
 */
import { NextResponse } from 'next/server';
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const S = (v: unknown) => String(v ?? '').trim();

type U = { name?: string; user_code?: string; company_name?: string; status?: string; is_active?: unknown; role?: string };

export async function GET(req: Request) {
  const who = await verifyActiveBearer(req).catch(() => null);
  if (!who) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });
  if (who.role !== 'admin') return NextResponse.json({ ok: false, reason: '관리자만 볼 수 있습니다.' }, { status: 403 });

  const snap = await getDatabase(firebaseAdminApp()).ref('users').get().catch(() => null);
  const users = (snap?.val() || {}) as Record<string, U>;

  const live = Object.values(users).filter((u) => {
    const st = S(u?.status);
    if (st === 'deleted' || st === 'rejected') return false;
    if (u?.is_active === false || S(u?.is_active) === '아니오') return false;
    return !!S(u?.name) && !!S(u?.user_code);
  });

  // 같은 이름이 여럿이면 화면에서 채널을 붙여 구분한다 — 안 그러면 고를 때 또 헷갈린다.
  const seen = new Map<string, number>();
  for (const u of live) seen.set(S(u.name), (seen.get(S(u.name)) || 0) + 1);

  const list = live
    .map((u) => {
      const name = S(u.name);
      const channel = S(u.company_name);
      return {
        code: S(u.user_code),
        name,
        channel,
        /** 화면에 보일 말 — 겹치는 이름만 채널을 붙인다. */
        label: (seen.get(name) || 0) > 1 && channel ? `${name} (${channel})` : name,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));

  return NextResponse.json({ ok: true, count: list.length, list });
}
