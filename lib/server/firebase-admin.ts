import 'server-only';

import { applicationDefault, cert, getApps, initializeApp, type App, type Credential, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getDatabase, type Database } from 'firebase-admin/database';

const APP_NAME = 'freepass-server';

function serviceAccount(): ServiceAccount {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 미설정');
  const parsed = JSON.parse(raw) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다.');
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, '\n'),
  };
}

function serverCredential(): Credential {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (raw) return cert(serviceAccount());
  // 로컬 감사/검증기는 파일 기반 ADC를 쓴다. 경로가 명시된 경우에만 허용해
  // Vercel 운영환경에서 우연한 무자격증명 초기화로 빠지지 않게 한다.
  if (String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) return applicationDefault();
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 또는 GOOGLE_APPLICATION_CREDENTIALS 미설정');
}

function demoEmulatorProjectId(): string {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST) return '';
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
  return projectId.startsWith('demo-') ? projectId : '';
}

export function firebaseAdminApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;
  const databaseURL = String(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').trim();
  if (!databaseURL) throw new Error('NEXT_PUBLIC_FIREBASE_DATABASE_URL 미설정');
  // 두 emulator host와 demo-* project가 모두 명시된 격리 검증에서만 자격증명 없이 초기화한다.
  // 운영 환경이 우연히 한 변수만 가진 경우에는 아래 서비스계정 검증으로 fail-closed한다.
  const emulatorProjectId = demoEmulatorProjectId();
  if (emulatorProjectId) return initializeApp({ projectId: emulatorProjectId, databaseURL }, APP_NAME);
  return initializeApp({ credential: serverCredential(), databaseURL }, APP_NAME);
}

export function firebaseAdminDatabase(): Database {
  return getDatabase(firebaseAdminApp());
}

export type ActiveBearer = {
  uid: string;
  role: 'agent' | 'provider' | 'admin';
  rawRole: string;
  companyCode: string;
  agentChannelCode: string;
};

const ACTIVE_ROLES = new Set(['agent', 'agent_admin', 'agent_manager', 'provider', 'provider_admin', 'admin']);

/**
 * 서버 API 공통 인증 게이트.
 *
 * ID 토큰만 믿지 않고 운영 권한 SSOT인 users/{uid}를 매 요청 재확인한다. 역할 강등·퇴사 처리 뒤
 * 만료 전 토큰이 남아 있어도 서버 투영 API를 계속 읽는 일을 막기 위해서다. status가 없는 기존
 * 정상 회원은 현재 RTDB rules와 동일하게 허용하되, 미배정 역할·익명·대기·삭제·반려·비활성은 닫는다.
 */
export async function verifyActiveBearer(request: Request): Promise<ActiveBearer | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!token) return null;
  // 구성/서비스 장애는 호출자가 503으로 구분할 수 있게 삼키지 않는다.
  // 유효하지 않은 사용자 토큰만 인증 실패(null)로 정규화한다.
  const app = firebaseAdminApp();
  let decoded: DecodedIdToken;
  try {
    decoded = await getAuth(app).verifyIdToken(token);
  } catch {
    return null;
  }
  if (decoded.firebase?.sign_in_provider === 'anonymous') return null;
  const snapshot = await getDatabase(app).ref(`users/${decoded.uid}`).get();
  const profile = snapshot.val() as {
    role?: string;
    status?: string;
    is_active?: boolean | string;
    company_code?: string;
    agent_channel_code?: string;
  } | null;
  const rawRole = String(profile?.role || '');
  if (!profile || !ACTIVE_ROLES.has(rawRole)) return null;
  if (['pending', 'deleted', 'rejected'].includes(String(profile.status || ''))) return null;
  if (profile.is_active === false || profile.is_active === '아니오') return null;
  const role = rawRole === 'admin'
    ? 'admin'
    : (rawRole === 'provider' || rawRole === 'provider_admin' ? 'provider' : 'agent');
  return {
    uid: decoded.uid,
    role,
    rawRole,
    companyCode: String(profile.company_code || '').trim(),
    agentChannelCode: String(profile.agent_channel_code || '').trim(),
  };
}

export async function verifyAdminBearer(request: Request): Promise<{ uid: string } | null> {
  const active = await verifyActiveBearer(request);
  return active?.role === 'admin' ? { uid: active.uid } : null;
}
