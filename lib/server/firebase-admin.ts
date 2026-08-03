import 'server-only';

import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

export function firebaseAdminApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;
  const databaseURL = String(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').trim();
  if (!databaseURL) throw new Error('NEXT_PUBLIC_FIREBASE_DATABASE_URL 미설정');
  return initializeApp({ credential: cert(serviceAccount()), databaseURL }, APP_NAME);
}

export function firebaseAdminDatabase(): Database {
  return getDatabase(firebaseAdminApp());
}

export type ActiveBearer = {
  uid: string;
  role: 'agent' | 'provider' | 'admin';
  rawRole: string;
  companyCode: string;
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
  try {
    const decoded = await getAuth(firebaseAdminApp()).verifyIdToken(token);
    if (decoded.firebase?.sign_in_provider === 'anonymous') return null;
    const snapshot = await firebaseAdminDatabase().ref(`users/${decoded.uid}`).get();
    const profile = snapshot.val() as {
      role?: string;
      status?: string;
      is_active?: boolean | string;
      company_code?: string;
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
    };
  } catch {
    return null;
  }
}

export async function verifyAdminBearer(request: Request): Promise<{ uid: string } | null> {
  const active = await verifyActiveBearer(request);
  return active?.role === 'admin' ? { uid: active.uid } : null;
}
