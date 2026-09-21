import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { salesBannerMark } from '../domain/sales-sheet-banner';
import { inventoryCountSnapshot, type InventoryCountSnapshot } from '@/lib/domain/inventory-contract';

export const SALES_PUBLISH_SNAPSHOT_VERSION = 1 as const;
/** F01 전체 재작성과 F86 회사별 서식 발행이 한 회차에서 끝날 수 있는 상한. */
// 전체 자동화 상한(70분)보다 길게 둔다. 캡처 뒤 F01을 쓴 다음 F86에서 만료돼 반쪽만 남는 일을 막는다.
export const SALES_PUBLISH_MAX_AGE_MS = 90 * 60_000;

export type SalesPublishSnapshot = {
  version: typeof SALES_PUBLISH_SNAPSHOT_VERSION;
  snapshotId: string;
  capturedAt: string;
  /** Optional only for backward-compatible reading of pre-contract snapshots. */
  timeZone?: 'Asia/Seoul';
  revision?: string;
  source: 'firestore';
  products: Record<string, unknown>[];
  policies: Record<string, unknown>[];
  partners: Record<string, unknown>[];
  inventory: InventoryCountSnapshot;
  payloadHash: string;
};

/** 사람이 보는 시각과 기계가 구분하는 ID를 한 문패에 함께 둔다. */
export function salesPublishMark(snapshot: Pick<SalesPublishSnapshot, 'capturedAt' | 'snapshotId'>): string {
  return `${salesPublishTabMark(snapshot)} · ${snapshot.snapshotId}`;
}

/**
 * 탭 이름용 시각 문패 — 스냅샷ID 없이(사장님 2026-09-11 「탭이름…」). 사람이 보는 탭엔 시각만, ID는 발행 로그·검사(스냅샷 파일)에.
 * ⚠ **초는 안 찍는다.** 콜론 두 개짜리 시각(`10:05:11`)을 탭 이름에 싱글쿼트로 감싸 A1 범위로 보내면
 *   Sheets API가 "Unable to parse range"로 값 쓰기를 통째로 거부한다(실측 — 운영 F86 발행이 하루 동안
 *   이 이유로 계속 실패했다: run 35164517528 등). F01(`make-sample-sheet-google.mts` `titleOf`)은 이미
 *   `.replace(/:\d{2}$/, '')`로 초를 잘라 콜론을 하나만 남긴다 — 같은 값을 여기서도 만든다.
 */
export function salesPublishTabMark(snapshot: Pick<SalesPublishSnapshot, 'capturedAt'>): string {
  return salesBannerMark(snapshot.capturedAt);
}

const hashPayload = (value: Omit<SalesPublishSnapshot, 'payloadHash'>) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

export async function captureSalesPublishSnapshot(db: any): Promise<SalesPublishSnapshot> {
  // 세 컬렉션을 Firestore 읽기 전용 트랜잭션의 같은 일관 시점에서 고정한다.
  const [productSnap, policySnap, partnerSnap] = await db.runTransaction(async (tx: any) => {
    const products = await tx.get(db.collection('products'));
    const policies = await tx.get(db.collection('policy'));
    const partners = await tx.get(db.collection('partner'));
    return [products, policies, partners];
  }, { readOnly: true });
  const map = (snap: any) => snap.docs
    .map((doc: any) => ({ ...doc.data(), _key: doc.id }))
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(a._key).localeCompare(String(b._key), 'ko'));
  const products = map(productSnap);
  const policies = map(policySnap);
  const partners = map(partnerSnap);
  const capturedAt = new Date().toISOString();
  const inventory = inventoryCountSnapshot(products);
  const unsigned: Omit<SalesPublishSnapshot, 'payloadHash'> = {
    version: SALES_PUBLISH_SNAPSHOT_VERSION,
    snapshotId: `${capturedAt.replace(/[-:.TZ]/g, '').slice(0, 17)}-${randomBytes(6).toString('hex')}`,
    capturedAt,
    timeZone: 'Asia/Seoul',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    source: 'firestore',
    products,
    policies,
    partners,
    inventory,
  };
  return { ...unsigned, payloadHash: hashPayload(unsigned) };
}

export function readSalesPublishSnapshot(path: string, options: { maxAgeMs?: number } = {}): SalesPublishSnapshot {
  const value = JSON.parse(readFileSync(path, 'utf8')) as SalesPublishSnapshot;
  if (value.version !== SALES_PUBLISH_SNAPSHOT_VERSION || value.source !== 'firestore') throw new Error(`지원하지 않는 판매 스냅샷: ${path}`);
  if (!value.snapshotId || !value.capturedAt || !Array.isArray(value.products) || !Array.isArray(value.policies) || !Array.isArray(value.partners)) {
    throw new Error(`불완전한 판매 스냅샷: ${path}`);
  }
  const { payloadHash, ...unsigned } = value;
  const actualHash = hashPayload(unsigned);
  if (actualHash !== payloadHash) throw new Error(`판매 스냅샷 해시 불일치: ${path}`);
  const ageMs = Date.now() - new Date(value.capturedAt).getTime();
  const maxAgeMs = options.maxAgeMs ?? SALES_PUBLISH_MAX_AGE_MS;
  if (!Number.isFinite(ageMs) || ageMs < -5 * 60_000 || ageMs > maxAgeMs) throw new Error(`판매 스냅샷이 오래됐거나 시각이 잘못됐다: ${path}`);
  const actualInventory = inventoryCountSnapshot(value.products);
  if (JSON.stringify(actualInventory) !== JSON.stringify(value.inventory)) throw new Error(`판매 스냅샷 재고 집계 불일치: ${path}`);
  return value;
}
