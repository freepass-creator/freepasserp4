/** 검증된 ERP5 상품·차종 draft 두 개를 같은 release로 원자적 활성화한다. */
import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { ssotContentHash } from '../lib/domain/ssot-content-hash';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
const productVersion = arg('products');
const vehicleVersion = arg('vehicle');
const releaseId = arg('release') || `release-${new Date().toISOString().replace(/[-:.]/g, '')}`;
const projectId = process.env.ERP5_FIREBASE_PROJECT_ID || 'erp5-3e2fc';
for (const [label, value] of [['products', productVersion], ['vehicle', vehicleVersion], ['release', releaseId]]) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(value)) throw new Error(`${label} ID 형식 오류`);
}

const raw = String(process.env.ERP5_FIREBASE_WRITER_SERVICE_ACCOUNT_JSON || '').trim();
if (!raw) throw new Error('ERP5_FIREBASE_WRITER_SERVICE_ACCOUNT_JSON 미설정');
const account = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
if (!account.project_id || !account.client_email || !account.private_key) throw new Error('ERP5 writer 서비스계정 형식 오류');
if (account.project_id !== projectId) throw new Error(`ERP5 writer 프로젝트 불일치: ${account.project_id}`);
account.private_key = account.private_key.replace(/\\n/g, '\n');

const app = initializeApp({
  credential: cert({ projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key } as ServiceAccount),
  projectId,
}, `erp5-release-promote-${Date.now()}`);
const db = getFirestore(app);

type Checked = {
  ref: DocumentReference;
  versionId: string;
  count: number;
  contentHash: string;
  metadata: Record<string, unknown>;
  rows: Array<{ id: string; data: Record<string, unknown> }>;
};

