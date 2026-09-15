import 'server-only';

import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const APP_NAME = 'freepass-erp5-catalog';
const TARGET_PROJECT_ID = process.env.ERP5_FIREBASE_PROJECT_ID || 'freepasserp5';

export type Erp5CutoverState = 'precutover' | 'complete' | 'rollback-approved';

/** 옛 boolean을 다시 내리는 실수로 ERP3 상품이 살아나지 않도록 절체 상태를 명시한다. */
export function erp5CutoverState(): Erp5CutoverState {
  const state = String(process.env.ERP5_CUTOVER_STATE || 'precutover').trim();
  if (!['precutover', 'complete', 'rollback-approved'].includes(state)) {
    throw new Error(`ERP5_CUTOVER_STATE 오류: ${state}`);
  }
  return state as Erp5CutoverState;
}

export function erp5ProductReadEnabled(): boolean {
  return erp5CutoverState() === 'complete';
}

export function erp5LegacyProductReadAllowed(): boolean {
  return ['precutover', 'rollback-approved'].includes(erp5CutoverState());
}

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function serviceAccount(): ServiceAccountJson {
  const raw = String(process.env.ERP5_FIREBASE_READER_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('ERP5_FIREBASE_READER_SERVICE_ACCOUNT_JSON 미설정');
  const parsed = JSON.parse(raw) as ServiceAccountJson;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('ERP5_FIREBASE_READER_SERVICE_ACCOUNT_JSON 형식 오류');
  }
  if (parsed.project_id !== TARGET_PROJECT_ID) {
    throw new Error(`ERP5 프로젝트 불일치: expected=${TARGET_PROJECT_ID}, credential=${parsed.project_id}`);
  }
  const erp3ProjectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  if (erp3ProjectId && erp3ProjectId === parsed.project_id) {
    throw new Error('ERP3 운영 Firebase와 ERP5 상품 Firebase가 같을 수 없습니다.');
  }
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

function erp5App(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;
  const account = serviceAccount();
  return initializeApp({
    credential: cert({
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    } as ServiceAccount),
    projectId: TARGET_PROJECT_ID,
  }, APP_NAME);
}

export function erp5AdminFirestore(): Firestore {
  return getFirestore(erp5App());
}

export type ActiveErp5Products = {
  versionId: string;
  releaseId: string;
  products: Array<{ id: string; data: Record<string, unknown> }>;
};

async function verifyActiveRelease(
  releaseId: string,
  expected: { productVersionId?: string; vehicleMasterVersionId?: string },
): Promise<void> {
  if (!releaseId) throw new Error('ERP5 활성 포인터에 releaseId가 없습니다.');
  const release = await erp5AdminFirestore().collection('ssotReleases').doc(releaseId).get();
  const data = release.data();
  if (!release.exists || data?.status !== 'active') throw new Error(`ERP5 활성 release 상태 오류: ${releaseId}`);
  if (expected.productVersionId && data?.productVersionId !== expected.productVersionId) {
    throw new Error(`ERP5 release 상품 버전 불일치: ${releaseId}`);
  }
  if (expected.vehicleMasterVersionId && data?.vehicleMasterVersionId !== expected.vehicleMasterVersionId) {
    throw new Error(`ERP5 release 차종 버전 불일치: ${releaseId}`);
  }
}

/** 포인터가 가리키는 활성 상품 버전만 읽는다. ERP3 products 폴백은 의도적으로 없다. */
export async function readActiveErp5Products(options: {
  includeUnlistable?: boolean;
} = {}): Promise<ActiveErp5Products> {
  const db = erp5AdminFirestore();
  const pointer = await db.doc('ssotState/products').get();
  const versionId = String(pointer.data()?.activeVersionId || '').trim();
  const releaseId = String(pointer.data()?.releaseId || '').trim();
  if (!versionId) throw new Error('ERP5 활성 상품 버전이 없습니다.');
  const versionRef = db.collection('productMasterVersions').doc(versionId);
  const [version, products] = await Promise.all([
    versionRef.get(),
    versionRef.collection('products').get(),
    verifyActiveRelease(releaseId, { productVersionId: versionId }),
  ]);
  if (!version.exists || version.data()?.status !== 'active') {
    throw new Error(`ERP5 활성 포인터의 상품 버전 상태가 올바르지 않습니다: ${versionId}`);
  }
  const rows = products.docs.flatMap((document) => {
    const data = document.data() as Record<string, unknown>;
    if (!options.includeUnlistable && data.listable !== true) return [];
    return [{ id: document.id, data }];
  });
  return { versionId, releaseId, products: rows };
}

export type ActiveErp5VehicleMaster = {
  versionId: string;
  releaseId: string;
  entries: Array<{ id: string; data: Record<string, unknown> }>;
};

/** 관리자 검증 화면 등이 쓸 수 있는 ERP5 활성 차종 원자 읽기. */
export async function readActiveErp5VehicleMaster(): Promise<ActiveErp5VehicleMaster> {
  const db = erp5AdminFirestore();
  const pointer = await db.doc('ssotState/vehicleMaster').get();
  const versionId = String(pointer.data()?.activeVersionId || '').trim();
  const releaseId = String(pointer.data()?.releaseId || '').trim();
  if (!versionId) throw new Error('ERP5 활성 차종마스터 버전이 없습니다.');
  const versionRef = db.collection('vehicleMasterVersions').doc(versionId);
  const [version, entries] = await Promise.all([
    versionRef.get(),
    versionRef.collection('entries').get(),
    verifyActiveRelease(releaseId, { vehicleMasterVersionId: versionId }),
  ]);
  if (!version.exists || version.data()?.status !== 'active') {
    throw new Error(`ERP5 활성 포인터의 차종마스터 버전 상태가 올바르지 않습니다: ${versionId}`);
  }
  return {
    versionId,
    releaseId,
    entries: entries.docs.map((document) => ({ id: document.id, data: document.data() as Record<string, unknown> })),
  };
}
