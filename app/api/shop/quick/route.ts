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
 * ★★**고치는 사람은 영업자·직원이다**(사장님 2026-09-10 확인 — 「영업자·직원이 채널별로」).
 *   손님은 이 문을 못 연다. 고친 것은 **그 채널에 들어오는 모든 손님**에게 보인다 —
 *   그래서 개인 취향이 아니라 «그 회사가 무엇을 파는가»를 적는 자리다.
 *
 * ⚠⚠ **공급사는 못 고친다.** 이 판은 여러 공급사의 차가 한데 서는 곳이라, 공급사가 채널의
 *   첫 줄을 정하면 제 차가 먼저 보이게 만들 수 있다. 정산의 「보안 빗장」과 같은 판단이다
 *   (상세 영업자 칸은 공급사에게 «제 차만» 열어 주는데, 여기는 열 «제 몫»이 없다).
 *
 * ⚠ **메뉴에서 숨기는 것만으로는 막은 게 아니다**(집 규격) — 화면이 단추를 안 그리는 것과
 *   별개로 이 문도 같은 명단으로 막는다.
 */

/** 고칠 수 있는 사람 — 영업자·관리자. */
const CAN_EDIT = new Set(['agent', 'admin']);

const S = (v: unknown) => String(v ?? '').trim();

/** 우리 채널이 맞나 — 아무 글자나 받아 원장에 줄을 늘리지 않는다. */
const channelOf = (key: string) => WHITELABELS.find((w) => w.key === key) ?? null;

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
  const active = await verifyActiveBearer(request);
  if (!active) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!CAN_EDIT.has(String(active.role))) {
    return NextResponse.json({ error: '고칠 수 있는 권한이 없습니다' }, { status: 403 });
  }

  let body: { wl?: unknown; quick?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: '본문을 못 읽었습니다' }, { status: 400 }); }

  const wl = S(body.wl);
  if (!wl) return NextResponse.json({ error: '채널이 없습니다' }, { status: 400 });
  const channel = channelOf(wl);
  if (!channel) return NextResponse.json({ error: '없는 채널입니다' }, { status: 404 });

  /*
   * ★★**영업자는 «제 채널»만 고친다**(`agentChannelCode`). 관리자는 전부.
   *   한 판에 채널이 여럿 서는데 남의 채널 첫 줄을 고칠 수 있으면, 그건 남의 가게 간판을
   *   바꾸는 것이다 — 상세 영업자 칸이 공급사에게 «제 차만» 여는 것과 같은 빗장이다.
   * ⚠ 맞대는 값은 **채널 표의 `ownerCompanyCode` ↔ 그 사람의 `company_code`** 다.
   *   우리 표 이름(`key`)도, `agent_channel_code` 도 아니다 — key 로 맞대면 어느 영업자도 제
   *   가게를 못 고치고(문은 늘 403 인데 화면은 단추를 그린다), 채널 코드로 맞대면 **같은 회사
   *   직원인데 사람마다 갈린다**(그 칸은 SP999 계열에서 사람 코드로 채워 둔 자리다).
   *   화면도 같은 값으로 판정한다(`ShopView`).
   * ⚠ 소속 채널이 «없는» 영업자, 주인이 «안 적힌» 가게는 못 고친다 — 「어느 채널 사람인지」나
   *   「누구 가게인지」를 모르면 열어 줄 수 없다. 그때는 관리자만 고친다.
   */
  if (active.role === 'agent') {
    const owner = S(channel.ownerCompanyCode);
    const mine = S(active.companyCode);
    if (!owner || !mine || owner !== mine) {
      return NextResponse.json({ error: '내 채널만 고칠 수 있습니다' }, { status: 403 });
    }
  }

  /*
   * ★여기서도 «걸러서» 넣는다 — 화면이 이미 있는 값만 내놓지만, 문은 화면을 안 믿는다.
   *   축 이름이 우리 축이 아니면 버린다(`sanitizeQuick`).
   * ⚠ **「재고에 몇 대인가」는 여기서 안 본다.** 그건 지금 목록을 세어야 아는 값이라
   *   문이 판정하면 «그 순간의 재고»가 규격이 되어 버린다. 그리는 쪽이 건수 0 을 안 그린다.
   */
  const saved = await writeShopQuick(wl, sanitizeQuick(body.quick), S(active.uid));
  return NextResponse.json({ quick: saved });
}
