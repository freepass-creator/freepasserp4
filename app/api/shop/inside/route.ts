import { NextResponse } from 'next/server';
import { resolveProduct } from '@/lib/server/guest-quote';
import { firestoreAdminRef } from '@/lib/server/firestore-ref-shim';
import { providerNameMap } from '@/lib/domain/identity';
import type { EntityRecord } from '@/lib/intake/entities';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * **영업자 전용 — 손님 상세 맨 밑 「우리끼리 보는 칸」.**
 *
 * ★사장님 2026-09-06 「손님한테 보여주는 그 페이지에 **영업자들만 보는 섹션**을 하나 둬서
 *   **공급사가 어딘지** … 맨 하단 마지막 밑에다가. 고거는 **로그인한 사람만** 보고,
 *   로그인은 **영업자·직원만** 할 수 있고」.
 *
 * ★★**왜 라우트를 따로 파나 — 손님 응답에 실어 놓고 화면에서 가리면 «막은 게 아니다».**
 *   손님 카탈로그(`/api/catalog/feed`)는 `sanitizeProductForGuest` 가 내보낼 칸을 «명단»으로 고른다.
 *   공급사·원천은 그 명단에 없다(일부러 없다). 여기에 얹으면 **로그아웃한 손님의 브라우저까지**
 *   그 값이 내려간다 — 개발자도구를 열면 그만이다. 집 규격: 「메뉴에서 숨기는 것만으로는 막은 게
 *   아니다 — 문지기와 API 도 같은 명단으로 막는다」.
 *   ⇒ **다른 문(이 라우트)** 으로, **토큰을 들고 온 사람에게만** 준다.
 *
 * ★누가 보나 — **영업자·관리자는 다 본다. 공급사는 «제 차»만 본다.**
 *   사장님 말씀은 「영업자·직원」이다. 공급사는 명단에 없었는데, 이 판은 여러 공급사의 차가 한데
 *   서는 곳이라 남의 공급사 이름을 보여 주면 **경쟁사에게 매입처를 알려 주는 꼴**이 된다.
 *   그래서 공급사에게는 제 차만 연다(정산의 「보안 빗장」과 같은 판단).
 *
 * ⚠ **원가·마진은 여기 안 싣는다.** 그건 견적(`/estimate`)의 몫이고 명단이 다르다
 *   (관리자·공급사 — `lib/domain/estimate/audience`). 영업자가 여는 칸에 원가가 섞이면
 *   그 명단이 조용히 무너진다.
 */
type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 원천 이름 — 연동 허브(`/connectors`)의 말과 «같은 말»을 쓴다. 화면마다 다른 이름을 짓지 않는다. */
const SOURCE_NAME: Record<string, string> = {
  sheet: '구글시트 (공급사 제공)',
  sonokong: '손오공 API',
  iron: '홈페이지 · 아이언렌트카',
};

