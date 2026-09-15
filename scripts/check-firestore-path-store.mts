import assert from 'node:assert/strict';

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ||= 'demo-freepass-path-store';
process.env.GOOGLE_CLOUD_PROJECT ||= process.env.GCLOUD_PROJECT;

const { firestorePathStore } = await import('../lib/server/firestore-path-store');
const { firebaseAdminApp } = await import('../lib/server/firebase-admin');
const { getFirestore } = await import('firebase-admin/firestore');
const { publishOpsStatus } = await import('./lib/publish-ops-status.mts');

const db = firestorePathStore();
const run = `adapter_${Date.now()}`;
const docPath = `v4/adapter_checks/${run}`;
const root = db.ref('v4');
const productCode = `P_${run}`;
const carNumber = `12가${String(Date.now()).slice(-4)}`;
const legacyCarNumber = `34나${String(Date.now()).slice(-4)}`;
const scaleCollection = `adapter_scale_${Date.now()}`;

try {
  await db.ref(docPath).set({ keep: true, nested: { keep: 1, remove: 2 } });
  await db.ref(`${docPath}/nested`).set({ replacement: 3 });
  assert.deepEqual((await db.ref(`${docPath}/nested`).get()).val(), { replacement: 3 });
  await db.ref(`${docPath}/missing/deep`).remove();
  await db.ref(docPath).update({ 'nested/remove': null });
  assert.deepEqual((await db.ref(docPath).get()).val(), { keep: true, nested: { replacement: 3 } });

  await root.update({ [`adapter_checks/${run}/fanoutRemove`]: 'x' });
  await root.update({ [`adapter_checks/${run}/fanoutRemove`]: null });
  assert.equal((await db.ref(`${docPath}/fanoutRemove`).get()).exists(), false);

  const fieldDelete = await db.ref(`${docPath}/nested/keep`).transaction(() => null);
  assert.equal(fieldDelete.committed, true);
  assert.equal((await db.ref(`${docPath}/nested/keep`).get()).exists(), false);

  const documentDelete = await db.ref(docPath).transaction(() => null);
  assert.equal(documentDelete.committed, true);
  assert.equal((await db.ref(docPath).get()).exists(), false);

  await db.ref(docPath).set({ untouched: true });
  const aborted = await db.ref(docPath).transaction(() => undefined);
  assert.equal(aborted.committed, false);
  assert.deepEqual((await db.ref(docPath).get()).val(), { untouched: true });

  await root.update({ [`adapter_checks/${run}`]: null });
  assert.equal((await db.ref(docPath).get()).exists(), false);

  await db.ref(`v4/products/${carNumber}`).set({ car_number: carNumber, product_code: productCode, status: '재고' });
  await db.ref(`v4/products/${productCode}`).update({ status: '계약중' });
  assert.equal((await db.ref(`v4/products/${productCode}/status`).get()).val(), '계약중');
  const products = (await db.ref('v4/products').get()).val();
  assert.equal(products[productCode].car_number, carNumber);
  const physical = await getFirestore(firebaseAdminApp()).collection('products').where('product_code', '==', productCode).get();
  assert.equal(physical.size, 1, '상품코드 쓰기가 별도 stub 문서를 만들면 안 됨');
  await getFirestore(firebaseAdminApp()).collection('products').doc(`legacy_${run}`).set({ car_number: legacyCarNumber, status: '재고' });
  await db.ref(`v4/products/${legacyCarNumber}`).update({ status: '계약중' });
  const legacyPhysical = await getFirestore(firebaseAdminApp()).collection('products').where('car_number', '==', legacyCarNumber).get();
  assert.equal(legacyPhysical.size, 1, '차량번호 쓰기가 별도 stub 문서를 만들면 안 됨');
  assert.equal(legacyPhysical.docs[0].data().status, '계약중');

  const opsStatus = {
    runId: run,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedMs: Date.now(),
    running: false,
    apply: false,
    elapsedSec: 0,
    ok: true,
    steps: [],
    warnings: [],
    summary: ['emulator-check'],
  };
  await publishOpsStatus(opsStatus);
  const ops = await getFirestore(firebaseAdminApp()).collection('ops').doc('pipeline').get();
  assert.equal(ops.data()?.runId, run, '관제 상태가 Firestore 문서에 기록돼야 함');

  const fs = getFirestore(firebaseAdminApp());
  for (let offset = 0; offset < 520; offset += 450) {
    const seed = fs.batch();
    for (let i = offset; i < Math.min(offset + 450, 520); i++) {
      seed.set(fs.collection(scaleCollection).doc(`k${String(i).padStart(3, '0')}`), { value: i });
    }
    await seed.commit();
  }
  const scaleTx = await db.ref(`v4/${scaleCollection}`).transaction((current) => ({
    ...current,
    k000: { value: 999 },
  }));
  assert.equal(scaleTx.committed, true, '500개 초과 문서 읽기와 1건 쓰기 트랜잭션이 동작해야 함');
  assert.equal((await db.ref(`v4/${scaleCollection}/k000/value`).get()).val(), 999);

  const oversizedFanout = Object.fromEntries(Array.from({ length: 451 }, (_, i) => [
    `adapter_fanout_limit/${run}_${i}`,
    { value: i },
  ]));
  await assert.rejects(root.update(oversizedFanout), /atomic update write limit 초과/);
  assert.equal((await db.ref(`v4/adapter_fanout_limit/${run}_0`).get()).exists(), false, '대량 팬아웃은 부분 반영되면 안 됨');

  console.log('PASS firestore-path-store: deletion, transactions, 520-read scale, atomic fanout limit, product keys, ops status');
} finally {
  await db.ref(docPath).remove().catch(() => {});
  await db.ref(`v4/products/${productCode}`).remove().catch(() => {});
  await db.ref(`v4/products/${legacyCarNumber}`).remove().catch(() => {});
  await getFirestore(firebaseAdminApp()).collection('ops').doc('pipeline').delete().catch(() => {});
  const scaleDocs = await getFirestore(firebaseAdminApp()).collection(scaleCollection).get().catch(() => null);
  if (scaleDocs) {
    for (let offset = 0; offset < scaleDocs.docs.length; offset += 450) {
      const cleanup = getFirestore(firebaseAdminApp()).batch();
      for (const doc of scaleDocs.docs.slice(offset, offset + 450)) cleanup.delete(doc.ref);
      await cleanup.commit().catch(() => {});
    }
  }
}
