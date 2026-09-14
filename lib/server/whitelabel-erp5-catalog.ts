import 'server-only';

import { erp5Firestore, erp5WhitelabelCutoverRequested } from './erp5-firestore-app';

type Rec = Record<string, any>;
const READ_TIMEOUT_MS = 5_000;

/** 공개 화면은 데이터 원본이 늦어도 서버리스 시간 초과까지 기다리지 않는다. */
async function readWithin<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`ERP5 Firestore ${label} 읽기 시간 초과`)), READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
    readWithin(db.collection('products').get(), 'products'),
    readWithin(db.collection('policy').get(), 'policy'),
    readWithin(db.collection('partner').get(), 'partner'),
    readWithin(db.collection('user').get(), 'user'),
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
