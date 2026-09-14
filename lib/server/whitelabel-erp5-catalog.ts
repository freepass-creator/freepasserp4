import 'server-only';

import { erp5Firestore, erp5WhitelabelCutoverRequested } from './erp5-firestore-app';

type Rec = Record<string, any>;
const READ_TIMEOUT_MS = 5_000;

async function readWithin<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`ERP5 Firestore ${label} 읽기 시간 초과`)), READ_TIMEOUT_MS);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** 공개 카탈로그는 ERP5 Firestore만 읽는다. 다른 저장소 fallback은 없다. */
export async function readWhitelabelCatalogFromErp5(): Promise<{
  products: Record<string, Rec>; policies: Record<string, Rec>; partners: Record<string, Rec>; users: Record<string, Rec>;
}> {
  if (!erp5WhitelabelCutoverRequested()) throw new Error('ERP5 화이트라벨 전환 요청이 OFF입니다.');
  const db = erp5Firestore();
  const [productSnap, policySnap, partnerSnap, userSnap] = await Promise.all([
    readWithin(db.collection('products').get(), 'products'),
    readWithin(db.collection('policy').get(), 'policy'),
    readWithin(db.collection('partner').get(), 'partner'),
    readWithin(db.collection('user').get(), 'user'),
  ]);
  const asMap = (snapshot: { docs: Array<{ id: string; data: () => Rec }> }) => Object.fromEntries(
    snapshot.docs.map((document) => [document.id, { ...document.data(), _key: document.data()._key || document.id }]),
  ) as Record<string, Rec>;
  return { products: asMap(productSnap), policies: asMap(policySnap), partners: asMap(partnerSnap), users: asMap(userSnap) };
}
