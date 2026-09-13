/**
 * Google Sheet 차종마스터 + Encar 참조본 -> ERP5 Firestore versioned vehicle SSOT.
 * 기본 dry-run. --apply는 검증본 저장, --apply --activate는 blocker 0일 때만 포인터 교체.
 */
import { readFileSync } from 'node:fs';
import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { JWT } from 'google-auth-library';
import { ENCAR_MASTER_SHEET_ID, ENCAR_MASTER_TAB, loadEncarWorkSheetGrids } from '../lib/domain/encar-master-sheet';
import { buildVehicleMaster, parseVehicleMasterSheet, type EncarReferenceRow } from '../lib/domain/erp5-vehicle-master-ssot';

const APPLY = process.argv.includes('--apply');
const ACTIVATE = process.argv.includes('--activate');
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
const VERSION_ID = arg('version') || new Date().toISOString().replace(/[-:.]/g, '');
const ENCAR_PATH = arg('encar') || process.env.ERP5_ENCAR_REFERENCE_PATH || 'tmp/vehicle-master/dist/vehicle-master.flat.json';
const TARGET_PROJECT_ID = process.env.ERP5_FIREBASE_PROJECT_ID || 'erp5-3e2fc';
const VERSIONS_COLLECTION = 'vehicleMasterVersions';
const POINTER_PATH = 'ssotState/vehicleMaster';
if (!/^[A-Za-z0-9._-]{1,120}$/.test(VERSION_ID)) throw new Error(`version ID 형식이 올바르지 않습니다: ${VERSION_ID}`);

type ServiceAccountJson = { project_id?: string; client_email?: string; private_key?: string };
const parseAccount = (raw: string, label: string): ServiceAccountJson => {
  let parsed: ServiceAccountJson;
  try { parsed = JSON.parse(raw) as ServiceAccountJson; } catch { throw new Error(`${label} 서비스 계정 JSON을 읽을 수 없습니다.`); }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error(`${label} 서비스 계정 필드가 부족합니다.`);
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
};
const readFileAccount = (paths: (string | undefined)[], label: string): ServiceAccountJson => {
  for (const path of paths) if (path) return parseAccount(readFileSync(path, 'utf8'), label);
  throw new Error(`${label} 서비스 계정 파일 경로가 없습니다.`);
};

if (ACTIVATE && !APPLY) throw new Error('--activate는 --apply와 함께 사용해야 합니다.');
const googleAccount = process.env.ERP4_FIREBASE_SERVICE_ACCOUNT_JSON
  ? parseAccount(process.env.ERP4_FIREBASE_SERVICE_ACCOUNT_JSON, 'Google Sheet')
  : readFileAccount([
      process.env.ERP4_GOOGLE_APPLICATION_CREDENTIALS,
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      'tmp/firebase-auth/sa.json',
    ], 'Google Sheet');

