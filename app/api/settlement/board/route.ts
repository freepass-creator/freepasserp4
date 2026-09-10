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
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { PERKS, hasPerk } from '@/lib/domain/product-filters';
import {
  claimOf, payOf, invoiceMoneyOf, shapeAtom, atomField,
  type SettlementRow,
} from '@/lib/domain/settlement/engine';
import {
  isValidBillingMonth,
  isValidSettlementDay,
  hasDeliveryContradiction,
  localSettlementDay,
  withDeliveryInvariant,
} from '@/lib/domain/settlement-intake';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;

/** 관리자인가 — 아니면 아무것도 안 준다. 「모르면 닫는다」가 기본값이다. */
async function admin(req: Request) {
  const who = await verifyActiveBearer(req).catch(() => null);
  return who && who.role === 'admin' ? who : null;
}
/**
 * ⚠⚠ **이름 있는 앱이라 «넘겨줘야» 한다.** `firebaseAdminApp()` 은 `APP_NAME` 으로 만든 앱을 주는데,
 *   `getFirestore()` 를 맨손으로 부르면 «기본 앱»을 찾다가 없어서 터진다 —
 *   2026-09-09 실측: 화면은 200 인데 API 만 500 이라 「안 나온다」로 보였다.
 */
const db = () => getFirestore(firebaseAdminApp());

type Row = Record<string, unknown>;
const alive = (r: Row) => r.cancelled !== true;

/* ══════════════════════════════════════════════════════════════════
   GET — 그 달을 한 화면에
   ══════════════════════════════════════════════════════════════════ */
