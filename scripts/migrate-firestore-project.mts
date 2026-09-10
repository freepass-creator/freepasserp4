/**
 * Copy an explicit Firestore collection allowlist between Firebase projects.
 * Existing destination documents are never overwritten. Dry-run by default.
 *
 * Required env:
 *   SOURCE_FIREBASE_SERVICE_ACCOUNT=<path to source service-account json>
 *   DEST_FIREBASE_SERVICE_ACCOUNT=<path to destination service-account json>
 *
 * Usage:
 *   npx tsx scripts/migrate-firestore-project.mts --phase=atoms [--apply|--resume|--verify|--refresh-existing]
 *
 * If an apply stops between batches, --resume verifies every existing document
 * before creating only the missing documents. It never overwrites a mismatch.
 */
import { readFileSync } from 'node:fs';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { makerGroup } from '../lib/domain/vehicle-master-match';
import { atomViolations, type AtomView, type MasterIndex } from '../lib/domain/atom-invariants';

const PHASES = {
  atoms: [
    'product_list_atom', 'products', 'vehicle_trim_master', 'new_car_trim',
    'products_private', 'vehicle_claims',
    'policy', 'spec', 'plate_registry', 'sheet_conflict_resolutions',
  ],
  identity: ['partner', 'partners_private', 'user', 'users_private'],
  business: [
    'rooms', 'messages',
    'customer', 'contract', 'contract_sign', 'settlement', 'settlement_rows',
    'settlement_events', 'settlement_contacts', 'settlement_clawbacks',
    'admin_settlements', 'settlements_provider_private',
    'settlements_admin_private', 'settlements_agent_private',
    'esign_sessions', 'esign_private', 'esign_events', 'esign_verifications',
    'esign_issue_claims', 'esign_manual_offers',
  ],
} as const;

const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');
const REFRESH = process.argv.includes('--refresh-existing');
const RESUME = process.argv.includes('--resume');
if ([APPLY, VERIFY, REFRESH, RESUME].filter(Boolean).length > 1) throw new Error('--apply, --resume, --verify, --refresh-existing은 함께 쓸 수 없습니다.');
const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))?.slice('--phase='.length) || '';
if (!(phaseArg in PHASES)) throw new Error(`--phase=${Object.keys(PHASES).join('|')} 중 하나가 필요합니다.`);
const collections = PHASES[phaseArg as keyof typeof PHASES];
const S = (value: unknown) => String(value ?? '').trim();
const N = (value: unknown) => S(value).toLowerCase().replace(/\s+/g, '');

type TrimMasterRow = Record<string, unknown> & {
  trim_row_key?: string; maker?: string; model?: string; sub_model?: string; trim?: string;
  management_status?: string; usage_tier?: string;
};
const trimArtifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records?: TrimMasterRow[] };
const trimRows = (trimArtifact.records || []).filter((row) => row.management_status === '확정' && row.usage_tier !== 'blocked');
const validSubmodels = new Set<string>();
const trimsBySubmodel = new Map<string, string[]>();
for (const row of trimRows) {
  const model = N(row.model); const submodel = N(row.sub_model); if (!model || !submodel) continue;
  for (const maker of makerGroup(N(row.maker))) {
    const key = `${maker}|${model}|${submodel}`;
    validSubmodels.add(key);
    if (S(row.trim)) trimsBySubmodel.set(key, [...new Set([...(trimsBySubmodel.get(key) || []), S(row.trim)])]);
  }
}
const masterIndex: MasterIndex = {
  validSub: (maker, model, submodel) => makerGroup(N(maker)).some((alias) => validSubmodels.has(`${alias}|${N(model)}|${N(submodel)}`)),
  trimsOf: (maker, model, submodel) => makerGroup(N(maker)).flatMap((alias) => trimsBySubmodel.get(`${alias}|${N(model)}|${N(submodel)}`) || []),
};

function credential(path: string, name: string) {
  if (!path) throw new Error(`${name} 환경변수 누락`);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  return cert({
    projectId: value.project_id,
    clientEmail: value.client_email,
    privateKey: String(value.private_key).replace(/\\n/g, '\n'),
  });
}

