import 'server-only';

import { assertErp5WhitelabelCutoverReady, erp5Firestore } from './erp5-firestore-app';

type Rec = Record<string, any>;

/**
 * 화이트라벨 공개 카탈로그 전용 ERP5 reader.
 *
 * 내부 ERP·계약·정산은 이 모듈을 쓰지 않는다. ERP5 READY 영수증이 없으면 이 reader는
 * 조용히 ERP3/RTDB로 돌아가지 않고 실패한다. 공개 응답은 각 route의 sanitizer가 만든다.
 */
export async function readWhitelabelCatalogFromErp5(): Promise<{
  products: Record<string, Rec>;
  policies: Record<string, Rec>;
  partners: Record<string, Rec>;
  users: Record<string, Rec>;
}> {
  await assertErp5WhitelabelCutoverReady();
  const db = erp5Firestore();
  const [productSnap, policySnap, partnerSnap, userSnap] = await Promise.all([
    db.collection('products').get(),
    db.collection('policy').get(),
    db.collection('partner').get(),
    db.collection('user').get(),
  ]);
  const asMap = (snapshot: { docs: Array<{ id: string; data: () => Rec }> }) => Object.fromEntries(
    snapshot.docs.map((document) => {
      const data = document.data();
      return [document.id, { ...data, _key: data._key || document.id }];
    }),
  ) as Record<string, Rec>;
  return {
    products: asMap(productSnap),
    policies: asMap(policySnap),
    partners: asMap(partnerSnap),
    users: asMap(userSnap),
  };
}
