import 'server-only';

import { cert, getApps, initializeApp, type App, type Credential, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/** 공개 화이트라벨의 유일한 데이터 경계: ERP5 Firestore. */
export const ERP5_FIREBASE_PROJECT_ID = 'freepasserp5';
const ERP5_APP_NAME = 'freepasserp4-erp5-firestore';

type ParsedServiceAccount = ServiceAccount & { projectId: string };

function erp5Credential(): Credential {
  const raw = String(process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('ERP5_FIREBASE_SERVICE_ACCOUNT_JSON 미설정');
  let parsed: { project_id?: unknown; client_email?: unknown; private_key?: unknown };
  try { parsed = JSON.parse(raw); } catch { throw new Error('ERP5_FIREBASE_SERVICE_ACCOUNT_JSON 형식 오류'); }
  const projectId = String(parsed.project_id || '').trim();
  const clientEmail = String(parsed.client_email || '').trim();
  const privateKey = String(parsed.private_key || '');
  if (!projectId || !clientEmail || !privateKey) throw new Error('ERP5 서비스 계정 필수값 누락');
  if (projectId !== ERP5_FIREBASE_PROJECT_ID) throw new Error(`ERP5 프로젝트 불일치: ${projectId}`);
  return cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') } as ParsedServiceAccount);
}

export function erp5Firestore(): Firestore {
  const app: App = getApps().find((item) => item.name === ERP5_APP_NAME)
    || initializeApp({ credential: erp5Credential(), projectId: ERP5_FIREBASE_PROJECT_ID }, ERP5_APP_NAME);
  return getFirestore(app);
}

export function erp5WhitelabelCutoverRequested(): boolean {
  return String(process.env.ERP5_WHITELABEL_FIRESTORE_ENABLED || '').trim() === 'true';
}