export async function GET(req: Request) {
  const who = await admin(req);
  if (!who) return NextResponse.json({ error: '관리자만 봅니다' }, { status: 403 });
  const url = new URL(req.url);
  const month = isValidBillingMonth(url.searchParams.get('month')) ? S(url.searchParams.get('month')) : '';
  const q = S(url.searchParams.get('q'));

  const fs = db();

  /**
   * ★★★**차 한 대를 «원자에서» 끌어온다** — 사장님 2026-09-09
   *   「프리패스에 있는 원자를 쉽게 갖고 와서 쓸 수 있게끔 해 주면 되지. 만약에 번호가 없으면
   *    직접 입력이지만, 일단 프리패스 그 원자가 차량 정보에 다 있잖아 … 몇 개만 타닥 쓰면 딱 선택」
   *
   *   재고 원자(`products`)에 차번·제조사·모델·세부모델·트림·공급사·상품구분·연식과
   *   **기간별 렌탈료·보증금**이 이미 다 있다. 접수에서 그걸 다시 «치게» 할 까닭이 없다.
   *   ⚠ 못 찾으면 «빈손»으로 돌려준다 — 지어내지 않는다. 그 차는 직접 적으면 된다.
   */
  const plateQ = S(url.searchParams.get('plate')).replace(/\s/g, '');
  if (plateQ) {
    const hit = (await fs.collection('products').where('car_number', '==', plateQ).limit(1).get()).docs[0];
    if (!hit) return NextResponse.json({ plate: plateQ, found: false });
    const v = hit.data() as Row;
    /** 모델명은 «사람이 읽는 한 줄»로 이어 붙인다 — 정산서 「모델명」 칸에 그대로 들어갈 말이다. */
    const model = [S(v.maker), S(v.model), S(v.sub_model), S(v.trim_name)]
      .filter((x, i, a) => x && a.indexOf(x) === i).join(' ');
    const price = (v.price || {}) as Record<string, { rent?: number; deposit?: number }>;
    /**
     * ★★★**원자를 «다» 준다** — 사장님 2026-09-10
     *   「정보는 현재 있는 원자들 **다 때려넣을 수 있어야** 되지. 상세에는 우리 상세 페이지를 활용해 봐
     *    … **사진도 있어야** 하고」
     *
     *   차 한 대를 물었으니 그 한 대는 통째로 준다 — 목록에는 못 싣는(무거운) 것들이 여기 온다:
     *   사진·VIN·배터리·구동·내장색·옵션·최초등록일·원산지·공급사 코드…
     *   ⚠ 우리 «내부» 표시는 뺀다(`_mirror_at` 같은 것) — 담당자가 볼 것이 아니다.
     */
    const SKIP = /^_|^검수상태$|^확정$|^원문$|^sheet_source|^source|^listable$|^reborncar/;
    const spec = Object.fromEntries(Object.entries(v)
      .filter(([k, x]) => !SKIP.test(k) && k !== 'price' && S(x) !== '')
      .map(([k, x]) => [k, S(x)]));
    return NextResponse.json({
      plate: plateQ, found: true, model, supplier: S(v.provider_name),
      product: S(v.product_type), year: S(v.year), status: S(v.vehicle_status) || S(v.status),
      photo: S(v.photo_link),
      /** 기간을 고르면 그 기간 요금이 따라오게 — 「12」·「24_2만」 같은 열쇠 그대로 준다. */
      price: Object.fromEntries(Object.entries(price).map(([k, o]) => [k, { rent: N(o?.rent), deposit: N(o?.deposit) }])),
      spec,
    });
  }

  /**
   * ★★★**접수 줄 하나를 통째로** — 사장님 2026-09-10 「구현해야 할 게 더 있을 건데 항목이」
   *
   *   시트(F04 접수)는 54칸이다. 목록에는 스물넷만 세웠다 — 더 세우면 목록이 아니라 시트가 된다.
   *   나머지는 «줄을 눌렀을 때» 여기서 통째로 준다. 차 한 대를 물으면 통째로 주는 것(?plate=)과 같은 수법이다.
   *
   * ⚠ **수금·지급 실행은 여기서도 뺀다** — 통장을 봐야 아는 것이라 화면에 띄우면 거짓말이 된다.
   * ⚠ 내부 표시(_로 시작하는 것)와 원천 자취는 담당자가 볼 것이 아니라 뺀다.
   */
  const lineQ = S(url.searchParams.get('line'));
  if (lineQ) {
    const hit = await fs.collection('settlement_rows').doc(lineQ).get();
    if (!hit.exists) return NextResponse.json({ id: lineQ, found: false });
    const v = hit.data() as Row;
    const SKIP_LINE = /^_|^collected|^paid/;
    /** ★이름표는 «원자 규격»이 준다 — 여기서 우리말을 다시 적으면 규격과 갈린다. */
    const spec = Object.entries(v)
      .filter(([k, x]) => !SKIP_LINE.test(k) && S(x) !== '' && x !== false)
      .map(([k, x]) => ({ key: k, label: atomField(k)?.label || k, value: S(x) }));
    return NextResponse.json({ id: lineQ, found: true, spec });
  }

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
    id: r.id, code: S(r.code), plate: S(r.plate), customer: S(r.customer), model: S(r.model),
    supplier: S(r.supplier), channel: S(r.channel), agent: S(r.agent),
    product: S(r.product), billMonth: S(r.billMonth), receivedAt: S(r.receivedAt), deliveredAt: S(r.deliveredAt),
    claim: claimOf(r as unknown as SettlementRow), pay: payOf(r as unknown as SettlementRow),
    stage: S(r.stage), claimStage: S(r.claimStage), payStage: S(r.payStage),
    invoiceIssued: r.invoiceIssued === true, invoiceAt: S(r.invoiceAt),
    note: S(r.settleNote) || S(r.note), carryNote: S(r.carryNote),
    payKind: S(r.payKind), term: N(r.term), rent: N(r.rent), ratio: N(r.settleRatio) || 1,
    /** ★접수 시트의 «체크 둘» — 담당자가 접수 뒤에 켠다. 계약서는 «썼나», 인도완료는 «나갔나». */
    paper: r.paper === true, delivered: r.delivered === true,
    carryClaim: N(r.carryClaim), carryPay: N(r.carryPay), prepaid: N(r.prepaid),
    /** ★넘길 달 — 분납의 «남은 회차»가 어느 달에 가는지. 실적 화면이 이걸로 모니터한다. */
    carryMonth: S(r.carryMonth),
    /**
     * ★★**접수 시트가 보이는 만큼 화면도 보인다** — 사장님 2026-09-10
     *   「접수목록 거기 더 짱짱하게 구현해줘봐 **시트 보고**」·「구현해야 할 게 더 있을 건데 항목이」
     *   시트(F04 접수 탭)는 54칸이다. 그 중 «접수 담당자가 보고 켜는» 것을 여기 싣는다.
     *   ⚠ 수금·지급 실행(collected·paid)은 **안 싣는다** — 통장을 봐야 아는 것이라
     *     화면에 띄우면 거짓말이 된다(사장님 「수금은 별도로 관리할게」).
     */
    deposit: N(r.deposit), cancelled: r.cancelled === true,
    billed: r.billed === true, billedAt: S(r.billedAt),
    intakeKind: S(r.intakeKind) || '영업수수료',
  });

  /**
   * ★★★**한 번 쓴 이름은 다음에 «치면 뜬다».**
   *   사장님 2026-09-09 「담당자 이름을 한 번 써서 저장이 되면, 다음에 「이」만 치면 「이」 자 쫙 뜨고,
   *   「이하」 쓰면 「이하루」 되는 사람 쭉 뜨고, 그런 식으로 입력을 되게 편하게 해 줘야 돼」
   *
   *   ⚠ **드롭다운으로 두지 않는다** — 공급사·채널·담당자가 수십이라 목록으로는 못 고른다.
   *     타자 치는 대로 좁혀지는 «자동완성»이라야 한다(자유 입력은 막지 않는다 — 새 이름도 받아야 하니까).
   *   ★목록은 **원자에서** 나온다. 따로 표를 만들지 않는다 — 표를 만들면 그것도 관리할 것이 된다.
   *     쓴 횟수가 많은 것이 먼저 뜬다(자주 쓰는 이름이 위에 오는 게 손에 맞는다).
   */
  const pick = (key: string) => {
    const n = new Map<string, number>();
    for (const r of all) { const v = S(r[key]); if (v) n.set(v, (n.get(v) || 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1]).map(([v]) => v).slice(0, 200);
  };
  /**
   * ★★★**차를 «한 화면에서» 찾는다** — 사장님 2026-09-09
   *   「우리 담당자는 **한 화면만** 보면 되게 해 주자」·「**한 페이지에서는 차량 조회해서 바로 찾을 수 있고**」
   *
   *   차번을 알면 자동완성으로 끝나지만, 모르면 «모델·공급사»로 찾아야 한다.
   *   ⚠ 검색할 때마다 서버를 부르지 않는다 — 재고를 **한 번** 받아 두고 화면이 즉시 좁힌다.
   *     파이어스토어는 부분일치를 못 하고, 칠 때마다 1,438건을 읽으면 그것도 돈이다.
   *   ★실을 것은 «고르는 데 필요한 것»뿐 — 요금표는 고른 뒤에 그 차만 따로 묻는다(`?plate=`).
   */
  /**
   * ★★★**«조건»으로 찾는 화면이다** — 사장님 2026-09-10
   *   「우리 담당자가 **차량 조건을 빠르게 찾고** 그걸 눌러서 계약 접수 할 수 있는 형태여야 하는 거지」
   *   「한 화면에서 SSOT 원자를 보고 차량 조건을 찾아오고, 또는 여기서 **영업자가 원하는 게 있는지
   *    없는지**를 볼 수 있어야 하고 — **이쁘게보다는 많은 정보**를 보여 줘야 하는 거야」
   *
   *   ⚠ 첫 판은 차번·차종·공급사만 실었다. 그러면 「월 70 이하 SUV 있어요?」에 답을 못 한다 —
   *     차를 하나씩 눌러 봐야 요금을 아니, 그건 «찾는» 화면이 아니라 «뒤지는» 화면이다.
   *   ⇒ 조건이 될 만한 것을 다 싣는다: 연료·차급·주행·인승 + **기간별 요금 통째로**.
   *     1,438대 × 열몇 밭이라 한 번 받아 두면 그 뒤로는 서버를 안 부른다.
   */
  const cars = (await fs.collection('products')
    .select('car_number', 'maker', 'model', 'sub_model', 'trim_name', 'provider_name', 'product_type',
      'year', 'vehicle_status', 'fuel_type', 'vehicle_class', 'mileage', 'seats', 'ext_color', 'price',
      /** ★우대조건(무보증·만21세·경력무관…)은 정책에서 나온다 — 그 밭을 같이 실어야 셀 수 있다. */
      '_policy', 'deposit_free', 'deposit_installment', 'accident_history').get()).docs
    .map((d) => {
      const v = d.data() as Row;
      const price = (v.price || {}) as Record<string, { rent?: number; deposit?: number }>;
      /** 대표 요금 — «제일 싼 기간»을 앞세운다. 손님이 먼저 묻는 것이 그것이다. */
      const rows = Object.entries(price).map(([k, o]) => ({ term: k, rent: N(o?.rent), deposit: N(o?.deposit) }))
        .filter((x) => x.rent > 0).sort((a, b) => a.rent - b.rent);
      const best = rows[0];
      return {
        plate: S(v.car_number),
        name: [S(v.maker), S(v.model), S(v.sub_model)].filter((x, i, a) => x && a.indexOf(x) === i).join(' '),
        trim: S(v.trim_name),
        /** ★제조사는 따로 내보낸다 — 이름(「현대 아반뗰」)에서 첫 낱말을 떼어 쓰면
         *   「제네시스 G80」·「포르쉐 911」 같은 두 낱말짜리에서 틀린다. 원자를 그대로 실는다. */
        maker: S(v.maker),
        supplier: S(v.provider_name), product: S(v.product_type), year: S(v.year), status: S(v.vehicle_status),
        fuel: S(v.fuel_type), cls: S(v.vehicle_class), km: N(v.mileage), seats: N(v.seats), color: S(v.ext_color),
        rent: best?.rent || 0, deposit: best?.deposit || 0, term: best?.term || '',
        terms: rows,
        /**
         * ★★**우대조건은 «정본»이 센다** — 사장님 2026-09-10 「무보증 21세 경력무관 이런 거 하나 있으면 좋고」
         *   `PERKS`·`hasPerk` 는 상품찾기가 쓰는 그 축이다(lib/domain/product-filters).
         *   ⚠ 여기서 「보증금 0 이면 무보증」처럼 다시 짜면 안 된다 — 상품찾기와 답이 갈리는 순간
         *     같은 차가 두 화면에서 다르게 보인다. 셈은 한 곳에서만 한다.
         */
        perks: PERKS.filter((pk) => hasPerk(v as never, pk)),
      };
    }).filter((c) => c.plate);
  const plates = [...new Set(cars.map((c) => c.plate))].sort();
  const suggest = {
    suppliers: pick('supplier'), channels: pick('channel'), agents: pick('agent'),
    products: pick('product'), models: pick('model'), customers: pick('customer'),
    plates: [...new Set(plates)],
  };

  return NextResponse.json({
    month: M, months, suggest,
    sum: { ...sum, clawSup, clawCh, net: sum.claim - clawSup - (sum.pay - clawCh), rows: mine.length },
    suppliers: by('supplier', (r) => claimOf(r as unknown as SettlementRow)),
    channels: by('channel', (r) => payOf(r as unknown as SettlementRow)),
    carry, rows: mine.map(shape), found: found.map(shape),
    /**
     * ★★★**「접수」는 달로 자르지 않는다** — 정산원장 규칙 그대로
     *   (사장님 「접수 이건 그냥 계속 접수되는 거로 해놔야 할 거 같아, 당월 접수가 아니라」).
     *   청구월이 «아직 안 박힌» 줄이 접수다. 인도되면 청구월이 박히고 그 순간 접수에서 나간다.
     */
    intake: all.filter((r) => alive(r) && !S(r.billMonth)).map(shape),
    cars,
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
  /** ★「청구서 나감」은 «우리가» 보내는 것이라 화면에서 켠다 — 통장을 봐야 아는 수금·지급과 다르다. */
  'billed', 'billedAt',
  'payKind', 'model', 'receivedAt', 'deliveredAt', 'billMonth',
  'claimWritten', 'payWritten', 'claimIncentive', 'payIncentive',
  'settleTarget', 'settleRatio', 'settleExclude', 'billHold', 'settleNote', 'note',
  /**
   * ★**접수 갈래** — 사장님 2026-09-10 「접수할 때 영업수수료 · 인센티브 이런 식으로 표현해 주면 돼.
   *   **기본 영업수수료가 기본 세팅**이고」. 별도 「지원금」 단추를 없애고 이 한 칸으로 모았다.
   */
  'intakeKind',
  /** ★접수 시트 그대로 — 계약서·인도완료·취소는 담당자가 켠다. */
  'paper', 'delivered', 'cancelled',
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
  if (S(patch.billMonth) && !isValidBillingMonth(patch.billMonth)) {
    return NextResponse.json({ error: '청구월은 2026-09 꼴이어야 합니다' }, { status: 400 });
  }
  if (S(patch.carryMonth) && !isValidBillingMonth(patch.carryMonth)) {
    return NextResponse.json({ error: '이월월은 2026-09 꼴이어야 합니다' }, { status: 400 });
  }
  for (const key of ['receivedAt', 'deliveredAt'] as const) {
    if (S(patch[key]) && !isValidSettlementDay(patch[key])) {
      return NextResponse.json({ error: `${key === 'receivedAt' ? '접수일' : '인도일'}은 실제 날짜여야 합니다` }, { status: 400 });
    }
  }

  const fs = db();
  const col = fs.collection('settlement_rows');

  /* ── 고치기 ─────────────────────────────────────────────── */
  if (S(body?.id)) {
    const ref = col.doc(S(body?.id));
    const before = await ref.get();
    if (!before.exists) return NextResponse.json({ error: '그 줄이 없습니다' }, { status: 404 });
    const current = before.data() || {};
    if (hasDeliveryContradiction(patch, current)) {
      return NextResponse.json({ error: '인도일·청구월을 넣으려면 인도완료 상태여야 합니다' }, { status: 400 });
    }
    /**
     * 인도완료는 서버에서도 인도일·청구월과 한 덩어리로 강제한다.
     * 화면을 거치지 않는 호출도 같은 상태 전이를 지나야 접수 목록에 고아 줄이 남지 않는다.
     */
    const writePatch = withDeliveryInvariant(patch, current, localSettlementDay());
    await ref.set({ ...writePatch, updatedAt: Date.now() }, { merge: true });
    const back = (await ref.get()).data() || {};
    const gap = Object.entries(writePatch).filter(([k, v]) => S(back[k]) !== S(v)).map(([k]) => k);
    if (gap.length) return NextResponse.json({ error: `되읽으니 다릅니다 — ${gap.join(' · ')}` }, { status: 500 });
    return NextResponse.json({ ok: true, id: ref.id, mode: '고침' });
  }

  /* ── 접수 (새 줄) ───────────────────────────────────────── */
  if (!S(patch.plate) && !S(patch.customer)) {
    return NextResponse.json({ error: '차량번호나 고객명 하나는 있어야 합니다' }, { status: 400 });
  }
  if (hasDeliveryContradiction(patch)) {
    return NextResponse.json({ error: '인도일·청구월을 넣으려면 인도완료 상태여야 합니다' }, { status: 400 });
  }
  /**
   * ★**열쇠는 «내용»으로 만든다** — 자리(줄 번호)로 만들면 위에 한 줄만 끼어도 깨진다
   *   (2026-09-02 최사랑 업무지원비가 두 줄로 섰던 사고). 원자화가 쓰는 열쇠와 같은 결이다.
   */
  const key = `${S(patch.plate).replace(/\s/g, '') || '무차번'}|${S(patch.receivedAt)}|${S(patch.customer)}`;
  const legacyCode = `stl_${Math.abs([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)}`;
  const legacy = await col.doc(legacyCode).get();
  if (legacy.exists) {
    const old = legacy.data() || {};
    const sameReceipt = S(old.plate).replace(/\s/g, '') === S(patch.plate).replace(/\s/g, '')
      && S(old.receivedAt) === S(patch.receivedAt)
      && S(old.customer) === S(patch.customer);
    if (sameReceipt) {
      return NextResponse.json({ error: '같은 차·같은 접수일·같은 고객이 이미 있습니다', id: legacyCode }, { status: 409 });
    }
  }
  /** 짧은 31배 해시는 `Aa`/`BB`처럼 다른 접수를 같은 ID로 만들 수 있어 SHA-256 복합키를 쓴다. */
  const code = `stl_${createHash('sha256').update(key, 'utf8').digest('hex')}`;
  const ref = col.doc(code);
  /** ★규격을 통과시킨다 — 모든 밭이 제 자리에 서고, 안 적은 칸은 「비었다」로 채워진다. */
  const createPatch = withDeliveryInvariant(patch, {}, localSettlementDay());
  const atom = shapeAtom({
    ...createPatch, code,
    /** 폰에서 접수한 줄임을 남긴다 — 나중에 「이건 어디서 왔나」를 물을 수 있어야 한다. */
    fromSheet: '폰 접수', sourceTab: '폰 접수',
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  try {
    /** `get → set` 사이에 같은 접수가 들어와도 뒤의 요청이 덮지 못하도록 원자적으로 만든다. */
    await ref.create(atom);
  } catch (error) {
    const e = error as { code?: number | string };
    if (e.code === 6 || e.code === 'already-exists') {
      return NextResponse.json({ error: '같은 차·같은 접수일·같은 고객이 이미 있습니다', id: code }, { status: 409 });
    }
    throw error;
  }
  const back = (await ref.get()).data() || {};
  if (S(back.code) !== code) return NextResponse.json({ error: '되읽으니 안 들어갔습니다' }, { status: 500 });
  return NextResponse.json({ ok: true, id: code, mode: '접수' });
}