const jwt = new JWT({
  email: googleAccount.client_email,
  key: googleAccount.private_key,
  subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetApi = async (url: string): Promise<Record<string, unknown>> => {
  const token = (await jwt.getAccessToken()).token;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String((body.error as { message?: unknown } | undefined)?.message || `HTTP ${response.status}`));
  return body;
};

const grids = await loadEncarWorkSheetGrids(sheetApi);
const sheetRows = parseVehicleMasterSheet(grids.names);
const reference = JSON.parse(readFileSync(ENCAR_PATH, 'utf8')) as { version?: string; rows?: EncarReferenceRow[] };
if (!Array.isArray(reference.rows) || reference.rows.length < 100) throw new Error(`Encar 참조본 형태가 다릅니다: ${ENCAR_PATH}`);
const built = buildVehicleMaster({ sheetRows, encarRows: reference.rows });

console.log(JSON.stringify({
  mode: APPLY ? (ACTIVATE ? 'apply-and-activate' : 'apply-draft') : 'dry-run',
  googleSheet: `${ENCAR_MASTER_SHEET_ID}/${ENCAR_MASTER_TAB}`,
  encarReference: { path: ENCAR_PATH, version: reference.version || 'unknown', rows: reference.rows.length },
  target: `${TARGET_PROJECT_ID}/firestore/${VERSIONS_COLLECTION}/${VERSION_ID}/entries`,
  versionId: VERSION_ID,
  entryCount: built.entries.length,
  stats: built.stats,
  blockerCount: built.blockers.length,
  blockerSample: built.blockers.slice(0, 20),
}, null, 2));

if (ACTIVATE && built.blockers.length) {
  throw new Error(`차종마스터 blocker ${built.blockers.length}건: 활성화하지 않습니다.`);
}
if (!APPLY) {
  console.log('DRY-RUN 완료: Google Sheet, ERP4, ERP5에는 쓰지 않았습니다.');
  process.exit(0);
}

const targetInline = process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON;
const targetAccount = targetInline
  ? parseAccount(targetInline, 'ERP5 대상')
  : readFileAccount([process.env.ERP5_GOOGLE_APPLICATION_CREDENTIALS], 'ERP5 대상');
if (targetAccount.project_id !== TARGET_PROJECT_ID) {
  throw new Error(`ERP5 대상 프로젝트 불일치: expected=${TARGET_PROJECT_ID}, credential=${targetAccount.project_id}`);
}
if (targetAccount.project_id === googleAccount.project_id) {
  throw new Error('Google Sheet/ERP4 원본 프로젝트와 ERP5 대상 프로젝트가 같을 수 없습니다.');
}

const targetApp = initializeApp({
  credential: cert(targetAccount as ServiceAccount),
  projectId: TARGET_PROJECT_ID,
}, `erp5-vehicle-master-${Date.now()}`);
const targetDb = getFirestore(targetApp);
const versionRef = targetDb.collection(VERSIONS_COLLECTION).doc(VERSION_ID);
if ((await versionRef.get()).exists) throw new Error(`이미 존재하는 ERP5 차종마스터 버전입니다: ${VERSION_ID}`);

await versionRef.set({
  schemaVersion: 1,
  status: 'writing',
  expectedCount: built.entries.length,
  blockerCount: built.blockers.length,
  blockerSample: built.blockers.slice(0, 100),
  stats: built.stats,
  sources: {
    googleSheet: { sheetId: ENCAR_MASTER_SHEET_ID, tab: ENCAR_MASTER_TAB },
    encar: { artifact: ENCAR_PATH, version: reference.version || 'unknown' },
  },
  createdAt: FieldValue.serverTimestamp(),
});

const CHUNK_SIZE = 400;
for (let offset = 0; offset < built.entries.length; offset += CHUNK_SIZE) {
  const batch = targetDb.batch();
  for (const entry of built.entries.slice(offset, offset + CHUNK_SIZE)) {
    batch.create(versionRef.collection('entries').doc(entry.id), {
      ...entry,
      schemaVersion: 1,
      versionId: VERSION_ID,
      copiedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`WRITE ${Math.min(offset + CHUNK_SIZE, built.entries.length)}/${built.entries.length}`);
}

const written = await versionRef.collection('entries').select().get();
if (written.size !== built.entries.length) {
  await versionRef.set({ status: 'invalid', actualCount: written.size }, { merge: true });
  throw new Error(`ERP5 차종마스터 검증 실패: expected=${built.entries.length}, actual=${written.size}`);
}

// 사용자가 반복 확인하는 제네시스 축은 Firestore에 실제 쓰인 값을 다시 읽어 원문/정규값 손실을 막는다.
const genesisTargetModels = new Set(['더 뉴 G70', '더 뉴 G70 슈팅브레이크', 'GV70', '일렉트리파이드 GV70']);
const genesisTargets = built.entries.filter((entry) => entry.maker === '제네시스' && genesisTargetModels.has(entry.model));
const genesisReadback: Array<{ model: string; subModel: string; trim: string; sourceModel: string; sourceSubModel: string; sourceTrim: string }> = [];
for (const entry of genesisTargets) {
  const snapshot = await versionRef.collection('entries').doc(entry.id).get();
  if (!snapshot.exists) throw new Error(`ERP5 제네시스 read-back 누락: ${entry.id}`);
  const data = snapshot.data() as Record<string, any>;
  const sourceNames = data.evidence?.googleSheet?.sourceNames || {};
  if (data.model !== entry.model || data.subModel !== entry.subModel || data.trim !== entry.trim) {
    throw new Error(`ERP5 제네시스 read-back 정규값 불일치: ${entry.id}`);
  }
  if (sourceNames.model !== entry.evidence.googleSheet.sourceNames.model
    || sourceNames.subModel !== entry.evidence.googleSheet.sourceNames.subModel
    || sourceNames.trim !== entry.evidence.googleSheet.sourceNames.trim) {
    throw new Error(`ERP5 제네시스 read-back 원문값 불일치: ${entry.id}`);
  }
  genesisReadback.push({
    model: String(data.model || ''),
    subModel: String(data.subModel || ''),
    trim: String(data.trim || ''),
    sourceModel: String(sourceNames.model || ''),
    sourceSubModel: String(sourceNames.subModel || ''),
    sourceTrim: String(sourceNames.trim || ''),
  });
}
console.log(JSON.stringify({
  genesisReadbackCount: genesisReadback.length,
  genesisReadback: genesisReadback.slice(0, 30),
}, null, 2));

await versionRef.set({
  status: ACTIVATE ? 'active' : (built.blockers.length ? 'draft' : 'validated'),
  actualCount: written.size,
  genesisReadbackCount: genesisReadback.length,
  validatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

if (ACTIVATE) {
  await targetDb.doc(POINTER_PATH).set({
    activeVersionId: VERSION_ID,
    entryCount: written.size,
    schemaVersion: 1,
    sheetId: ENCAR_MASTER_SHEET_ID,
    encarReferenceVersion: reference.version || 'unknown',
    activatedAt: FieldValue.serverTimestamp(),
  });
}

console.log(`ERP5 차종마스터 ${ACTIVATE ? '활성화' : '버전 저장'} 완료: ${VERSION_ID} (${written.size}행)`);
