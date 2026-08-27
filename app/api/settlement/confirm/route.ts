/**
 * **실적 확인 — 청구 앞에 놓인 문.**
 *
 * ★사장님 2026-08-26 「영업자한테 실적 먼저 확인하고 그게 ㅇㅋ 되면 공급사에 청구
 *   거기서 한번 걸러지는구조야」.
 *
 * ```
 * GET   내 확인 상태(영업자·공급사) / 관리자는 그 달 «전부»
 * POST  확인하거나 이의를 건다 — 본인이 누르거나, 우리가 «대신 적는다»
 * ```
 * ★★**원래는 본인만이었다.** 대신 눌러 줄 수 있으면 그 문은 문이 아니다 —
 *   막히면 사람에게 연락해서 풀라는 뜻이었다.
 *
 * ★★★**2026-08-27 에 «대리 적기»를 열었다.** 사장님
 *   「erp화면에서 일단 계정없어도 그냥 우리가 메모하는거로 쓸거라니까」
 *   「영업채널 파트너사로만 만들어두면 돼」.
 *   영업채널 사람들이 아직 계정을 안 만들었는데, 그동안 청구 11장 4,424만원이 멈춰 있었다.
 *   ⇒ 전화·카톡으로 받아서 **우리가 적는다.** 다만 셋을 지킨다 —
 * ```
 * ① «대신 적었다»고 남긴다     proxy:true · proxyBy(적은 사람 이름)
 * ② 근거를 반드시 받는다        note 가 비면 안 받는다
 * ③ 아무 이름이나 못 적는다      그 달 원장에 «청구 줄이 있는» 영업채널만
 * ```
 *   ⚠ ③이 없으면 오타 하나로 «없는 채널»의 확인이 생긴다. 그건 아무 문도 안 열면서
 *     기록만 더럽힌다 — 「확인했는데 왜 막히지」로 하루를 버리게 된다.
 *   ⚠ 영업자가 나중에 로그인하면 「대신 적음」이 보인다. 틀렸으면 이의를 걸 수 있어야 한다.
 * ★확인 시점의 «건수»를 같이 박는다. 뒤에 건이 늘면 다시 확인을 받는다 —
 *   안 그러면 확인받은 3건에 몰래 2건이 붙어 5건이 청구된다.
 * ⚠ v4 overlay 에만 쓴다. v3 노드는 건드리지 않는다.
 */
import { NextResponse } from 'next/server';
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { ledgerError, readLedger, sheetsToken } from '@/lib/server/settlement-ledger-read';
import { listRows, storeError } from '@/lib/server/settlement-store';
import { billingMonth } from '@/lib/domain/settlement-stage';
import { nameKey, scopeRows, type Viewer } from '@/lib/domain/settlement-view';
import { confirmKey, type ConfirmState, type Confirmation } from '@/lib/domain/settlement-confirm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NODE = 'v4/settlement_confirmations';
const S = (v: unknown) => String(v ?? '').trim();


/**
 * **같은 사람의 계정을 모은다 — 전화번호로.**
 * ★실측 2026-08-26: 이하민·정동근·신선호가 각각 계정 둘인데 **전화번호가 같았다.**
 *   중복 계정이 아니라 같은 사람이 두 번 가입한 것이다. 합치는 건 사람이 정할 일이고,
 *   그때까지 실적이 막혀 있을 이유는 없다 — 어느 쪽으로 로그인해도 내 것이 보이게 한다.
 * ⚠ 전화번호가 없으면 «자기 코드 하나»뿐이다. 없는 것을 같다고 보지 않는다.
 */
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
async function siblingCodes(db: ReturnType<typeof getDatabase>, me: { user_code?: string; phone?: string }): Promise<string[]> {
  const mine = S(me.user_code);
  const ph = digits(me.phone);
  if (!ph || ph.length < 9) return mine ? [mine] : [];
  const all = ((await db.ref('users').get().catch(() => null))?.val() || {}) as Record<string, { user_code?: string; phone?: string; status?: string }>;
  const out = new Set(mine ? [mine] : []);
  for (const u of Object.values(all)) {
    const st = S(u?.status);
    if (st === 'deleted' || st === 'rejected') continue;
    if (digits(u?.phone) === ph && S(u?.user_code)) out.add(S(u.user_code));
  }
  return [...out];
}

