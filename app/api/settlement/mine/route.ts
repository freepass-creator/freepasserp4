/**
 * **계약·정산확인 — 한 화면이 쓰는 한 라우트.** 읽기만 한다.
 *
 * ★사장님 2026-08-26
 *   「관리자가 접수해서 계약진행확인이랑 정산확인할수 있는 페이지를 계약/정산확인 메뉴에
 *    페이지로 하나만 만들어서 범용적으로 확인할수 있게끔」
 *   「관리자가 정산관리에서 입력하는것이 계약진행, 정산확인에서 영업자공급사들이 볼수 있게끔」
 *   「대여료 기간 보증금같은것들만 확인하고 정산금액은 거기에서는 안보이게」
 *
 * 그래서 **입구는 하나, 담기는 것은 역할마다 다르다** —
 * ```
 * 관리자        원장 전부 + 금액(청구·지급·수익) + 고객연락처
 * 공급사        내 공급사 줄만.  금액 없음. 대여료·기간·보증금까지
 * 영업자        내 이름 줄만.    금액 없음. 대여료·기간·보증금까지
 * ```
 *
 * ★★**금액을 «안 그리는» 게 아니라 «안 싣는다».** 화면에서 가리면 개발자도구 한 번에 다 보인다.
 *   `publicRowOf` 가 칸을 손으로 옮겨 담고 `PublicRow` 타입에는 수수료 칸이 아예 없다. 그게 잠금이다.
 * ★★**못 알아보면 0줄이다.** 상호·이름을 못 맞추면 전부 보여 주는 쪽으로 기울지 않는다.
 * ★역할은 **서버가 판정한다.** 클라이언트가 보내온 role 을 믿으면 그건 자물쇠가 아니라 손잡이다.
 */
import { NextResponse } from 'next/server';
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { iso, ledgerError, ledgerUrl, readLedger, sheetsToken, type LedgerExtra } from '@/lib/server/settlement-ledger-read';
import { billingMonth, moneyOf, type SettlementRow } from '@/lib/domain/settlement-stage';
import { countsOf, publicRowOf, scopeRows, type AdminRow, type Viewer } from '@/lib/domain/settlement-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

/**
 * 원장은 코드가 아니라 «상호·사람 이름»으로 적혀 있다. 그래서 이름을 찾아 온다.
 * ★공급사는 **등록된 다른 상호도 같이** 들고 간다 — 원장이 「웰릭스」처럼 줄여 적혀 있어
 *   앞머리로 풀어야 하는데, 그 앞머리가 유일한지 보려면 나머지를 알아야 한다.
 */
async function viewerOf(who: { uid: string; role: 'agent' | 'provider' | 'admin'; companyCode: string }): Promise<Viewer> {
  const db = getDatabase(firebaseAdminApp());
  if (who.role !== 'provider') {
    const u = (await db.ref(`users/${who.uid}`).get().catch(() => null))?.val() as { name?: string; user_code?: string; company_name?: string; phone?: string } | null;
    // ★코드가 있으면 코드가 이긴다 — 원장에 이름만 있으면 동명이인을 못 가른다(사장님 2026-08-26).
    return {
      role: who.role, supplier: '', agent: S(u?.name),
      agentCode: S(u?.user_code), agentCodes: await siblingCodes(db, u || {}), channel: S(u?.company_name),
    };
  }
  const code = S(who.companyCode);
  if (!code) return { role: who.role, supplier: '', agent: '' };
  const nameOf = (p: unknown) => {
    const o = (p || {}) as { name?: string; partner_name?: string; company_name?: string };
    return S(o.name || o.partner_name || o.company_name);
  };
  const [mine, mineV4, all, allV4] = await Promise.all([
    db.ref(`partners/${code}`).get().catch(() => null),
    db.ref(`v4/partners/${code}`).get().catch(() => null),
    db.ref('partners').get().catch(() => null),
    db.ref('v4/partners').get().catch(() => null),
  ]);
  const rivals = [
    ...Object.values((all?.val() || {}) as Record<string, unknown>),
    ...Object.values((allV4?.val() || {}) as Record<string, unknown>),
  ].map(nameOf).filter(Boolean);
  return { role: who.role, supplier: nameOf(mine?.val() || mineV4?.val()), agent: '', rivals };
}

/** 관리자에게만 붙는 금액. ⚠ 이 함수는 «역할을 검증한 뒤»에만 부른다. */
function adminRowOf(r: SettlementRow, extra: LedgerExtra): AdminRow {
  const m = moneyOf(r);
  return {
    ...publicRowOf(r),
    claim: m.claim,
    pay: m.pay,
    net: m.net,
    billingMonth: billingMonth(r) || '',
    clawback: !!r.clawback,
    clawbackAt: iso(r.clawbackAt),
    clawbackAmount: r.clawbackAmount || 0,
    channel: extra.channel,
    phone: extra.phone,
  };
}

export async function GET(req: Request) {
  const who = await verifyActiveBearer(req).catch(() => null);
  if (!who) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });

  const token = await sheetsToken();
  if (!token) return NextResponse.json({ ok: false, reason: ledgerError() || '원장을 못 읽었습니다.' }, { status: 503 });

  const viewer = await viewerOf(who);
  // ⚠ 관리자가 아닌데 이름을 못 찾았다 — 여기서 «전부»로 넘어가면 남의 계약이 보인다. 0줄로 닫는다.
  if (who.role !== 'admin' && !viewer.supplier && !viewer.agent) {
    return NextResponse.json({
      ok: true, role: who.role, whoami: '', count: 0, rows: [], counts: countsOf([]),
      note: who.role === 'provider'
        ? '이 계정에 연결된 공급사 상호를 찾지 못했습니다. 관리자에게 회사 코드 확인을 요청하세요.'
        : '이 계정의 이름을 찾지 못했습니다. 관리자에게 확인을 요청하세요.',
    });
  }

  const read = await readLedger(token);
  const extraOf = new Map(read.map((x) => [x.row, x.extra] as const));
  const mine = scopeRows(read.map((x) => x.row), viewer);
  const rows = who.role === 'admin'
    ? mine.map((r) => adminRowOf(r, extraOf.get(r) || { phone: '', clawbackReason: '', supplierCode: '', channel: '', channelCode: '', contractNo: '', note: '' }))
    : mine.map((r) => publicRowOf(r));

  return NextResponse.json({
    ok: true,
    role: who.role,
    whoami: viewer.supplier || viewer.agent || '관리자',
    readAt: new Date().toISOString(),
    // 관리자만 시트로 건너갈 수 있다 — 시트엔 금액과 연락처가 다 있다.
    ledgerUrl: who.role === 'admin' ? ledgerUrl() : undefined,
    count: rows.length,
    counts: countsOf(rows),
    rows,
  });
}
