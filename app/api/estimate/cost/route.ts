import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp, verifyActiveBearer, verifyAdminBearer } from '@/lib/server/firebase-admin';
import { COST_DEFAULTS, type CostSettings } from '@/lib/domain/estimate/cost-settings';
import { canSeeEstimate } from '@/lib/domain/estimate/audience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 원가 설정 — **회사 공용** 저장.
 *
 * ★사장님 2026-09-06 「딱 1번 세팅 → 모든 견적에 자동 적용」. 그러려면 «회사 한 벌»이어야 한다.
 *   2026-09-06 낮까지는 브라우저 한 대(localStorage)에만 남아, 사장님이 정한 원가를 영업자가 못 봤다 —
 *   같은 차를 두 사람이 서로 다른 값으로 견적하는 상태였다.
 *
 * ★누가 무엇을 하나 — **읽기는 관리자·공급사, 쓰기는 관리자만.**
 *   사장님 2026-09-06 「견적기는 … 공급사들이 보는 거고 … 일단 메뉴 자체를 관리자랑 공급사만 보게 해요」.
 *   ⇒ 영업자는 **값도 못 읽는다**(403). 화면에서 메뉴를 숨기는 것만으로는 막은 게 아니다 —
 *     주소를 아는 사람은 API 를 그냥 부른다. 명단은 `lib/domain/estimate/audience` 한 곳이 쥔다.
 *   원가는 회사가 «정하는» 값이지 각자 «고르는» 값이 아니다. 각자 고치면 대여료가 사람마다 달라진다.
 *
 * ★저장은 **Firestore**(`settings/estimate_cost`)다. RTDB 가 아니다 —
 *   RTDB 는 폐기 이관 중이라(`rtdb-to-firestore-cutover`) 새 데이터를 거기 얹지 않는다.
 *   서버(admin SDK)로만 읽고 쓰므로 클라이언트 보안규칙을 손대지 않는다 —
 *   ⇒ 규칙 배포 없이 오늘 바로 쓸 수 있고, 규칙이 틀려 원가가 새는 길도 안 생긴다.
 *
 * ⚠ **값 검사를 서버가 한다.** 원가 한 칸이 틀리면 모든 견적이 조용히 틀린다.
 *   모르는 칸은 버리고, 아는 칸도 범위를 벗어나면 통째로 물린다(422).
 */
const COLL = 'settings';
const DOC = 'estimate_cost';

/** 칸마다 허용 범위 — 「퍼센트인데 1000」 같은 값이 조용히 들어가지 않게. */
const RANGE: Record<keyof CostSettings, [number, number]> = {
  bondPct: [0, 20], regFee: [0, 5_000_000],
  deliveryFee: [0, 5_000_000], initPrepFee: [0, 10_000_000],
  // 신용 구간 A(정상)·B(중신용)·C(저신용) — 항목은 같고 값만 다르다.
  interestAPct: [0, 30], interestBPct: [0, 30], interestCPct: [0, 30],
  loanAPct: [0, 100], loanBPct: [0, 100], loanCPct: [0, 100],
  maintMonthly: [0, 1_000_000], maintRatePct: [0, 20], gpsMonthly: [0, 200_000], parkingMonthly: [0, 1_000_000],
  inspectionFee: [0, 1_000_000],
  overheadPct: [0, 50], badDebtPct: [0, 50],
  salesFeePct: [0, 20],
  acqTaxRentPct: [0, 20], acqTaxSubPct: [0, 20],
  insRentYear: [0, 10_000_000], insSubYear: [0, 10_000_000],
  selfRentPct: [0, 20], selfSubPct: [0, 20],
  selfInsRentYear: [0, 10_000_000], selfInsSubYear: [0, 10_000_000],
  marginRentPct: [0, 60], marginSubPct: [0, 60],
  markupUsedPct: [0, 100], markupNewPct: [0, 100],
  ewYear: [0, 2_000_000],
  // 반납률(계약 유지율) — 0% 는 「한 사람도 안 끝까지 안 탄다」는 뜻이라 못 받는다(손바뀜이 무한이 된다).
  retentionNormalPct: [1, 100], retentionMidPct: [1, 100], retentionLowPct: [1, 100],
  turnoverPrepFee: [0, 10_000_000], turnoverDeliveryFee: [0, 10_000_000],
  turnoverFeePct: [0, 20], turnoverVacancyMonths: [0, 12],
  // 위약금 상쇄 = 평균 보증금 × 회수율. 회수율은 신용 구간 A/B/C.
  depositMonths: [0, 12],
  penaltyRecoveryAPct: [0, 100], penaltyRecoveryBPct: [0, 100], penaltyRecoveryCPct: [0, 100],
  // 잔가 가감 — ±%p. 곡선을 통째로 올리거나 내린다.
  residualAdjustPct: [-30, 30],
  returnDeliveryFee: [0, 5_000_000], disposalFeePct: [0, 20],
};
const KEYS = Object.keys(RANGE) as (keyof CostSettings)[];

