import 'server-only';

import { createHash } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import type { ActiveBearer } from '@/lib/server/firebase-admin';
import type { EntityRecord } from '@/lib/intake/entities';
import { hasDepositClaim } from '@/lib/domain/contract';
import { vehicleIdentity } from '@/lib/domain/product';
import {
  canTransitionVehicleClaim,
  markVehicleClaimReleasing,
  reserveVehicleClaim,
  type VehicleClaimRecord,
  type VehicleClaimStepKey,
} from '@/lib/domain/vehicle-claim';

type Rec = Record<string, unknown>;

export class VehicleClaimConflictError extends Error {
  constructor(message: string, readonly owner = '') { super(message); }
}

export function vehicleClaimServerEnabled(): boolean {
  return String(process.env.VEHICLE_CLAIM_SERVER_ENABLED || '').trim().toLowerCase() === 'true';
}

const text = (value: unknown): string => String(value ?? '').trim();
const asMap = (value: unknown): Record<string, Rec> => value && typeof value === 'object' ? value as Record<string, Rec> : {};

function mergeMaps(legacyRaw: unknown, overlayRaw: unknown): Record<string, EntityRecord> {
  const legacy = asMap(legacyRaw);
  const overlay = asMap(overlayRaw);
  const keys = new Set([...Object.keys(legacy), ...Object.keys(overlay)]);
  const out: Record<string, EntityRecord> = {};
  for (const key of keys) out[key] = { ...(legacy[key] || {}), ...(overlay[key] || {}), _key: key } as EntityRecord;
  return out;
}

function identityOf(contract: EntityRecord, products: Record<string, EntityRecord>): string | null {
  const direct = vehicleIdentity({ car_number: contract.car_number_snapshot || contract.car_number, vin: contract.vin_snapshot || contract.vin });
  if (direct) return direct;
  const productCode = text(contract.product_code);
  const product = products[productCode];
  return product ? vehicleIdentity(product) : null;
}