export async function GET(request: Request) {
  const code = S(new URL(request.url).searchParams.get('code'));
  if (!code) return NextResponse.json({ error: 'code 가 없습니다' }, { status: 400 });

  const active = await verifyActiveBearer(request);
  /* 로그인 안 한 사람 = 손님이다. 「없다」가 아니라 «권한 없음»으로 답한다(화면은 칸을 안 그린다). */
  if (!active) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  /* ★찾는 규칙은 손님 화면과 «같은 함수»다 — 링크 하나가 두 곳에서 다르게 풀리면 안 된다. */
  const hit = await resolveProduct(code);
  const p = (hit?.product || null) as Rec | null;
  if (!p) return NextResponse.json({ error: '없는 매물입니다' }, { status: 404 });

  const providerCode = S(p.provider_company_code) || S(p.partner_code);
  const mine = !!providerCode && providerCode === S(active.companyCode);
  if (active.role === 'provider' && !mine) {
    return NextResponse.json({ error: '다른 공급사의 매물입니다' }, { status: 403 });
  }

  /*
   * 공급사는 «이름»으로 말한다 — 실측(2026-09-06) 재고 원자에 `provider_name` 은 대개 비어 있고
   * 코드(`RP021`)만 있다. 그대로 내면 영업자가 「RP021이 어디였지」를 또 찾아야 한다.
   * ★코드 → 이름 규칙은 `providerNameMap` 한 곳이다 — 화면마다 이름을 새로 짓지 않는다.
   */
  const db = firestoreAdminRef();
  const partners = Object.entries(((await db.ref('v4/partners').get()).val() || {}) as Record<string, Rec>)
    .map(([k, v]) => ({ ...(v || {}), _key: k })) as EntityRecord[];
  const providerName = S(p.provider_name) || providerNameMap(partners)[providerCode] || '';

  /*
   * ★★**패널티(중도해지 위약금)** — 사장님 2026-09-06 「패널티」.
   *   손님이 상담 중에 제일 자주 묻는 것 중 하나가 「중간에 빼면요?」인데, **손님 화면에는 안 뜬다.**
   *   `penalty_condition` 은 공개 명단에 있으면서도 정책 넷 어디에도 안 그려져 있었고(2026-09-06 실측),
   *   요율(`early_termination_rate_*`)은 아예 비공개다. ⇒ 영업자가 그 자리에서 답할 수 있게 여기 싣는다.
   * ⚠ 손님 화면에 «올리는» 것이 아니다 — 위약금은 계약서에서 확정하는 값이라, 목록 상세에 숫자로
   *   세우면 「그 값으로 계약된다」로 읽힌다. 영업자가 «말로» 안내하는 자리에 둔다.
   * ★값은 정책(`policy_code` 조인)에 있다 — 재고 원자에는 없다.
   */
  const policyCode = S(p.policy_code);
  let policy: Rec | null = null;
  if (policyCode) {
    const pool = ((await db.ref('policies').get()).val() || {}) as Record<string, Rec>;
    policy = Object.entries(pool)
      .map(([k, v]) => ({ ...(v || {}), _key: k } as Rec))
      .find((x) => S(x.policy_code) === policyCode || S(x._key) === policyCode) || null;
  }
  const rate = (v: unknown) => { const t = S(v); return t && !/^0%?$/.test(t) ? t : ''; };
  /*
   * ★**단위는 «필드 이름이 말할 때만» 붙인다.** 실측 2026-09-06 — 같은 뜻인데 원천이 제각각이다:
   *   `deposit_return_days` 는 「30일」인데 `buyout_notice_days` 는 「30」, `impound_keep_days` 도 「30」.
   *   이름이 `_days` 니 단위는 «날»이 맞다 — 맨 숫자에만 붙인다(이미 붙은 것은 그대로 둔다).
   * ⚠⚠ **`late_fee_rate`(0.12·0.24)에는 아무것도 안 붙인다.** 이름이 `rate` 라 단위를 말해 주지 않는다 —
   *   12%인지 하루 0.12%인지 이 데이터만으로는 모른다. **모르는 것을 「%」로 지어내면**
   *   영업자가 손님에게 틀린 숫자를 말하게 된다. 원문 그대로 두고, 규격이 정해지면 그때 붙인다.
   */
  const unit = (v: unknown, u: string) => { const t = S(v); return t && /^[0-9]+$/.test(t) ? `${t}${u}` : t; };

  const source = S(p.source);
  return NextResponse.json({
    provider: providerName || providerCode || '',
    providerCode,
    source: SOURCE_NAME[source] || (source ? source : '미러/수기 (원천표시 없음)'),
    /* 상태는 «원값»이다 — 손님 화면은 「출고가능」만 보여주지만 우리는 계약중·출고불가까지 본다. */
    vehicleStatus: S(p.vehicle_status),
    productType: S(p.product_type),
    /** 계약이 잡아 둔 차인가 — 누가 선점했는지까지(집 규격: 락 주인은 `locked_by_contract`). */
    lockedBy: S(p.locked_by_contract),
    updatedAt: N(p._var_polled_at) || N(p._direct_ingest_at) || N(p._mirror_at),
    location: S(p.location),
    /*
     * ★★**응대에 필요한 «손님에게 안 나가는» 정책 칸들**(사장님 2026-09-06 「그냥 그 봐야 될 것들
     *   있잖아 … 영업자만 보고 **응대해줄 수 있는** 그런 걸 만들어야지」).
     *   실측 2026-09-06 — 정책 81건에서 손님 명단 밖 칸이 58개다. 그중 «상담 중에 실제로 물어보는»
     *   것만 골랐다(건수는 값이 «채워진» 정책 수):
     *     연체료율 40 · 연체 회차 40 · 자동해지 일수 54 · 시동제어 일수 54 ·
     *     보증금 반환일 54 · 인수 통지일 40 · 보관일 40 · 수수료 환수 46 ·
     *     영업 메모 14 · 결격조건 2 · 신용등급 13 · GPS 4 · 연령 낮추기(21/23세) 15
     * ⚠ **카드·분납은 여기 안 넣는다** — 손님 상세 「납부」 타일에 «이미» 있다
     *   (보증금 분납·보증금 카드·대여료 카드·납부 방법). 사장님도 「분납 이런 건 직접 보여줘도 된다」
     *   하셨고, 실제로 보여주고 있다. 같은 값을 두 곳에 두면 한쪽만 고쳐진다.
     * ⚠ **수수료 «율»은 아직 없다** — 그건 정산(`settlement-fee-table`)의 값이라 명단·계산이 다르다.
     *   여기 실은 것은 정책에 적힌 **환수 조건**뿐이다(사장님 「나중에 있으면 수수료 얼마인지」).
     */
    penalty: S(policy?.penalty_condition),
    penaltyUnder1y: rate(policy?.early_termination_rate_under1y),
    penaltyOver1y: rate(policy?.early_termination_rate_over1y),
    lateFeeRate: S(policy?.late_fee_rate),
    overdueRounds: unit(policy?.deposit_overdue_rounds, '회'),
    autoTerminateDays: unit(policy?.auto_terminate_overdue_days, '일'),
    engineControlDays: unit(policy?.engine_control_overdue_days, '일'),
    depositReturnDays: unit(policy?.deposit_return_days, '일'),
    buyoutNoticeDays: unit(policy?.buyout_notice_days, '일'),
    impoundKeepDays: unit(policy?.impound_keep_days, '일'),
    commissionClawback: S(policy?.commission_clawback_condition),
    age21Cost: S(policy?.age_21_cost),
    age23Cost: S(policy?.age_23_cost),
    creditGrade: S(policy?.credit_grade),
    gpsInstalled: S(policy?.gps_installed),
    disqualification: S(policy?.disqualification_conditions),
    salesNotes: S(policy?.sales_notes),
  });
}
