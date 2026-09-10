/**
 * **내 정산서 — 공급사·영업채널이 «제 것만» 보는 문.** 읽기 GET · 확인/정정 POST.
 *
 * ★★★사장님 2026-09-10 「이제 **채널에 링크로 보내서 확인**하라고 할 거야 **pdf 안 주고**」
 *   그리고 「이제 SSOT 로 이거는 넘어가서 **ERP 로만 처리**하려고 하니까」
 *   설계 = `docs/정산-ERP전환-2026-09.md`
 *
 * ── 무엇이 다른가 (`/api/settlement/mine` 과 «다른 물건»이다)
 *   `mine`      계약이 어떻게 되나 — **돈을 한 칸도 안 싣는다**(`PublicRow`)
 *   여기        이번 달 얼마 — **돈을 싣는다.** 그래서 문을 갈랐다.
 *   ⚠ 돈 없는 꼴과 돈 있는 꼴을 한 라우트에 섞으면 언젠가 샌다.
 *
 * ── ★★절대 규칙 — «화면에서 가리는» 게 아니라 «서버가 안 싣는다»
 * ```
 *   공급사가 받는 것   청구액 ○   지급액 ✕   영업채널·영업담당자 ✕
 *   채널이  받는 것   청구액 ✕   지급액 ○   공급사 ○
 * ```
 *   사장님 「절대 영업자 지급 수수료가 얼만지 공급사시트에는 반영되면 안 돼」.
 *   **타입에 칸이 없으면 개발자도구로도 못 본다.** 그게 잠금이다(`publicRowOf` 가 쓰는 그 수법).
 *
 * ── ★«누구인가»는 이름이 아니라 코드로 맞춘다
 *   토큰에 `companyCode`(공급사)·`agentChannelCode`(채널)가 들어 있고,
 *   원자에 `supplierCode`·`channelCode` 를 채워 뒀다(`scripts/backfill-party-codes.mts`).
 *   ⚠ 이름으로 맞추면 「웰릭스/웰릭스모빌리티」처럼 줄여 적힌 것 때문에 **남의 정산이 보인다.**
 *   ⚠ 코드가 «비어 있는» 원자는 아무에게도 안 보인다 — 그게 맞다. 짐작으로 보여 주지 않는다.
 *
 * ── ★수금·지급 «실행»은 안 싣는다
 *   통장을 봐야 아는 것이라 화면에 띄우면 거짓말이 된다(사장님 「수금은 별도로 관리할게」).
 */
import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { claimOf, payOf, invoiceMoneyOf, type SettlementRow } from '@/lib/domain/settlement/engine';
import { isAtomMonth } from '@/lib/domain/settlement-atom';
import { bizOfSettlementKey } from '@/lib/domain/settlement-link';
import { PARTNER_CI } from '@/lib/domain/partner-ci';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
/** ★이름 있는 앱을 넘겨야 한다 — 맨손 `getFirestore()` 는 기본 앱을 찾다가 500 이 난다. */
const db = () => getFirestore(firebaseAdminApp());

type Row = Record<string, unknown>;

/**
 * 공급사가 받는 한 줄. **여기 없는 칸은 «나가지 않는다».**
 * ⚠ 칸을 더할 때는 「이 사람이 이걸 봐도 되나」를 먼저 묻는다.
 */
type SupplierRow = {
  id: string; plate: string; model: string; customer: string; product: string;
  term: number; rent: number; deposit: number; price: number; payKind: string;
  receivedAt: string; deliveredAt: string; billMonth: string;
  /** 우리가 «청구»하는 몫 — 공급사가 볼 것 */
  net: number; vat: number; total: number;
  basis: string;
  /** 상대가 적는 넉 칸 */
  ok: boolean; fix: boolean; fixAmt: number; memo: string;
  /** 계산서가 나갔나 — 「왜 아직 안 왔냐」를 묻지 않아도 되게 */
  invoiceIssued: boolean; invoiceAt: string;
};

/** 영업채널이 받는 한 줄. 공급사는 보이고 «청구액»은 안 보인다. */
type ChannelRow = Omit<SupplierRow, 'net' | 'vat' | 'total'> & {
  supplier: string; agent: string;
  /** 우리가 «지급»하는 몫 */
  pay: number;
};