/** 이 사람이 원장에서 불리는 이름 — 확인의 주체이자 열쇠. */
async function whoAmI(who: { uid: string; role: string; companyCode: string }): Promise<{ name: string; role: 'agent' | 'provider' | 'admin'; code: string; codes: string[]; channel: string }> {
  const db = getDatabase(firebaseAdminApp());
  if (who.role === 'provider') {
    const code = S(who.companyCode);
    if (!code) return { name: '', role: 'provider', code: '', codes: [], channel: '' };
    const [a, b] = await Promise.all([
      db.ref(`partners/${code}`).get().catch(() => null),
      db.ref(`v4/partners/${code}`).get().catch(() => null),
    ]);
    const p = (a?.val() || b?.val() || {}) as { name?: string; partner_name?: string; company_name?: string };
    return { name: S(p.name || p.partner_name || p.company_name), role: 'provider', code: '', codes: [], channel: '' };
  }
  const u = (await db.ref(`users/${who.uid}`).get().catch(() => null))?.val() as { name?: string; user_code?: string; company_name?: string; phone?: string } | null;
  return {
    // ★확인의 주체는 «채널»이다 — 청구서가 나가는 단위와 같아야 짝이 맞는다.
    //   채널이 없는 개인 영업자는 이름으로 버틴다(그 사람이 곧 상대다).
    name: S(u?.company_name) || S(u?.name),
    role: who.role === 'admin' ? 'admin' : 'agent',
    code: S(u?.user_code), codes: await siblingCodes(db, u || {}), channel: S(u?.company_name),
  };
}

/** 그 달 이 사람의 «청구가 서는» 건수. 확인은 이 수에 대고 하는 것이다. */
async function myLines(month: string, viewer: Viewer): Promise<number> {
  const token = await sheetsToken();
  if (!token) return -1;
  const read = await readLedger(token);
  const mine = scopeRows(read.map((x) => x.row), viewer);
  return mine.filter((r) => !r.cancelled && billingMonth(r) === month).length;
}

/**
 * **그 달 «청구 줄이 있는» 영업채널들과 각 건수.**
 *
 * ★관문(`providerBillGate`)이 세는 것과 **같은 축·같은 조건**이어야 한다.
 *   여기서 다르게 세면 확인을 적어 놓고도 「확인 뒤 건이 늘었다」로 도로 막힌다.
 * ★대리로 적을 수 있는 곳은 **여기 있는 이름까지**다 — 원장이 곧 명부다.
 * @returns 채널→건수. 원장을 못 읽으면 null
 */
async function channelsOfMonth(month: string): Promise<Map<string, { code: string; lines: number }> | null> {
  const read = await listRows();
  if (!read) return null;
  const out = new Map<string, { code: string; lines: number }>();
  for (const x of read) {
    if (x.row.cancelled || billingMonth(x.row) !== month) continue;
    const ch = S(x.extra.channel);
    if (!ch) continue;
    const got = out.get(ch);
    // ★코드는 «있는 것»을 남긴다. 같은 이름인데 어떤 줄만 코드가 차 있을 수 있다(백필 전).
    if (got) { got.lines += 1; if (!got.code) got.code = S(x.extra.channelCode); }
    else out.set(ch, { code: S(x.extra.channelCode), lines: 1 });
  }
  return out;
}

/**
 * **우리가 대신 적는다.** 관리자만 온다.
 * ★저장하는 이름은 «원장에 적힌 그대로»다. 파트너사 정식 상호로 바꿔 적으면 안 된다 —
 *   관문은 원장 이름으로 찾는다. 실측 2026-08-27: 원장 「SMC」 ↔ 파트너사 「에스엠씨(S.M.C)」
 *   는 이름 규칙으로 서로 안 붙는다. 정식 상호로 적으면 그 문은 안 열린다.
 */
async function writeProxy(
  bearer: { uid: string },
  body: { month: string; state: ConfirmState; who: string; note: string; disputed: string[] },
): Promise<NextResponse> {
  const { month, state, who, note } = body;
  if (!who) return NextResponse.json({ ok: false, reason: '어느 영업채널인지 골라 주세요.' }, { status: 400 });
  // ★근거 없는 대리 확인은 «남기지 않는다». 나중에 「누가 그랬냐」에 답할 수 없다.
  if (!note) {
    return NextResponse.json({ ok: false, reason: '어떻게 확인받았는지 적어 주세요(전화·카톡 등). 근거 없이는 대신 적지 않습니다.' }, { status: 400 });
  }

  const chans = await channelsOfMonth(month);
  if (!chans) return NextResponse.json({ ok: false, reason: storeError() || '원장을 못 읽었습니다.' }, { status: 503 });
  // ★원장에 있는 이름 그대로만 받는다. 오타는 «아무 문도 안 여는» 확인을 만든다.
  const hit = [...chans.keys()].find((c) => nameKey(c) === nameKey(who));
  if (!hit) {
    return NextResponse.json({
      ok: false,
      reason: `${month} 원장에 「${who}」로 청구가 서는 줄이 없습니다. 화면에 뜬 영업채널 중에서 고르세요.`,
    }, { status: 400 });
  }

  const db = getDatabase(firebaseAdminApp());
  const me = (await db.ref(`users/${bearer.uid}`).get().catch(() => null))?.val() as { name?: string } | null;
  const rec: Confirmation = {
    key: confirmKey(month, hit),
    month, who: hit, role: 'agent',
    state,
    // ★코드를 같이 박는다 — 이 확인이 다음부터 «코드로» 붙는다(사장님 2026-08-27).
    whoCode: chans.get(hit)?.code || '',
    lines: chans.get(hit)?.lines || 0,
    disputed: body.disputed.map(S).filter(Boolean).slice(0, 200),
    note: note.slice(0, 500),
    at: Date.now(),
    by: bearer.uid,
    proxy: true,
    proxyBy: S(me?.name) || '관리자',
  };
  if (state === '이의' && !rec.disputed.length && !rec.note) {
    return NextResponse.json({ ok: false, reason: '어느 건이 틀렸는지 고르거나 사유를 적어 주세요.' }, { status: 400 });
  }
  await db.ref(`${NODE}/${rec.key}`).set(rec);
  return NextResponse.json({ ok: true, ...rec });
}

