/**
 * **정산 콕핏의 문 — 보는 것(GET)과 남기는 것(POST).** 관리자만.
 *
 * ★★★사장님 2026-09-09
 *   「이거 정산만 따로 견적기처럼 페이지 만들어 줄 수 있나??」·「관리자가 볼 거야」
 *   「이제 관리자한테 **시트 기준으로 하지 말고 쉽게 남기게끔** 하는 거야」
 *   「**핸드폰에서** 할 수 있게 탭이나 이런 거에서 **간단하게 접수**하고 그거 **몇 월 청구인지 기재**하고」
 *   「니가 계산서 발행까지 해낸 거잖아」
 *
 * ★★**사슬에서 시트가 남은 곳은 「접수」 하나뿐이다.**
 * ```
 *   접수  →  원장(F04)  →  원자  →  정산서  →  계산서(T01)  →  홈택스 거두기
 *    ↑ 여기만 시트였다        └────────── 나머지는 전부 도구가 한다 ──────────┘
 * ```
 *   ⇒ 접수를 폰에서 받으면 시트를 안 열어도 된다. **원자가 처음부터 정본**이 된다.
 *
 * ★★★**역할은 서버가 판정한다.** 클라이언트가 보내온 role 을 믿으면 자물쇠가 아니라 손잡이다.
 *   관리자만이다 — 정산에는 «영업자에게 줄 돈»과 «공급사에서 받을 돈»이 한 화면에 있고,
 *   그 둘은 서로에게 보이면 안 되는 값이다(사장님 「절대 영업자 지급 수수료가
 *   공급사 시트에는 반영되면 안 돼」). 한쪽만 보여 주는 화면은 나중에 따로 짓는다.
 *
 * ⚠ **돈은 셈하지 않는다 — 엔진에게 묻는다**(`claimOf`·`payOf`·`invoiceMoneyOf`).
 *   여기서 손으로 곱하면 그 순간 정본이 둘이 된다(2026-09-09 부가세 1원 사고).
 */
import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  claimOf, payOf, invoiceMoneyOf, shapeAtom, atomField,
  type SettlementRow,
} from '@/lib/domain/settlement/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const YM = /^\d{4}-\d{2}$/;

/** 관리자인가 — 아니면 아무것도 안 준다. 「모르면 닫는다」가 기본값이다. */
async function admin(req: Request) {
  const who = await verifyActiveBearer(req).catch(() => null);
  return who && who.role === 'admin' ? who : null;
}
const db = () => { firebaseAdminApp(); return getFirestore(); };

type Row = Record<string, unknown>;
const alive = (r: Row) => r.cancelled !== true;

/* ══════════════════════════════════════════════════════════════════
   GET — 그 달을 한 화면에
   ══════════════════════════════════════════════════════════════════ */