const sourceApp = initializeApp({ credential: credential(String(process.env.SOURCE_FIREBASE_SERVICE_ACCOUNT || ''), 'SOURCE_FIREBASE_SERVICE_ACCOUNT') }, 'migration-source');
const destApp = initializeApp({ credential: credential(String(process.env.DEST_FIREBASE_SERVICE_ACCOUNT || ''), 'DEST_FIREBASE_SERVICE_ACCOUNT') }, 'migration-dest');
const source = getFirestore(sourceApp);
const dest = getFirestore(destApp);

function remapReferences(value: any, db: Firestore): any {
  if (Array.isArray(value)) return value.map((item) => remapReferences(item, db));
  if (!value || typeof value !== 'object') return value;
  if (value.constructor?.name === 'DocumentReference' && typeof value.path === 'string') return db.doc(value.path);
  if (value.constructor?.name === 'Timestamp' || value.constructor?.name === 'GeoPoint' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapReferences(item, db)]));
}

let total = 0;
let held = 0;
let verifyFailures = 0;
for (const collectionName of collections) {
  const [sourceSnap, destSnap] = await Promise.all([
    collectionName === 'vehicle_trim_master' ? Promise.resolve(null) : source.collection(collectionName).get(),
    dest.collection(collectionName).get(),
  ]);
  if (!destSnap.empty && !VERIFY && !REFRESH && !RESUME) throw new Error(`${collectionName}: 목적지가 비어 있지 않습니다 (${destSnap.size}건). 덮어쓰기를 중단합니다.`);
  const sourceDocs = sourceSnap
    ? sourceSnap.docs.map((document) => ({ id: document.id, data: document.data() }))
    : trimRows.map((row) => ({ id: S(row.trim_row_key), data: row }));
  if (sourceDocs.some((document) => !document.id)) throw new Error(`${collectionName}: 빈 문서 ID가 있습니다.`);
  const preparedDocs = sourceDocs.map((document) => {
    let data = remapReferences(document.data, dest);
    if (collectionName === 'products' && data?.확정 === true) {
      const violations = atomViolations(data as AtomView, masterIndex).filter((issue) => issue.severity === 'block');
      if (violations.length) {
        held++;
        data = {
          ...data,
          확정: false,
          legacy_confirmed: true,
          ssot_status: 'HOLD',
          ssot_hold_reasons: violations.map((issue) => `${issue.code}:${issue.msg}`),
          ssot_migrated_from: 'freepasserp3',
        };
      }
    }
    return { id: document.id, data };
  });
  console.log(`${collectionName}: source=${sourceDocs.length} destination=${destSnap.size}`);
  total += sourceDocs.length;
  if (RESUME) {
    const stable = (value: any): any => {
      if (Array.isArray(value)) return value.map(stable);
      if (!value || typeof value !== 'object') return value;
      if (value.constructor?.name === 'Timestamp') return { _timestamp: [value.seconds, value.nanoseconds] };
      if (value.constructor?.name === 'GeoPoint') return { _geopoint: [value.latitude, value.longitude] };
      if (value.constructor?.name === 'DocumentReference') return { _reference: value.path };
      if (Buffer.isBuffer(value)) return { _bytes: value.toString('base64') };
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    };
    const expectedById = new Map(preparedDocs.map((document) => [document.id, JSON.stringify(stable(document.data))]));
    const mismatches = destSnap.docs.filter((document) => expectedById.get(document.id) !== JSON.stringify(stable(document.data())));
    if (mismatches.length) throw new Error(`${collectionName}: 기존 문서 불일치 ${mismatches.slice(0, 20).map((document) => document.id).join(',')}`);
    const existingIds = new Set(destSnap.docs.map((document) => document.id));
    const missing = preparedDocs.filter((document) => !existingIds.has(document.id));
    for (let offset = 0; offset < missing.length; offset += 300) {
      const batch = dest.batch();
      for (const document of missing.slice(offset, offset + 300)) {
        batch.create(dest.collection(collectionName).doc(document.id), document.data);
      }
      await batch.commit();
    }
    console.log(`${collectionName}: resumed=${missing.length}`);
    continue;
  }
  if (REFRESH) {
    const stable = (value: any): any => {
      if (Array.isArray(value)) return value.map(stable);
      if (!value || typeof value !== 'object') return value;
      if (value.constructor?.name === 'Timestamp') return { _timestamp: [value.seconds, value.nanoseconds] };
      if (value.constructor?.name === 'GeoPoint') return { _geopoint: [value.latitude, value.longitude] };
      if (value.constructor?.name === 'DocumentReference') return { _reference: value.path };
      if (Buffer.isBuffer(value)) return { _bytes: value.toString('base64') };
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    };
    const actual = new Map(destSnap.docs.map((document) => [document.id, JSON.stringify(stable(document.data()))]));
    const changed = preparedDocs.filter((document) => actual.has(document.id)
      && actual.get(document.id) !== JSON.stringify(stable(document.data)));
    for (let offset = 0; offset < changed.length; offset += 300) {
      const batch = dest.batch();
      for (const document of changed.slice(offset, offset + 300)) {
        batch.set(dest.collection(collectionName).doc(document.id), document.data);
      }
      await batch.commit();
    }
    console.log(`${collectionName}: refreshed=${changed.length}`);
    continue;
  }
  if (VERIFY) {
    const stable = (value: any): any => {
      if (Array.isArray(value)) return value.map(stable);
      if (!value || typeof value !== 'object') return value;
      if (value.constructor?.name === 'Timestamp') return { _timestamp: [value.seconds, value.nanoseconds] };
      if (value.constructor?.name === 'GeoPoint') return { _geopoint: [value.latitude, value.longitude] };
      if (value.constructor?.name === 'DocumentReference') return { _reference: value.path };
      if (Buffer.isBuffer(value)) return { _bytes: value.toString('base64') };
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    };
    const actual = new Map(destSnap.docs.map((document) => [document.id, JSON.stringify(stable(document.data()))]));
    const mismatches = preparedDocs.filter((document) => actual.get(document.id) !== JSON.stringify(stable(document.data)));
    const extras = destSnap.docs.filter((document) => !preparedDocs.some((expected) => expected.id === document.id));
    if (mismatches.length || extras.length) {
      verifyFailures += mismatches.length + extras.length;
      console.error(`${collectionName}: mismatch=${mismatches.length} extra=${extras.length}`);
      const destinationById = new Map(destSnap.docs.map((document) => [document.id, document.data()]));
      for (const document of mismatches.slice(0, 20)) {
        const destinationData = destinationById.get(document.id) || {};
        const keys = new Set([...Object.keys(document.data || {}), ...Object.keys(destinationData)]);
        const changedFields = [...keys].filter((key) => (
          JSON.stringify(stable(document.data?.[key])) !== JSON.stringify(stable(destinationData[key]))
        ));
        console.error(`${collectionName}/${document.id}: fields=${changedFields.join(',')}`);
      }
      if (extras.length) console.error(`${collectionName}: extraIds=${extras.slice(0, 20).map((document) => document.id).join(',')}`);
    }
    continue;
  }
  if (!APPLY || !sourceDocs.length) continue;
  for (let offset = 0; offset < preparedDocs.length; offset += 300) {
    const batch = dest.batch();
    for (const document of preparedDocs.slice(offset, offset + 300)) {
      batch.create(dest.collection(collectionName).doc(document.id), document.data);
    }
    await batch.commit();
  }
}

console.log(`${VERIFY ? 'VERIFIED' : REFRESH ? 'REFRESHED' : RESUME ? 'RESUMED' : APPLY ? 'APPLIED' : 'DRY_RUN'} phase=${phaseArg} collections=${collections.length} documents=${total} held=${held} failures=${verifyFailures}`);
await Promise.all([deleteApp(sourceApp), deleteApp(destApp)]);
if (verifyFailures) process.exit(1);
