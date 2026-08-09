import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { publishInventorySheet } from '@/lib/server/inventory-sheet-publish';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const S = (v: unknown) => String(v ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

/**
 * 재고 → 영업자용 구글시트 내보내기 (관리자 버튼).
 *
 * 실제 반영은 `lib/server/inventory-sheet-publish.ts` 하나가 한다 —
 * 일일 동기화도 **같은 함수**를 부른다. 두 경로가 각자 올리면 언젠가 다른 표가 나가고,
 * 그때 영업자는 어느 쪽이 «지금»인지 알 수 없다.
 */
export async function POST(request: Request) {
  if (!S(process.env.INVENTORY_EXPORT_SHEET_ID)) {
    return json({ error: '내보낼 구글시트가 설정되지 않았습니다(INVENTORY_EXPORT_SHEET_ID).' }, 503);
  }

  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  // 전 공급사 재고가 한 장에 나가므로 관리자만 허용한다.
  if (actor.role !== 'admin') return json({ error: '관리자만 내보낼 수 있습니다.' }, 403);

  try {
    /**
     * 카탈로그 링크 주소 — 설정이 없으면 이 요청이 들어온 곳(=지금 fp4 를 서비스하는 주소).
     * freepasserp.com 을 박아 두면 도메인 전환 전까지 erp3 로 가서 링크가 죽는다.
     */
    const origin = S(process.env.INVENTORY_EXPORT_ORIGIN) || new URL(request.url).origin;
    const snapshot = new URL(request.url).searchParams.get('snapshot') === '1';
    const result = await publishInventorySheet(firebaseAdminDatabase(), { origin, snapshot });
    return json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error('[sheet-export] failed', message);
    // 공급사 원본 시트 방어는 «설정 잘못»이라 502 가 아니라 409 로 알린다.
    return json({ error: `시트 내보내기 실패 — ${message}` }, /중단 —/.test(message) ? 409 : 502);
  }
}
