import 'server-only';

import { erp5Firestore, erp5WhitelabelCutoverRequested } from './erp5-firestore-app';

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
  /*
   * 공통 공개 카탈로그는 운영 스위치가 켜진 ERP5 원자만 읽는다. 재고 대사 영수증은
   * 운영 감사용으로 남기되, 대표의 즉시 전환 지시에 따라 이 손님 읽기 경로를 막지는 않는다.
   * 기존 ERP3/RTDB fallback은 의도적으로 없다.
   */
  if (!erp5WhitelabelCutoverRequested()) {
    throw new Error('ERP5 화이트라벨 전환 요청이 OFF입니다.');
  }
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
