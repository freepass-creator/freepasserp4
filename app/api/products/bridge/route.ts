import { NextResponse } from 'next/server';
import {
  collectProductBridgeReferences,
  projectLegacyProductsForActor,
  selectLegacyProductsForBridge,
} from '@/lib/domain/product-bridge';
import type { EntityRecord } from '@/lib/intake/entities';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SOURCE_PRODUCTS = 10_000;
const MAX_RESPONSE_PRODUCTS = 2_000;
const PRIVATE_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};

/**
 * 후보 Rules가 레거시 products 원문을 비관리자에게 닫은 뒤에도 쓰는 읽기 전용 호환층.
 * Admin SDK로 읽은 원문은 반드시 projectLegacyProductsForActor를 거쳐 역할별 비공개 원자를 제거한다.
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await verifyActiveBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503, headers: PRIVATE_RESPONSE_HEADERS });
  }
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: PRIVATE_RESPONSE_HEADERS });

  try {
    const db = firebaseAdminDatabase();
    const [productSnap, contractSnap, contractV4Snap, roomSnap, roomV4Snap] = await Promise.all([
      db.ref('products').get(),
      db.ref('contracts').get(),
      db.ref('v4/contracts').get(),
      db.ref('rooms').get(),
      db.ref('v4/rooms').get(),
    ]);
    const raw = (productSnap.val() || {}) as Record<string, EntityRecord>;
    const sourceCount = Object.keys(raw).length;
    if (sourceCount > MAX_SOURCE_PRODUCTS) {
      return NextResponse.json({ error: 'legacy product limit exceeded' }, { status: 503, headers: PRIVATE_RESPONSE_HEADERS });
    }
    const references = collectProductBridgeReferences([
      (contractSnap.val() || {}) as Record<string, Record<string, unknown>>,
      (contractV4Snap.val() || {}) as Record<string, Record<string, unknown>>,
      (roomSnap.val() || {}) as Record<string, Record<string, unknown>>,
      (roomV4Snap.val() || {}) as Record<string, Record<string, unknown>>,
    ]);
    const selected = selectLegacyProductsForBridge(raw, references);
    const count = Object.keys(selected).length;
    // 조용한 잘림은 재고 소실로 보이므로 응답 상한도 명시적으로 실패시킨다.
    if (count > MAX_RESPONSE_PRODUCTS) {
      return NextResponse.json({ error: 'legacy product response limit exceeded' }, { status: 503, headers: PRIVATE_RESPONSE_HEADERS });
    }
    const products = projectLegacyProductsForActor(selected, actor);
    return NextResponse.json({ products, count, sourceCount }, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch {
    return NextResponse.json({ error: 'legacy products unavailable' }, { status: 503, headers: PRIVATE_RESPONSE_HEADERS });
  }
}
