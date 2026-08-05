import type { EntityRecord } from '@/lib/intake/entities';
import type { IronRentcarReconcilePlan } from '@/lib/domain/ironrentcar-reconcile';
import { productPatchPreconditionMatches } from '@/lib/domain/product-write-guard';
import { splitProductPrivate } from '@/lib/firebase/rtdb-products';

export type IronRentcarOverlayApplyResult = {
  ok: boolean;
  overlay: Record<string, EntityRecord>;
  conflicts: string[];
  updated: number;
  created: number;
  absentBlocked: number;
};

const text = (value: unknown): string => String(value ?? '').trim();
const plateOf = (row: EntityRecord): string => text(row.car_number || row.vehicle_number).replace(/\s/g, '');
const providerOf = (row: EntityRecord): string => text(row.provider_company_code || row.partner_code);

function cleanUndefined(value: EntityRecord): EntityRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function active(row: EntityRecord): boolean {
  return row._deleted !== true && !row.deletedAt && text(row.status) !== 'deleted';
}

/**
 * 서버가 준비 원장을 만든 뒤 실행하는 `v4` root transaction의 상품 계산용 순수 적용기다.
 * affected 공개 상품이 한 번에 commit되거나, 한 건의 CAS/중복 충돌에도 전부 중단된다.
 * 차량가·VIN·계좌·수수료는 이 경로에 들어오지 않는다.
 */
export function applyIronRentcarPublicOverlay(input: {
  currentOverlay: unknown;
  plan: IronRentcarReconcilePlan;
  now: string;
  runId?: string;
  revision?: string;
}): IronRentcarOverlayApplyResult {
  const overlay = { ...((input.currentOverlay || {}) as Record<string, EntityRecord>) };
  const conflicts: string[] = [];
  const existingOperations = [
    ...input.plan.patchCandidates.map((candidate) => ({ candidate, absent: false })),
    ...input.plan.absentBlockCandidates.map((candidate) => ({ candidate, absent: true })),
  ];

  for (const { candidate, absent } of existingOperations) {
    const current = overlay[candidate.key] && typeof overlay[candidate.key] === 'object'
      ? overlay[candidate.key]
      : null;
    const publicPatch = splitProductPrivate(candidate.patch).publicRecord;
    const expectedPublic = splitProductPrivate(candidate.expected).publicRecord;
    if (!productPatchPreconditionMatches(current, expectedPublic, publicPatch, { overlayFallback: true })) {
      conflicts.push(candidate.key);
      continue;
    }
    overlay[candidate.key] = cleanUndefined({
      ...(current || {}),
      ...publicPatch,
      _key: candidate.key,
      product_code: text(candidate.expected.product_code || candidate.key),
      provider_company_code: publicPatch.provider_company_code || candidate.expected.provider_company_code,
      updatedAt: input.now,
      ...(input.runId ? { ironrentcar_sync_run_id: input.runId } : {}),
      ...(input.revision ? { ironrentcar_sync_revision: input.revision } : {}),
      ...(input.runId || input.revision ? { ironrentcar_synced_at: input.now } : {}),
      ...(absent ? { ironrentcar_blocked_at: input.now } : {}),
    });
  }

  for (const product of input.plan.createCandidates) {
    const publicProduct = splitProductPrivate(product).publicRecord;
    const key = text(publicProduct.product_code || publicProduct._key);
    const plate = plateOf(publicProduct);
    const currentAtKey = overlay[key] && typeof overlay[key] === 'object' ? overlay[key] : null;
    // 같은 canonical key의 삭제 tombstone은 홈페이지에서 차량이 다시 판매중으로
    // 등장했을 때 새 활성 overlay로 교체한다. 활성 row가 있으면 기존대로 CAS 충돌이다.
    if (!key || !plate || (currentAtKey && active(currentAtKey))) {
      conflicts.push(key || `plate:${plate || 'missing'}`);
      continue;
    }
    const raced = Object.entries(overlay).some(([otherKey, row]) => otherKey !== key
      && row && typeof row === 'object' && active(row)
      && providerOf(row) === input.plan.providerCode && plateOf(row) === plate);
    if (raced) {
      conflicts.push(key);
      continue;
    }
    overlay[key] = cleanUndefined({
      ...publicProduct,
      _key: key,
      product_code: key,
      provider_company_code: input.plan.providerCode,
      createdAt: input.now,
      updatedAt: input.now,
      ...(input.runId ? { ironrentcar_sync_run_id: input.runId } : {}),
      ...(input.revision ? { ironrentcar_sync_revision: input.revision } : {}),
      ...(input.runId || input.revision ? { ironrentcar_synced_at: input.now } : {}),
    });
  }

  return {
    ok: conflicts.length === 0,
    overlay,
    conflicts: [...new Set(conflicts)],
    updated: input.plan.patchCandidates.length,
    created: input.plan.createCandidates.length,
    absentBlocked: input.plan.absentBlockCandidates.length,
  };
}
