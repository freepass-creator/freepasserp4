import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inventoryCountSnapshot, type InventoryCountSnapshot } from '@/lib/domain/inventory-contract';

export const SALES_PUBLISH_SNAPSHOT_VERSION = 1 as const;
/** F01 전체 재작성과 F86 회사별 서식 발행이 한 회차에서 끝날 수 있는 상한. */
// 전체 자동화 상한(70분)보다 길게 둔다. 캡처 뒤 F01을 쓴 다음 F86에서 만료돼 반쪽만 남는 일을 막는다.
export const SALES_PUBLISH_MAX_AGE_MS = 90 * 60_000;

export type SalesPublishSnapshot = {
  version: typeof SALES_PUBLISH_SNAPSHOT_VERSION;
  snapshotId: string;
  capturedAt: string;
  source: 'firestore' | 'freepass-data';
  releaseAuthority?: 'LEGACY_VERIFIED_BRIDGE' | 'CANONICAL_ACTIVE';
  approvedRelease?: {
    projectionId: string;
    releaseId: string;
    manifestId: string;
    inputDigest: string;
    dataDigest: string;
    observedAt: string;
  };
  products: Record<string, unknown>[];
  policies: Record<string, unknown>[];
  partners: Record<string, unknown>[];
  inventory: InventoryCountSnapshot;
  payloadHash: string;
};

/** 사람이 보는 시각과 기계가 구분하는 ID를 한 문패에 함께 둔다. */
export function salesPublishMark(snapshot: Pick<SalesPublishSnapshot, 'capturedAt' | 'snapshotId'>): string {
  const d = new Date(new Date(snapshot.capturedAt).getTime() + 9 * 3600e3);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} · ${snapshot.snapshotId}`;
}

export const hashSalesPublishSnapshotPayload = (value: Omit<SalesPublishSnapshot, 'payloadHash'>) => createHash('sha256')
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
    source: 'firestore',
    products,
    policies,
    partners,
    inventory,
  };
  return { ...unsigned, payloadHash: hashSalesPublishSnapshotPayload(unsigned) };
}

export function readSalesPublishSnapshot(path: string, options: { maxAgeMs?: number } = {}): SalesPublishSnapshot {
  const value = JSON.parse(readFileSync(path, 'utf8')) as SalesPublishSnapshot;
  if (
    value.version !== SALES_PUBLISH_SNAPSHOT_VERSION ||
    !['firestore', 'freepass-data'].includes(value.source)
  ) throw new Error(`지원하지 않는 판매 스냅샷: ${path}`);
  if (!value.snapshotId || !value.capturedAt || !Array.isArray(value.products) || !Array.isArray(value.policies) || !Array.isArray(value.partners)) {
    throw new Error(`불완전한 판매 스냅샷: ${path}`);
  }
  const { payloadHash, ...unsigned } = value;
  const actualHash = hashSalesPublishSnapshotPayload(unsigned);
  if (actualHash !== payloadHash) throw new Error(`판매 스냅샷 해시 불일치: ${path}`);
  if (value.source === 'freepass-data') {
    if (!['LEGACY_VERIFIED_BRIDGE', 'CANONICAL_ACTIVE'].includes(value.releaseAuthority ?? '')) {
      throw new Error(`FreePass Data release authority 누락: ${path}`);
    }
    const release = value.approvedRelease;
    const required = ['projectionId', 'releaseId', 'manifestId', 'inputDigest', 'dataDigest', 'observedAt'] as const;
    if (!release || required.some((key) => !String(release[key] ?? '').trim())) {
      throw new Error(`FreePass Data 승인 release 증거 누락: ${path}`);
    }
    if (!Number.isFinite(Date.parse(release.observedAt))) {
      throw new Error(`FreePass Data 승인 release 시각 오류: ${path}`);
    }
  }
  const ageMs = Date.now() - new Date(value.capturedAt).getTime();
  const maxAgeMs = options.maxAgeMs ?? SALES_PUBLISH_MAX_AGE_MS;
  if (!Number.isFinite(ageMs) || ageMs < -5 * 60_000 || ageMs > maxAgeMs) throw new Error(`판매 스냅샷이 오래됐거나 시각이 잘못됐다: ${path}`);
  const actualInventory = inventoryCountSnapshot(value.products);
  if (value.source === 'freepass-data') {
    const incomingInventory = value.inventory as unknown as Record<string, unknown>;
    const localInventory = actualInventory as unknown as Record<string, unknown>;
    const unsupportedInventoryFields = Object.keys(incomingInventory)
      .filter((key) => !(key in localInventory) && key !== 'depositRuleViolations');
    const depositRuleViolations = incomingInventory.depositRuleViolations ?? 0;
    const mismatch = unsupportedInventoryFields.length > 0 ||
      !Number.isInteger(depositRuleViolations) ||
      Number(depositRuleViolations) !== 0 ||
      Object.entries(localInventory).some(([key, item]) =>
        JSON.stringify(item) !== JSON.stringify(incomingInventory[key])
      );
    if (mismatch) throw new Error(`판매 스냅샷 재고 집계 불일치: ${path}`);
  } else if (JSON.stringify(actualInventory) !== JSON.stringify(value.inventory)) {
    throw new Error(`판매 스냅샷 재고 집계 불일치: ${path}`);
  }
  return value;
}
