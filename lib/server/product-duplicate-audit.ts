import 'server-only';

import type { EntityRecord } from '@/lib/intake/entities';
import {
  planProductDuplicateMigration,
  productDuplicateMigrationTsv,
} from '@/lib/domain/product-duplicate-migration';
import {
  planProductDuplicateDryRun,
  productDuplicateDryRunTsv,
} from '@/lib/domain/product-duplicate-dry-run';
import { firebaseAdminStore } from '@/lib/server/firebase-admin';
import { splitProductPrivate } from '@/lib/firebase/product-private';
import { mergeV3V4Records } from '@/lib/firebase/legacy-records';

function mergeNodes(v3: unknown, v4: unknown): EntityRecord[] {
  const rows = new Map<string, EntityRecord>();
  for (const [key, value] of Object.entries((v3 || {}) as Record<string, EntityRecord>)) {
    if (value && typeof value === 'object') rows.set(key, { ...value, _key: key });
  }
  for (const [key, value] of Object.entries((v4 || {}) as Record<string, EntityRecord>)) {
    if (!value || typeof value !== 'object') continue;
    rows.set(key, { ...(rows.get(key) || {}), ...value, _key: key });
  }
  return [...rows.values()];
}

export async function auditProductDuplicateReferences(): Promise<{
  generatedAt: number;
  summary: {
    duplicateGroups: number;
    relatedProducts: number;
    representativeCandidates: number;
    candidateGroupsWithoutDetectedBlocker: number;
    blockedGroups: number;
    exactContractReferences: number;
    exactRoomReferences: number;
    exactQuoteReferences: number;
    privateProductRecords: number;
    plateOnlyReferenceGroups: number;
    plateOnlyReferences: number;
    dryRunEligibleGroups: number;
    dataConflictGroups: number;
    eligibleOperations: number;
    eligibleDestructiveOperations: number;
    eligibleClaudeGateOperations: number;
    accountMismatchGroups: number;
    redundantAccountGroups: number;
  };
  tsv: string;
  dryRunTsv: string;
}> {
  const db = firebaseAdminStore();
  const [productsSnap, contractsSnap, roomsSnap, quotesSnap, productPrivateSnap, partnersSnap] = await Promise.all([
    db.ref('products').get(),
    db.ref('contracts').get(),
    db.ref('rooms').get(),
    db.ref('quote').get(),
    db.ref('products_private').get(),
    db.ref('partners').get(),
  ]);
  const rawProducts = mergeV3V4Records('product', {}, productsSnap.val());
  const legacyPrivate = new Map<string, EntityRecord>();
  const products = rawProducts.map((product) => {
    const split = splitProductPrivate(product);
    const key = String(product.product_code || product._key || '');
    if (split.privateRecord && key) legacyPrivate.set(key, split.privateRecord);
    return split.publicRecord;
  });
  const contracts = mergeNodes({}, contractsSnap.val());
  const rooms = mergeNodes({}, roomsSnap.val());
  const quotes = mergeNodes({}, quotesSnap.val());
  const productPrivateByKey = new Map(legacyPrivate);
  for (const row of mergeNodes({}, productPrivateSnap.val())) {
    const key = String(row.product_code || row._key || '');
    if (!key) continue;
    productPrivateByKey.set(key, { ...(productPrivateByKey.get(key) || {}), ...row, _key: key, product_code: key });
  }
  const productPrivate = [...productPrivateByKey.values()];
  const partners = mergeNodes({}, partnersSnap.val());
  const providerCodes = partners
    .map((row) => String(row.partner_code || row._key || '').trim())
    .filter(Boolean);
  const groups = planProductDuplicateMigration({
    products,
    contracts,
    rooms,
    quotes,
    productPrivate,
    providerCodes,
    scan: { contracts: true, rooms: true, quotes: true, productPrivate: true },
  });
  const dryRunGroups = planProductDuplicateDryRun({
    products,
    contracts,
    rooms,
    quotes,
    productPrivate,
    partners,
    providerCodes,
  });
  const records = groups.flatMap((group) => group.records);
  const eligibleDryRun = dryRunGroups.filter((group) => group.eligible);
  const eligibleOperations = eligibleDryRun.flatMap((group) => group.operations);
  return {
    generatedAt: Date.now(),
    summary: {
      duplicateGroups: groups.length,
      relatedProducts: records.length,
      representativeCandidates: groups.filter((group) => group.representativeCandidate).length,
      candidateGroupsWithoutDetectedBlocker: groups.filter((group) => !group.blockers.length).length,
      blockedGroups: groups.filter((group) => group.blockers.length > 0).length,
      exactContractReferences: records.reduce(
        (sum, row) => sum + row.openContractRefs.length + row.historicalContractRefs.length,
        0,
      ),
      exactRoomReferences: records.reduce((sum, row) => sum + row.roomRefs.length, 0),
      exactQuoteReferences: records.reduce((sum, row) => sum + row.quoteRefs.length, 0),
      privateProductRecords: records.filter((row) => row.hasPrivateRecord).length,
      plateOnlyReferenceGroups: groups.filter((group) => group.plateOnlyReferences > 0).length,
      plateOnlyReferences: groups.reduce((sum, group) => sum + group.plateOnlyReferences, 0),
      dryRunEligibleGroups: eligibleDryRun.length,
      dataConflictGroups: dryRunGroups.filter((group) =>
        group.publicConflictFields.length > 0
        || group.privateConflictFields.length > 0
        || group.publicUnclassifiedFields.length > 0
        || group.privateUnclassifiedFields.length > 0).length,
      eligibleOperations: eligibleOperations.length,
      eligibleDestructiveOperations: eligibleOperations.filter((operation) => operation.destructive).length,
      eligibleClaudeGateOperations: eligibleOperations.filter((operation) => operation.claudeGate).length,
      accountMismatchGroups: dryRunGroups.filter((group) => group.accountNumberDisposition.includes('불일치')).length,
      redundantAccountGroups: dryRunGroups.filter((group) => group.accountNumberDisposition.includes('중복값')).length,
    },
    tsv: productDuplicateMigrationTsv(groups),
    dryRunTsv: productDuplicateDryRunTsv(dryRunGroups),
  };
}
