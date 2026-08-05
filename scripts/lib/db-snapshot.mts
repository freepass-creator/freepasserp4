/**
 * **RTDB 스냅샷 1회 다운로드 + 파일 캐시.**
 *
 * 왜 필요한가: 검수 스크립트가 저마다 `db.ref('products').get()` 으로 전체 노드를 받는다.
 * products 만 5,818 + 5,657 건이고 전체 export 가 27MB 다. 이걸 JS 객체로 펼치면 수백MB 다.
 * 스크립트를 `for` 루프로 공급사마다 돌리면 그게 곱해지고, Git Bash 의 fork 흉내가
 * 그 압력에 먼저 무너진다 — 실제로 `cygheap read copy failed` · `Win32 error 1455`
 * (ERROR_COMMITMENT_LIMIT) 로 PC 가 멈췄다.
 *
 * 그래서 한 번 받아 `tmp/.db-cache/` 에 두고 재사용한다. 기본 TTL 10분 —
 * 검수 한 세션 동안은 같은 스냅샷을 보는 게 오히려 정합에 맞다(중간에 값이 바뀌면 대조가 흔들린다).
 *
 *   import { snapshot } from './lib/db-snapshot.mts';
 *   const db = await snapshot();          // { products, v4Products, partners, ... }
 *   await snapshot({ refresh: true });    // 강제 갱신
 *
 * 쓰기는 이 모듈을 쓰지 않는다 — 쓰기는 항상 최신 상태에서 해야 하므로 직접 admin SDK 를 쓴다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const CACHE_DIR = 'tmp/.db-cache';
const CACHE_FILE = `${CACHE_DIR}/snapshot.json`;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** 스냅샷에 담는 노드 — 검수에 실제로 쓰는 것만. 메시지처럼 큰 건 필요할 때 따로 받는다. */
const NODES = [
  ['products', 'products'],
  ['v4Products', 'v4/products'],
  ['productsPrivate', 'products_private'],
  ['v4ProductsPrivate', 'v4/products_private'],
  ['partners', 'partners'],
  ['v4Partners', 'v4/partners'],
  ['contracts', 'contracts'],
  ['v4Contracts', 'v4/contracts'],
  ['master', 'vehicle_master'],
  ['v4Master', 'v4/vehicle_master'],
] as const;

export type Rec = Record<string, unknown>;
export type Snapshot = Record<(typeof NODES)[number][0], Record<string, Rec>> & { _fetchedAt: string };

let memo: Snapshot | null = null;

/** v3 ∪ v4 필드 단위 병합 — 키 단위로 덮으면 v4 부분 오버레이가 v3 필드를 통째로 날린다. */
export function mergeNodes(v3: Record<string, Rec>, v4: Record<string, Rec>): Record<string, Rec> {
  const m: Record<string, Rec> = {};
  for (const [k, v] of Object.entries(v3 || {})) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries(v4 || {})) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
}

export async function snapshot(opts: { refresh?: boolean; ttlMs?: number } = {}): Promise<Snapshot> {
  if (memo && !opts.refresh) return memo;
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;

  if (!opts.refresh && existsSync(CACHE_FILE)) {
    const age = Date.now() - statSync(CACHE_FILE).mtimeMs;
    if (age < ttl) {
      memo = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Snapshot;
      console.log(`[snapshot] 캐시 사용 (${Math.round(age / 1000)}초 전 · ${CACHE_FILE})`);
      return memo;
    }
  }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  console.log(`[snapshot] RTDB 내려받는 중 (${NODES.length}노드)…`);
  const vals = await Promise.all(NODES.map(([, path]) => db.ref(path).get()));
  const out = { _fetchedAt: new Date().toISOString() } as Snapshot;
  NODES.forEach(([key], i) => { (out as Record<string, unknown>)[key] = (vals[i].val() || {}) as Record<string, Rec>; });

  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(out), 'utf8');
  memo = out;
  console.log(`[snapshot] 저장 → ${CACHE_FILE}`);
  return out;
}

/** 살아있는 매물(v3∪v4, 소프트삭제·deleted 제외). */
export function liveProducts(s: Snapshot): Rec[] {
  const S = (v: unknown) => String(v ?? '').trim();
  return Object.values(mergeNodes(s.products, s.v4Products))
    .filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted');
}