const 공급사줄 = (r: Row & { id: string }): SupplierRow => {
  const m = invoiceMoneyOf(r as never);
  return {
    id: r.id, plate: S(r.plate), model: S(r.model), customer: S(r.customer), product: S(r.product),
    term: N(r.term), rent: N(r.rent), deposit: N(r.deposit), price: N(r.price), payKind: S(r.payKind),
    receivedAt: S(r.receivedAt), deliveredAt: S(r.deliveredAt), billMonth: S(r.billMonth),
    net: m.net, vat: m.vat, total: m.total,
    basis: S(r.settleNote),
    ok: r.supplierOk === true, fix: r.supplierFix === true,
    fixAmt: N(r.supplierFixAmt), memo: S(r.supplierMemo),
    invoiceIssued: r.invoiceIssued === true, invoiceAt: S(r.invoiceAt),
  };
};

const 채널줄 = (r: Row & { id: string }): ChannelRow => {
  const s = 공급사줄(r);
  const { net: _n, vat: _v, total: _t, ...남은 } = s;
  return {
    ...남은,
    supplier: S(r.supplier), agent: S(r.agent),
    pay: payOf(r as unknown as SettlementRow),
    ok: r.channelOk === true, fix: r.channelFix === true,
    fixAmt: N(r.channelFixAmt), memo: S(r.channelMemo),
  };
};

/** 그 사람이 볼 수 있는 줄만. ⚠ 코드가 안 맞으면 «0줄»이다 — 전부로 넘어가지 않는다. */
function 내것(rows: (Row & { id: string })[], who: { role: string; companyCode: string; agentChannelCode: string }) {
  if (who.role === 'provider') {
    const code = S(who.companyCode);
    return code ? rows.filter((r) => S(r.supplierCode) === code) : [];
  }
  if (who.role === 'agent') {
    const code = S(who.agentChannelCode);
    return code ? rows.filter((r) => S(r.channelCode) === code) : [];
  }
  return [];
}

/**
 * ★★**링크로 여는 길** — 사장님 2026-09-10 「각각 사업자번호 누르면 그 링크가 열리는 거지」.
 *
 *   열쇠(24자리)는 «사업자번호 + 서버 소금»으로 만든 것이라 되돌릴 수 없다.
 *   ⇒ 우리가 아는 거래처(PARTNER_CI) 번호를 하나씩 만들어 보고 같은 것을 찾는다.
 *   ★그래서 **모르는 번호로는 아무 링크도 안 열린다.**
 * ⚠ 열쇠로 열면 «그 사업자번호의 것»만 나온다 — 로그인 여부와 무관하다.
 */
