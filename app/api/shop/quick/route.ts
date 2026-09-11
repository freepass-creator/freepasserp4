import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import { readShopQuick, writeShopQuick, sanitizeQuick } from '@/lib/server/shop-quick-store';
import { WHITELABELS } from '@/lib/whitelabel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * **채널의 빠른조건을 «화면에서» 고친다.**
 *
 * ★사장님 2026-09-10 「퀵필터를 **수정할 수 있게** 해주면 좋겠어」 · 「**있는 필터만** 갖다 놓겠음」.
 *
 * ★★★**누구나 고친다 — 손님도.**
 *   사장님 2026-09-10 「그냥 **누구나 할 수 있게 오픈**할 거야. 어차피 **우리 거 팔아주는 입장**이니까
 *   **누구라도 할 수 있게**」 · 「**손님도 할 수 있게 다~ 모든 사람이**」.
 *   ⇒ **로그인이 필요 없다.** 역할도, 채널 소속도 안 본다.
 *
 * ⚠ **처음엔 잠갔다가 두 번 물렸다.** ㉠ 영업자·관리자만 → ㉡ 로그인한 사람 전부 → ㉢ 전부.
 *   걱정했던 것은 「공급사가 제 차를 앞으로 끈다」·「남의 가게 첫 줄을 고친다」였는데,
 *   사장님 판단은 **여기서 무엇을 앞에 세우든 팔리는 것은 우리 재고**라는 것이다.
 *   빗장이 막는 것보다 «못 고쳐서 안 고치는 것»이 크다. ⇒ 되돌리려면 **먼저 여쭙는다.**
 *
 * ⚠⚠ **고친 것은 «그 채널 손님 전부»에게 보인다.** 내 화면만 바뀌는 것이 아니다 —
 *   저장은 원장 한 줄이고, 그 채널에 들어오는 다음 사람은 고쳐진 줄을 본다.
 *   그래서 「내 취향」이 아니라 «이 가게가 무엇을 파는가»를 적는 자리다(화면이 그렇게 말한다).
 *
 * ★그래도 셋은 남는다 — 문을 «연» 것이지 «없앤» 것이 아니다.
 *   ㉠ **우리 채널만**(`knownChannel`) — 아무 글자나 받아 원장에 줄을 늘리지 않는다.
 *   ㉡ **우리 축만**(`sanitizeQuick`) — 모르는 축·중복은 버리고, 스물에서 끊는다.
 *   ㉢ **누가 언제 고쳤나**(`updated_by`·`updated_at`) — 빗장을 푼 대신 기록으로 답한다.
 *      로그인하고 고쳤으면 그 사람의 uid 가, 손님이면 `guest` 가 남는다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 우리 채널이 맞나 — 아무 글자나 받아 원장에 줄을 늘리지 않는다. */
const knownChannel = (key: string) => WHITELABELS.some((w) => w.key === key);

export async function GET(request: Request) {
  const wl = S(new URL(request.url).searchParams.get('wl'));
  if (!wl) return NextResponse.json({ error: '채널이 없습니다' }, { status: 400 });
  /*
   * 읽기는 «누구나»다 — 손님 화면이 그리는 값이라 로그인 뒤에 바뀌면 안 된다.
   * (무엇을 파는지는 어차피 화면에 다 보인다. 감출 것은 여기 없다.)
   */
  const quick = await readShopQuick(wl);
  return NextResponse.json({ quick });
}

export async function PUT(request: Request) {
  let body: { wl?: unknown; quick?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: '본문을 못 읽었습니다' }, { status: 400 }); }

  const wl = S(body.wl);
  if (!wl) return NextResponse.json({ error: '채널이 없습니다' }, { status: 400 });
  if (!knownChannel(wl)) return NextResponse.json({ error: '없는 채널입니다' }, { status: 404 });

  /*
   * ★**막으려고 보는 것이 아니라 «적으려고» 본다.** 토큰이 있으면 누구인지 남기고,
   *   없으면 손님으로 남긴다 — 어느 쪽이든 **거절하지 않는다**(위 머리말).
   * ⚠ 그래서 실패해도 그냥 넘어간다. 여기서 던지면 「기록을 못 남겨서 못 고친다」가 되는데,
   *   그건 사장님이 여신 문을 기록이 다시 닫는 꼴이다.
   */
  let who = 'guest';
  try {
    const active = await verifyActiveBearer(request);
    if (active) who = S(active.uid) || 'guest';
  } catch { /* 손님으로 둔다 */ }

  /*
   * ★여기서도 «걸러서» 넣는다 — 화면이 이미 있는 값만 내놓지만, 문은 화면을 안 믿는다.
   *   축 이름이 우리 축이 아니면 버린다(`sanitizeQuick`).
   * ⚠ **「재고에 몇 대인가」는 여기서 안 본다.** 그건 지금 목록을 세어야 아는 값이라
   *   문이 판정하면 «그 순간의 재고»가 규격이 되어 버린다. 그리는 쪽이 건수 0 을 안 그린다.
   */
  const saved = await writeShopQuick(wl, sanitizeQuick(body.quick), who);
  return NextResponse.json({ quick: saved });
}
