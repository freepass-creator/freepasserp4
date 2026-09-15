/** RP012 선택옵션만 동기화한다. 기본은 dry-run, --apply-plan=<path>만 쓴다. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { normalizePlate, tcarPaidOptionNames } from '../sonokong/lib/option-normalizer.mjs';

const S = (v: unknown) => String(v ?? '').trim();
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const stable = (v: unknown): string => JSON.stringify(v, (_k, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
    : value);
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const get = (obj: any, path: string) => path.split('.').reduce((value, key) => value?.[key], obj);
const root = 'tmp/son-options-20260915';
const sourcePath = arg('source') || 'sonokong/lib/wonja/손오공차량.json';
const sourceText = readFileSync(sourcePath, 'utf8');
const source = JSON.parse(sourceText);
const project = 'freepasserp5';
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || 'C:/dev/freepasserp4-rtdb-current/tmp/firebase-auth/freepasserp5-sa.json';
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
if (serviceAccount.project_id !== project || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Project/database boundary');
const db = getFirestore(initializeApp({ credential: cert(serviceAccount), projectId: project }));
const codeHash = hash(readFileSync(new URL(import.meta.url), 'utf8'));
const allowed = new Set([
  'options', '원문.옵션', '원문.옵션출처', '원문.티카유료옵션',
  '원문.손오공출고옵션', '원문.옵션근거', 'option_evidence_status', 'option_evidence_reason',
]);
mkdirSync(root, { recursive: true });

const applyPath = arg('apply-plan');
if (applyPath) {
  const plan = JSON.parse(readFileSync(applyPath, 'utf8'));
  if (plan.project !== project || plan.database !== '(default)' || plan.codeHash !== codeHash || plan.sourceHash !== hash(sourceText)) throw Error('Plan identity changed');
  if (Date.now() - Date.parse(plan.createdAt) > 30 * 60e3) throw Error('Plan expired');
  if (new Set(plan.changes.map((change: any) => change.id)).size !== plan.changes.length) throw Error('Duplicate planned document');
  const receipt: any = { plan: applyPath, project, startedAt: new Date().toISOString(), applied: [] };
  const receiptPath = `${root}/receipt-${Date.now()}.json`;
  const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  save();
  for (const change of plan.changes) {
    if (Object.keys(change.patch).some((key) => !allowed.has(key))) throw Error('Unapproved field');
    const ref = db.collection('products').doc(change.id);
    const before = await ref.get();
    if (!before.exists || before.get('provider_company_code') !== 'RP012' || normalizePlate(before.get('car_number')) !== change.plate) throw Error('Identity changed');
    if (!before.updateTime!.isEqual(new Timestamp(change.updateTime.seconds, change.updateTime.nanoseconds))) throw Error('Concurrent document change; regenerate plan');
    await ref.update(change.patch, { lastUpdateTime: before.updateTime! });
    const after = await ref.get();
    if (Object.entries(change.patch).some(([key, value]) => stable(after.get(key)) !== stable(value))) throw Error('Firestore readback mismatch');
    receipt.applied.push({ id: change.id, plate: change.plate, updateTime: after.updateTime });
    save();
  }
  receipt.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ receiptPath, applied: receipt.applied.length }));
} else {
  const cars: any[] = source.차량 || [];
  if (!cars.length || source.규격 !== 'tcar-direct-paid-options-v3-current-identity') throw Error('Unsupported source');
  const plates = cars.map((car) => normalizePlate(car.차번));
  if (plates.some((plate) => !plate) || new Set(plates).size !== cars.length || new Set(cars.map((car) => S(car.id))).size !== cars.length) throw Error('Nonunique source identity');
  const snapshot = await db.collection('products').where('provider_company_code', '==', 'RP012').get();
  const byPlate = new Map<string, any[]>();
  for (const doc of snapshot.docs) {
    const plate = normalizePlate(doc.get('car_number'));
    byPlate.set(plate, [...(byPlate.get(plate) || []), doc]);
  }
  const changes: any[] = [];
  const holds: any[] = [];
  let verified = 0;
  let same = 0;
  for (const car of cars) {
    const plate = normalizePlate(car.차번);
    const evidence = car.유료옵션근거;
    const tcarVerified = car.유료옵션출처 === 'tcarPaidOptions'
      && evidence?.원천 === 'tcar:jsonData.paidOptList'
      && normalizePlate(evidence?.티카차번) === plate
      && Array.isArray(car.유료옵션원문);
    const sonokongVerified = car.버킷 === 'SON_NO_KONG'
      && car.유료옵션출처 === 'sonokongCarOptionNote'
      && evidence?.원천 === 'sokrc:homepageView.carOptionNote'
      && String(evidence?.손오공상품id ?? '') === String(car.id ?? '')
      && normalizePlate(evidence?.손오공차번) === plate
      && !!S(car.손오공출고옵션원문);
    if (!tcarVerified && !sonokongVerified) {
      holds.push({ plate, reason: 'SOURCE_UNVERIFIED_PRESERVED' });
      continue;
    }
    if (!car.상세시각 || Date.now() - car.상세시각 > 30 * 60e3) throw Error('Source detail expired');
    const docs = byPlate.get(plate) || [];
    if (docs.length !== 1) {
      holds.push({ plate, reason: 'DOCUMENT_NOT_UNIQUE' });
      continue;
    }
    const doc = docs[0];
    const data = doc.data();
    const currentSourceId = S(car.id);
    const sheetSourceRow = S(data.sheet_source_row);
    const rawSourceId = S(data.원문?.전체?.id);
    // 현재 수집기가 관리하는 sheet_source_row를 우선 식별자로 사용한다. 옛 원문 전체의
    // 상품 ID가 남아 있어도 현재 값과 충돌할 수 있으므로 단순 OR 조건으로 통과시키지 않는다.
    const sourceIdentityMatches = sheetSourceRow
      ? sheetSourceRow === currentSourceId
      : rawSourceId === currentSourceId;
    if (!sourceIdentityMatches) {
      holds.push({ plate, reason: 'SOURCE_ID_MISMATCH' });
      continue;
    }
    if (tcarVerified && car.유료옵션원문.some((option: any) => !S(option?.name ?? option?.PAID_OPT_NM))) {
      holds.push({ plate, reason: 'INVALID_OPTION_NAME' });
      continue;
    }
    const options = tcarVerified ? tcarPaidOptionNames(car.유료옵션원문) : S(car.손오공출고옵션원문);
    if (options !== S(car.유료옵션)) throw Error('Option normalization mismatch');
    verified += 1;
    const desired: Record<string, unknown> = {
      options,
      '원문.옵션': options,
      '원문.옵션출처': car.유료옵션출처,
      '원문.옵션근거': evidence,
      option_evidence_status: 'PASS',
      option_evidence_reason: '',
    };
    if (tcarVerified) desired['원문.티카유료옵션'] = car.유료옵션원문;
    if (sonokongVerified) desired['원문.손오공출고옵션'] = car.손오공출고옵션원문;
    const patch = Object.fromEntries(Object.entries(desired).filter(([key, value]) => stable(get(data, key)) !== stable(value)));
    if (!Object.keys(patch).length) {
      same += 1;
      continue;
    }
    const before = Object.fromEntries(Object.keys(patch).map((key) => [key, get(data, key)]));
    changes.push({
      id: doc.id, plate, source: car.유료옵션출처,
      identity: { currentSourceId, sheetSourceRow, rawSourceId, legacyRawIdConflict: !!sheetSourceRow && !!rawSourceId && sheetSourceRow !== rawSourceId },
      updateTime: { seconds: doc.updateTime.seconds, nanoseconds: doc.updateTime.nanoseconds }, before, patch,
    });
  }
  const plan = {
    project, database: '(default)', createdAt: new Date().toISOString(), codeHash,
    sourceHash: hash(sourceText), sourcePath, totalSource: cars.length,
    totalFirestore: snapshot.size, verified, same, changes, holds,
  };
  const planPath = `${root}/apply-plan-${Date.now()}.json`;
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({
    planPath, totalSource: cars.length, totalFirestore: snapshot.size, verified,
    same, changes: changes.length, holds: holds.length,
    bySource: Object.fromEntries([...new Set(changes.map((change) => change.source))].map((source) => [source, changes.filter((change) => change.source === source).length])),
    fields: [...new Set(changes.flatMap((change) => Object.keys(change.patch)))],
  }));
}
