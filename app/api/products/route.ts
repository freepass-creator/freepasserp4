import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { withProviderNames } from '@/lib/domain/identity';
import type { EntityRecord } from '@/lib/intake/entities';
import { stripProductCost } from '@/lib/firebase/rtdb-products';

export const dynamic = 'force-dynamic';

/**
 * 로그인 ERP용 상품 원본.
 *
 * 브라우저 Firestore 구독이 네트워크에서 오래 대기할 때 쓰는 인증 서버 경로.
 * 폐기된 RTDB로 우회하지 않고 같은 Firestore `products` 컬렉션을 다시 읽는다.
 */
export async function GET(request: Request) {
  try {
    const actor = await verifyActiveBearer(request);
    if (!actor) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    const db = getFirestore(firebaseAdminApp());
    const [snap, partnerSnap] = await Promise.all([
      db.collection('products').get(),
      db.collection('partner').get(),
    ]);
    const rows = snap.docs.map((doc) => {
      const row = doc.data() || {};
      const key = String(row.product_code || row.car_number || doc.id).trim() || doc.id;
      return { ...row, _key: key, product_code: key } as EntityRecord;
    });
    const partners = partnerSnap.docs.map((doc) => ({ ...doc.data(), _key: doc.id } as EntityRecord));
    const named = withProviderNames(rows, partners);
    const visible = actor.role === 'admin' ? named : named.map(stripProductCost);
    // Firestore 문서 ID를 응답 키로 유지한다. product_code가 중복이어도 객체화 과정에서 덮어쓰지 않는다.
    const value = Object.fromEntries(visible.map((row, index) => [snap.docs[index].id, row]));
    return NextResponse.json(value, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[api/products]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '상품을 불러오지 못했습니다.' }, { status: 503 });
  }
}
