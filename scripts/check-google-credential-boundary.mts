import { googleSheetsServiceAccount } from '../lib/server/google-service-account';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const beforeSheets = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
const beforeFirebase = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const beforeProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const beforeSheetsFile = process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS;
const beforeGoogleFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const boundaryError = (run: () => unknown) => {
  try { run(); } catch (error) { return /ERP5.*Sheets|Sheets.*ERP5/i.test(String((error as Error).message)); }
  return false;
};

try {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'firebase@example.invalid',
    private_key: 'firebase-key',
    project_id: 'freepasserp5',
  });
  process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'firebase-misfiled@example.invalid',
    private_key: 'firebase-misfiled-key',
    project_id: 'freepasserp5',
  });
  if (!boundaryError(() => googleSheetsServiceAccount())) {
    throw new Error('Sheets 전용 변수에 잘못 넣은 ERP5 Firebase 자격증명을 허용했습니다.');
  }
  process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'sheets@example.invalid',
    private_key: 'sheets-key',
  });
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'freepasserp5';
  const split = googleSheetsServiceAccount();
  if (split.client_email !== 'sheets@example.invalid' || split.private_key !== 'sheets-key') {
    throw new Error('Google Sheets 전용 자격증명이 Firebase 자격증명보다 우선하지 않습니다.');
  }

  delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS;
  const rejectedMissingDedicated = boundaryError(() => googleSheetsServiceAccount());
  if (!rejectedMissingDedicated) throw new Error('ERP5가 Firebase 자격증명을 Sheets에 재사용했습니다.');

  const dedicatedPath = 'tmp/google-sheets-credential-boundary.json';
  writeFileSync(dedicatedPath, JSON.stringify({
    client_email: 'sheets-file@example.invalid',
    private_key: 'sheets-file-key',
  }));
  process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS = dedicatedPath;
  const splitFile = googleSheetsServiceAccount();
  rmSync(dedicatedPath, { force: true });
  delete process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS;
  if (splitFile.client_email !== 'sheets-file@example.invalid') {
    throw new Error('ERP5의 Google Sheets 전용 파일 자격증명을 읽지 못했습니다.');
  }

  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'freepasserp3';
  const rejectedCredentialMismatch = boundaryError(() => googleSheetsServiceAccount());
  if (!rejectedCredentialMismatch) throw new Error('공개 설정이 낡으면 ERP5 Firebase 자격증명이 Sheets로 새었습니다.');

  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const fallbackPath = 'tmp/google-sheets-firebase-fallback.json';
  writeFileSync(fallbackPath, JSON.stringify({
    client_email: 'firebase-file@example.invalid',
    private_key: 'firebase-file-key',
    project_id: 'freepasserp5',
  }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = fallbackPath;
  const rejectedFileReuse = boundaryError(() => googleSheetsServiceAccount());
  rmSync(fallbackPath, { force: true });
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!rejectedFileReuse) throw new Error('ERP5 Firebase 파일 자격증명이 Sheets로 새었습니다.');

  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'firebase@example.invalid',
    private_key: 'firebase-key',
    project_id: 'freepasserp3',
  });
  const fallback = googleSheetsServiceAccount();
  if (fallback.client_email !== 'firebase@example.invalid' || fallback.private_key !== 'firebase-key') {
    throw new Error('기존 단일 자격증명 fallback이 깨졌습니다.');
  }

  // 시간별 오케스트레이터가 실제로 부르는 모든 Sheets 스크립트는 전용 자격증명
  // 경계를 반드시 거친다. 새 단계를 추가해도 이 검사에 잡힌다.
  const rootScript = 'scripts/hourly-sync.mts';
  const sources = new Map<string, string>();
  const pending = [rootScript];
  while (pending.length) {
    const parent = pending.shift()!;
    if (sources.has(parent) || !existsSync(parent)) continue;
    const source = readFileSync(parent, 'utf8');
    sources.set(parent, source);
    for (const match of source.matchAll(/['"](scripts\/[a-z0-9_-]+\.mts)['"]/gi)) {
      if (!sources.has(match[1])) pending.push(match[1]);
    }
  }
  const boundaryViolations: string[] = [];
  const shimViolations: string[] = [];
  for (const [script, source] of sources) {
    if (script === rootScript) continue;
    const usesSheets = /sheets\.googleapis\.com|googleapis|google-auth-library/.test(source);
    if (usesSheets && !/googleSheetsServiceAccount\s*\(/.test(source)) {
      boundaryViolations.push(script);
    }
    if (/firebaseAdminApp\s*\(/.test(source)) {
      const callers = [...sources].filter(([, parentSource]) => parentSource.includes(`'${script}'`));
      if (callers.some(([parent, parentSource]) => !parentSource.includes(`'--require', './scripts/lib/server-only-shim.cjs', '${script}'`))) {
        shimViolations.push(`${callers.map(([parent]) => parent).join('|')} -> ${script}`);
      }
    }
  }
  if (boundaryViolations.length) {
    throw new Error(`시간별 작업의 Firebase/Sheets 자격증명이 분리되지 않았습니다: ${boundaryViolations.join(', ')}`);
  }
  if (shimViolations.length) {
    throw new Error(`시간별 작업이 server-only shim 없이 Firebase 서버 모듈을 불러옵니다: ${shimViolations.join(', ')}`);
  }

  console.log('Google Sheets/Firebase credential boundary PASS');
} finally {
  rmSync('tmp/google-sheets-credential-boundary.json', { force: true });
  rmSync('tmp/google-sheets-firebase-fallback.json', { force: true });
  if (beforeSheets === undefined) delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
  else process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = beforeSheets;
  if (beforeFirebase === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = beforeFirebase;
  if (beforeProject === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  else process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = beforeProject;
  if (beforeSheetsFile === undefined) delete process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS;
  else process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS = beforeSheetsFile;
  if (beforeGoogleFile === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  else process.env.GOOGLE_APPLICATION_CREDENTIALS = beforeGoogleFile;
}
