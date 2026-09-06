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
  const partners = Object.entries(((await firestoreAdminRef().ref('v4/partners').get()).val() || {}) as Record<string, Rec>)
    .map(([k, v]) => ({ ...(v || {}), _key: k })) as EntityRecord[];
  const providerName = S(p.provider_name) || providerNameMap(partners)[providerCode] || '';

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
  });
}
