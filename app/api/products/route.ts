import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { erp5LegacyProductReadAllowed, erp5ProductReadEnabled, readActiveErp5Products } from '@/lib/server/erp5-admin';
import { projectErp5ProductForErp4 } from '@/lib/domain/erp5-product-ssot';
import { applyErp4ProductLock, readErp4ProductLocks } from '@/lib/server/erp4-product-locks';

export const dynamic = 'force-dynamic';

/**
 * 로그인 ERP4용 상품 조회.
 * 절체 전에는 ERP3 유지 데이터를, 절체 후에는 ERP5 활성 버전만 읽는다.
 */
export async function GET(request: Request) {
  try {
    const actor = await verifyActiveBearer(request);
    if (!actor) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    if (!erp5ProductReadEnabled()) {
      if (!erp5LegacyProductReadAllowed()) throw new Error('ERP3 상품 유지 읽기가 승인되지 않았습니다.');
      const legacy = (await firebaseAdminDatabase().ref('v4/products').get()).val() || {};
      return NextResponse.json(legacy, {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Product-SSOT': 'erp3-maintenance-before-erp5-cutover',
        },
      });
    }
    const [active, locks] = await Promise.all([
      readActiveErp5Products({ includeUnlistable: actor.role === 'admin' }),
      readErp4ProductLocks(),
    ]);
    const value: Record<string, Record<string, unknown>> = {};
    for (const item of active.products) {
      const projected = applyErp4ProductLock(
        projectErp5ProductForErp4(item.data, item.id, { includeDiagnostics: actor.role === 'admin' }),
        item.id,
        locks,
      );
      const key = String(projected.product_code || item.id);
      if (value[key]) throw new Error(`ERP5 활성 상품키 중복: ${key}`);
      value[key] = projected;
    }
    return NextResponse.json(value, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'X-ERP5-Product-Version': active.versionId,
        'X-ERP5-Release': active.releaseId,
      },
    });
  } catch (error) {
    console.error('[api/products]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '상품을 불러오지 못했습니다.' }, { status: 503 });
  }
}
