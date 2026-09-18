import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import { readCanonicalCatalogFromErp5 } from '@/lib/server/whitelabel-erp5-catalog';
import { stripProductCost } from '@/lib/firebase/rtdb-products';
import { withProviderNames } from '@/lib/domain/identity';
import type { EntityRecord } from '@/lib/intake/entities';

export const dynamic = 'force-dynamic';

const S = (value: unknown) => String(value ?? '').trim();

/**
 * 로그인 ERP 상품찾기용 상품 피드.
 *
 * canonical 상품 원장은 freepasserp5 하나다. 인증/회원은 ERP4 Firebase가 담당하지만,
 * 상품 값 자체는 ERP4 Firestore/RTDB를 거치지 않고 서버가 ERP5를 직접 읽는다.
 *
 * - admin: canonical 상품 원문
 * - provider: 자기 회사 상품은 원문, 다른 회사 상품은 private 원가 제거
 * - agent: private 원가 제거
 *
 * ERP5 장애를 옛 ERP4 상품 원장으로 숨기지 않는다. 실패하면 503으로 드러내야
 * Finder와 F01/F86/화이트라벨이 서로 다른 재고를 조용히 보여 주는 사고가 없다.
 */
export async function GET(request: Request) {
  try {
    const actor = await verifyActiveBearer(request);
    if (!actor) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

    const src = await readCanonicalCatalogFromErp5({ includePartners: true });
    const products = Object.entries(src.products).map(([docId, raw]) => {
      const product = {
        ...(raw || {}),
        _key: S(raw?._key) || S(raw?.product_code) || S(raw?.car_number) || docId,
      } as EntityRecord;
      const ownProvider = actor.role === 'provider'
        && !!actor.companyCode
        && [S(product.provider_company_code), S(product.partner_code)].includes(actor.companyCode);
      return actor.role === 'admin' || ownProvider ? product : stripProductCost(product);
    });

    const partners = Object.entries(src.partners).map(([id, raw]) => ({
      ...(raw || {}),
      _key: S(raw?._key) || id,
    } as EntityRecord));

    const named = withProviderNames(products, partners);
    const code = S(new URL(request.url).searchParams.get('code'));
    if (code) {
      const found = named.find((product) =>
        [S(product._key), S(product.product_code), S(product.car_number)].includes(code),
      );
      if (!found) return NextResponse.json({ error: '매물을 찾을 수 없습니다.' }, { status: 404 });
      return NextResponse.json(found, {
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      });
    }

    return NextResponse.json(named, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[api/products]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '상품을 불러오지 못했습니다.' }, { status: 503 });
  }
}
