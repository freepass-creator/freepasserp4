/**
 * **실적 확인 — 청구 앞에 놓인 문.**
 *
 * ★사장님 2026-08-26 「영업자한테 실적 먼저 확인하고 그게 ㅇㅋ 되면 공급사에 청구
 *   거기서 한번 걸러지는구조야」.
 *
 * ```
 * GET   내 확인 상태(영업자·공급사) / 관리자는 그 달 «전부»
 * POST  확인하거나 이의를 건다 — 본인만. 관리자는 대신 눌러 주지 않는다
 * ```
 * ★★**관리자가 대신 확인해 줄 수 없다.** 대신 눌러 줄 수 있으면 그 문은 문이 아니다.
 *   막히면 사람에게 연락해서 풀어야 한다 — 그게 이 문을 둔 이유다.
 * ★확인 시점의 «건수»를 같이 박는다. 뒤에 건이 늘면 다시 확인을 받는다 —
 *   안 그러면 확인받은 3건에 몰래 2건이 붙어 5건이 청구된다.
 * ⚠ v4 overlay 에만 쓴다. v3 노드는 건드리지 않는다.
 */
import { NextResponse } from 'next/server';
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { ledgerError, readLedger, sheetsToken } from '@/lib/server/settlement-ledger-read';
import { billingMonth } from '@/lib/domain/settlement-stage';
import { nameKey, scopeRows, type Viewer } from '@/lib/domain/settlement-view';
import { confirmKey, type ConfirmState, type Confirmation } from '@/lib/domain/settlement-confirm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NODE = 'v4/settlement_confirmations';
const S = (v: unknown) => String(v ?? '').trim();

/** 이 사람이 원장에서 불리는 이름 — 확인의 주체이자 열쇠. */
async function whoAmI(who: { uid: string; role: string; companyCode: string }): Promise<{ name: string; role: 'agent' | 'provider' | 'admin' }> {
  const db = getDatabase(firebaseAdminApp());
  if (who.role === 'provider') {
    const code = S(who.companyCode);
    if (!code) return { name: '', role: 'provider' };
    const [a, b] = await Promise.all([
      db.ref(`partners/${code}`).get().catch(() => null),
      db.ref(`v4/partners/${code}`).get().catch(() => null),
    ]);
    const p = (a?.val() || b?.val() || {}) as { name?: string; partner_name?: string; company_name?: string };
    return { name: S(p.name || p.partner_name || p.company_name), role: 'provider' };
  }
  const u = (await db.ref(`users/${who.uid}`).get().catch(() => null))?.val() as { name?: string } | null;
  return { name: S(u?.name), role: who.role === 'admin' ? 'admin' : 'agent' };
}

/** 그 달 이 사람의 «청구가 서는» 건수. 확인은 이 수에 대고 하는 것이다. */
async function myLines(month: string, viewer: Viewer): Promise<number> {
  const token = await sheetsToken();
  if (!token) return -1;
  const read = await readLedger(token);
  const mine = scopeRows(read.map((x) => x.row), viewer);
  return mine.filter((r) => !r.cancelled && billingMonth(r) === month).length;
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
  // ★관리자는 대신 눌러 주지 않는다. 대신 누를 수 있으면 그 문은 문이 아니다.
  if (bearer.role === 'admin') {
    return NextResponse.json({ ok: false, reason: '실적 확인은 영업자·공급사 본인만 할 수 있습니다.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { month?: string; state?: string; disputed?: string[]; note?: string };
  const month = S(body.month);
  const state = (S(body.state) === '이의' ? '이의' : '확인') as ConfirmState;
  if (!month) return NextResponse.json({ ok: false, reason: '청구월을 지정해 주세요.' }, { status: 400 });

  const me = await whoAmI(bearer);
  if (!me.name || me.role === 'admin') {
    return NextResponse.json({ ok: false, reason: '이 계정의 이름을 찾지 못했습니다. 관리자에게 확인을 요청하세요.' }, { status: 400 });
  }

  const viewer: Viewer = me.role === 'provider'
    ? { role: 'provider', supplier: me.name, agent: '' }
    : { role: 'agent', supplier: '', agent: me.name };
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
