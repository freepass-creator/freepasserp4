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

type Erp5CatalogReadOptions = { includePartners?: boolean; includeUsers?: boolean };
type Erp5CatalogRead = {
  products: Record<string, Rec>; policies: Record<string, Rec>; partners: Record<string, Rec>; users: Record<string, Rec>;
};

/** canonical ERP5 컬렉션 읽기 공통부 — 60초 캐시/inflight는 손님면·내부 ERP가 한 벌을 공유한다. */
async function readCanonicalCatalog(options: Erp5CatalogReadOptions = {}): Promise<Erp5CatalogRead> {
  const [products, policies, partners, users] = await Promise.all([
    collection('products', 'products'),
    collection('policies', 'policy'),
    options.includePartners ? collection('partners', 'partner') : Promise.resolve({}),
    options.includeUsers ? collection('users', 'user') : Promise.resolve({}),
  ]);
  return { products, policies, partners, users };
}

/** 내부 ERP/Finder용 canonical 읽기. ERP5는 선택 기능이 아니므로 화이트라벨 cutover 스위치에 묶지 않는다. */
export async function readCanonicalCatalogFromErp5(options: Erp5CatalogReadOptions = {}): Promise<Erp5CatalogRead> {
  return readCanonicalCatalog(options);
}

/** 손님 목록·상세는 배포 cutover 스위치가 켜진 경우에만 ERP5를 공개 소비한다. */
export async function readWhitelabelCatalogFromErp5(options: Erp5CatalogReadOptions = {}): Promise<Erp5CatalogRead> {
  if (!erp5WhitelabelCutoverRequested()) throw new Error('ERP5 화이트라벨 전환 요청이 OFF입니다.');
  return readCanonicalCatalog(options);
}

/**
 * ★★★**재고가 «언제 것»인가 — 원자에게 직접 묻는다.**
 *
 * 사장님 2026-09-17 「여기서 역으로 한번 그쪽으로 파봐」.
 *
 * ⚠⚠ **무엇이 틀렸나.** 가게 머리띠가 「⟳ 9. 14. 02:01」을 보여 주고 있었는데, 같은 날
 *   원자를 직접 세어 보니 **절반이 그날 아침(09-17 09:53) 것**이었다. **80시간이 틀렸다.**
 *   (진단 = `scripts/diag-erp5-atom-freshness.mts` · 운영 1,615대 전수)
 *
 *   뿌리는 «출처»다. 화면이 그리는 재고와 화면이 읽는 시각이 **서로 다른 파이프라인**이었다:
 *   ```
 *   화면이 읽던 시각  = erp4 파이어스토어  v4/system_status/sheet_daily_sync · v4/ops/pipeline
 *   화면이 그리는 재고 = erp5 파이어스토어  products      ← 이 파일이 읽는 그것
 *   ```
 *   둘은 서로 모른다. 2026-09-10 에 같은 자리에서 한 번 어긋났었는데(그때는 `ops/pipeline` 만
 *   보다가 `sheet_daily_sync` 를 «하나 더» 보게 고쳤다), **출처를 바꾼 게 아니라 늘린 것**이라
 *   원장이 ERP5 로 옮겨 가자 같은 종류로 또 어긋났다. 하나 더 늘리면 다음에 또 어긋난다.
 *
 * ⇒ **정직한 답은 원자 자신이다.** 수집기가 차 한 대를 쓸 때마다 시각을 같이 찍는다:
 *     `_direct_ingest_at` — 원천에서 직접 받아 쓴 시각 (운영 1,153대)
 *     `_var_polled_at`    — 가변값(요금·상태)을 다시 물어본 시각 (운영 897대)
 *   **화면이 그리는 그 데이터가 스스로 나이를 말하므로, 다시는 엉뚱한 파이프라인을 가리킬 수 없다.**
 *
 * ★★**컬렉션을 통째로 읽지 않는다 — 문서 «둘»만 읽는다.** 칸마다 내림차순 맨 앞 하나씩이다.
 *   위 캐시(60초)를 쓰면 공짜지만, 머리띠는 목록과 «따로» 불릴 수 있어(CDN 이 60초마다 되물음)
 *   캐시가 빈 순간에 1,615건을 통째로 읽는 길이 생긴다. 시각 하나 때문에 그럴 이유가 없다.
 * ⚠ 두 칸은 **단일 필드 색인**으로 도는 질의다(파이어스토어 기본) — 복합 색인이 필요 없다.
 * ⚠ 칸 이름이 바뀌면 여기가 조용히 0 을 준다 — `npm run check:speed` 가 그 이름을 지킨다.
 */
const ATOM_STAMP_FIELDS = ['_direct_ingest_at', '_var_polled_at'] as const;

export async function readErp5StockFreshness(): Promise<number> {
  if (!erp5WhitelabelCutoverRequested()) return 0;
  const db = erp5Firestore();
  const picks = await Promise.all(ATOM_STAMP_FIELDS.map(async (field) => {
    try {
      const snap = await readWithin(
        db.collection('products').orderBy(field, 'desc').limit(1).get(),
        `신선도 ${field}`,
      );
      const ms = Number(snap.docs[0]?.data()?.[field]);
      /* 미래 시각은 안 믿는다 — 시계가 어긋난 기계가 쓴 값이 「방금 갱신」으로 굳으면 더 나쁘다. */
      return Number.isFinite(ms) && ms > 0 && ms <= Date.now() + 3_600_000 ? ms : 0;
    } catch { return 0; }
  }));
  return Math.max(0, ...picks);
}
