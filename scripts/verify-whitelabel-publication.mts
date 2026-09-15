/**
 * ERP5 원천 최신화 회차가 손님 공개 카탈로그와 같은 재고인지 검사한다.
 * 기본은 읽기 전용이고, `--write-receipt`일 때만 통과 영수증을 ERP5에 기록한다.
 */
import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { isListableProduct } from '../lib/domain/product';
import { readSalesPublishSnapshot } from '../lib/server/sales-publish-snapshot';
import { erp5InventoryAppOptions } from '../lib/server/erp5-inventory-service-account';

type Rec = Record<string, any>;
const S = (value: unknown) => String(value ?? '').trim();
const snapshotPath = (process.argv.find((value) => value.startsWith('--snapshot=')) || '').slice('--snapshot='.length);
const WRITE_RECEIPT = process.argv.includes('--write-receipt');
if (!snapshotPath) throw new Error('--snapshot=파일 경로가 필요합니다.');

function plain(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') return { _timestampMs: (value as { toMillis: () => number }).toMillis() };
  return Object.fromEntries(Object.entries(value as Rec).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, plain(item)]));
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(plain(value))).digest('hex');
}

function canonicalKey(documentId: string, product: Rec): string {
  return S(product._key) || S(product.product_code) || documentId;
}

function publicShape(documentId: string, product: Rec): Rec {
  return {
    key: canonicalKey(documentId, product),
    vehicle_status: product.vehicle_status ?? null,
    status: product.status ?? null,
    status_kind: product.status_kind ?? null,
    status_reason: product.status_reason ?? null,
    listable: product.listable ?? null,
    deleted: product._deleted === true || !!product.deletedAt,
    price: product.price ?? null,
    rent_variants: product.rent_variants ?? product.rentVariants ?? null,
    policy_code: product.policy_code ?? null,
    photo_link: product.photo_link ?? null,
  };
}

function publicRows(rows: Array<{ id: string; data: Rec }>): Rec[] {
  const seen = new Set<string>();
  return rows
    .map(({ id, data }) => ({ id, data: { ...data, _key: S(data._key) || id } }))
    .filter(({ data }) => isListableProduct(data))
    .map(({ id, data }) => publicShape(id, data))
    .sort((a, b) => S(a.key).localeCompare(S(b.key), 'ko'))
    .map((row) => {
      if (!S(row.key) || seen.has(S(row.key))) throw new Error(`공개 차량 식별자 중복: ${S(row.key) || '(blank)'}`);
      seen.add(S(row.key));
      return row;
    });
}

const snapshot = readSalesPublishSnapshot(snapshotPath);
initializeApp(erp5InventoryAppOptions());
const db = getFirestore();
const [productSnap, policySnap] = await Promise.all([db.collection('products').get(), db.collection('policy').get()]);
const expectedRows = publicRows(snapshot.products.map((value) => ({ id: S((value as Rec)._key), data: value as Rec })));
const actualRows = publicRows(productSnap.docs.map((document) => ({ id: document.id, data: document.data() as Rec })));
const expectedKeys = expectedRows.map((row) => row.key);
const actualKeys = actualRows.map((row) => row.key);
const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
const extra = actualKeys.filter((key) => !expectedKeys.includes(key));
const expectedHash = digest(expectedRows);
const actualHash = digest(actualRows);
const policyByCode = new Set(policySnap.docs.flatMap((document) => {
  const policy = document.data() as Rec;
  return [S(document.id), S(policy._key), S(policy.policy_code)].filter(Boolean);
}));
const missingPolicies = actualRows.filter((row) => S(row.policy_code) && !policyByCode.has(S(row.policy_code))).map((row) => row.key);
const photoMissing = actualRows.filter((row) => !S(row.photo_link)).map((row) => row.key);
const report = {
  schemaVersion: 1,
  snapshotId: snapshot.snapshotId,
  snapshotPayloadHash: snapshot.payloadHash,
  expected: { publicCount: expectedRows.length, publicHash: expectedHash },
  actual: { publicCount: actualRows.length, publicHash: actualHash },
  mismatch: {
    missingCount: missing.length, extraCount: extra.length, missingPolicyCount: missingPolicies.length, missingPhotoCount: photoMissing.length,
    sampleMissing: missing.slice(0, 20), sampleExtra: extra.slice(0, 20),
    sampleMissingPolicy: missingPolicies.slice(0, 20), sampleMissingPhoto: photoMissing.slice(0, 20),
  },
};
console.log(JSON.stringify(report, null, 2));

if (missing.length || extra.length || expectedHash !== actualHash || missingPolicies.length) {
  throw new Error(`공개 발행 대사 실패: 누락 ${missing.length} · 추가 ${extra.length} · 값해시 ${expectedHash === actualHash ? '일치' : '불일치'} · 정책미연결 ${missingPolicies.length}`);
}
if (WRITE_RECEIPT) {
  await db.collection('ops').doc('public_catalog_publication').set({ ...report, status: 'verified', verifiedAt: FieldValue.serverTimestamp() });
}
console.log(`✓ 공개 발행 대사 통과 · ${actualRows.length}대 · 사진 미연결 ${photoMissing.length}대`);