function 열쇠로(key: string) {
  const biz = bizOfSettlementKey(key, PARTNER_CI.map((c) => c.bizNo));
  if (!biz) return null;
  const ci = PARTNER_CI.find((c) => S(c.bizNo).replace(/\D/g, '') === biz);
  if (!ci?.code) return null;
  /** 코드 앞머리가 갈래를 말한다 — SP=영업채널, 그 밖(RP·PT)=공급사. */
  const 공급사인가 = !S(ci.code).startsWith('SP');
  return {
    role: (공급사인가 ? 'provider' : 'agent') as 'provider' | 'agent',
    companyCode: 공급사인가 ? S(ci.code) : '',
    agentChannelCode: 공급사인가 ? '' : S(ci.code),
    biz, name: S(ci.legal) || S(ci.alias),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = S(url.searchParams.get('month'));
  const key = S(url.searchParams.get('key'));

  /** 링크로 왔으면 로그인을 안 묻는다. 아니면 로그인한 사람의 것을 준다. */
  const 손님 = key ? 열쇠로(key) : null;
  const who = 손님 || await verifyActiveBearer(req).catch(() => null);
  if (!who) {
    return NextResponse.json({ ok: false, reason: key ? '링크가 맞지 않습니다.' : '로그인이 필요합니다.' }, { status: key ? 404 : 401 });
  }
  if (who.role !== 'provider' && who.role !== 'agent') {
    return NextResponse.json({ ok: false, reason: '공급사·영업채널만 볼 수 있는 화면입니다.' }, { status: 403 });
  }

  const all = (await db().collection('settlement_rows').get()).docs
    .map((d) => ({ id: d.id, ...(d.data() as Row) } as Row & { id: string }))
    .filter((r) => r.cancelled !== true && S(r.billMonth) && isAtomMonth(S(r.billMonth)));

  const mine = 내것(all, who);
  /** 달 목록 — 내 줄이 있는 달만. 없는 달을 고르게 하면 빈 화면이 뜬다. */
  const months = [...new Set(mine.map((r) => S(r.billMonth)))].sort().reverse();
  const M = month && months.includes(month) ? month : (months[0] || '');
  const 그달 = mine.filter((r) => S(r.billMonth) === M);

  const 공급사인가 = who.role === 'provider';
  const rows = 공급사인가 ? 그달.map(공급사줄) : 그달.map(채널줄);

  /** 환수 — 그 달 내 것만. 마이너스로 붙는다. */
  const claws = (await db().collection('settlement_clawbacks').get()).docs.map((d) => d.data() as Row)
    .filter((c) => S(c.month) === M)
    .filter((c) => (공급사인가 ? S(c.supplierCode || '') === S(who.companyCode) || S(c.supplier) : true));

  const 합 = 공급사인가
    ? {
      net: (rows as SupplierRow[]).reduce((a, r) => a + r.net, 0),
      vat: (rows as SupplierRow[]).reduce((a, r) => a + r.vat, 0),
      total: (rows as SupplierRow[]).reduce((a, r) => a + r.total, 0),
      claw: claws.reduce((a, c) => a + N(c.supplierAmt), 0),
    }
    : {
      pay: (rows as ChannelRow[]).reduce((a, r) => a + r.pay, 0),
      claw: claws.reduce((a, c) => a + N(c.agentAmt), 0),
    };

  return NextResponse.json({
    ok: true,
    role: who.role,
    axis: 공급사인가 ? '공급사' : '영업채널',
    month: M, months,
    /** 누구로 보이는지 — 「내 것이 맞나」를 상대가 스스로 확인한다. */
    whoami: (손님?.name) || (공급사인가 ? S(그달[0]?.supplier) : S(그달[0]?.channel)),
    count: rows.length,
    rows,
    sum: 합,
    /** 환수는 «건별»로 보여 준다 — 합계만 주면 「이게 뭐냐」를 묻게 된다. */
    claws: claws.map((c) => ({
      plate: S(c.plate), model: S(c.model), at: S(c.at), reason: S(c.reason),
      amount: 공급사인가 ? N(c.supplierAmt) : N(c.agentAmt),
    })),
  });
}

/**
 * **확인·정정요청을 받는다.** ★상대가 적은 것은 «받아만» 둔다 — 우리 금액은 안 바뀐다.
 *   사장님 「덮지 말고 그거를 우리가 보고 우리 원장을 변경할지 검토해야 하는 거야」.
 */
const 공급사칸 = { ok: 'supplierOk', fix: 'supplierFix', fixAmt: 'supplierFixAmt', memo: 'supplierMemo' } as const;
const 채널칸 = { ok: 'channelOk', fix: 'channelFix', fixAmt: 'channelFixAmt', memo: 'channelMemo' } as const;

export async function POST(req: Request) {
  const key = S(new URL(req.url).searchParams.get('key'));
  const 손님 = key ? 열쇠로(key) : null;
  const who = 손님 || await verifyActiveBearer(req).catch(() => null);
  if (!who) return NextResponse.json({ ok: false, error: key ? '링크가 맞지 않습니다.' : '로그인이 필요합니다.' }, { status: key ? 404 : 401 });
  if (who.role !== 'provider' && who.role !== 'agent') {
    return NextResponse.json({ ok: false, error: '공급사·영업채널만 쓸 수 있습니다.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { id?: string; patch?: Record<string, unknown> };
  const id = S(body.id);
  if (!id) return NextResponse.json({ ok: false, error: '어느 줄인지 없습니다.' }, { status: 400 });

  const snap = await db().collection('settlement_rows').doc(id).get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: '없는 줄입니다.' }, { status: 404 });

  /** ★★내 줄이 맞는지 «서버가» 본다 — 화면이 보낸 id 를 그대로 믿으면 남의 줄을 고칠 수 있다. */
  const r = { id, ...(snap.data() as Row) };
  if (!내것([r], who).length) return NextResponse.json({ ok: false, error: '내 줄이 아닙니다.' }, { status: 403 });

  const 칸 = who.role === 'provider' ? 공급사칸 : 채널칸;
  const p = body.patch || {};
  const patch: Record<string, unknown> = {};
  /** ⚠ 여기 적은 넷 말고는 **아무것도 못 쓴다.** 금액·달·상태는 상대가 못 건드린다. */
  if ('ok' in p) patch[칸.ok] = p.ok === true;
  if ('fix' in p) patch[칸.fix] = p.fix === true;
  if ('fixAmt' in p) patch[칸.fixAmt] = N(p.fixAmt);
  if ('memo' in p) patch[칸.memo] = S(p.memo).slice(0, 500);
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: '적을 것이 없습니다.' }, { status: 400 });

  patch.updatedAt = Date.now();
  await db().collection('settlement_rows').doc(id).update(patch);
  return NextResponse.json({ ok: true });
}
