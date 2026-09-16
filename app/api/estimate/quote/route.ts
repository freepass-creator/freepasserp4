import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';
import { COST_DEFAULTS, type CostSettings, type AcqPath } from '@/lib/domain/estimate/cost-settings';
import { customerLines, quoteCards, type QuoteAsk } from '@/lib/domain/estimate/quote-lines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 대여료를 **서버가 센다** — 원가를 브라우저로 내려보내지 않으려고.
 *
 * ★사장님 2026-09-16 「이거도 분리해서 freepass-견적기로 하자. 영업(자용으)로 해야 할 거고」 ·
 *   2026-09-06 「영업자랑 손님이 보는 거는 **원가 정보 빠진 거** 좋은 거야」.
 *
 * ★왜 필요한가 — 2026-09-16 이전에는 원가 설정(`/api/estimate/cost`)이 **누구나 읽는** 값이었고
 *   화면이 그걸 받아 대여료를 셌다. 그 구조에서는 영업자에게 원가를 숨길 길이 없다:
 *   화면에서 칸을 지워도 개발자도구에 조달금리·수수료·손바뀜 회당비용이 그대로 보인다.
 *   ⇒ 원가를 **볼 수 있는 사람만** 화면에서 세고(`showsCost`), 나머지는 여기로 물어 **값만** 받는다.
 *
 * ★나가는 것은 넷뿐이다 — 월 대여료·보증금·선납금·만기인수(+ 배기량 미확정 깃발).
 *   원가·매출·영업이익은 **자리조차 없다**(`customerLines`). 자리가 있으면 언젠가 채워진다.
 *
 * ⚠ 로그인은 «묻지 않는다» — 견적 화면 자체가 손님에게도 열린 면이고(`/estimate` 공개),
 *   여기서 나가는 값은 손님에게 그대로 보여 주는 값이다. 대신 **원가는 한 톨도 안 나간다.**
 * ⚠ 셈은 화면과 «같은 한 벌»(`lib/domain/estimate/quote-lines`)이다. 두 벌이 되면 영업자 견적과
 *   관리자 견적이 갈린다 — 그건 우리가 이미 겪은 사고다(대수가 두 군데서 세어지던 일).
 */
const NO_STORE = { 'Cache-Control': 'no-store' };
const COLL = 'settings';
const DOC = 'estimate_cost';

const num = (v: unknown, lo: number, hi: number, dflt = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (String(v) as T) : dflt;

/**
 * 회사가 정한 원가 — 없으면 엔진 기본값. **값은 여기서 나가지 않는다.**
 * ★조건을 바꿀 때마다 부르는 길이라 **한 번 읽어 잠깐 쥔다**(60초). 원가는 사람이 가끔 고치는 값이고,
 *   매 요청 Firestore 를 읽으면 사장님이 칩 하나 누를 때마다 그 왕복이 붙는다
 *   (사장님 2026-09-16 「조건 바꾸면 빠릿빠릿 안 바뀌냐」).
 * ⚠ 60초는 «늦게 반영돼도 되는 만큼»이다 — 원가를 고치면 최대 1분 뒤 견적에 든다.
 */
let costCache: { at: number; cost: CostSettings } | null = null;
const COST_TTL = 60_000;

async function companyCost(): Promise<CostSettings> {
  if (costCache && Date.now() - costCache.at < COST_TTL) return costCache.cost;
  try {
    const snap = await getFirestore(firebaseAdminApp()).collection(COLL).doc(DOC).get();
    const saved = snap.exists ? (snap.data() as { cost?: Partial<CostSettings> }).cost : null;
    const out = { ...COST_DEFAULTS };
    if (saved) {
      for (const k of Object.keys(COST_DEFAULTS) as (keyof CostSettings)[]) {
        const v = saved[k];
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
    }
    costCache = { at: Date.now(), cost: out };
    return out;
  } catch {
    /* 못 읽으면 기본값으로 센다 — 견적이 아예 안 나오는 것보다 낫다.
       ⚠ 장애를 «쥐지» 않는다 — 캐시에 안 넣어 다음 요청이 다시 읽어 본다. */
    return COST_DEFAULTS;
  }
}

/** 물어본 것을 «우리가 아는 모양»으로만 받는다 — 모르는 칸은 버린다. */
function readAsk(body: Record<string, unknown>): QuoteAsk {
  const nowYear = num(body.nowYear, 2000, 2100, new Date().getFullYear());
  const rawTerms = Array.isArray(body.terms) ? body.terms.slice(0, 8) : [];
  const terms = rawTerms.map((t) => {
    const r = (t ?? {}) as Record<string, unknown>;
    return { term: num(r.term, 1, 120, 48), dep: num(r.dep, 0, 100), pre: num(r.pre, 0, 100) };
  });
  const rates = (body.residPct ?? {}) as Record<string, unknown>;
  const residPct: Record<number, number> = {};
  for (const k of [12, 24, 36, 48, 60]) residPct[k] = num(rates[k], 0, 98);
  const buyRates = (body.buyoutPct ?? {}) as Record<string, unknown>;
  const buyoutPct: Record<number, number> = {};
  for (const k of [12, 24, 36, 48, 60]) buyoutPct[k] = num(buyRates[k], 0, 98, residPct[k]);
  const ccRaw = Number(body.cc);
  return {
    channel: pick(body.channel, ['rent', 'sub'] as const, 'rent'),
    type: pick(body.type, ['return', 'acquire'] as const, 'return'),
    acq: pick(body.acq, ['own', 'bought', 'prep'] as const, 'prep') as AcqPath,
    credit: pick(body.credit, ['고신용', '중신용', '저신용'] as const, '중신용'),
    newCar: body.newCar === true,
    price: num(body.price, 0, 3_000_000_000),
    netPrice: num(body.netPrice, 0, 3_000_000_000),
    saleTaxCredit: num(body.saleTaxCredit, 0, 100_000_000),
    cc: Number.isFinite(ccRaw) && ccRaw > 0 ? Math.round(ccRaw) : null,
    fuel: pick(body.fuel, ['gasoline', 'diesel', 'lpg', 'hybrid', 'ev'] as const, 'gasoline'),
    mileage: num(body.mileage, 0, 1_000_000),
    year: num(body.year, 1980, 2100, nowYear),
    nowYear,
    feePct: num(body.feePct, 0, 20, 3),
    residBase: num(body.residBase, 0, 3_000_000_000),
    residPct,
    buyoutPct,
    terms: terms.length ? terms : [{ term: 48, dep: 10, pre: 0 }],
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400, headers: NO_STORE });
  }
  try {
    const ask = readAsk(body);
    const cost = await companyCost();
    const lines = customerLines(quoteCards(cost, ask), ask);
    return NextResponse.json({ lines }, { headers: NO_STORE });
  } catch {
    // ⚠ 오류 상세를 내보내지 않는다 — 원가 셈의 속내가 메시지로 새 나갈 수 있다.
    return NextResponse.json({ error: 'quote unavailable' }, { status: 503, headers: NO_STORE });
  }
}