function identityHash(identity: string): string {
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

async function loadSnapshot(db: Database) {
  const [legacyContracts, overlayContracts, legacyProducts, overlayProducts] = await Promise.all([
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
    db.ref('products').get(), db.ref('v4/products').get(),
  ]);
  return {
    contracts: mergeMaps(legacyContracts.val(), overlayContracts.val()),
    products: mergeMaps(legacyProducts.val(), overlayProducts.val()),
  };
}

function assertTransition(actor: ActiveBearer, contract: EntityRecord, key: VehicleClaimStepKey) {
  if (!canTransitionVehicleClaim(actor, contract, key)) {
    throw new VehicleClaimConflictError('이 계약의 입금 선점을 변경할 권한이 없습니다.');
  }
  if (text(contract.contract_status) === '계약취소') {
    throw new VehicleClaimConflictError('취소된 계약은 차량을 선점할 수 없습니다.');
  }
}

function rivalForIdentity(
  contracts: Record<string, EntityRecord>,
  products: Record<string, EntityRecord>,
  identity: string,
  exceptContractCode: string,
): string {
  for (const [code, contract] of Object.entries(contracts)) {
    if (code === exceptContractCode || text(contract.contract_status) === '계약취소') continue;
    if (identityOf(contract, products) !== identity) continue;
    if (text(contract.contract_status) === '계약완료' || hasDepositClaim(contract)) return code;
  }
  return '';
}

function lockedProductRival(
  products: Record<string, EntityRecord>,
  identity: string,
  exceptContractCode: string,
): { productCode: string; owner: string; status: string } | null {
  for (const [productCode, product] of Object.entries(products)) {
    if (vehicleIdentity(product) !== identity) continue;
    const status = text(product.vehicle_status);
    const owner = text(product.locked_by_contract);
    if ((status === '계약중' || status === '출고불가') && owner && owner !== exceptContractCode) {
      return { productCode, owner, status };
    }
  }
  return null;
}

export type VehicleClaimTransitionResult = {
  contractCode: string;
  productCode: string;
  identityHash: string;
  contractPatch: EntityRecord;
  productPatch: EntityRecord;
};

export async function transitionVehicleClaim(
  db: Database,
  actor: ActiveBearer,
  input: { contractCode: string; key: VehicleClaimStepKey; value: string },
): Promise<VehicleClaimTransitionResult> {
  const snapshot = await loadSnapshot(db);
  const contract = snapshot.contracts[input.contractCode];
  if (!contract) throw new VehicleClaimConflictError('계약을 찾을 수 없습니다.');
  assertTransition(actor, contract, input.key);

  const productCode = text(contract.product_code);
  const product = snapshot.products[productCode];
  if (!productCode || !product) throw new VehicleClaimConflictError('계약 차량을 찾을 수 없습니다.');
  const identity = identityOf(contract, snapshot.products);
  if (!identity) throw new VehicleClaimConflictError('차량번호 또는 VIN이 없어 원자 선점을 진행할 수 없습니다.');
  const hash = identityHash(identity);
  const claimRef = db.ref(`v4/vehicle_claims/${hash}`);
  const now = Date.now();

  if (input.value === 'yes') {
    const rival = rivalForIdentity(snapshot.contracts, snapshot.products, identity, input.contractCode);
    if (rival) throw new VehicleClaimConflictError(`이미 계약금이 확인된 계약(${rival})이 있는 차량입니다 — 선점 불가`, rival);
    const lockedTwin = lockedProductRival(snapshot.products, identity, input.contractCode);
    if (lockedTwin) {
      throw new VehicleClaimConflictError(
        `같은 차량의 다른 매물(${lockedTwin.productCode})이 이미 ${lockedTwin.status} 상태입니다(계약 ${lockedTwin.owner}) — 중복 계약 불가`,
        lockedTwin.owner,
      );
    }
    const status = text(product.vehicle_status);
    const productOwner = text(product.locked_by_contract);
    if (status === '출고불가' && !productOwner) {
      throw new VehicleClaimConflictError('이 차량은 공급사가 출고불가로 보류한 차량입니다 — 선점 불가');
    }
    if ((status === '계약중' || status === '출고불가') && productOwner && productOwner !== input.contractCode) {
      throw new VehicleClaimConflictError(`이 차량은 이미 ${status} 상태입니다(계약 ${productOwner}) — 중복 계약 불가`, productOwner);
    }

    const request = {
      contract_code: input.contractCode,
      product_code: productCode,
      identity_hash: hash,
      actor_uid: actor.uid,
    };
    let observedOwner = '';
    const reserved = await claimRef.transaction((raw) => {
      const current = raw && typeof raw === 'object' ? raw as VehicleClaimRecord : null;
      observedOwner = text(current?.contract_code);
      return reserveVehicleClaim(current, request, now) ?? undefined;
    }, undefined, false);
    if (!reserved.committed) {
      throw new VehicleClaimConflictError(`같은 차량을 다른 계약(${observedOwner || '확인 중'})이 먼저 선점했습니다.`, observedOwner);
    }

    const contractPatch: EntityRecord = { [input.key]: 'yes', vehicle_identity_hash: hash };
    const productPatch: EntityRecord = { vehicle_status: '계약중', locked_by_contract: input.contractCode };
    await db.ref('v4').update({
      [`contracts/${input.contractCode}/${input.key}`]: 'yes',
      [`contracts/${input.contractCode}/vehicle_identity_hash`]: hash,
      [`contracts/${input.contractCode}/updatedAt`]: new Date(now).toISOString(),
      [`products/${productCode}/vehicle_status`]: '계약중',
      [`products/${productCode}/locked_by_contract`]: input.contractCode,
      [`products/${productCode}/updatedAt`]: new Date(now).toISOString(),
      [`vehicle_claims/${hash}/status`]: 'active',
      [`vehicle_claims/${hash}/updated_at`]: now,
    });
    return { contractCode: input.contractCode, productCode, identityHash: hash, contractPatch, productPatch };
  }

  // 한 계약에서 영업 입금과 공급사 입금확인이 모두 있을 수 있다. 하나만 해제하면 claim은 유지한다.
  const nextContract = { ...contract, [input.key]: input.value } as EntityRecord;
  const keepClaim = hasDepositClaim(nextContract) || text(contract.contract_status) === '계약완료';
  if (keepClaim) {
    const contractPatch: EntityRecord = { [input.key]: input.value };
    await db.ref(`v4/contracts/${input.contractCode}`).update({ ...contractPatch, updatedAt: new Date(now).toISOString() });
    return { contractCode: input.contractCode, productCode, identityHash: hash, contractPatch, productPatch: {} };
  }

  let observedOwner = '';
  const releasing = await claimRef.transaction((raw) => {
    const current = raw && typeof raw === 'object' ? raw as VehicleClaimRecord : null;
    observedOwner = text(current?.contract_code);
    if (!current) return null;
    return markVehicleClaimReleasing(current, input.contractCode, now) ?? undefined;
  }, undefined, false);
  if (!releasing.committed && observedOwner && observedOwner !== input.contractCode) {
    throw new VehicleClaimConflictError(`차량 선점 소유자가 다른 계약(${observedOwner})입니다.`, observedOwner);
  }

  const ownsProduct = text(product.locked_by_contract) === input.contractCode;
  const contractPatch: EntityRecord = { [input.key]: input.value };
  const productPatch: EntityRecord = ownsProduct ? { vehicle_status: '출고가능', locked_by_contract: '' } : {};
  await db.ref('v4').update({
    [`contracts/${input.contractCode}/${input.key}`]: input.value || null,
    [`contracts/${input.contractCode}/updatedAt`]: new Date(now).toISOString(),
    ...(ownsProduct ? {
      [`products/${productCode}/vehicle_status`]: '출고가능',
      [`products/${productCode}/locked_by_contract`]: '',
      [`products/${productCode}/updatedAt`]: new Date(now).toISOString(),
    } : {}),
    [`vehicle_claims/${hash}`]: null,
  });
  return { contractCode: input.contractCode, productCode, identityHash: hash, contractPatch, productPatch };
}

export async function releaseCancelledVehicleClaim(
  db: Database,
  actor: ActiveBearer,
  contractCode: string,
): Promise<VehicleClaimTransitionResult | null> {
  const snapshot = await loadSnapshot(db);
  const contract = snapshot.contracts[contractCode];
  if (!contract) throw new VehicleClaimConflictError('계약을 찾을 수 없습니다.');
  // 취소 권한 범위는 계약 접근 범위와 동일하게 보수적으로 확인한다. 단계키는 역할별 두 경우 중 하나를 사용한다.
  const allowed = canTransitionVehicleClaim(actor, contract, 'agent_balance_paid')
    || canTransitionVehicleClaim(actor, contract, 'provider_balance_confirmed');
  if (!allowed) throw new VehicleClaimConflictError('이 계약의 차량 선점을 해제할 권한이 없습니다.');
  if (text(contract.contract_status) !== '계약취소') throw new VehicleClaimConflictError('취소된 계약만 선점을 해제할 수 있습니다.');

  const productCode = text(contract.product_code);
  const product = snapshot.products[productCode];
  const identity = identityOf(contract, snapshot.products);
  if (!product || !identity) return null;
  const hash = text(contract.vehicle_identity_hash) || identityHash(identity);
  const claimRef = db.ref(`v4/vehicle_claims/${hash}`);
  const now = Date.now();
  let observedOwner = '';
  const releasing = await claimRef.transaction((raw) => {
    const current = raw && typeof raw === 'object' ? raw as VehicleClaimRecord : null;
    observedOwner = text(current?.contract_code);
    if (!current) return null;
    return markVehicleClaimReleasing(current, contractCode, now) ?? undefined;
  }, undefined, false);
  if (!releasing.committed && observedOwner && observedOwner !== contractCode) {
    throw new VehicleClaimConflictError(`차량 선점 소유자가 다른 계약(${observedOwner})입니다.`, observedOwner);
  }
  const ownsProduct = text(product.locked_by_contract) === contractCode;
  const productPatch: EntityRecord = ownsProduct ? { vehicle_status: '출고가능', locked_by_contract: '' } : {};
  await db.ref('v4').update({
    ...(ownsProduct ? {
      [`products/${productCode}/vehicle_status`]: '출고가능',
      [`products/${productCode}/locked_by_contract`]: '',
      [`products/${productCode}/updatedAt`]: new Date(now).toISOString(),
    } : {}),
    [`vehicle_claims/${hash}`]: null,
  });
  return { contractCode, productCode, identityHash: hash, contractPatch: {}, productPatch };
}
