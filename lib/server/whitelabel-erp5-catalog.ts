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

const asMap = (snapshot: { docs: Array<{ id: string; data: () => Rec }> }) => Object.fromEntries(
  snapshot.docs.map((document) => [document.id, { ...document.data(), _key: document.data()._key || document.id }]),
) as Record<string, Rec>;

/**
 * **읽은 것을 잠깐 쥐고 있는다 — 손님 한 명이 들어올 때마다 컬렉션을 통째로 읽지 않게.**
 *
 * ★★★사장님 2026-09-16 「화이트라벨 **새로고침하거나 새로 들어오면 왜 바로 안 열리지**?? ·
 *   **필터는 바로 열려야지**」.
 *
 * ⚠⚠ **무엇이 문제였나.** 캐시가 없어서 `/api/catalog/feed` 한 번마다 Firestore 의
 *   `products`(1592) + `policy` 컬렉션을 **통째로** 읽었다. 실측 — 그 왕복이 **1.7초**다.
 *   목록·필터가 전부 그 응답을 기다리므로, 새로고침하면 그 시간 동안 화면이 비어 있다.
 *   ★★그리고 «돈»이기도 하다 — Firestore 는 **문서 수로 과금**한다. 한 사람이 한 번 볼 때마다
 *     1600건 이상을 읽었다. 목록을 새로 그릴 때마다(조건을 바꿀 때마다) 또 읽는다.
 *
 * ★**얼마나 쥐나 — 60초.** 재고는 매시간 동기(`hourly-sync`)로 바뀌므로 60초는 데이터가
 *   변하는 주기보다 한참 짧다. 「방금 바뀐 값이 안 보인다」가 생길 수 있는 창이 1분이고,
 *   그 대신 몰려 들어온 손님 전부가 **한 번의 읽기**를 나눠 쓴다.
 * ★**같이 몰리면 한 번만 읽는다**(`inflight`). 캐시가 빈 순간에 열 명이 들어오면 열 번 읽던
 *   것을 한 번으로 묶는다 — 캐시의 값은 이 「몰림 막기」에서 절반쯤 나온다.
 * ⚠ 이 캐시는 **인스턴스 안에서만** 산다(모듈 변수). 서버가 여러 대면 대수만큼 읽는다 —
 *   그래도 손님 수만큼 읽던 것에서 서버 수만큼으로 줄어든다.
 * ⚠ 돌려주는 map 을 **부르는 쪽이 고치면 안 된다**(같은 객체를 여러 요청이 나눠 본다).
 *   지금은 아무도 안 고친다 — 정제기(`sanitizeProductForGuest`)가 새 객체를 만들어 쓴다.
 */
const TTL_MS = 60_000;
type Cell<T> = { at: number; value: T } | null;
const cells: { products: Cell<Record<string, Rec>>; policies: Cell<Record<string, Rec>>;
  partners: Cell<Record<string, Rec>>; users: Cell<Record<string, Rec>> } = {
  products: null, policies: null, partners: null, users: null,
};
const inflight = new Map<string, Promise<Record<string, Rec>>>();

function fresh<K extends keyof typeof cells>(k: K): Record<string, Rec> | null {
  const c = cells[k];
  return c && Date.now() - c.at < TTL_MS ? c.value : null;
}

/** 한 컬렉션을 «캐시 → 진행 중인 읽기 → 새 읽기» 차례로 가져온다. */
function collection(key: keyof typeof cells, name: string): Promise<Record<string, Rec>> {
  const hit = fresh(key);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  const work = (async () => {
    const snap = await readWithin(erp5Firestore().collection(name).get(), name);
    const value = asMap(snap);
    cells[key] = { at: Date.now(), value };
    return value;
  })().finally(() => { inflight.delete(key); });
  inflight.set(key, work);
  return work;
}

/** 목록·상세가 반드시 같은 ERP5 상품·정책·채널 데이터를 읽는다. */
export async function readWhitelabelCatalogFromErp5(options: { includePartners?: boolean; includeUsers?: boolean } = {}): Promise<{
  products: Record<string, Rec>; policies: Record<string, Rec>; partners: Record<string, Rec>; users: Record<string, Rec>;
}> {
  if (!erp5WhitelabelCutoverRequested()) throw new Error('ERP5 화이트라벨 전환 요청이 OFF입니다.');
  const [products, policies, partners, users] = await Promise.all([
    collection('products', 'products'),
    collection('policies', 'policy'),
    options.includePartners ? collection('partners', 'partner') : Promise.resolve({}),
    options.includeUsers ? collection('users', 'user') : Promise.resolve({}),
  ]);
  return { products, policies, partners, users };
}
