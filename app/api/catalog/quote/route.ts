import { NextResponse } from 'next/server';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { sanitizeAgentForGuest, sanitizeProductForGuest } from '@/lib/domain/public-catalog';
import { isOfferableProduct } from '@/lib/domain/product';
import { matchAgentByShareCode } from '@/lib/domain/product-share';
import type { EntityRecord } from '@/lib/intake/entities';

export const dynamic = 'force-dynamic';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/**
 * 손님 공개 견적 — `/q/{code}` 가 쓴다. **인증 없이** 호출된다.
 *
 * 브라우저에 RTDB 권한을 주지 않는다. 서버가 서비스계정으로 읽고
 * `sanitizeProductForGuest` 화이트리스트만 통과시킨다(원가·VIN·수수료·회원 PII 제외).
 * 이 구조라 RTDB 규칙을 열 필요가 없다 — erp3 `api/catalog-feed.js` 와 같은 방식.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = S(url.searchParams.get('code'));
  const share = S(url.searchParams.get('a'));
  if (!code) return NextResponse.json({ error: '매물 코드가 없습니다.' }, { status: 400 });

  try {
    const db = firebaseAdminDatabase();
    // 상품키는 `product_code` 이거나 RTDB child 키다(둘 다 실제로 쓰인다).
    const [byKey, allSnap] = await Promise.all([
      db.ref(`v4/products/${encodeURIComponent(code).replace(/\./g, '%2E')}`).get().catch(() => null),
      db.ref('v4/products').get(),
    ]);
    const all = (allSnap.val() || {}) as Record<string, Rec>;
    let key = '';
    let product: Rec | null = byKey?.val() || null;
    if (product) key = code;
    else {
      const hit = Object.entries(all).find(([k, p]) => k === code || S(p?.product_code) === code);
      if (hit) { key = hit[0]; product = hit[1]; }
    }
    if (!product || dead(product)) {
      return NextResponse.json({ error: '현재 견적 가능한 상품이 아닙니다.' }, { status: 404 });
    }
    const merged = { ...product, _key: key, product_code: S(product.product_code) || key } as EntityRecord;
    // 판매 가능 여부는 서버가 판정한다 — 만료·출고불가 매물이 링크로 계속 열리면 안 된다.
    if (!isOfferableProduct(merged)) {
      return NextResponse.json({ error: '현재 견적 가능한 상품이 아닙니다.' }, { status: 404 });
    }

    /**
     * 정책은 v3 ∪ v4 를 함께 본다.
     *
     * erp3 절연은 **재고(products)에만** 적용된다 — 재고는 공급사 원본에서 v4 로 새로 만들고,
     * 회원·파트너·정책·계약 이력은 승계한다(`MIGRATION_PLAN.md` · `rtdb-adapter` 브리지).
     * 실측 2026-08-08: 정책 54건 중 v3 53 · v4 26 — v4 만 읽으면 대부분 매물이
     * 보험·연령·심사 정보를 통째로 잃는다.
     */
    const policyCode = S(product.policy_code);
    let policy: Rec | null = null;
    if (policyCode) {
      const [v3, v4] = await Promise.all([
        db.ref('policies').get().catch(() => null),
        db.ref('v4/policies').get().catch(() => null),
      ]);
      const pool = { ...((v3?.val() || {}) as Rec), ...((v4?.val() || {}) as Rec) } as Record<string, Rec>;
      policy = Object.entries(pool)
        .map(([k, v]) => ({ ...(v || {}), _key: k } as Rec))
        .find((x) => S(x.policy_code) === policyCode || S(x._key) === policyCode) || null;
    }

    let agent = null;
    if (share) {
      const users = (await db.ref('users').get()).val() || {};
      const rows = Object.entries(users as Record<string, Rec>)
        .map(([k, v]) => ({ ...(v || {}), _key: k, uid: v?.uid || k })) as EntityRecord[];
      agent = sanitizeAgentForGuest(matchAgentByShareCode(rows, share) as Rec | null);
    }

    return NextResponse.json(
      { product: sanitizeProductForGuest(key, product, policy), agent },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('[catalog/quote]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '견적을 불러오지 못했습니다.' }, { status: 503 });
  }
}
