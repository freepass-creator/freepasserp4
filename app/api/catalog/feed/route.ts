import { NextResponse } from 'next/server';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { sanitizeAgentForGuest, sanitizeProductForGuest } from '@/lib/domain/public-catalog';
import { isListableProduct } from '@/lib/domain/product';
import { matchAgentByShareCode } from '@/lib/domain/product-share';
import type { EntityRecord } from '@/lib/intake/entities';
import { companyAlias } from '@/lib/domain/identity';

export const dynamic = 'force-dynamic';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/**
 * 손님 공개 카탈로그 — `/catalog` 이 쓴다. **인증 없이** 호출된다.
 *
 * `/api/catalog/quote` 와 같은 원칙: 브라우저에 RTDB 권한을 주지 않고 서버가 서비스계정으로
 * 읽어 화이트리스트만 통과시킨다. 예전 `/catalog` 는 브라우저에서 products **와 partners 전량**을
 * 직접 읽어, 규칙을 열어 해결했다면 공급사 명단까지 통째로 샜을 구조였다.
 *
 *   ?p={공급사코드}  그 공급사 매물만 — 화이트라벨 카탈로그(brand 에 회사명)
 *   ?a={영업 user_code}  담당 영업자 연락처(이름·전화만)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerCode = S(url.searchParams.get('p'));
  const share = S(url.searchParams.get('a'));

  try {
    const db = firebaseAdminDatabase();
    // 재고는 v4 단독이 원칙이다(erp3 절연). 정책은 승계라 v3 ∪ v4 를 함께 본다 —
    // 실측 정책 54건 중 v3 53 이라 v4 만 읽으면 대부분 매물이 보험·연령을 잃는다.
    const [productSnap, v3Pol, v4Pol] = await Promise.all([
      db.ref('v4/products').get(),
      db.ref('policies').get().catch(() => null),
      db.ref('v4/policies').get().catch(() => null),
    ]);
    const policyPool = { ...((v3Pol?.val() || {}) as Rec), ...((v4Pol?.val() || {}) as Rec) } as Record<string, Rec>;
    const policyByCode = new Map<string, Rec>();
    for (const [k, v] of Object.entries(policyPool)) {
      if (!v || typeof v !== 'object') continue;
      policyByCode.set(S(v.policy_code) || k, v);
    }

    const products: EntityRecord[] = [];
    for (const [key, p] of Object.entries((productSnap.val() || {}) as Record<string, Rec>)) {
      if (!p || typeof p !== 'object' || dead(p)) continue;
      if (providerCode && S(p.provider_company_code) !== providerCode && S(p.partner_code) !== providerCode) continue;
      const merged = { ...p, _key: key, product_code: S(p.product_code) || key } as EntityRecord;
      // 목록에 실을 수 있는 것만 — 판정은 앱과 같은 SSOT 를 쓴다.
      if (!isListableProduct(merged)) continue;
      products.push(sanitizeProductForGuest(key, p, policyByCode.get(S(p.policy_code))));
    }

    // 화이트라벨 — 공급사를 지정했을 때만 그 회사 이름을 준다(전체 파트너 목록은 내보내지 않는다).
    //  ★실데이터는 이름이 `name` 에 있고 `partner_code` 가 빈 레코드도 있다(RP004 실측 2026-08-08)
    //   → 코드는 child 키까지 보고, 이름은 세 필드를 다 훑는다. 안 그러면 브랜드가 조용히 빈다.
    let brand = '';
    if (providerCode) {
      const [v3, v4] = await Promise.all([
        db.ref('partners').get().catch(() => null),
        db.ref('v4/partners').get().catch(() => null),
      ]);
      const pool = { ...((v3?.val() || {}) as Rec), ...((v4?.val() || {}) as Rec) } as Record<string, Rec>;
      const hit = Object.entries(pool).find(([key, x]) => x && (
        key === providerCode || S(x.partner_code) === providerCode || S(x.company_code) === providerCode
      ))?.[1];
      // 손님이 보는 이름에 법인격을 붙이지 않는다 — 표기 SSOT 는 companyAlias.
      brand = companyAlias(S(hit?.partner_name || hit?.company_name || hit?.name), hit?.alias);
    }

    let agent = null;
    if (share) {
      const users = (await db.ref('users').get()).val() || {};
      const rows = Object.entries(users as Record<string, Rec>)
        .map(([k, v]) => ({ ...(v || {}), _key: k, uid: v?.uid || k })) as EntityRecord[];
      agent = sanitizeAgentForGuest(matchAgentByShareCode(rows, share) as Rec | null);
    }

    return NextResponse.json(
      { count: products.length, products, brand, agent },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('[catalog/feed]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '카탈로그를 불러오지 못했습니다.' }, { status: 503 });
  }
}