async function checkVersion(collection: string, child: string, versionId: string): Promise<Checked> {
  const ref = db.collection(collection).doc(versionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error(`${collection}/${versionId} 없음`);
  const metadata = snapshot.data() as Record<string, unknown>;
  if (metadata.status !== 'validated') throw new Error(`${collection}/${versionId} 상태가 validated가 아님: ${metadata.status}`);
  if (Number(metadata.blockerCount) !== 0) throw new Error(`${collection}/${versionId} blocker가 0이 아님`);
  const documents = await ref.collection(child).get();
  const expectedCount = Number(metadata.expectedCount);
  const actualCount = Number(metadata.actualCount);
  if (documents.size !== expectedCount || documents.size !== actualCount) {
    throw new Error(`${collection}/${versionId} 수량 불일치: stored=${documents.size}, expected=${expectedCount}, actual=${actualCount}`);
  }
  const rows = documents.docs.map((document) => ({
    id: document.id,
    data: document.data() as Record<string, unknown>,
  }));
  const contentHash = ssotContentHash(rows);
  if (!metadata.contentHash || metadata.contentHash !== contentHash) {
    throw new Error(`${collection}/${versionId} 전체 내용 해시 불일치`);
  }
  return { ref, versionId, count: documents.size, contentHash, metadata, rows };
}

const [products, vehicle] = await Promise.all([
  checkVersion('productMasterVersions', 'products', productVersion),
  checkVersion('vehicleMasterVersions', 'entries', vehicleVersion),
]);

const productVehicleVersion = String(products.metadata.vehicleMasterVersionId || '');
if (productVehicleVersion !== vehicleVersion) {
  throw new Error(`상품 버전의 차종마스터 참조 불일치: product=${productVehicleVersion || 'blank'}, release=${vehicleVersion}`);
}
const vehicleEntryIds = new Set(vehicle.rows.map((row) => row.id));
const brokenVehicleRefs = products.rows.filter((row) => {
  const entryId = String(row.data.vehicle_master_entry_id || '');
  return !entryId || !vehicleEntryIds.has(entryId);
});
if (brokenVehicleRefs.length) {
  throw new Error(`상품→차종마스터 참조 무결성 실패 ${brokenVehicleRefs.length}건: ${brokenVehicleRefs.slice(0, 20).map((row) => row.id).join(', ')}`);
}

const productPointer = db.doc('ssotState/products');
const vehiclePointer = db.doc('ssotState/vehicleMaster');
const releaseRef = db.collection('ssotReleases').doc(releaseId);
await db.runTransaction(async (transaction) => {
  const [freshProducts, freshVehicle, previousProducts, previousVehicle, existingRelease] = await Promise.all([
    transaction.get(products.ref),
    transaction.get(vehicle.ref),
    transaction.get(productPointer),
    transaction.get(vehiclePointer),
    transaction.get(releaseRef),
  ]);
  if (existingRelease.exists) throw new Error(`이미 존재하는 ERP5 release: ${releaseId}`);
  if (freshProducts.data()?.status !== 'validated' || freshProducts.data()?.contentHash !== products.contentHash) {
    throw new Error('상품 draft가 검증 뒤 변경됨');
  }
  if (freshVehicle.data()?.status !== 'validated' || freshVehicle.data()?.contentHash !== vehicle.contentHash) {
    throw new Error('차종 draft가 검증 뒤 변경됨');
  }
  const previousProductVersion = String(previousProducts.data()?.activeVersionId || '');
  const previousVehicleVersion = String(previousVehicle.data()?.activeVersionId || '');
  const previousProductRelease = String(previousProducts.data()?.releaseId || '');
  const previousVehicleRelease = String(previousVehicle.data()?.releaseId || '');
  if (previousProductRelease !== previousVehicleRelease) {
    throw new Error(`기존 상품·차종 release 포인터 불일치: ${previousProductRelease || 'blank'} / ${previousVehicleRelease || 'blank'}`);
  }
  const previousReleaseRef = previousProductRelease && previousProductRelease !== releaseId
    ? db.collection('ssotReleases').doc(previousProductRelease)
    : null;
  const previousRelease = previousReleaseRef ? await transaction.get(previousReleaseRef) : null;
  if (previousReleaseRef && (!previousRelease?.exists || previousRelease.data()?.status !== 'active')) {
    throw new Error(`기존 active release 상태 오류: ${previousProductRelease}`);
  }
  if (previousProductVersion && previousProductVersion !== productVersion) {
    transaction.update(db.collection('productMasterVersions').doc(previousProductVersion), {
      status: 'superseded', supersededBy: releaseId, supersededAt: FieldValue.serverTimestamp(),
    });
  }
  if (previousVehicleVersion && previousVehicleVersion !== vehicleVersion) {
    transaction.update(db.collection('vehicleMasterVersions').doc(previousVehicleVersion), {
      status: 'superseded', supersededBy: releaseId, supersededAt: FieldValue.serverTimestamp(),
    });
  }
  if (previousReleaseRef) {
    transaction.update(previousReleaseRef, {
      status: 'superseded', supersededBy: releaseId, supersededAt: FieldValue.serverTimestamp(),
    });
  }
  transaction.update(products.ref, { status: 'active', releaseId, activatedAt: FieldValue.serverTimestamp() });
  transaction.update(vehicle.ref, { status: 'active', releaseId, activatedAt: FieldValue.serverTimestamp() });
  transaction.set(productPointer, {
    activeVersionId: productVersion, productCount: products.count,
    listableCount: Number(products.metadata.listableCount || 0), schemaVersion: products.metadata.schemaVersion,
    sourceSystem: products.metadata.sourceSystem, releaseId, activatedAt: FieldValue.serverTimestamp(),
  });
  transaction.set(vehiclePointer, {
    activeVersionId: vehicleVersion, entryCount: vehicle.count, schemaVersion: vehicle.metadata.schemaVersion,
    sourceSystem: vehicle.metadata.sourceSystem, releaseId, activatedAt: FieldValue.serverTimestamp(),
  });
  transaction.create(releaseRef, {
    status: 'active', productVersionId: productVersion, vehicleMasterVersionId: vehicleVersion,
    productContentHash: products.contentHash, vehicleContentHash: vehicle.contentHash,
    productCount: products.count, vehicleCount: vehicle.count, activatedAt: FieldValue.serverTimestamp(),
  });
});

const [productReadback, vehicleReadback, releaseReadback, productVersionReadback, vehicleVersionReadback] = await Promise.all([
  productPointer.get(), vehiclePointer.get(), releaseRef.get(), products.ref.get(), vehicle.ref.get(),
]);
if (productReadback.data()?.activeVersionId !== productVersion
  || productReadback.data()?.releaseId !== releaseId
  || vehicleReadback.data()?.activeVersionId !== vehicleVersion
  || vehicleReadback.data()?.releaseId !== releaseId
  || releaseReadback.data()?.status !== 'active'
  || releaseReadback.data()?.productContentHash !== products.contentHash
  || releaseReadback.data()?.vehicleContentHash !== vehicle.contentHash
  || productVersionReadback.data()?.status !== 'active'
  || productVersionReadback.data()?.releaseId !== releaseId
  || vehicleVersionReadback.data()?.status !== 'active'
  || vehicleVersionReadback.data()?.releaseId !== releaseId) {
  throw new Error('ERP5 release 활성 포인터 read-back 실패');
}
console.log(`ERP5 release 활성화 완료: ${releaseId} (상품 ${products.count}, 차종 ${vehicle.count})`);
