import 'server-only';

import {
  cert,
  getApps,
  initializeApp,
  type App,
  type Credential,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * ERP4 화이트라벨 공개 카탈로그가 읽을 Firebase 경계.
 *
 * 이 모듈은 ERP3/RTDB와 의도적으로 아무 연결이 없다. ERP5의 Firestore 컬렉션 계약이
 * 확정되기 전에는 이 앱을 소비 경로에 연결하지 않는다. 연결 시 자격증명이 다른 프로젝트를
 * 가리키면 조용히 기존 DB로 떨어지지 않고 즉시 실패한다.
 */
export const ERP5_FIREBASE_PROJECT_ID = 'freepasserp5';
const ERP5_APP_NAME = 'freepasserp4-erp5-firestore';
const CUTOVER_RECEIPT_COLLECTION = 'ops';
const CUTOVER_RECEIPT_DOCUMENT = 'erp4_whitelabel_cutover';

type ParsedServiceAccount = ServiceAccount & { projectId: string };

function parseServiceAccount(raw: string): ParsedServiceAccount {
  let parsed: { project_id?: unknown; client_email?: unknown; private_key?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error('ERP5_FIREBASE_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다.');
  }

  const projectId = String(parsed.project_id || '').trim();
  const clientEmail = String(parsed.client_email || '').trim();
  const privateKey = String(parsed.private_key || '');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('ERP5_FIREBASE_SERVICE_ACCOUNT_JSON에 project_id, client_email, private_key가 필요합니다.');
  }
  if (projectId !== ERP5_FIREBASE_PROJECT_ID) {
    throw new Error(`ERP5 Firebase 자격증명 project_id 불일치: ${projectId}`);
  }
  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
}

function erp5Credential(): Credential {
  const raw = String(process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (raw) return cert(parseServiceAccount(raw));
  // 로컬·Vercel 모두 같은 전용 키를 명시해야 한다. ADC는 어느 프로젝트의 자격증명인지
  // 이 경계에서 검증할 수 없으므로 허용하지 않는다.
  throw new Error('ERP5_FIREBASE_SERVICE_ACCOUNT_JSON 미설정 — ERP3 자격증명 대체 사용은 금지됩니다.');
}

export function erp5FirestoreApp(): App {
  const existing = getApps().find((app) => app.name === ERP5_APP_NAME);
  if (existing) return existing;
  return initializeApp({
    credential: erp5Credential(),
    projectId: ERP5_FIREBASE_PROJECT_ID,
  }, ERP5_APP_NAME);
}

/** ERP5 Firestore만 반환한다. RTDB fallback이나 다른 Firebase 앱으로의 대체는 없다. */
export function erp5Firestore(): Firestore {
  return getFirestore(erp5FirestoreApp());
}

/**
 * 운영 전환의 1차 kill switch. 기본값은 반드시 OFF다.
 *
 * 이것만 true여도 바로 소비를 시작해서는 안 된다. `assertErp5WhitelabelCutoverReady()`가 ERP5 안의
 * 원자 담당 영수증까지 대조한다. 이중 게이트가 통과한 뒤에만 개별 ERP4 소비자를 전환한다.
 */
export function erp5WhitelabelCutoverRequested(): boolean {
  return String(process.env.ERP5_WHITELABEL_FIRESTORE_ENABLED || '').trim() === 'true';
}

type Erp5InventoryParity = {
  sourceCount?: unknown;
  targetCount?: unknown;
  missingCount?: unknown;
};

export type Erp5CutoverReceipt = {
  status?: unknown;
  targetProject?: unknown;
  validationRunId?: unknown;
  approvedAt?: unknown;
  inventory?: Erp5InventoryParity | unknown;
};

/**
 * ERP5 원자 담당이 대사 후 Firestore `ops/erp4_whitelabel_cutover`에 남기는 전환 영수증을 엄격히 검사한다.
 *
 * 사업 데이터나 개인식별자를 싣지 않는 운영 제어 문서다. 이 모듈은 영수증을 만들거나 고치지
 * 않으며, 불충분한 영수증·읽기 실패를 모두 fail-closed로 처리한다.
 */
export async function assertErp5WhitelabelCutoverReady(): Promise<void> {
  if (!erp5WhitelabelCutoverRequested()) {
    throw new Error('ERP5 화이트라벨 전환 요청이 OFF입니다. ERP5_WHITELABEL_FIRESTORE_ENABLED=true가 필요합니다.');
  }

  const snapshot = await erp5Firestore()
    .collection(CUTOVER_RECEIPT_COLLECTION)
    .doc(CUTOVER_RECEIPT_DOCUMENT)
    .get();
  if (!snapshot.exists) {
    throw new Error('ERP5 화이트라벨 전환 영수증 없음: ops/erp4_whitelabel_cutover — 원자 담당의 대사 PASS가 먼저 필요합니다.');
  }

  const receipt = snapshot.data() as Erp5CutoverReceipt;
  const inventory = receipt.inventory && typeof receipt.inventory === 'object'
    ? receipt.inventory as Erp5InventoryParity
    : null;
  const errors: string[] = [];
  if (receipt.status !== 'READY') errors.push('status=READY 아님');
  if (receipt.targetProject !== ERP5_FIREBASE_PROJECT_ID) errors.push('targetProject 불일치');
  if (!String(receipt.validationRunId || '').trim()) errors.push('validationRunId 없음');
  if (!String(receipt.approvedAt || '').trim()) errors.push('approvedAt 없음');
  if (!inventory) {
    errors.push('inventory 대사 없음');
  } else {
    const sourceCount = Number(inventory.sourceCount);
    const targetCount = Number(inventory.targetCount);
    const missingCount = Number(inventory.missingCount);
    if (!Number.isInteger(sourceCount) || sourceCount < 0) errors.push('inventory.sourceCount 오류');
    if (!Number.isInteger(targetCount) || targetCount < 0) errors.push('inventory.targetCount 오류');
    if (sourceCount !== targetCount) errors.push('inventory 건수 불일치');
    if (missingCount !== 0) errors.push('inventory 누락 존재');
  }
  if (errors.length) {
    throw new Error(`ERP5 화이트라벨 전환 영수증 HOLD: ${errors.join(', ')}`);
  }
}
