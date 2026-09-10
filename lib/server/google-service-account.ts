import { readFileSync } from 'node:fs';

export type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

/** Google Workspace와 Firebase의 자격증명 경계를 분리한다. */
export function googleSheetsServiceAccount(fallbackFile = ''): GoogleServiceAccount {
  const dedicated = String(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || '').trim();
  const dedicatedFile = String(process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS || '').trim();
  const firebaseProjectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const firebaseInline = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  let firebaseCredentialProjectId = '';
  try {
    firebaseCredentialProjectId = String(JSON.parse(firebaseInline || '{}').project_id || '').trim();
  } catch {
    // Firebase 자격증명 형식 오류는 Firebase 초기화 경로에서 구체적으로 보고한다.
  }
  if ((firebaseProjectId === 'freepasserp5' || firebaseCredentialProjectId === 'freepasserp5') && !dedicated && !dedicatedFile) {
    throw new Error('ERP5는 GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON 또는 GOOGLE_SHEETS_APPLICATION_CREDENTIALS 전용 자격증명이 필요합니다.');
  }
  const legacyFile = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || fallbackFile).trim();
  const raw = dedicated
    || (dedicatedFile ? readFileSync(dedicatedFile, 'utf8') : '')
    || firebaseInline
    || (legacyFile ? readFileSync(legacyFile, 'utf8') : '');
  if (!raw) {
    throw new Error(
      'Google Sheets 자격증명 미설정 — GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON 또는 GOOGLE_SHEETS_APPLICATION_CREDENTIALS가 필요합니다.',
    );
  }
  const parsed = JSON.parse(raw) as Partial<GoogleServiceAccount>;
  if (String((parsed as { project_id?: string }).project_id || '').trim() === 'freepasserp5') {
    throw new Error('ERP5 Firebase 자격증명은 Google Sheets에 재사용할 수 없습니다. Sheets 전용 자격증명이 필요합니다.');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Google Sheets 서비스계정 형식이 올바르지 않습니다.');
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
    token_uri: String(parsed.token_uri || 'https://oauth2.googleapis.com/token'),
  };
}