export async function GET(req: Request) {
  const who = await admin(req);
  if (!who) return NextResponse.json({ error: '관리자만 봅니다' }, { status: 403 });
  const url = new URL(req.url);
  const month = YM.test(S(url.searchParams.get('month'))) ? S(url.searchParams.get('month')) : '';
  const q = S(url.searchParams.get('q'));

  const fs = db();
  const all = (await fs.collection('settlement_rows').get()).docs.map((d) => ({ id: d.id, ...d.data() })) as (Row & { id: string })[];
  const claws = (await fs.collection('settlement_clawbacks').get()).docs.map((d) => d.data() as Row);

  /** 달 목록 — 화면이 고르게. 원자에 있는 달만 준다(없는 달을 고르게 하면 빈 화면이 뜬다). */
  const months = [...new Set(all.filter(alive).map((r) => S(r.billMonth)).filter(Boolean))].sort().reverse();
  const M = month || months[0] || '';

  const mine = all.filter((r) => alive(r) && S(r.billMonth) === M);
  const claw = claws.filter((c) => S(c.month) === M);
  const clawSup = claw.reduce((a, c) => a + N(c.supplierAmt), 0);
  const clawCh = claw.reduce((a, c) => a + N(c.channelAmt), 0);

  const sum = mine.reduce((a, r) => ({
    claim: a.claim + claimOf(r as unknown as SettlementRow),
    pay: a.pay + payOf(r as unknown as SettlementRow),
  }), { claim: 0, pay: 0 });

  /** 상대별 — 공급사(받는다) · 영업채널(준다). 한 화면에 나란히 두되 «축은 섞지 않는다». */
  const by = (key: 'supplier' | 'channel', money: (r: Row) => number) => {
    const m = new Map<string, { name: string; n: number; won: number; issued: boolean }>();
    for (const r of mine) {
      const k = S(r[key]); if (!k) continue;
      const e = m.get(k) || { name: k, n: 0, won: 0, issued: true };
      e.n++; e.won += money(r);
      if (key === 'supplier' && r.invoiceIssued !== true && invoiceMoneyOf(r as never).total !== 0) e.issued = false;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.won - a.won);
  };

  /** 「넘길 것」 — 돈이 붙은 이월. 이 달 표에는 안 나오는데 다음 달에 반드시 해야 하는 일. */
  const carry = all.filter((r) => alive(r) && (N(r.carryClaim) || N(r.carryPay) || N(r.prepaid) || S(r.carryNote)))
    .map((r) => ({
      id: r.id, plate: S(r.plate), customer: S(r.customer), supplier: S(r.supplier),
      month: S(r.billMonth), to: S(r.carryMonth), claim: N(r.carryClaim), pay: N(r.carryPay),
      prepaid: N(r.prepaid), note: S(r.carryNote),
    }));

  /** 찾기 — 차번·이름·상대. 물으면 그 줄을 통째로 준다(터미널 `settlement:ask` 와 같은 결). */
  const P = (v: unknown) => S(v).replace(/\s/g, '');
  const found = q ? all.filter((r) => alive(r) && [r.plate, r.customer, r.supplier, r.channel, r.agent]
    .some((v) => P(v).includes(P(q)))).slice(0, 40) : [];

  const shape = (r: Row & { id: string }) => ({
    id: r.id, code: S(r.code), plate: S(r.plate), customer: S(r.customer),
    supplier: S(r.supplier), channel: S(r.channel), agent: S(r.agent),
    product: S(r.product), billMonth: S(r.billMonth), receivedAt: S(r.receivedAt), deliveredAt: S(r.deliveredAt),
    claim: claimOf(r as unknown as SettlementRow), pay: payOf(r as unknown as SettlementRow),
    stage: S(r.stage), claimStage: S(r.claimStage), payStage: S(r.payStage),
    invoiceIssued: r.invoiceIssued === true, invoiceAt: S(r.invoiceAt),
    note: S(r.settleNote) || S(r.note), carryNote: S(r.carryNote),
  });

  return NextResponse.json({
    month: M, months,
    sum: { ...sum, clawSup, clawCh, net: sum.claim - clawSup - (sum.pay - clawCh), rows: mine.length },
    suppliers: by('supplier', (r) => claimOf(r as unknown as SettlementRow)),
    channels: by('channel', (r) => payOf(r as unknown as SettlementRow)),
    carry, rows: mine.map(shape), found: found.map(shape),
  });
}

/* ══════════════════════════════════════════════════════════════════
   POST — 남긴다 (접수 한 건 · 줄 하나 고치기)
   ══════════════════════════════════════════════════════════════════ */

/**
 * ★**손으로 적는 칸만 받는다.** 원자 규격(`atomField`)에 없는 이름은 통째로 물리친다 —
 *   화면이 밭을 새로 지어내면 그 줄은 검사도 통과하고 조용히 썩는다.
 * ⚠ 「받았다·줬다」(collected·paid)는 **여기서 못 쓴다.** 통장을 봐야 아는 것이라
 *   화면에서 켜면 거짓말이 된다(사장님 「수금은 별도로 관리할게」).
 */
const CAN_WRITE = new Set([
  'plate', 'customer', 'supplier', 'channel', 'agent', 'product', 'term', 'rent', 'deposit', 'price',
  'payKind', 'model', 'receivedAt', 'deliveredAt', 'billMonth',
  'claimWritten', 'payWritten', 'claimIncentive', 'payIncentive',
  'settleTarget', 'settleRatio', 'settleExclude', 'billHold', 'settleNote', 'note',
  'carryNote', 'carryMonth', 'carryClaim', 'carryPay', 'prepaid',
]);
const NEVER = new Set(['collected', 'collectedAt', 'collectedAmt', 'paid', 'paidAt', 'paidAmt']);

