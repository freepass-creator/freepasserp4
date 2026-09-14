import { readFileSync } from 'node:fs';
import { applicationDefault, cert, type AppOptions } from 'firebase-admin/app';

export const ERP5_INVENTORY_PROJECT_ID = 'freepasserp5';

export type Erp5ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

/** 원천 수집 writer는 ERP5 전용 자격증명만 허용한다. ERP3/RTDB fallback은 없다. */
export function readErp5InventoryServiceAccount(): Erp5ServiceAccount {
  const inline = String(process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const path = String(process.env.ERP5_FIREBASE_APPLICATION_CREDENTIALS || '').trim();
  if (!inline && !path) {
    throw new Error('ERP5_FIREBASE_SERVICE_ACCOUNT_JSON 또는 ERP5_FIREBASE_APPLICATION_CREDENTIALS 미설정');
  }
  const value = JSON.parse(inline || readFileSync(path, 'utf8')) as Partial<Erp5ServiceAccount>;
  if (value.project_id !== ERP5_INVENTORY_PROJECT_ID) {
    throw new Error(`ERP5 원천 writer 대상 오류: ${value.project_id || '(blank)'} (필수: ${ERP5_INVENTORY_PROJECT_ID})`);
  }
  if (!value.client_email || !value.private_key) throw new Error('ERP5 서비스계정 JSON 형식 오류');
  return value as Erp5ServiceAccount;
}

/** GitHub OIDC는 ADC를 쓰고, 로컬 검증은 ERP5 전용 서비스계정만 허용한다. */
export function erp5InventoryAppOptions(): AppOptions {
  if (String(process.env.ERP5_FIREBASE_USE_ADC || '').toLowerCase() === 'true') {
    const projectId = String(process.env.GOOGLE_CLOUD_PROJECT || '').trim();
    const credentials = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    if (projectId !== ERP5_INVENTORY_PROJECT_ID || !credentials) {
      throw new Error('ERP5 OIDC 경계 오류: GOOGLE_CLOUD_PROJECT=freepasserp5와 ADC 자격증명 파일이 필요합니다.');
    }
    return { projectId: ERP5_INVENTORY_PROJECT_ID, credential: applicationDefault() };
  }
  const sa = readErp5InventoryServiceAccount();
  return {
    projectId: ERP5_INVENTORY_PROJECT_ID,
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }),
  };
}
