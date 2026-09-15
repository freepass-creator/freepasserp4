/** ERP5 스냅샷과 실제 공개 카탈로그 원자의 대사 게이트. */
import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { isListableProduct } from '../lib/domain/product';
import { sanitizeProductForGuest } from '../lib/domain/public-catalog';
import { readSalesPublishSnapshot } from '../lib/server/sales-publish-snapshot';
import { erp5InventoryAppOptions } from '../lib/server/erp5-inventory-service-account';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const file = (process.argv.find((v) => v.startsWith('--snapshot=')) || '').slice(11);
const receipt = process.argv.includes('--write-receipt');
if (!file) throw new Error('--snapshot=파일 경로가 필요합니다.');
function plain(v: unknown): unknown {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof (v as any).toMillis === 'function') return { _timestampMs: (v as any).toMillis() };
  const sec = Number((v as Rec)._seconds ?? (v as Rec).seconds), nano = Number((v as Rec)._nanoseconds ?? (v as Rec).nanoseconds);
  if (Number.isFinite(sec) && Number.isFinite(nano) && ('_seconds' in (v as Rec) || 'seconds' in (v as Rec))) return { _timestampMs: sec * 1000 + Math.floor(nano / 1e6) };
  return Object.fromEntries(Object.entries(v as Rec).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, plain(x)]));
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(plain(v))).digest('hex');
const key = (id: string, p: Rec) => S(p._key) || S(p.product_code) || id;
const policy = (rows: Rec[], code: unknown) => rows.find((p) => S(p._key) === S(code) || S(p.policy_code) === S(code)) || null;
function publicRows(source: Array<{ id: string; data: Rec }>, policies: Rec[]): Rec[] {
  const seen = new Set<string>();
  return source.map(({ id, data }) => ({ id, data: { ...data, _key: S(data._key) || id } })).filter(({ data }) => isListableProduct(data)).map(({ id, data }) => {
    const out = sanitizeProductForGuest(key(id, data), data, policy(policies, data.policy_code)) as Rec;
    return { documentId: id, publicKey: S(out._key), vehicle_status: data.vehicle_status ?? null, status: data.status ?? null, status_kind: data.status_kind ?? null, listable: data.listable ?? null, deleted: data._deleted === true || !!data.deletedAt, price: out.price ?? null, policy_code: data.policy_code ?? null, photo_link: out.photo_link ?? null, image_urls: out.image_urls ?? [], policy: out._policy ?? null };
  }).sort((a, b) => S(a.documentId).localeCompare(S(b.documentId), 'ko')).map((row) => {
    if (!row.publicKey || seen.has(row.publicKey)) throw new Error(`공개 차량 식별자 중복: ${row.publicKey || '(blank)'}`);
    seen.add(row.publicKey); return row;
  });
}
const snapshot = readSalesPublishSnapshot(file);
initializeApp(erp5InventoryAppOptions());
const db = getFirestore();
const [products, policies] = await Promise.all([db.collection('products').get(), db.collection('policy').get()]);
const expectedPolicies = snapshot.policies as Rec[];
const actualPolicies = policies.docs.map((d) => ({ ...d.data(), _key: d.id } as Rec));
const expected = publicRows(snapshot.products.map((p) => ({ id: S((p as Rec)._key), data: p as Rec })), expectedPolicies);
const actual = publicRows(products.docs.map((d) => ({ id: d.id, data: d.data() as Rec })), actualPolicies);
const missing = expected.map((r) => r.documentId).filter((id) => !actual.some((r) => r.documentId === id));
const extra = actual.map((r) => r.documentId).filter((id) => !expected.some((r) => r.documentId === id));
const comparable = (rows: Rec[]) => rows.map(({ publicKey: _ignored, ...row }) => row);
const expectedHash = hash(comparable(expected)), actualHash = hash(comparable(actual));
const policyIds = new Set(actualPolicies.flatMap((p) => [S(p._key), S(p.policy_code)].filter(Boolean)));
const missingPolicies = actual.filter((r) => S(r.policy_code) && !policyIds.has(S(r.policy_code))).map((r) => r.publicKey);
const unresolvedPhotos = actual.filter((r) => S(r.photo_link) && !Array.isArray(r.image_urls)).map((r) => r.publicKey);
const report = { schemaVersion: 2, snapshotId: snapshot.snapshotId, snapshotPayloadHash: snapshot.payloadHash, expected: { publicCount: expected.length, publicHash: expectedHash }, actual: { publicCount: actual.length, publicHash: actualHash }, mismatch: { missingCount: missing.length, extraCount: extra.length, missingPolicyCount: missingPolicies.length, unresolvedPhotoCount: unresolvedPhotos.length, sampleMissing: missing.slice(0, 20), sampleExtra: extra.slice(0, 20), sampleMissingPolicy: missingPolicies.slice(0, 20), sampleUnresolvedPhoto: unresolvedPhotos.slice(0, 20) } };
console.log(JSON.stringify(report, null, 2));
if (missing.length || extra.length || expectedHash !== actualHash || missingPolicies.length || unresolvedPhotos.length) throw new Error(`공개 발행 대사 실패: 누락 ${missing.length} · 추가 ${extra.length} · 값해시 ${expectedHash === actualHash ? '일치' : '불일치'} · 정책미연결 ${missingPolicies.length} · 사진미해결 ${unresolvedPhotos.length}`);
if (receipt) await db.collection('ops').doc('public_catalog_publication').set({ ...report, status: 'verified', verifiedAt: FieldValue.serverTimestamp() });
console.log(`✓ 공개 발행 대사 통과 · ${actual.length}대`);