function clean(raw: unknown): { ok: true; cost: CostSettings } | { ok: false; bad: string[] } {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...COST_DEFAULTS };
  const bad: string[] = [];
  for (const k of KEYS) {
    if (!(k in src)) continue;                       // 안 보낸 칸은 기본값 그대로
    const v = Number(src[k]);
    const [lo, hi] = RANGE[k];
    if (!Number.isFinite(v) || v < lo || v > hi) { bad.push(k); continue; }
    out[k] = v;
  }
  return bad.length ? { ok: false, bad } : { ok: true, cost: out };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** GET — **관리자·공급사만** 읽는다(견적 화면을 보는 사람과 같은 명단). */
export async function GET(request: Request): Promise<Response> {
  let who: Awaited<ReturnType<typeof verifyActiveBearer>>;
  try {
    who = await verifyActiveBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503, headers: NO_STORE });
  }
  if (!who) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  if (!canSeeEstimate(who.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  try {
    const snap = await getFirestore(firebaseAdminApp()).collection(COLL).doc(DOC).get();
    const data = snap.exists ? (snap.data() as { cost?: unknown; updatedAt?: string; updatedBy?: string }) : null;
    // 저장된 적이 없으면 «없다»고 말한다 — 기본값을 「누가 정한 값」인 척 내보내지 않는다.
    if (!data?.cost) return NextResponse.json({ cost: null, canEdit: who.role === 'admin' }, { headers: NO_STORE });
    const checked = clean(data.cost);
    return NextResponse.json({
      cost: checked.ok ? checked.cost : COST_DEFAULTS,
      // 저장된 값이 범위를 벗어났다면 화면이 알아야 한다(옛 규격이 남았거나 손으로 고쳤다는 뜻).
      stale: checked.ok ? undefined : checked.bad,
      updatedAt: data.updatedAt ?? null,
      updatedBy: data.updatedBy ?? null,
      canEdit: who.role === 'admin',
    }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'estimate cost unavailable' }, { status: 503, headers: NO_STORE });
  }
}

/** PUT — **관리자만.** 원가는 회사가 정하는 값이다. */
export async function PUT(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503, headers: NO_STORE });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400, headers: NO_STORE }); }
  const checked = clean((body as { cost?: unknown })?.cost);
  if (!checked.ok) {
    return NextResponse.json({ error: 'out of range', fields: checked.bad }, { status: 422, headers: NO_STORE });
  }
  const updatedAt = new Date().toISOString();
  try {
    await getFirestore(firebaseAdminApp()).collection(COLL).doc(DOC)
      .set({ cost: checked.cost, updatedAt, updatedBy: admin.uid }, { merge: false });
    return NextResponse.json({ cost: checked.cost, updatedAt, updatedBy: admin.uid }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'estimate cost save failed' }, { status: 503, headers: NO_STORE });
  }
}