export async function POST(req: Request) {
  const who = await admin(req);
  if (!who) return NextResponse.json({ error: '관리자만 씁니다' }, { status: 403 });
  const body = await req.json().catch(() => null) as { id?: string; patch?: Record<string, unknown> } | null;
  const patch = body?.patch;
  if (!patch || typeof patch !== 'object') return NextResponse.json({ error: '남길 것이 없습니다' }, { status: 400 });

  /** 쓰기 전 규격 검증 — 이름·형이 원자 규격과 같아야 한다. */
  const wrong: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (NEVER.has(k)) { wrong.push(`「${k}」 는 통장을 봐야 아는 칸이라 화면에서 못 씁니다`); continue; }
    if (!CAN_WRITE.has(k)) { wrong.push(`「${k}」 는 손으로 적는 칸이 아닙니다`); continue; }
    const f = atomField(k);
    const want = f?.type === 'number' ? 'number' : f?.type === 'boolean' ? 'boolean' : 'string';
    if (typeof v !== want) wrong.push(`「${k}」 는 ${f?.type} 인데 ${typeof v} 를 넣으려 합니다`);
  }
  if (wrong.length) return NextResponse.json({ error: wrong.join(' · ') }, { status: 400 });
  if (S(patch.billMonth) && !YM.test(S(patch.billMonth))) {
    return NextResponse.json({ error: '청구월은 2026-09 꼴이어야 합니다' }, { status: 400 });
  }

  const fs = db();
  const col = fs.collection('settlement_rows');

  /* ── 고치기 ─────────────────────────────────────────────── */
  if (S(body?.id)) {
    const ref = col.doc(S(body?.id));
    if (!(await ref.get()).exists) return NextResponse.json({ error: '그 줄이 없습니다' }, { status: 404 });
    await ref.set({ ...patch, updatedAt: Date.now() }, { merge: true });
    const back = (await ref.get()).data() || {};
    const gap = Object.entries(patch).filter(([k, v]) => S(back[k]) !== S(v)).map(([k]) => k);
    if (gap.length) return NextResponse.json({ error: `되읽으니 다릅니다 — ${gap.join(' · ')}` }, { status: 500 });
    return NextResponse.json({ ok: true, id: ref.id, mode: '고침' });
  }

  /* ── 접수 (새 줄) ───────────────────────────────────────── */
  if (!S(patch.plate) && !S(patch.customer)) {
    return NextResponse.json({ error: '차량번호나 고객명 하나는 있어야 합니다' }, { status: 400 });
  }
  /**
   * ★**열쇠는 «내용»으로 만든다** — 자리(줄 번호)로 만들면 위에 한 줄만 끼어도 깨진다
   *   (2026-09-02 최사랑 업무지원비가 두 줄로 섰던 사고). 원자화가 쓰는 열쇠와 같은 결이다.
   */
  const key = `${S(patch.plate).replace(/\s/g, '') || '무차번'}|${S(patch.receivedAt)}|${S(patch.customer)}`;
  const code = `stl_${Math.abs([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)}`;
  const ref = col.doc(code);
  if ((await ref.get()).exists) {
    return NextResponse.json({ error: '같은 차·같은 접수일·같은 고객이 이미 있습니다', id: code }, { status: 409 });
  }
  /** ★규격을 통과시킨다 — 모든 밭이 제 자리에 서고, 안 적은 칸은 「비었다」로 채워진다. */
  const atom = shapeAtom({
    ...patch, code,
    /** 폰에서 접수한 줄임을 남긴다 — 나중에 「이건 어디서 왔나」를 물을 수 있어야 한다. */
    fromSheet: '폰 접수', sourceTab: '폰 접수',
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  await ref.set(atom);
  const back = (await ref.get()).data() || {};
  if (S(back.code) !== code) return NextResponse.json({ error: '되읽으니 안 들어갔습니다' }, { status: 500 });
  return NextResponse.json({ ok: true, id: code, mode: '접수' });
}