export async function GET(req: Request) {
  const bearer = await verifyActiveBearer(req).catch(() => null);
  if (!bearer) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });

  const month = S(new URL(req.url).searchParams.get('month'));
  if (!month) return NextResponse.json({ ok: false, reason: '청구월을 지정해 주세요.' }, { status: 400 });

  const db = getDatabase(firebaseAdminApp());
  const all = ((await db.ref(NODE).get().catch(() => null))?.val() || {}) as Record<string, Confirmation>;
  const ofMonth = Object.values(all).filter((c) => c.month === month);

  // 관리자는 그 달 전부를 본다 — 「누가 아직 확인 안 했나」가 청구의 관문이다.
  if (bearer.role === 'admin') return NextResponse.json({ ok: true, role: 'admin', month, list: ofMonth });

  const me = await whoAmI(bearer);
  if (!me.name) return NextResponse.json({ ok: true, role: me.role, month, mine: null, note: '이 계정의 이름을 찾지 못했습니다.' });
  const key = nameKey(me.name);
  return NextResponse.json({
    ok: true, role: me.role, month, whoami: me.name,
    mine: ofMonth.find((c) => nameKey(c.who) === key) || null,
  });
}

export async function POST(req: Request) {
  const bearer = await verifyActiveBearer(req).catch(() => null);
  if (!bearer) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as {
    month?: string; state?: string; disputed?: string[]; note?: string; who?: string; proxy?: boolean;
  };
  const month = S(body.month);
  const state = (S(body.state) === '이의' ? '이의' : '확인') as ConfirmState;
  if (!month) return NextResponse.json({ ok: false, reason: '청구월을 지정해 주세요.' }, { status: 400 });

  /**
   * ★관리자는 **«대신 적는다»고 말할 때만** 쓸 수 있다.
   *   `proxy` 를 안 붙이고 온 관리자 요청은 여전히 막는다 — 본인 확인인 척하는 길을 안 남긴다.
   */
  if (bearer.role === 'admin') {
    if (!body.proxy) {
      return NextResponse.json({ ok: false, reason: '실적 확인은 본인이 합니다. 대신 적으려면 「대신 적기」로 근거와 함께 남기세요.' }, { status: 403 });
    }
    return writeProxy(bearer, { month, state, who: S(body.who), note: S(body.note), disputed: body.disputed || [] });
  }

  const me = await whoAmI(bearer);
  if (!me.name || me.role === 'admin') {
    return NextResponse.json({ ok: false, reason: '이 계정의 이름을 찾지 못했습니다. 관리자에게 확인을 요청하세요.' }, { status: 400 });
  }

  const viewer: Viewer = me.role === 'provider'
    ? { role: 'provider', supplier: me.name, agent: '' }
    // ★코드가 있으면 코드로 자기 줄을 찾는다. 이름은 겹쳐도 코드는 안 겹친다.
    : { role: 'agent', supplier: '', agent: me.name, agentCode: me.code, agentCodes: me.codes, channel: me.channel };
  const lines = await myLines(month, viewer);
  if (lines < 0) return NextResponse.json({ ok: false, reason: ledgerError() || '원장을 못 읽었습니다.' }, { status: 503 });

  const rec: Confirmation = {
    key: confirmKey(month, me.name),
    month, who: me.name, role: me.role,
    state,
    lines,
    disputed: (body.disputed || []).map(S).filter(Boolean).slice(0, 200),
    note: S(body.note).slice(0, 500),
    at: Date.now(),
    by: bearer.uid,
  };
  // 이의인데 무엇이 틀렸는지 안 적으면 관리자가 풀 방법이 없다.
  if (state === '이의' && !rec.disputed.length && !rec.note) {
    return NextResponse.json({ ok: false, reason: '어느 건이 틀렸는지 고르거나 사유를 적어 주세요.' }, { status: 400 });
  }

  await getDatabase(firebaseAdminApp()).ref(`${NODE}/${rec.key}`).set(rec);
  return NextResponse.json({ ok: true, ...rec });
}
